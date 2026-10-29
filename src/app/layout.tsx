import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentRoom — Think together",
  description: "A shared workspace for people and one helpful AI agent.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
