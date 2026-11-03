import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";

// Guards for the last stage of a CAD rebuild, where Blender regenerates the skin.
/** Blender exits 0 when a script raises unless it is told otherwise. */
export function skinBuildCommand(blender: string, script: string) {
  return [blender, "--background", "--python-exit-code", "1", "--python", script];
}

/** Keeps the scene a rebuild is about to replace, since it may hold hand sculpting. */
export function backupSkinScene(blend: string, folder: string, stamp: number) {
  if (!existsSync(blend)) return null;
  mkdirSync(folder, { recursive: true });
  const copy = join(folder, `${stamp}-${basename(blend)}`);
  copyFileSync(blend, copy);
  return copy;
}

/** The flight numbers no longer follow the CAD wing; unfreezing them is a deliberate act. */
export function frozenFlightGeometry<T>(current: T, measured: T, unfreeze = false) {
  return unfreeze ? measured : current;
}
