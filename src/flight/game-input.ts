import * as T from "three";
import type { Controls } from "./physics";

export type TouchAxes = { pitch: number; roll: number; yaw: number };

/** The game actions and state that keyboard, pointer and focus events drive. */
export type InputHost = {
  keys: Set<string>;
  orbit: { x: number; y: number };
  readonly replayBusy: boolean;
  readonly mode: string;
  pause(): void;
  resume(): void;
  stopReplay(): void;
  cycleCamera(): void;
  restart(): void;
  toggleAudio(): void;
  toggleGear(): void;
  cycleFlaps(): void;
  adjustTrim(change: number): void;
  /** Window lost focus: release keys and held weapons, pause play. */
  blur(): void;
  /** Page visibility changed. */
  visibility(hidden: boolean): void;
};

const BROWSER_KEYS = new Set([
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space",
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "Tab",
]);

export function readControls(keys: Set<string>, touch: TouchAxes): Controls {
  const k = (...codes: string[]) => (codes.some((c) => keys.has(c)) ? 1 : 0);
  return {
    pitch: k("ArrowDown", "KeyS") - k("ArrowUp", "KeyW") + touch.pitch,
    roll: k("ArrowRight", "KeyD") - k("ArrowLeft", "KeyA") + touch.roll,
    yaw: k("KeyE") - k("KeyQ") + touch.yaw,
    throttle:
      k("ShiftLeft", "ShiftRight", "Equal") -
      k("ControlLeft", "ControlRight", "Minus"),
    brake: !!k("KeyB", "Space"),
  };
}

/** Owns the window and canvas listeners; right- or Alt-drag orbits the camera. */
export class GameInput {
  dragging = false;
  private lastPointer = { x: 0, y: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    private host: InputHost,
  ) {
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    canvas.addEventListener("pointerdown", this.pointerdown);
    window.addEventListener("pointermove", this.pointermove);
    window.addEventListener("pointerup", this.pointerup);
    canvas.addEventListener("contextmenu", this.contextmenu);
  }

  private keydown = (e: KeyboardEvent) => {
    const host = this.host;
    if (
      document.querySelector('[role="dialog"]') ||
      (e.target as HTMLElement)?.closest("input,textarea,select")
    )
      return;
    if (BROWSER_KEYS.has(e.code)) e.preventDefault();
    if (host.replayBusy) {
      if (e.code === "Escape" || e.code === "KeyP") host.stopReplay();
      return;
    }
    if (e.code === "BracketLeft") host.adjustTrim(-0.02);
    if (e.code === "BracketRight") host.adjustTrim(0.02);
    host.keys.add(e.code);
    if (e.repeat) return;
    if (e.code === "Escape" || e.code === "KeyP") {
      if (host.mode === "playing") host.pause();
      else if (host.mode === "paused") host.resume();
      else if (host.mode === "replay") host.stopReplay();
    }
    if (e.code === "KeyC") host.cycleCamera();
    if (e.code === "KeyR" && host.mode !== "menu") host.restart();
    if (e.code === "KeyM") host.toggleAudio();
    if (e.code === "KeyG") host.toggleGear();
    if (e.code === "KeyF") host.cycleFlaps();
  };
  private keyup = (e: KeyboardEvent) => {
    this.host.keys.delete(e.code);
  };
  private blur = () => this.host.blur();
  private visibility = () => this.host.visibility(document.hidden);
  private contextmenu = (e: Event) => e.preventDefault();
  private pointerdown = (e: PointerEvent) => {
    if (e.button === 2 || e.altKey) {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  };
  private pointermove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const orbit = this.host.orbit;
    orbit.x -= (e.clientX - this.lastPointer.x) * 0.005;
    orbit.y = T.MathUtils.clamp(
      orbit.y + (e.clientY - this.lastPointer.y) * 0.005,
      -0.8,
      1.1,
    );
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };
  private pointerup = () => {
    this.dragging = false;
  };

  dispose() {
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("pointermove", this.pointermove);
    window.removeEventListener("pointerup", this.pointerup);
    this.canvas.removeEventListener("pointerdown", this.pointerdown);
    this.canvas.removeEventListener("contextmenu", this.contextmenu);
  }
}
