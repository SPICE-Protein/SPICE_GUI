// Protein workstation: menus, all result tabs, and a sequence edit.

import {
  resetApp,
  goNav,
  expectTestId,
  openMenu,
  clickMenuItem,
  clickMenuAction,
  clickTabByText,
  expectTabSelected,
  uploadTo,
} from '../helpers.js';

async function openProtein() {
  await resetApp();
  await goNav('protein');
  await expectTestId('protein-workbench');
  const dismiss = await $('//button[normalize-space(.)="Dismiss"]');
  if (await dismiss.isExisting()) {
    await dismiss.click();
  }
}

describe('Protein workstation', () => {
  beforeEach(openProtein);

  it('opens and closes every menu', async () => {
    for (const id of [
      'protein-menu-file',
      'protein-menu-modeling',
      'protein-menu-mutation',
      'protein-menu-window',
    ]) {
      const menu = await $(`[data-testid="${id}"]`);
      const container = await menu.$('..');
      const dropdown = await container.$('.menu-dropdown');
      await openMenu(id);
      await dropdown.waitForDisplayed({ timeout: 10000 });
      await openMenu(id);
      await dropdown.waitForDisplayed({ timeout: 10000, reverse: true });
    }
  });

  it('switches every result tab', async () => {
    for (const tab of ['Fold', 'MD Engine', 'Molecular Pocket', 'Phase', 'Mutation', 'HT Screening']) {
      await clickTabByText(tab);
      await expectTabSelected(tab);
    }
  });

  it('switches tabs from the Window menu', async () => {
    await clickMenuAction('protein-menu-window', 'Structure Folding Panel');
    await expectTabSelected('Fold');
    await clickMenuAction('protein-menu-window', 'Dynamics Trajectory Panel');
    await expectTabSelected('MD Engine');
    await clickMenuAction('protein-menu-window', 'Environmental Phase Panel');
    await expectTabSelected('Phase');
    await clickMenuAction('protein-menu-window', 'Mutation Analysis Panel');
    await expectTabSelected('Mutation');
    await clickMenuAction('protein-menu-window', 'Batch Design Screening Panel');
    await expectTabSelected('HT Screening');
  });

  it('edits the input sequence', async () => {
    const textarea = await $('textarea');
    await textarea.waitForDisplayed({ timeout: 10000 });
    await textarea.setValue('ACDEFGHIKLMNPQRSTVWY');
    await expect(textarea).toHaveValue('ACDEFGHIKLMNPQRSTVWY');
  });

  it('imports a real PDB structure', async () => {
    await uploadTo('protein-pdb-input', './e2e/fixtures/1CRN.pdb');
    const log = await $('.log');
    await browser.waitUntil(
      async () => (await log.getText()).includes('Loaded PDB: 1CRN.pdb'),
      { timeout: 20000, timeoutMsg: 'PDB import was not logged' },
    );
    const textarea = await $('textarea');
    expect(await textarea.getValue()).toMatch(/^TTCCPSIVAR/);
  });
});
