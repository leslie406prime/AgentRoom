import { exchangeMockOAuth } from "@/server/mock-oauth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return (await exchangeMockOAuth(request));
}
