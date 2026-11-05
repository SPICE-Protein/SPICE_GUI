<script lang="ts">
  // NIH BioArt browser for Figure Studio. The manifest is loaded lazily so the
  // editor shell renders immediately even when the asset bundle is missing.
  import { onDestroy, onMount } from 'svelte';
  import { Loader2, RefreshCw, Search } from 'lucide-svelte';
  import {
    assetCategories,
    formatAssetCredit,
    loadAssetManifest,
    searchAssets
  } from './assets';
  import { fm } from './messages';
  import type { AssetManifest, AssetManifestEntry } from './types';

  interface AssetPanelProps {
    onInsert: (asset: AssetManifestEntry) => void;
  }

  let { onInsert }: AssetPanelProps = $props();

  let manifest = $state<AssetManifest | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let query = $state('');
  let category = $state('all');
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  const categories = $derived(
    manifest ? assetCategories(manifest).filter((item) => item.toLowerCase() !== 'all') : []
  );
  const results = $derived(
    manifest ? searchAssets(manifest, query, category === 'all' ? undefined : category) : []
  );

  async function load() {
    loading = true;
    failed = false;
    try {
      manifest = await loadAssetManifest();
      failed = false;
    } catch {
      manifest = null;
      failed = true;
    } finally {
      loading = false;
    }
  }

  function pick(asset: AssetManifestEntry) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      onInsert(asset);
    }, 180);
  }

  function pickDouble(asset: AssetManifestEntry) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    onInsert(asset);
  }

  onMount(load);
  onDestroy(() => {
    if (clickTimer) clearTimeout(clickTimer);
  });
</script>

<div class="assets">
  <div class="search-row">
    <label class="search-box">
      <Search size={11} />
      <input
        class="pix-input"
        type="search"
        data-testid="figure-asset-search"
        placeholder={fm.figSearchAssets()}
        aria-label={fm.figSearchAssets()}
        bind:value={query}
      />
    </label>
    <button class="pix-btn tiny-btn" title={fm.figAssets()} onclick={load} aria-label={fm.figAssets()}>
      <RefreshCw size={11} />
    </button>
  </div>

  <div class="filter-row">
    <select
      class="pix-select"
      data-testid="figure-asset-category"
      aria-label={fm.figAllCategories()}
      bind:value={category}
    >
      <option value="all">{fm.figAllCategories()}</option>
      {#each categories as item (item)}
        <option value={item}>{item}</option>
      {/each}
    </select>
    <span class="pix-dim tiny">
      {results.length}{#if manifest}/{manifest.assets.length}{/if}
    </span>
  </div>

  {#if loading}
    <div class="state pix-dim">
      <Loader2 size={18} class="spin" />
      <span>{fm.figAssets()}</span>
    </div>
  {:else if failed || (manifest && manifest.assets.length === 0)}
    <div class="state">
      <p>{fm.figNoAssets()}</p>
      <button class="pix-btn tiny-btn" onclick={load}>
        <RefreshCw size={10} /> {fm.figAssets()}
      </button>
    </div>
  {:else if results.length === 0}
    <div class="state pix-dim">
      <p>{fm.figNoAssets()}</p>
    </div>
  {:else}
    <div class="grid">
      {#each results as asset (asset.id)}
        <button
          class="asset-card"
          data-testid="figure-asset-item"
          data-asset-id={asset.id}
          title={`${asset.title} · ${formatAssetCredit(asset)}`}
          onclick={() => pick(asset)}
          ondblclick={() => pickDouble(asset)}
        >
          <span class="thumb">
            <img src={asset.file} alt={asset.title} loading="lazy" draggable="false" />
          </span>
          <span class="asset-title">{asset.title}</span>
          <span class="asset-category">{asset.category}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="foot">
    <span class="pix-dim tiny">{fm.figLicenseNote()}</span>
  </div>
</div>

<style>
  .assets {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    min-height: 0;
  }
  .search-row {
    display: flex;
    gap: 4px;
    align-items: stretch;
  }
  .search-box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 5px;
    border: 2px solid var(--pix-border-hi);
    background: var(--pix-bg);
    color: var(--pix-fg-dim);
  }
  .search-box .pix-input {
    border: none;
    background: transparent;
    flex: 1;
    min-width: 0;
    padding: 3px 0;
  }
  .pix-input,
  .pix-select {
    background: var(--pix-bg);
    color: var(--pix-fg);
    border: 2px solid var(--pix-border-hi);
    font-family: var(--pix-font);
  }
  .pix-input {
    font-size: 9.5px;
    padding: 3px 4px;
  }
  .pix-select {
    font-size: 9px;
    padding: 2px 4px;
  }
  .filter-row {
    display: flex;
    gap: 6px;
    align-items: center;
    justify-content: space-between;
  }
  .filter-row .pix-select {
    flex: 1;
    min-width: 0;
  }
  .pix-btn.tiny-btn {
    padding: 2px 6px;
    font-size: 8.5px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(86px, 1fr));
    gap: 5px;
    max-height: none;
  }
  .asset-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
    background: var(--pix-bg-2);
    border: 1px solid var(--pix-border);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    text-align: left;
    cursor: pointer;
    min-width: 0;
  }
  .asset-card:hover,
  .asset-card:focus-visible {
    border-color: var(--pix-cyan);
    background: var(--pix-bg-3);
  }
  .thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 62px;
    padding: 3px;
    background:
      repeating-conic-gradient(#e9eef5 0% 25%, #ffffff 0% 50%) 50% / 10px 10px;
    border: 1px solid var(--pix-border-hi);
    overflow: hidden;
  }
  .thumb img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    display: block;
  }
  .asset-title {
    font-size: 8.5px;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .asset-category {
    font-size: 8px;
    color: var(--pix-fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 20px 8px;
    text-align: center;
    font-size: 9px;
  }
  .state p {
    margin: 0;
    line-height: 1.5;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .foot {
    border-top: 1px dashed var(--pix-border);
    padding-top: 5px;
    line-height: 1.45;
  }
  .tiny {
    font-size: 8.5px;
  }
</style>
