// Gene Editor interaction coverage: every view tab, every floating panel
// reachable from the menu bar, and the main local editing operations.

import {
  resetApp,
  goNav,
  expectTestId,
  openMenu,
  clickMenuItem,
  clickMenuAction,
  visiblePanelCount,
  waitForPanelCount,
  waitForVisibleModal,
  closeModal,
  clickTabByText,
  expectTabSelected,
  uploadTo,
} from '../helpers.js';

const TOGGLE_PANELS = [
  // File
  ['gene-menu-file', 'Import from Ensembl...'],
  ['gene-menu-file', 'Import from NCBI...'],
  ['gene-menu-file', 'Import from UniProt...'],
  ['gene-menu-file', 'SPD Gene Library'],
  ['gene-menu-file', 'Project Collections...'],
  // Edit
  ['gene-menu-edit', 'Sequence Search'],
  // Cloning & Design
  ['gene-menu-cloning', 'Restriction Enzymes'],
  ['gene-menu-cloning', 'Codon Optimization'],
  ['gene-menu-cloning', 'PCR Primer Table'],
  ['gene-menu-cloning', 'PCR Simulator'],
  ['gene-menu-cloning', 'Agarose Gel Simulation'],
  ['gene-menu-cloning', 'Expression cassette builder'],
  ['gene-menu-cloning', 'Vector template assembly'],
  ['gene-menu-cloning', 'CRISPR Design Cabin'],
  ['gene-menu-cloning', 'Reaction Calculators'],
  ['gene-menu-cloning', 'Synthetic Gene Designer QC'],
  ['gene-menu-cloning', 'NGS & Genomics Engine'],
  ['gene-menu-cloning', 'Advanced Cloning & Markers'],
  ['gene-menu-cloning', 'Co-Design Panel'],
  ['gene-menu-cloning', 'Anneal Oligos'],
  ['gene-menu-cloning', 'Silent Mutagenesis'],
  ['gene-menu-cloning', 'Reverse Translate'],
  ['gene-menu-cloning', 'Primer Modifier'],
  ['gene-menu-cloning', 'DNA End Modification'],
  ['gene-menu-cloning', 'Fusion Frame Check'],
  ['gene-menu-cloning', 'Ribosomal Slippage'],
  // Analysis & Views
  ['gene-menu-analysis', 'Protein Multi-View'],
  ['gene-menu-analysis', 'RNA Folding Structure'],
  ['gene-menu-analysis', 'Sanger Trace Viewer'],
  ['gene-menu-analysis', 'Sanger Clone Validator'],
  ['gene-menu-analysis', 'Advanced Genomics Tools'],
  ['gene-menu-analysis', 'Synthetic Biology CAD'],
  ['gene-menu-analysis', 'Diagnostics'],
  ['gene-menu-analysis', 'Sequence BLAST & Evolution'],
  ['gene-menu-analysis', 'Sequence Alignment'],
  ['gene-menu-analysis', 'GC Sliding Window'],
  // Window
  ['gene-menu-window', 'Edit History Tree'],
  ['gene-menu-window', 'Activity Log'],
  ['gene-menu-window', 'Customize Settings'],
];

const MODALS = [
  ['gene-menu-file', 'Export Current Sequence...'],
  ['gene-menu-edit', 'Add Feature...'],
];

async function openGeneEditor() {
  await resetApp();
  await goNav('gene');
  await expectTestId('gene-workbench');
}

