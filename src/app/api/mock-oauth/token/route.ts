import { exchangeMockOAuth } from "@/server/mock-oauth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export function POST(request: NextRequest) {
  return exchangeMockOAuth(request);
}
