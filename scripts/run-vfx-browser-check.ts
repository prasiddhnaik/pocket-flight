import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
async function command(args: string[]) {
  const child = Bun.spawn(
    ["bun", "node_modules/.bin/playwright-cli", "-s=vfx-check", ...args],
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
if (!(await fetch("http://127.0.0.1:5175/")).ok)
  throw new Error("Start the game on port 5175.");
try {
  await command(["open", "http://127.0.0.1:5175/"]);
  const out = await command([
    "run-code",
    (await Bun.file(new URL("check-vfx-browser.js", import.meta.url)).text())
      .trim()
      .replace(/;$/, ""),
  ]);
  await Bun.write(new URL("../output/vfx-browser.log", import.meta.url), out);
  const match = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match) throw new Error("VFX check failed; see output/vfx-browser.log");
  const evidence = JSON.parse(match[1]);
  await Bun.write(
    new URL("../output/vfx-browser-evidence.json", import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.results.length} aircraft passed touchdown, smoke and impact checks; ${evidence.errors.length} browser errors.`,
  );
} finally {
  await command(["close"]);
}
