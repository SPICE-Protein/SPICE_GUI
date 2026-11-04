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
