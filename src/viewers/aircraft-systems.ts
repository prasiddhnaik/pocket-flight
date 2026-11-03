import { paints } from "../aircraft/aircraft";
import { type FinchVariant, finchAttackPaints } from "../aircraft/finch/attack";
import type { AircraftId, AircraftModel } from "../aircraft/aircraft";
import {
  initialPreviewSettings,
  previewCapabilities,
  previewConfiguration,
  setPreviewRange,
  setPreviewToggle,
} from "./aircraft-preview";
import type {
  PreviewConfiguration,
  PreviewRange,
  PreviewToggle,
} from "./aircraft-preview";

const configurations = {
  parked: "Parked",
  clean: "Clean",
  landing: "Landing",
  inspect: "Inspect",
};
const ranges: PreviewRange[] = ["power", "roll", "pitch", "yaw", "flaps", "fuelLevel"];
const toggles: PreviewToggle[] = ["gear", "canopy", "burner", "airbrake", "fuelSystem"];
const axes = ["roll", "pitch", "yaw"] as const;
const setButton = (key: PreviewRange, value: number, label: string) =>
  `<button type="button" data-set="${key}" data-value="${value}">${label}</button>`;
const range = (
  key: PreviewRange,
  label: string,
  low: string,
  high: string,
  signed = false,
) => `
  <div class="system-range" ${key === "flaps" ? 'data-capability="flaps"' : ""}>
    <div class="range-heading"><label for="${key}">${label}</label><label class="percent-input"><input id="${key}-number" type="number" min="${signed ? -100 : 0}" max="100" step="1" value="0" aria-label="${label} percentage"><span>%</span></label></div>
    <input id="${key}" type="range" min="${signed ? -100 : 0}" max="100" step="1" value="0" aria-label="${label}" aria-describedby="${key}-directions">
    <div class="range-directions" id="${key}-directions"><span>${low}</span>${signed ? setButton(key, 0, "Center") : ""}<span>${high}</span></div>
    ${signed ? "" : `<div class="system-detents" aria-label="${label} shortcuts">${[0, 50, 100].map((value) => setButton(key, value, key === "power" && value === 0 ? "Off" : `${value}%`)).join("")}</div>`}
  </div>`;
const toggle = (key: PreviewToggle, label: string, off: string, on: string) => `
  <div class="system-switch" data-capability="${key}"><p id="${key}-label">${label}</p><div class="segmented" role="group" aria-labelledby="${key}-label">
    <button type="button" data-toggle="${key}" data-value="false" aria-pressed="false">${off}</button><button type="button" data-toggle="${key}" data-value="true" aria-pressed="false">${on}</button>
  </div></div>`;

