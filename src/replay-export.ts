export type ExportState = {
  phase: "idle" | "recording" | "finishing" | "ready" | "error";
  url?: string;
  filename?: string;
  message?: string;
};
export function replayMimeType(supports: (mime: string) => boolean) {
  return [
    "video/mp4;codecs=avc1.424028,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find(supports);
}
export function replayFilename(
  mission: string,
  mime: string,
  date = new Date(),
) {
  const slug =
    mission
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "flight";
  return `pocket-flight-${slug}-${date.toISOString().replace(/[:.]/g, "-")}.${mime.includes("mp4") ? "mp4" : "webm"}`;
}

/** Captures only game imagery and synthesized game audio, never screen or microphone. */
export class ReplayVideoExport {
  state: ExportState = { phase: "idle" };
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private generation = 0;
  private startedAt = 0;
  private recordedDuration = 0;
  get supported() {
    return (
      typeof MediaRecorder !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function" &&
      !!replayMimeType((m) => MediaRecorder.isTypeSupported(m))
    );
  }
  get busy() {
    return this.state.phase === "recording" || this.state.phase === "finishing";
  }
  start(
    mission: string,
    audio: MediaStreamTrack | null,
    source: HTMLCanvasElement,
    duration: number,
  ) {
    this.reset();
    if (!this.supported) {
      audio?.stop();
      this.state = {
        phase: "error",
        message:
          "Video download isn’t supported in this browser. Try a current Chrome, Edge, Firefox or Safari browser.",
      };
      return false;
    }
    const generation = this.generation;
    try {
      const canvas = (this.canvas = document.createElement("canvas"));
      canvas.width = 1280;
      canvas.height = 720;
      this.context = canvas.getContext("2d", { alpha: false });
      if (!this.context) throw new Error("Unable to create the video canvas.");
      this.context.fillStyle = "#163b40";
      this.context.fillRect(0, 0, 1280, 720);
      this.state = { phase: "recording" };
      this.draw(source);
      const stream = (this.stream = canvas.captureStream(30));
      if (audio) stream.addTrack(audio);
      const mimeType = replayMimeType((m) => MediaRecorder.isTypeSupported(m))!;
      const recorder = (this.recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Math.min(
          5_000_000,
          Math.floor((360 * 1024 * 1024 * 8) / Math.max(1, duration)),
        ),
      }));
      const filename = replayFilename(mission, recorder.mimeType || mimeType);
      recorder.ondataavailable = (e) => {
        if (generation !== this.generation || !e.data.size) return;
        this.bytes += e.data.size;
        if (this.bytes > 512 * 1024 * 1024) {
          this.fail(
            "This video is too large to export safely. Download a shorter flight.",
          );
          return;
        }
        this.chunks.push(e.data);
      };
      recorder.onerror = () =>
        this.fail(
          "The browser couldn’t finish the video. Your flight replay is still available; try downloading again.",
        );
      recorder.onstop = async () => {
        if (generation !== this.generation) return;
        let blob = new Blob(this.chunks, {
          type: recorder.mimeType || mimeType,
        });
        this.releaseRecorder();
        if (!blob.size) {
          this.fail("The video was empty. Please try downloading again.");
          return;
        }
        try {
          if (blob.type.includes("webm")) {
            const duration = this.recordedDuration;
            const { fixWebmDuration } = await import("@fix-webm-duration/fix");
            blob = await fixWebmDuration(blob, duration, { logger: false });
          }
        } catch {
          if (generation === this.generation)
            this.fail(
              "The video metadata couldn’t be finalized. Please try downloading again.",
            );
          return;
        }
        if (generation !== this.generation) return;
        const url = URL.createObjectURL(blob);
        this.state = { phase: "ready", url, filename };
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      };
      this.recordedDuration = 0;
      this.startedAt = performance.now();
      recorder.start(1000);
      return true;
    } catch (error) {
      audio?.stop();
      this.fail(
        error instanceof Error ? error.message : "Video export couldn’t start.",
      );
      return false;
    }
  }
  draw(source: HTMLCanvasElement, title = "") {
    if (this.state.phase !== "recording" || !this.context) return;
    const ctx = this.context,
      scale = Math.min(1280 / source.width, 720 / source.height);
    const w = source.width * scale,
      h = source.height * scale;
    ctx.fillStyle = "#163b40";
    ctx.fillRect(0, 0, 1280, 720);
    ctx.drawImage(source, (1280 - w) / 2, (720 - h) / 2, w, h);
    if (title.trim()) {
      ctx.font = "600 30px sans-serif";
      ctx.textAlign = "center";
      const text = title.slice(0, 100),
        width = Math.min(1160, ctx.measureText(text).width + 48);
      ctx.fillStyle = "rgba(12, 24, 29, .72)";
      ctx.fillRect((1280 - width) / 2, 624, width, 60);
      ctx.fillStyle = "#fff9e9";
      ctx.fillText(text, 640, 663, width - 36);
    }
  }
  finish() {
    if (this.state.phase !== "recording" || !this.recorder) return;
    this.recordedDuration = performance.now() - this.startedAt;
    this.state = { phase: "finishing" };
    try {
      this.recorder.stop();
    } catch {
      this.fail("The video recorder stopped unexpectedly. Please try again.");
    }
  }
  cancel(message?: string) {
    ++this.generation;
    this.releaseRecorder();
    this.state = { phase: message ? "error" : "idle", message };
  }
  private fail(message: string) {
    this.cancel(message);
  }
  private releaseRecorder() {
    if (this.recorder) {
      this.recorder.ondataavailable =
        this.recorder.onstop =
        this.recorder.onerror =
          null;
      if (this.recorder.state !== "inactive") this.recorder.stop();
      this.recorder = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.context = null;
    this.canvas = null;
    this.chunks = [];
    this.bytes = 0;
  }
  reset() {
    if (this.state.url) URL.revokeObjectURL(this.state.url);
    this.cancel();
  }
}
