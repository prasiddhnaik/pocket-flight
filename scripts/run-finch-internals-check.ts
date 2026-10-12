import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
async function command(args: string[]) {
  const child = Bun.spawn(
    [
      "bun",
      "node_modules/.bin/playwright-cli",
      "-s=finch-internal-check",
      ...args,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code || out.includes("### Error")) throw new Error(out + err);
  return out;
}
try {
  await command(["open", "http://127.0.0.1:5186/"]);
  const script = (
    await Bun.file(
      new URL("./check-finch-internals-browser.js", import.meta.url),
    ).text()
  )
    .trim()
    .replace(/;$/, "");
  const out = await command(["run-code", script]);
  const result = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!result) throw new Error(`No browser evidence returned:\n${out}`);
  const evidence = JSON.parse(result[1]);
  await Bun.write(
    new URL("../output/finch-internals-browser.json", import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.checks.length} internal-systems browser checks passed; ${evidence.errors.length} errors.`,
  );
} finally {
  await command(["close"]);
}
