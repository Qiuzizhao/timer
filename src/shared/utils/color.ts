const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{6})$/;
const HSL_COLOR_PATTERN = /^hsl\((.+)\)$/;

export function colorWithAlpha(color: string, alpha = 0.12) {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const hexMatch = color.match(HEX_COLOR_PATTERN);

  if (hexMatch) {
    const value = hexMatch[1];
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${clampedAlpha})`;
  }

  const hslMatch = color.match(HSL_COLOR_PATTERN);
  if (hslMatch) return `hsla(${hslMatch[1]}, ${clampedAlpha})`;

  return color;
}
