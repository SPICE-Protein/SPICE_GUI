import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_FORMAT,
  PROTOCOL_VERSION,
  completeProtocolRun,
  createProtocolTemplate,
  createRunFromTemplate,
  newProtocolId,
  protocolStats,
  runSheetMarkdown,
  setRunStep,
  validateProtocolLibrary,
  type ProtocolLibraryFile,
  type ProtocolTemplate
} from '$lib/protocol/types';

function pcrTemplate(): ProtocolTemplate {
  return createProtocolTemplate({
    name: 'PCR amplification',
    category: 'Molecular biology',
    description: 'Standard colony PCR',
    parameters: [
      { key: 'cycles', label: 'Cycles', type: 'number', defaultValue: 30 },
      { key: 'annealing', label: 'Annealing', type: 'number', unit: 'C', defaultValue: 55 },
      { key: 'enzyme', label: 'Enzyme', type: 'select', defaultValue: 'Taq', options: ['Taq', 'Pfu'] },
      { key: 'dryRun', label: 'Dry run', type: 'boolean', defaultValue: false }
    ],
    steps: [
      { id: 's1', title: 'Denature', instructions: 'Heat to 95 C.', durationMin: 5, temperatureC: 95 },
      { id: 's2', title: 'Anneal', instructions: 'Cool to annealing temperature.' }
    ]
  });
}

