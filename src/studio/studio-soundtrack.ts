import type { StudioAsset } from "./studio-assets";
import type { StudioScene } from "./studio-scene";
type PlayingSound = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  offset: number;
  started: number;
  signature: string;
};
export class StudioSoundtrack {
  private context: AudioContext | null = null;
  private capture: MediaStreamAudioDestinationNode | null = null;
  private engine: MediaStreamTrack | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private playing = new Map<string, PlayingSound>();
  start(engine: () => MediaStreamTrack | null) {
    this.context ??= new AudioContext();
    this.capture ??= this.context.createMediaStreamDestination();
    if (!this.engine) {
      this.engine = engine();
      if (this.engine)
        this.context
          .createMediaStreamSource(new MediaStream([this.engine]))
          .connect(this.capture);
    }
    void this.context.resume();
  }
  async prepare(
    scene: StudioScene | undefined,
    assets: Map<string, StudioAsset>,
  ) {
    const audioAssets = (scene?.sounds ?? []).map((layer) =>
      assets.get(layer.assetId),
    );
    for (const asset of audioAssets) {
      if (!asset || asset.kind !== "audio")
        throw new Error("A soundtrack asset is missing.");
      if (this.buffers.has(asset.id)) continue;
      this.context ??= new AudioContext();
      this.capture ??= this.context.createMediaStreamDestination();
      const buffer = await this.context.decodeAudioData(
        asset.files[0].data.slice(0),
      );
      this.buffers.set(asset.id, buffer);
      asset.duration = buffer.duration;
    }
  }
  captureTrack() {
    return this.capture?.stream.getAudioTracks()[0]?.clone() ?? null;
  }
  update(
    scene: StudioScene | undefined,
    time: number,
    duration: number,
    running: boolean,
  ) {
    const ctx = this.context;
    if (!ctx) return;
    const active = new Set<string>();
    if (running)
      for (const layer of scene?.sounds ?? []) {
        const buffer = this.buffers.get(layer.assetId);
        if (!buffer) continue;
        const end = Math.min(layer.end ?? duration, duration),
          elapsed = time - layer.start,
          sourceTime = layer.offset + elapsed;
        if (
          elapsed < 0 ||
          time >= end ||
          (!layer.loop && sourceTime >= buffer.duration)
        )
          continue;
        active.add(layer.id);
        const offset = layer.loop ? sourceTime % buffer.duration : sourceTime;
        const signature = `${layer.assetId}:${layer.start}:${layer.offset}:${layer.loop}`;
        let sound = this.playing.get(layer.id);
        if (
          sound &&
          (sound.signature !== signature ||
            Math.abs(
              sound.offset + ctx.currentTime - sound.started - sourceTime,
            ) > 0.3)
        ) {
          this.stop(layer.id);
          sound = undefined;
        }
        if (!sound) {
          const source = ctx.createBufferSource(),
            gain = ctx.createGain();
          source.buffer = buffer;
          source.loop = layer.loop;
          gain.gain.value = 0;
          source.connect(gain);
          gain.connect(ctx.destination);
          gain.connect(this.capture!);
          source.start(0, Math.max(0, offset));
          sound = {
            source,
            gain,
            offset: sourceTime,
            started: ctx.currentTime,
            signature,
          };
          this.playing.set(layer.id, sound);
        }
        const fadeIn = layer.fadeIn ? Math.min(1, elapsed / layer.fadeIn) : 1,
          fadeOut = layer.fadeOut
            ? Math.min(1, (end - time) / layer.fadeOut)
            : 1;
        sound.gain.gain.setTargetAtTime(
          layer.volume * Math.max(0, Math.min(fadeIn, fadeOut)),
          ctx.currentTime,
          0.015,
        );
      }
    for (const id of this.playing.keys()) if (!active.has(id)) this.stop(id);
  }
  private stop(id: string) {
    const sound = this.playing.get(id);
    if (sound) {
      sound.source.stop();
      sound.source.disconnect();
      sound.gain.disconnect();
      this.playing.delete(id);
    }
  }
  pause() {
    for (const id of this.playing.keys()) this.stop(id);
  }
  dispose() {
    this.pause();
    this.engine?.stop();
    void this.context?.close();
    this.buffers.clear();
  }
}
