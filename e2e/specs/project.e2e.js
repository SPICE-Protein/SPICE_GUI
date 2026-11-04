// Project hub: create a project, manage journal pages, edit metadata,
// and enter/exit Presenter mode. No file dialogs are touched.

import { resetApp, goNav, expectTestId, clickTestId } from '../helpers.js';

async function openProject() {
  await resetApp();
  await goNav('project');
  await expectTestId('project-workbench');
}

async function createProject(name = 'E2E Project') {
  await clickTestId('project-new');
  await expectTestId('project-new-modal');
  await (await $('[data-testid="project-new-name"]')).setValue(name);
  await clickTestId('project-new-create');
  await browser.waitUntil(
    async () => (await $('[data-testid="project-name"]').getValue()) === name,
    { timeout: 10000, timeoutMsg: 'project was not created' },
  );
}

describe('Project hub', () => {
  beforeEach(openProject);

  it('creates a project', async () => {
    await createProject();
    await expectTestId('project-name');
  });

  it('creates and edits journal pages', async () => {
    await createProject('Journal Project');
    await clickTestId('project-journal-new');
    const title = await expectTestId('project-journal-title');
    await title.setValue('E2E Page');
    await expect(title).toHaveValue('E2E Page');

    const tags = await expectTestId('project-journal-tags');
    await tags.setValue('e2e, smoke');
    await expect(tags).toHaveValue('e2e, smoke');

    // A second page exercises the tab strip.
    await clickTestId('project-journal-new');
    const tabs = await $$('.jtab');
    expect(tabs.length).toBeGreaterThanOrEqual(2);
  });

  it('opens and closes Presenter mode', async () => {
    await createProject('Presenter Project');
    await clickTestId('project-journal-new');

    const presenter = await expectTestId('project-presenter');
    expect(await presenter.isEnabled()).toBe(false);

    const editor = await $('.milkdown-crepe-editor');
    await editor.waitForDisplayed({ timeout: 20000 });
    await editor.click();
    const editable = await $('.milkdown-crepe-editor [contenteditable="true"]');
    await editable.click();
    await browser.execute(() => {
      const el = document.querySelector('.milkdown-crepe-editor [contenteditable="true"]');
      el.focus();
      document.execCommand('insertText', false, '# E2E Slide\n\nPresenter body');
    });

    await browser.waitUntil(async () => await presenter.isEnabled(), {
      timeout: 15000,
      timeoutMsg: 'Presenter did not become enabled after typing markdown',
    });
    await presenter.click();
    const overlay = await $('.presenter-overlay');
    await overlay.waitForDisplayed({ timeout: 10000 });
    await (await $('.ps-exit')).click();
    await overlay.waitForDisplayed({ timeout: 10000, reverse: true });
  });

  it('asks before closing a dirty project', async () => {
    await createProject('Close Project');
    const name = await expectTestId('project-name');
    await name.setValue('Close Project Edited');
    await browser.keys(['Tab']);
    await expect(name).toHaveValue('Close Project Edited');
    await expectTestId('project-close');
    await clickTestId('project-close');
    await expectTestId('project-close-modal');
    const modal = await $('[data-testid="project-close-modal"]');
    const buttons = await modal.$$('.pix-btn-reset');
    await buttons[buttons.length - 1].click();
    await modal.waitForDisplayed({ timeout: 10000, reverse: true });
  });
});