describe('template creation', () => {
  it('fills ids, timestamps, and template defaults', () => {
    const template = createProtocolTemplate();
    expect(template.id.startsWith('protocol_')).toBe(true);
    expect(template.name).toBe('Untitled protocol');
    expect(template.category).toBe('General');
    expect(template.version).toBe(PROTOCOL_VERSION);
    expect(template.parameters).toEqual([]);
    expect(template.steps).toEqual([]);
    expect(Number.isNaN(Date.parse(template.createdAt))).toBe(false);
    expect(template.createdAt).toBe(template.updatedAt);
  });

  it('preserves supplied parameters and steps, generating missing step ids', () => {
    const template = createProtocolTemplate({
      name: '  Ligation  ',
      category: 'Cloning',
      parameters: [{ key: 'ratio', label: 'Insert:vector', type: 'text', defaultValue: '3:1' }],
      steps: [{ id: '', title: 'Mix', instructions: 'Add insert and vector.' }]
    });

    expect(template.name).toBe('Ligation');
    expect(template.category).toBe('Cloning');
    expect(template.parameters).toHaveLength(1);
    expect(template.parameters[0].defaultValue).toBe('3:1');
    expect(template.steps).toHaveLength(1);
    expect(template.steps[0].id.startsWith('step_')).toBe(true);
    expect(template.steps[0].instructions).toBe('Add insert and vector.');
  });

  it('creates unique prefixed ids', () => {
    const a = newProtocolId('run');
    const b = newProtocolId('run');
    expect(a.startsWith('run_')).toBe(true);
    expect(b.startsWith('run_')).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe('run creation and state transitions', () => {
  it('merges supplied values over template defaults and records links', () => {
    const template = pcrTemplate();
    const run = createRunFromTemplate(template, { cycles: 32, annealing: 60 }, {
      projectId: 'proj_1',
      projectName: 'Demo project',
      journalPageId: 'jp_1',
      operator: 'Ada'
    });

    expect(run.id.startsWith('run_')).toBe(true);
    expect(run.templateId).toBe(template.id);
    expect(run.templateName).toBe('PCR amplification');
    expect(run.status).toBe('planned');
    expect(run.operator).toBe('Ada');
    expect(run.projectId).toBe('proj_1');
    expect(run.projectName).toBe('Demo project');
    expect(run.journalPageId).toBe('jp_1');
    expect(run.resultMarkdown).toBe('');
    expect(run.parameterValues).toEqual({
      cycles: 32,
      annealing: 60,
      enzyme: 'Taq',
      dryRun: false
    });
    expect(run.steps).toEqual([
      { stepId: 's1', status: 'pending' },
      { stepId: 's2', status: 'pending' }
    ]);
    expect(run.steps).not.toBe(template.steps);
  });

  it('moves from planned to running and stamps step completion', () => {
    const run = createRunFromTemplate(pcrTemplate());

    setRunStep(run, 's1', 'running');
    expect(run.status).toBe('running');
    expect(run.startedAt).toBeTruthy();
    expect(run.steps[0].startedAt).toBeTruthy();
    expect(run.steps[0].completedAt).toBeUndefined();

    setRunStep(run, 's1', 'done');
    expect(run.steps[0].status).toBe('done');
    expect(run.steps[0].completedAt).toBeTruthy();
    expect(run.status).toBe('running');

    setRunStep(run, 's2', 'skipped');
    expect(run.steps[1].status).toBe('skipped');
    expect(run.steps[1].completedAt).toBeTruthy();
  });

  it('reopens to planned when a step is reset and ignores unknown steps', () => {
    const run = createRunFromTemplate(pcrTemplate());
    setRunStep(run, 's1', 'running');
    setRunStep(run, 's1', 'pending');

    expect(run.status).toBe('planned');
    expect(run.startedAt).toBeUndefined();
    expect(run.steps[0].startedAt).toBeUndefined();
    expect(run.steps[0].completedAt).toBeUndefined();

    const unchanged = setRunStep(run, 'missing', 'done');
    expect(unchanged.status).toBe('planned');
  });

  it('completes with result markdown', () => {
    const run = createRunFromTemplate(pcrTemplate());
    setRunStep(run, 's1', 'done');
    const before = run.updatedAt;
    completeProtocolRun(run, 'Single band at 500 bp.');

    expect(run.status).toBe('completed');
    expect(run.completedAt).toBeTruthy();
    expect(run.startedAt).toBeTruthy();
    expect(run.resultMarkdown).toBe('Single band at 500 bp.');
    expect(Date.parse(run.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before));
  });
});

describe('run sheet markdown', () => {
  it('renders status, operator, a top-level parameter table, checkbox steps, and results', () => {
    const template = pcrTemplate();
    const run = createRunFromTemplate(template, { cycles: 32, annealing: 60 }, {
      projectName: 'Demo project',
      operator: 'Ada'
    });
    setRunStep(run, 's1', 'done');
    run.steps[0].notes = 'Strong band';
    completeProtocolRun(run, 'Band at 500 bp.');

    const sheet = runSheetMarkdown(run, template);

    expect(sheet).toContain('# PCR amplification - Run Sheet');
    expect(sheet).toContain('- **Status:** completed');
    expect(sheet).toContain('- **Operator:** Ada');
    expect(sheet).toContain('- **Project:** Demo project');
    expect(sheet).toContain('## Parameters');
    expect(sheet).toContain('| Parameter | Value | Unit |');
    expect(sheet).toContain('| Cycles | 32 |  |');
    expect(sheet).toContain('| Annealing | 60 | C |');
    expect(sheet).toContain('| Enzyme | Taq |  |');
    expect(sheet).toContain('| Dry run | No |  |');
    expect(sheet).toContain('- [x] Denature');
    expect(sheet).toContain('- [ ] Anneal');
    expect(sheet).toContain('  - Notes: Strong band');
    expect(sheet).toContain('## Results');
    expect(sheet).toContain('Band at 500 bp.');

    // The parameter table must be a top-level block, not nested in a list.
    expect(sheet).not.toContain('- Parameters');
    const tableLines = sheet.split('\n').filter(line => line.startsWith('|'));
    expect(tableLines.length).toBeGreaterThan(0);
    expect(tableLines.every(line => line.startsWith('|'))).toBe(true);
    const parametersHeading = sheet.indexOf('## Parameters');
    const stepsHeading = sheet.indexOf('## Steps');
    expect(parametersHeading).toBeGreaterThan(-1);
    expect(parametersHeading).toBeLessThan(stepsHeading);
  });

  it('handles runs without a template and without results', () => {
    const run = createRunFromTemplate(pcrTemplate());
    const sheet = runSheetMarkdown(run, undefined);
    expect(sheet).toContain('# PCR amplification - Run Sheet');
    // Without template metadata the table falls back to raw value keys.
    expect(sheet).toContain('| cycles | 30 |  |');
    expect(sheet).toContain('| dryRun | No |  |');
    expect(sheet).toContain('_No steps._');
    expect(sheet).toContain('_No results recorded._');
  });
});

describe('validateProtocolLibrary', () => {
  const validLibrary = (): ProtocolLibraryFile => {
    const template = pcrTemplate();
    const run = createRunFromTemplate(template);
    return JSON.parse(
      JSON.stringify({
        format: PROTOCOL_FORMAT,
        version: PROTOCOL_VERSION,
        meta: {
          name: 'Lab protocols',
          createdAt: template.createdAt,
          updatedAt: template.updatedAt
        },
        templates: [template],
        runs: [run]
      })
    ) as ProtocolLibraryFile;
  };

  it('accepts a complete library and keeps its content', () => {
    const result = validateProtocolLibrary(validLibrary());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.format).toBe(PROTOCOL_FORMAT);
    expect(result.library.meta.name).toBe('Lab protocols');
    expect(result.library.templates).toHaveLength(1);
    expect(result.library.templates[0].parameters).toHaveLength(4);
    expect(result.library.runs).toHaveLength(1);
    expect(result.library.runs[0].steps).toHaveLength(2);
  });

  it('fills optional metadata on minimal documents', () => {
    const result = validateProtocolLibrary({
      format: PROTOCOL_FORMAT,
      version: PROTOCOL_VERSION,
      meta: { name: 'Minimal' },
      templates: [{ id: 't1', name: 'Template', parameters: [], steps: [] }],
      runs: []
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.library.templates[0].category).toBe('General');
    expect(result.library.templates[0].description).toBe('');
    expect(result.library.templates[0].version).toBe(PROTOCOL_VERSION);
    expect(typeof result.library.templates[0].createdAt).toBe('string');
  });

  it('rejects bad containers and content', () => {
    expect(validateProtocolLibrary(null).ok).toBe(false);
    expect(validateProtocolLibrary({ ...validLibrary(), format: 'SPICE_PROJECT' }).ok).toBe(false);
    expect(validateProtocolLibrary({ ...validLibrary(), version: '2.0' }).ok).toBe(false);
    expect(validateProtocolLibrary({ ...validLibrary(), meta: undefined }).ok).toBe(false);
    expect(validateProtocolLibrary({ ...validLibrary(), templates: 'nope' }).ok).toBe(false);

    const badStatus = validLibrary();
    badStatus.runs[0].status = 'archived' as never;
    expect(validateProtocolLibrary(badStatus).ok).toBe(false);

    const badParameter = validLibrary();
    badParameter.templates[0].parameters[0].type = 'date' as never;
    expect(validateProtocolLibrary(badParameter).ok).toBe(false);

    const badStep = validLibrary();
    badStep.runs[0].steps[0].status = 'blocked' as never;
    expect(validateProtocolLibrary(badStep).ok).toBe(false);
  });
});

describe('protocolStats', () => {
  it('counts templates, run statuses, and step statuses', () => {
    const template = pcrTemplate();
    const completed = createRunFromTemplate(template);
    setRunStep(completed, 's1', 'done');
    setRunStep(completed, 's2', 'skipped');
    completeProtocolRun(completed, 'ok');

    const running = createRunFromTemplate(template);
    setRunStep(running, 's1', 'running');

    const stats = protocolStats({ templates: [template], runs: [completed, running] });

    expect(stats).toEqual({
      templates: 1,
      runs: 2,
      plannedRuns: 0,
      runningRuns: 1,
      completedRuns: 1,
      abortedRuns: 0,
      steps: 4,
      pendingSteps: 1,
      runningSteps: 1,
      doneSteps: 1,
      skippedSteps: 1
    });
  });
});
