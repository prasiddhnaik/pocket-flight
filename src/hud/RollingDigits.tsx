// Odometer readout: each digit rolls on a boundary-padded 9, 0–9, 0 strip; other glyphs (−, comma, °) render as-is.
export function RollingDigits({ value }: { value: string }) {
  const chars = [...value];
  return (
    <span className="hud-digits" aria-hidden="true">
      {chars.map((ch, i) => {
        const key = chars.length - i; // right-aligned keys keep columns stable as numbers grow
        return /\d/.test(ch) ? (
          <span key={key} className="hud-digit">
            <span style={{ transform: `translateY(calc(${-(Number(ch) + 1)} * var(--digit-h)))` }}>
              {"901234567890".split("").map((d, row) => (
                <i key={row}>{d}</i>
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
