import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, CircleHelp, Navigation, Pause, Volume2, VolumeX, Wind } from "lucide-react";
import type { AircraftId } from "../aircraft/aircraft";
import type { PocketFlight, Snapshot } from "../flight/game";
import type { Mission } from "../flight/missions";
import { Betty } from "../audio/betty";
import { cockpitSpecs } from "../aircraft/cockpit-specs";
import { hasSpeedBrake } from "../flight/flight-envelope";
import { flightProfiles } from "../flight/flight-profiles";
import { aircraftNames, climbReadout, formatClock } from "../app/flight-ui";
import { BarGauge } from "./BarGauge";
import { isNewFlight } from "./boot";
import { landingCue } from "./landing-cue";
import { CompassRose } from "./CompassRose";
import { Dial } from "./Dial";
import { airspeedScale, clamp01 } from "./geometry";
import { SlotGauge } from "./SlotGauge";
import { TouchControls } from "./TouchControls";
import { prefersReducedMotion } from "./useSpring";
import { WarningBanner } from "./WarningBanner";
import { evaluateWarnings, freshLatch, type WarningId } from "./warnings";
import "./hud.css";

export type FlightHudProps = {
  game: PocketFlight | null;
  snapshot: Snapshot;
  mission: Mission;
  aircraftId: AircraftId;
  beginnerAssist: boolean;
  automaticConfiguration: boolean;
  sound: boolean;
  voiceWarnings: boolean;
  map: ReactNode;
  onToggleSound: () => void;
  onOpenControls: () => void;
};

type BootPhase = "off" | "sweep" | "return";

function useBoot(mode: Snapshot["mode"], time: number) {
  const [phase, setPhase] = useState<BootPhase>("off");
  const [flight, setFlight] = useState<{ mode: Snapshot["mode"]; time: number; key: number | null }>({
    mode: "menu", time: 0, key: null,
  });
  // Derive the key before effects so StrictMode can replay the same timers.
  if (flight.mode !== mode || flight.time !== time) {
    setFlight({
      mode, time,
      key: isNewFlight(flight.mode, flight.time, mode, time)
        ? (flight.key ?? 0) + 1
        : mode === "playing" ? flight.key : null,
    });
  }
  useEffect(() => {
    if (flight.key === null || prefersReducedMotion()) {
      setPhase("off");
      return;
    }
    setPhase("sweep");
    const back = setTimeout(() => setPhase("return"), 550);
    const done = setTimeout(() => setPhase("off"), 1200);
    return () => {
      clearTimeout(back);
      clearTimeout(done);
    };
  }, [flight.key]);
  return phase;
}

