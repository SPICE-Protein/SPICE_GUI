// Typed intents for the Gene Editor workspace.
//
// The agent proposes what should change; this module owns everything numeric
// and structural: sequence normalisation, feature ids, coordinates, colours and
// range checks. A plan is applied in memory as a whole, so a rejected intent
// leaves the workspace untouched. The page adapter commits the returned
// snapshot in one history entry.

import { FEATURE_TYPES, colorForFeatureType } from '$lib/genome/featureColors';
import { isRangeInBounds, isWrappedRange } from './featureRange';

export const MAX_INTENTS_PER_PLAN = 50;
export const MAX_SEQUENCE_LENGTH = 5_000_000;
export const MAX_FEATURES = 10_000;
const MAX_NAME_LENGTH = 120;

export interface GeneWorkspaceFeature {
  id: number;
  name: string;
  /** 1-based inclusive. */
  start: number;
  /** 1-based inclusive. */
  end: number;
  type: string;
  color?: string;
  forward?: boolean;
}

export interface GeneWorkspaceSnapshot {
  name: string;
  sequence: string;
  topology: 'circular' | 'linear';
  features: GeneWorkspaceFeature[];
}

export type GeneIntent =
  | { type: 'replace_sequence'; sequence: string }
  | { type: 'add_feature'; name: string; start: number; end: number; featureType?: string; forward?: boolean }
  | { type: 'remove_feature'; featureId: number }
  | { type: 'rename_feature'; featureId: number; name: string }
  | { type: 'move_feature'; featureId: number; start: number; end: number }
  | { type: 'rename_construct'; name: string }
  | { type: 'set_topology'; topology: 'circular' | 'linear' };

export type GeneIntentErrorCode =
  | 'invalid_plan'
  | 'invalid_intent'
  | 'invalid_sequence'
  | 'invalid_name'
  | 'invalid_range'
  | 'invalid_topology'
  | 'unknown_feature_type'
  | 'feature_not_found'
  | 'feature_out_of_range'
  | 'sequence_too_long'
  | 'too_many_intents'
  | 'post_verify_failed';

export interface GeneIntentFailure {
  ok: false;
  code: GeneIntentErrorCode;
  message: string;
  /** Zero-based position of the offending intent, or null for plan-level errors. */
  intentIndex: number | null;
}

export interface GeneIntentSuccess {
  ok: true;
  snapshot: GeneWorkspaceSnapshot;
  /** Human-readable journal lines, one per effective change. */
  changes: string[];
  /** Version hash of the resulting snapshot; use it as expectedVersion next time. */
  version: string;
  /** Version hash of the input snapshot. */
  previousVersion: string;
}

export type GeneIntentResult = GeneIntentFailure | GeneIntentSuccess;

/**
 * What the host page reports back to the agent. `code` is present on rejection,
 * and the version is always the live workspace version so the agent can retry
 * without a second inspection.
 */
export interface GenePlanApplication {
  ok: boolean;
  code?: string;
  message: string;
  version: string;
  snapshot?: GeneWorkspaceSnapshot;
}

const DNA_ALPHABET = /^[ACGTNRYWSKMBDHV]+$/;

// ---------------- version hash ----------------

/**
 * Stable FNV-1a hash of everything that changes what the workspace means.
 * The agent passes it back so a plan written against an older document is
 * rejected instead of applied to a different one.
 */
