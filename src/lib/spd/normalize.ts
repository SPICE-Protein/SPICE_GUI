import type { SpdEnvironmentInput, SpdModelInput } from './types';

export const DEFAULT_LICENSE = 'CC-BY-4.0' as const;

export function normalizeSequence(sequence: string): string {
  return sequence.replace(/[\s\d>]+/g, '').toUpperCase();
}

export function normalizeEnvironment(input: SpdEnvironmentInput): SpdEnvironmentInput {
  const round = (value: number, places: number) => Number(value.toFixed(places));
  return {
    ph: round(input.ph, 3),
    temperatureK: round(input.temperatureK, 2),
    pressureBar: round(input.pressureBar, 2),
    ionicStrengthM: round(input.ionicStrengthM, 3),
    ...(input.solvent !== undefined ? { solvent: input.solvent } : {}),
    ...(input.protonationModel ? { protonationModel: input.protonationModel } : {}),
    ...(input.customProtonation !== undefined ? { customProtonation: input.customProtonation } : {}),
    ...(input.normalization !== undefined ? { normalization: input.normalization } : {})
  };
}

export function normalizeModel(model: SpdModelInput): SpdModelInput {
  return { ...model, trainedHeads: model.trainedHeads ? [...model.trainedHeads].sort() : undefined };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export async function sha256(value: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function sequenceSha256(sequence: string): Promise<string> { return sha256(normalizeSequence(sequence)); }