export function mountAircraftSystems(
  root: HTMLFieldSetElement,
  options: {
    paint: number;
    onPaint: (paint: number) => void;
    onReset: () => void;
  },
) {
  root.innerHTML = `<legend>Aircraft systems</legend>
    <section class="systems-group configurations"><div class="system-heading"><h2>Quick configurations</h2><span id="configuration-name">Parked</span></div>
      <div class="configuration-buttons">${Object.entries(configurations)
        .map(
          ([key, name]) =>
            `<button type="button" data-configuration="${key}" aria-pressed="false">${name}</button>`,
        )
        .join("")}</div>
      <p class="system-note">Preview poses · engines off</p>
    </section>
    <section class="systems-group"><h2>Engine</h2>${range("power", "Engine power", "Off", "Full power")}
      ${toggle("burner", "Afterburner", "Disabled", "Enabled")}
      <p id="engine-position" class="system-readout">Engine off</p>
    </section>
    <section class="systems-group"><div class="system-heading"><h2>Flight controls</h2><button type="button" id="center-controls">Center all</button></div>
      ${range("roll", "Ailerons", "Left bank", "Right bank", true)}
      ${range("pitch", "Elevator / stabilators", "Nose down", "Nose up", true)}
      ${range("yaw", "Rudder", "Left", "Right", true)}
    </section>
    <section class="systems-group"><h2>Airframe</h2>${range("flaps", "Flaps", "Retracted", "Full extension")}
      ${toggle("gear", "Landing gear", "Retracted", "Down")}
      <p id="fixed-gear-note" class="system-note">Fixed landing gear · always down</p>
      ${toggle("canopy", "Canopy", "Closed", "Open")}
      <p id="canopy-note" class="system-note">Opening the canopy stops the engine. Adding power closes it.</p>
      ${toggle("airbrake", "Speedbrake", "Retracted", "Deployed")}
      <dl class="system-positions" aria-label="Current system positions"><div data-capability="flaps"><dt>FLAPS</dt><dd id="flaps-position">0%</dd></div><div data-capability="gear"><dt>GEAR</dt><dd id="gear-position">Down</dd></div><div data-capability="canopy"><dt>CANOPY</dt><dd id="canopy-position">Closed</dd></div><div data-capability="airbrake"><dt>SPEEDBRAKE</dt><dd id="airbrake-position">Retracted</dd></div></dl>
    </section>
    <section class="systems-group" data-capability="fuelSystem"><h2>Wing fuel</h2>
      ${toggle("fuelSystem", "Fuel system", "Hidden", "Shown")}
      ${range("fuelLevel", "Wing fuel", "Empty", "Full")}
      <p id="fuel-readout" class="system-readout"></p>
    </section>
    <section class="systems-group" data-capability="cannon"><h2>Cannon inspection</h2><button id="gun" type="button" aria-pressed="false">Hold to spin the cannon</button><p class="system-note">Release to stop · Space or Enter also works.</p><p id="gun-position" class="system-readout">Barrels stopped</p></section>
    <label class="paint-label" data-capability="paint" for="paint"><span id="paint-name">Finch livery</span><select id="paint">${paints.map((entry, index) => `<option value="${index}">${entry.name}</option>`).join("")}</select></label>
    <button id="reset" type="button">Reset all systems</button>
    <p id="system-message" class="system-message" role="status" aria-live="polite"></p>`;
  const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<E>(`#${id}`)!;
  const listeners = new AbortController(),
    on = { signal: listeners.signal };
  let id: AircraftId = "finch",
    state = initialPreviewSettings();
  let configuration: PreviewConfiguration | "custom" = "parked";
  const message = (text: string) => {
    $("system-message").textContent = text;
  };
  function sync() {
    $("fuel-readout").textContent = `${Math.round(state.fuelLevel * 1350).toLocaleString()} of 1,350 kg in each wing · three bladders`;
    for (const key of ranges) {
      const percent = Math.round(state[key] * 100);
      $<HTMLInputElement>(key).value = String(percent);
      $<HTMLInputElement>(`${key}-number`).value = String(percent);
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-toggle]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(
          state[button.dataset.toggle as PreviewToggle] ===
            (button.dataset.value === "true"),
        ),
      );
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-set]"))
      button.setAttribute(
        "aria-pressed",
        String(
          Math.round(state[button.dataset.set as PreviewRange] * 100) ===
            Number(button.dataset.value),
        ),
      );
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-configuration]",
    ))
      button.setAttribute(
        "aria-pressed",
        String(configuration === button.dataset.configuration),
      );
    $("configuration-name").textContent =
      configuration === "custom" ? "Custom" : configurations[configuration];
  }
  function releaseGun() {
    state.firing = false;
    $("gun").setAttribute("aria-pressed", "false");
  }
  function reset() {
    state = initialPreviewSettings();
    configuration = "parked";
    releaseGun();
    options.onReset();
    sync();
    message("All systems reset. Engine off, controls centered.");
  }
  function setRange(key: PreviewRange, percent: number) {
    const wasOpen = state.canopy;
    setPreviewRange(state, id, key, percent / 100);
    configuration = "custom";
    sync();
    message(wasOpen && !state.canopy ? "Canopy closing for engine power." : "");
  }
  root.addEventListener(
    "click",
    (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button",
      );
      if (!button || root.disabled) return;
      if (button.dataset.configuration) {
        configuration = button.dataset.configuration as PreviewConfiguration;
        state = { ...previewConfiguration(id, configuration), fuelSystem: state.fuelSystem, fuelLevel: state.fuelLevel };
        releaseGun();
        sync();
        message(
          `${configurations[configuration]} configuration selected. Engine off.`,
        );
      } else if (button.dataset.set) {
        setRange(
          button.dataset.set as PreviewRange,
          Number(button.dataset.value),
        );
      } else if (button.dataset.toggle) {
        const key = button.dataset.toggle as PreviewToggle,
          value = button.dataset.value === "true";
        const previousPower = state.power;
        setPreviewToggle(state, id, key, value);
        configuration = "custom";
        sync();
        message(
          key === "canopy" && value && previousPower > 0
            ? "Engine stopped. Canopy opening."
            : "",
        );
      } else if (button.id === "center-controls") {
        for (const key of axes) state[key] = 0;
        configuration = "custom";
        sync();
        message("Ailerons, pitch controls, and rudder centered.");
      } else if (button.id === "reset") reset();
    },
    on,
  );
  for (const key of ranges) {
    $(key).addEventListener(
      "input",
      () => setRange(key, $<HTMLInputElement>(key).valueAsNumber),
      on,
    );
    $(`${key}-number`).addEventListener(
      "change",
      () => setRange(key, $<HTMLInputElement>(`${key}-number`).valueAsNumber),
      on,
    );
  }
  $<HTMLSelectElement>("paint").value = String(options.paint);
  $("paint").addEventListener(
    "change",
    () => options.onPaint(Number($<HTMLSelectElement>("paint").value)),
    on,
  );
  function holdGun() {
    if (root.disabled || !previewCapabilities(id).cannon) return;
    state.firing = true;
    $("gun").setAttribute("aria-pressed", "true");
  }
  $("gun").addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0) return;
      $("gun").setPointerCapture(event.pointerId);
      holdGun();
    },
    on,
  );
  $("gun").addEventListener(
    "keydown",
    (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      event.preventDefault();
      holdGun();
    },
    on,
  );
  $("gun").addEventListener(
    "keyup",
    (event) => {
      if (event.key === " " || event.key === "Enter") releaseGun();
    },
    on,
  );
  for (const event of [
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "blur",
  ] as const)
    $("gun").addEventListener(event, releaseGun, on);
  window.addEventListener("blur", releaseGun, on);

  function position(
    value: number,
    target: boolean,
    low: string,
    high: string,
    decreasing: string,
    increasing: string,
  ) {
    return Math.abs(value - Number(target)) < 0.01
      ? target
        ? high
        : low
      : `${target ? increasing : decreasing} · ${Math.round(value * 100)}%`;
  }
  return {
    get state() {
      return state;
    },
    configure(next: AircraftId, variant: FinchVariant = "trainer", paint = 0) {
      id = next;
      // The A-2 offers its tactical schemes in place of the trainer liveries.
      const schemes = variant === "attack" ? finchAttackPaints : paints;
      $("paint-name").textContent = variant === "attack" ? "A–2 scheme" : "Finch livery";
      $<HTMLSelectElement>("paint").innerHTML = schemes.map((entry, index) => `<option value="${index}">${entry.name}</option>`).join("");
      $<HTMLSelectElement>("paint").value = String(paint);
      const capabilities = previewCapabilities(id);
      for (const element of root.querySelectorAll<HTMLElement>(
        "[data-capability]",
      ))
        element.hidden =
          !capabilities[
            element.dataset.capability as keyof typeof capabilities
          ];
      $("fixed-gear-note").hidden = capabilities.gear;
      $("canopy-note").hidden = !capabilities.canopy;
      reset();
      message("");
    },
    updatePositions(aircraft: AircraftModel) {
      const motion = aircraft.effects?.motion;
      $("engine-position").textContent = motion
        ? `Power ${Math.round(motion.rpm * 100)}%${previewCapabilities(id).burner ? (motion.burner > 0.05 ? " · Afterburner active" : state.burner ? " · Afterburner standby" : " · Afterburner disabled") : ""}`
        : `Propeller ${Math.round(aircraft.propellerMotion.snapshot().rpm).toLocaleString()} RPM`;
      $("flaps-position").textContent =
        `${Math.round((motion?.flaps ?? state.flaps) * 100)}%`;
      $("gear-position").textContent = position(
        motion?.gear ?? 1,
        state.gear,
        "Retracted",
        "Down",
        "Retracting",
        "Lowering",
      );
      $("canopy-position").textContent = position(
        motion?.canopy ?? 0,
        state.canopy,
        "Closed",
        "Open",
        "Closing",
        "Opening",
      );
      $("airbrake-position").textContent = position(
        motion?.speedBrake ?? 0,
        state.airbrake,
        "Retracted",
        "Deployed",
        "Retracting",
        "Deploying",
      );
      $("gun-position").textContent =
        (motion?.gunSpeed ?? 0) > 0.1
          ? `Barrels ${Math.round((motion!.gunSpeed * 60) / (2 * Math.PI)).toLocaleString()} RPM`
          : "Barrels stopped";
    },
    releaseGun,
    dispose() {
      releaseGun();
      listeners.abort();
    },
  };
}
