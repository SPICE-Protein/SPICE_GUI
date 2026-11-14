// Capture the screenshots embedded in docs/images and docs/panels. Skipped
// during normal e2e runs; run explicitly with:
//   SPICE_DOCS_SCREENSHOTS=1 pnpm e2e --spec ./e2e/specs/docs-screenshots.e2e.js
//
// Captures land in build/docs-shots as PNG; scripts/docs-images.mjs resizes and
// converts them to WebP under docs/images and docs/panels/*/images.

import { mkdirSync } from 'node:fs';
import { resetApp, goNav, expectTestId, clickTestId, reloadApp } from '../helpers.js';

const enabled = process.env.SPICE_DOCS_SCREENSHOTS === '1';
const OUT_DIR = 'build/docs-shots';
const STAMP = '2026-11-14T09:00:00.000Z';

const INVENTORY_ITEMS = [
  {
    id: 'inv_demo_strain',
    kind: 'strain',
    name: 'E. coli DH5α',
    alias: 'DH5α',
    description: 'Standard cloning host.',
    organism: 'Escherichia coli',
    genotype: 'F– φ80lacZΔM15 Δ(lacZYA-argF)U169',
    quantity: 6,
    quantityUnit: 'vials',
    location: { freezer: 'F1', rack: 'Rack 2', box: 'Box A', position: 'A1' },
    status: 'available',
    qc: 'passed',
    tags: ['competent', 'glycerol stock'],
    parentIds: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'inv_demo_plasmid',
    kind: 'plasmid',
    name: 'pUC19',
    alias: 'AmpR',
    description: 'High-copy cloning vector.',
    sequence: 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCTCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGGCGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGGAAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAGGAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCCGCCCCCCTGACGAGCATCACAAAAATCGACGCTCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGAAGCTCCCTCGTGCGCTCTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTCGGGAAGCGTGGCGCTTTCTCAATGCTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTGTGCACGAACCCCCCGTTCAGCCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGACTTATCGCCACTGGCAGCAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTGGTGGCCTAACTACGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAGTTGGTAGCTCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGAAAAAAAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAAAGTATATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTATTTCGTTCATCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAGTGCTGCAATGATACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCCGAGCGCAGAAGTGGTCCTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTAGTTCGCCAGTTAATAGTTTGCGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTATGGCTTCATTCAGCTCCGGTTCCCAACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGCTCCTTCGGTCCTCCGATCGTTGTCAGAAGTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATAATTCTCTTACTGTCATGCCATCCGTAAGATGCTTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATAGTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTCAATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAAGTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCTCAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGTAACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTCACCAGCGTTTCTGGGTGAGCAAAAACAGGAAGGCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAATACTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTATTTAGAAAAATAAACAAATAGGGGTTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATCATGACATTAACCTATAAAAATAGGCGTATCACGAGGCCCTTTCGTCTTCAAGA',
    quantity: 120,
    quantityUnit: 'µL',
    concentration: 250,
    concentrationUnit: 'ng/µL',
    location: { freezer: 'F1', rack: 'Rack 2', box: 'Box A', position: 'A2' },
    status: 'available',
    qc: 'passed',
    tags: ['sequencing-verified'],
    parentIds: ['inv_demo_strain'],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'inv_demo_primer_f',
    kind: 'primer',
    name: 'pUC19_Fwd',
    description: 'M13 forward sequencing primer.',
    sequence: 'GTTTTCCCAGTCACGAC',
    concentration: 100,
    concentrationUnit: 'µM',
    quantity: 45,
    quantityUnit: 'µL',
    location: { box: 'Box A', position: 'A3' },
    status: 'available',
    qc: 'passed',
    tags: ['sequencing'],
    parentIds: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'inv_demo_primer_r',
    kind: 'primer',
    name: 'pUC19_Rev',
    sequence: 'CAGGAAACAGCTATGAC',
    concentration: 100,
    concentrationUnit: 'µM',
    quantity: 38,
    quantityUnit: 'µL',
    location: { box: 'Box A', position: 'A4' },
    status: 'available',
    qc: 'passed',
    tags: ['sequencing'],
    parentIds: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'inv_demo_q5',
    kind: 'reagent',
    name: 'Q5 High-Fidelity DNA Polymerase',
    alias: 'Q5',
    quantity: 1,
    quantityUnit: 'tube',
    concentration: 2,
    concentrationUnit: 'U/µL',
    location: { freezer: 'F2', rack: 'Rack 1', box: 'Box E', position: 'E4' },
    status: 'low',
    qc: 'passed',
    tags: ['enzyme', 'reorder'],
    parentIds: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
  {
    id: 'inv_demo_sample',
    kind: 'sample',
    name: 'HeLa lysate — 2026-11-12',
    quantity: 2,
    quantityUnit: 'aliquots',
    location: { freezer: 'F3', rack: 'Rack 1', box: 'Box C', position: 'C2' },
    status: 'quarantine',
    qc: 'untested',
    tags: ['lysate'],
    parentIds: [],
    createdAt: STAMP,
    updatedAt: STAMP,
  },
];

const PROTOCOL_LIBRARY = {
  format: 'SPICE_PROTOCOL_LIBRARY',
  version: '1.0',
  meta: { name: 'Demo protocol library', createdAt: STAMP, updatedAt: STAMP },
  templates: [
    {
      id: 'tpl_miniprep',
      name: 'Miniprep (alkaline lysis)',
      category: 'Cloning',
      description: 'Plasmid miniprep from an overnight culture.',
      parameters: [
        { key: 'culture_ml', label: 'Culture volume', type: 'number', unit: 'mL', defaultValue: 3 },
        { key: 'elution_ul', label: 'Elution volume', type: 'number', unit: 'µL', defaultValue: 50 },
        { key: 'kit', label: 'Kit', type: 'select', defaultValue: 'QIAGEN', options: ['QIAGEN', 'Monarch', 'In-house'] },
      ],
      steps: [
        { id: 'step_1', title: 'Harvest cells', instructions: 'Centrifuge 3 mL culture at 8,000 × g for 2 min; discard supernatant.', durationMin: 4 },
        { id: 'step_2', title: 'Resuspend and lyse', instructions: 'Resuspend in P1, add P2, invert 6 times, incubate 3 min.', durationMin: 5 },
        { id: 'step_3', title: 'Neutralise and clear', instructions: 'Add N3, invert, centrifuge 10 min at 13,000 × g.', durationMin: 12 },
        { id: 'step_4', title: 'Bind, wash, elute', instructions: 'Load supernatant on column, wash twice, elute in 50 µL EB.', durationMin: 8 },
      ],
      version: '1.0',
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: 'tpl_gibson',
      name: 'Gibson assembly',
      category: 'Cloning',
      description: 'Two-fragment isothermal assembly.',
      parameters: [
        { key: 'insert_ng', label: 'Insert', type: 'number', unit: 'ng', defaultValue: 100 },
        { key: 'vector_ng', label: 'Vector', type: 'number', unit: 'ng', defaultValue: 50 },
      ],
      steps: [
        { id: 'g1', title: 'Mix fragments', instructions: 'Combine insert and vector with 2× master mix.', durationMin: 2 },
        { id: 'g2', title: 'Incubate', instructions: '50 °C for 15 min, then chill on ice.', durationMin: 15, temperatureC: 50 },
      ],
      version: '1.0',
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ],
  runs: [
    {
      id: 'run_miniprep_demo',
      templateId: 'tpl_miniprep',
      templateName: 'Miniprep (alkaline lysis)',
      status: 'running',
      operator: 'A. Researcher',
      parameterValues: { culture_ml: 3, elution_ul: 50, kit: 'QIAGEN' },
      steps: [
        { stepId: 'step_1', status: 'done', startedAt: STAMP, completedAt: STAMP },
        { stepId: 'step_2', status: 'done', startedAt: STAMP, completedAt: STAMP },
        { stepId: 'step_3', status: 'running', startedAt: STAMP },
        { stepId: 'step_4', status: 'pending' },
      ],
      resultMarkdown: 'Pellets were smaller than usual; elution repeated once.',
      createdAt: STAMP,
      updatedAt: STAMP,
    },
    {
      id: 'run_gibson_demo',
      templateId: 'tpl_gibson',
      templateName: 'Gibson assembly',
      status: 'completed',
      operator: 'A. Researcher',
      parameterValues: { insert_ng: 100, vector_ng: 50 },
      steps: [
        { stepId: 'g1', status: 'done', startedAt: STAMP, completedAt: STAMP },
        { stepId: 'g2', status: 'done', startedAt: STAMP, completedAt: STAMP },
      ],
      resultMarkdown: 'Four colonies on Amp; two sent for sequencing.',
      createdAt: STAMP,
      updatedAt: STAMP,
    },
  ],
};

const PRESENTER_PAGE_MD = [
  '# Miniprep results',
  '',
  'Elution volume 50 µL; A260/280 = 1.86.',
  '',
  '> Mention the smaller pellet on the second prep.',
  '',
  '---',
  '',
  '## Next steps',
  '',
  '- Gibson assembly on Monday',
  '- Sequence two colonies',
  '',
  '> Sequencing order goes out on Friday.',
].join('\n');

const DEMO_PROJECT = {
  format: 'SPICE_PROJECT',
  version: '1.1',
  meta: {
    id: 'proj_demo_manual',
    name: 'Miniprep study',
    description: 'Demo project used for the manual screenshots.',
    pi: 'A. Researcher',
    createdAt: STAMP,
    updatedAt: STAMP,
    version: '1.0',
  },
  journal: {
    pages: [
      {
        id: 'jp_demo_miniprep',
        title: 'Miniprep results',
        markdownContent: PRESENTER_PAGE_MD,
        date: '2026-11-14',
        category: 'Experiment',
        tags: ['miniprep'],
      },
    ],
  },
  docs: [],
  files: [],
};

// Every Gene Editor menu entry that opens a panel, modal, or docked window.
// `shot` names both the PNG and the docs/panels page that embeds it.
const GENE_PANELS = [
  { menu: 'gene-menu-file', label: 'Import from Ensembl...', shot: 'gene-ensembl' },
  { menu: 'gene-menu-file', label: 'Import from NCBI...', shot: 'gene-ncbi' },
  { menu: 'gene-menu-file', label: 'Import from UniProt...', shot: 'gene-uniprot' },
  { menu: 'gene-menu-file', label: 'External BLAST…', shot: 'gene-blast' },
  { menu: 'gene-menu-file', label: 'SPD Gene Library', shot: 'gene-spd' },
  { menu: 'gene-menu-file', label: 'Project Collections...', shot: 'gene-collections' },
  { menu: 'gene-menu-file', label: 'Export Current Sequence...', shot: 'gene-export' },
  { menu: 'gene-menu-edit', label: 'Add Feature...', shot: 'gene-feature-editor' },
  { menu: 'gene-menu-edit', label: 'Auto-Annotate', shot: 'gene-auto-annotate' },
  { menu: 'gene-menu-edit', label: 'Sequence Search', shot: 'gene-search' },
  { menu: 'gene-menu-cloning', label: 'Restriction Enzymes', shot: 'gene-enzymes' },
  { menu: 'gene-menu-cloning', label: 'Codon Optimization', shot: 'gene-codon' },
  { menu: 'gene-menu-cloning', label: 'PCR Primer Table', shot: 'gene-primer-table' },
  { menu: 'gene-menu-cloning', label: 'PCR Simulator', shot: 'gene-pcr' },
  { menu: 'gene-menu-cloning', label: 'Agarose Gel Simulation', shot: 'gene-gel' },
  { menu: 'gene-menu-cloning', label: 'Cloning Simulation Wizard...', shot: 'gene-cloning-wizard' },
  { menu: 'gene-menu-cloning', label: 'Expression cassette builder', shot: 'gene-expression-cassette' },
  { menu: 'gene-menu-cloning', label: 'Vector template assembly', shot: 'gene-vector-template' },
  { menu: 'gene-menu-cloning', label: 'CRISPR Design Cabin', shot: 'gene-crispr' },
  { menu: 'gene-menu-cloning', label: 'Reaction Calculators', shot: 'gene-calculators' },
  { menu: 'gene-menu-cloning', label: 'Synthetic Gene Designer QC', shot: 'gene-qc' },
  { menu: 'gene-menu-cloning', label: 'NGS & Genomics Engine', shot: 'gene-ngs' },
  { menu: 'gene-menu-cloning', label: 'Advanced Cloning & Markers', shot: 'gene-cloning-extension' },
  { menu: 'gene-menu-cloning', label: 'Co-Design Panel', shot: 'gene-codesign' },
  { menu: 'gene-menu-cloning', label: 'Lua Scripts', shot: 'gene-scripts' },
  { menu: 'gene-menu-cloning', label: 'Anneal Oligos', shot: 'gene-anneal' },
  { menu: 'gene-menu-cloning', label: 'Silent Mutagenesis', shot: 'gene-silent-mut' },
  { menu: 'gene-menu-cloning', label: 'Reverse Translate', shot: 'gene-reverse-translate' },
  { menu: 'gene-menu-cloning', label: 'Primer Modifier', shot: 'gene-primer-modifier' },
  { menu: 'gene-menu-cloning', label: 'DNA End Modification', shot: 'gene-end-mod' },
  { menu: 'gene-menu-cloning', label: 'Fusion Frame Check', shot: 'gene-fusion-check' },
  { menu: 'gene-menu-cloning', label: 'Ribosomal Slippage', shot: 'gene-slippage' },
  { menu: 'gene-menu-analysis', label: 'Protein Multi-View', shot: 'gene-protein-view' },
  { menu: 'gene-menu-analysis', label: 'RNA Folding Structure', shot: 'gene-rna' },
  { menu: 'gene-menu-analysis', label: 'Sanger Trace Viewer', shot: 'gene-sanger-trace' },
  { menu: 'gene-menu-analysis', label: 'Sanger Clone Validator', shot: 'gene-sanger-validator' },
  { menu: 'gene-menu-analysis', label: 'Advanced Genomics Tools', shot: 'gene-genomics' },
  { menu: 'gene-menu-analysis', label: 'Synthetic Biology CAD', shot: 'gene-synbio' },
  { menu: 'gene-menu-analysis', label: 'Sequence BLAST & Evolution', shot: 'gene-blast-evolution' },
  { menu: 'gene-menu-analysis', label: 'Sequence Alignment', shot: 'gene-alignment' },
  { menu: 'gene-menu-analysis', label: 'GC Sliding Window', shot: 'gene-gc-window' },
  { menu: 'gene-menu-window', label: 'Edit History Tree', shot: 'gene-history' },
  { menu: 'gene-menu-window', label: 'Activity Log', shot: 'gene-logger' },
  { menu: 'gene-menu-window', label: 'Customize Settings', shot: 'gene-settings' },
];

const PROTEIN_PANES = [
  { menu: 'protein-menu-window', label: 'Structure Folding Panel', shot: 'protein-pane-fold' },
  { menu: 'protein-menu-window', label: 'Dynamics Trajectory Panel', shot: 'protein-pane-md' },
  { menu: 'protein-menu-window', label: 'Environmental Phase Panel', shot: 'protein-pane-phase' },
  { menu: 'protein-menu-window', label: 'Mutation Analysis Panel', shot: 'protein-pane-mutation' },
  { menu: 'protein-menu-window', label: 'Batch Design Screening Panel', shot: 'protein-pane-batch' },
];

async function setWindow() {
  try {
    await browser.setWindowSize(1440, 900);
  } catch {
    // The embedded driver may not support resizing; the launch size is already 1440×900.
  }
}

async function shot(name) {
  await browser.pause(700);
  await browser.saveScreenshot(`${OUT_DIR}/${name}.png`);
}

async function seed(key, value) {
  await browser.execute(
    (storageKey, json) => localStorage.setItem(storageKey, JSON.stringify(json)),
    key,
    value,
  );
}

async function closeMenus() {
  await browser.execute(() => document.body.click());
  await browser.pause(150);
}

// The Co-Pilot drawer lives in the layout, so it survives route changes and
// would cover the right edge of every panel shot.
async function closeAiPanel() {
  const panel = await $('[data-testid="ai-panel"]');
  if ((await panel.isExisting()) && (await panel.isDisplayed())) {
    await clickTestId('ai-toggle');
    await browser.pause(200);
  }
}

// Navigating through the page from a script is much faster than a WebDriver
// click round-trip per element; these helpers only touch app-owned buttons.
async function goWorkspace(navId, readyTestId) {
  await browser.execute((id) => {
    document.querySelector(`[data-testid="nav-${id}"]`)?.click();
  }, navId);
  await browser.pause(200);
  await expectTestId(readyTestId);
}

async function openMenuEntry(menuTestId, label) {
  const opened = await browser.execute(
    (menuId, text) => {
      document.querySelector(`[data-testid="${menuId}"]`)?.click();
      const button = Array.from(document.querySelectorAll('.menu-action-btn'))
        .find((candidate) => (candidate.textContent ?? '').trim() === text);
      if (!button) return false;
      button.click();
      return true;
    },
    menuTestId,
    label,
  );
  if (!opened) throw new Error(`menu entry not found: ${label}`);
  await browser.execute(() => document.body.click());
  await browser.pause(450);
}

// The enzyme panel is open by default and covers the right half of the stage;
// close it unless it is the panel being documented.
async function closeEnzymesPanel() {
  await browser.execute(() => {
    const panel = Array.from(document.querySelectorAll('.floating-panel'))
      .find((node) => (node.textContent ?? '').includes('Restriction Enzymes'));
    const close = panel
      ? Array.from(panel.querySelectorAll('.panel-header button'))
        .find((button) => (button.textContent ?? '').trim() === '[X]')
      : null;
    close?.click();
  });
  await browser.pause(200);
}

// Each panel gets a fresh mount of its workspace: menu toggles stay in component
// state, so navigating away is the only close that works for every panel type.
// The map canvas needs a beat after mount, otherwise it paints at the previous
// layout size and the screenshot shows clipped, oversized labels.
async function capturePanel(entry) {
  await goWorkspace('home', 'welcome-page');
  await closeAiPanel();
  await goWorkspace('gene', 'gene-workbench');
  await browser.pause(1100);
  if (entry.shot !== 'gene-enzymes') await closeEnzymesPanel();
  await openMenuEntry(entry.menu, entry.label);
  await browser.pause(700);
  await browser.saveScreenshot(`${OUT_DIR}/${entry.shot}.png`);
}

if (enabled) {
  mkdirSync(OUT_DIR, { recursive: true });
}

(enabled ? describe : describe.skip)('Docs screenshots', () => {
  before(setWindow);

  it('captures the Lab inventory and primer tools', async () => {
    await resetApp();
    await seed('spice_inventory_items', INVENTORY_ITEMS);
    await reloadApp();
    await goNav('lab');
    await expectTestId('lab-page');
    await shot('lab-inventory');

    await clickTestId('primer-tools');
    await expectTestId('primer-tools-modal');
    await shot('lab-primer-tools');
    await clickTestId('primer-tools-close');
  });

  it('captures the Lab protocol workspace', async () => {
    await resetApp();
    await seed('spice_protocol_library', PROTOCOL_LIBRARY);
    await reloadApp();
    await goNav('lab');
    await clickTestId('lab-tab-protocols');
    await clickTestId('proto-tab-runs');
    const row = await $('[data-testid="proto-run-row"]');
    await row.waitForDisplayed({ timeout: 10000 });
    await row.click();
    await shot('lab-protocols');
  });

  it('captures the Lua scripting panel', async () => {
    await resetApp();
    await goNav('gene');
    await expectTestId('gene-workbench');
    await (await $('[data-testid="gene-menu-cloning"]')).click();
    await clickTestId('gene-menu-scripts');
    await expectTestId('script-panel');
    await closeMenus();

    const gc = await $('//button[contains(@class,"sp-item") and contains(normalize-space(.),"GC window report")]');
    await gc.click();
    await clickTestId('script-run');
    await browser.waitUntil(
      async () => (await $('[data-testid="script-result"]').getText()).includes('"windows"'),
      { timeout: 30000, timeoutMsg: 'GC script did not finish' },
    );
    await shot('scripting');

    const codon = await $('//button[contains(@class,"sp-item") and contains(normalize-space(.),"Codon optimisation")]');
    await codon.click();
    await clickTestId('script-run');
    await expectTestId('script-patch', 30000);
    await shot('scripting-patch');
  });

  it('captures the AI Co-Pilot', async () => {
    await resetApp();
    await clickTestId('ai-toggle');
    await expectTestId('ai-panel');
    await shot('ai-copilot');
  });

  // Batches keep every `it` under the 120 s mocha budget while still capturing
  // one screenshot per menu entry.
  for (let start = 0; start < GENE_PANELS.length; start += 6) {
    const batch = GENE_PANELS.slice(start, start + 6);
    it(`captures Gene Editor panels ${start + 1}-${start + batch.length}`, async function () {
      this.timeout(360000);
      for (const panel of batch) {
        await capturePanel(panel);
      }
    });
  }

  it('captures every Protein Workstation pane', async function () {
    this.timeout(360000);
    for (const pane of PROTEIN_PANES) {
      await goWorkspace('home', 'welcome-page');
      await closeAiPanel();
      await goWorkspace('protein', 'protein-workbench');
      await browser.pause(900);
      await openMenuEntry(pane.menu, pane.label);
      await browser.pause(700);
      await browser.saveScreenshot(`${OUT_DIR}/${pane.shot}.png`);
    }
  });

  it('captures the Project Hub and Presenter', async () => {
    await resetApp();
    await seed('spice_project_current', { project: DEMO_PROJECT, filePath: null });
    await seed('spice_project_journal_active_proj_demo_manual', 'jp_demo_miniprep');
    await reloadApp();
    await goNav('project');
    await expectTestId('project-workbench');
    await shot('project-hub');

    const presenter = await expectTestId('project-presenter');
    await browser.waitUntil(async () => await presenter.isEnabled(), { timeout: 15000 });
    await presenter.click();
    await (await $('.presenter-overlay')).waitForDisplayed({ timeout: 10000 });
    await shot('project-presenter');

    await browser.keys(['p']);
    await browser.pause(400);
    await shot('project-presenter-view');
  });
});
