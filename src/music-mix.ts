export type MusicState = {
  mode: "menu" | "playing" | "paused" | "result" | "replay";
  speed: number;
  grounded: boolean;
  night: boolean;
  warning: boolean;
  visible: boolean;
};

export const musicDuration = Math.round(((64 * 4 * 60) / 92) * 44100) / 44100;
export const musicStems = ["foundation", "air", "pulse"] as const;

export function musicMix(state: MusicState) {
  const flying = state.mode === "playing" || state.mode === "replay";
  const speed = Number.isFinite(state.speed) ? Math.max(0, state.speed) : 0;
  const energy = Math.min(1, speed / 90);
  const duck = state.warning ? 0.4 : 1;
  const awake = state.visible ? 1 : 0;
  return {
    foundation: awake * duck * (state.mode === "paused" ? 0.52 : 0.86),
    air:
      awake *
      duck *
      (flying && !state.grounded
        ? 0.6 + energy * 0.35
        : state.mode === "result"
          ? 0.65
          : 0.18) *
      (state.night ? 0.65 : 1),
    pulse:
      awake *
      duck *
      (flying ? (state.grounded ? 0.28 : 0.42 + energy * 0.5) : 0) *
      (state.night ? 0.6 : 1),
    cutoff: state.night ? 3400 : 14000,
  };
}
