// Lab operations: inventory registry and protocol runs. Everything is stored
// locally, so the specs only exercise the UI flow (no file dialogs).

import { resetApp, goNav, expectTestId, clickTestId, reloadApp } from '../helpers.js';

async function openLab() {
  await resetApp();
  await goNav('lab');
  await expectTestId('lab-page');
}

describe('Lab operations', () => {
  beforeEach(openLab);

  it('adds an inventory item', async () => {
    await clickTestId('inv-add');
    const name = await expectTestId('inv-name');
    await name.setValue('E2E Strain');
    await clickTestId('inv-save');

    await browser.waitUntil(
      async () => (await $$('[data-testid="inv-row"]')).length === 1,
      { timeout: 10000, timeoutMsg: 'inventory item was not added' },
    );
    const rows = await $$('[data-testid="inv-row"]');
    expect(await rows[0].getText()).toContain('E2E Strain');
  });

  it('creates a protocol template and starts a run', async () => {
    await clickTestId('lab-tab-protocols');
    await clickTestId('proto-new');
    const name = await expectTestId('proto-template-name');
    await name.setValue('E2E Protocol');
    await clickTestId('proto-template-save');
    await expectTestId('proto-template-card');

    await clickTestId('proto-run-btn');
    await clickTestId('proto-run-start');
    await expectTestId('proto-run-row');
  });

  it('imports the retired Gene LIMS primer store', async () => {
    await browser.execute(() => {
      localStorage.setItem('spice_primer_inventory', JSON.stringify([
        {
          id: 'p1',
          name: 'Legacy Fwd',
          sequence: 'GTTTTCCCAGTCACGAC',
          tm: 54,
          concentration: 100,
          volume: 45,
          location: 'Box A - A3',
        },
      ]));
    });
    // The inventory store hydrates once per app start, so reload after seeding.
    await reloadApp();
    await goNav('lab');
    await expectTestId('lab-page');

    const row = await $('//*[@data-testid="inv-row"][contains(normalize-space(.),"Legacy Fwd")]');
    await row.waitForDisplayed({ timeout: 10000 });
    expect(await row.getText()).toContain('Tm');

    await clickTestId('primer-tools');
    await expectTestId('primer-tools-modal');
  });

  it('does not keep inventory after a reload with cleared storage', async () => {
    // Guards the resetApp contract: the store hydrates from localStorage only.
    await clickTestId('inv-add');
    const name = await expectTestId('inv-name');
    await name.setValue('Transient Item');
    await clickTestId('inv-save');
    await openLab();
    const rows = await $$('[data-testid="inv-row"]');
    expect(rows.length).toBe(0);
  });
});