export function workspaceVersion(snapshot: GeneWorkspaceSnapshot): string {
  const parts = [
    snapshot.name,
    snapshot.sequence.toUpperCase(),
    snapshot.topology,
    ...snapshot.features.map((f) =>
      [f.id, f.name, f.start, f.end, (f.type || 'misc_feature').toLowerCase(), f.forward === false ? '0' : '1'].join('\u001f')
    )
  ];
  return fnv1a(parts.join('\u001e'));
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------- plan application ----------------

export function applyGenePlan(snapshot: GeneWorkspaceSnapshot, rawIntents: unknown): GeneIntentResult {
  const previousVersion = workspaceVersion(snapshot);
  if (!Array.isArray(rawIntents)) {
    return failure('invalid_plan', 'intents must be an array', null, previousVersion);
  }
  if (rawIntents.length === 0) {
    return failure('invalid_plan', 'the plan is empty', null, previousVersion);
  }
  if (rawIntents.length > MAX_INTENTS_PER_PLAN) {
    return failure('invalid_plan', `at most ${MAX_INTENTS_PER_PLAN} intents per plan, got ${rawIntents.length}`, null, previousVersion);
  }

  const next: GeneWorkspaceSnapshot = {
    name: snapshot.name,
    sequence: snapshot.sequence.toUpperCase(),
    topology: snapshot.topology,
    features: snapshot.features.map((feature) => ({ ...feature }))
  };
  const changes: string[] = [];

  for (let index = 0; index < rawIntents.length; index += 1) {
    const parsed = parseIntent(rawIntents[index]);
    if (!parsed.ok) {
      return { ...parsed, intentIndex: index };
    }
    const applied = applyOne(next, parsed.intent);
    if (!applied.ok) {
      return { ...applied, intentIndex: index };
    }
    if (applied.change) changes.push(applied.change);
  }

  // A plan is answerable only for what it changes. Whatever the document
  // already carried — an imported file with duplicate names, say — must not
  // make every later edit fail verification.
  const known = new Set(
    verifyGeneSnapshot(snapshot).map((issue) => `${issue.code}\u001f${issue.message}`)
  );
  const issues = verifyGeneSnapshot(next).filter(
    (issue) => !known.has(`${issue.code}\u001f${issue.message}`)
  );
  if (issues.length > 0) {
    return failure(
      'post_verify_failed',
      `the resulting workspace failed verification: ${issues.map((issue) => issue.message).join('; ')}`,
      null,
      previousVersion
    );
  }

  return {
    ok: true,
    snapshot: next,
    changes,
    previousVersion,
    version: workspaceVersion(next)
  };
}

export interface GeneSnapshotIssue {
  code: 'invalid_sequence' | 'invalid_topology' | 'invalid_range' | 'duplicate_feature_id' | 'invalid_name';
  message: string;
}

/** Independent check of the invariants the editor relies on. */
export function verifyGeneSnapshot(snapshot: GeneWorkspaceSnapshot): GeneSnapshotIssue[] {
  const issues: GeneSnapshotIssue[] = [];
  const sequence = snapshot.sequence.toUpperCase();
  if (!sequence) {
    issues.push({ code: 'invalid_sequence', message: 'the sequence is empty' });
  } else if (!DNA_ALPHABET.test(sequence)) {
    issues.push({ code: 'invalid_sequence', message: 'the sequence contains non-IUPAC characters' });
  }
  if (!snapshot.name.trim()) {
    issues.push({ code: 'invalid_name', message: 'the construct name is empty' });
  }
  if (snapshot.topology !== 'circular' && snapshot.topology !== 'linear') {
    issues.push({ code: 'invalid_topology', message: `unknown topology "${snapshot.topology}"` });
  }
  const seen = new Set<number>();
  for (const feature of snapshot.features) {
    if (seen.has(feature.id)) {
      issues.push({ code: 'duplicate_feature_id', message: `feature id ${feature.id} appears twice` });
    }
    seen.add(feature.id);
    if (!feature.name.trim()) {
      issues.push({ code: 'invalid_name', message: `feature ${feature.id} has an empty name` });
    }
    if (!isRangeInBounds(feature, sequence.length)) {
      issues.push({
        code: 'invalid_range',
        message: `feature ${feature.id} spans ${feature.start}..${feature.end}, outside the ${sequence.length} bp sequence`
      });
    } else if (isWrappedRange(feature) && snapshot.topology !== 'circular') {
      issues.push({
        code: 'invalid_range',
        message: `feature ${feature.id} wraps the origin (${feature.start}..${feature.end}) in a linear document`
      });
    }
  }
  return issues;
}

/** Applies one already-parsed intent to a mutable snapshot. */
function applyOne(
  snapshot: GeneWorkspaceSnapshot,
  intent: GeneIntent
): { ok: true; change: string | null } | GeneIntentFailure {
  switch (intent.type) {
    case 'replace_sequence': {
      const sequence = normaliseSequence(intent.sequence);
      if (!sequence.ok) return sequence;
      if (sequence.value.length > MAX_SEQUENCE_LENGTH) {
        return failure('sequence_too_long', `sequence is ${sequence.value.length} bp; the limit is ${MAX_SEQUENCE_LENGTH} bp`, null);
      }
      const dangling = snapshot.features.filter(
        (feature) => feature.start > sequence.value.length || feature.end > sequence.value.length
      );
      if (dangling.length > 0) {
        return failure(
          'feature_out_of_range',
          `new sequence is ${sequence.value.length} bp but ${describeFeatures(dangling)} span beyond it; resize or remove those features first`,
          null
        );
      }
      if (sequence.value === snapshot.sequence) return { ok: true, change: null };
      const delta = sequence.value.length - snapshot.sequence.length;
      snapshot.sequence = sequence.value;
      return {
        ok: true,
        change: `replaced sequence with ${sequence.value.length} bp (${delta >= 0 ? '+' : ''}${delta})`
      };
    }

    case 'add_feature': {
      if (snapshot.features.length >= MAX_FEATURES) {
        return failure('invalid_plan', `the document already holds the maximum of ${MAX_FEATURES} features`, null);
      }
      const name = cleanName(intent.name);
      if (!name.ok) return name;
      const range = checkRange(snapshot, intent.start, intent.end);
      if (!range.ok) return range;
      const type = normaliseFeatureType(intent.featureType);
      if (!type.ok) return type;
      const id = nextFeatureId(snapshot.features);
      const feature: GeneWorkspaceFeature = {
        id,
        name: name.value,
        start: intent.start,
        end: intent.end,
        type: type.value,
        color: colorForFeatureType(type.value),
        forward: intent.forward !== false
      };
      snapshot.features.push(feature);
      return { ok: true, change: `added ${type.value} "${feature.name}" at ${feature.start}..${feature.end} (id ${id})` };
    }

    case 'remove_feature': {
      const found = findFeature(snapshot, intent.featureId);
      if (!found.ok) return found;
      snapshot.features = snapshot.features.filter((feature) => feature.id !== intent.featureId);
      return { ok: true, change: `removed "${found.feature.name}" (id ${found.feature.id})` };
    }

    case 'rename_feature': {
      const found = findFeature(snapshot, intent.featureId);
      if (!found.ok) return found;
      const name = cleanName(intent.name);
      if (!name.ok) return name;
      if (found.feature.name === name.value) return { ok: true, change: null };
      const before = found.feature.name;
      found.feature.name = name.value;
      return { ok: true, change: `renamed feature ${found.feature.id} from "${before}" to "${name.value}"` };
    }

    case 'move_feature': {
      const found = findFeature(snapshot, intent.featureId);
      if (!found.ok) return found;
      const range = checkRange(snapshot, intent.start, intent.end);
      if (!range.ok) return range;
      if (found.feature.start === intent.start && found.feature.end === intent.end) return { ok: true, change: null };
      const before = `${found.feature.start}..${found.feature.end}`;
      found.feature.start = intent.start;
      found.feature.end = intent.end;
      return { ok: true, change: `moved feature ${found.feature.id} from ${before} to ${intent.start}..${intent.end}` };
    }

    case 'rename_construct': {
      const name = cleanName(intent.name);
      if (!name.ok) return name;
      if (snapshot.name === name.value) return { ok: true, change: null };
      snapshot.name = name.value;
      return { ok: true, change: `renamed construct to "${name.value}"` };
    }

    case 'set_topology': {
      if (intent.topology !== 'circular' && intent.topology !== 'linear') {
        return failure('invalid_topology', 'topology must be "circular" or "linear"', null);
      }
      if (snapshot.topology === intent.topology) return { ok: true, change: null };
      snapshot.topology = intent.topology;
      return { ok: true, change: `set topology to ${intent.topology}` };
    }
  }
}

// ---------------- intent parsing ----------------

function parseIntent(raw: unknown): { ok: true; intent: GeneIntent } | GeneIntentFailure {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return failure('invalid_intent', 'each intent needs a "type" string', null);
  }
  switch (raw.type) {
    case 'replace_sequence':
      if (typeof raw.sequence !== 'string') return failure('invalid_intent', 'replace_sequence needs a "sequence" string', null);
      return { ok: true, intent: { type: 'replace_sequence', sequence: raw.sequence } };

    case 'add_feature':
      if (typeof raw.name !== 'string' || !isInteger(raw.start) || !isInteger(raw.end)) {
        return failure('invalid_intent', 'add_feature needs "name" plus integer "start" and "end"', null);
      }
      if (raw.featureType !== undefined && typeof raw.featureType !== 'string') {
        return failure('invalid_intent', 'add_feature "featureType" must be a string', null);
      }
      if (raw.forward !== undefined && typeof raw.forward !== 'boolean') {
        return failure('invalid_intent', 'add_feature "forward" must be a boolean', null);
      }
      return {
        ok: true,
        intent: {
          type: 'add_feature',
          name: raw.name,
          start: raw.start,
          end: raw.end,
          featureType: raw.featureType,
          forward: raw.forward
        }
      };

    case 'remove_feature':
      if (!isInteger(raw.featureId)) return failure('invalid_intent', 'remove_feature needs an integer "featureId"', null);
      return { ok: true, intent: { type: 'remove_feature', featureId: raw.featureId } };

    case 'rename_feature':
      if (!isInteger(raw.featureId) || typeof raw.name !== 'string') {
        return failure('invalid_intent', 'rename_feature needs an integer "featureId" and a "name" string', null);
      }
      return { ok: true, intent: { type: 'rename_feature', featureId: raw.featureId, name: raw.name } };

    case 'move_feature':
      if (!isInteger(raw.featureId) || !isInteger(raw.start) || !isInteger(raw.end)) {
        return failure('invalid_intent', 'move_feature needs an integer "featureId", "start" and "end"', null);
      }
      return { ok: true, intent: { type: 'move_feature', featureId: raw.featureId, start: raw.start, end: raw.end } };

    case 'rename_construct':
      if (typeof raw.name !== 'string') return failure('invalid_intent', 'rename_construct needs a "name" string', null);
      return { ok: true, intent: { type: 'rename_construct', name: raw.name } };

    case 'set_topology':
      if (raw.topology !== 'circular' && raw.topology !== 'linear') {
        return failure('invalid_topology', 'topology must be "circular" or "linear"', null);
      }
      return { ok: true, intent: { type: 'set_topology', topology: raw.topology } };

    default:
      return failure(
        'invalid_intent',
        `unknown intent type "${raw.type}"; allowed: replace_sequence, add_feature, remove_feature, rename_feature, move_feature, rename_construct, set_topology`,
        null
      );
  }
}

