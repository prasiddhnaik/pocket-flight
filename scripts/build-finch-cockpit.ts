import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const child = Bun.spawn(
  [
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "--background",
    "--factory-startup",
    "--python",
    "scripts/build-finch-cockpit.py",
  ],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
);
const [out, err, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
await Bun.write(
  new URL("../output/finch-cockpit-model.log", import.meta.url),
  out + err,
);
// Blender may return zero for a Python exception; require its success marker.
if (code || !out.includes("FINCH_COCKPIT_REBUILT"))
  throw new Error(
    "Cockpit rebuild failed; inspect output/finch-cockpit-model.log",
  );
const native = Bun.spawn(
  [
    "/Applications/Blender.app/Contents/MacOS/Blender",
    "--background",
    "--factory-startup",
    "--python",
    "scripts/validate-finch-cockpit.py",
  ],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
);
const [nativeOut, nativeErr, nativeCode] = await Promise.all([
  new Response(native.stdout).text(),
  new Response(native.stderr).text(),
  native.exited,
]);
await Bun.write(
  new URL("../output/finch-cockpit-native.log", import.meta.url),
  nativeOut + nativeErr,
);
if (nativeCode || !nativeOut.includes("FINCH_NATIVE_REOPEN_OK"))
  throw new Error("Saved cockpit failed its independent native reopen check");
for (const script of ["measure-finch.ts", "measure-fleet.ts"]) {
  const measured = Bun.spawn(["bun", `scripts/${script}`, "--save"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await measured.exited) throw new Error(`Failed ${script}`);
}
console.log("Finch cockpit saved, validated, exported and remeasured.");
