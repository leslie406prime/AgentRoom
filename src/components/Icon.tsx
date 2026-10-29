import type { ReactNode } from "react";

const paths = {
  hash: <path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  send: <path d="M12 19V5m-6 6 6-6 6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
  agent: <><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6M1 11v5m22-5v5" /></>,
  settings: <><path d="m10 3-.5 2-2 .9-1.9-.6-2 3.4L5 10v3l-1.4 1.3 2 3.4 1.9-.6 2 .9.5 3h4l.5-3 2-.9 1.9.6 2-3.4L19 13v-3l1.4-1.3-2-3.4-1.9.6-2-.9L14 3Z" /><circle cx="12" cy="12" r="3" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  link: <><path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)" /></>,
  logout: <path d="M9 4H5v16h4m5-12 4 4-4 4m-5-4h12" />,
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1v-9A8.5 8.5 0 0 1 11.5 3h1A8.5 8.5 0 0 1 21 11.5Z" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-5" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  google: <path d="M20.5 12.2c0-.7-.1-1.4-.2-2.1H12v4h4.8a4.2 4.2 0 0 1-1.8 2.8 5.5 5.5 0 0 1-8.2-3.3 5.5 5.5 0 0 1 8.4-6.1l3-3A9.8 9.8 0 1 0 21 12.2" />,
} satisfies Record<string, ReactNode>;

export default function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof paths; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
