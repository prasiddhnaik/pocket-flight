/** Reads a dial's stops: value to degrees clockwise from twelve o'clock. */
export function dialAngle(stops: readonly (readonly number[])[], value: number) {
  if (value <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [high, end] = stops[i];
    if (value <= high) {
      const [low, start] = stops[i - 1];
      return start + ((end - start) * (value - low)) / (high - low);
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Digit each counter drum shows, largest place first. Only the lowest drum turns
 * smoothly; the others step over as the drum below passes nine.
 */
export function counterRolls(value: number, places: readonly number[]) {
  const reading = Math.max(0, value);
  const rolls = new Array<number>(places.length);
  let carry = 0;
  for (let i = places.length - 1; i >= 0; i--) {
    const whole = Math.floor(reading / places[i]) % 10;
    const roll = i === places.length - 1 ? (reading / places[i]) % 10 : whole + carry;
    rolls[i] = roll;
    carry = Math.max(0, roll - 9);
  }
  return rolls;
}
