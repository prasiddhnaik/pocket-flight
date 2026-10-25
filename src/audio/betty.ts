import type { FlightAudio } from "./audio";
import { warningOrder, type WarningId } from "../hud/warnings";

export const repeatSeconds: Record<WarningId, number | null> = {
  pullUp: 2, stall: 2, overspeed: 3, landingGear: 3, bankAngle: 3, bingoFuel: null, damage: null, fuelLow: null,
};
export const bettyFiles: Record<WarningId | "chime", string> = {
  pullUp: "pull-up", stall: "stall", overspeed: "overspeed", landingGear: "landing-gear",
  bankAngle: "bank-angle", bingoFuel: "bingo-fuel", damage: "damage", fuelLow: "fuel-low", chime: "chime",
};
export const CHIME_SECONDS = 0.4;

export type CalloutState = {
  playing: WarningId | null;
  busyUntil: number;
  lastStarted: Partial<Record<WarningId, number>>;
  announced: WarningId[];
};
export const idleCallouts = (): CalloutState => ({ playing: null, busyUntil: 0, lastStarted: {}, announced: [] });

const rank = (id: WarningId) => warningOrder.indexOf(id);

export function planCallout(state: CalloutState, active: WarningId[], now: number, durationOf: (id: WarningId) => number) {
  const next: CalloutState = {
    ...state,
    lastStarted: { ...state.lastStarted },
    announced: state.announced.filter((id) => active.includes(id)),
  };
  const busy = next.playing !== null && now < next.busyUntil;
  if (!active.length) {
    const stop = next.playing !== null;
    next.playing = null;
    return { callout: null, stop, state: next };
  }
  const top = active.find((id) => {
    const repeat = repeatSeconds[id];
    return !next.announced.includes(id) || (repeat !== null && now - (next.lastStarted[id] ?? -Infinity) >= repeat);
  });
  if (!top) return { callout: null, stop: false, state: next };
  if (busy && rank(next.playing!) <= rank(top)) return { callout: null, stop: false, state: next };
  const fresh = !next.announced.includes(top);
  next.playing = top;
  next.busyUntil = now + durationOf(top) + (fresh ? CHIME_SECONDS : 0);
  next.lastStarted[top] = now;
  if (fresh) next.announced.push(top);
  return { callout: { id: top, chime: fresh }, stop: busy, state: next };
}

export class Betty {
  enabled = true;
  private state = idleCallouts();
  private buffers = new Map<WarningId | "chime", AudioBuffer>();
  private loading = false;
  constructor(private audio: FlightAudio, private base = "/audio/betty/") {}

  private preload() {
    if (this.loading) return;
    this.loading = true;
    const files = Object.entries(bettyFiles) as [WarningId | "chime", string][];
    void Promise.all(files.map(([id, file]) => this.audio.loadVoice(`${this.base}${file}.mp3`).then((b) => b && this.buffers.set(id, b))))
      .then(() => { if (!this.buffers.size) this.loading = false; });
  }

  update(active: WarningId[], now: number) {
    this.preload();
    const audible = this.enabled && this.audio.enabled ? active.filter((id) => this.buffers.has(id)) : [];
    const r = planCallout(this.state, audible, now, (id) => this.buffers.get(id)?.duration ?? 1.4);
    this.state = r.state;
    if (r.stop) this.audio.stopVoice();
    if (!r.callout) return;
    const voice = this.buffers.get(r.callout.id);
    const chime = r.callout.chime ? this.buffers.get("chime") : undefined;
    const clips = [chime, voice].filter((b): b is AudioBuffer => !!b);
    if (clips.length) this.audio.playVoice(clips);
  }

  silence() {
    this.state = idleCallouts();
    this.audio.stopVoice();
  }
}
