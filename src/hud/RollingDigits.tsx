// Odometer readout: each digit is a 0–9 strip that rolls; other glyphs (−, comma, °) render as-is.
export function RollingDigits({ value }: { value: string }) {
  const chars = [...value];
  return (
    <span className="hud-digits" aria-hidden="true">
      {chars.map((ch, i) => {
        const key = chars.length - i; // right-aligned keys keep columns stable as numbers grow
        return /\d/.test(ch) ? (
          <span key={key} className="hud-digit">
            <span style={{ transform: `translateY(calc(${-Number(ch)} * var(--digit-h)))` }}>
              {"0123456789".split("").map((d) => (
                <i key={d}>{d}</i>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${key}${ch}`} className="hud-glyph">
            {ch}
          </span>
        );
      })}
    </span>
  );
}