// ---------------- field checks ----------------

function normaliseSequence(raw: string): { ok: true; value: string } | GeneIntentFailure {
  const value = raw.replace(/\s+/g, '').toUpperCase();
  if (!value) return failure('invalid_sequence', 'the sequence is empty', null);
  const invalid = value.match(/[^ACGTNRYWSKMBDHV]/);
  if (invalid) {
    const position = value.indexOf(invalid[0]) + 1;
    return failure(
      'invalid_sequence',
      `"${invalid[0]}" at position ${position} is not IUPAC DNA (allowed: A C G T N R Y W S K M B D H V)`,
      null
    );
  }
  return { ok: true, value };
}

function cleanName(raw: string): { ok: true; value: string } | GeneIntentFailure {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value) return failure('invalid_name', 'the name is empty', null);
  if (value.length > MAX_NAME_LENGTH) {
    return failure('invalid_name', `names are limited to ${MAX_NAME_LENGTH} characters`, null);
  }
  return { ok: true, value };
}

function normaliseFeatureType(raw: string | undefined): { ok: true; value: string } | GeneIntentFailure {
  const value = (raw ?? 'misc_feature').trim().toLowerCase();
  if (!FEATURE_TYPES.includes(value)) {
    return failure(
      'unknown_feature_type',
      `unknown feature type "${value}"; allowed: ${FEATURE_TYPES.join(', ')}`,
      null
    );
  }
  return { ok: true, value };
}

