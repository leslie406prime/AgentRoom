/* eslint-disable @next/next/no-img-element -- OAuth avatars use provider URLs. */
"use client";
import { can } from "@/server/permissions";
import { useHydrated } from "@/lib/use-hydrated";
import WorkspaceNav, { type WorkspaceNavData } from "./WorkspaceNav";

import dynamic from "next/dynamic";
import { io, type Socket } from "socket.io-client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SignOutButton from "./SignOutButton";
import Brand from "./Brand";
import Icon from "./Icon";
import { agentInfo, modelLabel, parseMention, parseModelKey, type AgentId } from "@/lib/ai-catalog";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
type Room = { id: string; name: string; archived?: number };
type Member = { id: string; name: string; color: string; image?: string | null; online?: boolean };
type Message = { id: string; authorId: string; authorName: string; content: string; kind: string; createdAt: string; seq: number; jobId?: string; mode?: string | null; agent?: AgentId | null; provider?: string | null; model?: string | null };
type Job = { id: string; requesterId: string; requesterName: string; prompt: string; status: string; error?: string | null; model?: string | null; agent?: AgentId | null };
type Artifact = { id: string; title: string; type: "code" | "document"; language: string; content: string; version: number; updatedBy: string; updatedAt: string };
type Version = Artifact & { artifactId: string };
type EventPayload = { seq: number; type: string; payload: unknown };
type AgentOption = { id: AgentId; label: string; mention: string; blurb: string; available: boolean; demo?: boolean; modelLabel?: string | null; reason?: string };
type ModelOption = { key: string; label: string; provider: string; available: boolean; reason?: string };
type AIState = { models: string[]; mode: string; defaultAgent: AgentId; agents: AgentOption[]; modelOptions: ModelOption[] };
type Tab = "chat" | "people" | "files";
// A chosen model only applies to an agent that can run it (@Gemini -> Gemini models, @Llama -> Llama models).
const modelFits = (agent: AgentId, key: string) => agent === "agent" || (agent === "gemini" ? parseModelKey(key)?.provider === "gemini" : agent === "llama" ? /llama/i.test(key) : false);
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
const humanTime = (date: string) => new Date(date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const getStorage = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const setStorage = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Storage may be disabled. */ } };

