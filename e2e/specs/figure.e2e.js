// Figure Studio: vector editing, layers/inspector wiring, BioArt insertion,
// templates and draft persistence. Exports open native save dialogs, so they
// are covered by unit tests instead of the desktop E2E.

import {
  resetApp,
  goNav,
  expectTestId,
  clickTestId,
  uploadTo,
} from '../helpers.js';

async function openFigure() {
  await resetApp();
  await goNav('tools');
  await expectTestId('tools-page');
  await clickTestId('tool-card-figure');
  await expectTestId('tool-page');
  await expectTestId('figure-tool');
  await expectTestId('figure-canvas');
}

async function nodeCount() {
  return (await $$('[data-testid="figure-node"]')).length;
}

async function waitForNodeCount(expected, timeout = 10000) {
  await browser.waitUntil(async () => (await nodeCount()) === expected, {
    timeout,
    timeoutMsg: `expected ${expected} figure nodes`,
  });
}

async function clickFirstVisible(testid) {
  const elements = await $$(`[data-testid="${testid}"]`);
  for (const element of elements) {
    if (await element.isDisplayed()) {
      await element.click();
      return element;
    }
  }
  throw new Error(`no visible element with data-testid="${testid}"`);
}

describe('Figure Studio', () => {
  beforeEach(openFigure);

  it('adds shapes and text, then undoes and redoes', async () => {
    const baseline = await nodeCount();

    await clickTestId('figure-add-rect');
    await waitForNodeCount(baseline + 1);
    await clickTestId('figure-add-text');
    await waitForNodeCount(baseline + 2);

    const text = await expectTestId('figure-text-input');
    await text.setValue('E2E labeled panel');
    const textContent = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="figure-node"][data-node-type="text"]'))
        .map((node) => node.textContent ?? '')
        .join(' '),
    );
    expect(textContent).toContain('E2E labeled panel');

    await clickTestId('figure-undo');
    await waitForNodeCount(baseline + 1);
    await clickTestId('figure-redo');
    await waitForNodeCount(baseline + 2);
  });

  it('edits document and node geometry from the inspector', async () => {
    const width = await expectTestId('figure-width');
    await width.setValue('100');
    await expect(width).toHaveValue('100');

    await clickTestId('figure-add-rect');
    await browser.execute(() => {
      const input = Array.from(document.querySelectorAll('input[type="number"]'))
        .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null);
      if (!(input instanceof HTMLInputElement)) throw new Error('numeric inspector field missing');
      input.value = '42';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(async () => {
      const value = await browser.execute(() => {
        const input = Array.from(document.querySelectorAll('input[type="number"]'))
          .find((candidate) => candidate instanceof HTMLElement && candidate.offsetParent !== null);
        return input instanceof HTMLInputElement ? input.value : '';
      });
      return value === '42';
    }, { timeout: 5000, timeoutMsg: 'numeric inspector edit did not stick' });
  });

  it('inserts a bundled NIH BioArt asset', async () => {
    const baseline = await nodeCount();
    await clickTestId('figure-sidebar-tab-assets');

    await browser.waitUntil(async () => (await $$('[data-testid="figure-asset-item"]')).length > 0, {
      timeout: 20000,
      timeoutMsg: 'BioArt manifest did not populate the asset panel',
    });
    await clickFirstVisible('figure-asset-item');
    await waitForNodeCount(baseline + 1);

    const assetNodes = await $$('[data-testid="figure-node"][data-node-type="asset"]');
    expect(assetNodes.length).toBe(1);
    const href = await browser.execute(() => {
      const image = document.querySelector(
        '[data-testid="figure-node"][data-node-type="asset"] image',
      );
      return image?.getAttribute('href') ?? '';
    });
    expect(href).toContain('/bioart/assets/');
  });

  it('applies a workflow template', async () => {
    await clickTestId('figure-sidebar-tab-templates');
    await expectTestId('figure-template-workflow');
    await clickTestId('figure-template-workflow');
    await browser.waitUntil(async () => (await nodeCount()) >= 8, {
      timeout: 10000,
      timeoutMsg: 'workflow template did not create its nodes',
    });
    const status = await expectTestId('figure-status-nodes');
    expect(await status.getText()).toBeTruthy();
  });

  it('adds a chart, changes its type, and copies/pastes objects', async () => {
    const baseline = await nodeCount();
    await clickTestId('figure-add-chart');
    await waitForNodeCount(baseline + 1);
    expect((await $$('[data-testid="figure-node"][data-node-type="chart"]')).length).toBe(1);

    // Native <select> change events are not fired by selectByAttribute in the
    // embedded driver, so drive it explicitly.
    await browser.execute(() => {
      const select = document.querySelector('[data-testid="figure-chart-type"]');
      if (!(select instanceof HTMLSelectElement)) throw new Error('chart type select missing');
      select.value = 'line';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const node = document.querySelector(
            '[data-testid="figure-node"][data-node-type="chart"]',
          );
          return !!node?.querySelector('polyline');
        }),
      { timeout: 5000, timeoutMsg: 'chart did not switch to a line chart' },
    );

    // Internal clipboard: copy the chart and paste a clone.
    await browser.keys(['Control', 'c']);
    await browser.keys(['Control', 'v']);
    await waitForNodeCount(baseline + 2);
  });

  it('adds a scale bar and edits its label', async () => {
    const baseline = await nodeCount();
    await clickTestId('figure-add-scalebar');
    await waitForNodeCount(baseline + 1);
    expect((await $$('[data-testid="figure-node"][data-node-type="scalebar"]')).length).toBe(1);

    const label = await expectTestId('figure-scalebar-label');
    await label.setValue('5 µm');
    await browser.execute(() => {
      const input = document.querySelector('[data-testid="figure-scalebar-label"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('scale bar label missing');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const node = document.querySelector(
            '[data-testid="figure-node"][data-node-type="scalebar"]',
          );
          return (node?.textContent ?? '').includes('5 µm');
        }),
      { timeout: 5000, timeoutMsg: 'scale bar label did not render' },
    );
  });

  it('crops an imported image from the inspector', async () => {
    await uploadTo('figure-image-input', './e2e/fixtures/agarose_gel.jpg');
    await browser.waitUntil(
      async () =>
        (await $$('[data-testid="figure-node"][data-node-type="image"]')).length === 1,
      { timeout: 15000, timeoutMsg: 'image was not imported' },
    );

    const left = await expectTestId('figure-crop-left');
    await left.setValue('10');
    await browser.execute(() => {
      const input = document.querySelector('[data-testid="figure-crop-left"]');
      if (!(input instanceof HTMLInputElement)) throw new Error('crop input missing');
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const image = document.querySelector(
            '[data-testid="figure-node"][data-node-type="image"]',
          );
          return !!image?.closest('[data-node-type="image"]')?.querySelector('clipPath');
        }),
      { timeout: 5000, timeoutMsg: 'image crop clip path did not appear' },
    );
  });

  it('imports a Mermaid flowchart as editable nodes', async () => {
    const baseline = await nodeCount();
    await clickTestId('figure-import-vector');
    await expectTestId('figure-import-dialog');
    await clickTestId('figure-import-tab-mermaid');

    const source = [
      'flowchart TD',
      '  A[Sample] --> B[QC]',
      '  B -->|pass| C[Analyze]',
      '  B -->|fail| D[Repeat]',
      '  D --> A',
    ].join('\n');
    const text = await $('[data-testid="figure-import-mermaid-text"]');
    await text.setValue(source);
    await clickTestId('figure-import-run');

    await browser.waitUntil(async () => !(await $('[data-testid="figure-import-dialog"]').isExisting()), {
      timeout: 60000,
      timeoutMsg: 'Mermaid import did not close',
    });
    await browser.waitUntil(async () => (await nodeCount()) > baseline, {
      timeout: 60000,
      timeoutMsg: 'Mermaid import created no figure nodes',
    });
    const paths = await $$('[data-testid="figure-node"][data-node-type="path"]');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('imports an SVG file as editable shapes and text', async () => {
    const baseline = await nodeCount();
    await clickTestId('figure-import-vector');
    await expectTestId('figure-import-dialog');
    await clickTestId('figure-import-tab-svg');

    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">',
      '  <rect x="10" y="10" width="80" height="50" fill="#e8f1f8" stroke="#1f6f8b"/>',
      '  <text x="20" y="40" font-family="Arial" font-size="14" fill="#111827">Imported</text>',
      '</svg>',
    ].join('');
    const text = await $('[data-testid="figure-import-svg-text"]');
    await text.setValue(svg);
    await clickTestId('figure-import-run');

    await browser.waitUntil(async () => !(await $('[data-testid="figure-import-dialog"]').isExisting()), {
      timeout: 30000,
      timeoutMsg: 'SVG import did not close',
    });
    await browser.waitUntil(async () => (await nodeCount()) >= baseline + 2, {
      timeout: 30000,
      timeoutMsg: 'SVG import did not create rect and text nodes',
    });
    expect((await $$('[data-testid="figure-node"][data-node-type="rect"]')).length).toBeGreaterThan(0);
    expect((await $$('[data-testid="figure-node"][data-node-type="text"]')).length).toBeGreaterThan(0);
  });

  it('runs the publication check', async () => {
    await clickTestId('figure-check');
    await expectTestId('figure-check-dialog');
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          return (
            !!document.querySelector('[data-testid="figure-check-pass"]') ||
            document.querySelectorAll('[data-testid="figure-check-issue"]').length > 0
          );
        }),
      { timeout: 15000, timeoutMsg: 'publication check did not finish' },
    );
    await clickTestId('figure-check-close');
  });

  it('persists the draft across a reload', async () => {
    const baseline = await nodeCount();
    await clickTestId('figure-add-rect');
    await waitForNodeCount(baseline + 1);
    await browser.pause(800);
    await browser.refresh();
    await expectTestId('figure-tool');
    await browser.waitUntil(async () => (await nodeCount()) === baseline + 1, {
      timeout: 15000,
      timeoutMsg: 'figure draft was not restored after reload',
    });
  });

  it('captures the figure into an open project', async () => {
    // Create a project first, then capture the current figure through the
    // shared ToolProjectBar strip.
    await goNav('project');
    await expectTestId('project-workbench');
    await clickTestId('project-new');
    await expectTestId('project-new-modal');
    await (await $('[data-testid="project-new-name"]')).setValue('Figure E2E Project');
    await clickTestId('project-new-create');
    await expectTestId('project-name');

    await goNav('tools');
    await expectTestId('tools-page');
    await clickTestId('tool-card-figure');
    await expectTestId('figure-tool');
    await clickTestId('figure-add-rect');
    await clickTestId('tool-project-capture');
    // Capture keeps the editor open and makes the figure the active doc.
    await expectTestId('tool-project-save');

    await goNav('project');
    await expectTestId('project-workbench');
    await browser.waitUntil(async () => {
      const rows = await $$('[data-testid="project-doc-row"][data-doc-kind="figure"]');
      return rows.length === 1;
    }, { timeout: 20000, timeoutMsg: 'captured figure document is missing from the project' });
  });
});
