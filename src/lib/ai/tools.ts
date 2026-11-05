// Typed tool registry exposed to the Co-Pilot agent.
//
// Tools are split into read-only calculations and mutations. The agent may call
// read-only tools freely; mutating tools must pass the UI approval gate and are
// always recorded in the audit trail. Tool outputs are plain JSON strings so a
// model can reason about failures without the app throwing.

import type { AiToolDefinition } from './client';
import {
  validateDnaSequence,
  validateMutations,
  type MutationSuggestion,
} from './parse';
import { calculateCai, type CodonHost } from '$lib/genome/codon';
import { calculateSantaLuciaTm } from '$lib/genome/tm';
import {
  calculatePercentGC,
  getReverseComplementSequenceString,
} from '$lib/genome/sequence';
import { findOrfsInPlasmid } from '$lib/genome/clone';
import { predictMutationalStabilityDdG } from '$lib/genome/biophysics/proteinAnalysis';
import { retrieve, type SearchDocument } from './retrieval';
import { searchMemory, type MemoryEntry } from './memory';
import type { McpToolDescriptor, McpServerConfig } from './mcp';
import { callMcpTool } from './mcp';
import { CHART_PALETTE } from '$lib/tools/figure/types';
import {
  dispatchFigureCommand,
  figureToolActive,
  type FigureChartSpec,
} from '$lib/tools/figure/figureAgent';

export type AgentToolPermission = 'read' | 'write';

export interface AgentToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  /** True when the action registered an undo snapshot with the host page. */
  undoAvailable?: boolean;
}

export interface AgentActions {
  applyDnaSequence?: (sequence: string) => void;
  applyProteinSequence?: (sequence: string) => void;
  importMutations?: (mutations: MutationSuggestion[]) => void;
  rememberFact?: (text: string, tags: string[]) => MemoryEntry[] | void;
  undoLastChange?: () => void;
}

export interface AgentWorkspaceContext {
  workspace: string;
  protein: {
    sequence: string;
    env: { ph: number; tempK: number; pressureBar: number; ionicStrengthM: number };
    metrics: Record<string, unknown> | null;
    phaseScanCount?: number;
  };
  gene: {
    dnaSequence: string;
    plasmidName: string;
    gcContent: number;
    codonHost: string;
  };
  documents: SearchDocument[];
  memory: MemoryEntry[];
  mcpServers: McpServerConfig[];
  actions: AgentActions;
}

export interface AgentTool {
  /** Runtime name; defaults to definition.function.name when omitted. */
  name?: string;
  definition: AiToolDefinition;
  permission: AgentToolPermission;
  /** Human-readable approval preview shown before a write. */
  preview?: (args: Record<string, unknown>, context: AgentWorkspaceContext) => string;
  /** Alias used by tests / external tool providers. */
  describe?: (args: Record<string, unknown>, context: AgentWorkspaceContext) => string;
  execute: (args: Record<string, unknown>, context: AgentWorkspaceContext) => AgentToolResult | Promise<AgentToolResult>;
}

const AMINO_ACIDS = /^[ACDEFGHIKLMNPQRSTVWY]+$/;

function definition(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): AiToolDefinition {
  return {
    type: 'function',
    function: { name, description, parameters },
  };
}

function ok(summary: string, data?: unknown, undoAvailable = false): AgentToolResult {
  return { ok: true, summary, data, undoAvailable };
}

function fail(summary: string): AgentToolResult {
  return { ok: false, summary };
}

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? String(args[key]).trim() : '';
}

function numberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(args[key]);
  return Number.isFinite(value) ? value : fallback;
}

function currentDna(args: Record<string, unknown>, context: AgentWorkspaceContext): string {
  return (stringArg(args, 'sequence') || context.gene.dnaSequence).replace(/[\s\n\r\t]/g, '').toUpperCase();
}

