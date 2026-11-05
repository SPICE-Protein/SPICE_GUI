// Build the bundled NIH BioArt asset library for Figure Studio.
//
// For every id in scripts/bioart-ids.json the script downloads the public
// detail page, reads the metadata and the SVG file mapping embedded in it,
// downloads and sanitises the vector artwork, and writes:
//
//   static/bioart/assets/bioart-{id}.svg
//   static/bioart/manifest.json
//
// Only entries licensed Public Domain / CC0 / CC BY are recorded. Network
// failures and entries without an SVG representation are skipped so a flaky
// upstream never breaks the whole build. Existing files are reused unless
// --force is passed.
//
// Usage:
//   node scripts/sync-bioart.mjs [--force]
//   BIOART_PROXY=http://127.0.0.1:8889 node scripts/sync-bioart.mjs

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const idsPath = join(root, 'scripts', 'bioart-ids.json');
const outDir = join(root, 'static', 'bioart');
const assetDir = join(outDir, 'assets');
const manifestPath = join(outDir, 'manifest.json');

const BASE_URL = 'https://bioart.niaid.nih.gov';
const PROXY = process.env.BIOART_PROXY?.trim() || '';
const CONCURRENCY = Number(process.env.BIOART_CONCURRENCY || 5);
const ATTEMPTS = 3;

const force = process.argv.includes('--force');

