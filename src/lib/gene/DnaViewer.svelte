<script lang="ts">
  import { onMount } from 'svelte';
  import { currentLocale } from '$lib/i18n.svelte.ts';
  function t(zh: string, en: string): string {
    return currentLocale.value === 'zh' ? zh : en;
  }
  import * as m from '$lib/paraglide/messages.js';

  import { backend } from '$lib/backend/api';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { Dna } from 'lucide-svelte';
  import { calculatePercentGC, getReverseComplementSequenceString, calculateNebTm } from '$lib/genome';

  import SequenceRow from './SequenceRow.svelte';
  import SequenceMinimap from './SequenceMinimap.svelte';
  import SequenceToolbar from './SequenceToolbar.svelte';
  import SelectionToolkit from './SelectionToolkit.svelte';
  import HybridizationDialog from './HybridizationDialog.svelte';
  import CodonFetcher from './CodonFetcher.svelte';
  import VirtualKeyboard from './VirtualKeyboard.svelte';
  import { getCutsiteLabelHeight, getAnnotationLabelHeight, getAnnotationStackHeight, drawSequenceRowOnCanvas, calculateRowYOffsets } from './utils/rowRender';

  let {
    dnaSeq = $bindable(''),
    plasmidName = $bindable(''),
    codonHost = $bindable('ecoli'),
    quickDbId = $bindable(''),
    translatedProtein = '',
    restrictionSites = [] as { name: string; pos: number; seq: string; color: string; methylated?: boolean; methylationType?: string }[],
    geneFeatures = $bindable([] as { id: number; name: string; start: number; end: number; type: string; color: string; forward?: boolean }[]),
    parts = [] as { name: string; start: number; end: number }[],
    primers = [] as { name: string; start: number; end: number; forward?: boolean }[],
    selectionStart = $bindable(1),
    selectionEnd = $bindable(1),
    showSingleStrand = false,
    colorTheme = 'monochrome',
    modifiedRanges = [] as { start: number; end: number }[],
    seqTool = $bindable('browse'),
    showEnzymes = $bindable(true),
    showFeatures = $bindable(true),
    showTranslations = $bindable(true),
    onAddSelectionNote = () => {},
    onSaveProject = () => {},
    onAddFeature = (start: number, end: number) => {}
  } = $props<{
    dnaSeq: string;
    plasmidName: string;
    codonHost: 'ecoli' | 'yeast' | 'human';
    quickDbId: string;
    translatedProtein: string;
    restrictionSites: { name: string; pos: number; seq: string; color: string; methylated?: boolean; methylationType?: string }[];
    geneFeatures: { id: number; name: string; start: number; end: number; type: string; color: string; forward?: boolean }[];
    parts: { name: string; start: number; end: number }[];
    primers: { name: string; start: number; end: number; forward?: boolean }[];
    selectionStart: number;
    selectionEnd: number;
    showSingleStrand?: boolean;
    colorTheme?: string;
    modifiedRanges?: { start: number; end: number }[];
    seqTool?: 'browse' | 'edit' | 'annotate';
    showEnzymes?: boolean;
    showFeatures?: boolean;
    showTranslations?: boolean;
    onAddSelectionNote?: () => void;
    onSaveProject?: () => void;
    onAddFeature?: (start: number, end: number) => void;
  }>();

  let isFetching = $state(false);
  let isFetchingCodons = $state(false);
  let customTaxId = $state('36329');
  let log: string[] = $state([]);

  // System mobile/pad and force virtual keyboard detection
  let isMobileOrPad = $state(false);
  let forceVirtualKeyboard = $state(false);
  const isVirtualKeyboardVisible = $derived(
    seqTool === 'edit' && (isMobileOrPad || forceVirtualKeyboard)
  );

  // ---------------- Layout Constants ----------------
  const CHAR_W = 9;
  const BLOCK_GAP = 0;
  const BLOCK_SIZE = 10;
  const LEFT_MARGIN = 58;
  const RIGHT_MARGIN = 24;

 let containerEl = $state<HTMLDivElement | null>(null);
 let containerWidth = $state(700);
 let scrollTop = $state(0);
  let viewportH = $state(400);

 const basesPerRow = $derived.by(() => {
   const blockStep = CHAR_W * BLOCK_SIZE + BLOCK_GAP;
   const maxBlocks = Math.floor((containerWidth - LEFT_MARGIN - RIGHT_MARGIN) / blockStep);
    // Round to nearest multiple of 3 so translation reading frames stay aligned across rows
    const raw = Math.max(20, maxBlocks * BLOCK_SIZE);
    return Math.floor(raw / 3) * 3;
 });

  const dna = $derived(dnaSeq.toUpperCase().replace(/[^ATCGN]/g, ''));
  const dnaGcContent = $derived(calculatePercentGC(dna));

  const selectedGcContent = $derived.by(() => {
    if (selectionStart === 1 && selectionEnd === 1) return 0;
    const seg = dnaSeq.slice(selectionStart - 1, selectionEnd);
    if (!seg) return 0;
    return calculatePercentGC(seg);
  });

  const selectedTm = $derived.by(() => {
    if (selectionStart === 1 && selectionEnd === 1) return null;
    const seg = dnaSeq.slice(selectionStart - 1, selectionEnd);
    if (seg.length < 4 || seg.length > 50) return null;
    try {
      const tm = calculateNebTm(seg, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
      return typeof tm === 'number' && !isNaN(tm) ? Math.round(tm) : null;
    } catch { return null; }
  });

  const rows = $derived.by(() => {
    const list = [];
    const bpr = basesPerRow;
    for (let i = 0; i < dna.length; i += bpr) {
      const rowSeq = dna.slice(i, i + bpr);
      const rowStart = i + 1;
      const rowEnd = Math.min(i + bpr, dna.length);

      const blocks = [];
      for (let j = 0; j < rowSeq.length; j += BLOCK_SIZE) {
        const blockSeq = rowSeq.slice(j, j + BLOCK_SIZE);
        blocks.push({
          blockIdx: j / BLOCK_SIZE,
          bases: blockSeq.split(''),
          startPos: rowStart + j
        });
      }

      list.push({
        rowIdx: i / bpr,
        start: rowStart,
        end: rowEnd,
        blocks
      });
    }
    return list;
  });

  // Pre-calculate heights and absolute top positions for all rows (pure mathematical calculations)
  const rowLayouts = $derived.by(() => {
    let currentTop = 0;
    const layouts = [];

    // Bucketize restriction sites and features by row for O(N + R) speedup (Feature 8)
    const bpr = basesPerRow;
    const rowSitesMap = new Map<number, any[]>();
    const rowFeatsMap = new Map<number, any[]>();
    const rowPartsMap = new Map<number, any[]>();

    if (showEnzymes) {
      restrictionSites.forEach((s: any) => {
        const rIdx = Math.floor((s.pos - 1) / bpr);
        if (!rowSitesMap.has(rIdx)) rowSitesMap.set(rIdx, []);
        rowSitesMap.get(rIdx)!.push(s);
      });
    }

    if (showFeatures) {
      geneFeatures.forEach((f: any) => {
        const startRow = Math.floor((f.start - 1) / bpr);
        const endRow = Math.floor((f.end - 1) / bpr);
        for (let r = startRow; r <= endRow; r++) {
          if (!rowFeatsMap.has(r)) rowFeatsMap.set(r, []);
          rowFeatsMap.get(r)!.push(f);
        }
      });
    }

    parts.forEach((p: any) => {
      const startRow = Math.floor((p.start - 1) / bpr);
      const endRow = Math.floor((p.end - 1) / bpr);
      for (let r = startRow; r <= endRow; r++) {
        if (!rowPartsMap.has(r)) rowPartsMap.set(r, []);
        rowPartsMap.get(r)!.push(p);
      }
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let h = 8; // Top spacer
      h += 22 + 4; // Ruler height + gap

      // Enzyme labels (O(1) Map lookup!)
      const rowSites = rowSitesMap.get(row.rowIdx) || [];
      if (showEnzymes && rowSites.length) {
        h += getCutsiteLabelHeight(rowSites, row) + 2;
      }

      // Selection info bar
      if (selectionStart !== 1 || selectionEnd !== 1) {
        const selStart = Math.max(selectionStart, row.start);
        const selEnd = Math.min(selectionEnd, row.end);
        if (selStart <= selEnd) h += 18;
      }

      // Sequence container
      h += showSingleStrand ? 24 : 52;

      // Translations
      if (showTranslations) {
        h += 18;
      }

      // Features (O(1) Map lookup!)
      const rowFeats = rowFeatsMap.get(row.rowIdx) || [];
      if (showFeatures && rowFeats.length) {
        h += getAnnotationLabelHeight(rowFeats, row);
        h += getAnnotationStackHeight(rowFeats) + 5;
      }

      // Parts (O(1) Map lookup!)
      const rowParts = rowPartsMap.get(row.rowIdx) || [];
      if (rowParts.length) {
        h += getAnnotationLabelHeight(rowParts, row);
        h += getAnnotationStackHeight(rowParts) + 5;
      }

      const totalH = h + 16; // bottom padding + margin
      layouts.push({
        row,
        height: totalH,
        top: currentTop
      });
      currentTop += totalH;
    }

    return {
      layouts,
      totalHeight: currentTop
    };
  });

  const visibleRowLayouts = $derived.by(() => {
    const buffer = 400; // px buffer
    const startY = Math.max(0, scrollTop - buffer);
    const endY = scrollTop + viewportH + buffer;

    return rowLayouts.layouts.filter((l) => {
      const bottom = l.top + l.height;
      return l.top <= endY && bottom >= startY;
    });
  });

  let totalContentH = $state(1000);

 onMount(() => {
   // Mobile/iPad detection and force virtual keyboard load
   isMobileOrPad = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
   forceVirtualKeyboard = localStorage.getItem('spice_force_virtual_keyboard') === 'true';

   // Load persisted custom codon state
   const savedTaxId = localStorage.getItem('spice_custom_tax_id');
   if (savedTaxId) customTaxId = savedTaxId;
   const savedCodonTable = localStorage.getItem('spice_reverse_codon_table');
   if (savedCodonTable) {
     try {
       reverseCodonTable = JSON.parse(savedCodonTable);
     } catch (e) {
       console.error("Error loading persisted reverseCodonTable:", e);
     }
   }

   if (containerEl) {
     const observer = new ResizeObserver(entries => {
       for (const entry of entries) {
         containerWidth = entry.contentRect.width;
          viewportH = entry.contentRect.height;
       }
     });
     observer.observe(containerEl);
     return () => observer.disconnect();
   }
 });

  // Smoothly scroll the container to the selection when selectionStart changes (Gap 17 Scroll Alignment)
  $effect(() => {
    if (selectionStart > 1 && containerEl && rows.length > 0) {
      const targetRow = rows.find(r => selectionStart >= r.start && selectionStart <= r.end);
      if (targetRow) {
        const layout = rowLayouts.layouts.find(l => l.row.rowIdx === targetRow.rowIdx);
        if (layout) {
          containerEl.scrollTo({
            top: Math.max(0, layout.top - 20),
            behavior: 'smooth'
          });
        }
      }
    }
  });

  function pushLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    log = [...log.slice(-100), `[${ts}] ${msg}`];
  }

  // ---------------- Toolbar State ----------------
  let showHybridizationModal = $state(false);

  // ---------------- Hover Feature Details ----------------
  let hoveredFeature = $state<any>(null);
  let mouseX = $state(0);
  let mouseY = $state(0);

  function handleMouseMoveContainer(e: MouseEvent) {
    if (hoveredFeature && containerEl) {
      const rect = containerEl.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    }
  }

  // ---------------- Clicked Feature Tooltip (SnapGene-style) ----------------
  let clickedFeature = $state<any>(null);
  let tooltipLeft = $state(0);
  let tooltipTop = $state(0);

  // Draggable Clicked Feature Tooltip State
  let isDraggingTooltip = $state(false);
  let tooltipDragStart = { x: 0, y: 0 };
  let tooltipPositionStart = { left: 0, top: 0 };

  function handleTooltipMouseDown(e: MouseEvent) {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button') || target.closest('input')) {
      return;
    }
    isDraggingTooltip = true;
    tooltipDragStart = { x: e.clientX, y: e.clientY };
    tooltipPositionStart = { left: tooltipLeft, top: tooltipTop };

    window.addEventListener('mousemove', handleTooltipMouseMove);
    window.addEventListener('mouseup', handleTooltipMouseUp);
  }

  function handleTooltipMouseMove(e: MouseEvent) {
    if (!isDraggingTooltip) return;
    const dx = e.clientX - tooltipDragStart.x;
    const dy = e.clientY - tooltipDragStart.y;
    tooltipLeft = tooltipPositionStart.left + dx;
    tooltipTop = tooltipPositionStart.top + dy;
  }

  function handleTooltipMouseUp() {
    isDraggingTooltip = false;
    window.removeEventListener('mousemove', handleTooltipMouseMove);
    window.removeEventListener('mouseup', handleTooltipMouseUp);
  }

  // Draggable Selection Tooltip State
  let selectionTooltipEl = $state<HTMLDivElement | null>(null);
  let selectionTooltipLeft = $state<number | null>(null);
  let selectionTooltipTop = $state<number | null>(null);
  let isDraggingSelectionTooltip = $state(false);
  let selectionTooltipDragStart = { x: 0, y: 0 };
  let selectionTooltipPositionStart = { left: 0, top: 0 };

  function handleSelectionTooltipMouseDown(e: MouseEvent) {
    if (e.button !== 0) return; // Only left click
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'INPUT' || target.closest('button') || target.closest('input')) {
      return;
    }
    if (!selectionTooltipEl) return;

    // Get current position relative to its offsetParent
    const rect = selectionTooltipEl.getBoundingClientRect();
    const parent = selectionTooltipEl.parentElement;
    const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };

    const initialLeft = rect.left - parentRect.left;
    const initialTop = rect.top - parentRect.top;

    if (selectionTooltipLeft === null || selectionTooltipTop === null) {
      selectionTooltipLeft = initialLeft;
      selectionTooltipTop = initialTop;
    }

    isDraggingSelectionTooltip = true;
    selectionTooltipDragStart = { x: e.clientX, y: e.clientY };
    selectionTooltipPositionStart = { left: selectionTooltipLeft, top: selectionTooltipTop };

    window.addEventListener('mousemove', handleSelectionTooltipMouseMove);
    window.addEventListener('mouseup', handleSelectionTooltipMouseUp);
  }

  function handleSelectionTooltipMouseMove(e: MouseEvent) {
    if (!isDraggingSelectionTooltip) return;
    const dx = e.clientX - selectionTooltipDragStart.x;
    const dy = e.clientY - selectionTooltipDragStart.y;
    selectionTooltipLeft = selectionTooltipPositionStart.left + dx;
    selectionTooltipTop = selectionTooltipPositionStart.top + dy;
  }

  function handleSelectionTooltipMouseUp() {
    isDraggingSelectionTooltip = false;
    window.removeEventListener('mousemove', handleSelectionTooltipMouseMove);
    window.removeEventListener('mouseup', handleSelectionTooltipMouseUp);
  }

  // Auto-reset selection tooltip position when selection changes
  $effect(() => {
    void selectionStart;
    void selectionEnd;
    selectionTooltipLeft = null;
    selectionTooltipTop = null;
  });

  // Dynamic calculations for selection tooltip positioning and metrics
  const selectionTooltip = $derived.by(() => {
    if (selectionStart === 1 && selectionEnd === 1) return null;
    const len = selectionEnd - selectionStart + 1;
    if (len <= 0) return null;

    const seg = dnaSeq.slice(selectionStart - 1, selectionEnd);
    const gc = calculatePercentGC(seg);
    let tm = null;
    if (seg.length >= 4 && seg.length <= 50) {
      try {
        const res = calculateNebTm(seg, { monovalentCationConc: 0.05, primerConc: 0.0000005 });
        tm = typeof res === 'number' ? Math.round(res) : null;
      } catch {}
    }

    return {
      start: selectionStart,
      end: selectionEnd,
      length: len,
      gc,
      tm
    };
  });

  function getFeatureTrackYForRow(row: any): number {
    let y = 8;
    y += 22 + 4; // Ruler

    const rowSites = restrictionSites.filter((s: any) => s.pos >= row.start && s.pos <= row.end);
    if (showEnzymes && rowSites.length) {
      y += getCutsiteLabelHeight(rowSites, row) + 2;
    }

    if (selectionStart !== 1 || selectionEnd !== 1) {
      const selStart = Math.max(selectionStart, row.start);
      const selEnd = Math.min(selectionEnd, row.end);
      if (selStart <= selEnd) y += 18;
    }

    y += showSingleStrand ? 24 : 52; // Sequence container

    if (showTranslations) {
      y += 18;
    }
    return y;
  }

  function getFeatureStats(feat: any) {
    const fStart = feat.start;
    const fEnd = feat.end;
    const fLen = fEnd - fStart + 1;
    const seg = dnaSeq.slice(Math.max(0, fStart), Math.min(dnaSeq.length, fEnd + 1));
    const gc = calculatePercentGC(seg);
    const isCds = ['cds', 'gene', 'exon'].includes(feat.type?.toLowerCase());
    const mwKda = isCds ? ((fLen / 3) * 110 / 1000).toFixed(1) : null;
    return { length: fLen, gc, mwKda, isCds };
  }

  const hoveredFeatureStats = $derived.by(() => {
    if (!hoveredFeature) return null;
    const fStart = hoveredFeature.start;
    const fEnd = hoveredFeature.end;
    const fLen = fEnd - fStart + 1;

    // Extract segment sequence to compute GC content on the fly
    const seg = dnaSeq.slice(Math.max(0, fStart), Math.min(dnaSeq.length, fEnd + 1));
    const gc = calculatePercentGC(seg);

    // Calculate molecular weight for protein translations (average AA weight ~110 Da)
    const isCds = ['cds', 'gene', 'exon'].includes(hoveredFeature.type?.toLowerCase());
    const mwKda = isCds ? ((fLen / 3) * 110 / 1000).toFixed(1) : null;

    return {
      length: fLen,
      gc,
      mwKda,
      isCds
    };
  });

  // ---------------- Codon Table State ----------------
  let reverseCodonTable = $state<Record<string, string>>({
    'M': 'ATG', 'W': 'TGG', 'F': 'TTC', 'L': 'CTG', 'I': 'ATC', 'V': 'GTG',
    'S': 'AGC', 'P': 'CCG', 'T': 'ACC', 'A': 'GCG', 'Y': 'TAC', 'H': 'CAC',
    'Q': 'CAG', 'N': 'AAC', 'K': 'AAG', 'D': 'GAC', 'E': 'GAA', 'C': 'TGC',
    'R': 'AGA', 'G': 'GGC', '*': 'TAA'
  });

  // Save custom codon state automatically on changes
  $effect(() => {
    if (typeof localStorage !== 'undefined' && customTaxId) {
      localStorage.setItem('spice_custom_tax_id', customTaxId);
    }
  });

  $effect(() => {
    if (typeof localStorage !== 'undefined' && reverseCodonTable) {
      localStorage.setItem('spice_reverse_codon_table', JSON.stringify(reverseCodonTable));
    }
  });

  let minBindingBases = $state(10);
  let requireTm = $state(40);

  function applyDnaToProtein() {
    if (!translatedProtein) {
      pushToast('error', 'No translation', 'Sequence too short');
      return;
    }
    localStorage.setItem('spice.gene.translatedProtein', translatedProtein);
    localStorage.setItem('spice.gene.dnaSeq', dnaSeq);
    pushToast('success', 'Loaded to protein verification', `${translatedProtein.length} aa`);
  }

  async function fetchFromNcbi() {
    if (!quickDbId.trim() || isFetching) return;
    const id = quickDbId.trim().toUpperCase();
    isFetching = true;
    pushLog(`Fetching NCBI sequence [${id}]...`);
    try {
      const resp = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${id}&rettype=gb&retmode=text`);
      const text = await resp.text();
      const lines = text.split('\n');
      let seq = '', inSeq = false, name = '';
      for (const line of lines) {
        if (line.startsWith('LOCUS')) { const parts = line.split(/\s+/); name = parts[1] || id; }
        if (line.startsWith('ORIGIN')) { inSeq = true; continue; }
        if (inSeq && line.startsWith('//')) break;
        if (inSeq) seq += line.replace(/[^a-zA-Z]/g, '').toUpperCase();
      }
      if (seq.length > 0) {
        dnaSeq = seq;
        if (name) plasmidName = name;
        pushLog(`[OK] Fetched NCBI [${id}]: ${seq.length} bp`);
        pushToast('success', `NCBI [${id}] fetched`, `${seq.length} bp`);
      }
    } catch (e: any) {
      pushToast('error', 'NCBI fetch failed', e.message ?? e);
    } finally { isFetching = false; }
  }

  async function fetchCloudCodonTable() {
    if (!customTaxId.trim() || isFetchingCodons) return;
    isFetchingCodons = true;
    pushLog(`Fetching Kazusa codon table for TaxID [${customTaxId}]...`);
    try {
      const res = await backend.fetchKazusaCodonTable(customTaxId.trim());
      reverseCodonTable = res.data;
      pushLog(`[OK] Codon table loaded from cloud`);
      pushToast('success', 'Codon table reloaded', `TaxID: ${customTaxId}`);
    } catch (e: any) {
      pushToast('error', 'Cloud codon fetch failed', e.message ?? e);
    } finally { isFetchingCodons = false; }
  }

  function doCodonOptimize() {
    const prot = translatedProtein.replace(/\*/g, '').replace(/\?/g, '');
    let optDna = '';
    for (const aa of prot) optDna += reverseCodonTable[aa] || 'NNN';
    optDna += 'TAA';
    dnaSeq = optDna;
    pushToast('success', 'Codon optimization complete', 'Optimized with current table');
  }

  // ---------------- Selection Operations ----------------
  function handleCopy() {
    if (selectionStart === 1 && selectionEnd === 1) return;
    const segment = dnaSeq.slice(selectionStart - 1, selectionEnd);
    const startPos = selectionStart;
    const endPos = selectionEnd;

    // Filter features overlapping with selection
    const overlappingFeatures = geneFeatures
      .filter((f: any) => {
        return !(f.end < startPos || f.start > endPos);
      })
      .map((f: any) => {
        const newStart = Math.max(1, f.start - startPos + 1);
        const newEnd = Math.min(segment.length, f.end - startPos + 1);
        return {
          ...f,
          start: newStart,
          end: newEnd
        };
      });

    const clipboardData = {
      source: "SPICE_GENE_EDITOR",
      sequence: segment,
      features: overlappingFeatures
    };

    try {
      const blobText = new Blob([segment], { type: "text/plain" });
      const blobJson = new Blob([JSON.stringify(clipboardData)], { type: "application/json" });
      
      // Prepare offscreen canvas to render selection as an image (PNG) on clipboard (Gap 14)
      const selectedLen = endPos - startPos + 1;
      const blocks: any[] = [];
      const subSeq = dnaSeq.slice(startPos - 1, endPos);
      for (let i = 0; i < selectedLen; i += 10) {
        const bases = [...subSeq.slice(i, i + 10)];
        blocks.push({
          blockIdx: Math.floor(i / 10),
          bases,
          startPos: startPos + i
        });
      }

      const mockRow = {
        rowIdx: 0,
        start: startPos,
        end: endPos,
        blocks
      };

      const dpr = window.devicePixelRatio || 1;
      const multStr = (typeof localStorage !== 'undefined' && localStorage.getItem('spice_gel_export_multiplier')) || '4';
      const multiplier = parseInt(multStr) || 4;
      const selectCanvasWidth = LEFT_MARGIN + selectedLen * CHAR_W + RIGHT_MARGIN;
      const rowHeight = 120; // safe bounding box for drawing

      const cv = document.createElement('canvas');
      cv.width = selectCanvasWidth * multiplier * dpr;
      cv.height = rowHeight * multiplier * dpr;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr * multiplier, 0, 0, dpr * multiplier, 0, 0);

      // Fill background (matches dark theme of sequence view)
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, selectCanvasWidth, rowHeight);

      // Draw row content onto canvas
      drawSequenceRowOnCanvas(ctx, {
        row: mockRow,
        dna: dnaSeq,
        showEnzymes,
        showFeatures,
        showTranslations,
        restrictionSites,
        geneFeatures,
        parts,
        primers,
        selectionStart,
        selectionEnd,
        containerWidth: selectCanvasWidth,
        hoveredFeatureId: null,
        dpr,
        showSingleStrand,
        colorTheme
      });

      cv.toBlob((blob) => {
        try {
          const clipboardItems: Record<string, Blob> = {
            "text/plain": blobText,
            "application/json": blobJson
          };
          if (blob) {
            clipboardItems["image/png"] = blob;
          }
          
          navigator.clipboard.write([
            new ClipboardItem(clipboardItems)
          ]).then(() => {
            pushToast('success', 'Copied sequence + features + image!', `${segment.length} bp with ${overlappingFeatures.length} features`);
          }).catch(() => {
            navigator.clipboard.writeText(segment);
            pushToast('success', 'Copied to clipboard (text fallback)', `${segment.length} bp`);
          });
        } catch (err) {
          navigator.clipboard.writeText(segment);
          pushToast('success', 'Copied to clipboard', `${segment.length} bp`);
        }
      }, "image/png");
    } catch (e) {
      navigator.clipboard.writeText(segment);
      pushToast('success', 'Copied to clipboard', `${segment.length} bp`);
    }
  }

  function handleCopyAsImage() {
    if (selectionStart === 1 && selectionEnd === 1) return;
    const startPos = selectionStart;
    const endPos = selectionEnd;

    try {
      const selectedLen = endPos - startPos + 1;
      const blocks: any[] = [];
      const subSeq = dnaSeq.slice(startPos - 1, endPos);
      for (let i = 0; i < selectedLen; i += 10) {
        const bases = [...subSeq.slice(i, i + 10)];
        blocks.push({
          blockIdx: Math.floor(i / 10),
          bases,
          startPos: startPos + i
        });
      }

      const mockRow = {
        rowIdx: 0,
        start: startPos,
        end: endPos,
        blocks
      };

      const dpr = window.devicePixelRatio || 1;
      const multStr = (typeof localStorage !== 'undefined' && localStorage.getItem('spice_gel_export_multiplier')) || '4';
      const multiplier = parseInt(multStr) || 4;
      const selectCanvasWidth = LEFT_MARGIN + selectedLen * CHAR_W + RIGHT_MARGIN;
      const rowHeight = 120;

      const cv = document.createElement('canvas');
      cv.width = selectCanvasWidth * multiplier * dpr;
      cv.height = rowHeight * multiplier * dpr;
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr * multiplier, 0, 0, dpr * multiplier, 0, 0);

      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, selectCanvasWidth, rowHeight);

      drawSequenceRowOnCanvas(ctx, {
        row: mockRow,
        dna: dnaSeq,
        showEnzymes,
        showFeatures,
        showTranslations,
        restrictionSites,
        geneFeatures,
        parts,
        primers,
        selectionStart,
        selectionEnd,
        containerWidth: selectCanvasWidth,
        hoveredFeatureId: null,
        dpr,
        showSingleStrand,
        colorTheme
      });

      cv.toBlob((blob) => {
        try {
          if (blob) {
            navigator.clipboard.write([
              new ClipboardItem({
                "image/png": blob
              })
            ]).then(() => {
              pushToast('success', 'Copied as image', m.dvCopiedImageToast());
            }).catch((err) => {
              pushToast('error', 'Copy Image failed', err.message);
            });
          }
        } catch (err: any) {
          pushToast('error', 'Copy Image failed', err.message);
        }
      }, "image/png");
    } catch (e: any) {
      pushToast('error', 'Generate Image failed', e.message);
    }
  }

  function insertSequenceWithFeatures(pastedSeq: string, pastedFeatures: any[]) {
    const startPos = selectionStart;
    const endPos = selectionEnd;
    const deletedLength = endPos - startPos + 1;
    const insertedLength = pastedSeq.length;
    const delta = insertedLength - (selectionStart === 1 && selectionEnd === 1 ? 0 : deletedLength);

    // 1. Calculate the new sequence
    let newSeq = "";
    if (selectionStart === 1 && selectionEnd === 1) {
      const insertAt = selectionStart - 1;
      newSeq = dnaSeq.slice(0, insertAt) + pastedSeq + dnaSeq.slice(insertAt);
    } else {
      newSeq = dnaSeq.slice(0, startPos - 1) + pastedSeq + dnaSeq.slice(endPos);
    }

    // 2. Adjust existing features
    let updatedFeatures = geneFeatures.map((f: any) => {
      if (selectionStart === 1 && selectionEnd === 1) {
        const insertAt = startPos;
        if (f.start >= insertAt) {
          return { ...f, start: f.start + insertedLength, end: f.end + insertedLength };
        } else if (f.end >= insertAt) {
          return { ...f, end: f.end + insertedLength };
        }
        return f;
      }

      if (f.end < startPos) {
        return f;
      }
      if (f.start > endPos) {
        return { ...f, start: f.start + delta, end: f.end + delta };
      }
      if (f.start >= startPos && f.end <= endPos) {
        return null;
      }
      if (f.start < startPos && f.end >= startPos && f.end <= endPos) {
        return { ...f, end: startPos - 1 };
      }
      if (f.start >= startPos && f.start <= endPos && f.end > endPos) {
        return { ...f, start: startPos + insertedLength, end: f.end + delta };
      }
      if (f.start < startPos && f.end > endPos) {
        return { ...f, end: f.end + delta };
      }
      return f;
    }).filter((f: any): f is any => f !== null);

    // 3. Add the pasted features adjusted to the insertion point
    const maxId = Math.max(0, ...updatedFeatures.map((f: any) => f.id));
    const adjustedPastedFeatures = pastedFeatures.map((f: any, i: number) => {
      return {
        ...f,
        id: maxId + 1 + i,
        start: f.start + startPos - 1,
        end: f.end + startPos - 1
      };
    });

    // 4. Update state
    dnaSeq = newSeq;
    geneFeatures = [...updatedFeatures, ...adjustedPastedFeatures];
    
    // Clear selection or update it to cover the pasted segment
    selectionStart = startPos;
    selectionEnd = startPos + insertedLength - 1;

    pushToast('success', 'Pasted sequence', `${insertedLength} bp inserted with ${pastedFeatures.length} features`);
  }

  function handlePaste(e: ClipboardEvent) {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      return;
    }

    e.preventDefault();
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasJson = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type === "application/json") {
        hasJson = true;
        items[i].getAsString((text) => {
          try {
            const data = JSON.parse(text);
            if (data && data.source === "SPICE_GENE_EDITOR") {
              insertSequenceWithFeatures(data.sequence, data.features);
            }
          } catch (err) {
            // fallback
          }
        });
        break;
      }
    }

    if (!hasJson) {
      const text = e.clipboardData?.getData("text/plain");
      if (text) {
        const cleanText = text.replace(/[^ATCGUatcguNn]/g, "").toUpperCase();
        if (cleanText) {
          insertSequenceWithFeatures(cleanText, []);
        }
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.classList.contains("s-texteditor-content") || active.hasAttribute("contenteditable"))) {
      return;
    }

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isModKey = isMac ? e.metaKey : e.ctrlKey;

    if (isModKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopy();
      return;
    } else if (isModKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      onSaveProject();
      return;
    }

    // Support Arrow keys for navigation and selection
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const maxPos = seqTool === 'edit' ? dna.length + 1 : dna.length;
      const bpr = basesPerRow;

      if (e.shiftKey) {
        // Shift + Arrow keys: Extend selection
        if (e.key === 'ArrowLeft') {
          if (selectionStart > 1) {
            selectionStart -= 1;
          }
        } else if (e.key === 'ArrowRight') {
          if (selectionEnd < maxPos) {
            selectionEnd += 1;
          }
        } else if (e.key === 'ArrowUp') {
          if (selectionStart > bpr) {
            selectionStart -= bpr;
          } else {
            selectionStart = 1;
          }
        } else if (e.key === 'ArrowDown') {
          if (selectionEnd + bpr <= maxPos) {
            selectionEnd += bpr;
          } else {
            selectionEnd = maxPos;
          }
        }
      } else {
        // Normal Arrow keys: Move cursor / Collapse selection
        if (selectionStart !== selectionEnd) {
          // Collapse selection
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            selectionEnd = selectionStart;
          } else {
            selectionStart = selectionEnd;
          }
        } else {
          // Move single cursor
          if (e.key === 'ArrowLeft') {
            if (selectionStart > 1) {
              selectionStart -= 1;
              selectionEnd = selectionStart;
            }
          } else if (e.key === 'ArrowRight') {
            if (selectionStart < maxPos) {
              selectionStart += 1;
              selectionEnd = selectionStart;
            }
          } else if (e.key === 'ArrowUp') {
            if (selectionStart > bpr) {
              selectionStart -= bpr;
              selectionEnd = selectionStart;
            } else {
              selectionStart = 1;
              selectionEnd = 1;
            }
          } else if (e.key === 'ArrowDown') {
            if (selectionStart + bpr <= maxPos) {
              selectionStart += bpr;
              selectionEnd = selectionStart;
            } else {
              selectionStart = maxPos;
              selectionEnd = maxPos;
            }
          }
        }
      }
      return;
    }

    // Handle DNA editing operations when seqTool is in 'edit' Mode
    if (seqTool === 'edit') {
      // 1. Handle backspace
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (selectionStart !== selectionEnd) {
          handleDelete();
        } else {
          const pos = selectionStart;
          if (pos > 1) {
            const left = dnaSeq.slice(0, pos - 2);
            const right = dnaSeq.slice(pos - 1);
            dnaSeq = left + right;
            selectionStart = pos - 1;
            selectionEnd = pos - 1;
            pushToast('info', m.deletedBase(), m.deletedBpPos1({ pos: pos - 1 }));
          }
        }
        return;
      }

      // 2. Handle delete
      if (e.key === 'Delete') {
        e.preventDefault();
        if (selectionStart !== selectionEnd) {
          handleDelete();
        } else {
          const pos = selectionStart;
          if (pos <= dnaSeq.length) {
            const left = dnaSeq.slice(0, pos - 1);
            const right = dnaSeq.slice(pos);
            dnaSeq = left + right;
            pushToast('info', m.deletedBase(), m.deletedBpPos({ pos: pos }));
          }
        }
        return;
      }

      // 3. Handle valid base insertion/replacement [A, T, C, G] (Desktop strictly restricted to 4 bases!)
      if (e.key.length === 1) {
        const char = e.key.toUpperCase();
        if (['A', 'T', 'C', 'G'].includes(char)) {
          e.preventDefault();
          if (selectionStart === selectionEnd) {
            // Insertion Mode
            const pos = selectionStart;
            dnaSeq = dnaSeq.slice(0, pos - 1) + char + dnaSeq.slice(pos - 1);
            selectionStart = pos + 1;
            selectionEnd = pos + 1;
            pushToast('success', m.insertedBase(), m.insertedCharAtBpPos({ char: char, pos: pos }));
          } else {
            // Modification/Replacement Mode
            const start = Math.min(selectionStart, selectionEnd);
            const end = Math.max(selectionStart, selectionEnd);
            dnaSeq = dnaSeq.slice(0, start - 1) + char + dnaSeq.slice(end);
            selectionStart = start + 1;
            selectionEnd = start + 1;
            pushToast('success', m.replacedBase(), m.editReplaceSelection({ char: char, start: start }));
          }
          return;
        }
      }
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      handleDelete();
    }
  }

  // Handle Virtual DNA Keyboard keypresses (iPad/mobile & click-editing support!)
  function handleVirtualKeyPress(key: string) {
    if (key === 'Backspace') {
      if (selectionStart !== selectionEnd) {
        handleDelete();
      } else {
        const pos = selectionStart;
        if (pos > 1) {
          const left = dnaSeq.slice(0, pos - 2);
          const right = dnaSeq.slice(pos - 1);
          dnaSeq = left + right;
          selectionStart = pos - 1;
          selectionEnd = pos - 1;
          pushToast('info', m.deletedBase(), m.deletedBpPos1({ pos: pos - 1 }));
        }
      }
    } else if (key === 'Delete') {
      if (selectionStart !== selectionEnd) {
        handleDelete();
      } else {
        const pos = selectionStart;
        if (pos <= dnaSeq.length) {
          const left = dnaSeq.slice(0, pos - 1);
          const right = dnaSeq.slice(pos);
          dnaSeq = left + right;
          pushToast('info', m.deletedBase(), m.deletedBpPos({ pos: pos }));
        }
      }
    } else {
      const char = key.toUpperCase();
      if (['A', 'T', 'C', 'G'].includes(char)) {
        if (selectionStart === selectionEnd) {
          // Insertion Mode
          const pos = selectionStart;
          dnaSeq = dnaSeq.slice(0, pos - 1) + char + dnaSeq.slice(pos - 1);
          selectionStart = pos + 1;
          selectionEnd = pos + 1;
          pushToast('success', m.insertedBase(), m.insertedCharAtBpPos({ char: char, pos: pos }));
        } else {
          // Modification/Replacement Mode
          const start = Math.min(selectionStart, selectionEnd);
          const end = Math.max(selectionStart, selectionEnd);
          dnaSeq = dnaSeq.slice(0, start - 1) + char + dnaSeq.slice(end);
          selectionStart = start + 1;
          selectionEnd = start + 1;
          pushToast('success', m.replacedBase(), m.editReplaceSelection({ char: char, start: start }));
        }
      }
    }
  }

  function handleReverseComplement() {
    if (selectionStart === 1 && selectionEnd === 1) return;
    const segment = dnaSeq.slice(selectionStart - 1, selectionEnd);
    const revComp = getReverseComplementSequenceString(segment);
    dnaSeq = dnaSeq.slice(0, selectionStart - 1) + revComp + dnaSeq.slice(selectionEnd);
    pushToast('success', 'Reverse complement applied', `${selectionStart} - ${selectionEnd}`);
  }

  function handleDelete() {
    if (selectionStart === 1 && selectionEnd === 1) return;
    const left = dnaSeq.slice(0, selectionStart - 1);
    const right = dnaSeq.slice(selectionEnd);
    dnaSeq = left + right;
    pushToast('success', 'Selection deleted', `${selectionStart} - ${selectionEnd}`);
    selectionStart = 1; selectionEnd = 1;
  }

  // ---------------- Mouse Drag Selection ----------------
  let isDraggingSelect = $state(false);
  let selectDragAnchor = $state<number | null>(null);

  function handleMouseDown(pos: number, e?: MouseEvent, clickedRow?: any, localY?: number) {
    if (containerEl) {
      containerEl.focus();
    }
    isDraggingSelect = true;
    selectDragAnchor = pos;
    selectionStart = pos;
    selectionEnd = pos;

    // Cache the previous clicked feature to support toggle on second click
    const prevClickedId = clickedFeature ? clickedFeature.id : null;
    clickedFeature = null;

    if (clickedRow && localY !== undefined) {
      const row = clickedRow;
      const y = localY;
      
      const featBaseY = getFeatureTrackYForRow(row);
      const rowFeats = geneFeatures.filter((f: any) => !(f.end < row.start || f.start > row.end));
      const offsets = calculateRowYOffsets(rowFeats);
      
      const clicked = rowFeats.find((feat: any) => {
        if (pos >= feat.start && pos <= feat.end) {
          const itemOffset = offsets.find((o: any) => o.annotation.id === feat.id);
          if (itemOffset) {
            const trackYStart = featBaseY + itemOffset.yOffset * 18;
            const trackYEnd = trackYStart + 14;
            return y >= trackYStart && y <= trackYEnd;
          }
        }
        return false;
      });
      
      if (clicked) {
        if (prevClickedId === clicked.id) {
          // Toggle closed if clicking the same feature again!
          clickedFeature = null;
        } else {
          clickedFeature = clicked;
          
          // Center-align horizontally
          const midBp = (clicked.start + clicked.end) / 2;
          const xOffset = LEFT_MARGIN + (midBp - row.start) * CHAR_W;
          tooltipLeft = xOffset - 120;
          
          const itemOffset = offsets.find((o: any) => o.annotation.id === clicked.id);
          const yOffset = itemOffset ? itemOffset.yOffset : 0;
          const trackYEnd = featBaseY + yOffset * 18 + 14;
          
          const layout = rowLayouts.layouts.find(l => l.row.rowIdx === row.rowIdx);
          const rowTop = layout ? layout.top : 0;
          tooltipTop = rowTop + trackYEnd + 4;
        }

        isDraggingSelect = false;
        selectDragAnchor = null;
      }
    }
  }

  function handleMouseMove(pos: number) {
    if (isDraggingSelect && selectDragAnchor !== null) {
      if (pos < selectDragAnchor) {
        selectionStart = pos;
        selectionEnd = selectDragAnchor;
      } else {
        selectionStart = selectDragAnchor;
        selectionEnd = pos;
      }
    }
  }

  function handleMouseUp() {
    isDraggingSelect = false;
    selectDragAnchor = null;

    // Annotate mode trigger (Feature 3)
    if (seqTool === 'annotate' && selectionStart !== selectionEnd) {
      onAddFeature(selectionStart, selectionEnd);
    }
  }

 function handleScroll(e: Event) {
   if (!containerEl) return;
   scrollTop = containerEl.scrollTop;
    totalContentH = containerEl.scrollHeight;
    viewportH = containerEl.clientHeight;
 }
</script>

<div class="dna-viewer" style="display: flex; flex-direction: column; height: 100%; gap: 0; font-family: var(--pix-font); position: relative;">
  
  <!-- Minimap -->
  <SequenceMinimap 
    {dna} 
    {geneFeatures} 
    {selectionStart} 
    {selectionEnd} 
   {scrollTop} 
   {totalContentH} 
    canvasH={viewportH} 
   onMinimapClick={(pct) => {
      if (containerEl) containerEl.scrollTop = (containerEl.scrollHeight - containerEl.clientHeight) * pct;
   }} 
  />

  <!-- Selection info bar (SnapGene style) -->
  <SelectionToolkit 
    {selectionStart} 
    {selectionEnd} 
    {selectedGcContent}
    {selectedTm}
    onCopy={handleCopy} 
    onCopyAsImage={handleCopyAsImage}
    onReverseComplement={handleReverseComplement} 
    onDelete={handleDelete} 
    onCancel={() => { selectionStart = 1; selectionEnd = 1; }} 
  />

  <!-- Master Split: Vertical Toolbar + Sequence Canvas -->
  <div style="display: flex; gap: 0; flex: 1; min-height: 0; position: relative;">
    
    <!-- Vertical Toolbar -->
    <SequenceToolbar 
      bind:showEnzymes 
      bind:showFeatures 
      bind:showTranslations 
      bind:seqTool
      onOpenHybridization={() => showHybridizationModal = true} 
      onToggleColors={() => pushToast('success', 'Colors', 'Standard')} 
      onAddSelectionNote={onAddSelectionNote}
    />

   <!-- Sequence Canvas -->
   <div 
     bind:this={containerEl}
     class="dna-sequence-view" 
     tabindex="0"
     style="flex: 1; display: flex; flex-direction: column; gap: 0; overflow-y: auto; background: #0a0a0a; position: relative; user-select: none; outline: none;"
     onscroll={handleScroll}
     onkeydown={handleKeyDown}
     onpaste={handlePaste}
     onmousemove={handleMouseMoveContainer}
   >
     <!-- Virtual scroll height placeholder -->
     <div style="height: {rowLayouts.totalHeight}px; width: 100%; position: absolute; top: 0; left: 0; pointer-events: none;"></div>

     <!-- Absolute position virtualized rows -->
     {#each visibleRowLayouts as layout (layout.row.rowIdx)}
       <div style="position: absolute; top: 0; left: 0; width: 100%; transform: translateY({layout.top}px); height: {layout.height}px;">
         <SequenceRow 
           row={layout.row} 
           {dna} 
           {showEnzymes} 
           {showFeatures} 
           {showTranslations} 
           {restrictionSites} 
           {geneFeatures} 
           {parts} 
           {primers} 
           bind:selectionStart 
           bind:selectionEnd 
           containerWidth={containerWidth} 
           bind:hoveredFeature 
           onMouseDown={handleMouseDown} 
           onMouseMove={handleMouseMove} 
           onMouseUp={handleMouseUp} 
           {showSingleStrand}
           {colorTheme}
           {modifiedRanges}
           {seqTool}
         />
       </div>
     {/each}
    </div>
  </div>

  <!-- Bottom Status Bar (SnapGene style) -->
  <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 10px; background: #0a0a0a; border-top: 1px solid #222; font-size: 11px; font-family: 'SF Mono', 'Monaco', monospace;">
    <div style="color: #e0e0e0;">
      {#if selectionStart !== 1 || selectionEnd !== 1}
        Selected: <span style="font-weight: 600;">{selectionStart}..{selectionEnd}</span> = <span style="font-weight: 600;">{selectionEnd - selectionStart + 1} bp</span> [{selectedGcContent.toFixed(1)}% GC]{#if selectedTm !== null} | Tm = {selectedTm}&deg;C{/if}
      {:else}
        <span style="color: #666;">{m.dnaViewerDragSelect()}</span> &middot; {m.dnaViewerLengthLabel()} {dna.length} bp &middot; GC: {dnaGcContent.toFixed(1)}%
      {/if}
    </div>
    <div style="color: #666;">
      {restrictionSites.length} enzymes | {geneFeatures.length} features
    </div>
  </div>
</div>

<!-- Hybridization Dialog -->
<HybridizationDialog 
  bind:show={showHybridizationModal} 
  bind:minBindingBases={minBindingBases} 
  bind:requireTm={requireTm} 
/>

<!-- Clicked Feature Tooltip (SnapGene-style locked below clicked feature!) -->
{#if clickedFeature}
  {@const stats = getFeatureStats(clickedFeature)}
  <div style="position: absolute; left: {tooltipLeft}px; top: {tooltipTop}px; width: 240px; background: #0c0f16; border: 1.5px solid {clickedFeature.color || 'var(--pix-cyan)'}; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.8), inset 0 0 10px rgba(255,255,255,0.05); padding: 8px 10px; z-index: 1000; font-size: 10px; font-family: var(--pix-font);">
    <div 
      onmousedown={handleTooltipMouseDown}
      style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 3px; cursor: move; user-select: none;"
    >
      <span style="font-weight: 600; color: {clickedFeature.color || 'var(--pix-cyan)'}; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;">{clickedFeature.name} ✥</span>
      <button class="pix-btn-reset" onclick={() => clickedFeature = null} style="font-size: 10px; color: var(--pix-red); cursor: pointer; border: none; background: transparent; padding: 0 2px;">[X]</button>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 3px; color: var(--pix-fg-dim);">
      <div style="display: flex; justify-content: space-between;">
        <span>{m.labelRange()}:</span>
        <span class="pix-num" style="color: var(--pix-fg);">{clickedFeature.start}..{clickedFeature.end} bp</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>{m.labelSize()}:</span>
        <span class="pix-num" style="color: var(--pix-fg);">{stats.length} bp</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>{m.labelGcContent()}:</span>
        <span class="pix-num" style="color: var(--pix-cyan);">{stats.gc.toFixed(1)}%</span>
      </div>
      {#if stats.isCds && stats.mwKda}
        <div style="display: flex; justify-content: space-between; border-top: 1px dashed rgba(255,255,255,0.05); padding-top: 2px; margin-top: 2px;">
          <span>{m.labelMw()}:</span>
          <span class="pix-num" style="color: var(--pix-accent-2);">{stats.mwKda} kDa</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Selection Tooltip (fixed at the bottom center of the editor, floating over the workspace!) -->
{#if selectionTooltip}
  <div 
    bind:this={selectionTooltipEl}
    style={selectionTooltipLeft !== null && selectionTooltipTop !== null 
      ? `position: absolute; left: ${selectionTooltipLeft}px; top: ${selectionTooltipTop}px; width: 280px; background: #0c101a; border: 1.5px solid var(--pix-accent-2); border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.9); padding: 8px 12px; z-index: 1000; font-size: 10px; font-family: var(--pix-font); text-align: left;`
      : `position: absolute; bottom: ${isVirtualKeyboardVisible ? '145px' : '42px'}; left: 50%; transform: translateX(-50%); width: 280px; background: #0c101a; border: 1.5px solid var(--pix-accent-2); border-radius: 6px; box-shadow: 0 4px 20px rgba(0,0,0,0.9); padding: 8px 12px; z-index: 1000; font-size: 10px; font-family: var(--pix-font); text-align: left;`}
  >
    <div 
      onmousedown={handleSelectionTooltipMouseDown}
      style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 3px; cursor: move; user-select: none;"
    >
      <span style="font-weight: bold; color: var(--pix-accent-2); font-size: 10.5px;">{m.labelSelectionProperties()} ✥</span>
      <button class="pix-btn-reset" onclick={() => { selectionStart = 1; selectionEnd = 1; }} style="font-size: 10px; color: var(--pix-red); cursor: pointer; border: none; background: transparent; padding: 0 2px;">[X]</button>
    </div>
    
    <div style="display: flex; flex-direction: column; gap: 3px; color: var(--pix-fg-dim); margin-bottom: 6px;">
      <div style="display: flex; justify-content: space-between;">
        <span>{m.labelRange()}:</span>
        <span class="pix-num" style="color: var(--pix-fg);">{selectionTooltip.start}..{selectionTooltip.end} bp</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>{m.labelSelectionSize()}:</span>
        <span class="pix-num" style="color: var(--pix-fg);">{selectionTooltip.length} bp</span>
      </div>
      <div style="display: flex; justify-content: space-between;">
        <span>{m.labelGcContent()}:</span>
        <span class="pix-num" style="color: var(--pix-cyan);">{selectionTooltip.gc.toFixed(1)}%</span>
      </div>
      {#if selectionTooltip.tm !== null}
        <div style="display: flex; justify-content: space-between;">
          <span>{m.labelAnnealingTemp()} (Tm):</span>
          <span class="pix-num" style="color: var(--pix-green);">{selectionTooltip.tm} °C</span>
        </div>
      {/if}
    </div>

    <!-- Quick Actions inside selection tooltip -->
    <div style="display: flex; gap: 4px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px; margin-top: 4px;">
      <button class="pix-btn ok" onclick={onAddSelectionNote} style="padding: 2px 6px; font-size: 8px; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 2px;">
        {m.labelAddNote()}
      </button>
      <button class="pix-btn" onclick={handleCopy} style="padding: 2px 6px; font-size: 8px; flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 2px;">
        {m.labelCopy()}
      </button>
    </div>
  </div>
{/if}

<!-- Virtual DNA Keyboard (shown only in Edit mode, perfect for Pad/mobile and mouse-click edits!) -->
<VirtualKeyboard 
  visible={isVirtualKeyboardVisible} 
  onKeyPress={handleVirtualKeyPress} 
  onClose={() => { seqTool = 'browse'; pushToast('info', m.modeSwitched(), m.exitedEditReturnedToBrowseMode()); }} 
/>

<style>
  .dna-sequence-view::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  .dna-sequence-view::-webkit-scrollbar-track {
    background: #0a0a0a;
  }
  .dna-sequence-view::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 4px;
  }
  .dna-sequence-view::-webkit-scrollbar-thumb:hover {
    background: #444;
  }
  .virtual-key {
    transition: all 0.1s ease;
  }
  .virtual-key:hover {
    transform: scale(1.08);
    filter: brightness(1.2);
  }
  .virtual-key:active {
    transform: scale(0.95);
    filter: brightness(0.9);
  }
</style>