export function FlightHud({
  game, snapshot: s, mission, aircraftId, beginnerAssist, automaticConfiguration,
  sound, voiceWarnings, map, onToggleSound, onOpenControls,
}: FlightHudProps) {
  const boot = useBoot(s.mode, s.time);
  const sweeping = boot === "sweep";
  const latch = useRef(freshLatch());
  const betty = useRef<Betty | null>(null);
  const [warnings, setWarnings] = useState<WarningId[]>([]);
  const profile = flightProfiles[aircraftId];
  const jet = aircraftId !== "finch" && aircraftId !== "heron";
  const cue = landingCue({
    active: s.mode === "playing" && s.slowingToLand && !s.grounded,
    speed: s.speed,
    approachKnots: profile.approachKnots,
    speedBrake: hasSpeedBrake(aircraftId),
  });

  useEffect(() => {
    if (game && !betty.current) betty.current = new Betty(game.audio);
    // A fresh flight (clock restarted, full health) starts with clean one-shot warnings.
    if (s.time < 1 && s.health >= 99.9) latch.current = freshLatch();
    const r = evaluateWarnings(
      { ...s, fuelFraction: s.instruments.fuelFraction, jet, approachKnots: profile.approachKnots },
      latch.current,
      s.time,
    );
    latch.current = r.latch;
    setWarnings((previous) => previous.length === r.active.length && previous.every((id, i) => id === r.active[i])
      ? previous : r.active);
    if (betty.current) {
      betty.current.enabled = voiceWarnings;
      betty.current.update(s.crashed ? [] : r.active, performance.now() / 1000);
    }
  }, [s, game, jet, profile.approachKnots, voiceWarnings]);

  useEffect(() => () => betty.current?.silence(), []);

  const speed = airspeedScale(aircraftId);
  const engine = s.instruments.engine;
  const fuel = s.instruments.fuelFraction;
  const aoa = clamp01(s.instruments.aoaDegrees / Math.max(1, s.instruments.stallAoaDegrees));
  const climbFpm = s.verticalSpeed * 196.8504;
  const damaged = Object.entries(s.damage).filter(([, d]) => d > 0.1);
  const gearState = s.gearPosition > 0.995 ? "down" : s.gearPosition < 0.005 ? "up" : "moving";
  const flightWarning = s.stall || s.hint.startsWith("Engine out");

  return (
    <div className={`holo-hud ${boot !== "off" ? "booting" : ""} ${s.camera === "cockpit" && cockpitSpecs[aircraftId] ? "hud-in-cockpit" : ""}`}>
      <WarningBanner warning={warnings[0] ?? null} />

      <CompassRose heading={s.heading} />

      <header className="hud-objective hud-glass">
        <span className="hud-label">{mission.name}</span>
        <h3>{s.objective}</h3>
        <div className="hud-progress">
          {Array.from({ length: s.totalRings }, (_, i) => (
            <i key={i} className={i < s.ring ? "done" : i === s.ring ? "next" : ""} />
          ))}
          <span>
            {s.totalRings > 0 ? `${s.ring}/${s.totalRings}` : mission.id === "free" ? "FREE FLIGHT" : mission.id === "combat" ? "FREE RANGE" : "LANDING MISSION"}
          </span>
        </div>
      </header>

      <div className="hud-tools">
        <span className="hud-wind hud-glass" title="Wind">
          <Wind size={16} />
          {s.wind.toFixed(0)} <small>KT</small>
        </span>
        <button className="hud-glass" title="Cycle camera (C)" aria-label="Cycle camera" onClick={() => game?.cycleCamera()}>
          <Camera size={18} />
        </button>
        <button className="hud-glass" aria-label="Toggle flight audio" onClick={onToggleSound}>
          {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button className="hud-glass hud-help" title="Flight controls" aria-label="Flight controls" onClick={onOpenControls}>
          <CircleHelp size={18} />
        </button>
        <button className="hud-glass" aria-label="Pause flight" onClick={() => game?.pause()}>
          <Pause size={18} />
        </button>
      </div>

      <div className="hud-map">
        {map}
        <div className="hud-clock hud-glass">
          <b>{formatClock(mission.id === "race" ? mission.par * 1.5 - s.time : s.time)}</b>
          <span className="hud-label">{mission.id === "race" ? "REMAINING" : "FLIGHT TIME"}</span>
        </div>
      </div>

      {s.mode === "playing" && s.target && (
        <div
          className={`target-label ${s.target.visible ? "" : "offscreen"}`}
          style={{ left: `${(s.target.x * 0.5 + 0.5) * 100}%`, top: `${(-s.target.y * 0.5 + 0.5) * 100}%` }}
        >
          <span className="target-diamond">{s.target.visible ? "" : <Navigation size={17} />}</span>
          <span>
            {s.ring < s.totalRings ? String(s.ring + 1).padStart(2, "0") : mission.land}{" "}
            <b>{s.target.distance > 1000 ? `${(s.target.distance / 1000).toFixed(1)} km` : `${Math.round(s.target.distance)} m`}</b>
          </span>
        </div>
      )}
      {s.mode === "playing" && (
        <div className="center-reticle">
          <span />
          <i />
          <span />
        </div>
      )}

      <section className="hud-cluster hud-left" aria-label="Flight instruments">
        <div className="hud-status">
          {aircraftNames[aircraftId].toUpperCase()} <b className={s.grounded ? "ground" : ""}>· {s.grounded ? "ON RUNWAY" : "AIRBORNE"}</b>
        </div>
        {s.health < 97 && (
          <div className="hud-damage hud-glass">
            HULL {Math.round(s.health)}%
            {damaged.map(([part, d]) => ` · ${part.toUpperCase()} ${Math.round((1 - d) * 100)}%`).join("")}
          </div>
        )}
        {cue && <div className={`hud-landing-cue hud-glass ${cue.state}`}>{cue.text}</div>}
        <div className="hud-row">
          <Dial
            label="KNOTS" size="large" min={0} max={speed.max} value={sweeping ? speed.max : s.speed}
            majorStep={speed.majorStep} minorStep={speed.minorStep} bands={speed.bands} redline={speed.redline}
            readout={String(Math.round(s.speed))}
          />
          {engine.kind === "propeller" ? (
            <Dial
              className="hud-engine" label="RPM" size="small" min={0} max={3000} value={sweeping ? 3000 : engine.rpm}
              majorStep={500} minorStep={100} tickLabel={(v) => String(v / 100)}
              bands={[{ from: 2000, to: 2500, tone: "green" }]} redline={2500}
              readout={Math.round(engine.rpm).toLocaleString("en-US")}
            />
          ) : (
            <Dial
              className="hud-engine" label="THRUST" size="small" min={0} max={100} value={sweeping ? 100 : engine.percent}
              majorStep={20} minorStep={5}
              bands={profile.afterburner > 0 ? [{ from: 88, to: 100, tone: "amber" }] : []}
              readout={String(Math.round(engine.percent))} unit="%"
            />
          )}
          <div className="hud-bars">
            <BarGauge
              label="THR" tone="cyan" fraction={sweeping ? 1 : s.throttle / 100} readout={`${Math.round(s.throttle)}%`}
              onDrag={(f) => {
                if (game) game.physics.throttle = f;
              }}
            />
            <BarGauge
              label="FUEL" tone={fuel <= 0.1 ? "red" : fuel <= 0.2 ? "amber" : "green"}
              fraction={sweeping ? 1 : fuel} readout={`${Math.round(fuel * 100)}%`}
            />
            <BarGauge
              label="AOA" segments={8} fraction={sweeping ? 1 : aoa} pulse={aoa >= 0.85}
              readout={`${Math.round(s.instruments.aoaDegrees)}°`}
            />
          </div>
        </div>
      </section>

      <section className="hud-cluster hud-right" aria-label="Configuration and vertical speed">
        {jet && (
          <div className={`hud-gear hud-glass ${gearState}`} role="img" aria-label={`Landing gear ${gearState}`}>
            <i />
            <i />
            <i />
            <span className="hud-label">GEAR</span>
            <b>{s.automaticConfiguration ? "AUTO" : "MAN"}</b>
          </div>
        )}
        {s.speedBrake > 0.05 && <div className="hud-speed-brake hud-glass">SPEED BRAKE</div>}
        <div className="hud-row">
          <div className="hud-slots">
            {aircraftId !== "finch" && <SlotGauge label="FLAPS" position={s.flapPosition} readout={`${Math.round(s.flapPosition * 100)}%`} />}
            {!beginnerAssist && (
              <SlotGauge label="TRIM" position={0.5 - s.elevatorTrim / 2} readout={`${s.elevatorTrim > 0 ? "+" : ""}${Math.round(s.elevatorTrim * 100)}`} />
            )}
          </div>
          <Dial
            label="V.SPEED" size="small" min={-2000} max={2000} start={15} sweep={330}
            value={sweeping ? 2000 : climbFpm} majorStep={1000} minorStep={250}
            tickLabel={(v) => String(Math.abs(v / 1000))} readout={climbReadout(s.verticalSpeed)}
          />
        </div>
      </section>

      {(flightWarning || (s.grounded && s.time < 18)) && (
        <div className="flight-center-bottom">
          <div className={`flight-hint ${flightWarning ? "warning" : ""}`}>
            {s.grounded && !flightWarning
              ? `Shift: power up · ↓ / S: raise nose at ${profile.rotationKnots} kn · B: brake`
              : s.hint}
          </div>
        </div>
      )}

      {s.mode === "playing" && (
        <TouchControls game={game} aircraftId={aircraftId} automaticConfiguration={automaticConfiguration} beginnerAssist={beginnerAssist} />
      )}
    </div>
  );
}
