import Link from "next/link";

export default function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" aria-label="AgentRoom home" className="inline-flex shrink-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight text-ink">
    <span className="grid h-8 w-8 grid-cols-2 gap-[3px] rounded-lg bg-ink p-[7px]" aria-hidden="true"><i className="rounded-[2px] bg-white" /><i className="rounded-[2px] bg-white/60" /><i className="rounded-[2px] bg-white/60" /><i className="rounded-[2px] bg-[#b6aafa]" /></span>
    {!compact && <span>AgentRoom<span className="text-accent">.</span></span>}
  </Link>;
}