describe('Gene Editor', () => {
  beforeEach(openGeneEditor);

  it('switches every view tab', async () => {
    for (const tab of [
      'Circular Map',
      'Linear Map',
      'Sequence Map',
      'Features',
      'Properties',
      'Notes',
      'Circular Map',
    ]) {
      await clickTabByText(tab);
      await expectTabSelected(tab);
    }
  });

  async function togglePanels(panels) {
    for (const [menu, label] of panels) {
      console.log('[gene-panel]', label);
      const before = await visiblePanelCount();
      await openMenu(menu);
      await clickMenuItem(label);
      await waitForPanelCount(
        (count) => count !== before,
        `"${label}" did not open a panel (count stayed ${before})`,
      );
      await openMenu(menu);
      await clickMenuItem(label);
      await waitForPanelCount(
        (count) => count === before,
        `"${label}" did not close back to ${before} panels`,
      );
    }
  }

  it('opens and closes every File/Edit/Cloning panel', async () => {
    await togglePanels(TOGGLE_PANELS.slice(0, 20));
  });

  it('opens and closes every Analysis/Window panel', async () => {
    await togglePanels(TOGGLE_PANELS.slice(20));
  });

  it('reports diagnostics for the open document and locates a finding', async () => {
    await uploadTo('gene-file-input', './e2e/fixtures/diagnostics.fasta');
    const toast = await $('.toast');
    await toast.waitForDisplayed({ timeout: 15000 });

    await clickMenuAction('gene-menu-analysis', 'Diagnostics');
    const panel = await expectTestId('gene-diagnostics-panel');
    const text = await panel.getText();
    // The coverage line names the catalogue copy in use and the biorisk state.
    expect(text).toContain('Risk catalogs:');
    expect(text.toLowerCase()).toContain('gc');

    const locate = await panel.$('.//button[normalize-space(.)="Locate"]');
    await locate.waitForExist({ timeout: 10000 });
    await locate.scrollIntoView({ block: 'center' });
    await locate.click();
    await expect(panel).toBeDisplayed();

    const close = await panel.$('.//button[normalize-space(.)="[X]"]');
    await close.click();
    await panel.waitForDisplayed({ timeout: 10000, reverse: true });
  });

  it('reports the demo backbone as a 4522 bp feature across the origin, not a structural error', async () => {
    await clickTabByText('Features');
    const row = await $(
      '//div[contains(@class,"pix-panel")][.//span[contains(normalize-space(.), "pS8c-vector_backbone")]][not(.//div[contains(@class,"pix-panel")])]',
    );
    await row.waitForExist({ timeout: 10000 });
    expect(await row.getText()).toContain('4522');

    await clickMenuAction('gene-menu-analysis', 'Diagnostics');
    const panel = await expectTestId('gene-diagnostics-panel');
    expect(await panel.getText()).not.toContain('Feature outside the sequence');

    const close = await panel.$('.//button[normalize-space(.)="[X]"]');
    await close.click();
    await panel.waitForDisplayed({ timeout: 10000, reverse: true });
  });

  it('opens and closes every modal from the menu bar', async () => {
    for (const [menu, label] of MODALS) {
      await openMenu(menu);
      await clickMenuItem(label);
      await waitForVisibleModal();
      await closeModal();
    }
  });

  it('opens and closes the Cloning Simulation Wizard', async () => {
    const before = await visiblePanelCount();
    await clickMenuAction('gene-menu-cloning', 'Cloning Simulation Wizard...');
    await waitForPanelCount(
      (count) => count > before,
      'Cloning Simulation Wizard did not open',
    );
    const panel = await $(
      '//div[contains(@class,"floating-panel")][.//*[contains(normalize-space(.), "Cloning Simulation")]]',
    );
    await panel.waitForDisplayed({ timeout: 10000 });
    const close = await panel.$('.//button[normalize-space(.)="[X]"]');
    await close.click();
    await waitForPanelCount(
      (count) => count === before,
      'Cloning Simulation Wizard did not close',
    );
  });

  it('imports a real FASTA sequence file', async () => {
    await uploadTo('gene-file-input', './e2e/fixtures/phix174.fasta');
    const toast = await $('.toast');
    await toast.waitForDisplayed({ timeout: 15000 });
    const body = await browser.execute(() => document.body.innerText.toLowerCase());
    expect(body).toContain('phix174');
  });

  it('imports a real AB1 Sanger trace', async () => {
    await uploadTo('gene-sanger-input', './e2e/fixtures/310.ab1');
    const toast = await $('.toast');
    await toast.waitForDisplayed({ timeout: 20000 });
    await browser.waitUntil(
      async () => (await toast.getText()).toLowerCase().includes('sanger'),
      { timeout: 10000, timeoutMsg: 'Sanger import did not report success' },
    );

    await clickMenuAction('gene-menu-analysis', 'Sanger Trace Viewer');
    const trace = await $('//*[contains(normalize-space(.), "Raw Chromatogram Trace")]');
    await expect(trace).toBeDisplayed();
  });

  it('runs a sequence search', async () => {
    await clickMenuAction('gene-menu-edit', 'Sequence Search');
    const panel = await $(
      '//div[contains(@class,"floating-panel")][.//span[contains(normalize-space(.), "Sequence Search")]]',
    );
    await panel.waitForDisplayed({ timeout: 10000 });

    const input = await panel.$('input.pix-input[type="text"]');
    await input.setValue('ATG');
    await browser.keys(['Enter']);
    await browser.pause(300);
    await expect(panel).toBeDisplayed();

    await openMenu('gene-menu-edit');
    await clickMenuItem('Sequence Search');
  });

  it('adds a feature through the Feature Editor', async () => {
    await clickMenuAction('gene-menu-edit', 'Add Feature...');
    const modal = await waitForVisibleModal();

    await (await modal.$('input[type="text"]')).setValue('E2E Feature');
    const numbers = await modal.$$('input[type="number"]');
    await numbers[0].setValue('1');
    await numbers[1].setValue('30');
    await (await modal.$('.//button[normalize-space(.)="Save"]')).click();
    await modal.waitForDisplayed({ timeout: 10000, reverse: true });

    await clickTabByText('Features');
    await expectTabSelected('Features');
    const row = await $('//*[normalize-space(.)="E2E Feature"]');
    await expect(row).toBeDisplayed();
  });

  it('flips the sequence and undoes/redoes it', async () => {
    await clickMenuAction('gene-menu-edit', 'Flip / Reverse Complement');
    await browser.pause(200);
    const undo = await $(
      '//button[contains(@class,"menu-action-btn") and normalize-space(.)="Undo"]',
    );
    await browser.waitUntil(async () => await undo.isEnabled(), {
      timeout: 10000,
      timeoutMsg: 'Undo stayed disabled after flipping the sequence',
    });
    await clickMenuAction('gene-menu-edit', 'Undo');
    await browser.pause(200);
    await clickMenuAction('gene-menu-edit', 'Redo');
    await expectTestId('gene-workbench');
  });

  it('opens the ELN page manager on the Notes tab', async () => {
    await clickTabByText('Notes');
    await expectTabSelected('Notes');
    const manager = await $('//button[contains(normalize-space(.), "Page Manager")]');
    await manager.waitForClickable({ timeout: 10000 });
    await manager.click();
    const modal = await $('.modal-box');
    await modal.waitForDisplayed({ timeout: 10000 });
    await closeModal();
  });
});
