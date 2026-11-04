// Shared helpers for the desktop E2E suite.
// The app is locale-aware; force English so text-based menu selectors are stable.

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export async function resetApp(locale = 'en') {
  await browser.execute((tag) => {
    localStorage.clear();
    // The Paraglide runtime reads localStorage first (see vite.config.js), so
    // this survives the reload and works in Tauri where cookies are rejected.
    localStorage.setItem('PARAGLIDE_LOCALE', tag);
  }, locale);
  await browser.refresh();
  await expectTestId('nav-home');

  const settings = await $('[data-testid="nav-settings"]');
  await browser.waitUntil(
    async () => (await settings.getText()).includes('Settings'),
    { timeout: 15000, timeoutMsg: `failed to switch locale to ${locale}` },
  );

  await goNav('home');
  await expectTestId('welcome-page');
}

export async function expectTestId(id, timeout = 20000) {
  const element = await $(`[data-testid="${id}"]`);
  await element.waitForDisplayed({ timeout });
  await expect(element).toBeDisplayed();
  return element;
}

export async function goNav(id) {
  const button = await $(`[data-testid="nav-${id}"]`);
  await button.waitForClickable({ timeout: 20000 });
  await button.click();
}

export async function goHome() {
  await goNav('home');
  await expectTestId('welcome-page');
}

export async function uploadTo(testId, filePath) {
  // The Tauri embedded WebDriver has no uploadFile command, so build a real
  // File in the page from the fixture bytes and fire the input's change event.
  const data = readFileSync(filePath).toString('base64');
  const name = basename(filePath);
  const ext = name.split('.').pop()?.toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'tif' || ext === 'tiff'
          ? 'image/tiff'
          : 'text/plain';
  // File inputs are display:none by design; only existence is required.
  const input = await $(`[data-testid="${testId}"]`);
  await input.waitForExist({ timeout: 10000 });
  await browser.execute(
    (selector, base64, fileName, fileType) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLInputElement)) throw new Error('file input not found');
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], fileName, { type: fileType }));
      el.files = transfer.files;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    `[data-testid="${testId}"]`,
    data,
    name,
    mime,
  );
  return input;
}

export async function clickTestId(id) {
  const element = await expectTestId(id);
  await element.waitForClickable({ timeout: 20000 });
  await element.click();
  return element;
}

export async function openMenu(menuTestId) {
  const menu = await $(`[data-testid="${menuTestId}"]`);
  await menu.waitForClickable({ timeout: 20000 });
  await menu.click();
}

export async function clickMenuItem(label) {
  const item = await $(
    `//button[contains(@class,"menu-action-btn") and normalize-space(.)="${label}"]`,
  );
  await item.waitForClickable({ timeout: 10000 });
  await item.scrollIntoView();
  await item.click();
  return item;
}

export async function clickMenuAction(menuTestId, label) {
  await openMenu(menuTestId);
  await clickMenuItem(label);
}

/**
 * Number of visible floating panels/modals. Used to assert that menu items
 * actually toggle a panel without depending on localized titles.
 */
export function visiblePanelCount() {
  return browser.execute(() => {
    const nodes = document.querySelectorAll(
      '.floating-panel, .spd-gene-panel, .modal-box',
    );
    let visible = 0;
    for (const node of nodes) {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      ) {
        visible += 1;
      }
    }
    return visible;
  });
}

export async function waitForPanelCount(predicate, message, timeout = 10000) {
  await browser.waitUntil(async () => predicate(await visiblePanelCount()), {
    timeout,
    timeoutMsg: message,
  });
}

export async function visibleModal() {
  const modals = await $$('.modal-box');
  for (const modal of modals) {
    if (await modal.isDisplayed()) return modal;
  }
  return null;
}

export async function waitForVisibleModal(timeout = 10000) {
  await browser.waitUntil(async () => (await visibleModal()) !== null, {
    timeout,
    timeoutMsg: 'no visible modal appeared',
  });
  return visibleModal();
}

export async function closeModal() {
  const modal = await waitForVisibleModal();
  const close = await modal.$('.//button[normalize-space(.)="[X]"]');
  await close.waitForClickable({ timeout: 10000 });
  await close.click();
  await browser.waitUntil(async () => (await visibleModal()) === null, {
    timeout: 10000,
    timeoutMsg: 'modal did not close',
  });
}

export async function clickTabByText(text) {
  const tab = await $(`//*[@role="tab" and normalize-space(.)="${text}"]`);
  await tab.waitForClickable({ timeout: 10000 });
  await tab.click();
  return tab;
}

export async function expectTabSelected(text) {
  const tab = await $(`//*[@role="tab" and normalize-space(.)="${text}"]`);
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export async function clickButtonByText(text, scope = '') {
  const button = scope
    ? await (await $(scope)).$(`.//button[normalize-space(.)="${text}"]`)
    : await $(`//button[normalize-space(.)="${text}"]`);
  await button.waitForClickable({ timeout: 10000 });
  await button.click();
  return button;
}

export async function setSelectByLabel(scopeSelector, labelText, value) {
  const label = await $(`${scopeSelector}//label[contains(normalize-space(.),"${labelText}")]`);
  const select = await label.$('select');
  await select.selectByAttribute('value', value);
}
