import { execFileSync } from "node:child_process";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), true);
const git = (...args: string[]) => execFileSync("git", args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
const paths = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").toString("utf8").split("\0").filter(Boolean);
if (!paths.length) throw new Error("No staged files to scan.");
const names = ["AUTH_SECRET", "AUTH_GOOGLE_SECRET", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "WORKSPACE_CREDENTIAL_KEY"];
const secrets = names.map((name) => ({ name, value: process.env[name]?.trim() })).filter((s): s is { name: string; value: string } => Boolean(s.value && s.value.length >= 12));
const failures: string[] = [];
for (const file of paths) {
  if ((/(^|\/)\.env(?:\.|$)/i.test(file) && file !== ".env.example") ||
      /(^|\/)(?:data|uploads|user-data)\//i.test(file) ||
      /\.(?:sqlite3?|db)(?:[-.]|$)|\.(?:bak|backup|dump|pem|key|p12|pfx)$/i.test(file) ||
      /(^|\/)(?:credentials[^/]*|client_secret[^/]*)\.json$/i.test(file)) {
    failures.push(`${file}: prohibited secret/data path`); continue;
  }
  const content = git("show", `:${file}`);
  for (const secret of secrets) if (content.includes(Buffer.from(secret.value))) failures.push(`${file}: contains configured ${secret.name}`);
  const text = content.toString("utf8");
  const privateKey = "-----BEGIN " + "(?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----";
  if (new RegExp(privateKey).test(text) || content.subarray(0, 16).equals(Buffer.from("SQLite format 3\0"))) failures.push(`${file}: private key or SQLite content`);
  // Provider key formats, even if the key is absent from this machine's environment.
  if (/AIza[0-9A-Za-z_-]{35}|gsk_[0-9A-Za-z]{40,}|sk-(?:proj-|svcacct-)?[0-9A-Za-z_-]{40,}/.test(text)) failures.push(`${file}: probable provider credential`);
}
if (failures.length) throw new Error("Staged security scan failed:\n" + failures.join("\n"));
console.info(JSON.stringify({ event: "staged_security_scan_passed", files: paths.length, configuredSecretsChecked: secrets.map((s) => s.name) }));
