// External BLAST through the packaged app: the panel submits to the local
// NCBI/EBI mocks, polls, parses the real result shapes, and hands a UniProt hit
// to the Protein Workstation. Base URLs are redirected through localStorage,
// exactly like the production client reads them.

import {
  resetApp,
  goNav,
  expectTestId,
  clickTestId,
} from '../helpers.js';
import {
  NCBI_MOCK_BASE,
  EBI_MOCK_BASE,
  UNIPROT_MOCK_BASE,
  EUTILS_MOCK_BASE,
  BLAST_HIT_ACCESSION,
  UNIPROT_SEQUENCE,
  getBlastRequests,
} from '../blastMock.js';

async function openBlastPanel() {
  await browser.execute(
    (ncbi, ebi, uniprot, eutils) => {
      localStorage.setItem('spice_blast_ncbi_base', ncbi);
      localStorage.setItem('spice_blast_ebi_base', ebi);
      localStorage.setItem('spice_blast_uniprot_base', uniprot);
      localStorage.setItem('spice_blast_eutils_base', eutils);
    },
    NCBI_MOCK_BASE,
    EBI_MOCK_BASE,
    UNIPROT_MOCK_BASE,
    EUTILS_MOCK_BASE,
  );
  await goNav('gene');
  await expectTestId('gene-workbench');
  await clickTestId('gene-menu-file');
  await clickTestId('gene-menu-blast');
  await expectTestId('blast-window');
}

describe('External BLAST', () => {
  it('runs an NCBI nucleotide search and renders normalized hits', async () => {
    await resetApp();
    await openBlastPanel();

    const query = await expectTestId('blast-query');
    expect((await query.getValue()).length).toBeGreaterThan(10);

    await clickTestId('blast-run');
    await expectTestId('blast-results');

    const hit = await expectTestId('blast-hit-0');
    expect(await hit.getText()).toContain(BLAST_HIT_ACCESSION);
    expect(await hit.getText()).toContain('Aequorea victoria');
    const sent = await getBlastRequests();
    expect(sent.ncbi).toContain('CMD=Put');
    expect(sent.ncbi).toContain('PROGRAM=blastn');
    expect(sent.ncbi).toContain('DATABASE=refseq_rna');
  });

  it('searches UniProt through EBI and sends a hit to the Protein Workstation', async () => {
    await resetApp();
    await openBlastPanel();

    await clickTestId('blast-tab-uniprot');
    await clickTestId('blast-translate');
    const email = await expectTestId('blast-email');
    await email.setValue('e2e@example.org');

    await clickTestId('blast-run');
    await expectTestId('blast-results');

    const hit = await expectTestId('blast-hit-0');
    expect(await hit.getText()).toContain('P42212');
    const sent = await getBlastRequests();
    expect(sent.ebi).toContain('database=uniprotkb_swissprot');
    expect(sent.ebi).toContain('program=blastp');

    await hit.click();
    await clickTestId('blast-hit-action');

    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('/protein'),
      { timeout: 20000, timeoutMsg: 'protein handoff did not navigate' },
    );
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => localStorage.getItem('spice.protein.seq'))) ===
        UNIPROT_SEQUENCE,
      { timeout: 15000, timeoutMsg: 'protein page did not adopt the BLAST handoff' },
    );
    const pending = await browser.execute(() => localStorage.getItem('spice.protein.pending'));
    expect(pending).toBeNull();
  });
});
