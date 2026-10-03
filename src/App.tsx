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
  Compass,
  Mountain,
  PlaneLanding,
  Timer,
  Sunrise,
  X,
  Pause,
  Play,
  RotateCcw,
  Camera,
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
  Navigation,
  ArrowLeft,
  Heart,
  Film,
  Download,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PocketFlight } from "./game";
import type { Snapshot } from "./game";
import { missions } from "./missions";
import type { Mission, FlightResult } from "./missions";
import type { AircraftId } from "./aircraft";
import { paints } from "./aircraft";
import { terrainHeight, runways } from "./terrain";
import { flightProfiles } from "./flight-profiles";
import { aircraftNames, climbReadout, headingReadout } from "./flight-ui";
import type { SavedReplay } from "./replay-data";
const ReplayStudio = lazy(() => import("./ReplayStudio"));
const icons: Record<string, LucideIcon> = {
  sunrise: Sunrise,
  compass: Compass,
  mountain: Mountain,
  landing: PlaneLanding,
  wind: Wind,
  timer: Timer,
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
  useEffect(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d")!,
      image = ctx.createImageData(256, 256);
    for (let z = 0; z < 256; z++)
      for (let x = 0; x < 256; x++) {
        const h = terrainHeight((x / 256 - 0.5) * 2600, (z / 256 - 0.5) * 2600);
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
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !map.current) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 256, 256);
    ctx.drawImage(map.current, 0, 0);
    const conv = (n: number) => (n / 2600 + 0.5) * 256;
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
      ctx.translate(conv(r.x), conv(r.z));
      ctx.rotate(r.heading);
      ctx.fillStyle = "#f7f0d9";
      ctx.fillRect(-1.5, (-r.length / 2600) * 128, 3, (r.length / 2600) * 256);
      ctx.restore();
    }
    if (snapshot && snapshot.mode !== "menu") {
      ctx.save();
      ctx.translate(conv(snapshot.x), conv(snapshot.z));
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
        <span>PALM BAY</span>
        <span>N ↑</span>
      </div>
      <canvas
        ref={ref}
        width="256"
        height="256"
        aria-label="Island map with runways, route, and aircraft position"
      />
      <div className="map-bottom">
        <span>22° N · 159° W</span>
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
      const n = read("pocket-flight-paint", 0);
      return Number.isInteger(n) && n >= 0 && n < paints.length ? n : 0;
    }),
    [aircraftId, setAircraftId] = useState<AircraftId>(() => {
      const id =
        new URLSearchParams(location.search).get("aircraft") ??
        read<string>("pocket-flight-aircraft", "finch");
      return ["finch", "peregrine", "aurelia", "stormbird"].includes(id)
        ? (id as AircraftId)
        : "finch";
    }),
    [switchingAircraft, setSwitchingAircraft] = useState(false),
    [instrumentsExpanded, setInstrumentsExpanded] = useState(false),
    [night, setNight] = useState(false),
    [sound, setSound] = useState(false),
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
  const aircraftName = aircraftNames[aircraftId];
  const rotationKnots = flightProfiles[aircraftId].rotationKnots;
  const launchDisabled = !ready || switchingAircraft;
  const heading = headingReadout(snapshot?.heading ?? 0);
  const climb = climbReadout(snapshot?.verticalSpeed ?? 0);
  const flightWarning =
    snapshot?.stall || snapshot?.hint.startsWith("Engine out");
  const closePanel = () => {
    setPanel(null);
    if (resumeAfterPanel.current) game.current?.resume();
    resumeAfterPanel.current = false;
  };
  useEffect(() => {
    if (!viewport.current) return;
    let instance: PocketFlight;
    try {
      instance = new PocketFlight(viewport.current, aircraftId);
      instance.setPaint(paint);
      instance.onSnapshot = (state) => {
        setSnapshot(state);
        setSound(instance.audio.enabled);
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
        fly(current);
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
    setSound(true);
  };
  const changeAircraft = async (id: AircraftId) => {
    if (!game.current || switchingAircraft || id === aircraftId) return;
    setSwitchingAircraft(true);
    try {
      await game.current.selectAircraft(id);
      game.current.setPaint(paint);
      setAircraftId(id);
      save("pocket-flight-aircraft", id);
    } catch {
      setToast("Aircraft could not load. Please try again.");
    } finally {
      setSwitchingAircraft(false);
    }
  };
  const changePaint = (i: number) => {
    setPaint(i);
    game.current?.setPaint(i);
    save("pocket-flight-paint", i);
  };
  const toggleNight = () => {
    setNight(!night);
    if (game.current) game.current.night = !night;
  };
  const toggleSound = () => setSound(game.current?.audio.toggle() ?? false);
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
            </div>
            <button
              className="quick-help"
              onClick={() => openPanel("controls")}
            >
              <CircleHelp size={16} /> First time here? See the controls
            </button>
          </section>
          <div className="world-label">
            <span className="label-line" />
            <div>
              <span className="tiny-label">YOUR OWN PIECE OF PARADISE</span>
              <h3>Palm Bay archipelago</h3>
              <span>Two airfields. A thousand scenic routes.</span>
            </div>
          </div>
          <button className="island-pin" onClick={() => setPanel("missions")}>
            <MapPin size={15} />
            <span>PALM BAY AIRFIELD</span>
            <span className="pin-dot" />
          </button>
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
                    value={aircraftId}
                    disabled={switchingAircraft || !ready}
                    onChange={(e) =>
                      void changeAircraft(e.target.value as AircraftId)
                    }
                    className="aircraft-picker"
                  >
                    <option value="finch">The Finch · U–2</option>
                    <option value="peregrine">Peregrine · HX–27</option>
                    <option value="aurelia">Aurelia · S32</option>
                    <option value="stormbird">Stormbird · HX–40</option>
                  </select>
                </h3>
                <p>
                  <a
                    href={
                      aircraftId === "stormbird"
                        ? "/stormbird.html"
                        : aircraftId === "aurelia"
                          ? "/civilian.html"
                          : aircraftId === "peregrine"
                            ? "/jet"
                            : "/hangar.html"
                    }
                    style={{ color: "inherit", textUnderlineOffset: 3 }}
                  >
                    Explore the aircraft ↗
                  </a>
                </p>
              </div>
              {aircraftId === "finch" ? (
                <div className="paint-options">
                  <div className="swatches">
                    {paints.map((p, i) => (
                      <button
                        key={p.name}
                        className={`swatch ${paint === i ? "selected" : ""}`}
                        style={{ "--paint": p.color } as React.CSSProperties}
                        title={p.name}
                        aria-label={`${p.name} paint`}
                        aria-pressed={paint === i}
                        onClick={() => changePaint(i)}
                      >
                        {paint === i && <Check size={12} />}
                      </button>
                    ))}
                  </div>
                  <span>{paints[paint].name} livery</span>
                </div>
              ) : (
                <div className="jet-flight-note">
                  <b>
                    {switchingAircraft
                      ? "Loading aircraft…"
                      : "Twin-engine jet"}
                  </b>
                  <span>
                    {aircraftId === "stormbird"
                      ? "Stormbird jet · Animated gear · Afterburners"
                      : aircraftId === "aurelia"
                        ? "Civilian jet · Animated systems"
                        : "Full throttle · Afterburners"}
                  </span>
                  <span>Automatic landing gear</span>
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
            <span>MADE FOR THE JOY OF FLYING</span>
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
          <header className="flight-header">
            <button
              className="flight-brand"
              onClick={() => {
                game.current?.pause();
                setPanel(null);
              }}
              aria-label="Open pause menu"
            >
              <span className="brand-icon">
                <Plane size={22} />
              </span>
            </button>
            <div className="objective">
              <span className="tiny-label">{current.name}</span>
              <h3>{snapshot.objective}</h3>
              <div className="mission-progress">
                {snapshot.totalRings > 0 &&
                  Array.from({ length: snapshot.totalRings }, (_, i) => (
                    <i
                      key={i}
                      className={
                        i < snapshot.ring
                          ? "done"
                          : i === snapshot.ring
                            ? "next"
                            : ""
                      }
                    />
                  ))}
                <span>
                  {snapshot.totalRings > 0
                    ? `${snapshot.ring}/${snapshot.totalRings}`
                    : current.id === "free"
                      ? "Free flight"
                      : "Landing mission"}
                </span>
              </div>
            </div>
            <div className="flight-tools">
              <span className="wind-readout">
                <Wind size={17} />
                {snapshot.wind.toFixed(0)} <small>KT</small>
              </span>
              <button
                className="icon-button"
                title="Cycle camera (C)"
                aria-label="Cycle camera"
                onClick={() => game.current?.cycleCamera()}
              >
                <Camera size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Toggle flight audio"
                onClick={toggleSound}
              >
                {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
              </button>
              <button
                className="icon-button flight-help"
                title="Flight controls"
                aria-label="Flight controls"
                onClick={() => openPanel("controls")}
              >
                <CircleHelp size={19} />
              </button>
              <button
                className="icon-button"
                aria-label="Pause flight"
                onClick={() => game.current?.pause()}
              >
                <Pause size={19} />
              </button>
            </div>
          </header>
          <div
            className="compass"
            aria-label={`Heading ${heading.degrees} degrees ${heading.cardinal}`}
          >
            <strong>{heading.degrees}°</strong>
            <i />
            <span className="compass-cardinal">{heading.cardinal}</span>
          </div>
          {mode === "playing" && snapshot.target && (
            <div
              className={`target-label ${snapshot.target.visible ? "" : "offscreen"}`}
              style={{
                left: `${(snapshot.target.x * 0.5 + 0.5) * 100}%`,
                top: `${(-snapshot.target.y * 0.5 + 0.5) * 100}%`,
              }}
            >
              <span className="target-diamond">
                {snapshot.target.visible ? "" : <Navigation size={17} />}
              </span>
              <span>
                {snapshot.ring < snapshot.totalRings
                  ? String(snapshot.ring + 1).padStart(2, "0")
                  : current.land}{" "}
                <b>
                  {snapshot.target.distance > 1000
                    ? `${(snapshot.target.distance / 1000).toFixed(1)} km`
                    : `${Math.round(snapshot.target.distance)} m`}
                </b>
              </span>
            </div>
          )}
          {mode === "playing" && (
            <div className="center-reticle">
              <span />
              <i />
              <span />
            </div>
          )}
          <div className="flight-bottom">
            <div
              className={`telemetry ${instrumentsExpanded ? "expanded" : "compact"}`}
            >
              <div className="deck-status">
                <span>{aircraftName}</span>
                <b className={snapshot.stall ? "stall-status" : ""}>
                  {snapshot.stall
                    ? "STALL"
                    : snapshot.grounded
                      ? "ON RUNWAY"
                      : "AIRBORNE"}
                </b>
                <button
                  className="instrument-toggle"
                  aria-label={
                    instrumentsExpanded
                      ? "Collapse flight instruments"
                      : "Expand flight instruments"
                  }
                  aria-expanded={instrumentsExpanded}
                  title={
                    instrumentsExpanded
                      ? "Less detail"
                      : "Climb rate and instrument detail"
                  }
                  onClick={() => setInstrumentsExpanded(!instrumentsExpanded)}
                >
                  <ChevronDown size={16} />
                </button>
              </div>
              <div className="main-readouts">
                <div>
                  <label>AIRSPEED</label>
                  <strong>
                    {Math.round(snapshot.speed)}
                    <small>kn</small>
                  </strong>
                  <span className="sub-readout">
                    {snapshot.grounded
                      ? `ROTATE ${rotationKnots} KN`
                      : "AIR RELATIVE"}
                  </span>
                </div>
                <span className="readout-divider" />
                <div>
                  <label>ALTITUDE</label>
                  <strong>
                    {Math.round(snapshot.altitude)}
                    <small>ft</small>
                  </strong>
                  <span className="sub-readout">
                    {snapshot.grounded
                      ? "ON THE GROUND"
                      : `${Math.max(0, Math.round(snapshot.agl))} FT AGL`}
                  </span>
                </div>
              </div>
              {instrumentsExpanded && (
                <div className="climb-readout">
                  <span>CLIMB RATE</span>
                  <b>
                    {climb}
                    {climb !== "LEVEL" && <small> ft/min</small>}
                  </b>
                </div>
              )}
              <div className="secondary-readouts">
                <label>
                  THROTTLE <b>{Math.round(snapshot.throttle)}%</b>
                </label>
                <input
                  aria-label="Throttle"
                  onPointerUp={(e) => e.currentTarget.blur()}
                  type="range"
                  min="0"
                  max="100"
                  value={snapshot.throttle}
                  onChange={(e) => {
                    if (game.current)
                      game.current.physics.throttle =
                        Number(e.target.value) / 100;
                  }}
                />
                <div
                  className={`health ${snapshot.health < 70 ? "damaged" : ""}`}
                  aria-label={`Aircraft condition ${Math.round(snapshot.health)} percent`}
                  title="Aircraft condition"
                >
                  <Heart size={13} />
                  <span>{Math.round(snapshot.health)}%</span>
                </div>
              </div>
              {snapshot.health < 97 && (
                <div className="damage-parts">
                  {Object.entries(snapshot.damage)
                    .filter(([, d]) => d > 0.1)
                    .map(([part, d]) => (
                      <span key={part}>
                        {part} {Math.round((1 - d) * 100)}%
                      </span>
                    ))}
                </div>
              )}
            </div>
            {(flightWarning || (snapshot.grounded && snapshot.time < 18)) && (
              <div className="flight-center-bottom">
                <div
                  className={`flight-hint ${flightWarning ? "warning" : ""}`}
                >
                  {snapshot.grounded && !flightWarning
                    ? `Shift: power up · ↓ / S: raise nose at ${rotationKnots} kn · B: brake`
                    : snapshot.hint}
                </div>
              </div>
            )}
            <div className="map-wrap">
              <div className="flight-clock">
                <Timer size={14} />
                <span>
                  {current.id === "race"
                    ? time(Math.max(0, current.par * 1.5 - snapshot.time))
                    : time(snapshot.time)}
                </span>
                <small>
                  {current.id === "race" ? "REMAINING" : "FLIGHT TIME"}
                </small>
              </div>
              <MiniMap snapshot={snapshot} mission={current} />
            </div>
          </div>
          {mode === "playing" && (
            <div className="touch-controls">
              <div
                className="touch-stick"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (game.current)
                    game.current.touch = {
                      roll:
                        (e.clientX - rect.x - rect.width / 2) /
                        (rect.width / 2),
                      pitch:
                        (e.clientY - rect.y - rect.height / 2) /
                        (rect.height / 2),
                      yaw: 0,
                    };
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (game.current)
                    game.current.touch = {
                      roll: Math.max(
                        -1,
                        Math.min(
                          1,
                          (e.clientX - rect.x - rect.width / 2) /
                            (rect.width / 2),
                        ),
                      ),
                      pitch: Math.max(
                        -1,
                        Math.min(
                          1,
                          (e.clientY - rect.y - rect.height / 2) /
                            (rect.height / 2),
                        ),
                      ),
                      yaw: 0,
                    };
                }}
                onPointerUp={() => {
                  if (game.current)
                    game.current.touch = { pitch: 0, roll: 0, yaw: 0 };
                }}
                onPointerCancel={() => {
                  if (game.current)
                    game.current.touch = { pitch: 0, roll: 0, yaw: 0 };
                }}
              >
                <span>+</span>
                <small>FLY</small>
              </div>
              <button
                className="touch-brake"
                onPointerDown={() => game.current?.keys.add("KeyB")}
                onPointerUp={() => game.current?.keys.delete("KeyB")}
                onPointerLeave={() => game.current?.keys.delete("KeyB")}
                onPointerCancel={() => game.current?.keys.delete("KeyB")}
              >
                BRAKE
              </button>
            </div>
          )}
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
                      <b>Wheel brakes</b>
                      <small>Hold after touchdown to slow to a stop.</small>
                    </span>
                    <span>
                      <kbd>B</kbd>
                      <i>or</i>
                      <kbd>Space</kbd>
                    </span>
                  </div>
                  <div>
                    <span>
                      <b>Camera / free-look</b>
                      <small>Cycle views / hold right mouse and drag.</small>
                    </span>
                    <span>
                      <kbd>C</kbd>
                      <kbd>RMB</kbd>
                    </span>
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
                    the nose. Once airborne, release to let the flight
                    assistance trim.
                    {aircraftId === "finch"
                      ? " For landing, use 25–40% power and approach at 55–65 knots."
                      : " Landing gear retracts and deploys automatically. Reduce power gradually on approach."}{" "}
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
                    <b>Engine & atmosphere</b>
                  </span>
                  <button className="setting-toggle" onClick={toggleSound}>
                    {sound ? "Sound on" : "Sound off"}
                    {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                </div>
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
                {aircraftId === "finch" && (
                  <div className="setting-row paint-setting">
                    <span>
                      <Plane size={21} />
                      <b>Finch livery</b>
                    </span>
                    <div className="swatches">
                      {paints.map((p, i) => (
                        <button
                          key={p.name}
                          className={`swatch ${paint === i ? "selected" : ""}`}
                          style={{ "--paint": p.color } as React.CSSProperties}
                          aria-label={`${p.name} paint`}
                          aria-pressed={paint === i}
                          onClick={() => changePaint(i)}
                        >
                          {paint === i && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="pilot-tip">
                  <Heart size={23} />
                  <p>
                    Your paint, scores, and medals are saved in this browser.
                    Flight assistance is built in: gentle self-leveling,
                    coordinated turns, and automatic trim.
                  </p>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
