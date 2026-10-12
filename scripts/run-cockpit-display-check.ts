import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const labOnly = Bun.argv[2] === "lab";
async function command(args: string[]) {
  const child = Bun.spawn(
    ["bun", "node_modules/.bin/playwright-cli", "-s=display-check", ...args],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
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
  const script = await Bun.file(
    new URL("./check-cockpit-displays-browser.js", import.meta.url),
  ).text();
  const out = await command([
    "run-code",
    `async(page) => await (${script.trim().replace(/;$/, "")})(page, ${labOnly})`,
  ]);
  const match = out.match(/### Result\n([\s\S]*?)\n### Ran/);
  if (!match) throw new Error(`No browser acceptance result:\n${out}`);
  const evidence = JSON.parse(match[1]);
  await Bun.write(
    new URL(
      labOnly
        ? "../output/cockpit-displays-lab.json"
        : "../output/cockpit-displays-browser.json",
      import.meta.url,
    ),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    `${evidence.checks.length} cockpit display checks passed; ${evidence.errors.length} browser errors. Evidence: output/cockpit-displays-browser.json`,
  );
} finally {
  await command(["close"]);
}
