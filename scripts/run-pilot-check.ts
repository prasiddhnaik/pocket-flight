// Start Vite on 5299, then: bun scripts/run-pilot-check.ts finch heron f15c peregrine stormbird aurelia
// Screenshots go to output/pilot-check. This runner closes its own browser session.
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.POCKET_FLIGHT_BASE_URL ?? "http://127.0.0.1:5299/";
async function command(args: string[]) {
  const child = Bun.spawn(["bun", "node_modules/.bin/playwright-cli", "-s=pilot-check", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(out + err);
  return out;
}
if (!(await fetch(url)).ok) throw new Error(`Start the game on ${url}`);
const source = await Bun.file(new URL("check-pilot-browser.js", import.meta.url)).text();
try {
  await command(["open", url]);
  for (const id of process.argv.slice(2)) {
    const out = await command(["run-code", source.trim().replace(/;$/, "").replace("__AIRCRAFT__", id)]);
    await Bun.write(new URL(`../output/pilot-check/${id}.log`, import.meta.url), out);
    console.log(out.match(/### Result\n([\s\S]*?)\n### Ran/)?.[1] ?? out.slice(0, 800));
  }
} finally {
  await command(["close"]).catch(() => {});
}
