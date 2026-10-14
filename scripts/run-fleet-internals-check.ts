import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
async function command(args: string[]) {
  const p = Bun.spawn(
    [
      "bun",
      "node_modules/.bin/playwright-cli",
      "-s=fleet-internal-check",
      ...args,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code || out.includes("### Error")) throw Error(out + err);
  return out;
}
try {
  await command(["open", process.env.LAB_TEST_URL ?? "http://127.0.0.1:5186/"]);
  const source = (
    await Bun.file(
      new URL("./check-fleet-internals-browser.js", import.meta.url),
    ).text()
  )
    .trim()
    .replace(/;$/, "");
  const output = await command(["run-code", source]);
  const result = output.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!result) throw Error(output);
  const evidence = JSON.parse(result[1]);
  await Bun.write(
    new URL("../output/fleet-internals-browser.json", import.meta.url),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.checks.length} browser checks passed; ${evidence.errors.length} errors.`,
  );
} finally {
  await command(["close"]);
}
