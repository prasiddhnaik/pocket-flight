import { useEffect, useState } from "react";
import { type Vec3 } from "../studio-scene";

export function NumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(+value.toFixed(3)));
  useEffect(() => setText(String(+value.toFixed(3))), [value]);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const number = Number(text);
          if (text.trim() && Number.isFinite(number))
            onChange(Math.min(max, Math.max(min, number)));
          else setText(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function VectorFields({
  name,
  value,
  onChange,
  min = -100000,
  step = 0.1,
}: {
  name: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  min?: number;
  step?: number;
}) {
  return (
    <div className="scene-vector">
      <span>{name}</span>
      <div>
        {["X", "Y", "Z"].map((axis, i) => (
          <NumberField
            key={axis}
            label={`${name} ${axis}`}
            value={value[i]}
            min={min}
            step={step}
            onChange={(n) => {
              const next = [...value] as Vec3;
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

export function XIcon() {
  return <span aria-hidden="true">×</span>;
}
