import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const url = process.env.FLIGHT_CHECK_URL ?? "http://127.0.0.1:5175/";
async function command(args: string[]) {
  const p = Bun.spawn(
    ["bun", "node_modules/.bin/playwright-cli", "-s=fleet-dynamics", ...args],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code) throw new Error(out + err);
  return out;
}
if (!(await fetch(url)).ok) throw new Error(`Start the local game at ${url}.`);
try {
  await command(["open", url]);
  const out = await command([
    "run-code",
    (
      await Bun.file(
        new URL("check-fleet-dynamics-browser.js", import.meta.url),
      ).text()
    )
      .trim()
      .replace(/;$/, ""),
  ]);
  await Bun.write(`${root}output/fleet-dynamics-browser.log`, out);
  const match = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match)
    throw new Error(
      "Browser validation failed; see output/fleet-dynamics-browser.log",
    );
  const evidence = JSON.parse(match[1]);
  await Bun.write(
    `${root}output/fleet-dynamics-browser.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.results.length} keyboard departures and seeded landings passed; ${evidence.errors.length} browser errors.`,
  );
} finally {
  await command(["close"]);
}
