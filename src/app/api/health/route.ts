import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/server/db";

export const runtime = "nodejs";
export async function GET() {
  try {
    (await checkDatabaseHealth());
    return NextResponse.json({ status: "ok", demoMode: !process.env.OPENAI_API_KEY });
  } catch {
    console.error(JSON.stringify({ level: "error", event: "health_check_failed" }));
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
