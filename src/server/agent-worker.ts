import { jobAI, reserveUsage } from "./ai-repository";
import type { Server } from "socket.io";
import { ArtifactOutput } from "./queue";
import { persistAgentResponse, saveWorkerArtifact, hasAgentResponse } from "./collaboration-repository";
import type { AgentJob } from "./collaboration-types";
import { ArtifactStreamFilter, channelArtifacts, channelTranscript, extractArtifacts, systemPrompt, userPrompt } from "./muse";
import { ProviderError, streamWithRecovery } from "./ai-providers";
import { agentInfo } from "../lib/ai-catalog";
import { agentFailureDiagnostic, traceAgentError, type AgentTrace } from "./job-errors";

const demoReply = `Here’s a practical way to get started:\n\n1. **Agree on the outcome** — define what success looks like.\n2. **Build a small first version** — keep the feedback loop short.\n3. **Review together** — I’ll help refine it as we go.\n\nI’ve added a small starter artifact to the shared workspace.`;

export async function runAgent(job: AgentJob, io: Server) {
  const trace: AgentTrace = { stage: "deduplicate", startedAt: Date.now() };
  try { await executeAgent(job, io, trace); }
  catch (error) { throw traceAgentError(error, trace); }
}

async function executeAgent(job: AgentJob, io: Server, trace: AgentTrace) {
  if (hasAgentResponse(job)) return;
  trace.stage = "model_selection";
  const config = jobAI(job), muse = config.agent === "muse";
  trace.provider = config.provider; trace.model = config.model; trace.maxOutputTokens = config.maxOutputTokens;
  trace.stage = "context";
  const { room, transcript, omitted } = channelTranscript(job, muse ? { maxMessages: 300, maxChars: 30000, timestamps: true } : { maxMessages: 50, maxChars: 12000, timestamps: false });
  const system = systemPrompt(config.agent, { channel: room.name, requester: job.requester_name, now: new Date().toISOString(), artifactTool: config.provider === "openai" });
  let user = userPrompt({ transcript, omitted, requester: job.requester_name, prompt: job.prompt });
  if (muse) { const shared = channelArtifacts(job.room_id); if (shared.length) user = `Shared artifacts in this channel (most recent first):\n${shared.map((a) => `- "${a.title}" v${a.version}:\n${a.content.slice(0, 1500)}`).join("\n")}\n\n${user}`; }
  trace.inputChars = system.length + user.length;
  trace.stage = "usage_reservation";
  reserveUsage(job, config, Buffer.byteLength(system + user) + 2048);
  const meta = { agent: config.agent, provider: config.provider, model: config.modelKey ? config.model : null };
  const label = agentInfo[config.agent].label;
  const emit = (token: string) => { if (token) io.to(job.room_id).emit("agent:token", { jobId: job.id, mode: config.mode, token, ...meta }); };
  let usage: { prompt_tokens: number; completion_tokens: number } | undefined = config.mode === "demo" ? { prompt_tokens: 0, completion_tokens: 0 } : undefined;
  let response = "";

  if (!config.provider || !config.key) {
    // Explicit local demo mode: no provider is configured, so the reply is a fixed sample and is labeled DEMO in the UI.
    response = demoReply;
    const demoArtifact = ArtifactOutput.parse({ title: "Starter example", type: "code", language: "typescript", content: "type RoomMessage = {\n  author: string;\n  content: string;\n  createdAt: Date;\n};\n\nexport function formatMessage(message: RoomMessage) {\n  return `${message.author}: ${message.content}`;\n}\n" });
    for (let i = 0; i < response.length; i += 5) { await new Promise((resolve) => setTimeout(resolve, 75)); emit(response.slice(i, i + 5)); }
    io.to(job.room_id).emit("room:event", saveWorkerArtifact(job.room_id, demoArtifact, label));
  } else {
    trace.stage = "provider";
    const filter = config.provider === "openai" ? null : new ArtifactStreamFilter();
    let raw = "", artifactArgs = "", interrupted = false;
    try {
      for await (const event of streamWithRecovery(config.provider, { apiKey: config.key, model: config.model, system, user, maxOutputTokens: config.maxOutputTokens, jobId: job.id, openaiOptions: { workspaceKey: config.mode === "workspace" } })) {
        if ("text" in event) { raw += event.text; emit(filter ? filter.push(event.text) : event.text); }
        else if ("usage" in event) usage = { prompt_tokens: event.usage.input, completion_tokens: event.usage.output };
        else artifactArgs += event.artifactArgs;
      }
    } catch (error) {
      if (!raw || !(error as { partial?: boolean }).partial) throw error;
      interrupted = true; // keep what the provider already produced instead of discarding it
      console.warn(JSON.stringify({ level: "warn", event: "agent_stream_interrupted", roomId: job.room_id, jobId: job.id, provider: config.provider, ...agentFailureDiagnostic(traceAgentError(error, trace)) }));
    }
    if (filter) emit(filter.flush());
    let artifacts: ReturnType<typeof ArtifactOutput.parse>[] = [];
    if (filter) ({ text: response, artifacts } = extractArtifacts(raw));
    else {
      response = raw;
      if (artifactArgs) { try { const output = ArtifactOutput.safeParse(JSON.parse(artifactArgs)); if (output.success) artifacts = [output.data]; } catch { /* invalid tool arguments are ignored below */ } if (!artifacts.length) console.warn(JSON.stringify({ level: "warn", event: "invalid_agent_artifact", roomId: job.room_id, jobId: job.id })); }
      if (!response.trim()) response = "I wasn't able to generate a response. Please try asking again.";
    }
    if (!response.trim() && !artifacts.length) throw new ProviderError(`${agentInfo[config.agent].label} received an empty response from the model. Please retry.`, "unknown");
    if (interrupted) response += "\n\n_(The model connection was interrupted; this response may be incomplete.)_";
    trace.stage = "artifact_persistence";
    for (const artifact of artifacts) io.to(job.room_id).emit("room:event", saveWorkerArtifact(job.room_id, artifact, label));
    if (!response.trim()) response = "_Saved the shared artifact above._";
  }

  trace.stage = "message_persistence";
  const event = persistAgentResponse(job, response, config.mode, usage, meta);
  io.to(job.room_id).emit("room:event", event);
  io.to(job.room_id).emit("agent:done", { jobId: job.id });
}
