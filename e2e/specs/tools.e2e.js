// Bench tools: representative stateful workflows for qPCR, plate design,
// and the tree viewer. All offline; no native dialogs are opened.

import {
  resetApp,
  goNav,
  expectTestId,
  clickTestId,
  clickButtonByText,
  uploadTo,
} from '../helpers.js';

async function openTool(id) {
  await resetApp();
  await goNav('tools');
  await expectTestId(`tool-card-${id}`);
  await clickTestId(`tool-card-${id}`);
  await expectTestId('tool-page');
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

describe('Bench tools', () => {
  it('loads the qPCR example and switches every result tab', async () => {
    await openTool('qpcr');
    await clickFirstVisible('qpcr-load-example');

    for (const tab of ['Fold change', 'Delta Ct', 'Delta Delta Ct', 'Standard curve']) {
      await clickButtonByText(tab, '.tabs');
      const active = await $('.tabs button.active');
      expect((await active.getText()).trim()).toBe(tab);
    }
  });

  it('pastes samples and generates a plate layout', async () => {
    await openTool('plate');
    const paste = await expectTestId('plate-paste');
    await paste.setValue('SampleA,Group1\nSampleB,Group1\nSampleC,Group2');
    await clickTestId('plate-paste-apply');

    const generate = await expectTestId('plate-generate');
    await browser.waitUntil(async () => await generate.isEnabled(), {
      timeout: 10000,
      timeoutMsg: 'Generate layout stayed disabled after pasting samples',
    });
    await generate.click();
    await browser.waitUntil(
      async () => (await generate.getText()).includes('Re-randomize'),
      { timeout: 10000, timeoutMsg: 'plate layout was not generated' },
    );
  });

  it('imports a real agarose gel and drafts lanes and bands', async () => {
    await openTool('gel');
    await uploadTo('gel-image-input', './e2e/fixtures/agarose_gel.jpg');

    const draft = await $('//button[normalize-space(.)="Auto draft"]');
    await browser.waitUntil(async () => await draft.isEnabled(), {
      timeout: 30000,
      timeoutMsg: 'gel image did not finish importing',
    });
    await draft.click();
    await browser.waitUntil(
      async () => (await draft.getText()).trim() === 'Auto draft',
      { timeout: 120000, timeoutMsg: 'gel auto draft did not finish' },
    );

    // The fixture is a real 6-track gel with discrete bands. A photo of empty
    // apparatus would still "finish", so assert that the binarizer actually
    // found most lanes and a realistic number of bands.
    const laneCount = await expectTestId('gel-lane-count');
    const lanes = Number(await laneCount.getValue());
    expect(lanes).toBeGreaterThanOrEqual(5);
    expect(lanes).toBeLessThanOrEqual(8);

    // The purple UV background must not outvote the pink bands: a wrong
    // protein classification switches the detector and over-splits lanes.
    const dna = await $('//button[normalize-space(.)="DNA (agarose)"]');
    expect(await dna.getAttribute('class')).toContain('active');

    const bandButtons = await $$('.lane-list .lane-row button.tiny-btn');
    let bands = 0;
    for (const button of bandButtons) {
      bands += Number((await button.getText()).trim()) || 0;
    }
    expect(bands).toBeGreaterThanOrEqual(12);
    expect(bands).toBeLessThanOrEqual(30);

    // A stain preset changes the channel and polarity; detection only moves
    // when the user asks for it, and must still find the same six tracks.
    const preset = await expectTestId('gel-stain-preset');
    // The embedded driver's selectByAttribute does not fire `change`, so drive
    // the native select explicitly before re-detecting.
    await browser.execute(() => {
      const select = document.querySelector('[data-testid="gel-stain-preset"]');
      select.value = 'uv';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const redetect = await expectTestId('gel-redetect');
    await redetect.click();
    await browser.waitUntil(async () => !(await $('.detect-stale').isExisting()), {
      timeout: 120000,
      timeoutMsg: 'stain re-detection did not finish',
    });
    expect(await preset.getValue()).toBe('uv');
    expect(Number(await laneCount.getValue())).toBeGreaterThanOrEqual(5);
    expect(Number(await laneCount.getValue())).toBeLessThanOrEqual(8);
    expect(await dna.getAttribute('class')).toContain('active');
  });

  it('sends a rendered gel panel to Figure Studio', async () => {
    await openTool('gel');
    await uploadTo('gel-image-input', './e2e/fixtures/agarose_gel.jpg');

    const draft = await $('//button[normalize-space(.)="Auto draft"]');
    await browser.waitUntil(async () => await draft.isEnabled(), {
      timeout: 30000,
      timeoutMsg: 'gel image did not finish importing',
    });
    await draft.click();
    await browser.waitUntil(
      async () => (await draft.getText()).trim() === 'Auto draft',
      { timeout: 120000, timeoutMsg: 'gel auto draft did not finish' },
    );

    const send = await expectTestId('send-to-figure');
    await browser.waitUntil(async () => await send.isEnabled(), {
      timeout: 30000,
      timeoutMsg: 'send-to-figure stayed disabled after the gel figure rendered',
    });
    await send.click();

    await expectTestId('figure-tool');
    await expectTestId('figure-canvas');
    await browser.waitUntil(
      async () => (await $$('[data-testid="figure-node"][data-node-type="image"]')).length === 1,
      { timeout: 20000, timeoutMsg: 'gel panel was not inserted into Figure Studio' },
    );
  });

  it('runs gel binarization on the native backend', async () => {
    await openTool('gel');
    const result = await browser.execute(async () => {
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return { ok: false, error: 'tauri invoke unavailable' };
      const bytes = new Uint8Array([0, 255, 255, 0]);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      try {
        const buffer = await invoke('binarize_gel', {
          gray: btoa(binary),
          width: 2,
          height: 2,
        });
        return { ok: true, length: buffer.byteLength ?? buffer.length };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    });
    expect(result).toEqual({ ok: true, length: 4 });
  });

  it('imports a real western blot and runs auto detect', async () => {
    await openTool('blot');
    await uploadTo('blot-image-input', './e2e/fixtures/western_blot.jpg');

    const detect = await $('//button[normalize-space(.)="Auto detect"]');
    await browser.waitUntil(async () => await detect.isEnabled(), {
      timeout: 30000,
      timeoutMsg: 'blot image did not finish importing',
    });
    await detect.click();
    await browser.waitUntil(
      async () => (await detect.getText()).trim() === 'Auto detect',
      { timeout: 120000, timeoutMsg: 'blot auto detect did not finish' },
    );
  });

  it('imports a real colony plate and detects colonies', async () => {
    await openTool('colony');
    await uploadTo('colony-image-input', './e2e/fixtures/colonies.jpg');

    const detect = await $('//button[normalize-space(.)="Detect colonies"]');
    await browser.waitUntil(async () => await detect.isEnabled(), {
      timeout: 30000,
      timeoutMsg: 'colony image did not finish importing',
    });
    await detect.click();
    try {
      await browser.waitUntil(
        async () => {
          const count = await $('.count-big');
          if (!(await count.isExisting())) return false;
          const value = Number((await count.getText()).trim());
          return Number.isFinite(value) && value > 0;
        },
        { timeout: 120000, timeoutMsg: 'colony detection produced no colonies' },
      );
    } catch (error) {
      const state = await browser.execute(() => ({
        count: document.querySelector('.count-big')?.textContent ?? null,
        toasts: Array.from(document.querySelectorAll('.toast-title, .toast-body')).map(
          (node) => node.textContent,
        ),
        detectDisabled: Array.from(document.querySelectorAll('button')).some(
          (button) => button.textContent?.trim() === 'Detect colonies' && button.disabled,
        ),
      }));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}: ${JSON.stringify(state)}`,
      );
    }
  });

  it('toggles the gel display mode', async () => {
    await openTool('gel');
    const protein = await $('//button[contains(normalize-space(.), "Protein (SDS-PAGE)")]');
    await protein.waitForClickable({ timeout: 10000 });
    await protein.click();
    expect(await protein.getAttribute('class')).toContain('active');
  });

  it('switches every blot result tab', async () => {
    await openTool('blot');
    for (const tab of ['Results', 'Chart', 'Figure']) {
      await clickButtonByText(tab, '.right-tabs');
      const active = await $('.right-tabs .tab.active');
      expect((await active.getText()).trim()).toBe(tab);
    }
  });

  it('changes the colony export DPI', async () => {
    await openTool('colony');
    const dpi = await $('//button[normalize-space(.)="600 dpi"]');
    await dpi.waitForClickable({ timeout: 10000 });
    await dpi.click();
    expect(await dpi.getAttribute('class')).toContain('active');
  });

  it('zooms in the image annotator', async () => {
    await openTool('annotate');
    const zoom = await $('button[title="Zoom in"]');
    await zoom.waitForClickable({ timeout: 10000 });
    await zoom.click();
  });

  it('loads the tree example and switches layouts', async () => {
    await openTool('tree');
    await clickFirstVisible('tree-load-example');

    for (const layout of ['Cladogram', 'Circular', 'Phylogram']) {
      const button = await $(`//button[normalize-space(.)="${layout}"]`);
      await button.waitForClickable({ timeout: 10000 });
      await button.click();
    }

    const search = await $('input[placeholder="Find a leaf..."]');
    await search.waitForDisplayed({ timeout: 10000 });
  });
});
