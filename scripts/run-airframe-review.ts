import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const phase = process.argv[2] ?? "before";
if (!["before", "after"].includes(phase)) throw new Error("Choose before or after.");
const url = process.env.AIRFRAME_REVIEW_URL ?? "http://127.0.0.1:5178/output/airframe-review.html";
await Bun.write(`${root}output/airframe-review.html`, '<!doctype html><html><body style="margin:0"><canvas aria-label="Aircraft detail inspection"></canvas></body></html>');
async function command(args: string[]) {
  const child = Bun.spawn(["bun", "node_modules/.bin/playwright-cli", "-s=airframe-review", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(out + err);
  return out;
}
try {
  await command(["open", url]);
  const source = (await Bun.file(`${root}scripts/check-airframe-browser.js`).text()).trim().replace(/;$/, "").replaceAll("REVIEW_PHASE", phase);
  const out = await command(["run-code", source]);
  await Bun.write(`${root}output/airframe-${phase}-browser.log`, out);
  const result = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!result) throw new Error(`See output/airframe-${phase}-browser.log`);
  await Bun.write(`${root}output/airframe-${phase}-evidence.json`, JSON.stringify(JSON.parse(result[1]), null, 2));
  console.log(`Saved ${phase} fleet inspection and close-ups.`);
} finally {
  await command(["close"]);
}
