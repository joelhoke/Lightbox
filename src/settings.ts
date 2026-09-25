import { LIGHTING } from './config.ts';

export type LightMode = 'temperature' | 'custom';

export interface LightingSettings {
  brightness: number;
  lightMode: LightMode;
  temperature: number;
  customLightColor: string;
  wallColor: string;
  wallDistance: number;
}

/** Approximate blackbody color in display sRGB; artistic control, not spectral rendering. */
export function temperatureToHex(kelvin: number): string {
  const temperature = Math.max(LIGHTING.temperature.min, Math.min(LIGHTING.temperature.max, kelvin)) / 100;
  const green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
  const blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  const hex = (value: number) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0');
  return `#ff${hex(green)}${hex(blue)}`;
}

export const DEFAULT_SETTINGS: Readonly<LightingSettings> = Object.freeze({
  brightness: LIGHTING.brightness.default,
  lightMode: 'temperature',
  temperature: LIGHTING.temperature.default,
  customLightColor: temperatureToHex(LIGHTING.temperature.default),
  wallColor: LIGHTING.wallColor,
  wallDistance: LIGHTING.wallDistance.default,
});

export function normalizeHex(value: string): string | null {
  const cleaned = value.trim();
  const match = /^#?([a-f\d]{6}|[a-f\d]{3})$/i.exec(cleaned);
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join('') : match[1];
  return `#${digits.toLowerCase()}`;
}

export function lightColor(settings: LightingSettings): string {
  return settings.lightMode === 'temperature' ? temperatureToHex(settings.temperature) : settings.customLightColor;
}

/** Sanitize API changes too, so invalid colors/numbers never reach the renderer. */
export function updateSettings(current: LightingSettings, patch: Partial<LightingSettings>): LightingSettings {
  const next = { ...current };
  const number = (value: number | undefined, min: number, max: number, previous: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : previous;
  next.brightness = number(patch.brightness, LIGHTING.brightness.min, LIGHTING.brightness.max, current.brightness);
  next.temperature = number(patch.temperature, LIGHTING.temperature.min, LIGHTING.temperature.max, current.temperature);
  next.wallDistance = number(patch.wallDistance, LIGHTING.wallDistance.min, LIGHTING.wallDistance.max, current.wallDistance);
  if (patch.lightMode === 'custom' || patch.lightMode === 'temperature') next.lightMode = patch.lightMode;
  if (typeof patch.customLightColor === 'string') next.customLightColor = normalizeHex(patch.customLightColor) ?? current.customLightColor;
  if (typeof patch.wallColor === 'string') next.wallColor = normalizeHex(patch.wallColor) ?? current.wallColor;
  return next;
}
