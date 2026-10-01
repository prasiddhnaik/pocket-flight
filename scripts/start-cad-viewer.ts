import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const bundled = resolve(root, "../.venv-cad312/bin/python");
const python =
  process.env.STORMBIRD_PYTHON ?? (existsSync(bundled) ? bundled : "python3");
const log = resolve(tmpdir(), `pocket-flight-cad-viewer-${process.pid}.log`);
const output = openSync(log, "w");
// A separate process group and log file keep the viewer alive after this launcher exits.
const child = spawn(
  python,
  ["-m", "cadgen.cli", "viewer", "--host", "127.0.0.1", "--json"],
  {
    cwd: resolve(root, "assets/stormbird"),
    detached: true,
    stdio: ["ignore", output, output],
  },
);
closeSync(output);
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.unref();
for (let attempt = 0; attempt < 100; attempt++) {
  const text = readFileSync(log, "utf8");
  const line = text.split("\n").find((line) => line.startsWith('{"url":'));
  if (line) {
    const viewer = JSON.parse(line) as { url: string; action: string };
    const response = await fetch(viewer.url, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    if (response?.ok) {
      console.log(
        JSON.stringify({
          ...viewer,
          modelUrl: `${viewer.url}?file=STEP%2FStormbird-HX40.step`,
          log,
        }),
      );
      process.exit(0);
    }
  }
  if (child.exitCode !== null && child.exitCode !== 0)
    throw new Error(text || `Viewer exited ${child.exitCode}`);
  await Bun.sleep(100);
}
throw new Error(`Viewer did not become available; see ${log}`);
