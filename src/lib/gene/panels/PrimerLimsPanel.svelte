<script lang="ts">
  import * as m from '$lib/paraglide/messages.js'; 

  import { Folder } from 'lucide-svelte';
  import { 
    generate2DGrid, 
    calculatePrimerTm, 
    matchQueryToStockPrimers, 
    exportPrimerOrderFormat 
  } from '$lib/genome';

  let {
    showPrimersLimsPanel = $bindable(false),
    drag,
    primerInventory = $bindable([]),
    dnaSeq,
    pushLog,
    pushToast
  } = $props<{
    showPrimersLimsPanel: boolean;
    drag: any;
    primerInventory: any[];
    dnaSeq: string;
    pushLog: (msg: string) => void;
    pushToast: (type: any, title: string, text?: string) => void;
  }>();

  let orderCompany = $state<'Sangon' | 'Tsingke' | 'IDT'>('Sangon');
  let freezerGridType = $state<'96-well' | '10x10-freezer'>('96-well');
  let newPrimerName = $state('');
  let newPrimerSeq = $state('');
  let newPrimerLocation = $state('Box A - A3');
  let primerSearchQuery = $state('');

  // Derived filtered stock primers based on search query (Feature 6)
  let searchedStockPrimers = $derived.by(() => {
    const q = primerSearchQuery.trim().toLowerCase();
    if (!q) return primerInventory;
    return primerInventory.filter((p: any) => 
      p.name.toLowerCase().includes(q) || 
      p.sequence.toLowerCase().includes(q) || 
      p.location.toLowerCase().includes(q)
    );
  });

  const gridData = $derived(generate2DGrid(primerInventory.map((p: any) => ({ sampleId: p.id, name: p.name, type: 'primer', position: p.location })), freezerGridType));
</script>