function dnaLabel(context: AgentWorkspaceContext): string {
  return context.gene.plasmidName ? `“${context.gene.plasmidName}”` : 'the current construct';
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function truncate(text: string, max = 4000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max / 2)}…(${text.length - max} nt omitted)…${text.slice(-max / 2)}`;
}

function sequenceData(sequence: string, max = 4000): string {
  return truncate(sequence, max);
}

function orfPayload(sequence: string, minimum: number, circular: boolean): unknown {
  const orfs = findOrfsInPlasmid(sequence, circular, minimum, true)
    .sort((a, b) => b.length - a.length)
    .slice(0, 20)
    .map((orf) => ({
      start: orf.start + 1,
      end: orf.end + 1,
      lengthNt: orf.length,
      lengthAa: Math.floor(orf.length / 3) - 1,
      strand: orf.forward ? '+' : '-',
    }));
  return { count: orfs.length, orfs };
}

function mutationPreview(mutations: MutationSuggestion[], context: AgentWorkspaceContext): string {
  const sequence = context.protein.sequence.toUpperCase();
  return mutations
    .map((mutation) => {
      const wildType = sequence[mutation.pos - 1] ?? mutation.from;
      return `${wildType}${mutation.pos}${mutation.to}`;
    })
    .join(', ');
}

const FIGURE_CHART_TYPES = ['bar', 'line', 'scatter'] as const;
type FigureChartType = (typeof FIGURE_CHART_TYPES)[number];

/** Return the array only when every entry is a finite number. */
function finiteNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    numbers.push(entry);
  }
  return numbers;
}

/** Pad with zeros or truncate so every series spans the category count. */
function fitSeriesLength(values: number[], length: number): number[] {
  const fitted = values.slice(0, length);
  while (fitted.length < length) fitted.push(0);
  return fitted;
}

function figureSeries(
  raw: unknown,
  index: number,
  categoryCount: number,
): FigureChartSpec['series'][number] | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return `series ${index + 1} must be an object`;
  }
  const record = raw as Record<string, unknown>;
  const values = finiteNumbers(record.values);
  if (!values) return `series ${index + 1} values must be finite numbers`;
  const rawErrors = record.errors === undefined || record.errors === null
    ? []
    : finiteNumbers(record.errors);
  if (!rawErrors) return `series ${index + 1} errors must be finite numbers`;
  return {
    name: stringArg(record, 'name') || `Series ${index + 1}`,
    values: fitSeriesLength(values, categoryCount),
    errors: fitSeriesLength(rawErrors, categoryCount).map((error) => Math.abs(error)),
    color: stringArg(record, 'color') || CHART_PALETTE[index % CHART_PALETTE.length],
  };
}

function figureChartPreview(args: Record<string, unknown>): string {
  const chartType = stringArg(args, 'chartType') || 'bar';
  const name = stringArg(args, 'name') || 'Chart';
  const labels = Array.isArray(args.labels) ? args.labels.map((label) => String(label)) : [];
  const rawSeries = Array.isArray(args.series) ? args.series : [];
  const seriesNames = rawSeries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `Series ${index + 1}`;
    return stringArg(entry as Record<string, unknown>, 'name') || `Series ${index + 1}`;
  });
  const shownLabels = labels.slice(0, 8).join(', ');
  return [
    `Add ${chartType} chart “${name}” to Figure Studio`,
    `${rawSeries.length} series: ${seriesNames.join(', ') || '(none)'}`,
    `${labels.length} categories: ${shownLabels || '(none)'}${labels.length > 8 ? ', …' : ''}`,
    'Requires Figure Studio to be open.',
  ].join('\n');
}

export function buildAgentTools(
  context: AgentWorkspaceContext,
  mcpTools: McpToolDescriptor[] = [],
): AgentTool[] {
  const tools: AgentTool[] = [];

  tools.push({
    definition: definition(
      'get_workspace_context',
      'Return the active workspace, protein sequence/environment, gene construct, and available project document titles.',
      { type: 'object', properties: {}, additionalProperties: false },
    ),
    permission: 'read',
    execute: () => ok('Workspace context', {
      workspace: context.workspace,
      protein: context.protein.sequence
        ? {
            length: context.protein.sequence.length,
            sequence: sequenceData(context.protein.sequence),
            environment: context.protein.env,
            metrics: context.protein.metrics,
            phaseScanCount: context.protein.phaseScanCount ?? 0,
          }
        : null,
      gene: context.gene.dnaSequence
        ? {
            name: context.gene.plasmidName || '(unnamed)',
            length: context.gene.dnaSequence.length,
            lengthBp: context.gene.dnaSequence.length,
            gcPercent: round(context.gene.gcContent || calculatePercentGC(context.gene.dnaSequence), 1),
            codonHost: context.gene.codonHost || 'ecoli',
            sequence: sequenceData(context.gene.dnaSequence),
          }
        : null,
      documents: context.documents.map((doc) => ({ id: doc.id, kind: doc.kind, title: doc.title })),
      memories: context.memory.slice(0, 20).map((entry) => ({ text: entry.text, tags: entry.tags })),
    }),
  });

  if (context.protein.sequence) {
    tools.push({
      definition: definition(
        'predict_mutation_ddg',
        'Predict the stability change (ddG) of a single point mutation in the active protein using the same empirical predictor as the protein analysis panel. Position is 1-based.',
        {
          type: 'object',
          properties: {
            position: { type: 'integer', minimum: 1, description: '1-based residue position' },
            to: { type: 'string', description: 'Target amino acid, one letter' },
            from: { type: 'string', description: 'Optional wild-type amino acid; inferred when omitted' },
          },
          required: ['position', 'to'],
          additionalProperties: false,
        },
      ),
      permission: 'read',
      execute: (args) => {
        const position = Math.trunc(numberArg(args, 'position', 0));
        const target = stringArg(args, 'to').toUpperCase();
        if (position < 1 || position > context.protein.sequence.length) {
          return fail(`position must be between 1 and ${context.protein.sequence.length}`);
        }
        if (!/^[ACDEFGHIKLMNPQRSTVWY]$/.test(target)) return fail('target must be one standard amino acid');
        const wildType = context.protein.sequence[position - 1].toUpperCase();
        const declared = stringArg(args, 'from').toUpperCase();
        if (declared && declared !== wildType) return fail(`position ${position} is ${wildType}, not ${declared}`);
        const prediction = predictMutationalStabilityDdG(wildType, position, target);
        return ok(`${wildType}${position}${target}: ddG ${round(prediction.ddG, 2)} kcal/mol`, {
          wildType,
          from: wildType,
          position,
          mutant: target,
          to: target,
          ...prediction,
        });
      },
    });
  }

  tools.push({
    definition: definition(
      'analyze_dna',
      'Analyze a DNA sequence: length, GC content, melting temperature, reverse complement, and the strongest open reading frames. Defaults to the active gene construct.',
      {
        type: 'object',
        properties: {
          sequence: { type: 'string', description: 'Optional DNA sequence; defaults to the active construct' },
          circular: { type: 'boolean', description: 'Treat the sequence as circular (default true)' },
          minimumOrfNt: { type: 'integer', minimum: 30, description: 'Minimum ORF length in nucleotides (default 90)' },
        },
        additionalProperties: false,
      },
    ),
    permission: 'read',
    execute: (args) => {
      const sequence = currentDna(args, context);
      if (!sequence) return fail('no DNA sequence in the active gene workspace');
      const checked = validateDnaSequence(sequence);
      if (checked.error) return fail(checked.error);
      const tm = sequence.length <= 200 ? calculateSantaLuciaTm(sequence) : null;
      return ok(`DNA ${sequence.length} bp, GC ${round(calculatePercentGC(sequence), 1)}%`, {
        length: sequence.length,
        lengthBp: sequence.length,
        gcPercent: round(calculatePercentGC(sequence), 1),
        meltingTemperatureC: typeof tm === 'number' ? round(tm, 1) : null,
        reverseComplement: getReverseComplementSequenceString(sequence),
        circular: args.circular !== false,
        ...(orfPayload(sequence, Math.max(30, Math.trunc(numberArg(args, 'minimumOrfNt', numberArg(args, 'minLength', 90)))), args.circular !== false) as object),
      });
    },
  });

  tools.push({
    definition: definition(
      'design_primers',
      'Design a forward and reverse primer for the ends of a DNA sequence. Returns 20 nt annealing regions, Tm, and GC for each primer.',
      {
        type: 'object',
        properties: {
          sequence: { type: 'string', description: 'Optional DNA sequence; defaults to the active construct' },
          productEnd: { type: 'integer', minimum: 2, description: 'Optional 1-based end of the amplicon' },
        },
        additionalProperties: false,
      },
    ),
    permission: 'read',
    execute: (args) => {
      const sequence = currentDna(args, context);
      if (!sequence) return fail('no DNA sequence in the active gene workspace');
      const end = Math.min(sequence.length, Math.max(2, Math.trunc(numberArg(args, 'productEnd', sequence.length))));
      const amplicon = sequence.slice(0, end);
      const forward = amplicon.slice(0, Math.min(20, amplicon.length));
      const reverse = getReverseComplementSequenceString(amplicon.slice(Math.max(0, amplicon.length - 20)));
      const tm = (primer: string) => {
        const value = calculateSantaLuciaTm(primer);
        return typeof value === 'number' ? round(value, 1) : null;
      };
      return ok(`Primers for ${end} bp amplicon`, {
        productLength: end,
        ampliconLength: end,
        forward: { sequence: forward, tmC: tm(forward), gcPercent: round(calculatePercentGC(forward), 1) },
        reverse: { sequence: reverse, tmC: tm(reverse), gcPercent: round(calculatePercentGC(reverse), 1) },
        tmDifferenceC: tm(forward) !== null && tm(reverse) !== null ? round(Math.abs(tm(forward)! - tm(reverse)!), 1) : null,
      });
    },
  });

  if (context.gene.dnaSequence) {
    tools.push({
      definition: definition(
        'calculate_codon_usage',
        'Calculate codon adaptation index (CAI) and GC content for the active gene in a host organism.',
        {
          type: 'object',
          properties: {
            host: { type: 'string', enum: ['ecoli', 'yeast', 'human'], description: 'Expression host (default ecoli)' },
          },
          additionalProperties: false,
        },
      ),
      permission: 'read',
      execute: (args) => {
        const host = (['ecoli', 'yeast', 'human'].includes(stringArg(args, 'host'))
          ? stringArg(args, 'host')
          : 'ecoli') as CodonHost;
        const sequence = context.gene.dnaSequence.replace(/[^ACGT]/gi, '').toUpperCase();
        if (sequence.length < 3) return fail('no coding DNA sequence in the active gene workspace');
        const result = calculateCai(sequence, host);
        return ok(`${host} CAI ${round(result.cai, 2)}, GC ${round(result.gc, 1)}%`, {
          host,
          cai: round(result.cai, 3),
          gcPercent: round(result.gc, 1),
          codons: result.totalCodons,
          optimizedCodons: result.optimizedCount,
        });
      },
    });

    tools.push({
      definition: definition(
        'find_orfs',
        'Find open reading frames in the active gene construct (or a supplied DNA sequence).',
        {
          type: 'object',
          properties: {
            sequence: { type: 'string', description: 'Optional DNA sequence' },
            minimumOrfNt: { type: 'integer', minimum: 30, description: 'Minimum ORF length in nucleotides (default 90)' },
            circular: { type: 'boolean', description: 'Treat the sequence as circular (default true)' },
          },
          additionalProperties: false,
        },
      ),
      permission: 'read',
      execute: (args) => {
        const sequence = currentDna(args, context);
        if (!sequence) return fail('no DNA sequence in the active gene workspace');
        const minimum = Math.max(30, Math.trunc(numberArg(args, 'minimumOrfNt', numberArg(args, 'minLength', 90))));
        const circular = args.circular !== false;
        const payload = orfPayload(sequence, minimum, circular) as { count: number };
        return ok(`${payload.count} ORF(s) at least ${minimum} nt`, payload);
      },
    });
  }

  tools.push({
    definition: definition(
      'reverse_complement',
      'Return the reverse complement of a DNA sequence (defaults to the active gene construct).',
      {
        type: 'object',
        properties: {
          sequence: { type: 'string', description: 'Optional DNA sequence; defaults to the active construct' },
        },
        additionalProperties: false,
      },
    ),
    permission: 'read',
    execute: (args) => {
      const sequence = currentDna(args, context);
      if (!sequence) return fail('no DNA sequence in the active gene workspace');
      const checked = validateDnaSequence(sequence);
      if (checked.error) return fail(checked.error);
      return ok(`Reverse complement of ${sequence.length} bp`, {
        length: sequence.length,
        reverseComplement: getReverseComplementSequenceString(sequence),
      });
    },
  });

  tools.push({
    definition: definition(
      'calculate_tm',
      'Calculate the SantaLucia nearest-neighbor melting temperature of a DNA sequence.',
      {
        type: 'object',
        properties: {
          sequence: { type: 'string', description: 'Optional DNA sequence; defaults to the active construct' },
        },
        additionalProperties: false,
      },
    ),
    permission: 'read',
    execute: (args) => {
      const sequence = currentDna(args, context);
      if (!sequence) return fail('no DNA sequence in the active gene workspace');
      if (sequence.length < 2) return fail('sequence must be at least 2 nt');
      const tm = calculateSantaLuciaTm(sequence);
      if (typeof tm !== 'number') return fail(String(tm));
      return ok(`Tm ${round(tm, 1)} °C`, {
        length: sequence.length,
        gcPercent: round(calculatePercentGC(sequence), 1),
        tmC: round(tm, 1),
      });
    },
  });

  tools.push({
    definition: definition(
      'list_workspace_documents',
      'List the documents and journal pages available in the open project.',
      { type: 'object', properties: {}, additionalProperties: false },
    ),
    permission: 'read',
    execute: () => ok(`${context.documents.length} document(s)`, {
      documents: context.documents.map((doc) => ({ id: doc.id, kind: doc.kind, title: doc.title })),
    }),
  });

  if (context.documents.length) {
    tools.push({
      definition: definition(
        'search_workspace',
        'Search the open project documents, journal pages, and attached notes for relevant text. Use this before answering questions about prior experiments.',
        {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Maximum hits (default 5)' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      ),
      permission: 'read',
      execute: (args) => {
        const query = stringArg(args, 'query');
        if (!query) return fail('query is required');
        const hits = retrieve(query, context.documents, Math.min(10, Math.trunc(numberArg(args, 'limit', 5))));
        return ok(`${hits.length} matching document(s)`, hits.map((hit) => ({
          id: hit.document.id,
          kind: hit.document.kind,
          title: hit.document.title,
          score: hit.score,
          snippet: hit.snippet,
        })));
      },
    });
  }

  if (context.memory.length) {
    tools.push({
      definition: definition(
        'recall_memory',
        'Recall durable facts the user asked the Co-Pilot to remember. Omit the query to list recent memories.',
        {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional search query' },
            limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum entries (default 8)' },
          },
          additionalProperties: false,
        },
      ),
      permission: 'read',
      execute: (args) => {
        const limit = Math.min(20, Math.trunc(numberArg(args, 'limit', 8)));
        const query = stringArg(args, 'query');
        const entries = query ? searchMemory(query, context.memory, limit) : context.memory.slice(0, limit);
        return ok(`${entries.length} memory entr${entries.length === 1 ? 'y' : 'ies'}`, {
          memories: entries.map((entry) => ({ text: entry.text, tags: entry.tags, createdAt: entry.createdAt })),
        });
      },
    });
  }

  if (context.actions.applyDnaSequence) {
    tools.push({
      definition: definition(
        'apply_dna_sequence',
        'Replace the DNA sequence in the gene workbench. This is a destructive edit and requires user approval; the gene editor records an undo snapshot.',
        {
          type: 'object',
          properties: {
            sequence: { type: 'string', description: 'Full DNA sequence (A/C/G/T plus IUPAC ambiguity codes)' },
            reason: { type: 'string', description: 'Short explanation of why this edit is needed' },
          },
          required: ['sequence'],
          additionalProperties: false,
        },
      ),
      permission: 'write',
      preview: (args, ctx) => {
        const checked = validateDnaSequence(stringArg(args, 'sequence'));
        if (checked.error) return `Invalid DNA: ${checked.error}`;
        const oldLength = ctx.gene.dnaSequence.length;
        const oldGc = ctx.gene.dnaSequence ? calculatePercentGC(ctx.gene.dnaSequence) : 0;
        return [
          `Replace DNA in ${dnaLabel(ctx)}`,
          `Length: ${oldLength} bp → ${checked.sequence.length} bp`,
          `GC: ${round(oldGc, 1)}% → ${round(calculatePercentGC(checked.sequence), 1)}%`,
          stringArg(args, 'reason') ? `Reason: ${stringArg(args, 'reason')}` : '',
        ].filter(Boolean).join('\n');
      },
      execute: (args, ctx) => {
        const checked = validateDnaSequence(stringArg(args, 'sequence'));
        if (checked.error) return fail(checked.error);
        if (!ctx.actions.applyDnaSequence) return fail('gene editor is not available');
        ctx.actions.applyDnaSequence(checked.sequence);
        ctx.gene.dnaSequence = checked.sequence;
        ctx.gene.gcContent = calculatePercentGC(checked.sequence);
        return ok(`Replaced DNA with ${checked.sequence.length} bp`, { lengthBp: checked.sequence.length }, true);
      },
    });
  }

  if (context.actions.applyProteinSequence) {
    tools.push({
      definition: definition(
        'apply_protein_sequence',
        'Replace the protein sequence in the protein workbench. This is a destructive edit and requires user approval; the protein editor records an undo snapshot.',
        {
          type: 'object',
          properties: {
            sequence: { type: 'string', description: 'Full protein sequence, one-letter amino acids' },
            reason: { type: 'string', description: 'Short explanation of why this edit is needed' },
          },
          required: ['sequence'],
          additionalProperties: false,
        },
      ),
      permission: 'write',
      preview: (args, ctx) => {
        const sequence = stringArg(args, 'sequence').toUpperCase();
        if (!AMINO_ACIDS.test(sequence)) return 'Invalid protein: only the 20 standard amino acids are allowed.';
        return [
          `Replace protein sequence`,
          `Length: ${ctx.protein.sequence.length} aa → ${sequence.length} aa`,
          stringArg(args, 'reason') ? `Reason: ${stringArg(args, 'reason')}` : '',
        ].filter(Boolean).join('\n');
      },
      execute: (args, ctx) => {
        const sequence = stringArg(args, 'sequence').toUpperCase();
        if (!AMINO_ACIDS.test(sequence)) return fail('only the 20 standard amino acids are allowed');
        if (!ctx.actions.applyProteinSequence) return fail('protein workbench is not available');
        ctx.actions.applyProteinSequence(sequence);
        ctx.protein.sequence = sequence;
        return ok(`Replaced protein sequence with ${sequence.length} aa`, { lengthAa: sequence.length }, true);
      },
    });
  }

  if (context.actions.importMutations) {
    tools.push({
      definition: definition(
        'import_mutations',
        'Import point mutations into the protein mutation cart. Requires user approval. Each mutation is validated against the active protein sequence.',
        {
          type: 'object',
          properties: {
            mutations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pos: { type: 'integer', minimum: 1 },
                  from: { type: 'string' },
                  to: { type: 'string' },
                  score: { type: 'number' },
                },
                required: ['pos', 'from', 'to'],
              },
            },
          },
          required: ['mutations'],
          additionalProperties: false,
        },
      ),
      permission: 'write',
      preview: (args, ctx) => {
        const checked = validateMutations(args.mutations, ctx.protein.sequence);
        if (checked.errors.length) return `Invalid mutation(s): ${checked.errors.slice(0, 3).join('; ')}`;
        return `Add ${checked.valid.length} mutation(s) to the protein cart:\n${mutationPreview(checked.valid, ctx)}`;
      },
      execute: (args, ctx) => {
        const checked = validateMutations(args.mutations, ctx.protein.sequence);
        if (checked.errors.length) return fail(checked.errors[0]);
        if (!checked.valid.length) return fail('no valid mutations supplied');
        if (!ctx.actions.importMutations) return fail('protein mutation cart is not available');
        ctx.actions.importMutations(checked.valid);
        return ok(`Imported ${checked.valid.length} mutation(s)`, { mutations: checked.valid }, true);
      },
    });
  }

  if (context.actions.rememberFact) {
    tools.push({
      definition: definition(
        'remember_fact',
        'Store a durable fact for future conversations (for example an expression host, a project convention, or a user preference). Requires user approval.',
        {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The fact to remember, concise and self-contained' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
          },
          required: ['text'],
          additionalProperties: false,
        },
      ),
      permission: 'write',
      preview: (args) => `Remember this fact:\n${stringArg(args, 'text')}`,
      execute: (args, ctx) => {
        const text = stringArg(args, 'text');
        if (!text) return fail('text is required');
        if (!ctx.actions.rememberFact) return fail('memory is not available');
        const tags = Array.isArray(args.tags) ? args.tags.map(String).slice(0, 12) : [];
        const updated = ctx.actions.rememberFact(text, tags);
        if (Array.isArray(updated)) ctx.memory = updated;
        return ok(`Remembered: ${text.slice(0, 140)}`, { text, tags });
      },
    });
  }

  // Figure Studio commands do not depend on AgentActions: the tool is always
  // listed and fails clearly when no editor instance is mounted.
  tools.push({
    definition: definition(
      'figure_add_chart',
      'Create an editable bar, line, or scatter chart in Figure Studio. Series values are plotted against the supplied category labels and can be adjusted afterwards in the inspector. Requires Figure Studio to be open.',
      {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Chart title and layer name' },
          chartType: { type: 'string', enum: ['bar', 'line', 'scatter'] },
          labels: {
            type: 'array',
            minItems: 2,
            maxItems: 50,
            items: { type: 'string' },
            description: 'Category labels, one per plotted value',
          },
          series: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Series legend name' },
                values: {
                  type: 'array',
                  items: { type: 'number' },
                  description: 'Finite numeric values; padded with zeros or truncated to the label count',
                },
                errors: {
                  type: 'array',
                  items: { type: 'number' },
                  description: 'Optional error magnitudes; converted to absolute values',
                },
                color: { type: 'string', description: 'Optional CSS colour; a palette colour is assigned when omitted' },
              },
              required: ['name', 'values'],
              additionalProperties: false,
            },
          },
          xLabel: { type: 'string', description: 'Optional x-axis title' },
          yLabel: { type: 'string', description: 'Optional y-axis title' },
        },
        required: ['name', 'chartType', 'labels', 'series'],
        additionalProperties: false,
      },
    ),
    permission: 'write',
    preview: (args) => figureChartPreview(args),
    execute: (args) => {
      const chartType = stringArg(args, 'chartType') as FigureChartType;
      if (!FIGURE_CHART_TYPES.includes(chartType)) {
        return fail('chartType must be bar, line, or scatter');
      }
      if (!Array.isArray(args.labels)) {
        return fail('labels must be an array of 2 to 50 category names');
      }
      const labels = args.labels.map((label) => (typeof label === 'string' ? label.trim() : ''));
      if (labels.length < 2 || labels.length > 50) {
        return fail('labels must contain between 2 and 50 categories');
      }
      if (labels.some((label) => !label)) {
        return fail('every label must be a non-empty string');
      }
      if (!Array.isArray(args.series) || args.series.length < 1 || args.series.length > 12) {
        return fail('series must contain between 1 and 12 entries');
      }
      const series: FigureChartSpec['series'] = [];
      for (let index = 0; index < args.series.length; index += 1) {
        const parsed = figureSeries(args.series[index], index, labels.length);
        if (typeof parsed === 'string') return fail(parsed);
        series.push(parsed);
      }
      const xLabel = stringArg(args, 'xLabel');
      const yLabel = stringArg(args, 'yLabel');
      const spec: FigureChartSpec = {
        name: stringArg(args, 'name') || 'Chart',
        chartType,
        labels,
        series,
        ...(xLabel ? { xLabel } : {}),
        ...(yLabel ? { yLabel } : {}),
      };
      // Do not queue this write when the editor is closed: the tool call reports
      // failure, so silently applying it on a later mount would be misleading.
      if (!figureToolActive()) {
        return fail('Open Figure Studio before asking the assistant to add a chart.');
      }
      dispatchFigureCommand({ type: 'add-chart', spec });
      return ok(`Added a ${chartType} chart with ${series.length} series to Figure Studio`, spec, true);
    },
  });

  // MCP tools are added last so built-ins win name collisions.
  const external = mcpAgentTools(mcpTools, context.mcpServers);
  const used = new Set(tools.map((tool) => tool.definition.function.name));
  for (const tool of external) {
    if (used.has(tool.definition.function.name)) continue;
    used.add(tool.definition.function.name);
    tools.push(tool);
  }

  return tools.map((tool) => ({
    ...tool,
    name: tool.name ?? tool.definition.function.name,
    describe: tool.describe ?? tool.preview,
  }));
}

/** Adapt MCP tools into the same registry. MCP calls are treated as writes
 *  unless the server explicitly declares readOnlyHint. */
export function mcpAgentTools(
  descriptors: McpToolDescriptor[],
  servers: McpServerConfig[],
): AgentTool[] {
  const byId = new Map(servers.map((server) => [server.id, server]));
  return descriptors.flatMap((descriptor) => {
    const server = byId.get(descriptor.serverId);
    if (!server) return [];
    const tool: AgentTool = {
      definition: definition(
        descriptor.callName,
        `[MCP: ${descriptor.serverName}] ${descriptor.description}`,
        descriptor.inputSchema,
      ),
      permission: descriptor.readOnly ? 'read' : 'write',
      preview: (args) => `Run MCP tool “${descriptor.name}” on server “${descriptor.serverName}”.\n\n${JSON.stringify(args, null, 2)}`,
      execute: async (args) => {
        try {
          const text = await callMcpTool(server, descriptor.name, args);
          return ok(text.slice(0, 6000), { server: descriptor.serverName, tool: descriptor.name, text });
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
      },
    };
    return [tool];
  });
}
