// SPD integration through the packaged app's Rust bridge. A local mock
// (e2e/spdMock.js, started by wdio.conf.js) serves the current API shapes:
// {data, meta, error} envelopes, {items} gene lists, a bare search array, and
// token-gated /user/me.

import {
  resetApp,
  goNav,
  expectTestId,
  clickTestId,
  clickMenuAction,
  clickTabByText,
  expectTabSelected,
} from '../helpers.js';
import { SPD_MOCK_URL, SPD_MOCK_TOKEN } from '../spdMock.js';

const RNA_LENGTH = 78;

describe('SPD integration', () => {
  it('checks health and verifies a Universal API Token', async () => {
    await resetApp();
    await goNav('settings');
    await expectTestId('settings-page');

    const baseUrl = await expectTestId('spd-base-url');
    await baseUrl.setValue(SPD_MOCK_URL);
    await clickTestId('spd-health-btn');

    const health = await expectTestId('spd-health-status');
    expect((await health.getText()).trim()).toBe('spd · ok · v1.0.0');

    const token = await expectTestId('spd-token-input');
    await token.setValue(SPD_MOCK_TOKEN);
    await clickTestId('spd-verify-btn');

    const user = await expectTestId('spd-user-status');
    expect(await user.getText()).toContain('E2E User');

    // Verification is what persists the connection for the gene workbench.
    const stored = await browser.execute(() => ({
      base: localStorage.getItem('spice_spd_base_url'),
      token: localStorage.getItem('spice_spd_api_token'),
    }));
    expect(stored).toEqual({ base: SPD_MOCK_URL, token: SPD_MOCK_TOKEN });
  });

  it('searches and loads a public gene into the workbench', async () => {
    await resetApp();
    await browser.execute(
      (base, token) => {
        localStorage.setItem('spice_spd_base_url', base);
        localStorage.setItem('spice_spd_api_token', token);
      },
      SPD_MOCK_URL,
      SPD_MOCK_TOKEN,
    );
    await goNav('gene');
    await expectTestId('gene-workbench');

    await clickMenuAction('gene-menu-file', 'SPD Gene Library');
    await expectTestId('spd-gene-panel');

    const search = await expectTestId('spd-gene-search');
    await search.setValue('eGFP');
    await clickTestId('spd-gene-search-btn');

    // The mock's /search returns a bare array (the shape that regressed); the
    // client must normalize it to rows and expose a load action.
    const load = await expectTestId('spd-gene-load');
    await load.click();

    const name = await expectTestId('spd-gene-name');
    await browser.waitUntil(async () => (await name.getValue()) === 'eGFP', {
      timeout: 15000,
      timeoutMsg: 'SPD gene record did not enter the workbench',
    });

    // Loading replaces the workspace sequence with the record's transcript
    // (U→T) and maps its RNA region onto the DNA canvas.
    await clickTabByText('Properties');
    await expectTabSelected('Properties');
    const length = await expectTestId('gene-length');
    expect((await length.getText()).trim()).toBe(`${RNA_LENGTH} bp`);
  });
});
