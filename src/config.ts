/** All distances are metres unless a label says otherwise. These are design defaults, not engine limits. */
export const LIGHTING = {
  brightness: { min: 0, max: 200, step: 1, default: 100 },
  temperature: { min: 1800, max: 4000, step: 50, default: 2400 },
  wallDistance: { min: 0.15, max: 1, step: 0.01, default: 0.35 },
  wallColor: '#303030',
  intensity: 1.4, // Actual point-light intensity at 100% brightness.
  filamentEmission: 7, // Visible filament brightness, independent of light cast on the wall.
  ambient: 0.22,
  environment: 0.3,
  bloom: { strength: 0.32, radius: 0.35, threshold: 1.1 },
} as const;

export const VIEW = {
  cameraZ: 1.45, fieldOfView: 40, maxPixelRatio: 2, shadowSize: 1024,
  bulbHeight: 0.2, bulbTop: 0.3, socketTop: 0.34, socketBottom: 0.249,
  cordRadius: 0.0023,
} as const;

export const GLASS = {
  transmission: 1, ior: 1.46, roughness: 0.055, environmentIntensity: 0.7,
  opticalDepth: 0.03, // Metres of effective lens depth, NOT physical shell thickness. Lower = less distortion.
} as const;

export const CORD = {
  anchor: { x: 0, y: 0.65 },
  length: 0.31, segments: 12,
  gravity: 9.81, // Metres/second². Lower for a deliberately slower, dreamlike motion.
  compliance: 0.00004, // Larger = softer springs. Zero = rigid segment lengths.
  maxStretch: 0.15, // Original elastic allowance, separate from cord paid out at the ceiling.
  extraLength: 0.10, // Metres of additional cord available during a drag (31 cm → 41 cm).
  payoutSpeed: 0.25, // Metres/second fed out only when the pointer demands more length.
  retractSpeed: 0.035, // Metres/second reeled in after release; 10 cm takes about 2.9 seconds.
  damping: 1.8, // Velocity damping per second. Larger = settles sooner.
  cordMass: 0.03, bulbMass: 1,
  timestep: 1 / 120, maxSubsteps: 8, iterations: 18,
  maxReleaseSpeed: 1.6, // Metres/second, prevents a fast pointer flick exploding the simulation.
  sleepSpeed: 0.018, sleepOffset: 0.008, sleepDelay: 0.7,
} as const;

export const CONTENT = {
  x: { min: -2, max: 2, step: 0.01, default: 0 },
  y: { min: -2, max: 2, step: 0.01, default: -0.15 },
  size: { min: 0.015, max: 0.2, step: 0.005, default: 0.06 },
  width: { min: 0.05, max: 1.5, step: 0.01, default: 0.38 },
  rotation: { min: -180, max: 180, step: 1, default: 0 }, // Image rotation in degrees clockwise, in the wall plane.
  offset: { min: 0, max: 0.3, step: 0.005, default: 0 },
  thickness: { min: 0.001, max: 0.06, step: 0.001, default: 0.01 },
  color: '#eee6d8', text: 'Hello, light.',
  maxItems: 20, maxTextLength: 1000,
  maxImageBytes: 10 * 1024 * 1024, // Limit decoding/export size, not the image's dimensions in the scene.
  maxImagePixels: 32_000_000,
  maxTextureSize: 2048, // Imported images are downsampled before embedding in a project.
  maxProjectBytes: 50 * 1024 * 1024,
  surfaceEpsilon: 0.001, alphaTest: 0.1,
  imageAlphaTest: 1 / 255, // Discard only effectively transparent image pixels; blend soft fades.
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontAsset: 'fonts/helvetiker_regular.typeface.json',
} as const;

export const STICKER = {
  corner: 'bottom-right' as const,
  curl: { min: 0, max: 100, step: 1, default: 70 }, // Percent of maxAngle, not centimetres.
  peelArea: { min: 10, max: 75, step: 1, default: 35 }, // Percent of the visible image's shorter side.
  maxAngle: 150, // Degrees. Keep below 180 to avoid rolling the corner onto itself.
  segments: 64, // Grid divisions per axis. Higher improves tight curls at a geometry cost.
  backingColor: '#f2ecdf', roughness: 0.9,
  hover: {
    strength: 0.20, // Fraction of saved curl removed at closest approach (70 → 56).
    radiusScale: 1.25, minRadius: 48, maxRadius: 140, // Projected peel depth; CSS pixels, independent of DPR.
    approachTime: 0.120, returnTime: 0.250, // Exponential time constants in seconds; no spring/overshoot.
    settleEpsilon: 0.0001, maxDelta: 0.05, // Normalized influence tolerance; bound background catch-up.
  },
} as const;

export type NumericRange = { readonly min: number; readonly max: number; readonly step: number; readonly default: number };
export const clamp = (value: number, range: Pick<NumericRange, 'min' | 'max'>) => Math.min(range.max, Math.max(range.min, value));
