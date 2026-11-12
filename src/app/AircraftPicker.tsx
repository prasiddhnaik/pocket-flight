import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plane } from "lucide-react";
import type { AircraftChoice } from "./flight-ui";
import "./AircraftPicker.css";

const fleet: { id: AircraftChoice; name: string; model: string }[] = [
  { id: "finch", name: "The Finch", model: "U–2" },
  { id: "finch-attack", name: "Finch A–2", model: "Attack" },
  { id: "peregrine", name: "Peregrine", model: "HX–27" },
  { id: "aurelia", name: "Aurelia", model: "S32" },
  { id: "stormbird", name: "Stormbird", model: "HX–40" },
  { id: "heron", name: "Heron", model: "UT–9" },
  { id: "f15c", name: "F-15C", model: "Eagle" },
];

export function AircraftPicker({
  value,
  disabled,
  onChange,
}: {
  value: AircraftChoice;
  disabled: boolean;
  onChange: (value: AircraftChoice) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<CSSProperties>({});
  const selected = fleet.findIndex((aircraft) => aircraft.id === value);

  function show(index = selected) {
    setActive(index);
    setOpen(true);
  }

  function choose(index: number) {
    setOpen(false);
    if (fleet[index].id !== value) {
      restoreFocus.current = true;
      onChange(fleet[index].id);
    }
    trigger.current?.focus();
  }

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const above = rect.top - 20;
      const below = innerHeight - rect.bottom - 20;
      const width = Math.min(320, innerWidth - 24);
      setPosition({
        width,
        left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
        maxHeight: Math.min(400, Math.max(above, below)),
        ...(above > below
          ? { bottom: innerHeight - rect.top + 10 }
          : { top: rect.bottom + 10 }),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !menu.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
    else if (restoreFocus.current) {
      if (document.activeElement === document.body) trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [disabled, value]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key;
    if (key === "Tab") {
      event.stopPropagation();
      if (open) choose(active);
      return;
    }
    if (key === "Escape" && !open) return;
    if (
      ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(
        key,
      )
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (key === "Escape") setOpen(false);
      else if (key === "Enter" || key === " ") open ? choose(active) : show();
      else if (key === "Home") show(0);
      else if (key === "End") show(fleet.length - 1);
      else if (!open) show();
      else
        setActive((index) =>
          Math.max(
            0,
            Math.min(fleet.length - 1, index + (key === "ArrowDown" ? 1 : -1)),
          ),
        );
    } else if (
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      search.current = {
        text:
          (now - search.current.time < 700 ? search.current.text : "") +
          key.toLowerCase(),
        time: now,
      };
      const match = fleet.findIndex((aircraft) =>
        `${aircraft.name} ${aircraft.model}`
          .toLowerCase()
          .startsWith(search.current.text),
      );
      if (match >= 0) show(match);
    }
  }

  return (
    <span className="aircraft-picker">
      <button
        ref={trigger}
        className="aircraft-picker-trigger"
        type="button"
        role="combobox"
        aria-label="Choose aircraft"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span>
          {fleet[selected].name}{" "}
          <span className="aircraft-picker-model">
            · {fleet[selected].model}
          </span>
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            className="aircraft-menu"
            ref={menu}
            style={position}
            onPointerDown={(event) => event.preventDefault()}
          >
            <div className="aircraft-menu-heading" aria-hidden="true">
              <span>Choose your aircraft</span>
              <span>{String(fleet.length).padStart(2, "0")} AIRCRAFT</span>
            </div>
            <div
              className="aircraft-menu-options"
              role="listbox"
              aria-label="Aircraft"
              id={id}
            >
              {fleet.map((aircraft, index) => (
                <div
                  key={aircraft.id}
                  id={`${id}-${index}`}
                  role="option"
                  aria-selected={aircraft.id === value}
                  className={`aircraft-menu-option${index === active ? " active" : ""}`}
                  onPointerMove={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <Plane size={18} aria-hidden="true" />
                  <span className="aircraft-menu-name">{aircraft.name}</span>
                  <span className="aircraft-menu-model">{aircraft.model}</span>
                  {aircraft.id === value ? (
                    <Check size={16} aria-hidden="true" />
                  ) : (
                    <span className="aircraft-menu-check" />
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
}
