// Smoke coverage for the packaged desktop shell: startup, every top-level
// workspace, the tools hub routes, and the SPD Gene panel entry point.
// Selectors are data-testid based so the suite does not depend on locale.

async function goNav(id) {
  const button = await $(`[data-testid="nav-${id}"]`);
  await button.waitForClickable({ timeout: 20000 });
  await button.click();
}

async function expectTestId(id) {
  const element = await $(`[data-testid="${id}"]`);
  await element.waitForDisplayed({ timeout: 30000 });
  await expect(element).toBeDisplayed();
}

describe('SPICE GUI desktop smoke', () => {
  before(async () => {
    await expectTestId('nav-home');
    // The packaged webview can restore the previous route; always start home.
    await (await $('[data-testid="nav-home"]')).click();
  });

  it('opens on the welcome page', async () => {
    await expectTestId('welcome-page');
    await expect(browser).toHaveTitle(/SPICE/i);
  });

  it('navigates to every top-level workspace', async () => {
    await goNav('gene');
    await expectTestId('gene-workbench');

    await goNav('protein');
    await expectTestId('protein-workbench');

    await goNav('project');
    await expectTestId('project-workbench');

    await goNav('tools');
    await expectTestId('tools-page');

    await goNav('settings');
    await expectTestId('settings-page');

    await goNav('home');
    await expectTestId('welcome-page');
  });

  it('opens the SPD Gene library from the gene File menu', async () => {
    await goNav('gene');
    await expectTestId('gene-workbench');

    const fileMenu = await $('[data-testid="gene-menu-file"]');
    await fileMenu.waitForClickable({ timeout: 20000 });
    await fileMenu.click();

    const spdMenu = await $('[data-testid="gene-menu-spd"]');
    await spdMenu.waitForClickable({ timeout: 20000 });
    await spdMenu.click();

    await expectTestId('spd-gene-panel');
  });

  it('opens every card in the tools hub', async () => {
    await goNav('tools');
    await expectTestId('tools-page');

    const tools = ['gel', 'blot', 'qpcr', 'plate', 'colony', 'annotate', 'tree'];
    for (const id of tools) {
      const card = await $(`[data-testid="tool-card-${id}"]`);
      await card.waitForClickable({ timeout: 20000 });
      await card.click();

      await expectTestId('tool-page');
      await goNav('tools');
      await expectTestId('tools-page');
    }
  });
});
