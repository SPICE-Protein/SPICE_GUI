import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assetById,
  assetCategories,
  assetCitationBlock,
  formatAssetCredit,
  searchAssets,
} from '$lib/tools/figure/assets';
import type { AssetManifest, AssetManifestEntry } from '$lib/tools/figure/types';

function entry(partial: Partial<AssetManifestEntry> & Pick<AssetManifestEntry, 'id'>): AssetManifestEntry {
  return {
    title: 'Untitled',
    category: 'Equipment',
    tags: [],
    file: `/bioart/assets/${partial.id}.svg`,
    license: 'Public Domain',
    creator: 'Ryan Kissinger',
    credit: 'Courtesy of NIAID',
    citation: '',
    sourceUrl: `https://bioart.niaid.nih.gov/bioart/${partial.id}`,
    sha256: '0'.repeat(64),
    width: 500,
    height: 500,
    ...partial,
  };
}

const plate = entry({
  id: 'bioart-1',
  title: '12 Well Plate',
  category: 'Equipment',
  tags: ['plate', 'lab', 'plastic'],
  citation:
    'NIAID Visual & Medical Arts. (10/7/2024). 12 Well Plate. NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/1',
});

const actin = entry({
  id: 'bioart-2',
  title: 'Actin Filament',
  category: 'Cells and Organelles',
  tags: ['protein', 'cytoskeleton'],
  creator: '',
  citation: '',
});

const arrow = entry({
  id: 'bioart-3',
  title: 'Curved Arrow',
  category: 'Shapes',
  tags: ['arrow', 'infographic'],
  citation:
    'NIAID Visual & Medical Arts. (10/7/2024). Curved Arrow. NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/3',
});

const virus = entry({
  id: 'bioart-4',
  title: 'Adenovirus',
  category: 'Viruses',
  tags: ['virus', 'capsid'],
  credit: 'Ryan Kissinger',
  citation: 'Adenovirus citation',
});

const manifest: AssetManifest = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'NIH BioArt Source',
  licenseNote: 'Retain credit and citation.',
  assets: [plate, actin, arrow, virus],
};

