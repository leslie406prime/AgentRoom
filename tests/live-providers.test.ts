// Real network tests against Gemini and Groq. Skipped unless RUN_LIVE_AI_TESTS=true AND the provider key is present.
// Run with: npm run test:live  (each test sends one tiny request and uses a little free-tier quota).
import { describe, expect, it } from "vitest";
try { process.loadEnvFile(".env"); } catch { /* no .env file */ }
import { streamWithRecovery, verifyProvider, providerKey } from "../src/server/ai-providers";
import { catalog } from "../src/lib/ai-catalog";
const live = process.env.RUN_LIVE_AI_TESTS === "true";
async function collect(provider: "gemini" | "groq", model: string) {
  let text = "", usage: { input: number; output: number } | undefined;
  for await (const event of streamWithRecovery(provider, { apiKey: providerKey(provider)!, model, system: "Reply with exactly one short word.", user: "Say OK.", maxOutputTokens: 64 })) { if ("text" in event) text += event.text; else if ("usage" in event) usage = event.usage; }
  return { text, usage };
}
describe.skipIf(!live || !process.env.GEMINI_API_KEY)("live Gemini", () => {
  it("lists accessible models and streams a real response with usage", async () => {
    const listing = await verifyProvider("gemini", true); expect(listing.ok).toBe(true);
    console.info("Gemini catalog models accessible:", catalog.filter((m) => m.provider === "gemini").map((m) => `${m.id}=${listing.ok && listing.ids.includes(m.id)}`).join(", "));
    const model = catalog.find((m) => m.provider === "gemini" && listing.ok && listing.ids.includes(m.id)); expect(model).toBeTruthy();
    const { text, usage } = await collect("gemini", model!.id); expect(text.trim().length).toBeGreaterThan(0); expect(usage?.input).toBeGreaterThan(0);
  }, 60_000);
});
describe.skipIf(!live || !process.env.GROQ_API_KEY)("live Groq", () => {
  it("lists accessible models and streams a real response with usage", async () => {
    const listing = await verifyProvider("groq", true); expect(listing.ok).toBe(true);
    console.info("Groq catalog models accessible:", catalog.filter((m) => m.provider === "groq").map((m) => `${m.id}=${listing.ok && listing.ids.includes(m.id)}`).join(", "));
    const model = catalog.find((m) => m.provider === "groq" && listing.ok && listing.ids.includes(m.id)); expect(model).toBeTruthy();
    const { text, usage } = await collect("groq", model!.id); expect(text.trim().length).toBeGreaterThan(0); expect(usage?.input).toBeGreaterThan(0);
  }, 60_000);
});
