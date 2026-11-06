import { supportsCombat } from "../aircraft/weapons/combat-loadouts";
import { combatMission } from "../flight/missions";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Plane,
  ArrowUpRight,
  ArrowRight,
  Wind,
  Sun,
  Moon,
  Volume2,
  VolumeX,
  Music2,
  Siren,
  Compass,
  Mountain,
  PlaneLanding,
  Timer,
  Sunrise,
  X,
  Pause,
  Play,
  RotateCcw,
  ChevronRight,
  Check,
  Settings2,
  Maximize,
  MapPin,
  Trophy,
  BookOpen,
  ChevronDown,
  CircleHelp,
  MoveUpRight,
  Flag,
  ArrowLeft,
  Heart,
  Film,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PocketFlight } from "../flight/game";
import { getMusicTrack, musicTracks } from "../audio/music-tracks";
import type { MusicTrackId } from "../audio/music-tracks";
import type { Snapshot } from "../flight/game";
import { missions } from "../flight/missions";
import type { Mission, FlightResult } from "../flight/missions";
import type { AircraftId } from "../aircraft/aircraft";
import { paints } from "../aircraft/aircraft";
import { terrainHeight, runways } from "../world/terrain";
import { rangeLayout } from "../world/range-island";
import { hasSpeedBrake } from "../flight/flight-envelope";
import { flightProfiles } from "../flight/flight-profiles";
import { type AircraftChoice, aircraftChoice, aircraftViewerUrl, choiceName, parseAircraftChoice, resolveAircraftChoice } from "./flight-ui";
import { type FinchVariant, finchAttackPaints } from "../aircraft/finch/attack";
import { FlightHud } from "../hud/FlightHud";
import type { SavedReplay } from "../replay/replay-data";
const ReplayStudio = lazy(() => import("../studio/ReplayStudio"));
const icons: Record<string, LucideIcon> = {
  sunrise: Sunrise,
  compass: Compass,
  mountain: Mountain,
  landing: PlaneLanding,
  wind: Wind,
  timer: Timer,
  flag: Flag,
};
const time = (s: number) =>
  `${Math.floor(s / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The game remains playable with browser storage disabled. */
  }
}
function ReplayDownload({
  game,
  snapshot,
}: {
  game: PocketFlight | null;
  snapshot: Snapshot | null;
}) {
  const state = snapshot?.replayExport;
  if (state?.phase === "ready")
    return (
      <a className="replay-download" href={state.url} download={state.filename}>
        <Download size={16} /> Save video again
      </a>
    );
  return (
    <div className="replay-download-wrap">
      <button
        className="replay-download"
        disabled={
          !snapshot?.exportSupported ||
          snapshot.replayDuration < 1 ||
          state?.phase === "finishing"
        }
        onClick={() => game?.downloadReplay()}
      >
        <Download size={16} />{" "}
        {state?.phase === "finishing" ? "Finishing video…" : "Download replay"}
      </button>
      {!snapshot?.exportSupported && (
        <small>Video export is unavailable in this browser.</small>
      )}
      {!!snapshot?.exportSupported && snapshot.replayDuration < 1 && (
        <small>Record at least one second of flight first.</small>
      )}
      {state?.phase === "error" && <small role="alert">{state.message}</small>}
    </div>
  );
}
function MiniMap({
  snapshot,
  mission,
  large = false,
}: {
  snapshot: Snapshot | null;
  mission: Mission;
  large?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const map = useRef<HTMLCanvasElement | null>(null);
  // The sandbox flies around Anvil Key, off Palm Bay's chart.
  const sandbox = mission.id === "combat";
  const originX = sandbox ? rangeLayout.centre.x : 0;
  const originZ = sandbox ? rangeLayout.centre.z : 0;
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!,
      image = ctx.createImageData(256, 256);
    for (let z = 0; z < 256; z++)
      for (let x = 0; x < 256; x++) {
        const h = terrainHeight(originX + (x / 256 - 0.5) * 2600, originZ + (z / 256 - 0.5) * 2600);
        const i = (z * 256 + x) * 4;
        const rgb =
          h < 0
            ? [91, 151, 151]
            : h < 8
              ? [222, 207, 157]
              : h < 80
                ? [152, 170, 128]
                : h < 170
                  ? [115, 144, 118]
                  : [184, 188, 151];
        image.data.set([...rgb, 255], i);
      }
    ctx.putImageData(image, 0, 0);
    map.current = c;
  }, [originX, originZ]);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !map.current) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(map.current, 0, 0);
    const conv = (n: number) => (n / 2600 + 0.5) * 256;
    const convX = (x: number) => conv(x - originX);
    const convZ = (z: number) => conv(z - originZ);
    if (mission.rings.length) {
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = "#f8ebc8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      mission.rings.forEach((p, i) =>
        i ? ctx.lineTo(conv(p.x), conv(p.z)) : ctx.moveTo(conv(p.x), conv(p.z)),
      );
      ctx.stroke();
      ctx.setLineDash([]);
      mission.rings.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(
          conv(p.x),
          conv(p.z),
          i === snapshot?.ring ? 3.5 : 2,
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = i < (snapshot?.ring ?? 0) ? "#3b7161" : "#fce3a5";
        ctx.fill();
      });
    }
    for (const r of runways) {
      ctx.save();
      ctx.translate(convX(r.x), convZ(r.z));
      ctx.rotate(r.heading);
      ctx.fillStyle = "#f7f0d9";
      ctx.fillRect(-1.5, (-r.length / 2600) * 128, 3, (r.length / 2600) * 256);
      ctx.restore();
    }
    if (snapshot && snapshot.mode !== "menu") {
      ctx.save();
      ctx.translate(convX(snapshot.x), convZ(snapshot.z));
      ctx.rotate((snapshot.heading * Math.PI) / 180);
      ctx.fillStyle = "#fff8da";
      ctx.shadowColor = "#214d55";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 3);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }, [snapshot, mission]);
  return (
    <div className={`minimap ${large ? "large" : ""}`}>
      <div className="map-top">
        <span>{sandbox ? "ANVIL KEY" : "PALM BAY"}</span>
        <span>N ↑</span>
      </div>
      <canvas
        ref={ref}
        width="256"
        height="256"
        aria-label="Island map with runways, route, and aircraft position"
      />
      <div className="map-bottom">
        <span>{sandbox ? "22° N · 158° W" : "22° N · 159° W"}</span>
        <Compass size={13} />
      </div>
    </div>
  );
}
export default function App() {
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioReplay, setStudioReplay] = useState<SavedReplay | null>(null);
  const viewport = useRef<HTMLDivElement>(null),
    game = useRef<PocketFlight | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [selected, setSelected] = useState(missions[0]),
    [panel, setPanel] = useState<
      "missions" | "controls" | "log" | "settings" | null
    >(null),
    [paint, setPaint] = useState(() => {
      const requested = new URLSearchParams(location.search).get("paint");
      const n = requested === null ? read("pocket-flight-paint", 0) : Number(requested);
      return Number.isInteger(n) && n >= 0 && n < paints.length ? n : 0;
    }),
    [initialChoice] = useState<AircraftChoice>(() =>
      parseAircraftChoice(
        new URLSearchParams(location.search).get("aircraft") ??
          read<string>("pocket-flight-aircraft", "finch"),
      ) ?? "finch",
    ),
    [aircraftId, setAircraftId] = useState<AircraftId>(() => resolveAircraftChoice(initialChoice).id),
    [finchVariant, setFinchVariant] = useState<FinchVariant>(() => resolveAircraftChoice(initialChoice).variant),
    [attackPaint, setAttackPaint] = useState(() => {
      const requested = new URLSearchParams(location.search).get("paint");
      const n = requested !== null && initialChoice === "finch-attack" ? Number(requested) : read("pocket-flight-attack-paint", 0);
      return Number.isInteger(n) && n >= 0 && n < finchAttackPaints.length ? n : 0;
    }),
    [switchingAircraft, setSwitchingAircraft] = useState(false),
    [night, setNight] = useState(false),
    [sound, setSound] = useState(false),
    [musicVolume, setMusicVolume] = useState(() => {
      const value = read<number>("pocket-flight-music-volume", 0.62);
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.62;
    }),
    [musicStatus, setMusicStatus] = useState("idle"),
    [musicTrack, setMusicTrack] = useState<MusicTrackId>(() => {
      try { return getMusicTrack(localStorage.getItem("pocket-flight-music-track")).id; }
      catch { return "coastlines"; }
    }),
    [beginnerAssist, setBeginnerAssist] = useState(() => read("pocket-flight-assist", true)),
    [automaticConfiguration, setAutomaticConfiguration] = useState(() => read("pocket-flight-auto-configuration", true)),
    [voiceWarnings, setVoiceWarnings] = useState(() => read("pocket-flight-voice-warnings", true)),
    [toast, setToast] = useState(""),
    [result, setResult] = useState<FlightResult | null>(null),
    [log, setLog] = useState<FlightResult[]>(() =>
      read("pocket-flight-log", []),
    );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const mode = snapshot?.mode ?? "menu";
  const current = game.current?.mission ?? selected;
  const resumeAfterPanel = useRef(false);
  const choice = aircraftChoice(aircraftId, finchVariant);
  const aircraftName = choiceName(choice);
  // The A-2 has its own tactical schemes; the trainer keeps its liveries.
  const attackFinch = choice === "finch-attack";
  const liveries = attackFinch ? finchAttackPaints.map((p) => ({ name: p.name, color: p.body })) : paints;
  const livery = attackFinch ? attackPaint : paint;
  const rotationKnots = flightProfiles[aircraftId].rotationKnots;
  const launchDisabled = !ready || switchingAircraft;
  const closePanel = () => {
    setPanel(null);
    if (resumeAfterPanel.current) game.current?.resume();
    resumeAfterPanel.current = false;
  };
  useEffect(() => {
    if (!viewport.current) return;
    let instance: PocketFlight;
    try {
      instance = new PocketFlight(viewport.current, aircraftId, finchVariant);
      instance.setPaint(livery);
      instance.physics.beginnerAssist = beginnerAssist;
      instance.physics.setAutomaticConfiguration(automaticConfiguration);
      instance.onSnapshot = (state) => {
        setSnapshot(state);
        setSound(instance.audio.enabled);
        if (instance.audio.music) {
          setMusicVolume(instance.audio.music.volume);
          setMusicStatus(instance.audio.music.status);
          setMusicTrack(instance.audio.music.track.id);
        }
      };
      instance.onToast = (text) => {
        setToast(text);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setToast(""), 4300);
      };
      instance.onResult = (r) => {
        setResult(r);
        setLog((prev) => {
          const next = [r, ...prev].slice(0, 80);
          save("pocket-flight-log", next);
          return next;
        });
      };
      game.current = instance;
      Promise.all([instance.aircraft.ready, instance.world.ready])
        .then(() => {
          if (game.current === instance) setReady(true);
        })
        .catch((error) => {
          if (game.current === instance)
            setError(`Unable to load the aircraft: ${String(error)}`);
        });
      if (import.meta.env.DEV)
        (window as unknown as { pocketFlight: PocketFlight }).pocketFlight =
          instance;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to initialize 3D graphics.",
      );
    }
    return () => {
      instance?.dispose();
      clearTimeout(toastTimer.current);
      game.current = null;
    };
  }, []);
  useEffect(() => {
    if (studioOpen) return;
    if (!panel && mode !== "paused" && mode !== "result") return;
    const previous = document.activeElement as HTMLElement;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    dialog?.querySelector<HTMLElement>("button")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (panel) closePanel();
        else if (mode === "paused") game.current?.resume();
        else back();
      }
      if (!panel && e.code === "KeyR" && !e.repeat) {
        e.preventDefault();
        if (!game.current?.restartLocked()) fly(current);
      }
      if (e.key === "Tab" && dialog) {
        const nodes = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
          ),
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handle, true);
    return () => {
      window.removeEventListener("keydown", handle, true);
      if (!document.querySelector(".replay-studio")) previous?.focus();
    };
  }, [panel, mode, studioOpen]);
  const fly = (m = selected) => {
    if (!ready || switchingAircraft) return;
    setSelected(m);
    resumeAfterPanel.current = false;
    setPanel(null);
    setResult(null);
    game.current?.start(m);
    setSound(game.current?.audio.enabled ?? false);
  };
  const changeAircraft = async (next: AircraftChoice) => {
    if (!game.current || switchingAircraft || next === choice) return;
    const { id, variant } = resolveAircraftChoice(next);
    setSwitchingAircraft(true);
    try {
      await game.current.selectAircraft(id, variant);
      game.current.setPaint(next === "finch-attack" ? attackPaint : paint);
      setAircraftId(id);
      setFinchVariant(variant);
      save("pocket-flight-aircraft", next);
    } catch {
      setToast("Aircraft could not load. Please try again.");
    } finally {
      setSwitchingAircraft(false);
    }
  };
  const changePaint = (i: number) => {
    if (attackFinch) {
      setAttackPaint(i);
      save("pocket-flight-attack-paint", i);
    } else {
      setPaint(i);
      save("pocket-flight-paint", i);
    }
    game.current?.setPaint(i);
  };
  const toggleNight = () => {
    setNight(!night);
    if (game.current) game.current.night = !night;
  };
  const toggleSound = () => setSound(game.current?.audio.toggle() ?? false);
  const toggleVoiceWarnings = () => {
    setVoiceWarnings((on) => {
      save("pocket-flight-voice-warnings", !on);
      return !on;
    });
  };
  const changeMusicVolume = (value: number) => {
    const audio = game.current?.audio;
    if (!audio) return;
    audio.setMusicVolume(value);
    if (value > 0 && !audio.enabled) audio.toggle();
    setMusicVolume(audio.music?.volume ?? value);
    setSound(audio.enabled);
  };
  const changeMusicTrack = (id: MusicTrackId) => {
    const audio = game.current?.audio;
    if (!audio) return;
    audio.selectMusicTrack(id);
    if (!audio.enabled && (audio.music?.volume ?? 0) > 0) audio.toggle();
    setMusicTrack(audio.music?.track.id ?? id);
    setSound(audio.enabled);
  };
  const back = () => {
    resumeAfterPanel.current = false;
    game.current?.menu();
    setPanel(null);
    setResult(null);
    setToast("");
  };
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      void document.documentElement
        .requestFullscreen()
        .catch(() => setToast("Fullscreen is unavailable in this browser."));
  };
  const openPanel = (p: typeof panel) => {
    resumeAfterPanel.current = mode === "playing";
    if (mode === "playing") game.current?.pause();
    setPanel(p);
  };
  const openStudio = () => {
    const instance = game.current;
    if (!instance) return;
    if (mode === "playing") instance.pause();
    instance.setSuspended(true);
    setStudioReplay(mode === "menu" ? null : instance.captureSavedReplay());
    setPanel(null);
    setStudioOpen(true);
  };
  const closeStudio = () => {
    setStudioOpen(false);
    game.current?.setSuspended(false);
  };
  const selectedIcon = icons[selected.icon];
  const SelectedIcon = selectedIcon;
  const completed = log.filter((l) => l.success),
    best = completed.length ? Math.max(...completed.map((l) => l.score)) : 0;
  return (
    <main
      className={`app ${mode === "menu" ? "on-menu" : "in-flight"} ${night ? "night" : ""} ${mode === "replay" ? "is-replaying" : ""}`}
    >
      <div className="viewport" ref={viewport} />
      <div className="vignette" />
      {studioOpen && game.current && (
        <Suspense
          fallback={
            <div
              className="loading"
              role="dialog"
              aria-modal="true"
              aria-label="Opening replay studio"
            >
              Opening replay studio…
            </div>
          }
        >
          <ReplayStudio
            library={game.current.replayLibrary}
            initialReplay={studioReplay}
            onClose={closeStudio}
          />
        </Suspense>
      )}
      {!ready && (
        <div className="loading">
          <Plane size={36} />
          <h2>
            {error ? "Unable to take off" : "Preparing your little escape"}
          </h2>
          <p>{error || "Sculpting coastlines. Warming up the engine."}</p>
          {error && (
            <button className="primary" onClick={() => location.reload()}>
              Try again
            </button>
          )}
        </div>
      )}
      {mode === "menu" && (
        <>
          <div className="menu-wash" />
          <header className="header">
            <a
              className="brand"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                back();
              }}
              aria-label="Pocket Flight home"
            >
              <span className="brand-icon">
                <Plane size={24} strokeWidth={1.6} />
              </span>
              <span>
                pocket<span className="brand-flight">FLIGHT</span>
              </span>
            </a>
            <nav>
              <button
                className={!panel ? "active" : ""}
                onClick={() => setPanel(null)}
              >
                The island
              </button>
              <button onClick={openStudio} disabled={!ready}>
                Replay studio <Film size={14} />
              </button>
              <button onClick={() => setPanel("log")}>
                Flight log{" "}
                <span className="nav-count">
                  {completed.length.toString().padStart(2, "0")}
                </span>
              </button>
              <button onClick={() => setPanel("controls")}>
                How to fly <ArrowUpRight size={13} />
              </button>
            </nav>
            <div className="header-actions">
              <button
                className="icon-button replay-studio-entry"
                aria-label="Replay studio"
                title="Replay studio"
                disabled={!ready}
                onClick={openStudio}
              >
                <Film size={19} />
              </button>
              <button
                className="weather-pill"
                onClick={toggleNight}
                aria-label={night ? "Switch to daylight" : "Switch to night"}
              >
                {night ? <Moon size={15} /> : <Sun size={16} />}
                <span>
                  {night ? "Moonlit skies" : "Perfect flying weather"}
                </span>
              </button>
              <button
                className="icon-button"
                aria-label={sound ? "Mute audio" : "Enable audio"}
                onClick={toggleSound}
              >
                {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
              </button>
              <button
                className="icon-button"
                aria-label="Settings"
                onClick={() => setPanel("settings")}
              >
                <Settings2 size={19} />
              </button>
            </div>
          </header>
          <section className="hero">
            <div className="eyebrow">
              <span className="live-dot" />A LITTLE ESCAPE AWAITS
            </div>
            <h1>
              Take the
              <br />
              <em>scenic route.</em>
            </h1>
            <p>
              A small plane. A sun-drenched island.
              <br />
              And absolutely nowhere you have to be.
            </p>
            <div className="launch-brief" aria-live="polite">
              <span>
                <SelectedIcon size={16} /> {selected.name}
              </span>
              <span>
                {aircraftName} ·{" "}
                {selected.airStart ? "Start in the air" : "Runway departure"} ·{" "}
                {selected.duration}
              </span>
            </div>
            <div className="hero-buttons">
              <button
                className="primary"
                disabled={launchDisabled}
                onClick={() => fly()}
              >
                {switchingAircraft ? "Loading aircraft…" : "Start flight"}{" "}
                <ArrowUpRight size={21} />
              </button>
              <button
                className="text-button"
                disabled={launchDisabled}
                onClick={() => fly(missions[7])}
              >
                Free flight <ArrowRight size={17} />
              </button>
              <button className="text-button" disabled={launchDisabled || !supportsCombat(choice)} onClick={() => fly(combatMission)}>Weapons sandbox</button>
            </div>
            <button
              className="quick-help"
              onClick={() => openPanel("controls")}
            >
              <CircleHelp size={16} /> First time here? See the controls
            </button>
          </section>
          <section className="departure-board">
            <button
              className="flight-plan"
              onClick={() => setPanel("missions")}
              aria-label={`Choose a mission. Selected: ${selected.name}`}
            >
              <div className="board-icon">
                <SelectedIcon size={25} strokeWidth={1.45} />
              </div>
              <div className="plan-copy">
                <span className="tiny-label">YOUR NEXT ADVENTURE</span>
                <h3>
                  <span className="plan-name">{selected.name}</span>{" "}
                  <ChevronDown size={15} />
                </h3>
                <p>
                  {selected.duration}
                  <span>·</span>
                  {selected.difficulty}
                </p>
              </div>
              <span className="circle-button" aria-hidden="true">
                <ArrowUpRight size={19} />
              </span>
            </button>
            <div className="aircraft-selection">
              <div className="aircraft-caption">
                <span className="tiny-label">
                  {switchingAircraft
                    ? "LOADING AIRCRAFT…"
                    : "CHOOSE YOUR AIRCRAFT"}
                </span>
                <h3>
                  <select
                    aria-label="Choose aircraft"
                    value={choice}
                    disabled={switchingAircraft || !ready}
                    onChange={(e) =>
                      void changeAircraft(parseAircraftChoice(e.target.value) ?? "finch")
                    }
                    className="aircraft-picker"
                  >
                    <option value="finch">The Finch · U–2</option>
                    <option value="finch-attack">Finch A–2 · Attack</option>
                    <option value="peregrine">Peregrine · HX–27</option>
                    <option value="aurelia">Aurelia · S32</option>
                    <option value="stormbird">Stormbird · HX–40</option>
                    <option value="heron">Heron · UT–9</option>
                    <option value="f15c">F-15C · Eagle</option>
                  </select>
                </h3>
                <p>
                  <a
                    href={aircraftViewerUrl(choice, livery)}
                    style={{ color: "inherit", textUnderlineOffset: 3 }}
                  >
                    Explore the aircraft ↗
                  </a>
                </p>
              </div>
              {aircraftId === "finch" ? (
                <div className="paint-options">
                  <div className="swatches">
                    {liveries.map((p, i) => (
                      <button
                        key={p.name}
                        className={`swatch ${livery === i ? "selected" : ""}`}
                        style={{ "--paint": p.color } as React.CSSProperties}
                        title={p.name}
                        aria-label={`${p.name} paint`}
                        aria-pressed={livery === i}
                        onClick={() => changePaint(i)}
                      >
                        {livery === i && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <span>{liveries[livery].name} {attackFinch ? "scheme" : "livery"}</span>
                </div>
              ) : (
                <div className="jet-flight-note">
                  <b>
                    {switchingAircraft
                      ? "Loading aircraft…"
                      : aircraftId === "heron" ? "Utility turboprop" : "Twin-engine jet"}
                  </b>
                  <span>
                    {aircraftId === "f15c"
                      ? "Twin afterburners · CAD flight controls · Retractable gear"
                      : aircraftId === "heron"
                      ? "Single turbine · Four-blade propeller · Cargo pod"
                      : aircraftId === "stormbird"
                      ? "Stormbird jet · Animated gear · Afterburners"
                      : aircraftId === "aurelia"
                        ? "Civilian jet · Animated systems"
                        : "Full throttle · Afterburners"}
                  </span>
                  <span>{aircraftId === "heron" ? automaticConfiguration ? "Fixed gear · Automatic flaps" : "Fixed gear · F cycles flaps" : automaticConfiguration ? "Automatic gear and flaps" : "Manual gear and flaps · G / F"}</span>
                </div>
              )}
            </div>
            <div className="board-end">
              <Wind size={22} strokeWidth={1.4} />
              <div>
                <span className="tiny-label">THE FORECAST</span>
                <h3>A gentle ocean breeze</h3>
                <p>Light winds · {night ? "Starlit" : "Clear"} skies</p>
              </div>
            </div>
          </section>
          <footer className="menu-footer">
            <button
              className="footer-location"
              onClick={() => setPanel("missions")}
              aria-label="Palm Bay Airfield. Explore missions"
            >
              <MapPin size={12} aria-hidden="true" />
              <span>PALM BAY AIRFIELD</span>
            </button>
            <span className="footer-mark">✳</span>
            <span>
              POCKET FLIGHT{" "}
              <span className="version">VOL. 01 — THE ISLANDS</span>
            </span>
          </footer>
        </>
      )}
      {mode !== "menu" && snapshot && (
        <>
          <FlightHud
            game={game.current}
            snapshot={snapshot}
            mission={current}
            aircraftId={aircraftId}
            beginnerAssist={beginnerAssist}
            automaticConfiguration={automaticConfiguration}
            sound={sound}
            voiceWarnings={voiceWarnings}
            map={<MiniMap snapshot={snapshot} mission={current} />}
            onToggleSound={toggleSound}
            onOpenControls={() => openPanel("controls")}
          />
          {mode === "replay" && (
            <div className="replay-bar">
              <div className="replay-progress">
                <span>
                  <span className="live-dot" />
                  {snapshot.replayExport.phase === "recording"
                    ? "SAVING REPLAY VIDEO"
                    : "FLIGHT REPLAY"}
                  {snapshot.replayTrimmed ? " · LATEST 30 MIN" : ""}
                </span>
                <span>
                  {time(snapshot.replayElapsed)} /{" "}
                  {time(snapshot.replayDuration)}
                </span>
                <progress
                  aria-label="Replay progress"
                  value={snapshot.replayElapsed}
                  max={Math.max(0.001, snapshot.replayDuration)}
                />
                {snapshot.replayExport.phase === "recording" && (
                  <small>
                    Keep this tab visible. The video saves when playback
                    finishes.
                  </small>
                )}
              </div>
              {snapshot.replayExport.phase !== "recording" && (
                <ReplayDownload game={game.current} snapshot={snapshot} />
              )}
              <button onClick={() => game.current?.stopReplay()}>
                <X size={16} />{" "}
                {snapshot.replayExport.phase === "recording"
                  ? "Cancel download"
                  : "Exit replay"}
              </button>
            </div>
          )}
        </>
      )}
      {toast && mode === "playing" && (
        <div className="toast">
          <span className="toast-icon">
            <Plane size={17} />
          </span>
          {toast}
        </div>
      )}
      {mode === "paused" && !panel && !studioOpen && (
        <div className="modal-scrim">
          <section
            className="pause-card"
            role="dialog"
            aria-modal="true"
            aria-label="Flight paused"
          >
            <span className="modal-icon">
              <Pause size={25} />
            </span>
            <div className="eyebrow">TAKE A BREATHER</div>
            <h2>Sky’s not going anywhere.</h2>
            <p>Your flight is paused. We’ll keep your seat warm.</p>
            <button
              className="primary full"
              onClick={() => game.current?.resume()}
            >
              Back to the sky <Play size={18} />
            </button>
            <div className="pause-grid">
              <button onClick={() => fly(current)}>
                <RotateCcw size={17} />
                Restart flight
              </button>
              <button disabled={!game.current?.canReplay} onClick={openStudio}>
                <Film size={17} />
                Edit replay
              </button>
              <button onClick={() => setPanel("controls")}>
                <BookOpen size={17} />
                How to fly
              </button>
              <button onClick={() => setPanel("settings")}>
                <Settings2 size={17} />
                Settings
              </button>
            </div>
            <ReplayDownload game={game.current} snapshot={snapshot} />
            <button className="text-button" onClick={back}>
              <ArrowLeft size={16} />
              Back to the island
            </button>
          </section>
        </div>
      )}
      {mode === "result" && result && !panel && !studioOpen && (
        <div className="modal-scrim">
          <section
            className="result-card"
            role="dialog"
            aria-modal="true"
            aria-label="Flight result"
          >
            <span className={`medal ${result.medal ?? "none"}`}>
              <Trophy size={34} strokeWidth={1.4} />
            </span>
            <div className="eyebrow">
              {result.success
                ? `${result.medal?.toUpperCase()} MEDAL · ${result.mission.toUpperCase()}`
                : "FLIGHT ENDED"}
            </div>
            <h2>{result.title}</h2>
            <p>
              {result.success
                ? "A little adventure, beautifully flown."
                : "A fresh aircraft and another adventure are one click away."}
            </p>
            <div className="result-score">
              {result.score.toLocaleString()} <small>POINTS</small>
            </div>
            <div className="result-stats">
              <div>
                <strong>{time(result.time)}</strong>
                <span>FLIGHT TIME</span>
              </div>
              <div>
                <strong>{Math.round(result.smoothness)}%</strong>
                <span>SMOOTHNESS</span>
              </div>
              <div>
                <strong>{Math.round(result.health)}%</strong>
                <span>AIRCRAFT</span>
              </div>
            </div>
            <button className="primary full" onClick={() => fly(current)}>
              {result.success ? "Fly it again" : "Try again"}
              <RotateCcw size={17} />
            </button>
            <div className="result-actions">
              <button
                className="text-button"
                disabled={!game.current?.canReplay}
                onClick={openStudio}
              >
                <Film size={16} />
                Edit replay
              </button>
              <ReplayDownload game={game.current} snapshot={snapshot} />
              <button className="text-button" onClick={back}>
                Back to island
                <ArrowRight size={16} />
              </button>
            </div>
          </section>
        </div>
      )}
      {panel && (
        <div
          className="modal-scrim"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) closePanel();
          }}
        >
          <section
            className={`panel ${panel === "missions" ? "mission-panel" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={panel}
          >
            <button
              className="close-button icon-button"
              aria-label="Close panel"
              onClick={closePanel}
            >
              <X size={21} />
            </button>
            {panel === "missions" && (
              <>
                <div className="eyebrow">PICK YOUR LITTLE ADVENTURE</div>
                <h2>Where to?</h2>
                <p>A few minutes. A fresh perspective.</p>
                <div className="mission-list">
                  {missions.map((m, i) => {
                    const Icon = icons[m.icon];
                    const medal = log
                      .filter((l) => l.success && l.mission === m.name)
                      .sort((a, b) => b.score - a.score)[0];
                    return (
                      <button
                        key={m.id}
                        className={`mission-option ${selected.id === m.id ? "selected" : ""}`}
                        onClick={() => setSelected(m)}
                      >
                        <span className="mission-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="mission-symbol">
                          <Icon size={23} strokeWidth={1.5} />
                        </span>
                        <span className="mission-text">
                          <span className="tiny-label">{m.eyebrow}</span>
                          <strong>
                            {m.name}
                            {medal && (
                              <Trophy size={13} className={medal.medal ?? ""} />
                            )}
                          </strong>
                          <span>{m.description}</span>
                        </span>
                        <span className="mission-meta">
                          {m.duration}
                          <small>{m.difficulty}</small>
                        </span>
                        {selected.id === m.id ? (
                          <Check size={17} />
                        ) : (
                          <ChevronRight size={17} />
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="panel-bottom">
                  <span>
                    <SelectedIcon size={16} />
                    {selected.name}
                  </span>
                  <button
                    className="primary"
                    disabled={launchDisabled}
                    onClick={() => fly(selected)}
                  >
                    Start flight
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </>
            )}
            {panel === "controls" && (
              <>
                <div className="eyebrow">A LITTLE KNOW-HOW</div>
                <h2>Your controls, at a glance.</h2>
                <p>
                  {aircraftName} · Keyboard or touch. Your flight pauses while
                  you read.
                </p>
                <div className="control-list">
                  <div>
                    <span>
                      <b>Pitch</b>
                      <small>↓ / S raises the nose. ↑ / W lowers it.</small>
                    </span>
                    <span>
                      <kbd>↑</kbd>
                      <kbd>↓</kbd>
                      <i>or</i>
                      <kbd>W</kbd>
                      <kbd>S</kbd>
                    </span>
                  </div>
                  <div>
                    <span>
                      <b>Bank & turn</b>
                      <small>
                        Lean into a turn. Release to gently level out.
                      </small>
                    </span>
                    <span>
                      <kbd>←</kbd>
                      <kbd>→</kbd>
                      <i>or</i>
                      <kbd>A</kbd>
                      <kbd>D</kbd>
                    </span>
                  </div>
                  <div>
                    <span>
                      <b>Throttle</b>
                      <small>
                        More power / less power. Or use the HUD slider.
                      </small>
                    </span>
                    <span>
                      <kbd>Shift</kbd>
                      <kbd>Ctrl</kbd>
                    </span>
                  </div>
                  <div>
                    <span>
                      <b>Rudder</b>
                      <small>
                        Fine steering on the runway or in a crosswind.
                      </small>
                    </span>
                    <span>
                      <kbd>Q</kbd>
                      <kbd>E</kbd>
                    </span>
                  </div>
                  <div>
                    <span>
                      <b>{hasSpeedBrake(aircraftId) ? "Speed brake / wheel brakes" : "Wheel brakes"}</b>
                      <small>{hasSpeedBrake(aircraftId) ? "Hold to slow down in flight, or to brake after touchdown." : "Hold after touchdown to slow to a stop."}</small>
                    </span>
                    <span>
                      <kbd>B</kbd>
                      <i>or</i>
                      <kbd>Space</kbd>
                    </span>
                  </div>
                  {aircraftId === "f15c" && <div>
                    <span><b>Fire cannon</b><small>Hold to fire. Ammunition resets when a flight starts.</small></span>
                    <span><kbd>J</kbd></span>
                  </div>}
                  <div>
                    <span>
                      <b>Camera / free-look</b>
                      <small>Cycle views / hold right mouse and drag. Hold Z to zoom in the cockpit view.</small>
                    </span>
                    <span>
                      <kbd>C</kbd>
                      <kbd>RMB</kbd>
                      <kbd>Z</kbd>
                    </span>
                  </div>
                  {aircraftId !== "finch" && <div>
                    <span><b>{aircraftId === "heron" ? "Fixed gear / flaps" : "Gear / flaps"}</b><small>{aircraftId === "heron" ? "Landing gear stays down. Manual mode: F cycles flaps 0%, 65%, 100%." : "Manual mode: toggle gear / cycle flaps 0%, 65%, 100%."} Set the mode in Settings → Controls.</small></span>
                    <span>{aircraftId !== "heron" && <kbd>G</kbd>}<kbd>F</kbd></span>
                  </div>}
                  <div>
                    <span><b>Elevator trim</b><small>With flight assist off: decrease / increase the neutral elevator command.</small></span>
                    <span><kbd>[</kbd><kbd>]</kbd></span>
                  </div>
                  <div>
                    <span>
                      <b>Pause / restart</b>
                      <small>Take a breather, or get a fresh aircraft.</small>
                    </span>
                    <span>
                      <kbd>Esc</kbd>
                      <kbd>R</kbd>
                    </span>
                  </div>
                </div>
                <div className="pilot-tip">
                  <Sunrise size={23} />
                  <p>
                    <b>Taking off in {aircraftName}</b>Hold Shift for full
                    power. At {rotationKnots} knots, gently hold ↓ or S to raise
                    the nose. Once airborne, release to let beginner assist
                    trim, if enabled.
                    {` For landing, close the throttle and approach near ${flightProfiles[aircraftId].approachKnots} knots at standard loading.${hasSpeedBrake(aircraftId) ? " Hold B to slow down faster." : ""}`}
                    {aircraftId === "heron" ? automaticConfiguration ? " Approach flaps deploy automatically; gear stays down." : " Press F for approach flaps; gear stays down." : aircraftId !== "finch" && (automaticConfiguration ? " Landing gear and approach flaps deploy automatically." : " Press G for gear down and F for approach flaps before landing.")}{" "}
                    Gently raise the nose just above the runway, then hold B
                    after touchdown.
                  </p>
                </div>
                <p className="touch-note">
                  On touchscreens, use the flight stick and throttle slider.
                  Desktop keyboard controls offer the most precision.
                </p>
                <button className="primary full" onClick={closePanel}>
                  {resumeAfterPanel.current
                    ? "Resume flight"
                    : mode === "paused"
                      ? "Back to pause menu"
                      : "Back to the island"}
                  <ArrowUpRight size={18} />
                </button>
              </>
            )}
            {panel === "log" && (
              <>
                <div className="eyebrow">THE STORIES YOU BRING HOME</div>
                <h2>Your flight log.</h2>
                <p>Every landing is a little achievement.</p>
                <div className="log-stats">
                  <div>
                    <strong>
                      {completed.length.toString().padStart(2, "0")}
                    </strong>
                    <span>MISSIONS COMPLETED</span>
                  </div>
                  <div>
                    <strong>{best.toLocaleString()}</strong>
                    <span>PERSONAL BEST</span>
                  </div>
                  <div>
                    <strong>{time(log.reduce((s, l) => s + l.time, 0))}</strong>
                    <span>TIME IN MISSIONS</span>
                  </div>
                </div>
                {!log.length ? (
                  <div className="empty-log">
                    <Compass size={50} strokeWidth={1} />
                    <h3>A blank page. An open sky.</h3>
                    <p>Your first adventure is waiting at Palm Bay.</p>
                    <button className="primary" onClick={() => fly()}>
                      Make a memory
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                ) : (
                  <div className="log-list">
                    {log.map((l, i) => (
                      <div key={i}>
                        <Trophy size={20} className={l.medal ?? ""} />
                        <span>
                          <b>{l.mission}</b>
                          <small>
                            {l.success
                              ? `${l.medal} medal`
                              : "A learning experience"}{" "}
                            · {time(l.time)}
                          </small>
                        </span>
                        <strong>
                          {l.score.toLocaleString()}
                          <small> PTS</small>
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {panel === "settings" && (
              <>
                <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                <h2>A few little details.</h2>
                <p>Set the mood for your next flight.</p>
                <div className="setting-row">
                  <span>
                    <Sun size={21} />
                    <b>Time of day</b>
                  </span>
                  <button className="setting-toggle" onClick={toggleNight}>
                    {night ? "Moonlight" : "Daylight"}
                    {night ? <Moon size={17} /> : <Sun size={17} />}
                  </button>
                </div>
                <div className="setting-row">
                  <span>
                    <Volume2 size={21} />
                    <b>All audio</b>
                  </span>
                  <button className="setting-toggle" onClick={toggleSound}>
                    {sound ? "Sound on" : "Sound off"}
                    {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                </div>
                <div className="setting-row">
                  <span>
                    <Siren size={21} />
                    <b>Voice warnings</b>
                  </span>
                  <button className="setting-toggle" aria-pressed={voiceWarnings} onClick={toggleVoiceWarnings}>
                    {voiceWarnings ? "Betty on" : "Betty off"}
                    {voiceWarnings ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                </div>
                <p className="music-status">Voice warnings: real cockpit recordings.</p>
                <div className="setting-row music-setting">
                  <span>
                    <Music2 size={21} />
                    <span className="music-label"><b>Music volume</b><small>Original flight soundtrack</small></span>
                  </span>
                  <label className="music-volume">
                    <span>{Math.round(musicVolume * 100)}%</span>
                    <input type="range" aria-label="Music volume" min="0" max="100" step="1"
                      value={Math.round(musicVolume * 100)} onChange={(event) => changeMusicVolume(Number(event.target.value) / 100)} />
                  </label>
                </div>
                <div className="setting-row music-track-setting">
                  <span><Music2 size={21} /><b>Soundtrack</b></span>
                  <select className="setting-toggle music-track-select" aria-label="Soundtrack song" value={musicTrack}
                    onChange={(event) => changeMusicTrack(event.target.value as MusicTrackId)}>
                    {musicTracks.map((track) => <option key={track.id} value={track.id}>{track.title} · {track.bpm} BPM</option>)}
                  </select>
                </div>
                <p className="music-status">{getMusicTrack(musicTrack).description}</p>
                {musicStatus === "loading" && <p className="music-status" role="status">Preparing the soundtrack…</p>}
                {musicStatus === "error" && <p className="music-status" role="status">Music could not load. <button onClick={() => changeMusicVolume(musicVolume || 0.62)}>Retry music</button></p>}
                <div className="setting-row">
                  <span>
                    <Maximize size={21} />
                    <b>A bigger sky</b>
                  </span>
                  <button className="setting-toggle" onClick={fullscreen}>
                    Fullscreen
                    <ArrowUpRight size={17} />
                  </button>
                </div>
                <section className="controls-settings" aria-labelledby="controls-settings-title">
                <h3 id="controls-settings-title">Controls</h3>
                <div className="setting-row">
                  <span>
                    <Plane size={21} />
                    <b>Beginner flight assist</b>
                  </span>
                  <button
                    className="setting-toggle"
                    aria-pressed={beginnerAssist}
                    onClick={() => {
                      const enabled = !beginnerAssist;
                      setBeginnerAssist(enabled);
                      save("pocket-flight-assist", enabled);
                      if (game.current) game.current.physics.beginnerAssist = enabled;
                    }}
                  >
                    {beginnerAssist ? "Assist on" : "Assist off"}
                  </button>
                </div>
                <div className="setting-row">
                  <span><PlaneLanding size={21} /><b>Automatic gear and flaps</b></span>
                  <button className="setting-toggle" aria-pressed={automaticConfiguration}
                    aria-label="Automatic gear and flaps"
                    onClick={() => {
                      const enabled = !automaticConfiguration;
                      setAutomaticConfiguration(enabled);
                      save("pocket-flight-auto-configuration", enabled);
                      game.current?.physics.setAutomaticConfiguration(enabled);
                    }}>
                    {automaticConfiguration ? "Automatic" : "Manual"}
                  </button>
                </div>
                <p className="controls-setting-note">Automatic: closing the throttle in flight lowers the gear and flaps; pushing it past 70% cleans up again. Manual: G toggles gear, F cycles flaps. Finch has fixed gear and no movable flaps. Flight assistance is a separate choice.</p>
                <button className="controls-help-button" onClick={() => setPanel("controls")}>View flight controls <ArrowUpRight size={16} /></button>
                </section>
                {aircraftId === "finch" && (
                  <div className="setting-row paint-setting">
                    <span>
                      <Plane size={21} />
                      <b>{attackFinch ? "Finch A–2 scheme" : "Finch livery"}</b>
                    </span>
                    <div className="swatches">
                      {liveries.map((p, i) => (
                        <button
                          key={p.name}
                          className={`swatch ${livery === i ? "selected" : ""}`}
                          style={{ "--paint": p.color } as React.CSSProperties}
                          aria-label={`${p.name} paint`}
                          aria-pressed={livery === i}
                          onClick={() => changePaint(i)}
                        >
                          {livery === i && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pilot-tip">
                  <Heart size={23} />
                  <p>
                    Your paint, scores, and medals are saved in this browser.
                    Beginner assist adds gentle self-leveling, coordinated
                    turns, and automatic trim through the control surfaces.
                    Switching it off gives direct elevator, aileron, and rudder
                    control, with the aircraft’s natural stability and inertia.
                  </p>
                </div>
                <p className="settings-credits">
                  Pilot model:{" "}
                  <a href="https://sketchfab.com/3d-models/fighter-pilot-character-9c53b42d13994cefa8916729021b3104" target="_blank" rel="noreferrer">“Fighter Pilot Character”</a>{" "}
                  by <a href="https://sketchfab.com/softnote" target="_blank" rel="noreferrer">SoftNote</a>, licensed under{" "}
                  <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
                  Reduced, re-textured and rigged for Pocket Flight.
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
