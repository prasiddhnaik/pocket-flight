import { fileURLToPath } from "node:url";
const check = process.argv[2] ?? "vfx";
if (!["vfx", "takeoff", "wing"].includes(check))
  throw new Error("Choose vfx, takeoff or wing.");
const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.FLIGHT_CHECK_URL ?? "http://127.0.0.1:5175/";
async function command(args: string[]) {
  const child = Bun.spawn(
    ["bun", "node_modules/.bin/playwright-cli", `-s=${check}-check`, ...args],
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
if (!(await fetch(url)).ok) throw new Error(`Start the game at ${url}.`);
try {
  await command(["open", url]);
  const out = await command([
    "run-code",
    (
      await Bun.file(
        new URL(`check-${check}-browser.js`, import.meta.url),
      ).text()
    )
      .trim()
      .replace(/;$/, ""),
  ]);
  await Bun.write(
    new URL(`../output/${check}-browser.log`, import.meta.url),
    out,
  );
  const match = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match)
    throw new Error(`${check} check failed; see output/${check}-browser.log`);
  const evidence = JSON.parse(match[1]);
  await Bun.write(
    new URL(`../output/${check}-browser-evidence.json`, import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.results.length} aircraft passed ${check} browser checks; ${evidence.errors.length} browser errors.`,
  );
} finally {
  await command(["close"]);
}
