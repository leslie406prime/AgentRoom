import { mockOAuthUserInfo } from "@/server/mock-oauth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return mockOAuthUserInfo(request);
}
