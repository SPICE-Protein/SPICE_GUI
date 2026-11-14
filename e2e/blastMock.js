// Local NCBI / EBI / UniProt stand-in for the external BLAST E2E. The app
// redirects each base URL through localStorage, so the real client, parsers,
// polling loop and Rust HTTP bridge all execute against these fixtures.

import http from 'node:http';

export const BLAST_MOCK_PORT = Number(process.env.BLAST_MOCK_PORT || 43119);
export const BLAST_MOCK_URL = `http://127.0.0.1:${BLAST_MOCK_PORT}`;
export const NCBI_MOCK_BASE = `${BLAST_MOCK_URL}/blast`;
export const EBI_MOCK_BASE = `${BLAST_MOCK_URL}/ebi`;
export const UNIPROT_MOCK_BASE = `${BLAST_MOCK_URL}/uniprot`;
export const EUTILS_MOCK_BASE = `${BLAST_MOCK_URL}/eutils`;

export const BLAST_HIT_ACCESSION = 'XM_E2E001';
export const UNIPROT_HIT_ACCESSION = 'P42212';
export const UNIPROT_SEQUENCE =
  'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK';

/** Last form bodies, for assertions about what the panel submitted. */
export const blastRequests = { ncbi: '', ebi: '' };

/** Read the submitted forms over HTTP: the mock runs in the WDIO launcher,
 * while specs run in a worker, so importing the object would see a copy. */
export async function getBlastRequests() {
  const response = await fetch(`${BLAST_MOCK_URL}/requests`);
  return response.json();
}

const NCBI_JSON = {
  BlastOutput2: [
    {
      report: {
        program: 'blastn',
        search_target: { db: 'refseq_rna' },
        results: {
          search: {
            query_len: 78,
            hits: [
              {
                num: 1,
                description: [
                  {
                    id: `ref|${BLAST_HIT_ACCESSION}.1|`,
                    accession: BLAST_HIT_ACCESSION,
                    title: 'Aequorea victoria green fluorescent protein (eGFP), mRNA',
                    sciname: 'Aequorea victoria',
                  },
                ],
                len: 720,
                hsps: [
                  {
                    bit_score: 148.3,
                    score: 160,
                    evalue: 1e-38,
                    identity: 65,
                    align_len: 65,
                    gaps: 0,
                    query_from: 1,
                    query_to: 65,
                    hit_from: 1,
                    hit_to: 65,
                    query_strand: 'Plus',
                    hit_strand: 'Plus',
                    qseq: 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGAACGGCGA',
                    hseq: 'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGA',
                    midline: '||||||||||||||||||||||||||||||||||||||||||||||||||||||||| |||||||',
                  },
                ],
              },
            ],
          },
        },
      },
    },
  ],
};

const EBI_JSON = {
  program: 'blastp',
  query_len: 238,
  hits: [
    {
      hit_acc: UNIPROT_HIT_ACCESSION,
      hit_id: 'GFP_AEQVI',
      hit_def: 'SP:P42212 GFP_AEQVI Green fluorescent protein',
      hit_desc: 'Green fluorescent protein OS=Aequorea victoria OX=6100 GN=GFP',
      hit_os: 'Aequorea victoria',
      hit_len: 238,
      hit_hsps: [
        {
          hsp_bit_score: 491.5,
          hsp_score: 1264,
          hsp_expect: 3.3e-178,
          hsp_identity: 99.6,
          hsp_align_len: 238,
          hsp_gaps: 0,
          hsp_query_from: 1,
          hsp_query_to: 238,
          hsp_hit_from: 1,
          hsp_hit_to: 238,
          hsp_qseq: UNIPROT_SEQUENCE,
          hsp_hseq: UNIPROT_SEQUENCE,
          hsp_mseq: '|'.repeat(238),
        },
      ],
    },
  ],
};

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw));
  });
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { ...corsHeaders(), 'content-type': type });
  res.end(body);
}

async function route(req, res) {
  const url = new URL(req.url, BLAST_MOCK_URL);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname === '/requests') {
    send(res, 200, JSON.stringify(blastRequests), 'application/json');
    return;
  }

  if (url.pathname === '/blast/Blast.cgi') {
    if (req.method === 'POST') {
      blastRequests.ncbi = await readBody(req);
      send(
        res,
        200,
        [
          '<span id="QBlastInfoBegin">',
          '    RID = E2EBLAST01',
          '    RTOE = 1',
          '</span>',
        ].join('\n'),
      );
      return;
    }
    const cmd = url.searchParams.get('CMD');
    if (cmd === 'Get' && url.searchParams.get('FORMAT_OBJECT') === 'SearchInfo') {
      send(res, 200, 'Status=READY\nThereAreHits=yes\n');
      return;
    }
    if (cmd === 'Get' && url.searchParams.get('FORMAT_TYPE') === 'JSON2_S') {
      send(res, 200, JSON.stringify(NCBI_JSON), 'application/json');
      return;
    }
    send(res, 400, 'unsupported Blast.cgi request');
    return;
  }

  if (url.pathname === '/ebi/run' && req.method === 'POST') {
    blastRequests.ebi = await readBody(req);
    send(res, 200, 'ncbiblast-e2e-job');
    return;
  }

  if (url.pathname === '/ebi/status/ncbiblast-e2e-job') {
    send(res, 200, 'FINISHED');
    return;
  }

  if (url.pathname === '/ebi/result/ncbiblast-e2e-job/json') {
    send(res, 200, JSON.stringify(EBI_JSON), 'application/json');
    return;
  }

  if (url.pathname === '/ebi/result/ncbiblast-e2e-job/error') {
    send(res, 200, '');
    return;
  }

  if (url.pathname === `/uniprot/uniprotkb/${UNIPROT_HIT_ACCESSION}.fasta`) {
    send(res, 200, `>sp|${UNIPROT_HIT_ACCESSION}|GFP_AEQVI\n${UNIPROT_SEQUENCE}\n`);
    return;
  }

  if (url.pathname === '/eutils/efetch.fcgi') {
    send(res, 200, `>gi|e2e|ref|NP_E2E001.1| green fluorescent protein\n${UNIPROT_SEQUENCE}\n`);
    return;
  }

  send(res, 404, 'not found');
}

export function startBlastMock() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void route(req, res).catch((error) => {
        send(res, 500, JSON.stringify({ error: String(error) }), 'application/json');
      });
    });
    server.once('error', reject);
    server.listen(BLAST_MOCK_PORT, '127.0.0.1', () => {
      console.log(`BLAST mock listening on ${BLAST_MOCK_URL}`);
      resolve(server);
    });
  });
}

export function stopBlastMock(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}
