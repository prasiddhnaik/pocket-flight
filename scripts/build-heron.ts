import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { backupSkinScene, skinBuildCommand } from "./f15c-skin-step";

const root = resolve(import.meta.dir, "..");
const bundled = resolve(root, "assets/heron/.venv/bin/python");
const python =
  process.env.HERON_PYTHON ?? (existsSync(bundled) ? bundled : "python3");
const blender = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const run = (command: string[]) => {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode) process.exit(result.exitCode);
};
for (const file of ["src/heron.py", "src/export_game.py", "checks/motion.py", "src/heron_wing_cells.py"])
  run([python, `assets/heron/${file}`]);
run([process.execPath, "scripts/prepare-heron.ts"]);
// The skin is rebuilt from this CAD, so keep the scene it replaces: it may hold hand sculpting.
backupSkinScene(resolve(root, "assets/heron-skin.blend"), resolve(root, "assets/heron/skin-backups"), Date.now());
run(skinBuildCommand(blender, "scripts/build-heron-skin.py"));
run([blender, "--background", "--python-exit-code", "1", "--python", "scripts/check-heron-skin.py"]);
for (const script of ["measure-heron.ts", "measure-heron-fuel.ts", "calibrate-heron-aero.ts"])
  run([process.execPath, `scripts/${script}`]);
