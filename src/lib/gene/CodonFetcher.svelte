<script lang="ts"> 
  import * as m from '$lib/paraglide/messages.js';

  import { Search, CloudDownload, Sparkles } from 'lucide-svelte';

  let {
    quickDbId = $bindable(''),
    customTaxId = $bindable('36329'),
    isFetching = false,
    isFetchingCodons = false,
    onFetchFromNcbi = () => {},
    onFetchCloudCodonTable = () => {},
    onCodonOptimize = () => {}
  } = $props<{
    quickDbId: string;
    customTaxId: string;
    isFetching: boolean;
    isFetchingCodons: boolean;
    onFetchFromNcbi: () => void;
    onFetchCloudCodonTable: () => void;
    onCodonOptimize: () => void;
  }>();
</script>

<div class="codon-fetcher-header" style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; font-family: var(--pix-font);">
  <div style="flex: 1; display: flex; gap: 4px; align-items: center;">
    <span class="pix-dim" style="font-size: 9px;">Gene ID:</span>
    <input class="pix-input" type="text" bind:value={quickDbId} placeholder="NCBI ID" style="flex: 1; padding: 1px 3px; font-size: 9px; height: 18px; min-width: 80px;"
      onkeydown={(e) => e.key === 'Enter' && onFetchFromNcbi()} />
    <button class="pix-btn-reset" disabled={isFetching} onclick={onFetchFromNcbi} style="padding: 0 6px; font-size: 9px; height: 18px; cursor: pointer;">
      <Search size={9} /> {isFetching ? '...' : m.btnFetch()}
    </button>
  </div>

  <div style="flex: 1.2; display: flex; gap: 4px; align-items: center;">
    <span class="pix-dim" style="font-size: 9px;">Kazusa Taxon:</span>
    <input class="pix-input" type="text" bind:value={customTaxId} placeholder="36329" style="width: 80px; padding: 1px 3px; font-size: 9px; height: 18px;"
      onkeydown={(e) => e.key === 'Enter' && onFetchCloudCodonTable()} />
    <button class="pix-btn-reset" disabled={isFetchingCodons} onclick={onFetchCloudCodonTable} style="padding: 0 6px; font-size: 9px; height: 18px; cursor: pointer; color: var(--pix-cyan);">
      <CloudDownload size={9} /> {isFetchingCodons ? '...' : m.btnPull()}
    </button>
    <button class="pix-btn-reset" onclick={onCodonOptimize} style="padding: 0 6px; font-size: 9px; height: 18px; cursor: pointer; color: var(--pix-green); border-color: var(--pix-green);">
      <Sparkles size={9} /> {m.btnOptimize()}
    </button>
  </div>
</div>
