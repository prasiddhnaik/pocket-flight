import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { otherAircraft } from "./fleet-attachment-model";

const output = `output/fleet-attachment-check/runs/${new Date().toISOString().replaceAll(":", "-")}`;
await mkdir(`${output}/before`, { recursive: true });
const hashes: Record<string, string> = {};
const files = [
  ...new Bun.Glob("{src,lab,scripts,tests}/**/*.{ts,tsx,py,json}").scanSync({
    onlyFiles: true,
  }),
  ...new Bun.Glob(
    "public/assets/{finch-u2*,peregrine-hx27*,stormbird-hx40*,aurelia-phenom300e*}",
  ).scanSync({ onlyFiles: true }),
];
for (const path of files)
  hashes[path] = createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
await Bun.write(
  `${output}/before/hashes.json`,
  JSON.stringify(hashes, null, 2),
);
let failed = false;
// Separate sequential processes release each aircraft's triangle trees before
// loading the next one, keeping the audit's memory footprint bounded.
for (const id of otherAircraft) {
  const audit = Bun.spawn(
    [
      "bun",
      "scripts/check-fleet-attachments.ts",
      "--aircraft",
      id,
      "--out",
      output,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (await audit.exited) failed = true;
  const lab = Bun.spawn(
    [
      "bun",
      "scripts/check-fleet-lab-attachments.ts",
      "--aircraft",
      id,
      "--out",
      output,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (await lab.exited) failed = true;
}
const tests = Bun.spawn(
  [
    "bun",
    "test",
    "--timeout",
    "30000",
    "./tests/fleet-attachments.test.ts",
    "./tests/aurelia-attachments.test.ts",
  ],
  { stdout: "pipe", stderr: "pipe" },
);
const [out, err, code] = await Promise.all([
  new Response(tests.stdout).text(),
  new Response(tests.stderr).text(),
  tests.exited,
]);
await Bun.write(`${output}/checker-tests.log`, out + err);
if (code) process.exit(code);
const navigation = Bun.spawn(["bun", "run", "repo:check"], {
  stdout: "inherit",
  stderr: "inherit",
});
if (await navigation.exited) process.exit(2);
const report = Bun.spawn(
  ["bun", "scripts/write-fleet-attachment-report.ts", "--out", output],
  {
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (await report.exited) process.exit(2);
process.exitCode = failed ? 1 : 0;
