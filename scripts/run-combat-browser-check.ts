// Start Vite on 5299, then: bun scripts/run-combat-browser-check.ts
// This runner closes its own browser session even when an assertion fails.
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.POCKET_FLIGHT_BASE_URL ?? "http://127.0.0.1:5299/";
async function command(args: string[]) {
  const child = Bun.spawn(
    ["bun", "node_modules/.bin/playwright-cli", "-s=combat-check", ...args],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(out + err);
  return out;
}
if (!(await fetch(url)).ok) throw new Error(`Start the game on ${url}`);
try {
  await command(["open", url]);
  const source = await Bun.file(
    new URL("check-combat-browser.js", import.meta.url),
  ).text();
  const out = await command(["run-code", source.trim().replace(/;$/, "")]);
  await Bun.write(
    new URL("../output/combat-check/browser.log", import.meta.url),
    out,
  );
  const match = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match) throw new Error(out);
  const result: unknown = JSON.parse(match[1]);
  await Bun.write(
    new URL("../output/combat-check/browser-evidence.json", import.meta.url),
    JSON.stringify(result, null, 2),
  );
  console.log(
    "Combat entry, gun/rocket/missile hits, fleet entry and free-flight isolation passed. See output/combat-check/browser-evidence.json.",
  );
} finally {
  await command(["close"]);
}
