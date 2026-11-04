// Local SPD stand-in for the desktop E2E. The packaged app reaches it through
// the Rust `spd_request` bridge, so the test exercises the real client parsing
// (envelopes, token headers, gene detail + region mapping) without a live
// account or network. Response shapes mirror d-api.spicebio.top.
import http from 'node:http';

export const SPD_MOCK_PORT = Number(process.env.SPD_MOCK_PORT || 43117);
export const SPD_MOCK_URL = `http://127.0.0.1:${SPD_MOCK_PORT}/api/v1`;
export const SPD_MOCK_TOKEN = 'spd_e2e';

const RNA = 'AUGGUGAGCAAGGGCGAGGAGCUGUUCACCGGGGUGGUGCCCAUCCUGGUCGAGCUGAACGGCAAGGACUUCAUCUGA';
const GENE_ID = 'spd:gene:e2e00000000000000000000000000001';

const geneRow = {
  id: GENE_ID,
  name: 'eGFP',
  symbol: 'eGFP',
  geneType: 'protein_coding',
  organismScientificName: 'Aequorea victoria',
  organism: { taxId: 6100, scientificName: 'Aequorea victoria' },
  accession: 'E2E001',
  locusTag: null,
  moleculeType: 'mRNA',
  dnaLength: null,
  rnaLength: RNA.length,
};

const geneDetail = {
  ...geneRow,
  description: 'Aequorea victoria green fluorescent protein, E2E fixture',
  definition: 'eGFP mRNA, complete cds',
  dnaSequence: null,
  rnaSequence: RNA,
  topology: 'linear',
  keywords: ['e2e', 'fluorescent protein'],
  organismLineage: ['Eukaryota', 'Metazoa'],
  sequenceVersion: 1,
  createdAt: 1790000000,
  updatedAt: 1790000000,
};

const regions = [
  {
    id: 'spd:gene-region:e2e0000000000000000000000000001',
    geneId: GENE_ID,
    molecule: 'rna',
    regionType: 'cds',
    description: 'eGFP CDS',
    featureKey: 'CDS',
    location: `1..${RNA.length}`,
    startPosition: 1,
    endPosition: RNA.length,
    strand: 'forward',
    qualifiers: [{ key: 'gene', value: 'eGFP' }],
    externalProteinId: 'NP_E2E',
    createdAt: 1790000000,
  },
];

function ok(data) {
  return { data, error: null, meta: { schemaVersion: '1.0.0' } };
}

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

async function route(req, res) {
  const url = new URL(req.url || '/', `http://127.0.0.1:${SPD_MOCK_PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  if (path === '/api/v1/health') {
    return send(res, 200, { ...ok({ apiVersion: '1.0.0', service: 'spd', status: 'ok' }) });
  }

  if (path === '/api/v1/user/me') {
    if (req.headers.authorization !== `Bearer ${SPD_MOCK_TOKEN}`) {
      return send(res, 401, { data: null, meta: { schemaVersion: '1.0.0' }, error: { code: 'UNAUTHORIZED', message: 'login required', fields: null } });
    }
    return send(res, 200, {
      user: { id: 'user-e2e', displayName: 'E2E User', orcidId: '0000-0000-0000-0001' },
      roles: [{ role: 'researcher', expiresAt: null }],
    });
  }

  if (path === '/api/v1/genes' && req.method === 'GET') {
    return send(res, 200, ok({ items: [geneRow] }));
  }

  if (path === '/api/v1/search' && req.method === 'POST') {
    const body = await readBody(req);
    const q = String(body.query || '').toLowerCase();
    const rows = [geneRow].filter((row) =>
      !q || row.name.toLowerCase().includes(q) || row.symbol.toLowerCase().includes(q),
    );
    return send(res, 200, ok(rows));
  }

  const regionMatch = path.match(/^\/api\/v1\/genes\/([^/]+)\/regions$/);
  if (regionMatch) {
    return send(res, 200, ok({ items: regions }));
  }

  const geneMatch = path.match(/^\/api\/v1\/genes\/([^/]+)$/);
  if (geneMatch) {
    return send(res, 200, ok({ gene: geneDetail }));
  }

  if (path === '/api/v1/restriction-enzymes/export') {
    return send(res, 200, ok({
      exportedAt: 1790000000,
      count: 1,
      enzymes: [{ name: 'EcoRI', recognitionSite: 'GAATTC', cutPosition: 'G^AATTC' }],
    }));
  }

  if (path === '/api/v1/restriction-enzymes') {
    return send(res, 200, ok({
      items: [{
        id: 'spd:restriction-enzyme:e2e',
        name: 'EcoRI',
        recognitionSite: 'GAATTC',
        cutPosition: 'G^AATTC',
        enzymeType: 'type_ii',
        targetMolecule: 'dna',
        proteinId: null,
        source: 'rebase',
        sourceRelease: '611',
      }],
    }));
  }

  if (path === '/api/v1/vectors' && req.method === 'GET') {
    return send(res, 200, ok([]));
  }

  return send(res, 404, {
    data: null,
    meta: { schemaVersion: '1.0.0' },
    error: { code: 'NOT_FOUND', message: `no mock route for ${req.method} ${path}`, fields: null },
  });
}

export function startSpdMock() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      void route(req, res).catch((error) => {
        send(res, 500, {
          data: null,
          meta: { schemaVersion: '1.0.0' },
          error: { code: 'MOCK_ERROR', message: String(error), fields: null },
        });
      });
    });
    server.once('error', reject);
    server.listen(SPD_MOCK_PORT, '127.0.0.1', () => {
      console.log(`SPD mock listening on ${SPD_MOCK_URL}`);
      resolve(server);
    });
  });
}

export function stopSpdMock(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}
