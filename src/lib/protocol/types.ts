// SPICE_PROTOCOL_LIBRARY file schema and pure helpers.
//
// A protocol library is a portable JSON document holding reusable templates
// (parameters + ordered steps) and the runs executed from them. Nothing here
// touches the filesystem or Svelte reactivity, so the same code can validate
// imports, render run sheets, and compute stats in any environment.

export const PROTOCOL_FORMAT = 'SPICE_PROTOCOL_LIBRARY';
export const PROTOCOL_VERSION = '1.0';

export const PARAMETER_TYPES = ['text', 'number', 'select', 'boolean'] as const;
export type ProtocolParameterType = (typeof PARAMETER_TYPES)[number];

export interface ProtocolParameter {
  key: string;
  label: string;
  type: ProtocolParameterType;
  unit?: string;
  defaultValue: string | number | boolean;
  options?: string[];
  required?: boolean;
}

export interface ProtocolStep {
  id: string;
  title: string;
  instructions: string;
  durationMin?: number;
  temperatureC?: number;
}

export interface ProtocolTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  parameters: ProtocolParameter[];
  steps: ProtocolStep[];
  version: string;
  createdAt: string;
  updatedAt: string;
}

export const RUN_STATUSES = ['planned', 'running', 'completed', 'aborted'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ['pending', 'running', 'done', 'skipped'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export interface ProtocolRunStep {
  stepId: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  notes?: string;
}

export interface ProtocolRun {
  id: string;
  templateId: string;
  templateName: string;
  projectId?: string;
  projectName?: string;
  journalPageId?: string;
  status: RunStatus;
  operator: string;
  parameterValues: Record<string, string | number | boolean>;
  steps: ProtocolRunStep[];
  startedAt?: string;
  completedAt?: string;
  resultMarkdown: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryMeta {
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolLibraryFile {
  format: typeof PROTOCOL_FORMAT;
  version: typeof PROTOCOL_VERSION;
  meta: ProtocolLibraryMeta;
  templates: ProtocolTemplate[];
  runs: ProtocolRun[];
}

/** Optional links that bind a run to a project and/or a journal page. */
export interface ProtocolRunLinks {
  projectId?: string;
  projectName?: string;
  journalPageId?: string;
  operator?: string;
}

export interface ProtocolStats {
  templates: number;
  runs: number;
  plannedRuns: number;
  runningRuns: number;
  completedRuns: number;
  abortedRuns: number;
  steps: number;
  pendingSteps: number;
  runningSteps: number;
  doneSteps: number;
  skippedSteps: number;
}

export type ProtocolValidationResult =
  | { ok: true; library: ProtocolLibraryFile }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isParameterType(value: unknown): value is ProtocolParameterType {
  return typeof value === 'string' && (PARAMETER_TYPES as readonly string[]).includes(value);
}

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value);
}

function isStepStatus(value: unknown): value is StepStatus {
  return typeof value === 'string' && (STEP_STATUSES as readonly string[]).includes(value);
}

function isPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function defaultForType(type: ProtocolParameterType): string | number | boolean {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  return '';
}

/** Stable-enough local id; no external dependency required. */
export function newProtocolId(prefix = 'protocol'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a template from a partial object, filling ids, timestamps, and
 *  per-type parameter defaults so callers can supply only what they know. */
export function createProtocolTemplate(partial: Partial<ProtocolTemplate> = {}): ProtocolTemplate {
  const now = new Date().toISOString();

  const parameters: ProtocolParameter[] = Array.isArray(partial.parameters)
    ? partial.parameters.map((source, index) => {
        const type = isParameterType(source.type) ? source.type : 'text';
        const key = (source.key || `param_${index + 1}`).trim();
        const parameter: ProtocolParameter = {
          key,
          label: (source.label || key || `Parameter ${index + 1}`).trim(),
          type,
          defaultValue: isPrimitiveValue(source.defaultValue)
            ? source.defaultValue
            : defaultForType(type),
          required: !!source.required
        };
        if (typeof source.unit === 'string' && source.unit) parameter.unit = source.unit;
        if (Array.isArray(source.options)) {
          parameter.options = source.options.filter((option): option is string => typeof option === 'string');
        }
        return parameter;
      })
    : [];

  const steps: ProtocolStep[] = Array.isArray(partial.steps)
    ? partial.steps.map((source, index) => {
        const step: ProtocolStep = {
          id: source.id || newProtocolId('step'),
          title: (source.title || `Step ${index + 1}`).trim(),
          instructions: typeof source.instructions === 'string' ? source.instructions : ''
        };
        if (typeof source.durationMin === 'number' && Number.isFinite(source.durationMin)) {
          step.durationMin = source.durationMin;
        }
        if (typeof source.temperatureC === 'number' && Number.isFinite(source.temperatureC)) {
          step.temperatureC = source.temperatureC;
        }
        return step;
      })
    : [];

  return {
    id: partial.id || newProtocolId('protocol'),
    name: (partial.name || '').trim() || 'Untitled protocol',
    category: (partial.category || 'General').trim() || 'General',
    description: partial.description || '',
    parameters,
    steps,
    version: partial.version || PROTOCOL_VERSION,
    createdAt: partial.createdAt || now,
    updatedAt: partial.updatedAt || now
  };
}

function coerceParameterValue(
  parameter: ProtocolParameter,
  value: string | number | boolean
): string | number | boolean {
  if (parameter.type === 'number') {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : parameter.defaultValue;
  }
  if (parameter.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    return value === 'true' || value === 'yes' || value === '1';
  }
  return typeof value === 'string' ? value : String(value);
}

/** Start a planned run from a template, merging supplied values over defaults. */
export function createRunFromTemplate(
  template: ProtocolTemplate,
  values: Record<string, string | number | boolean> = {},
  links: ProtocolRunLinks = {}
): ProtocolRun {
  const now = new Date().toISOString();

  const parameterValues: Record<string, string | number | boolean> = {};
  for (const parameter of template.parameters) {
    parameterValues[parameter.key] =
      Object.prototype.hasOwnProperty.call(values, parameter.key)
        ? coerceParameterValue(parameter, values[parameter.key])
        : parameter.defaultValue;
  }
  // Keep undeclared values too: they may be ad-hoc measurements.
  for (const [key, value] of Object.entries(values)) {
    if (!Object.prototype.hasOwnProperty.call(parameterValues, key)) parameterValues[key] = value;
  }

  const steps: ProtocolRunStep[] = template.steps.map(step => ({
    stepId: step.id,
    status: 'pending'
  }));

  const run: ProtocolRun = {
    id: newProtocolId('run'),
    templateId: template.id,
    templateName: template.name,
    status: 'planned',
    operator: links.operator || '',
    parameterValues,
    steps,
    resultMarkdown: '',
    createdAt: now,
    updatedAt: now
  };
  if (links.projectId) run.projectId = links.projectId;
  if (links.projectName) run.projectName = links.projectName;
  if (links.journalPageId) run.journalPageId = links.journalPageId;
  return run;
}

/** Move one step and keep the run-level status/timestamps consistent.
 *  Completion stays explicit (completeProtocolRun) so results can be added
 *  after the final step without the run appearing closed early. */
export function setRunStep(run: ProtocolRun, stepId: string, status: StepStatus): ProtocolRun {
  const step = run.steps.find(item => item.stepId === stepId);
  if (!step) return run;

  const now = new Date().toISOString();
  step.status = status;

  if (status === 'running') {
    step.startedAt = step.startedAt || now;
    step.completedAt = undefined;
    if (run.status !== 'aborted') {
      run.status = 'running';
      run.startedAt = run.startedAt || now;
      run.completedAt = undefined;
    }
  } else if (status === 'done' || status === 'skipped') {
    step.completedAt = now;
    if (run.status !== 'aborted') {
      run.status = 'running';
      run.startedAt = run.startedAt || now;
      run.completedAt = undefined;
    }
  } else {
    step.startedAt = undefined;
    step.completedAt = undefined;
    if (run.status !== 'aborted' && run.status !== 'completed') {
      const active = run.steps.some(
        item => item.status === 'running' || item.status === 'done' || item.status === 'skipped'
      );
      run.status = active ? 'running' : 'planned';
      if (!active) {
        run.startedAt = undefined;
        run.completedAt = undefined;
      }
    }
  }

  run.updatedAt = now;
  return run;
}

/** Close a run and attach its result markdown. */
export function completeProtocolRun(run: ProtocolRun, resultMarkdown: string): ProtocolRun {
  const now = new Date().toISOString();
  run.status = 'completed';
  run.startedAt = run.startedAt || now;
  run.completedAt = now;
  run.resultMarkdown = typeof resultMarkdown === 'string' ? resultMarkdown : '';
  run.updatedAt = now;
  return run;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function formatParameterValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

/** Render a lab-friendly Markdown run sheet.
 *  The parameter table is a top-level block (never nested inside a list),
 *  followed by checkbox steps with instructions, notes, and results. */
export function runSheetMarkdown(run: ProtocolRun, template?: ProtocolTemplate | null): string {
  const title = (template?.name || run.templateName || 'Protocol run').trim();
  const lines: string[] = [];

  lines.push(`# ${title} - Run Sheet`, '');
  lines.push(`- **Status:** ${run.status}`);
  lines.push(`- **Operator:** ${run.operator || '-'}`);
  if (run.projectName || run.projectId) {
    lines.push(`- **Project:** ${run.projectName || run.projectId}`);
  }
  if (run.journalPageId) lines.push(`- **Journal page:** ${run.journalPageId}`);
  if (template?.category) lines.push(`- **Category:** ${template.category}`);
  if (run.startedAt) lines.push(`- **Started:** ${run.startedAt}`);
  if (run.completedAt) lines.push(`- **Completed:** ${run.completedAt}`);
  lines.push('');

  lines.push('## Parameters', '');
  const parameters = template?.parameters ?? [];
  if (parameters.length === 0 && Object.keys(run.parameterValues).length === 0) {
    lines.push('_No parameters._');
  } else {
    lines.push('| Parameter | Value | Unit |');
    lines.push('| --- | --- | --- |');
    const known = new Set(parameters.map(parameter => parameter.key));
    for (const parameter of parameters) {
      const value = Object.prototype.hasOwnProperty.call(run.parameterValues, parameter.key)
        ? run.parameterValues[parameter.key]
        : parameter.defaultValue;
      lines.push(
        `| ${escapeTableCell(parameter.label || parameter.key)} | ${escapeTableCell(formatParameterValue(value))} | ${escapeTableCell(parameter.unit || '')} |`
      );
    }
    for (const [key, value] of Object.entries(run.parameterValues)) {
      if (known.has(key)) continue;
      lines.push(`| ${escapeTableCell(key)} | ${escapeTableCell(formatParameterValue(value))} |  |`);
    }
  }
  lines.push('');

  lines.push('## Steps', '');
  const steps = template?.steps ?? [];
  if (steps.length === 0) {
    lines.push('_No steps._');
  } else {
    for (const step of steps) {
      const state = run.steps.find(item => item.stepId === step.id);
      const status = state?.status ?? 'pending';
      const checkbox = status === 'done' ? 'x' : ' ';
      const suffix =
        status === 'running' ? ' _(running)_' : status === 'skipped' ? ' _(skipped)_' : '';
      lines.push(`- [${checkbox}] ${step.title || 'Untitled step'}${suffix}`);

      const meta: string[] = [];
      if (typeof step.durationMin === 'number') meta.push(`Duration: ${step.durationMin} min`);
      if (typeof step.temperatureC === 'number') meta.push(`Temperature: ${step.temperatureC} C`);
      if (meta.length) lines.push(`  _${meta.join(' | ')}_`);

      if (step.instructions) {
        for (const line of step.instructions.trim().split(/\r?\n/)) {
          lines.push(`  ${line}`.trimEnd());
        }
      }
      if (state?.notes) {
        const notes = state.notes.trim().split(/\r?\n/);
        lines.push(`  - Notes: ${notes[0]}`.trimEnd());
        for (let index = 1; index < notes.length; index += 1) {
          lines.push(`    ${notes[index]}`.trimEnd());
        }
      }
    }
  }
  lines.push('');

  lines.push('## Results', '');
  lines.push(run.resultMarkdown.trim() ? run.resultMarkdown.trim() : '_No results recorded._');
  lines.push('');

  return lines.join('\n');
}

/** Validate an imported library document and normalize the softer fields. */
export function validateProtocolLibrary(x: unknown): ProtocolValidationResult {
  if (!isRecord(x)) return { ok: false, error: 'not an object' };
  if (x.format !== PROTOCOL_FORMAT) return { ok: false, error: `format !== ${PROTOCOL_FORMAT}` };
  if (String(x.version) !== PROTOCOL_VERSION) {
    return { ok: false, error: `unsupported version: ${String(x.version)}` };
  }

  if (!isRecord(x.meta) || typeof x.meta.name !== 'string' || !x.meta.name.trim()) {
    return { ok: false, error: 'meta.name missing' };
  }
  if (!Array.isArray(x.templates)) return { ok: false, error: 'templates is not an array' };
  if (!Array.isArray(x.runs)) return { ok: false, error: 'runs is not an array' };

  const now = new Date().toISOString();
  const templates: ProtocolTemplate[] = [];

  for (const raw of x.templates) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
      return { ok: false, error: 'template missing id' };
    }
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      return { ok: false, error: `template ${raw.id}: missing name` };
    }
    if (!Array.isArray(raw.parameters)) {
      return { ok: false, error: `template ${raw.id}: parameters is not an array` };
    }
    if (!Array.isArray(raw.steps)) {
      return { ok: false, error: `template ${raw.id}: steps is not an array` };
    }

    const parameters: ProtocolParameter[] = [];
    for (const rawParameter of raw.parameters) {
      if (!isRecord(rawParameter) || typeof rawParameter.key !== 'string' || !rawParameter.key) {
        return { ok: false, error: `template ${raw.id}: parameter missing key` };
      }
      if (!isParameterType(rawParameter.type)) {
        return {
          ok: false,
          error: `template ${raw.id}: parameter ${rawParameter.key} has invalid type`
        };
      }
      if (rawParameter.options !== undefined && !Array.isArray(rawParameter.options)) {
        return {
          ok: false,
          error: `template ${raw.id}: parameter ${rawParameter.key} options is not an array`
        };
      }
      const parameter: ProtocolParameter = {
        key: rawParameter.key,
        label:
          typeof rawParameter.label === 'string' && rawParameter.label
            ? rawParameter.label
            : rawParameter.key,
        type: rawParameter.type,
        defaultValue: isPrimitiveValue(rawParameter.defaultValue)
          ? rawParameter.defaultValue
          : defaultForType(rawParameter.type),
        required: !!rawParameter.required
      };
      if (typeof rawParameter.unit === 'string' && rawParameter.unit) {
        parameter.unit = rawParameter.unit;
      }
      if (Array.isArray(rawParameter.options)) {
        parameter.options = rawParameter.options.filter(
          (option): option is string => typeof option === 'string'
        );
      }
      parameters.push(parameter);
    }

    const steps: ProtocolStep[] = [];
    for (const rawStep of raw.steps) {
      if (!isRecord(rawStep) || typeof rawStep.id !== 'string' || !rawStep.id) {
        return { ok: false, error: `template ${raw.id}: step missing id` };
      }
      const step: ProtocolStep = {
        id: rawStep.id,
        title:
          typeof rawStep.title === 'string' && rawStep.title.trim()
            ? rawStep.title
            : 'Untitled step',
        instructions: typeof rawStep.instructions === 'string' ? rawStep.instructions : ''
      };
      if (typeof rawStep.durationMin === 'number' && Number.isFinite(rawStep.durationMin)) {
        step.durationMin = rawStep.durationMin;
      }
      if (typeof rawStep.temperatureC === 'number' && Number.isFinite(rawStep.temperatureC)) {
        step.temperatureC = rawStep.temperatureC;
      }
      steps.push(step);
    }

    templates.push({
      id: raw.id,
      name: raw.name,
      category:
        typeof raw.category === 'string' && raw.category.trim() ? raw.category : 'General',
      description: typeof raw.description === 'string' ? raw.description : '',
      parameters,
      steps,
      version: typeof raw.version === 'string' && raw.version ? raw.version : PROTOCOL_VERSION,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
    });
  }

  const runs: ProtocolRun[] = [];
  for (const raw of x.runs) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) {
      return { ok: false, error: 'run missing id' };
    }
    if (typeof raw.templateId !== 'string' || !raw.templateId) {
      return { ok: false, error: `run ${raw.id}: missing templateId` };
    }
    if (!isRunStatus(raw.status)) {
      return { ok: false, error: `run ${raw.id}: invalid status` };
    }
    if (!Array.isArray(raw.steps)) {
      return { ok: false, error: `run ${raw.id}: steps is not an array` };
    }

    const parameterValues: Record<string, string | number | boolean> = {};
    if (isRecord(raw.parameterValues)) {
      for (const [key, value] of Object.entries(raw.parameterValues)) {
        if (isPrimitiveValue(value)) parameterValues[key] = value;
      }
    }

    const steps: ProtocolRunStep[] = [];
    for (const rawStep of raw.steps) {
      if (!isRecord(rawStep) || typeof rawStep.stepId !== 'string' || !rawStep.stepId) {
        return { ok: false, error: `run ${raw.id}: step missing stepId` };
      }
      if (!isStepStatus(rawStep.status)) {
        return { ok: false, error: `run ${raw.id}: step ${rawStep.stepId} has invalid status` };
      }
      const step: ProtocolRunStep = { stepId: rawStep.stepId, status: rawStep.status };
      if (typeof rawStep.startedAt === 'string') step.startedAt = rawStep.startedAt;
      if (typeof rawStep.completedAt === 'string') step.completedAt = rawStep.completedAt;
      if (typeof rawStep.notes === 'string') step.notes = rawStep.notes;
      steps.push(step);
    }

    const run: ProtocolRun = {
      id: raw.id,
      templateId: raw.templateId,
      templateName:
        typeof raw.templateName === 'string' && raw.templateName
          ? raw.templateName
          : 'Untitled protocol',
      status: raw.status,
      operator: typeof raw.operator === 'string' ? raw.operator : '',
      parameterValues,
      steps,
      resultMarkdown: typeof raw.resultMarkdown === 'string' ? raw.resultMarkdown : '',
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
    };
    if (typeof raw.projectId === 'string') run.projectId = raw.projectId;
    if (typeof raw.projectName === 'string') run.projectName = raw.projectName;
    if (typeof raw.journalPageId === 'string') run.journalPageId = raw.journalPageId;
    if (typeof raw.startedAt === 'string') run.startedAt = raw.startedAt;
    if (typeof raw.completedAt === 'string') run.completedAt = raw.completedAt;
    runs.push(run);
  }

  return {
    ok: true,
    library: {
      format: PROTOCOL_FORMAT,
      version: PROTOCOL_VERSION,
      meta: {
        name: x.meta.name,
        createdAt: typeof x.meta.createdAt === 'string' ? x.meta.createdAt : now,
        updatedAt: typeof x.meta.updatedAt === 'string' ? x.meta.updatedAt : now
      },
      templates,
      runs
    }
  };
}

/** Aggregate counts used by hub cards and import previews. */
export function protocolStats(
  library: Pick<ProtocolLibraryFile, 'templates' | 'runs'>
): ProtocolStats {
  const stats: ProtocolStats = {
    templates: library.templates.length,
    runs: library.runs.length,
    plannedRuns: 0,
    runningRuns: 0,
    completedRuns: 0,
    abortedRuns: 0,
    steps: 0,
    pendingSteps: 0,
    runningSteps: 0,
    doneSteps: 0,
    skippedSteps: 0
  };

  for (const run of library.runs) {
    if (run.status === 'planned') stats.plannedRuns += 1;
    else if (run.status === 'running') stats.runningRuns += 1;
    else if (run.status === 'completed') stats.completedRuns += 1;
    else if (run.status === 'aborted') stats.abortedRuns += 1;

    for (const step of run.steps) {
      stats.steps += 1;
      if (step.status === 'pending') stats.pendingSteps += 1;
      else if (step.status === 'running') stats.runningSteps += 1;
      else if (step.status === 'done') stats.doneSteps += 1;
      else if (step.status === 'skipped') stats.skippedSteps += 1;
    }
  }

  return stats;
}
