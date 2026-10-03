// SPD vector-template pipeline: upload a sequence as an artifact, publish it
// as a Vector Template (§13 design model), load templates back, and convert
// the restriction-enzyme catalog between SPD export format and the GUI's
// REBASE-style enzymeDatabase.
//
// All transport goes through `configureSpdClient()` so a token pasted in
// Settings is picked up without a restart (same idiom as the protein page).
import { configureSpdClient } from './store.svelte';
import { defaultEnzymesByName, type RestrictionEnzyme } from '$lib/genome/enzymes';
import type { SpdEnzymeExportItem, SpdVectorDesign, SpdVectorDetail, SpdVectorFeature, SpdVectorInsertionSite, SpdVectorValidation } from './types';

/** GUI workspace shape the vector publisher consumes (features are 0-based
 *  half-open as stored on the gene page; SPD features are 1-based inclusive). */
export interface VectorWorkspaceInput {
  name: string;
  sequence: string;
  circular: boolean;
  features: { name: string; start: number; end: number; type: string; forward?: boolean }[];
  insertionSites: { name: string; position: number }[];
}

/** The server's artifact-kind vocabulary (SUPPORTED_KINDS) has no dedicated
 *  plasmid-sequence kind; spd_front's design wizard uploads vector sequences
 *  as `sequencing_trace` too — stay consistent across clients. */
const SEQUENCE_ARTIFACT_KIND = 'sequencing_trace';
const SEQUENCE_MEDIA_TYPE = 'text/plain';

export interface PublishedVector {
  vectorId: string;
  artifactId: string;
  validation: SpdVectorValidation;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

let cachedUserId: string | null = null;
async function currentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const me = await configureSpdClient().me();
  const id = me?.user?.id;
  if (typeof id !== 'string' || !id) throw new Error('SPD user id unavailable — sign in a token in Settings first');
  cachedUserId = id;
  return id;
}

/** One text file through the full artifact pipeline:
 *  preflight → PUT bytes → register → complete. Content-addressed dedup means
 *  re-publishing an identical sequence returns the existing artifactId with
 *  created:false (no duplicate rows). */
export async function uploadTextArtifact(text: string, leafName: string): Promise<{ artifactId: string; sha256: string; created: boolean }> {
  const client = configureSpdClient();
  const uid = await currentUserId();
  const bytes = new TextEncoder().encode(text);
  const hex = await sha256Hex(bytes);
  const objectKey = `users/${uid}/vectors/${Date.now()}_${leafName.replace(/[^A-Za-z0-9._-]/g, '_')}`;
  const grant = await client.uploadPreflight(objectKey, SEQUENCE_MEDIA_TYPE, bytes.length);
  const receipt = await client.putUploadBytes(grant.uploadUrl, SEQUENCE_MEDIA_TYPE, bytes);
  if (receipt.sha256 && receipt.sha256 !== hex) {
    throw new Error(`server digest ${receipt.sha256.slice(0, 12)}… does not match local ${hex.slice(0, 12)}…`);
  }
  const artifact = await client.createArtifact({
    object_key: grant.objectKey,
    kind: SEQUENCE_ARTIFACT_KIND,
    media_type: SEQUENCE_MEDIA_TYPE,
    byte_length: bytes.length,
    sha256: `sha256:${hex}`,
  });
  await client.completeArtifact(artifact.artifactId, `sha256:${hex}`, bytes.length);
  return { artifactId: artifact.artifactId, sha256: hex, created: artifact.created !== false };
}

function toSpdFeatures(ws: VectorWorkspaceInput): SpdVectorFeature[] {
  return ws.features
    .filter((f) => f && f.name && f.end > f.start)
    .map((f) => ({
      id: f.name,
      type: f.type || 'feature',
      start: f.start + 1,          // GUI 0-based → SPD 1-based-inclusive
      end: f.end,
      strand: f.forward === false ? -1 : 1,
    }));
}

function toSpdSites(ws: VectorWorkspaceInput): SpdVectorInsertionSite[] {
  return ws.insertionSites
    .filter((s) => s && s.name)
    .map((s) => ({ id: s.name, position: Number.isFinite(s.position) ? Math.max(0, Math.round(s.position)) : 0 }));
}

/** Publish the current plasmid as an SPD Vector Template: sequence → artifact
 *  → POST /vectors → server-side validate. Returns all three ids + the
 *  validation report so the panel can show what the server thinks. */
export async function publishVector(ws: VectorWorkspaceInput): Promise<PublishedVector> {
  const client = configureSpdClient();
  const seq = ws.sequence.toUpperCase().replace(/[^ACGTNRYWSKMBVDH]/g, '');
  if (seq.length < 20) throw new Error('sequence too short to publish');
  const fasta = `>${ws.name || 'vector'} ${seq.length} bp\n` + seq.replace(/(.{60})/g, '$1\n');
  const { artifactId } = await uploadTextArtifact(fasta, `${(ws.name || 'vector').replace(/[^A-Za-z0-9._-]/g, '_')}.fasta`);

  const design: SpdVectorDesign = {
    name: ws.name || 'unnamed vector',
    topology: ws.circular ? 'circular' : 'linear',
    sequenceArtifactId: artifactId,
    coordinateSystem: '1-based-inclusive',
    features: toSpdFeatures(ws),
    insertionSites: toSpdSites(ws),
    provenance: { license: 'CC-BY-4.0', tool: 'SPICE GUI', note: 'published from gene workbench' },
  };
  const receipt = await client.createVector(design);
  const validation = await client.validateVector(receipt.id, { sequenceArtifactId: artifactId });
  return { vectorId: receipt.id, artifactId, validation };
}

