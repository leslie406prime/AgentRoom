// Opt-in Node preload for isolated browser tests. Never imported by application code.
import path from "node:path";
if (process.env.AGENTROOM_MOCK_AI !== "true" || process.env.AUTH_MOCK_OAUTH_ENABLED !== "true" ||
    process.env.NODE_ENV !== "development" || !process.env.DATABASE_PATH ||
    !path.basename(process.env.DATABASE_PATH).startsWith("agentroom-ui-e2e-")) {
  throw new Error("Mock providers require an isolated development browser-test database.");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["generativelanguage.googleapis.com", "api.groq.com"].includes(url.hostname)) return originalFetch(input, init);
  const body = JSON.parse(String(init?.body ?? (input instanceof Request ? await input.clone().text() : "{}")));
  const gemini = url.hostname === "generativelanguage.googleapis.com";
  const prompt = gemini ? body.contents?.[0]?.parts?.[0]?.text ?? "" : body.messages?.at(-1)?.content ?? "";
  const model = gemini ? /models\/([^:]+)/.exec(url.pathname)?.[1] : body.model;
  if (!model) throw new Error("Browser fixture received unexpected provider request.");
  const latest = prompt.split(" asks: ").at(-1) ?? "";
  if (latest.includes("TEST_QUOTA")) return Response.json({error:{message:"Test quota reached",code:429,status:"RESOURCE_EXHAUSTED"}},{status:429,headers:{"retry-after":"60"}});
  if (latest.includes("TEST_SERVICE")) return Response.json({error:{message:"Test service unavailable",code:503,status:"UNAVAILABLE"}},{status:503});
  const text = "Mock provider response: " + (gemini ? "gemini" : "groq") + " / " + model + " / " + latest;
  const chunks = gemini ? [{candidates:[{content:{parts:[{text}],role:"model"},finishReason:"STOP"}],usageMetadata:{promptTokenCount:20,candidatesTokenCount:10,totalTokenCount:30}}] : [
    {id:"test-completion",object:"chat.completion.chunk",choices:[{index:0,delta:{content:text},finish_reason:null}]},
    {id:"test-completion",object:"chat.completion.chunk",choices:[],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}},
  ];
  return new Response(chunks.map(chunk=>"data: "+JSON.stringify(chunk)+"\n\n").join("")+(gemini?"":"data: [DONE]\n\n"),{headers:{"content-type":"text/event-stream"}});
};
