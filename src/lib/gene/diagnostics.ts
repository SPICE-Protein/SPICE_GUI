// Document diagnostics for the Gene Editor.
//
// Pure and deterministic: the same snapshot produces the same findings, in the
// same order. Structural problems block; scientific observations warn or
// inform, because the editor cannot decide biology for the user. Fixes are
// expressed as the same typed intents the agent uses, so applying one still
// passes the version and post-verify gates.

import type { DiagnosticFinding, FindingFix } from '$lib/diagnostics/types';
import { translateCodon } from '$lib/genome/advancedTools';
import { getReverseComplementSequenceString } from '$lib/genome/sequence';
import { workspaceVersion, type GeneIntent, type GeneWorkspaceSnapshot } from './workspaceIntents';
import {
  extractRange,
  firstOverlap,
  isRangeInBounds,
  isWrappedRange,
  positionAt,
} from './featureRange';

export interface EnzymeSite {
  name: string;
  /** IUPAC recognition sequence, e.g. GAATTC or GANTC. */
  motif: string;
}

export interface DiagnoseOptions {
  enzymeSites?: EnzymeSite[];
  maxFeaturesForPairChecks?: number;
}

const DNA_ALPHABET = /^[ACGTNRYWSKMBDHV]*$/;
const START_CODONS = new Set(['ATG', 'GTG', 'TTG']);
const HOMOPOLYMER_MIN = 8;
const STRUCTURAL_CODES = new Set([
  'seq_empty',
  'seq_non_iupac',
  'topology_invalid',
  'feature_duplicate_id',
  'feature_empty_name',
  'feature_range',
]);

