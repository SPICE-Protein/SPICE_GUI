// Settings page: all four categories, a persisted theme value, Save All,
// and the keymap recorder (cancel with Escape).

import { resetApp, goNav, expectTestId, clickTestId } from '../helpers.js';

async function openSettings() {
  await resetApp();
  await goNav('settings');
  await expectTestId('settings-page');
}

describe('Settings', () => {
  beforeEach(openSettings);

  it('switches every settings category', async () => {
    for (const id of [
      'settings-tab-general',
      'settings-tab-gene',
      'settings-tab-protein',
      'settings-tab-keymap',
      'settings-tab-general',
    ]) {
      await clickTestId(id);
      await expectTestId('settings-page');
    }
  });

  it('shows the running version and offers an update check', async () => {
    const version = await expectTestId('settings-app-version');
    expect(await version.getText()).toMatch(/^\d+\.\d+\.\d+$/);
    const check = await expectTestId('settings-check-updates');
    expect(await check.isEnabled()).toBe(true);
  });

  it('lists both risk database syncs on the Gene Editor tab', async () => {
    await clickTestId('settings-tab-gene');
    // Button and heading text renders uppercase through CSS.
    const text = (await browser.execute(() => document.body.innerText)).toUpperCase();
    expect(text).toContain('NCBI AMRFINDERPLUS');
    expect(text).toContain('IBBIS COMMEC');

    const buttons = await $$('button');
    const labels = [];
    for (const button of buttons) labels.push((await button.getText()).trim().toUpperCase());
    // The control reflects the on-disk state; nothing is fetched without it.
    expect(
      labels.some((label) => label === 'INSTALL BIORISK DATABASE' || label === 'CHECK FOR UPDATE'),
    ).toBe(true);
    expect(labels).toContain('SYNC AMRFINDERPLUS');
  });

  it('changes the theme and saves all settings', async () => {
    const selects = await $$('select');
    expect(selects.length).toBeGreaterThan(0);
    // Second select on the General tab is the theme picker.
    await selects[1].selectByIndex(1);
    await clickTestId('settings-save');

    const toast = await $('.toast');
    await toast.waitForDisplayed({ timeout: 10000 });
  });

  it('records and cancels a keymap shortcut', async () => {
    await clickTestId('settings-tab-keymap');
    const record = await $('//button[normalize-space(.)="Record"]');
    await record.waitForClickable({ timeout: 10000 });
    await record.click();

    const prompt = await $('//button[contains(normalize-space(.), "Press")]');
    await prompt.waitForDisplayed({ timeout: 10000 });
    await browser.keys(['Escape']);
    await prompt.waitForDisplayed({ timeout: 10000, reverse: true });
  });
});