export default function RoomClient({ room, user, workspace, workspaces = [] }: { room: Room; user: { id: string; name: string; image?: string | null }; workspace?: WorkspaceNavData; workspaces?: {id:string;name:string}[] }) {
 const ready=useHydrated();
  const [name, setName] = useState(user.name);
  const [memberId, setMemberId] = useState("");
  const joined = true;
  const [connection, setConnection] = useState<"connected" | "reconnecting" | "offline">("offline");
  const [demoMode, setDemoMode] = useState(false);
  const [,setAIMode]=useState("loading");
  const [agentOptions,setAgentOptions]=useState<AgentOption[]>([]);
  const [modelOptions,setModelOptions]=useState<ModelOption[]>([]);
  const [selectedAgent,setSelectedAgent]=useState<AgentId|"">("");
  const [jobMeta,setJobMeta]=useState<Record<string,{agent?:AgentId;provider?:string|null;model?:string|null}>>({});
  const [selectedModel,setSelectedModel]=useState("");
  const [jobModes,setJobModes]=useState<Record<string,string>>({});
  const [readOnly,setReadOnly]=useState(Boolean(workspace?.channels.find(c=>c.id===room.id)?.archived));
  const [messages, setMessages] = useState<Message[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [streaming, setStreaming] = useState<Record<string, string>>({});
  const [typing, setTyping] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [askAgent, setAskAgent] = useState(false);
  const [error, setError] = useState("");
  const [inviteLink,setInviteLink]=useState("");
  const inviteLabel=workspace&&can(workspace.role,"invite")?"Create invite link":"Copy channel link";
  const [activeArtifact, setActiveArtifact] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [mobileTab, setMobileTab] = useState<Tab>("chat");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);
  const pendingMessages = useRef(new Map<string, { clientId: string; content: string }>());
  const artifactsRef = useRef<Artifact[]>([]);

  const storagePrefix = `agentroom:${room.id}`;

  const onRoomEvent = useCallback((event: EventPayload) => {
    if (!event || typeof event.seq !== "number" || event.seq <= seqRef.current) return;
    seqRef.current = event.seq;
    setStorage(`${storagePrefix}:seq`, String(event.seq));
    const data: Record<string,unknown> & {seq:number} = { ...(event.payload as Record<string, unknown>), seq: event.seq };
    if (event.type === "message:deleted") { setMessages(current=>current.filter(m=>m.id!==data.id));
    } else if (event.type === "message") {
      const message = data as unknown as Message;
      setMessages((current) => current.some((item) => item.id === message.id) ? current.map((item) => item.id === message.id ? { ...item, ...message } : item) : [...current, message].sort((a, b) => a.seq - b.seq));
      if (message.jobId) setStreaming((current) => { const next = { ...current }; delete next[message.jobId!]; return next; });
    } else if (event.type === "job") {
      const job = data as unknown as Job;
      setJobs((current) => current.some((item) => item.id === job.id) ? current.map((item) => item.id === job.id ? { ...item, ...job } : item) : [...current, job]);
    } else if (event.type === "artifact") {
      const artifact = data as unknown as Artifact;
      setActiveArtifact((current) => current ?? artifact.id);
      const previous = artifactsRef.current.find((item) => item.id === artifact.id);
      if (previous && previous.version < artifact.version) {
        setVersions((history) => history.some((item) => item.artifactId === artifact.id && item.version === previous.version) ? history : [...history, { ...previous, artifactId: artifact.id }].sort((a, b) => b.version - a.version));
      }
      artifactsRef.current = previous ? artifactsRef.current.map((item) => item.id === artifact.id ? artifact : item) : [artifact, ...artifactsRef.current];
      setArtifacts(artifactsRef.current);
    }
  }, [storagePrefix]);

  useEffect(() => {
    if (!joined || !user.id) return;
    const socket = io({ autoConnect: false, reconnection: true, reconnectionAttempts: Infinity, timeout: 8000 });
    socketRef.current = socket;
    const applyAI=(config:AIState)=>{setAgentOptions(config.agents??[]);setModelOptions(config.modelOptions??[]);setSelectedAgent(current=>current&&config.agents?.some(a=>a.id===current)?current:config.defaultAgent??"");setSelectedModel(current=>config.models.includes(current)?current:"");setAIMode(config.mode);setDemoMode(config.mode==="demo"&&!config.agents?.some(a=>a.id!=="agent"&&a.available));};
    socket.on("workspace:ai",applyAI);
    socket.on("connect", () => {
      setConnection("reconnecting");
      const storedSeq = Number(getStorage(`${storagePrefix}:seq`) ?? 0);
      const lastSeen = Number.isSafeInteger(storedSeq) && storedSeq >= 0 ? storedSeq : 0;
      seqRef.current = lastSeen;
      socket.emit("room:join", { roomId: room.id, lastSeq: lastSeen }, (reply: { state?: { room: Room; seq: number; messages: Message[]; members: Member[]; jobs: Job[]; artifacts: Artifact[]; versions: Version[]; replay: EventPayload[] }; memberId?: string; memberName?: string; demoMode?: boolean; ai?:AIState; error?: string }) => {
        if (reply.error || !reply.state) { setError(reply.error ?? "Could not join this room."); return; }
        setConnection("connected");
        setReadOnly(Boolean(reply.state.room.archived));
        if(reply.ai)applyAI(reply.ai);
        if (reply.memberId) setMemberId(reply.memberId);
        if (reply.memberName) setName(reply.memberName);
        setDemoMode(Boolean(reply.demoMode));
        setMessages(reply.state.messages);
        setMembers(reply.state.members);
        setJobs(reply.state.jobs);
        artifactsRef.current = reply.state.artifacts;
        setArtifacts(reply.state.artifacts);
        setVersions(reply.state.versions);
        const savedArtifact = getStorage(`${storagePrefix}:artifact`);
        const selectedArtifact = savedArtifact && reply.state.artifacts.some((artifact) => artifact.id === savedArtifact)
          ? savedArtifact
          : reply.state.artifacts[0]?.id ?? null;
        setActiveArtifact((current) => current && reply.state!.artifacts.some((artifact) => artifact.id === current) ? current : selectedArtifact);
        if (selectedArtifact) setStorage(`${storagePrefix}:artifact`, selectedArtifact);
        reply.state.replay.forEach((event) => onRoomEvent(event));
        seqRef.current = Math.max(seqRef.current, reply.state.seq);
        setStorage(`${storagePrefix}:seq`, String(seqRef.current));
        for (const pending of pendingMessages.current.values()) {
          socket.emit("message:send", pending, (result: { ok?: boolean; error?: string }) => {
            if (result?.ok) pendingMessages.current.delete(pending.clientId);
            else if (result?.error) {
              pendingMessages.current.delete(pending.clientId);
              setMessages((current) => current.filter((message) => message.id !== pending.clientId));
              setError(result.error);
            }
          });
        }
      });
    });
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", () => setConnection("offline"));
    socket.on("room:event", onRoomEvent);
    socket.on("presence:update", ({ memberId: changedId, name: memberName, color, online }: { memberId: string; name?: string; color?: string; online: boolean }) => setMembers((current) => {
      const found = current.some((member) => member.id === changedId);
      return found ? current.map((member) => member.id === changedId ? { ...member, online, ...(memberName ? { name: memberName } : {}), ...(color ? { color } : {}) } : member) : memberName && color ? [...current, { id: changedId, name: memberName, color, online }] : current;
    }));
    socket.on("queue:update", (list: Job[]) => setJobs((current) => {
      const keep = current.filter((job) => !["queued", "running"].includes(job.status));
      return [...keep, ...list];
    }));
    socket.on("agent:token", ({jobId,token,mode,agent,provider,model}:{jobId:string;token:string;mode?:string;agent?:AgentId;provider?:string|null;model?:string|null})=>{if(mode)setJobModes(current=>({...current,[jobId]:mode}));setJobMeta(current=>current[jobId]?current:{...current,[jobId]:{agent,provider,model}});setStreaming(current=>({...current,[jobId]:(current[jobId]??"")+token}));});
    socket.on("agent:done", ({ jobId }: { jobId: string }) => setStreaming((current) => { const next = { ...current }; delete next[jobId]; return next; }));
    socket.on("typing:update", ({ memberId: changedId, name: typingName, active }: { memberId: string; name: string; active: boolean }) => {
      setTyping((current) => active ? [...new Set([...current, typingName])] : current.filter((item) => item !== typingName));
      if (active) window.setTimeout(() => setTyping((current) => current.filter((item) => item !== typingName)), 2500);
      void changedId;
    });
    socket.connect();
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [joined, name, room.id, user.id, onRoomEvent, storagePrefix]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, streaming]);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); composerRef.current?.focus(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const selected = artifacts.find((item) => item.id === activeArtifact) ?? null;
  const orderedJobs = useMemo(() => jobs.filter((job) => ["running", "queued", "failed"].includes(job.status)), [jobs]);
  const onlineCount = members.filter((member) => member.online).length;

  function send() {
    const content = draft.trim();
    if (!content || !socketRef.current || connection !== "connected") return;
    const mention = parseMention(content);
    const wantsAgent = askAgent || Boolean(mention);
    if (wantsAgent) {
      const agent: AgentId = mention?.agent ?? (selectedAgent || "agent");
      const prompt = mention ? mention.prompt : content;
      if (!prompt.trim()) { setError(`Add a question after ${agentInfo[agent].mention}.`); return; }
      const option = agentOptions.find(a => a.id === agent);
      if (option && !option.available) { setError(`${option.label} is unavailable: ${option.reason ?? "not configured."}`); return; }
      const model = agent !== "muse" && selectedModel && modelFits(agent, selectedModel) ? selectedModel : undefined;
      setDraft(""); setError("");
      socketRef.current.emit("agent:request", { prompt, agent, model, idempotencyKey: crypto.randomUUID() }, (reply: { error?: string }) => { if (reply?.error) { setError(reply.error); setDraft(content); } });
      socketRef.current.emit("typing:update", { active: false });
    } else {
      setDraft(""); setError("");
      const clientId = crypto.randomUUID();
      const optimistic: Message = { id: clientId, authorId: memberId, authorName: name, content, kind: "human", createdAt: new Date().toISOString(), seq: Number.MAX_SAFE_INTEGER };
      setMessages((current) => [...current, optimistic]);
      const pending = { clientId, content };
      pendingMessages.current.set(clientId, pending);
      socketRef.current.emit("message:send", pending, (reply: { ok?: boolean; error?: string }) => {
        if (reply?.ok) pendingMessages.current.delete(clientId);
        if (reply?.error) { pendingMessages.current.delete(clientId); setError(reply.error); setMessages((current) => current.filter((item) => item.id !== clientId)); setDraft(content); }
      });
    }
  }

  function sendTyping(active: boolean) {
    socketRef.current?.emit("typing:update", { active });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (active) typingTimer.current = setTimeout(() => socketRef.current?.emit("typing:update", { active: false }), 1600);
  }

  async function copyInvite() {
    if(workspace&&can(workspace.role,"invite")) {
      try {
        const response=await fetch("/api/workspaces/"+workspace.id+"/invitations",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
        const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not create invitation.");
        const link=window.location.origin+data.path;setInviteLink(link);
        try{await navigator.clipboard.writeText(link);setError("Invitation link copied. Save it now; it is shown only at creation.");}catch{setError("Copy the new invitation link below.");}
      } catch(error){setError(error instanceof Error?error.message:"Could not create invitation.");}
    } else {
      try{await navigator.clipboard.writeText(window.location.href);setError("Channel link copied. Workspace membership is required to open it.");}catch{setError("Copy this channel URL from the address bar. Workspace membership is required.");}
    }
  }

  function beginEdit() {
    if (!selected) return;
    setEditContent(selected.content); setEditTitle(selected.title); setEditVersion(selected.version); setSaveError(""); setEditMode(true);
  }

  function saveArtifact(overwrite = false) {
    if (!selected || !socketRef.current) return;
    socketRef.current.emit("artifact:save", { id: selected.id, title: editTitle, type: selected.type, language: selected.language, content: editContent, version: editVersion, overwrite }, (reply: { error?: string; conflict?: boolean }) => {
      if (reply?.error) { setSaveError(reply.error); return; }
      setEditMode(false); setSaveError("");
    });
  }

  function retry(job: Job) {
    socketRef.current?.emit("agent:request", { prompt: job.prompt, agent: job.agent ?? undefined, model: job.agent === "muse" ? undefined : selectedModel || undefined, idempotencyKey: crypto.randomUUID() }, (reply: { error?: string }) => { if (reply?.error) setError(reply.error); });
  }

  const panelState = (panel: Tab) => mobileTab === panel ? "flex" : "hidden";

  return <main inert={!ready} className="flex h-[100dvh] flex-col overflow-hidden bg-white text-ink">
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel px-4 lg:hidden"><Brand /><span className="max-w-[45%] truncate text-xs text-muted">{workspace?.name ?? room.name}</span></div>
    <nav aria-label="Workspace panels" className="flex shrink-0 border-b border-line bg-white lg:hidden">
      {(["people", "chat", "files"] as Tab[]).map(tab => <button key={tab} aria-current={mobileTab === tab ? "page" : undefined} onClick={() => setMobileTab(tab)} className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-xs ${mobileTab === tab ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:bg-hover"}`}><Icon name={tab === "people" ? "people" : tab === "files" ? "file" : "chat"} className="h-3.5 w-3.5" />{tab === "people" ? "Workspace" : tab === "files" ? "Artifacts & activity" : "Conversation"}</button>)}
    </nav>
    <div className={`grid min-h-0 flex-1 grid-cols-1 ${detailsOpen ? "lg:grid-cols-[232px_minmax(0,1fr)_340px] xl:grid-cols-[244px_minmax(0,1fr)_360px]" : "lg:grid-cols-[232px_minmax(0,1fr)] xl:grid-cols-[244px_minmax(0,1fr)]"}`}>
      <aside aria-label="Workspace sidebar" className={`${panelState("people")} min-h-0 flex-col overflow-y-auto border-r border-line bg-panel lg:flex`}>
        <div className="hidden h-[68px] shrink-0 items-center border-b border-line px-5 lg:flex"><Brand /></div>
        {workspace && <WorkspaceNav workspace={workspace} workspaces={workspaces} user={user} activeChannelId={room.id} showIdentity={false} showSettings={false} agents={agentOptions} />}
        {!workspace && <div className="border-b border-line p-5"><p className="eyebrow">Workspace</p><h2 className="mt-3 text-sm font-semibold">{room.name}</h2><button onClick={copyInvite} className="btn mt-4 w-full"><Icon name="link" />{inviteLabel}</button></div>}
        <section className="px-3 pb-5 pt-2">
          <div className="mb-3 flex items-center justify-between px-2"><h2 className="eyebrow">Members</h2><span className="text-[10px] text-muted">{members.length}</span></div>
          <div className="space-y-0.5">{members.map(member => <div key={member.id} className="flex items-center gap-2.5 rounded-md px-2 py-2">
            <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md border border-line bg-white text-[9px] font-medium">{member.image ? <img src={member.image} alt="" referrerPolicy="no-referrer" className="h-7 w-7 rounded-md object-cover" /> : initials(member.name)}<i aria-label={member.online ? "Online" : "Away"} className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-panel ${member.online ? "bg-success" : "bg-neutral-300"}`} /></span>
            <span className="min-w-0 flex-1 truncate text-xs">{member.name}{member.id === memberId && <span className="text-muted"> (you)</span>}</span>
          </div>)}
          {members.length === 0 && <p className="px-2 text-xs text-muted">Connecting to your team…</p>}</div>
        </section>
        <section className="border-t border-line px-3 py-5"><h2 className="eyebrow mb-3 px-2">AI agents</h2>
          <button onClick={() => { setAskAgent(true); setMobileTab("chat"); composerRef.current?.focus(); }} className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-hover"><span className="grid h-7 w-7 place-items-center rounded-md border border-line bg-white text-accent"><Icon name="agent" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-medium">Room agent</span><span className="mt-0.5 block text-[10px] text-muted">{orderedJobs.some(job => job.status === "running") ? "Working with your team" : "Ready when you are"}</span></span><span className="badge">AI</span></button>
        </section>
        <div className="mt-auto pt-4">
          {workspace && <Link href={"/workspaces/" + workspace.id} className="mx-3 mb-3 flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted hover:bg-hover hover:text-ink"><Icon name="settings" />Workspace settings</Link>}
          <div className="flex items-center gap-2 border-t border-line px-4 py-4"><Link href="/profile" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md">
            {user.image ? <img src={user.image} alt="" referrerPolicy="no-referrer" className="h-8 w-8 rounded-md object-cover" /> : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-white text-[10px] font-semibold">{initials(name || "?")}</span>}
            <span className="min-w-0"><span className="block truncate text-xs font-medium">{name}</span><span className="mt-0.5 block text-[10px] text-muted">Profile & account</span></span>
          </Link><SignOutButton /></div>
        </div>
      </aside>

      <section aria-label="Channel conversation" className={`${panelState("chat")} min-h-0 min-w-0 flex-col bg-white lg:flex`}>
        <header className="flex min-h-[68px] shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6">
          <div className="min-w-0"><h1 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Icon name="hash" className="h-5 w-5 shrink-0 text-muted" /><span className="truncate">{room.name}</span>{readOnly && <span className="badge">Archived</span>}</h1><p className="mt-1 truncate pl-7 text-[11px] text-muted">Your team&apos;s shared conversation</p></div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`mr-2 hidden items-center gap-1.5 text-[10px] sm:flex ${connection === "connected" ? "text-success" : connection === "reconnecting" ? "text-amber-700" : "text-danger"}`}><i className={`h-1.5 w-1.5 rounded-full ${connection === "connected" ? "bg-success" : connection === "reconnecting" ? "animate-pulse bg-amber-600" : "bg-danger"}`} />{connection === "connected" ? "Connected" : connection === "reconnecting" ? "Reconnecting" : "Offline"}</span>
            <button onClick={copyInvite} className="btn px-2.5" title={inviteLabel}><Icon name="link" className="h-3.5 w-3.5" /><span className="hidden xl:inline">{inviteLabel}</span><span className="sr-only xl:hidden">{inviteLabel}</span></button>
            <button onClick={() => setDetailsOpen(value => !value)} aria-label={detailsOpen ? "Hide details sidebar" : "Show details sidebar"} aria-expanded={detailsOpen} aria-controls="workspace-details" title={detailsOpen ? "Hide details sidebar" : "Show details sidebar"} className={`icon-button hidden lg:inline-flex ${detailsOpen ? "bg-hover text-ink" : ""}`}><Icon name="panel" /></button>
          </div>
        </header>
        {inviteLink && <div className="shrink-0 border-b border-line bg-panel px-5 py-3 text-xs"><label className="settings-label">New invitation link (single use, expires in 7 days)<input aria-label="New invitation link" readOnly className="field text-xs" value={inviteLink} /></label><button className="mt-2 text-xs text-muted underline underline-offset-2" onClick={() => setInviteLink("")}>Dismiss invitation link</button></div>}
        {selectedAgent && agentOptions.find(a => a.id === selectedAgent)?.modelLabel && <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-2 text-[11px] text-muted"><Icon name="shield" className="h-3 w-3" />Default assistant: {agentInfo[selectedAgent].label} · {agentOptions.find(a => a.id === selectedAgent)?.modelLabel}</div>}
        {demoMode && <div className="flex shrink-0 items-start gap-2 border-b border-line bg-panel px-5 py-2.5 text-[11px] leading-5 text-muted"><Icon name="agent" className="mt-0.5 h-3.5 w-3.5 shrink-0" /><p><strong className="mr-2 font-medium text-ink">DEMO MODE</strong>No AI provider is configured for this workspace. Sample responses and artifacts are generated locally, not by a model.</p></div>}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 && Object.keys(streaming).length === 0 ? <div className="mx-auto flex h-full min-h-64 max-w-sm flex-col items-center justify-center pb-8 text-center"><span className="grid h-12 w-12 place-items-center rounded-lg border border-line bg-panel text-muted"><Icon name="hash" className="h-6 w-6" /></span><p className="eyebrow mt-5">A shared place to start</p><h2 className="mt-2 text-xl font-semibold tracking-tight">Welcome to #{room.name}</h2><p className="mt-3 text-sm leading-6 text-muted">Share an idea, make a plan, or bring your agent into the conversation. Great work starts here.</p></div> :
          <div className="mx-auto max-w-3xl space-y-6">{messages.map(message => {
            const author = members.find(member => member.id === message.authorId);
            const avatar = author?.image ?? (message.authorId === user.id ? user.image : null);
            return <article key={message.id} className="group flex animate-appear gap-3">
              <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-[10px] font-semibold ${message.kind === "agent" ? "bg-panel text-accent" : "bg-[#edf0f2] text-neutral-600"}`}>{message.kind === "agent" ? <Icon name="agent" className="h-[18px] w-[18px]" /> : avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-md object-cover" /> : initials(message.authorName)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">{message.authorName}</span>
                  {message.kind === "agent" ? <span className="badge" title="Provider and model that generated this response">{(message.mode === "demo" || (!message.mode && demoMode)) ? "DEMO" : message.provider && message.model ? modelLabel(message.provider + ":" + message.model) : "AGENT"}</span> : message.kind === "request" ? <span className="badge"><Icon name="agent" className="h-2.5 w-2.5" />ASKED AGENT</span> : null}
                  <time dateTime={message.createdAt} className="text-[10px] text-muted">{humanTime(message.createdAt)}</time>
                  {workspace && can(workspace.role, "moderate") && <button className="ml-auto rounded px-1 text-[10px] text-muted hover:bg-hover hover:text-danger focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100" aria-label="Delete message" onClick={async () => { const r = await fetch("/api/workspaces/" + workspace.id + "/channels/" + room.id + "/messages/" + message.id, { method: "DELETE" }); if (!r.ok) setError((await r.json()).error); }}>Delete</button>}
                </div>
                <div className="markdown-body mt-1 text-[13px] text-ink"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={{ pre({ children }) { return <div className="relative"><pre className="pr-16">{children}</pre><button onClick={event => void navigator.clipboard.writeText(event.currentTarget.previousElementSibling?.textContent ?? "")} className="absolute right-2 top-2 rounded border border-line bg-white px-2 py-1 text-[10px] text-muted hover:text-ink">Copy</button></div>; } }}>{message.content}</ReactMarkdown></div>
              </div>
            </article>;
          })}
          {Object.entries(streaming).map(([jobId, content]) => <article key={jobId} className="flex animate-appear gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line bg-panel text-accent"><Icon name="agent" className="h-[18px] w-[18px]" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-[13px] font-semibold">{agentInfo[jobMeta[jobId]?.agent ?? "agent"].label} <span className="badge">{(jobModes[jobId] === "demo" || (!jobModes[jobId] && demoMode)) ? "DEMO" : jobMeta[jobId]?.provider && jobMeta[jobId]?.model ? modelLabel(jobMeta[jobId]!.provider + ":" + jobMeta[jobId]!.model) : "AGENT"}</span><span className="animate-pulse text-[10px] font-normal text-muted">writing…</span></div><div className="markdown-body mt-1 text-[13px]"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown><span className="ml-1 inline-block h-3 w-0.5 animate-pulse bg-accent align-middle" /></div></div></article>)}
          {typing.length > 0 && <p className="pl-12 text-[11px] text-muted">{typing.join(", ")} {typing.length === 1 ? "is" : "are"} typing…</p>}<div ref={bottomRef} />
          </div>}
        </div>
        <div className="shrink-0 bg-white px-4 pb-4 pt-2 sm:px-6 sm:pb-5"><div className="mx-auto max-w-3xl">
          {orderedJobs.filter(job => job.status === "running").map(job => <p key={job.id} role="status" className="mb-2 flex items-center gap-1.5 text-xs text-muted"><Icon name="agent" className="h-3 w-3" /><span className="animate-pulse">{agentInfo[job.agent ?? "agent"].label} is {job.agent === "muse" ? "reading the channel for" : "working on"} {job.requesterName}&apos;s request…</span></p>)}
          {askAgent && agentOptions.find(a => a.id === selectedAgent && !a.available) && <p className="mb-2 text-xs text-muted">{agentOptions.find(a => a.id === selectedAgent)?.label} is unavailable: {agentOptions.find(a => a.id === selectedAgent)?.reason}</p>}
          {readOnly && <p className="mb-2 text-xs text-muted">This channel is archived. Its conversation is read-only.</p>}
          <div className="rounded-lg border border-neutral-300 bg-white transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/5">
            <textarea disabled={readOnly} ref={composerRef} value={draft} onChange={event => { setDraft(event.target.value); sendTyping(Boolean(event.target.value)); }} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} rows={2} placeholder={askAgent ? "Ask " + (selectedAgent ? agentInfo[selectedAgent].label : "an agent") + " anything…" : "Message #" + room.name + " — mention @Muse, @Gemini or @Llama…"} aria-label="Message composer" className="max-h-40 min-h-[76px] w-full resize-y rounded-t-lg bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted focus-visible:outline-none" />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 px-2.5 py-2"><div className="flex min-w-0 flex-wrap items-center gap-1">
              <button onClick={() => setAskAgent(value => !value)} aria-pressed={askAgent} className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium ${askAgent ? "bg-accent/[.08] text-accent" : "text-muted hover:bg-hover hover:text-ink"}`}><Icon name="agent" className="h-3.5 w-3.5" />Ask agent</button>
              {askAgent && <select aria-label="AI agent" className="max-w-32 rounded border border-line bg-white px-1.5 py-1 text-[11px]" value={selectedAgent} onChange={e => { setSelectedAgent(e.target.value as AgentId); setSelectedModel(""); }}>{agentOptions.map(a => <option key={a.id} value={a.id} disabled={!a.available}>{a.label}{a.available ? "" : " (unavailable)"}</option>)}</select>}
              {askAgent && selectedAgent !== "muse" && <select aria-label="Approved AI model" className="max-w-40 rounded border border-line bg-white px-1.5 py-1 text-[11px]" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}><option value="">{selectedAgent ? "Default model" : "Model"}</option>{modelOptions.filter(m => selectedAgent && modelFits(selectedAgent, m.key)).map(m => <option key={m.key} value={m.key} disabled={!m.available}>{m.label}{m.available ? "" : " (unavailable)"}</option>)}</select>}
            </div><button onClick={send} disabled={readOnly || !draft.trim() || connection !== "connected"} aria-label={askAgent ? "Send request to agent" : "Send message"} className="btn-primary min-h-8 px-3 py-1.5 text-xs">Send<Icon name="send" className="h-3.5 w-3.5" /></button></div>
          </div>
          <div className="mt-2 flex justify-between gap-2 px-1 text-[10px] text-muted"><span>{askAgent ? "The agent's response is shared with everyone." : "Everyone in this channel can see your message."}</span><span className="hidden shrink-0 sm:block">Enter to send · Shift + Enter for newline</span></div>
          {error && <p role="status" className={`mt-2 text-xs ${error.includes("copied") ? "text-success" : "text-danger"}`}>{error}</p>}
        </div></div>
      </section>

      <aside id="workspace-details" aria-label="Artifacts and activity" className={`${panelState("files")} min-h-0 min-w-0 flex-col border-l border-line bg-white ${detailsOpen ? "lg:flex" : "lg:hidden"}`}>
        <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-line px-4"><div><h2 className="text-[13px] font-semibold">Shared artifacts <span className="ml-1 text-[11px] font-normal text-muted">{artifacts.length}</span></h2><p className="mt-1 text-[10px] text-muted">The work behind the conversation</p></div><div className="flex gap-1"><button onClick={() => { const id = crypto.randomUUID(); socketRef.current?.emit("artifact:save", { id, title: "Untitled document", type: "document", language: "markdown", content: "# New document\n\nWrite something together…", version: 0 }, (reply: { error?: string }) => { if (reply?.error) setSaveError(reply.error); else { setActiveArtifact(id); setStorage(`${storagePrefix}:artifact`, id); setEditMode(true); setEditVersion(1); setEditTitle("Untitled document"); setEditContent("# New document\n\nWrite something together…"); } }); }} aria-label="Create artifact" title="Create artifact" className="icon-button"><Icon name="plus" /></button><button onClick={() => setDetailsOpen(false)} aria-label="Close details sidebar" className="icon-button hidden lg:inline-flex"><Icon name="close" className="h-3.5 w-3.5" /></button></div></header>
        <div className="flex min-h-[180px] flex-1 flex-col">
          {artifacts.length > 0 && <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2">{artifacts.map(artifact => <button key={artifact.id} onClick={() => { setActiveArtifact(artifact.id); setStorage(`${storagePrefix}:artifact`, artifact.id); setEditMode(false); setSaveError(""); }} aria-pressed={activeArtifact === artifact.id} className={`flex max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2.5 py-2 text-[11px] ${activeArtifact === artifact.id ? "bg-hover font-medium text-ink" : "text-muted hover:bg-hover"}`}><Icon name={artifact.type === "code" ? "code" : "file"} className="h-3 w-3 shrink-0" /><span className="truncate">{artifact.title}</span></button>)}</div>}
          {!selected ? <div className="flex min-h-[180px] flex-1 flex-col items-center justify-center px-6 py-6 text-center"><span className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-panel text-muted"><Icon name="file" className="h-5 w-5" /></span><p className="mt-3 text-sm font-medium">A place for what you make</p><p className="mt-2 max-w-[220px] text-xs leading-5 text-muted">Keep documents and code alongside your conversation.</p><button onClick={() => { const id = crypto.randomUUID(); const initial = { title: "Untitled document", type: "document" as const, language: "markdown", content: "# New document\n\nWrite something together…", version: 0 }; socketRef.current?.emit("artifact:save", { ...initial, id }, (reply: { error?: string }) => { if (reply?.error) setSaveError(reply.error); else { setActiveArtifact(id); setStorage(`${storagePrefix}:artifact`, id); setEditMode(true); setEditVersion(1); setEditTitle(initial.title); setEditContent(initial.content); } }); }} className="btn mt-4"><Icon name="plus" className="h-3.5 w-3.5" />Create artifact</button></div> : <>
            <div className="shrink-0 space-y-2 border-b border-line px-4 py-3"><div className="min-w-0"><h3 className="truncate text-xs font-semibold">{selected.title}</h3><p className="mt-1 truncate text-[10px] text-muted">v{selected.version} · edited by {selected.updatedBy} · {humanTime(selected.updatedAt)}</p></div><div className="flex items-center gap-1.5">{editMode ? <><button onClick={() => setEditMode(false)} className="btn min-h-7 px-2 py-1 text-[10px]">Cancel</button><button onClick={() => saveArtifact()} className="btn-primary min-h-7 px-2 py-1 text-[10px]">Save</button></> : <button onClick={beginEdit} className="btn min-h-7 px-2 py-1 text-[10px]">Edit</button>}<button onClick={() => setShowHistory(value => !value)} aria-label="Show version history" aria-expanded={showHistory} className="btn min-h-7 px-2 py-1 text-[10px]"><Icon name="clock" className="h-3 w-3" />History</button></div></div>
            {saveError && <div role="alert" className="mx-3 my-2 rounded-md border border-danger/20 bg-red-50 p-3 text-xs text-danger">{saveError}{saveError.includes("changed while") && <div className="mt-2 flex gap-3"><button onClick={() => { setEditContent(selected.content); setEditTitle(selected.title); setEditVersion(selected.version); setSaveError(""); }} className="underline">Reload latest</button><button onClick={() => saveArtifact(true)} className="underline">Overwrite</button></div>}</div>}
            {showHistory && <div className="max-h-36 shrink-0 overflow-y-auto border-b border-line bg-panel px-4 py-2">{versions.filter(version => version.artifactId === selected.id).map(version => <div key={version.version} className="flex items-center justify-between gap-2 py-2 text-[11px] text-muted"><span className="truncate">Version {version.version} · {version.updatedBy}</span><button onClick={() => socketRef.current?.emit("artifact:restore", { artifactId: selected.id, version: version.version }, (reply: { error?: string }) => { if (reply?.error) setSaveError(reply.error); setShowHistory(false); })} className="text-accent">Restore</button></div>)}</div>}
            <div className="min-h-0 flex-1 overflow-auto">{selected.type === "code" ? editMode ? <><input aria-label="Artifact title" value={editTitle} onChange={event => setEditTitle(event.target.value)} className="field m-2 w-[calc(100%-1rem)] text-xs" /><Editor height="calc(100% - 58px)" language={selected.language} value={editContent} onChange={value => setEditContent(value ?? "")} theme="light" options={{ minimap: { enabled: false }, fontSize: 12, padding: { top: 12 }, scrollBeyondLastLine: false }} /></> : <Editor height="100%" language={selected.language} value={selected.content} theme="light" options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12, padding: { top: 12 }, scrollBeyondLastLine: false }} /> : editMode ? <div className="flex h-full flex-col gap-2 p-3"><input aria-label="Artifact title" value={editTitle} onChange={event => setEditTitle(event.target.value)} className="field mt-0 text-xs" /><textarea aria-label="Edit document markdown" value={editContent} onChange={event => setEditContent(event.target.value)} className="field mt-0 min-h-24 flex-1 resize-none font-mono text-xs leading-6" /></div> : <div className="markdown-body p-4 text-[13px]"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{selected.content}</ReactMarkdown></div>}</div>
          </>}
          {saveError && !selected && <p role="alert" className="px-4 py-2 text-xs text-danger">{saveError}</p>}
        </div>
        <div className="max-h-[42%] shrink-0 overflow-y-auto border-t border-line bg-panel">
          <section className="px-4 py-4"><h2 className="eyebrow mb-3 flex items-center gap-2"><Icon name="activity" className="h-3.5 w-3.5" />AI activity</h2><div className="flex items-center gap-2 text-xs"><span className={`h-1.5 w-1.5 rounded-full ${orderedJobs.some(job => job.status === "running") ? "animate-pulse bg-accent" : "bg-success"}`} /><span>{orderedJobs.some(job => job.status === "running") ? `Agent working · ${orderedJobs.find(job => job.status === "running")?.requesterName}` : orderedJobs.some(job => job.status === "queued") ? `Agent waiting · ${orderedJobs.filter(job => job.status === "queued").length} queued` : "Agent idle"}</span></div></section>
          <section className="border-t border-line px-4 py-4" data-testid="agent-queue"><div className="mb-3 flex items-center justify-between"><h2 className="eyebrow">Agent queue</h2><span className="badge">{orderedJobs.filter(job => job.status === "queued").length}</span></div>{orderedJobs.length === 0 ? <p className="text-[11px] text-muted">All caught up. No requests waiting.</p> : <div className="space-y-2">{orderedJobs.map(job => <div key={job.id} className="rounded-md border border-line bg-white p-3"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${job.status === "running" ? "animate-pulse bg-accent" : job.status === "failed" ? "bg-danger" : "bg-amber-600"}`} /><span className="text-[11px] font-medium">{job.status === "running" ? `Working · ${job.requesterName}` : job.status === "failed" ? "Request failed" : `#${orderedJobs.filter(item => item.status === "queued").findIndex(item => item.id === job.id) + 1} · ${job.requesterName}`}</span>{job.status === "failed" && <button aria-label="Retry request" onClick={() => retry(job)} className="ml-auto text-[11px] text-accent">Retry</button>}{job.status === "queued" && job.requesterId === memberId && <button aria-label="Cancel queued request" onClick={() => socketRef.current?.emit("agent:cancel", { jobId: job.id }, (reply: { error?: string }) => { if (reply?.error) setError(reply.error); })} className="ml-auto text-[11px] text-muted hover:text-danger">Cancel</button>}</div><p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted">{job.status === "failed" && job.error ? job.error : job.prompt}</p></div>)}</div>}</section>
          <details className="border-t border-line px-4 py-3"><summary className="flex cursor-pointer list-none items-center justify-between text-xs text-muted"><span className="flex items-center gap-2"><Icon name="people" className="h-3.5 w-3.5" />Online members<span className="text-success">{onlineCount}</span></span><Icon name="chevron" className="h-3 w-3" /></summary><div className="space-y-2 pt-3">{members.filter(member => member.online).map(member => <div key={member.id} className="flex items-center gap-2 text-xs"><span className="h-1.5 w-1.5 rounded-full bg-success" />{member.name}</div>)}{onlineCount === 0 && <p className="text-xs text-muted">No members online.</p>}</div></details>
        </div>
        <div className="shrink-0 border-t border-line px-4 py-2 text-[9px] text-muted">Edits are versioned · overwrites require confirmation</div>
      </aside>
    </div>
  </main>;
}