<div use:drag={'.panel-header'} class="floating-panel pix-panel" style="position: absolute; left: 440px; top: 120px; width: 440px; z-index: 55;">
  <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid var(--pix-border); padding-bottom: 4px; margin-bottom: 6px;">
    <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;"><Folder size={12} /> {m.primerLIMSLite()}</span>
    <button class="pix-btn-reset" onclick={() => showPrimersLimsPanel = false} style="font-size: 11px; color: var(--pix-red); cursor: pointer;">[X]</button>
  </div>

  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
    <!-- Left: Add New Primer (Feature 6) -->
    <div style="display: flex; flex-direction: column; gap: 5px; border-right: 1px dashed var(--pix-border); padding-right: 8px;">
      <div style="font-weight: bold; color: var(--pix-accent-2); font-size: 9px; margin-bottom: 2px;">{m.stepRegisterPrimer()}</div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span class="pix-dim">{m.limsPrimerNameLabel()}</span>
        <input class="pix-input" type="text" bind:value={newPrimerName} placeholder="Primer_F..." style="padding: 2px 4px; font-size: 9.5px; height: 18px;" />
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span class="pix-dim">{m.limsPrimerSeqLabel()}</span>
        <textarea class="pix-input mono" bind:value={newPrimerSeq} placeholder="ATCG..." rows={3} style="padding: 2px 4px; font-size: 9px; line-height: 1.2; resize: vertical; text-transform: uppercase;"></textarea>
      </div>

      <div style="display: flex; flex-direction: column; gap: 4px;">
        <span class="pix-dim">{m.limsLocationLabel()}</span>
        <input class="pix-input" type="text" bind:value={newPrimerLocation} style="padding: 2px 4px; font-size: 9.5px; height: 18px;" />
      </div>

      <button 
        class="pix-btn ok" 
        onclick={() => {
          if (!newPrimerName.trim() || !newPrimerSeq.trim()) {
            pushToast('error', m.limsRegisterFailTitle(), m.limsRegisterEmptyDesc());
            return;
          }
          const cleanSeq = newPrimerSeq.toUpperCase().replace(/[^ATCGN]/g, '');
          const tmVal = calculatePrimerTm(cleanSeq);
          const p = {
            id: `p_${Date.now()}`,
            name: newPrimerName.trim(),
            sequence: cleanSeq,
            tm: tmVal,
            concentration: 100,
            volume: 50,
            location: newPrimerLocation.trim()
          };
          primerInventory = [...primerInventory, p];
          newPrimerName = "";
          newPrimerSeq = "";
          pushToast('success', m.limsRegisterSuccessTitle(), p.name);
          pushLog(m.limsLogPrimerRegistered({ v1: p.name, v2: p.tm, v3: p.sequence, v4: p.location }));
        }}
        style="padding: 4px; font-weight: bold; width: 100%; margin-top: 4px;"
      >
        {m.limsRegisterBtn()}
      </button>
    </div>

    <!-- Right: Search & Align -->
    <div style="display: flex; flex-direction: column; gap: 5px;">
      <div style="font-weight: bold; color: var(--pix-accent-2); font-size: 9px; margin-bottom: 2px;">{m.limsSearchAlignTitle()}</div>

      <div style="display: flex; gap: 3px;">
        <input class="pix-input" type="text" bind:value={primerSearchQuery} placeholder={m.limsSearchPlaceholder()} style="flex: 1; padding: 2px 4px; font-size: 9.5px; height: 18px;" />
        <button 
          class="pix-btn ok" 
          onclick={() => {
            // Auto matching using k-mer seed matching
            const matches = matchQueryToStockPrimers(dnaSeq, primerInventory, 15);
            if (matches.length > 0) {
              pushToast('success', m.limsAutoAlignSuccessTitle(), m.limsAutoAlignFoundDesc({ v1: matches.length }));
              pushLog(m.limsLogAutoAlign({ v1: matches.length }));
            } else {
              pushToast('info', m.limsAutoAlignTitle(), m.limsAutoAlignNoneDesc());
            }
          }}
          title={m.limsAlignTooltip()}
          style="padding: 1px 4px; font-size: 8px; font-weight: bold;">{m.limsAlignBtn()}</button>
      </div>

      <div style="flex: 1; overflow-y: auto; max-height: 200px; border: 1px solid var(--pix-border); border-radius: 3px; background: #000;">
        <table style="width: 100%; border-collapse: collapse; font-size: 8px; text-align: left;">
          <thead>
            <tr style="background: var(--pix-bg-3); border-bottom: 1px solid var(--pix-border); color: var(--pix-cyan);">
              <th style="padding: 3px; width: 85px;">{m.limsThName()}</th>
              <th style="padding: 3px; width: 45px;">Tm</th>
              <th style="padding: 3px; width: 85px;">{m.limsThLocation()}</th>
              <th style="padding: 3px; width: 15px;"></th>
            </tr>
          </thead>
          <tbody>
            {#each searchedStockPrimers as item}
              {@const isMatched = dnaSeq.toUpperCase().includes(item.sequence.toUpperCase())}
              <tr style="border-bottom: 1px solid rgba(255,255,255,0.03); background: {isMatched ? 'rgba(0,255,100,0.05)' : 'transparent'};">
                <td style="padding: 3px;" title={m.limsSeqTooltip({ v1: item.sequence })}>
                  <div style="font-weight: bold; color: {isMatched ? 'var(--pix-green)' : 'var(--pix-fg)'};">{item.name}</div>
                  <div class="mono" style="font-size: 7px; color: var(--pix-fg-dim);">{item.sequence.slice(0, 15)}...</div>
                </td>
                <td style="padding: 3px;" class="pix-num">{item.tm}°C</td>
                <td style="padding: 3px; color: var(--pix-cyan);">{item.location}</td>
                <td style="padding: 3px; text-align: center;">
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span 
                    onclick={() => {
                      primerInventory = primerInventory.filter((p: any) => p.id !== item.id);
                      pushToast('info', m.limsRemovedTitle(), item.name);
                    }}
                    style="color: var(--pix-red); cursor: pointer; font-size: 9px;"
                  >[X]</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <div style="font-size: 7px; color: var(--pix-fg-dim); line-height: 1.15; padding: 2px;">{m.limsNoteHead()}<b>{m.limsNoteBold()}</b>{m.limsNoteTail()}</div>

      <!-- Feature 24: Primer Order Sheet Exporter -->
      <div style="border-top: 1px dashed rgba(255,255,255,0.1); margin-top: 4px; padding-top: 4px;">
        <div style="font-weight: bold; color: var(--pix-cyan); font-size: 9px; margin-bottom: 2px;">{m.limsOrderExportTitle()}</div>
        <div style="display: flex; gap: 3px; align-items: center;">
          <select class="pix-select" bind:value={orderCompany} style="width: 75px; height: 18px; padding: 1px; font-size: 8.5px;">
            <option value="Sangon">{m.limsCompanySangon()}</option>
            <option value="Tsingke">{m.limsCompanyTsingke()}</option>
            <option value="IDT">IDT (USA)</option>
          </select>
          <button class="pix-btn ok" onclick={() => {
            const sheet = exportPrimerOrderFormat(primerInventory.map((p: any) => ({
              name: p.name,
              sequence: p.sequence,
              scale: "50 nmol",
              purification: "DSL"
            })), orderCompany);
            
            // Trigger download of the CSV sheet
            const blob = new Blob([sheet], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.setAttribute("download", `${orderCompany}_Primer_Order_${Date.now()}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            pushToast('success', m.limsOrderSuccessTitle(), m.limsOrderSuccessDesc({ v1: orderCompany }));
            pushLog(m.limsLogOrderExport({ v1: primerInventory.length, v2: orderCompany }));
          }} style="padding: 1px 6px; font-size: 8.5px; font-weight: bold; flex: 1;">{m.limsGenerateOrderBtn()}</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Feature 26: 2D Inventory Grid Map -->
  <div style="border-top: 1.5px solid var(--pix-border); margin: 6px 10px; padding-top: 6px; font-size: 9px; font-family: var(--pix-font);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
      <span style="font-weight: bold; color: var(--pix-cyan);">{m.limsGridMapTitle()}</span>
      <select class="pix-select" bind:value={freezerGridType} style="width: 100px; height: 16px; padding: 1px; font-size: 8px;">
        <option value="96-well">{m.limsGrid96Well()}</option>
        <option value="10x10-freezer">{m.limsGrid10x10()}</option>
      </select>
    </div>

    <div style="max-height: 100px; overflow-y: auto; background: rgba(0,0,0,0.3); border: 1px solid var(--pix-border); border-radius: 3px; padding: 4px; display: flex; flex-direction: column; gap: 2px;">
      {#if gridData.overlapClashes.length > 0}
        <div style="color: var(--pix-red); font-size: 7.5px; font-weight: bold; margin-bottom: 2px;">{gridData.overlapClashes[0]}</div>
      {/if}

      <!-- Draw the matrix -->
      <div style="display: flex; flex-direction: column; gap: 1px; align-items: center;">
        <!-- Column labels -->
        <div style="display: flex; gap: 1px;">
          <div style="width: 15px; height: 10px;"></div>
          {#each gridData.columns as col}
            <div style="width: 11px; height: 10px; text-align: center; font-size: 6px; color: var(--pix-fg-dim);">{col.replace('C', '')}</div>
          {/each}
        </div>

        <!-- Row labels and cells -->
        {#each gridData.grid as rowCells}
          <div style="display: flex; gap: 1px;">
            <div style="width: 15px; height: 11px; font-size: 6.5px; color: var(--pix-fg-dim); display: flex; align-items: center; justify-content: center; font-weight: bold;">{rowCells[0].rowLabel.replace('R', '')}</div>
            {#each rowCells as cell}
              {@const filled = cell.sample}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div 
                onclick={() => {
                  if (filled) {
                    pushToast('info', m.limsStorageDetailTitle({ v1: cell.coordinate }), m.limsFilledName({ name: filled.name }));
                  } else {
                    newPrimerLocation = cell.coordinate;
                    pushToast('info', m.limsLocateTitle(), m.limsLocateDesc({ v1: cell.coordinate }));
                  }
                }}
                style="width: 11px; height: 11px; background: {filled ? 'var(--pix-green)' : 'rgba(255,255,255,0.04)'}; border: 1px solid {filled ? '#fff' : 'rgba(255,255,255,0.08)'}; border-radius: 50%; cursor: pointer;"
                title="{cell.coordinate}: {filled ? filled.name : m.limsCellFree()}"
              ></div>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
