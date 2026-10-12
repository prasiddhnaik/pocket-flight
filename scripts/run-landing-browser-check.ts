import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = ["bun", "node_modules/.bin/playwright-cli", "-s=landing-check"];
async function command(args: string[]) {
  const child = Bun.spawn([...cli, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code) throw new Error(out + err);
  return out;
}
const url = "http://127.0.0.1:5175/";
if (!(await fetch(url)).ok)
  throw new Error("Start the game on port 5175 before checking landings.");
try {
  await command(["open", url]);
  const out = await command([
    "run-code",
    (await Bun.file(new URL("check-landing-browser.js", import.meta.url)).text())
      .trim().replace(/;$/, ""),
  ]);
  await Bun.write(
    new URL("../output/landing-browser.log", import.meta.url),
    out,
  );
  const match = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match)
    throw new Error("Landing checks failed; see output/landing-browser.log");
  const evidence = JSON.parse(match[1]);
  await Bun.write(
    new URL("../output/landing-browser-evidence.json", import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.results.length} live-game landing checks passed; ${evidence.errors.length} browser errors.`,
  );
} finally {
  await command(["close"]);
}
