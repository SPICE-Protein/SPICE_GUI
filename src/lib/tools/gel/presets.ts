// Stain presets and the detection configuration they drive.
//
// A preset bundles the colour channel, band polarity, gel type and display
// mode that suit one staining method. The advanced panel can override every
// field; changing one turns the preset into "custom" without losing the rest.
import type { DisplayMode, GelType } from './types';

export type DetectChannel = 'auto' | 'luma' | 'red' | 'green' | 'blue' | 'red-blue' | 'green-red';
export type DetectPolarity = 'auto' | 'bright' | 'dark';
export type DetectTypeMode = 'auto' | GelType;

export interface LaneDetectOptions {
  /** Active-run cut as a fraction of the strongest column. */
  cut: number;
  /** Gaps up to this fraction of the image width merge into one lane. */
  mergeGap: number;
  /** Minimum lane width as a fraction of the image width. */
  minWidth: number;
  /** Smoothing window as a fraction of the image width. */
  smooth: number;
  /** Minimum peak prominence as a fraction of the normalised profile. */
  prominence: number;
}

export interface BandDetectOptions {
  /** Peak prominence gate, in profile standard deviations. */
  prominence: number;
  /** Minimum gap between bands as a fraction of the image height. */
  minGap: number;
  /** Smoothing window in pixels; protein gels add two pixels. */
  smooth: number;
}

export interface GelDetectConfig {
  presetId: string;
  type: DetectTypeMode;
  channel: DetectChannel;
  polarity: DetectPolarity;
  /** 0..1; higher keeps fainter signal. */
  sensitivity: number;
  /** Morphological opening radius on the native backend, 0..2. */
  denoise: number;
  lanes: LaneDetectOptions;
  bands: BandDetectOptions;
}

export interface StainPreset {
  id: string;
  /** Paraglide message key for the selector label. */
  labelKey: string;
  /** Display mode applied together with the preset, when set. */
  display?: DisplayMode;
  config: GelDetectConfig;
}

export const DETECT_CHANNELS: DetectChannel[] = [
  'auto',
  'luma',
  'red',
  'green',
  'blue',
  'red-blue',
  'green-red',
];

export const DETECT_POLARITIES: DetectPolarity[] = ['auto', 'bright', 'dark'];
export const DETECT_TYPE_MODES: DetectTypeMode[] = ['auto', 'dna', 'protein'];

/** Sensitivity that maps to the thresholds the tool shipped with. */
export const DEFAULT_SENSITIVITY = 0.35;

export function defaultDetectConfig(): GelDetectConfig {
  return {
    presetId: 'auto',
    type: 'auto',
    channel: 'auto',
    polarity: 'auto',
    sensitivity: DEFAULT_SENSITIVITY,
    denoise: 1,
    lanes: {
      cut: 0.08,
      mergeGap: 0.005,
      minWidth: 0.004,
      smooth: 0.02,
      prominence: 0.1,
    },
    bands: {
      prominence: 0.5,
      minGap: 0.006,
      smooth: 3,
    },
  };
}

function preset(
  id: string,
  labelKey: string,
  display: DisplayMode | undefined,
  patch: Partial<GelDetectConfig>,
): StainPreset {
  return {
    id,
    labelKey,
    display,
    config: {
      ...defaultDetectConfig(),
      ...patch,
      presetId: id,
      lanes: { ...defaultDetectConfig().lanes, ...(patch.lanes ?? {}) },
      bands: { ...defaultDetectConfig().bands, ...(patch.bands ?? {}) },
    },
  };
}

/** Built-in stains. "custom" is not offered as a starting point; it only
 *  appears when the user edits a preset's fields. */
export const STAIN_PRESETS: StainPreset[] = [
  preset('auto', 'gelPresetAuto', undefined, {}),
  // Ethidium bromide / SYBR Safe on a UV box: purple background, pink bands.
  // R-B separates the bands from the background far better than luminance.
  preset('uv', 'gelPresetUv', 'color', {
    type: 'dna',
    channel: 'red-blue',
    polarity: 'bright',
  }),
  preset('sybr', 'gelPresetSybr', 'color', {
    type: 'dna',
    channel: 'green',
    polarity: 'bright',
    sensitivity: 0.4,
  }),
  // Coomassie and silver: dark bands on a light, uneven background.
  preset('coomassie', 'gelPresetCoomassie', 'gray', {
    type: 'protein',
    channel: 'luma',
    polarity: 'dark',
    sensitivity: 0.3,
  }),
  preset('silver', 'gelPresetSilver', 'gray', {
    type: 'protein',
    channel: 'luma',
    polarity: 'dark',
    sensitivity: 0.45,
  }),
];

