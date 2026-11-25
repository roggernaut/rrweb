/** Target one second for a ten-second gap, plus 250 ms per doubling. */
export function inactiveSkipSpeed(
  remaining: number,
  tempo: number,
  maxSpeed: number,
  adaptive = true,
) {
  if (!adaptive) {
    const classicRate = Math.max(tempo * 2, Math.round(remaining / 5000));
    return Math.min(maxSpeed, classicRate);
  }
  const target =
    Math.min(3000, Math.max(250, 1000 + 250 * Math.log2(remaining / 10000))) /
    tempo;
  return Math.min(maxSpeed, Math.max(10 * tempo, remaining / target));
}
