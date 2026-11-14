// Lua scripting panel: run a built-in script, propose and apply a document
// patch, and confirm the sandbox has no OS library.

import { resetApp, goNav, expectTestId, openMenu, clickTestId } from '../helpers.js';

async function openScripts() {
  await resetApp();
  await goNav('gene');
  await expectTestId('gene-workbench');
  await openMenu('gene-menu-cloning');
  await clickTestId('gene-menu-scripts');
  await expectTestId('script-panel');
}

async function selectScript(name) {
  const item = await $(`//button[contains(@class,"sp-item") and contains(normalize-space(.),"${name}")]`);
  await item.waitForClickable({ timeout: 10000 });
  await item.click();
}

describe('Lua scripting', () => {
  beforeEach(openScripts);

  it('runs a built-in script and shows its return value', async () => {
    await selectScript('GC window report');
    await clickTestId('script-run');

    const console = await expectTestId('script-console');
    await browser.waitUntil(
      async () => (await console.getText()).includes('window(s) of'),
      { timeout: 30000, timeoutMsg: 'GC script did not produce console output' },
    );
    const result = await expectTestId('script-result');
    expect(await result.getText()).toContain('"windows"');
  });

  it('proposes a codon patch and applies it', async () => {
    await selectScript('Codon optimisation');
    await clickTestId('script-run');

    const patch = await expectTestId('script-patch', 30000);
    await expect(patch).toBeDisplayed();
    await clickTestId('script-apply');
    await patch.waitForDisplayed({ timeout: 10000, reverse: true });
  });

  it('does not expose the OS library', async () => {
    await clickTestId('script-new');
    const source = await expectTestId('script-source');
    await source.setValue('return os.time()');
    await clickTestId('script-run');

    const error = await expectTestId('script-error', 30000);
    expect((await error.getText()).toLowerCase()).toContain('os');
  });
});