export function diagnoseGeneWorkspace(
  snapshot: GeneWorkspaceSnapshot,
  options: DiagnoseOptions = {},
): DiagnosticFinding[] {
  const version = workspaceVersion(snapshot);
  const findings: DiagnosticFinding[] = [];
  const sequence = snapshot.sequence.toUpperCase();
  const length = sequence.length;

  const add = (
    code: string,
    severity: DiagnosticFinding['severity'],
    title: string,
    detail: string,
    scope: DiagnosticFinding['scope'],
    params: Record<string, string | number> = {},
    extras: Partial<DiagnosticFinding> = {},
  ) => {
    findings.push({
      // The span is part of the identity: one CDS can hold several sites, and a
      // feature-level code alone would give those findings the same id.
      id: `diag:${code}:${scope.kind}:${scope.id ?? ''}:${scope.start ?? ''}-${scope.end ?? ''}:${version}`,
      provider: STRUCTURAL_CODES.has(code) ? 'structural' : 'science',
      severity,
      code,
      title,
      detail,
      scope,
      params,
      ...extras,
    });
  };

  // ---------------- structural ----------------
  if (length === 0) {
    add('seq_empty', 'blocking', 'The sequence is empty', 'No bases are present in the document.', {
      kind: 'sequence',
      start: 1,
      end: 1,
    });
  } else if (!DNA_ALPHABET.test(sequence)) {
    const invalid = sequence.match(/[^ACGTNRYWSKMBDHV]/);
    const position = invalid ? sequence.indexOf(invalid[0]) + 1 : 1;
    add(
      'seq_non_iupac',
      'blocking',
      'Non-IUPAC base in the sequence',
      `"${invalid?.[0] ?? '?'}" at position ${position} is not an IUPAC DNA code.`,
      { kind: 'sequence', start: position, end: position },
      { base: invalid?.[0] ?? '?', position },
    );
  }

  if (snapshot.topology !== 'circular' && snapshot.topology !== 'linear') {
    add(
      'topology_invalid',
      'blocking',
      'Unknown topology',
      `Topology "${snapshot.topology}" is neither circular nor linear.`,
      { kind: 'sequence', start: 1, end: Math.max(1, length) },
      { topology: String(snapshot.topology) },
    );
  }

  const seenIds = new Set<number>();

  for (const feature of snapshot.features) {
    const featureScope = { kind: 'feature' as const, id: feature.id, start: feature.start, end: feature.end };
    if (seenIds.has(feature.id)) {
      add(
        'feature_duplicate_id',
        'blocking',
        'Duplicate feature id',
        `Feature id ${feature.id} is used more than once.`,
        featureScope,
        { id: feature.id },
      );
    }
    seenIds.add(feature.id);

    if (!feature.name.trim()) {
      add(
        'feature_empty_name',
        'blocking',
        'Feature without a name',
        `Feature ${feature.id} has an empty name.`,
        featureScope,
        { id: feature.id },
      );
    }

    if (!isRangeInBounds(feature, length) || (isWrappedRange(feature) && snapshot.topology !== 'circular')) {
      const detail = isRangeInBounds(feature, length)
        ? `Feature ${feature.id} runs from ${feature.start} back to ${feature.end}, which a linear document cannot hold.`
        : `Feature ${feature.id} spans ${feature.start}..${feature.end}, which is not a valid range for ${length} bp.`;
      add(
        'feature_range',
        'blocking',
        'Feature outside the sequence',
        detail,
        featureScope,
        { id: feature.id, start: feature.start, end: feature.end, length },
      );
      continue;
    }
  }

  // Duplicate names are ambiguous for both the user and the agent.
  const duplicateNames: { featureId: number; name: string }[] = [];
  const seenNames = new Map<string, number>();
  for (const feature of snapshot.features) {
    const key = feature.name.trim().toLowerCase();
    if (!key) continue;
    const count = seenNames.get(key) ?? 0;
    seenNames.set(key, count + 1);
    if (count > 0) duplicateNames.push({ featureId: feature.id, name: feature.name.trim() });
  }
  if (duplicateNames.length > 0) {
    const fixes: FindingFix[] = [
      {
        label: 'rename-duplicates',
        intents: duplicateNameFixes(snapshot),
      },
    ];
    add(
      'feature_duplicate_name',
      'warning',
      'Duplicate feature names',
      `${duplicateNames.length} feature(s) repeat a name already used in the document.`,
      {
        kind: 'feature',
        id: duplicateNames[0].featureId,
        start: snapshot.features.find((f) => f.id === duplicateNames[0].featureId)?.start,
        end: snapshot.features.find((f) => f.id === duplicateNames[0].featureId)?.end,
      },
      { count: duplicateNames.length, name: duplicateNames[0].name },
      { fixes },
    );
  }

  // ---------------- CDS checks ----------------
  for (const feature of snapshot.features) {
    if (feature.type.toLowerCase() !== 'cds') continue;
    if (!isRangeInBounds(feature, length)) continue;
    if (isWrappedRange(feature) && snapshot.topology !== 'circular') continue;
    const oriented = orientedFeatureSequence(sequence, feature);
    const scope = { kind: 'feature' as const, id: feature.id, start: feature.start, end: feature.end };

    if (oriented.length % 3 !== 0) {
      add(
        'cds_frame',
        'warning',
        'CDS length is not a multiple of three',
        `${feature.name} is ${oriented.length} nt; the last ${oriented.length % 3} base(s) fall outside a codon.`,
        scope,
        { name: feature.name, length: oriented.length, remainder: oriented.length % 3 },
      );
    }

    const codons: string[] = [];
    for (let index = 0; index + 3 <= oriented.length; index += 3) {
      codons.push(oriented.slice(index, index + 3));
    }
    if (codons.length > 0) {
      if (!START_CODONS.has(codons[0])) {
        add(
          'cds_start',
          'info',
          'CDS does not begin with a common start codon',
          `${feature.name} starts with ${codons[0]} rather than ATG, GTG or TTG.`,
          scope,
          { name: feature.name, codon: codons[0] },
        );
      }
      const stopIndex = codons.findIndex((codon, index) => index < codons.length - 1 && translateCodon(codon) === '*');
      if (stopIndex !== -1) {
        const stopOffset = orientedOffset(feature, oriented.length, stopIndex * 3, 3);
        const position = positionAt(feature, stopOffset, length);
        add(
          'cds_internal_stop',
          'warning',
          'Internal stop codon in a CDS',
          `${feature.name} has ${codons[stopIndex]} at base ${position}, before the annotated end.`,
          {
            ...scope,
            start: position,
            end: positionAt(feature, stopOffset + 2, length),
          },
          { name: feature.name, codon: codons[stopIndex], position },
        );
      }
    }

    const enzymeFindings = enzymeSitesInFeature(feature, oriented, options.enzymeSites ?? []);
    for (const hit of enzymeFindings) {
      const start = positionAt(feature, hit.offset, length);
      add(
        'cds_enzyme_site',
        'warning',
        'Restriction site inside a CDS',
        `${hit.name} (${hit.motif}) occurs inside ${feature.name} at base ${start}.`,
        {
          ...scope,
          start,
          end: positionAt(feature, hit.offset + hit.motif.length - 1, length),
        },
        { name: feature.name, enzyme: hit.name, motif: hit.motif, position: start },
      );
    }
  }

  // ---------------- sequence-wide checks ----------------
  if (length >= 100) {
    let gc = 0;
    for (const base of sequence) if (base === 'G' || base === 'C') gc += 1;
    const percent = Math.round((gc / length) * 100);
    if (percent < 30 || percent > 70) {
      add(
        'sequence_gc_extreme',
        'info',
        'Extreme GC content',
        `GC is ${percent}%; synthesis and amplification may need different conditions.`,
        { kind: 'sequence', start: 1, end: length },
        { percent },
      );
    }
  }

  const run = longestHomopolymer(sequence);
  if (run.length >= HOMOPOLYMER_MIN) {
    add(
      'sequence_homopolymer',
      'info',
      'Long homopolymer run',
      `${run.base} repeated ${run.length} times at ${run.start}..${run.end}.`,
      { kind: 'sequence', start: run.start, end: run.end },
      { base: run.base, length: run.length },
    );
  }

  // ---------------- overlaps ----------------
  const maxPairs = options.maxFeaturesForPairChecks ?? 400;
  if (snapshot.features.length <= maxPairs) {
    for (let i = 0; i < snapshot.features.length; i += 1) {
      for (let j = i + 1; j < snapshot.features.length; j += 1) {
        const a = snapshot.features[i];
        const b = snapshot.features[j];
        if (!isRangeInBounds(a, length) || !isRangeInBounds(b, length)) continue;
        const opposite = (a.forward === false) !== (b.forward === false);
        if (!opposite) continue;
        const overlap = firstOverlap(a, b, length);
        if (!overlap) continue;
        add(
          'feature_overlap_opposite',
          'info',
          'Opposite-strand features overlap',
          `"${a.name}" and "${b.name}" overlap at ${overlap.start}..${overlap.end} on opposite strands.`,
          { kind: 'feature', id: a.id, start: overlap.start, end: overlap.end },
          { first: a.name, second: b.name, start: overlap.start, end: overlap.end },
        );
        break;
      }
    }
  }

  return findings.sort(bySeverityThenPosition);
}

