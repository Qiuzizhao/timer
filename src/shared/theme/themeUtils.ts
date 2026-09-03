import { colors as baseColors } from '../../theme';

export type RuntimeThemeColors = typeof baseColors;

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_RUNTIME_PRIMARY = '#E03131';
const DEFAULT_RUNTIME_PRIMARY_DARK = '#C92A2A';

function toHexChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
}

export function isHexColor(value?: string | null) {
  return Boolean(value && HEX_COLOR_PATTERN.test(value));
}

export function darkenHexColor(value?: string | null, amount = 0.12) {
  if (!isHexColor(value)) return DEFAULT_RUNTIME_PRIMARY_DARK;

  const source = value as string;
  const factor = 1 - amount;
  const red = Number.parseInt(source.slice(1, 3), 16);
  const green = Number.parseInt(source.slice(3, 5), 16);
  const blue = Number.parseInt(source.slice(5, 7), 16);

  return `#${toHexChannel(red * factor)}${toHexChannel(green * factor)}${toHexChannel(blue * factor)}`;
}

export function buildThemeColors(primaryColor?: string | null): RuntimeThemeColors {
  const primary = isHexColor(primaryColor) ? primaryColor!.toUpperCase() : DEFAULT_RUNTIME_PRIMARY;

  return {
    ...baseColors,
    primary,
    primaryDark: primary === DEFAULT_RUNTIME_PRIMARY ? DEFAULT_RUNTIME_PRIMARY_DARK : darkenHexColor(primary),
    primarySoft: `${primary}15`,
  };
}