export interface LoadedVectorTemplate { detail: SpdVectorDetail; sequence: string }

/** Load a template plus its raw sequence bytes (the artifact content is the
 *  FASTA that publishVector uploaded; parseSequence strips headers). */
export async function loadVectorTemplate(id: string): Promise<LoadedVectorTemplate> {
  const client = configureSpdClient();
  const detail = await client.getVector(id);
  let sequence = '';
  if (detail.sequenceArtifactId) {
    const text = await client.getArtifactContentText(detail.sequenceArtifactId);
    sequence = parseFastaSequence(text);
  }
  return { detail, sequence };
}

/** Accept either FASTA (multi-line joins, headers dropped) or bare sequence. */
export function parseFastaSequence(text: string): string {
  const lines = text.split(/\r?\n/);
  const isFasta = lines.some((l) => l.startsWith('>'));
  if (!isFasta) return text.replace(/\s+/g, '').toUpperCase();
  const out: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith('>') || line.startsWith(';')) continue;
    out.push(line.trim());
  }
  return out.join('').toUpperCase();
}

// ────────────────────── restriction enzyme conversion ──────────────────────

export interface SyncedEnzymeRow { name: string; motif: string; cutIndex: number; isBlunt: boolean }

/** SPD `cutPosition` is the site with one of ^ / | marking the top-strand cut
 *  (e.g. "G^AATTC", blunt "CCCC^GGGG"). Returns null when no marker or only
 *  markers-without-letters, so the caller skips the row instead of guessing. */
export function parseCutPosition(item: SpdEnzymeExportItem): SyncedEnzymeRow | null {
  const raw = (item.cutPosition || '').trim();
  const site = (item.recognitionSite || '').toUpperCase().replace(/[^A-Z]/g, '');
  let marker = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '^' || raw[i] === '/' || raw[i] === '|') { marker = i; break; }
  }
  if (marker < 0) return null;
  const letters = raw.slice(0, marker).replace(/[^A-Z]/g, '').toUpperCase();
  const restLetters = raw.replace(/[^A-Z]/g, '').toUpperCase();
  const motif = restLetters || site;
  if (!motif || motif.length < 2) return null;
  // A single marker cannot carry the bottom-strand cut. A palindromic
  // center cut is the only provably blunt reading (CCC^GGG); everything
  // else stays staggered, matching the REBASE fallback's assumption.
  const isBlunt = motif.length % 2 === 0 && letters.length === motif.length / 2;
  return { name: item.name, motif, cutIndex: letters.length, isBlunt };
}

export function exportItemsToRows(items: SpdEnzymeExportItem[]): SyncedEnzymeRow[] {
  const out: SyncedEnzymeRow[] = [];
  for (const item of items || []) {
    const row = parseCutPosition(item);
    if (row) out.push(row);
  }
  return out;
}

/** Built-in cutters representable in SPD's single-marker vocabulary: palindromic
 *  offsets (top + bottom === 2·len… actually bottom = len - top) and cuts inside
 *  the site. Type IIS (offset beyond the site) and IUPAC-ambiguous sites are
 *  skipped — SPD's cutPosition grammar (letters + one marker, no parentheses)
 *  cannot express them without lying about the geometry. */
export function seedableBuiltInEnzymes(): { entries: { name: string; recognitionSite: string; cutPosition: string; enzymeType: string }[]; skipped: number } {
  const entries: { name: string; recognitionSite: string; cutPosition: string; enzymeType: string }[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const enzyme of Object.values(defaultEnzymesByName as Record<string, RestrictionEnzyme | undefined>)) {
    if (!enzyme || !enzyme.name || !enzyme.site) continue;
    const key = enzyme.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const site = enzyme.site.toUpperCase();
    if (!/^[A-Z]+$/.test(site)) { skipped++; continue; }
    const top = enzyme.topSnipOffset ?? -1;
    const bottom = enzyme.bottomSnipOffset ?? -1;
    const symmetric = top >= 0 && bottom === site.length - top;
    const blunt = top >= 0 && top === bottom;
    if ((!symmetric && !blunt) || enzyme.isType2S) { skipped++; continue; }
    if (top <= 0 || top >= site.length) { skipped++; continue; }
    entries.push({
      name: enzyme.name,
      recognitionSite: site,
      cutPosition: `${site.slice(0, top)}^${site.slice(top)}`,
      enzymeType: 'type_ii',
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return { entries, skipped };
}

export interface SeedResult { created: number; existing: number; failed: number; skipped: number }

/** Push the built-in catalog into SPD's restriction-enzyme table (the seed
 *  action for an empty production DB). Bounded concurrency so a flaky D1 write
 *  slows the batch, never 265 simultaneous requests. */
export async function seedEnzymesToSpd(onProgress?: (done: number, total: number) => void): Promise<SeedResult> {
  const client = configureSpdClient();
  const { entries, skipped } = seedableBuiltInEnzymes();
  const result: SeedResult = { created: 0, existing: 0, failed: 0, skipped };
  const CONCURRENCY = 4;
  let i = 0;
  async function worker() {
    while (i < entries.length) {
      const entry = entries[i++];
      try {
        const receipt = await client.createRestrictionEnzyme(entry) as { created?: boolean; deduplicated?: boolean };
        if (receipt?.created === false || receipt?.deduplicated === true) result.existing++;
        else if (receipt) result.created++;
        else result.failed++;
      } catch {
        result.failed++;
      }
      onProgress?.(Math.min(i, entries.length), entries.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return result;
}