const ALLOWED_LICENSE = [
  'public domain',
  'cc0',
  'cc by',
  'cc-by',
  'creative commons attribution',
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

/** Strip tags, comments and entities from an HTML fragment. */
function textOf(fragment) {
  return decodeEntities(
    String(fragment)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function stripScripts(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');
}

function firstMatch(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1] : '';
}

/** Read a labelled value from the rendered metadata block. */
function labelledValue(html, label) {
  const inline = firstMatch(
    html,
    new RegExp(`>\\s*${label}\\s*</h6>\\s*<p[^>]*>([\\s\\S]*?)</p>`, 'i'),
  );
  if (inline) return textOf(inline);
  const heading = firstMatch(
    html,
    new RegExp(`>\\s*${label}\\s*</h6>\\s*<h6[^>]*>([\\s\\S]*?)</h6>`, 'i'),
  );
  return heading ? textOf(heading) : '';
}

/** Extract the balanced JSON object that follows "filemapping". */
function extractFileMapping(html) {
  const key = html.search(/\\?"filemapping\\?"\s*:/);
  if (key < 0) return null;
  const start = html.indexOf('{', key);
  if (start < 0) return null;
  // The mapping is a small numeric object. Every quote in the streamed
  // payload is backslash-escaped, so count braces without string tracking.
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  const raw = html
    .slice(start, end)
    .replace(/\\+"/g, '"')
    .replace(/\\\\/g, '\\');
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstSvgFileId(mapping) {
  if (!mapping || typeof mapping !== 'object') return null;
  for (const value of Object.values(mapping)) {
    if (value && typeof value === 'object') {
      const fileId = Number(value.SVG);
      if (Number.isInteger(fileId) && fileId > 0) return fileId;
    }
  }
  return null;
}

function parseMetadata(html, id) {
  const clean = stripScripts(html);
  const title =
    textOf(firstMatch(clean, /<h4[^>]*>([\s\S]*?)<\/h4>/i)) || `BioArt ${id}`;

  const licenseAnchor = firstMatch(
    clean,
    /Licensing:[^<]*<a[^>]*>([\s\S]*?)<\/a>/i,
  );
  const license = licenseAnchor
    ? textOf(licenseAnchor)
    : textOf(firstMatch(clean, /Licensing:\s*([^<]{1,80})/i));

  const category = firstMatch(
    clean,
    />\s*Category:\s*<\/h6>\s*<h6[^>]*>([\s\S]*?)<\/h6>/i,
  );

  const description = firstMatch(
    clean,
    />\s*Description\s*<\/h6>\s*<hr[^>]*\/?>\s*<div[^>]*>\s*<h6[^>]*>([\s\S]*?)<\/h6>/i,
  );

  const citation = firstMatch(
    clean,
    />\s*Cite This Entry\s*<\/h6>\s*<h6[^>]*>([\s\S]*?)<\/h6>/i,
  );

  const keywords = labelledValue(clean, 'Keywords');

  // BioArt entries may list several categories ("Animals, Arthropods").
  // Keep the first as the primary filter bucket and expose the rest as tags.
  const categoryParts = textOf(category)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const primaryCategory = categoryParts[0] || 'Uncategorised';

  return {
    title,
    license: license || 'Unknown',
    category: primaryCategory,
    categoryTags: categoryParts.slice(1),
    creator: labelledValue(clean, 'Creator'),
    credit: labelledValue(clean, 'Credit'),
    citation: textOf(citation),
    description: textOf(description),
    tags: keywords
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

function licenseAllowed(license) {
  const normalized = license.toLowerCase().replace(/\s+/g, ' ').trim();
  return ALLOWED_LICENSE.some(
    (allowed) => normalized === allowed || normalized.startsWith(`${allowed} `),
  );
}

/** Remove active content and external references while keeping vector data. */
function sanitizeSvg(source) {
  let svg = String(source).replace(/^﻿/, '');
  svg = svg.replace(/<!DOCTYPE[\s\S]*?>/gi, '');
  svg = svg.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
  svg = svg.replace(/<script\b[^>]*\/>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*>[\s\S]*?<\/foreignObject\s*>/gi, '');
  svg = svg.replace(/<foreignObject\b[^>]*\/>/gi, '');

  // Event handlers, including unquoted values.
  svg = svg.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  svg = svg.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  svg = svg.replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '');

  // javascript: links and any remaining scheme text.
  svg = svg.replace(
    /(?:xlink:)?href\s*=\s*("|')\s*javascript:[^"']*\1/gi,
    '',
  );
  svg = svg.replace(/javascript\s*:/gi, '');

  // Keep namespace declarations, drop other remote references.
  const namespaces = [];
  svg = svg.replace(
    /\bxmlns(?::[\w.-]+)?\s*=\s*("[^"]*"|'[^']*')/gi,
    (match) => {
      const token = `__BIOART_XMLNS_${namespaces.length}__`;
      namespaces.push([token, match]);
      return token;
    },
  );
  svg = svg.replace(/https?:\/\/[^\s"'<>)]+/gi, '');
  for (const [token, match] of namespaces) {
    svg = svg.split(token).join(match);
  }

  return `${normalizeSvgNamespace(svg).trim()}\n`;
}

/**
 * Some files come from the NIH generator with the SVG namespace bound to a
 * prefix such as `ns0:`. Browsers render that as a standalone document but
 * not when the markup is inlined into HTML, so promote it to the default
 * namespace. Other prefixes (xlink, Illustrator metadata) are left alone.
 */
function normalizeSvgNamespace(svg) {
  const match = svg.match(
    /xmlns:([\w.-]+)\s*=\s*("|')http:\/\/www\.w3\.org\/2000\/svg\2/i,
  );
  if (!match) return svg;
  const prefix = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  svg = svg.replace(
    new RegExp(
      `xmlns:${prefix}\\s*=\\s*("|')http://www\\.w3\\.org/2000/svg\\1`,
      'gi',
    ),
    'xmlns="http://www.w3.org/2000/svg"',
  );
  return svg.replace(new RegExp(`\\b${prefix}:`, 'g'), '');
}

function parseLength(value) {
  if (!value) return NaN;
  const match = String(value)
    .trim()
    .match(/^([0-9]*\.?[0-9]+)\s*(px|pt|pc|mm|cm|in)?$/i);
  if (!match) return NaN;
  const amount = Number(match[1]);
  switch ((match[2] || 'px').toLowerCase()) {
    case 'pt':
      return (amount * 96) / 72;
    case 'pc':
      return amount * 16;
    case 'mm':
      return (amount * 96) / 25.4;
    case 'cm':
      return (amount * 96) / 2.54;
    case 'in':
      return amount * 96;
    default:
      return amount;
  }
}

function svgDimensions(svg) {
  const tag = firstMatch(svg, /(<(?:[\w.-]+:)?svg\b[^>]*>)/i);
  const attr = (name) => {
    const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
    return match ? match[2] ?? match[3] ?? '' : '';
  };
  let width = parseLength(attr('width'));
  let height = parseLength(attr('height'));

  if (!(width > 0 && height > 0)) {
    const parts = attr('viewBox')
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  }

  const round = (value) => Math.round(value * 100) / 100;
  return {
    width: width > 0 ? round(width) : 512,
    height: height > 0 ? round(height) : 512,
  };
}

async function curlOnce(url) {
  const marker = '\n__BIOART_STATUS__';
  const args = ['-sS', '-L', '--compressed'];
  if (PROXY) args.push('-x', PROXY);
  args.push('--connect-timeout', '20', '--max-time', '90', '-w', `${marker}%{http_code}`, url);
  const { stdout } = await execFileAsync('curl', args, {
    maxBuffer: 30 * 1024 * 1024,
    encoding: 'utf8',
  });
  const index = stdout.lastIndexOf(marker);
  if (index < 0) throw new Error('curl produced no status code');
  const body = stdout.slice(0, index);
  const status = Number(stdout.slice(index + marker.length).trim());
  if (!(status >= 200 && status < 300)) throw new Error(`HTTP ${status}`);
  return body;
}

async function fetchText(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await curlOnce(url);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await delay(700 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    run,
  );
  await Promise.all(workers);
  return results;
}

function loadIds() {
  const ids = JSON.parse(readFileSync(idsPath, 'utf8'));
  if (!Array.isArray(ids)) throw new Error('bioart-ids.json must be an array');
  return [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function loadExistingManifest() {
  if (force || !existsSync(manifestPath)) return new Map();
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const map = new Map();
    for (const entry of manifest.assets || []) {
      if (entry && typeof entry.id === 'string') map.set(entry.id, entry);
    }
    return map;
  } catch {
    return new Map();
  }
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function syncEntry(id, cached) {
  const assetId = `bioart-${id}`;
  const filePath = join(assetDir, `${assetId}.svg`);

  if (cached && existsSync(filePath)) {
    return { entry: cached, reused: true };
  }

  const sourceUrl = `${BASE_URL}/bioart/${id}`;
  const html = await fetchText(sourceUrl);
  const metadata = parseMetadata(html, id);

  if (!licenseAllowed(metadata.license)) {
    return { skip: `license not allowed (${metadata.license})` };
  }

  const fileId = firstSvgFileId(extractFileMapping(html));
  if (!fileId) return { skip: 'no SVG representation' };

  const rawSvg = await fetchText(`${BASE_URL}/api/bioarts/${id}/files/${fileId}`);
  const svg = sanitizeSvg(rawSvg);
  if (!/<(?:[\w.-]+:)?svg\b/i.test(svg) || !/viewBox|width=|height=/i.test(svg)) {
    return { skip: 'downloaded file is not usable SVG' };
  }

  writeFileSync(filePath, svg, 'utf8');
  const { width, height } = svgDimensions(svg);

  const entry = {
    id: assetId,
    title: metadata.title,
    category: metadata.category,
    tags: [...new Set([...metadata.tags, ...metadata.categoryTags])],
    file: `/bioart/assets/${assetId}.svg`,
    license: metadata.license,
    creator: metadata.creator,
    credit: metadata.credit,
    citation: metadata.citation,
    sourceUrl,
    sha256: sha256(svg),
    width,
    height,
  };
  return { entry, reused: false };
}

function sortAssets(entries) {
  return [...entries].sort((a, b) => {
    const category = a.category.localeCompare(b.category, 'en', { sensitivity: 'base' });
    if (category !== 0) return category;
    return a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
  });
}

async function main() {
  mkdirSync(assetDir, { recursive: true });
  const ids = loadIds();
  const cached = loadExistingManifest();

  console.log(
    `[bioart] syncing ${ids.length} ids via ${PROXY}${force ? ' (force)' : ''}`,
  );

  const results = await mapLimit(ids, CONCURRENCY, async (id) => {
    try {
      const result = await syncEntry(id, cached.get(`bioart-${id}`));
      if (result.skip) {
        console.warn(`[bioart] skip ${id}: ${result.skip}`);
        return { id, ...result };
      }
      console.log(
        `[bioart] ${result.reused ? 'reuse' : 'fetch'} ${id} "${result.entry.title}" (${result.entry.category})`,
      );
      return { id, ...result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[bioart] skip ${id}: ${reason}`);
      return { id, skip: reason };
    }
  });

  const entries = results
    .filter((result) => result.entry)
    .map((result) => result.entry);

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'NIH BioArt Source',
    licenseNote:
      'Each asset records the license, creator, credit and citation shown on its NIH BioArt Source detail page. Most entries are public domain (CC0); retain the credit and citation when reusing artwork.',
    assets: sortAssets(entries),
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const categories = [...new Set(entries.map((entry) => entry.category))].sort();
  const failures = results.filter((result) => !result.entry);
  const reused = results.filter((result) => result.reused).length;
  console.log(
    `[bioart] done: ${entries.length} assets (${reused} reused), ${failures.length} skipped`,
  );
  console.log(`[bioart] categories: ${categories.join(', ')}`);
  if (failures.length) {
    console.log(`[bioart] skipped ids: ${failures.map((item) => item.id).join(', ')}`);
  }
}

main().catch((error) => {
  console.error('[bioart] fatal:', error);
  process.exitCode = 1;
});
