<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { Plus, FileUp, Download, Trash2, FlaskConical as FlaskIcon, CaseSensitive } from 'lucide-svelte';
  import { 
    parseSnapGeneDna, 
    parseSequenceFile, 
    detectFormat, 
    BatchEngine 
  } from '$lib/genome';
  import { backend } from '$lib/backend/api';

  let {
    showCollectionsPanel = $bindable(false),
    drag,
    collectionsList = $bindable([]),
    dnaSeq = $bindable(),
    plasmidName = $bindable(),
    pushLog,
    pushToast
  } = $props<{
    showCollectionsPanel: boolean;
    drag: any;
    collectionsList: any[];
    dnaSeq: string;
    plasmidName: string;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let selectedCollectionFiles = $state<string[]>([]);
  let collectionFileInput = $state<HTMLInputElement | null>(null);
  let collectionZipFileInput = $state<HTMLInputElement | null>(null);
  let colSearch = $state('');
  let colSelectedTag = $state('All');

  let batchDpnIResults = $state<any[]>([]);
  let batchPrimerResults = $state<any[]>([]);
  let batchResultsType = $state<'none' | 'dpni' | 'primer'>('none');

  const colAllTags = $derived.by(() => {
    const tags = new Set<string>();
    collectionsList.forEach((item: any) => item.tags.forEach((t: string) => tags.add(t)));
    return ['All', ...tags];
  });

  const filteredCollections = $derived.by(() => {
    return collectionsList.filter((item: any) => {
      const matchSearch = item.name.toLowerCase().includes(colSearch.toLowerCase()) ||
                          (item.copyNumber && item.copyNumber.toLowerCase().includes(colSearch.toLowerCase())) ||
                          (item.resistance && item.resistance.toLowerCase().includes(colSearch.toLowerCase()));
      const matchTag = colSelectedTag === 'All' || item.tags.includes(colSelectedTag);
      return matchSearch && matchTag;
    });
  });

  function toggleSelectFile(name: string) {
    if (selectedCollectionFiles.includes(name)) {
      selectedCollectionFiles = selectedCollectionFiles.filter(n => n !== name);
    } else {
      selectedCollectionFiles = [...selectedCollectionFiles, name];
    }
  }

  function deleteCollectionFile(id: string) {
    const item = collectionsList.find((f: any) => f.id === id);
    if (!item) return;
    collectionsList = collectionsList.filter((f: any) => f.id !== id);
    selectedCollectionFiles = selectedCollectionFiles.filter(n => n !== item.name);
    pushLog(m.batchDeleteFileLog({ v1: item.name }));
    pushToast('success', m.deleteSuccess(), m.deleteItemName({ name: item.name }));
  }

  function handleImportCollectionFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    if (file.name.endsWith('.dna')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const buffer = event.target?.result as ArrayBuffer;
          const parsed = parseSnapGeneDna(new Uint8Array(buffer));
          const id = `col_${Date.now()}`;
          collectionsList.push({
            id,
            name: file.name,
            size: parsed.sequence.length,
            format: "SNAPGENE",
            tags: ["Imported", "SNAPGENE"],
            copyNumber: "Unknown",
            resistance: "Unknown",
            seq: parsed.sequence
          });
          pushLog(m.importSnapGeneSuccessLog({ name: file.name, length: parsed.sequence.length }));
          pushToast('success', m.importSuccess(), file.name);
        } catch (err: any) {
          pushLog(m.importSnapGeneFailLog({ message: err.message }));
          pushToast('error', m.importSnapGeneFailed(), err.message);
        }
      };
      reader.readAsArrayBuffer(file);
      (e.target as HTMLInputElement).value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseSequenceFile(text, file.name);
      const format = detectFormat(text, file.name);
      const id = `col_${Date.now()}`;
      
      collectionsList.push({
        id,
        name: file.name,
        size: parsed.sequence.length,
        format: format.toUpperCase(),
        tags: ["Imported", format.toUpperCase()],
        copyNumber: "Unknown",
        resistance: "Unknown",
        seq: parsed.sequence
      });
      
      pushLog(m.importSequenceSuccessLog({ name: file.name, length: parsed.sequence.length }));
      pushToast('success', m.importSuccess(), file.name);
    };
    reader.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }

  async function handleExportZip() {
    if (collectionsList.length === 0) {
      pushToast('error', m.zipExport(), m.batchEmptyCollectionDesc());
      return;
    }
    pushLog(m.batchZipPackingLog({ v1: collectionsList.length }));
    
    const entries = collectionsList.map((item: any) => ({
      name: item.name,
      seq: item.seq
    }));
    
    try {
      const res = await backend.exportCollectionZip(entries);
      if (res.error) {
        pushToast('error', m.zipExportFailed(), res.error);
        return;
      }
      
      const blob = b64ToBlob(res.data, "application/zip");
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spice_collection_${Date.now()}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      
      pushLog(m.batchZipExportDoneLog());
      pushToast('success', m.zipExportSuccess(), m.batchZipExportDoneDesc());
    } catch (err: any) {
      pushToast('error', m.batchZipExportCatchTitle(), err.message);
    }
  }

  function handleImportZipClick() {
    collectionZipFileInput?.click();
  }

  function handleImportZip(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const arrayBuffer = event.target?.result as ArrayBuffer;
      const bytes = new Uint8Array(arrayBuffer);
      const base64Str = bytesToBase64(bytes);

      pushLog(m.batchZipUnzipLog({ v1: file.name }));
      try {
        const res = await backend.importCollectionZip(base64Str);
        if (res.error) {
          pushToast('error', m.batchZipUnzipFailTitle(), res.error);
          return;
        }

        const entries = res.data;
        let count = 0;
        entries.forEach((entry: any) => {
          const id = `col_${Date.now()}_${count}`;
          collectionsList.push({
            id,
            name: entry.name,
            size: entry.seq.length,
            format: detectFormat(entry.seq, entry.name).toUpperCase(),
            tags: ["Imported", "ZIP"],
            copyNumber: "Unknown",
            resistance: "Unknown",
            seq: entry.seq
          });
          count++;
        });

        pushLog(m.batchZipImportDoneLog({ v1: entries.length }));
        pushToast('success', m.zipImportSuccess(), m.batchZipImportDoneDesc({ v1: entries.length }));
      } catch (err: any) {
        pushToast('error', m.zipImportError(), err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    (e.target as HTMLInputElement).value = '';
  }

  function b64ToBlob(b64Data: string, contentType = '', sliceSize = 512): Blob {
    const byteCharacters = atob(b64Data);
    const byteArrays = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
      const slice = byteCharacters.slice(offset, offset + sliceSize);
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }
    return new Blob(byteArrays, { type: contentType });
  }

  function bytesToBase64(bytes: Uint8Array): string {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  function handleBatchDpnI() {
    if (selectedCollectionFiles.length === 0) {
      pushToast('error', m.batchOpTitle(), m.batchSelectDpnIDesc());
      return;
    }
    pushLog(m.batchDpnIStartLog({ v1: selectedCollectionFiles.length }));
    
    const selectedSeqs = collectionsList.filter((f: any) => selectedCollectionFiles.includes(f.name)).map((f: any) => ({
      sequence: f.seq,
      name: f.name,
      circular: true
    }));

    const results = BatchEngine.batchDigest(selectedSeqs, ["DpnI"]);
    
    batchDpnIResults = results.map(res => {
      const positions = res.cutsites.map((c: any) => c.topSnipPosition + 1).join(', ');
      return {
        name: res.sequenceName,
        count: res.cutsitesCount,
        positions: positions || m.batchNoCutsites()
      };
    });
    batchResultsType = 'dpni';

    results.forEach(res => {
      pushLog(m.batchDpnIResultLog({ v1: res.sequenceName, v2: res.cutsitesCount }));
    });
    pushToast('success', m.batchDpnIDoneTitle(), m.batchDpnIDoneDesc({ v1: selectedCollectionFiles.length }));
  }

  function handleBatchPrimerDesign() {
    if (selectedCollectionFiles.length === 0) {
      pushToast('error', m.batchOpTitle(), m.batchSelectPrimerDesc());
      return;
    }
    pushLog(m.batchPrimerStartLog({ v1: selectedCollectionFiles.length }));
    
    const selectedSeqs = collectionsList.filter((f: any) => selectedCollectionFiles.includes(f.name)).map((f: any) => ({
      sequence: f.seq,
      name: f.name
    }));

    const results = BatchEngine.batchDesignPrimers(selectedSeqs, { relativeStart: 0, relativeEnd: 100, targetTm: 60 });
    
    batchPrimerResults = results.map(res => {
      return {
        name: res.sequenceName,
        fwdSeq: res.primers.forward.sequence,
        fwdTm: res.primers.forward.tm,
        revSeq: res.primers.reverse.sequence,
        revTm: res.primers.reverse.tm,
        productLength: (res.primers as any).productLength || (res.primers.forward.sequence.length + res.primers.reverse.sequence.length) // estimate or actual
      };
    });
    batchResultsType = 'primer';

    results.forEach(res => {
      pushLog(m.batchPrimerSuccessLog({ sequenceName: res.sequenceName, sequence: res.primers.forward.sequence, toFixed: res.primers.forward.tm.toFixed(1), arg0: res.primers.reverse.sequence, arg1: res.primers.reverse.tm.toFixed(1) }));
    });
    pushToast('success', m.batchPrimerDoneTitle(), m.batchPrimerDoneDesc({ v1: selectedCollectionFiles.length }));
  }
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; right: 310px; top: 120px; width: 565px; z-index: 60;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Trash2 size={12} /> {m.collectionsWorkspace()}</span>
    <button class="pix-btn-reset" onclick={() => showCollectionsPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>
  <div style="display: flex; flex-direction: column; gap: 8px; font-size: 10px;">
    <div class="pix-dim" style="font-size: 9px; margin-bottom: 2px;">{m.batchDoubleClickHint()}</div>
    
    <!-- Import / Export Toolbar -->
    <div style="display: flex; gap: 6px; margin-bottom: 2px;">
      <input type="file" accept=".gb,.gbk,.fasta,.fa,.txt" bind:this={collectionFileInput} onchange={handleImportCollectionFile} style="display: none;" />
      <input type="file" accept=".zip" bind:this={collectionZipFileInput} onchange={handleImportZip} style="display: none;" />

      <button class="pix-btn ok" onclick={() => collectionFileInput?.click()} style="flex: 1; padding: 3px 6px; font-size: 8.5px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;">
        <Plus size={10} /> {m.batchImportSeqBtn()}
      </button>
      <button class="pix-btn ok" onclick={handleImportZipClick} style="flex: 1; padding: 3px 6px; font-size: 8.5px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;">
        <FileUp size={10} /> {m.batchImportZipBtn()}
      </button>
      <button class="pix-btn" onclick={handleExportZip} style="flex: 1; padding: 3px 6px; font-size: 8.5px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;">
        <Download size={10} /> {m.batchExportZipBtn()}
      </button>
    </div>

    <!-- Search and Metadata Filter (Feature 9) -->
    <div style="display: flex; gap: 4px; margin-bottom: 4px;">
      <input 
        class="pix-input" 
        type="text" 
        bind:value={colSearch} 
        placeholder={m.batchSearchPlaceholder()}
        style="flex: 1.5; padding: 2px 4px; font-size: 8.5px; height: 18px;" 
      />
      <select 
        bind:value={colSelectedTag} 
        class="pix-select" 
        style="flex: 1; padding: 1px 3px; font-size: 8.5px; height: 18px; background: #000; border: 1px solid var(--pix-border); color: #fff;"
      >
        {#each colAllTags as tag}
          <option value={tag}>{tag === 'All' ? m.labelCategoryFilter() : tag}</option>
        {/each}
      </select>
    </div>

    <div style="max-height: 150px; overflow-y: auto; border: 1px solid var(--pix-border); border-radius: 4px; background: #080a10;">
      <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 9px;">
        <thead>
          <tr style="background: var(--pix-bg-3); border-bottom: 1px solid var(--pix-border); color: var(--pix-cyan);">
            <th style="padding: 4px; width: 20px;"></th>
            <th style="padding: 4px; width: 140px;">{m.batchColFileTags()}</th>
            <th style="padding: 4px; width: 55px;">{m.size()}</th>
            <th style="padding: 4px; width: 45px;">{m.batchFormat()}</th>
            <th style="padding: 4px; width: 85px;">{m.batchColCopyNumber()}</th>
            <th style="padding: 4px; width: 85px;">{m.batchColResistance()}</th>
            <th style="padding: 4px; width: 20px;"></th>
          </tr>
        </thead>
        <tbody>
          {#each filteredCollections as item}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <tr 
              style="border-bottom: 1px solid rgba(255,255,255,0.03); cursor: pointer; background: {selectedCollectionFiles.includes(item.name) ? 'rgba(76,214,255,0.08)' : 'transparent'};"
              onclick={() => toggleSelectFile(item.name)}
              ondblclick={() => {
                dnaSeq = item.seq;
                plasmidName = item.name.split('.')[0];
                pushLog(m.batchDblClickLoadLog({ v1: item.name, v2: item.size }));
                pushToast('success', m.loadSuccess(), item.name);
              }}
            >
              <td style="padding: 4px; text-align: center;">
                <input type="checkbox" checked={selectedCollectionFiles.includes(item.name)} style="cursor: pointer;" onclick={(e) => { e.stopPropagation(); toggleSelectFile(item.name); }} />
              </td>
              <td style="padding: 4px;">
                <div style="font-weight: 600; color: var(--pix-fg);">{item.name}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 2px; margin-top: 1px;">
                  {#each item.tags as t}
                    <span style="background: rgba(255,255,255,0.05); color: var(--pix-fg-dim); font-size: 7px; padding: 0px 3px; border-radius: 2px;">{t}</span>
                  {/each}
                </div>
              </td>
              <td style="padding: 4px;" class="pix-num">{item.size} bp</td>
              <td style="padding: 4px; color: var(--pix-cyan);">{item.format}</td>
              <td style="padding: 4px; color: var(--pix-accent);">{item.copyNumber || 'N/A'}</td>
              <td style="padding: 4px; color: var(--pix-purple); font-weight: bold;">{item.resistance || 'None'}</td>
              <td style="padding: 4px; text-align: center;">
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <span style="color: var(--pix-red); cursor: pointer;" onclick={(e) => { e.stopPropagation(); deleteCollectionFile(item.id); }}>
                  <Trash2 size={10} />
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div style="display: flex; gap: 6px; margin-top: 4px;">
      <button class="pix-btn ok" onclick={handleBatchDpnI} style="flex: 1; padding: 4px; font-size: 9.5px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;">
        <FlaskIcon size={10} /> {m.batchDpnIBtn()}
      </button>
      <button class="pix-btn ok" onclick={handleBatchPrimerDesign} style="flex: 1; padding: 4px; font-size: 9.5px; display: inline-flex; align-items: center; justify-content: center; gap: 3px;">
        <CaseSensitive size={10} /> {m.batchPrimerBtn()}
      </button>
    </div>

    <!-- Batch results visualization block -->
    {#if batchResultsType !== 'none'}
      <div class="pix-panel" style="margin-top: 8px; padding: 6px; border: 1px solid var(--pix-border); background: #04060a; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 4px; margin-bottom: 6px;">
          <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 9.5px;">
            {batchResultsType === 'dpni' ? m.batchDpnIReportTitle() : m.batchPrimerReportTitle()}
          </span>
          <div style="display: flex; gap: 4px;">
            <button class="pix-btn-reset" onclick={() => {
              let text = '';
              if (batchResultsType === 'dpni') {
                text = [m.batchColPlasmidName(), m.batchColCutsiteCount(), m.batchColCutPositions()].join('\t') + '\n' + batchDpnIResults.map(r => `${r.name}\t${r.count}\t${r.positions}`).join('\n');
              } else {
                text = [m.batchTemplateName(), m.batchFwdPrimerLabel(), 'Fwd Tm', m.batchRevPrimerLabel(), 'Rev Tm'].join('\t') + '\n' + batchPrimerResults.map(r => `${r.name}\t${r.fwdSeq}\t${r.fwdTm.toFixed(1)}°C\t${r.revSeq}\t${r.revTm.toFixed(1)}°C`).join('\n');
              }
              navigator.clipboard.writeText(text);
              pushToast('success', m.copySuccess(), m.batchReportCopiedDesc());
            }} style="font-size: 8.5px; color: var(--pix-cyan); cursor: pointer;" title={m.batchCopyTableTitle()}>{m.labelCopy()}</button>
            <button class="pix-btn-reset" onclick={() => batchResultsType = 'none'} style="font-size: 8.5px; color: var(--pix-red); cursor: pointer;">{m.clearBtn()}</button>
          </div>
        </div>

        <div style="max-height: 120px; overflow-y: auto; font-size: 8.5px;">
          {#if batchResultsType === 'dpni'}
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
              <thead>
                <tr style="color: var(--pix-fg-dim); border-bottom: 1px dashed var(--pix-border);">
                  <th style="padding: 2px;">{m.batchColPlasmidName()}</th>
                  <th style="padding: 2px; width: 50px; text-align: center;">{m.batchColCutsiteCount()}</th>
                  <th style="padding: 2px;">{m.batchColCutPositions()}</th>
                </tr>
              </thead>
              <tbody>
                {#each batchDpnIResults as res}
                  <tr style="border-bottom: 1px dashed rgba(255,255,255,0.05);">
                    <td style="padding: 2px; font-weight: bold; color: var(--pix-fg);">{res.name}</td>
                    <td style="padding: 2px; text-align: center; font-weight: bold; color: {res.count > 0 ? 'var(--pix-green)' : 'var(--pix-red)'};">{res.count}</td>
                    <td style="padding: 2px; color: var(--pix-cyan); font-family: monospace;">{res.positions}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else if batchResultsType === 'primer'}
            <table style="width: 100%; border-collapse: collapse; text-align: left;">
              <thead>
                <tr style="color: var(--pix-fg-dim); border-bottom: 1px dashed var(--pix-border);">
                  <th style="padding: 2px;">{m.batchTemplateName()}</th>
                  <th style="padding: 2px;">{m.batchFwdPrimerLabel()}</th>
                  <th style="padding: 2px;">{m.batchRevPrimerLabel()}</th>
                </tr>
              </thead>
              <tbody>
                {#each batchPrimerResults as res}
                  <tr style="border-bottom: 1px dashed rgba(255,255,255,0.05);">
                    <td style="padding: 2px; font-weight: bold; color: var(--pix-fg); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{res.name}</td>
                    <td style="padding: 2px; font-family: monospace; color: var(--pix-green);">
                      <div>{res.fwdSeq}</div>
                      <div style="font-size: 7.5px; opacity: 0.7;">Tm: {res.fwdTm.toFixed(1)}°C</div>
                    </td>
                    <td style="padding: 2px; font-family: monospace; color: var(--pix-blue);">
                      <div>{res.revSeq}</div>
                      <div style="font-size: 7.5px; opacity: 0.7;">Tm: {res.revTm.toFixed(1)}°C</div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
        <div style="font-size: 7.5px; color: var(--pix-fg-dim); margin-top: 4px; text-align: right; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 2px;">
          {m.batchReportExcelHint()}
        </div>
      </div>
    {/if}
  </div>
</div>