function orientedFeatureSequence(
  sequence: string,
  feature: { start: number; end: number; forward?: boolean },
): string {
  const raw = extractRange(sequence, feature).toUpperCase();
  return feature.forward === false ? getReverseComplementSequenceString(raw) : raw;
}

/**
 * Offset in the CDS as written, from an offset in its oriented (5'→3') read.
 * A reverse feature reads back to front, so its last base comes first.
 */
function orientedOffset(
  feature: { forward?: boolean },
  orientedLength: number,
  offset: number,
  span: number,
): number {
  return feature.forward === false ? orientedLength - offset - span : offset;
}

function enzymeSitesInFeature(
  feature: { forward?: boolean },
  oriented: string,
  sites: EnzymeSite[],
): { name: string; motif: string; offset: number }[] {
  const hits: { name: string; motif: string; offset: number }[] = [];
  for (const site of sites) {
    const motif = site.motif.toUpperCase();
    if (!motif) continue;
    let regex: RegExp;
    try {
      regex = new RegExp(iupacToRegex(motif), 'g');
    } catch {
      continue;
    }
    let match = regex.exec(oriented);
    while (match) {
      // Offsets stay inside the feature; the caller maps them to the document.
      hits.push({ name: site.name, motif, offset: orientedOffset(feature, oriented.length, match.index, motif.length) });
      if (hits.length >= 3) return hits;
      match = regex.exec(oriented);
    }
  }
  return hits;
}

function iupacToRegex(motif: string): string {
  const map: Record<string, string> = {
    A: 'A', C: 'C', G: 'G', T: 'T',
    R: '[AG]', Y: '[CT]', S: '[GC]', W: '[AT]', K: '[GT]', M: '[AC]',
    B: '[CGT]', D: '[AGT]', H: '[ACT]', V: '[ACG]', N: '[ACGT]',
  };
  return motif
    .split('')
    .map((base) => map[base] ?? base)
    .join('');
}

function longestHomopolymer(sequence: string): { base: string; length: number; start: number; end: number } {
  let best = { base: '', length: 0, start: 0, end: 0 };
  let currentBase = '';
  let currentLength = 0;
  for (let index = 0; index < sequence.length; index += 1) {
    const base = sequence[index];
    if (base === currentBase) {
      currentLength += 1;
    } else {
      currentBase = base;
      currentLength = 1;
    }
    if (currentLength > best.length && /^[ACGT]$/.test(base)) {
      best = {
        base,
        length: currentLength,
        start: index - currentLength + 2,
        end: index + 1,
      };
    }
  }
  return best;
}

function duplicateNameFixes(snapshot: GeneWorkspaceSnapshot): GeneIntent[] {
  const used = new Set(snapshot.features.map((feature) => feature.name.trim().toLowerCase()));
  const seen = new Set<string>();
  const intents: GeneIntent[] = [];
  for (const feature of snapshot.features) {
    const key = feature.name.trim().toLowerCase();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      continue;
    }
    let suffix = 2;
    let candidate = `${feature.name.trim()} (${suffix})`;
    while (used.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${feature.name.trim()} (${suffix})`;
    }
    used.add(candidate.toLowerCase());
    intents.push({ type: 'rename_feature', featureId: feature.id, name: candidate });
  }
  return intents;
}

function bySeverityThenPosition(a: DiagnosticFinding, b: DiagnosticFinding): number {
  const order = { blocking: 0, warning: 1, info: 2 } as const;
  return order[a.severity] - order[b.severity] || (a.scope.start ?? 0) - (b.scope.start ?? 0);
}
