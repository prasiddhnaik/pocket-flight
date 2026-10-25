import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const session = Bun.argv[2] === "aurelia" ? "aurelia-lab-model" : "wind-tunnel";
const cli = ["bun", "node_modules/.bin/playwright-cli", `-s=${session}`];
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
  if (code) throw new Error(`${args[0]} failed:\n${out}\n${err}`);
  return out;
}
try {
  const response = await fetch("http://127.0.0.1:5186/");
  if (!response.ok) throw new Error();
} catch {
  throw new Error(
    "Start the private lab with bun run lab:dev before running browser acceptance.",
  );
}
await command(["open", "http://127.0.0.1:5186/"]);
const profile = Bun.argv[2] === "profile";
const optimize = Bun.argv[2] === "optimization";
const chamber = Bun.argv[2] === "chamber";
const mechanics = Bun.argv[2] === "mechanics";
const cockpit = Bun.argv[2] === "cockpit";
const aurelia = Bun.argv[2] === "aurelia";
const checkFile = aurelia
  ? "check-aurelia-lab-browser.js"
  : profile
    ? "profile-wind-tunnel-browser.js"
    : optimize
      ? "check-lab-optimization-browser.js"
      : chamber
        ? "check-lab-chamber-browser.js"
        : mechanics
          ? "check-lab-mechanics-browser.js"
          : cockpit
            ? "check-finch-cockpit-browser.js"
            : "check-wind-tunnel-browser.js";
const output = await command([
  "run-code",
  (await Bun.file(new URL(`./${checkFile}`, import.meta.url)).text())
    .trim()
    .replace(/;$/, ""),
]);
const result = output.match(/### Result\n([\s\S]*?)\n### Ran/);
if (!result) throw new Error(`No acceptance evidence returned:\n${output}`);
const evidence = JSON.parse(result[1]);
await Bun.write(
  new URL(
    aurelia
      ? "../output/aurelia-lab-model/browser.json"
      : profile
        ? "../output/wind-tunnel-performance.json"
        : optimize
          ? "../output/wind-tunnel-optimization.json"
          : chamber
            ? "../output/premium-chamber-browser-evidence.json"
            : mechanics
              ? "../output/mechanics-browser-evidence.json"
              : cockpit
                ? "../output/finch-rebuild-browser.json"
                : "../output/wind-tunnel-browser-evidence.json",
    import.meta.url,
  ),
  JSON.stringify(evidence, null, 2),
);
console.log(
  profile
    ? `${evidence.results.length} aircraft performance profiles saved; ${evidence.errors.length} errors.`
    : `${evidence.checks.length} browser checks passed; ${evidence.errors.length} errors. Evidence saved under output/.`,
);