function ids(items: AssetManifestEntry[]): string[] {
  return items.map((item) => item.id);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('searchAssets', () => {
  it('returns everything for an empty query', () => {
    expect(ids(searchAssets(manifest, ''))).toEqual([
      'bioart-1',
      'bioart-2',
      'bioart-3',
      'bioart-4',
    ]);
  });

  it('matches title, category and tags without regard to case', () => {
    expect(ids(searchAssets(manifest, 'PLATE'))).toEqual(['bioart-1']);
    expect(ids(searchAssets(manifest, 'equipment'))).toEqual(['bioart-1']);
    expect(ids(searchAssets(manifest, 'cytoskeleton'))).toEqual(['bioart-2']);
    expect(ids(searchAssets(manifest, 'VIRUS'))).toEqual(['bioart-4']);
  });

  it('requires every whitespace separated term to match', () => {
    expect(ids(searchAssets(manifest, 'curved arrow'))).toEqual(['bioart-3']);
    expect(ids(searchAssets(manifest, 'curved protein'))).toEqual([]);
  });

  it('does not search creator or credit text', () => {
    expect(ids(searchAssets(manifest, 'courtesy'))).toEqual([]);
  });

  it('filters by category, treating "All" as no filter', () => {
    expect(ids(searchAssets(manifest, '', 'cells and organelles'))).toEqual(['bioart-2']);
    expect(ids(searchAssets(manifest, '', 'Equipment'))).toEqual(['bioart-1']);
    expect(ids(searchAssets(manifest, 'arrow', 'All'))).toEqual(['bioart-3']);
    expect(ids(searchAssets(manifest, '', 'Unknown'))).toEqual([]);
  });

  it('combines text and category filters', () => {
    expect(ids(searchAssets(manifest, 'protein', 'Cells and Organelles'))).toEqual([
      'bioart-2',
    ]);
    expect(ids(searchAssets(manifest, 'protein', 'Equipment'))).toEqual([]);
  });
});

describe('assetCategories', () => {
  it('starts with All and sorts the remaining categories', () => {
    expect(assetCategories(manifest)).toEqual([
      'All',
      'Cells and Organelles',
      'Equipment',
      'Shapes',
      'Viruses',
    ]);
  });


  it('splits multi-valued BioArt categories for filtering and grouping', () => {
    const multi = entry({
      id: 'bioart-6',
      title: 'Multi category',
      category: 'Anatomy, Cell Scenes, Environments',
    });
    const local: AssetManifest = { ...manifest, assets: [multi] };
    expect(ids(searchAssets(local, '', 'Cell Scenes'))).toEqual(['bioart-6']);
    expect(ids(searchAssets(local, '', 'Anatomy'))).toEqual(['bioart-6']);
    expect(assetCategories(local)).toEqual([
      'All',
      'Anatomy',
      'Cell Scenes',
      'Environments',
    ]);
  });

  it('deduplicates categories case-insensitively', () => {
    const duplicated: AssetManifest = {
      ...manifest,
      assets: [plate, { ...plate, id: 'bioart-5', category: 'equipment' }],
    };
    expect(assetCategories(duplicated)).toEqual(['All', 'Equipment']);
  });
});

describe('assetById', () => {
  it('finds an entry or returns undefined', () => {
    expect(assetById(manifest, 'bioart-3')?.title).toBe('Curved Arrow');
    expect(assetById(manifest, 'bioart-missing')).toBeUndefined();
  });
});

describe('formatAssetCredit', () => {
  it('formats title, creator, credit and license', () => {
    expect(formatAssetCredit(plate)).toBe(
      '12 Well Plate — Ryan Kissinger, Courtesy of NIAID (Public Domain)',
    );
  });

  it('omits empty fields and collapses duplicate attribution', () => {
    expect(formatAssetCredit(actin)).toBe(
      'Actin Filament — Courtesy of NIAID (Public Domain)',
    );
    expect(
      formatAssetCredit(
        entry({
          id: 'bioart-6',
          title: 'Shared Credit',
          creator: 'Courtesy of NIAID',
          credit: 'Courtesy of NIAID',
          license: '',
        }),
      ),
    ).toBe('Shared Credit — Courtesy of NIAID');
  });
});

describe('assetCitationBlock', () => {
  it('keeps only used assets, preserves order and deduplicates by id', () => {
    const block = assetCitationBlock([plate, actin, plate, virus]);
    expect(block.split('\n')).toEqual([
      plate.citation,
      'Actin Filament — Courtesy of NIAID (Public Domain)',
      virus.citation,
    ]);
  });

  it('returns an empty string when no assets are used', () => {
    expect(assetCitationBlock([])).toBe('');
  });
});

describe('loadAssetManifest', () => {
  it('fetches the manifest once and caches the result', async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(manifest), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { loadAssetManifest } = await import('$lib/tools/figure/assets');
    const first = await loadAssetManifest();
    const second = await loadAssetManifest();

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/bioart/manifest.json');
    expect(ids(first.assets)).toEqual(['bioart-1', 'bioart-2', 'bioart-3', 'bioart-4']);
  });

  it('returns an empty manifest when the request fails', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('missing', { status: 500 })),
    );

    const { loadAssetManifest } = await import('$lib/tools/figure/assets');
    const loaded = await loadAssetManifest();

    expect(loaded.assets).toEqual([]);
    expect(loaded.version).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('assetDataUrl', () => {
  it('encodes UTF-8 SVG bytes and caches by asset id', async () => {
    vi.resetModules();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>Ångström ± 5 µm</text></svg>';
    const fetchMock = vi.fn(async () => new Response(svg, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { assetDataUrl } = await import('$lib/tools/figure/assets');
    const first = await assetDataUrl(plate);
    const second = await assetDataUrl(plate);

    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const prefix = 'data:image/svg+xml;base64,';
    expect(first.startsWith(prefix)).toBe(true);
    const binary = atob(first.slice(prefix.length));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(svg);
  });

  it('does not cache a failed download', async () => {
    vi.resetModules();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(new Response('<svg/>', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { assetDataUrl } = await import('$lib/tools/figure/assets');
    await expect(assetDataUrl(plate)).rejects.toThrow('HTTP 404');
    await expect(assetDataUrl(plate)).resolves.toContain('data:image/svg+xml;base64,');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