export function presetById(id: string): StainPreset | null {
  return STAIN_PRESETS.find((p) => p.id === id) ?? null;
}

/** Options for the select: built-ins plus "custom" when it is active. */
export function presetChoices(currentId: string): { id: string; labelKey: string }[] {
  const choices = STAIN_PRESETS.map((p) => ({ id: p.id, labelKey: p.labelKey }));
  if (currentId === 'custom' || !presetById(currentId)) {
    choices.push({ id: 'custom', labelKey: 'gelPresetCustom' });
  }
  return choices;
}

function clamp(value: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Clamp a stored or hand-edited config; missing fields inherit the preset. */
export function sanitizeDetectConfig(value: unknown): GelDetectConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawPreset = typeof raw.presetId === 'string' ? raw.presetId : 'auto';
  const base = presetById(rawPreset)?.config ?? defaultDetectConfig();
  const lanes = raw.lanes && typeof raw.lanes === 'object' ? (raw.lanes as Record<string, unknown>) : {};
  const bands = raw.bands && typeof raw.bands === 'object' ? (raw.bands as Record<string, unknown>) : {};
  const presetId = rawPreset === 'custom' || presetById(rawPreset) ? rawPreset : 'custom';
  return {
    presetId,
    type: pick(raw.type, DETECT_TYPE_MODES, base.type),
    channel: pick(raw.channel, DETECT_CHANNELS, base.channel),
    polarity: pick(raw.polarity, DETECT_POLARITIES, base.polarity),
    sensitivity: clamp(raw.sensitivity, 0, 1, base.sensitivity),
    denoise: Math.round(clamp(raw.denoise, 0, 2, base.denoise)),
    lanes: {
      cut: clamp(lanes.cut, 0.02, 0.4, base.lanes.cut),
      mergeGap: clamp(lanes.mergeGap, 0, 0.02, base.lanes.mergeGap),
      minWidth: clamp(lanes.minWidth, 0.001, 0.02, base.lanes.minWidth),
      smooth: clamp(lanes.smooth, 0, 0.05, base.lanes.smooth),
      prominence: clamp(lanes.prominence, 0.01, 0.3, base.lanes.prominence),
    },
    bands: {
      prominence: clamp(bands.prominence, 0.1, 2, base.bands.prominence),
      minGap: clamp(bands.minGap, 0.001, 0.05, base.bands.minGap),
      smooth: Math.round(clamp(bands.smooth, 1, 15, base.bands.smooth)),
    },
  };
}

/** Cache identity for the binarized mask. Lane/band fields do not change it. */
export function detectConfigKey(config: GelDetectConfig): string {
  return `${config.channel}|${config.polarity}|${config.sensitivity.toFixed(2)}|${config.denoise}`;
}

/** The native binarizer mirrors polarity and sensitivity. */
export function nativeBinarizeOptions(config: GelDetectConfig): {
  polarity: number;
  delta: number;
  openRadius: number;
} {
  const polarity = config.polarity === 'bright' ? 1 : config.polarity === 'dark' ? -1 : 0;
  return {
    polarity,
    // The adaptive threshold accepts a negative delta only, so more sensitivity
    // means a smaller required margin. 0.35 maps to the original -8.
    delta: -Math.round(4 + config.sensitivity * 11.4),
    openRadius: config.denoise,
  };
}

/** Multiplier for the JS threshold/floor. 1.0 at the shipped sensitivity. */
export function thresholdScale(config: GelDetectConfig): number {
  return Math.max(0.35, Math.min(1.35, 1 + (DEFAULT_SENSITIVITY - config.sensitivity)));
}

export function channelPlane(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  channel: DetectChannel,
): Float32Array {
  const out = new Float32Array(width * height);
  const n = Math.min(out.length, Math.floor(rgba.length / 4));
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    let value: number;
    switch (channel) {
      case 'red':
        value = r / 255;
        break;
      case 'green':
        value = g / 255;
        break;
      case 'blue':
        value = b / 255;
        break;
      case 'red-blue':
        value = 0.5 + (r - b) / 510;
        break;
      case 'green-red':
        value = 0.5 + (g - r) / 510;
        break;
      default:
        value = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    }
    out[p] = value;
  }
  return out;
}