function checkRange(
  snapshot: GeneWorkspaceSnapshot,
  start: number,
  end: number
): { ok: true } | GeneIntentFailure {
  const length = snapshot.sequence.length;
  if (!isRangeInBounds({ start, end }, length)) {
    return failure(
      'invalid_range',
      `coordinates must lie inside 1..${length}, got ${start}..${end}`,
      null
    );
  }
  if (isWrappedRange({ start, end }) && snapshot.topology !== 'circular') {
    return failure(
      'invalid_range',
      `coordinates ${start}..${end} run backwards, which only a circular document can hold`,
      null
    );
  }
  return { ok: true };
}

function findFeature(
  snapshot: GeneWorkspaceSnapshot,
  featureId: number
): { ok: true; feature: GeneWorkspaceFeature } | GeneIntentFailure {
  const feature = snapshot.features.find((candidate) => candidate.id === featureId);
  if (!feature) {
    const ids = snapshot.features.slice(0, 20).map((candidate) => candidate.id);
    const suffix = snapshot.features.length > ids.length ? ', …' : '';
    return failure(
      'feature_not_found',
      `no feature with id ${featureId}; feature ids are ${ids.length ? ids.join(', ') + suffix : '(none)'}`,
      null
    );
  }
  return { ok: true, feature };
}

function nextFeatureId(features: GeneWorkspaceFeature[]): number {
  return features.reduce((highest, feature) => Math.max(highest, feature.id), 0) + 1;
}

function describeFeatures(features: GeneWorkspaceFeature[]): string {
  const shown = features.slice(0, 5).map((feature) => `"${feature.name}" (id ${feature.id})`);
  return features.length > shown.length ? `${shown.join(', ')} and ${features.length - shown.length} more` : shown.join(', ');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function failure(
  code: GeneIntentErrorCode,
  message: string,
  intentIndex: number | null,
  previousVersion?: string
): GeneIntentFailure & { previousVersion?: string } {
  return { ok: false, code, message, intentIndex, ...(previousVersion ? { previousVersion } : {}) };
}

/** One-line summary for the undo history label. */
export function describeGenePlan(result: GeneIntentSuccess): string {
  if (result.changes.length === 0) return 'Co-Pilot plan (no changes)';
  const shown = result.changes.slice(0, 3).join('; ');
  return result.changes.length > 3 ? `${shown}; +${result.changes.length - 3} more` : shown;
}
