// Built-in Lua scripts. They are read-only in the panel: editing one creates a
// copy, so an app update never silently overwrites a user's changes.

import gcWindows from './builtins/gc-windows.lua?raw';
import codonOptimize from './builtins/codon-optimize.lua?raw';
import motifScan from './builtins/motif-scan.lua?raw';
import apiReference from './builtins/api-reference.lua?raw';
import type { SpiceScript } from './types';

const BUILTIN_DATE = '2026-11-14T00:00:00.000Z';

function builtin(
  id: string,
  name: string,
  description: string,
  source: string,
  permissions: SpiceScript['permissions'],
): SpiceScript {
  return {
    id,
    name,
    description,
    source,
    permissions,
    createdAt: BUILTIN_DATE,
    updatedAt: BUILTIN_DATE,
    builtin: true,
  };
}

export const BUILTIN_SCRIPTS: SpiceScript[] = [
  builtin(
    'builtin_gc_windows',
    'GC window report',
    'Report GC content in fixed windows across the document.',
    gcWindows,
    ['doc:read'],
  ),
  builtin(
    'builtin_motif_scan',
    'Motif scan',
    'Find short DNA motifs and return every hit.',
    motifScan,
    ['doc:read'],
  ),
  builtin(
    'builtin_codon_optimize',
    'Codon optimisation',
    'Optimise codons for CAI, GC, homopolymers, and forbidden motifs; proposes a new sequence.',
    codonOptimize,
    ['doc:read', 'doc:write'],
  ),
  builtin(
    'builtin_api_reference',
    'API reference',
    'Print the scripting API surface available in this build.',
    apiReference,
    ['doc:read'],
  ),
];
