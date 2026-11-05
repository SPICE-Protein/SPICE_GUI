<script lang="ts">
  // Right-hand inspector for Figure Studio. It edits the document directly
  // (the orchestrator wraps discrete changes in history commits) and never
  // keeps a second copy of node state.
  import {
    CHART_PALETTE,
    FIGURE_FONTS,
    FIGURE_PRESETS,
    PX_TO_MM,
    clamp,
    createFigureId,
    mmToPx,
    type AssetNode,
    type ChartNode,
    type FigureDocument,
    type FigureNode,
    type ImageCrop,
    type ImageNode,
    type PathNode,
    type ScaleBarNode,
    type TextNode
  } from './types';
  import { CHART_CSV_EXAMPLE, applyChartCsv, chartCsv, parseChartCsv } from './charts';
  import { fm } from './messages';
  import type { AlignMode } from './geometry';
  import {
    AlignCenterHorizontal,
    AlignCenterVertical,
    AlignEndHorizontal,
    AlignEndVertical,
    AlignStartHorizontal,
    AlignStartVertical,
    ChevronDown,
    ChevronUp,
    Copy,
    ExternalLink,
    Eye,
    EyeOff,
    Group,
    Lock,
    Layers,
    Trash2,
    Ungroup,
    Unlock
  } from 'lucide-svelte';

  interface InspectorProps {
    doc: FigureDocument;
    selectedIds: string[];
    focusToken: number;
    onCommit: (mutate: () => void) => void;
    onBegin: () => void;
    onEnd: () => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onGroup: () => void;
    onUngroup: () => void;
    onAlign: (mode: AlignMode) => void;
    onDistribute: (axis: 'x' | 'y') => void;
    onZOrder: (order: 'up' | 'down' | 'front' | 'back') => void;
    onLock: (locked: boolean) => void;
    onHide: (hidden: boolean) => void;
    onCopyStyle: () => void;
    onPasteStyle: () => void;
    canPasteStyle: boolean;
  }

  let {
    doc,
    selectedIds,
    focusToken,
    onCommit,
    onBegin,
    onEnd,
    onDelete,
    onDuplicate,
    onGroup,
    onUngroup,
    onAlign,
    onDistribute,
    onZOrder,
    onLock,
    onHide,
    onCopyStyle,
    onPasteStyle,
    canPasteStyle
  }: InspectorProps = $props();

  let textArea = $state<HTMLTextAreaElement | null>(null);
  // CSV editing keeps a per-node draft so typing does not touch the document
  // until the change event fires.
  let chartDraftSource: ChartNode | null = null;
  let chartDraft = $state('');
  let chartDraftError = $state(false);

  const selectedNodes = $derived(doc.nodes.filter((node) => selectedIds.includes(node.id)));
  const selectedNode = $derived(selectedNodes.length === 1 ? selectedNodes[0] : null);
  const selectedText = $derived(selectedNode?.type === 'text' ? (selectedNode as TextNode) : null);
  const selectedAsset = $derived(selectedNode?.type === 'asset' ? (selectedNode as AssetNode) : null);
  const selectedImage = $derived(selectedNode?.type === 'image' ? (selectedNode as ImageNode) : null);
  const selectedChart = $derived(selectedNode?.type === 'chart' ? (selectedNode as ChartNode) : null);
  const selectedScaleBar = $derived(
    selectedNode?.type === 'scalebar' ? (selectedNode as ScaleBarNode) : null
  );
  const selectedPath = $derived(selectedNode?.type === 'path' ? (selectedNode as PathNode) : null);
  const hasGroup = $derived(selectedNodes.some((node) => !!node.groupId));
  const allLocked = $derived(selectedNodes.length > 0 && selectedNodes.every((node) => node.locked));
  const allHidden = $derived(selectedNodes.length > 0 && selectedNodes.every((node) => node.hidden));

  const presetId = $derived(
    FIGURE_PRESETS.find(
      (preset) =>
        Math.abs(preset.widthMm - doc.widthMm) < 0.05 && Math.abs(preset.heightMm - doc.heightMm) < 0.05
    )?.id ?? 'custom'
  );

  $effect(() => {
    const token = focusToken;
    const text = selectedText;
    if (token > 0 && text && textArea) {
      textArea.focus();
      textArea.setSelectionRange(textArea.value.length, textArea.value.length);
    }
  });

  $effect(() => {
    const chart = selectedChart;
    if (!chart) {
      chartDraftSource = null;
      chartDraftError = false;
      return;
    }
    // Re-seed when undo/redo swaps in a different node object, but never while
    // the user is typing into the CSV box (the object stays identical).
    if (chart !== chartDraftSource) {
      chartDraftSource = chart;
      chartDraft = chartCsv(chart);
      chartDraftError = false;
    }
  });

  function isNone(color: string | undefined): boolean {
    const value = (color ?? '').trim().toLowerCase();
    return !value || value === 'none' || value === 'transparent';
  }

  function mmValue(px: number): string {
    return (px * PX_TO_MM).toFixed(2);
  }

  function numberFrom(event: Event): number {
    const target = event.currentTarget as HTMLInputElement | HTMLSelectElement | null;
    if (!target || target.value.trim() === '') return Number.NaN;
    return Number(target.value);
  }

  function stringFrom(event: Event): string {
    const target = event.currentTarget as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
      | null;
    return target ? target.value : '';
  }

  function checkedFrom(event: Event): boolean {
    const target = event.currentTarget as HTMLInputElement | null;
    return target ? target.checked : false;
  }

  function applyNumber(event: Event, apply: (value: number) => void) {
    const value = numberFrom(event);
    if (!Number.isFinite(value)) return;
    onCommit(() => apply(value));
  }

  function applyOptionalNumber(event: Event, apply: (value: number | null) => void) {
    const raw = stringFrom(event).trim();
    if (raw === '') {
      onCommit(() => apply(null));
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    onCommit(() => apply(value));
  }

  // Chart CSV editing: parse on change, keep the typed text on failure.
  function applyChartText(event: Event) {
    const chart = selectedChart;
    if (!chart) return;
    const text = stringFrom(event);
    chartDraft = text;
    const data = parseChartCsv(text);
    if (!data) {
      chartDraftError = true;
      return;
    }
    chartDraftError = false;
    onCommit(() => applyChartCsv(chart, data, CHART_PALETTE));
  }

  function loadChartExample() {
    const chart = selectedChart;
    if (!chart) return;
    const data = parseChartCsv(CHART_CSV_EXAMPLE);
    if (!data) return;
    chartDraft = CHART_CSV_EXAMPLE;
    chartDraftError = false;
    onCommit(() => applyChartCsv(chart, data, CHART_PALETTE));
  }

  function addSignificance(chart: ChartNode) {
    if (chart.labels.length < 2) return;
    onCommit(() => {
      chart.significance.push({
        id: createFigureId('sig'),
        from: 0,
        to: Math.min(1, chart.labels.length - 1),
        label: '*'
      });
    });
  }

  function removeSignificance(chart: ChartNode, id: string) {
    onCommit(() => {
      chart.significance = chart.significance.filter((sig) => sig.id !== id);
    });
  }

  function changeSignificanceIndex(
    chart: ChartNode,
    sig: ChartNode['significance'][number],
    edge: 'from' | 'to',
    event: Event
  ) {
    const value = numberFrom(event);
    if (!Number.isFinite(value)) return;
    const index = clamp(Math.round(value), 0, Math.max(0, chart.labels.length - 1));
    onCommit(() => {
      if (edge === 'from') {
        sig.from = index;
        if (sig.to < index) sig.to = index;
      } else {
        sig.to = index;
        if (sig.from > index) sig.from = index;
      }
    });
  }

  // Crop helpers keep the four side percentages consistent with the 0..1
  // source rectangle and enforce a minimum visible area.
  function imageCrop(node: ImageNode): ImageCrop {
    return node.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  }

  function cropPercent(node: ImageNode, side: 'left' | 'top' | 'right' | 'bottom'): number {
    const crop = imageCrop(node);
    const fraction =
      side === 'left'
        ? crop.x
        : side === 'top'
          ? crop.y
          : side === 'right'
            ? 1 - (crop.x + crop.w)
            : 1 - (crop.y + crop.h);
    return Math.round(clamp(fraction, 0, 1) * 1000) / 10;
  }

  function applyCropPercent(
    node: ImageNode,
    side: 'left' | 'top' | 'right' | 'bottom',
    percent: number
  ) {
    if (!Number.isFinite(percent)) return;
    const crop = imageCrop(node);
    const min = 0.01;
    let left = crop.x;
    let top = crop.y;
    let right = 1 - (crop.x + crop.w);
    let bottom = 1 - (crop.y + crop.h);
    const value = clamp(percent, 0, 100) / 100;
    if (side === 'left') left = clamp(value, 0, Math.max(0, 1 - right - min));
    else if (side === 'right') right = clamp(value, 0, Math.max(0, 1 - left - min));
    else if (side === 'top') top = clamp(value, 0, Math.max(0, 1 - bottom - min));
    else bottom = clamp(value, 0, Math.max(0, 1 - top - min));
    const round = (input: number) => Math.round(input * 10000) / 10000;
    onCommit(() => {
      node.crop = {
        x: round(left),
        y: round(top),
        w: round(Math.max(min, 1 - left - right)),
        h: round(Math.max(min, 1 - top - bottom))
      };
    });
  }

  // Reflect the clamped value back into the input so repeated edits stay in range.
  function onCropChange(
    node: ImageNode,
    side: 'left' | 'top' | 'right' | 'bottom',
    event: Event
  ) {
    applyCropPercent(node, side, numberFrom(event));
    const input = event.currentTarget as HTMLInputElement | null;
    if (input) input.value = String(cropPercent(node, side));
  }

  function resetCrop(node: ImageNode) {
    onCommit(() => {
      node.crop = { x: 0, y: 0, w: 1, h: 1 };
    });
  }

  function applyPreset(id: string) {
    const preset = FIGURE_PRESETS.find((candidate) => candidate.id === id);
    if (!preset) return;
    onCommit(() => {
      doc.widthMm = preset.widthMm;
      doc.heightMm = preset.heightMm;
    });
  }

  function defaultFill(node: FigureNode): string {
    if (node.type === 'rect') return '#e8f1f8';
    if (node.type === 'ellipse') return '#fdf0e6';
    return '#e8f1f8';
  }

  function defaultStroke(node: FigureNode): string {
    if (node.type === 'rect') return '#1f6f8b';
    if (node.type === 'ellipse') return '#c46a1b';
    return '#263238';
  }

  function typeLabel(node: FigureNode): string {
    switch (node.type) {
      case 'rect':
        return fm.figRect();
      case 'ellipse':
        return fm.figEllipse();
      case 'line':
        return fm.figLine();
      case 'arrow':
        return fm.figArrow();
      case 'text':
        return fm.figTextTool();
      case 'asset':
        return fm.figAsset();
      case 'image':
        return fm.figImage();
      case 'chart':
        return fm.figChart();
      case 'scalebar':
        return fm.figScaleBar();
      case 'path':
        return fm.figPath();
      default:
        return '';
    }
  }

  function alignIcon(mode: AlignMode) {
    switch (mode) {
      case 'left':
        return AlignStartVertical;
      case 'hcenter':
        return AlignCenterVertical;
      case 'right':
        return AlignEndVertical;
      case 'top':
        return AlignStartHorizontal;
      case 'vcenter':
        return AlignCenterHorizontal;
      case 'bottom':
        return AlignEndHorizontal;
    }
  }

  function updateText(value: string) {
    if (!selectedText) return;
    selectedText.text = value;
    const firstLine = value.split('\n')[0].trim();
    if (firstLine) selectedText.name = firstLine.slice(0, 28);
  }

  const alignModes: AlignMode[] = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'];
</script>

<div class="inspector" data-testid="figure-inspector">
  <details open={selectedNodes.length === 0}>
    <summary><Layers size={11} /> {fm.figDocument()}</summary>
    <div class="sec-body">
      <label class="field">
        <span>{fm.figFigureName()}</span>
        <input
          class="pix-input"
          value={doc.name}
          oninput={(event) => {
            doc.name = stringFrom(event);
          }}
          onfocus={onBegin}
          onblur={onEnd}
        />
      </label>
      <div class="grid2">
        <label class="field">
          <span>{fm.figPageSize()}</span>
          <select
            class="pix-select"
            value={presetId}
            onchange={(event) => applyPreset(stringFrom(event))}
          >
            {#each FIGURE_PRESETS as preset (preset.id)}
              <option value={preset.id}>{preset.widthMm} × {preset.heightMm} mm</option>
            {/each}
            <option value="custom">
              {doc.widthMm.toFixed(1)} × {doc.heightMm.toFixed(1)} mm
            </option>
          </select>
        </label>
        <div class="field">
          <span>&nbsp;</span>
          <div class="readout">{doc.widthMm.toFixed(1)} × {doc.heightMm.toFixed(1)} mm</div>
        </div>
        <label class="field">
          <span>{fm.figWidth()} (mm)</span>
          <input
            class="pix-input"
            data-testid="figure-width"
            type="number"
            min="10"
            max="2000"
            step="1"
            value={doc.widthMm}
            onchange={(event) => applyNumber(event, (value) => (doc.widthMm = clamp(value, 10, 2000)))}
          />
        </label>
        <label class="field">
          <span>{fm.figHeight()} (mm)</span>
          <input
            class="pix-input"
            data-testid="figure-height"
            type="number"
            min="10"
            max="2000"
            step="1"
            value={doc.heightMm}
            onchange={(event) => applyNumber(event, (value) => (doc.heightMm = clamp(value, 10, 2000)))}
          />
        </label>
        <label class="field color-field">
          <span>{fm.figBackground()}</span>
          <input
            class="pix-color"
            data-testid="figure-background"
            type="color"
            value={isNone(doc.background) ? '#ffffff' : doc.background}
            oninput={(event) => {
              doc.background = stringFrom(event);
            }}
            onfocus={onBegin}
            onblur={onEnd}
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={doc.grid.show}
            onchange={(event) => onCommit(() => (doc.grid.show = checkedFrom(event)))}
          />
          {fm.figGrid()}
        </label>
      </div>
      <div class="grid2">
        <label class="check">
          <input
            type="checkbox"
            checked={doc.grid.snap}
            onchange={(event) => onCommit(() => (doc.grid.snap = checkedFrom(event)))}
          />
          {fm.figSnap()}
        </label>
        <label class="field">
          <span>{fm.figGridSize()} (mm)</span>
          <input
            class="pix-input"
            type="number"
            min="0.5"
            max="50"
            step="0.5"
            value={doc.grid.sizeMm}
            onchange={(event) => applyNumber(event, (value) => (doc.grid.sizeMm = clamp(value, 0.5, 50)))}
          />
        </label>
      </div>
    </div>
  </details>

  {#if selectedNode}
    {@const node = selectedNode}
    <details open>
      <summary><Layers size={11} /> {typeLabel(node)}</summary>
      <div class="sec-body">
        <div class="node-name">{node.name || typeLabel(node)}</div>

        <div class="sub-head">{fm.figGeometry()}</div>
        <div class="grid2">
          <label class="field">
            <span>{fm.figX()} (mm)</span>
            <input
              class="pix-input"
              type="number"
              step="0.1"
              value={mmValue(node.x)}
              onchange={(event) => applyNumber(event, (value) => (node.x = mmToPx(value)))}
            />
          </label>
          <label class="field">
            <span>{fm.figY()} (mm)</span>
            <input
              class="pix-input"
              type="number"
              step="0.1"
              value={mmValue(node.y)}
              onchange={(event) => applyNumber(event, (value) => (node.y = mmToPx(value)))}
            />
          </label>
          <label class="field">
            <span>{fm.figWidth()} (mm)</span>
            <input
              class="pix-input"
              type="number"
              min="0.1"
              step="0.1"
              value={mmValue(node.w)}
              onchange={(event) =>
                applyNumber(event, (value) => (node.w = Math.max(1, mmToPx(value))))}
            />
          </label>
          <label class="field">
            <span>{fm.figHeight()} (mm)</span>
            <input
              class="pix-input"
              type="number"
              min="0.1"
              step="0.1"
              value={mmValue(node.h)}
              onchange={(event) =>
                applyNumber(event, (value) => (node.h = Math.max(1, mmToPx(value))))}
            />
          </label>
          <label class="field">
            <span>{fm.figRotation()} (°)</span>
            <input
              class="pix-input"
              type="number"
              step="1"
              min="-360"
              max="360"
              value={Math.round(node.rotation * 10) / 10}
              onchange={(event) =>
                applyNumber(event, (value) => (node.rotation = clamp(value, -360, 360)))}
            />
          </label>
          <div class="field">
            <span>{fm.figOpacity()} ({Math.round(node.opacity * 100)}%)</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={node.opacity}
              oninput={(event) => {
                node.opacity = clamp(numberFrom(event), 0, 1);
              }}
              onpointerdown={onBegin}
              onpointerup={onEnd}
              onfocus={onBegin}
              onblur={onEnd}
            />
          </div>
        </div>

        <div class="sub-head">{fm.figStyle()}</div>
        <div class="grid2">
          <label class="check">
            <input
              type="checkbox"
              checked={!isNone(node.fill)}
              onchange={(event) =>
                onCommit(() => {
                  node.fill = checkedFrom(event) ? defaultFill(node) : 'none';
                })}
            />
            {fm.figFill()}
          </label>
          <label class="field color-field">
            <span>&nbsp;</span>
            <input
              class="pix-color"
              type="color"
              disabled={isNone(node.fill)}
              value={isNone(node.fill) ? '#e8f1f8' : node.fill}
              oninput={(event) => {
                node.fill = stringFrom(event);
              }}
              onfocus={onBegin}
              onblur={onEnd}
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={!isNone(node.stroke)}
              onchange={(event) =>
                onCommit(() => {
                  node.stroke = checkedFrom(event) ? defaultStroke(node) : 'none';
                })}
            />
            {fm.figStroke()}
          </label>
          <label class="field color-field">
            <span>&nbsp;</span>
            <input
              class="pix-color"
              type="color"
              disabled={isNone(node.stroke)}
              value={isNone(node.stroke) ? '#263238' : node.stroke}
              oninput={(event) => {
                node.stroke = stringFrom(event);
              }}
              onfocus={onBegin}
              onblur={onEnd}
            />
          </label>
          <label class="field">
            <span>{fm.figStrokeWidth()}</span>
            <input
              class="pix-input"
              type="number"
              min="0"
              max="40"
              step="0.25"
              value={node.strokeWidth}
              onchange={(event) =>
                applyNumber(event, (value) => (node.strokeWidth = clamp(value, 0, 40)))}
            />
          </label>
          <label class="field">
            <span>{fm.figDash()}</span>
            <select
              class="pix-select"
              value={node.dash}
              onchange={(event) =>
                onCommit(() => {
                  node.dash = stringFrom(event) as FigureNode['dash'];
                })}
            >
              <option value="solid">———</option>
              <option value="dashed">– – –</option>
              <option value="dotted">· · ·</option>
            </select>
          </label>
          <label class="field">
            <span>{fm.figCornerRadius()}</span>
            <input
              class="pix-input"
              type="number"
              min="0"
              max="200"
              step="1"
              value={node.cornerRadius}
              onchange={(event) =>
                applyNumber(event, (value) => (node.cornerRadius = clamp(value, 0, 200)))}
            />
          </label>
        </div>
        <div class="btn-row style-actions">
          <button class="pix-btn tiny-btn" data-testid="figure-copy-style" onclick={onCopyStyle}>
            <Copy size={10} /> {fm.figCopyStyle()}
          </button>
          <button
            class="pix-btn tiny-btn"
            data-testid="figure-paste-style"
            disabled={!canPasteStyle}
            onclick={onPasteStyle}
          >
            {fm.figPasteStyle()}
          </button>
        </div>

        {#if selectedText}
          <div class="sub-head">{fm.figText()}</div>
          <label class="field">
            <span>{fm.figText()}</span>
            <textarea
              class="pix-input"
              data-testid="figure-text-input"
              rows="4"
              bind:this={textArea}
              value={selectedText.text}
              oninput={(event) => updateText(stringFrom(event))}
              onfocus={onBegin}
              onblur={onEnd}
            ></textarea>
          </label>
          <div class="grid2">
            <label class="field">
              <span>{fm.figFont()}</span>
              <select
                class="pix-select"
                value={selectedText.fontFamily}
                onchange={(event) =>
                  onCommit(() => (selectedText.fontFamily = stringFrom(event)))}
              >
                {#each FIGURE_FONTS as font (font)}
                  <option value={font}>{font}</option>
                {/each}
              </select>
            </label>
            <label class="field">
              <span>{fm.figFontSize()} (pt)</span>
              <input
                class="pix-input"
                type="number"
                min="4"
                max="300"
                step="0.5"
                value={selectedText.fontSize}
                onchange={(event) =>
                  applyNumber(event, (value) => (selectedText.fontSize = clamp(value, 4, 300)))}
              />
            </label>
            <label class="field">
              <span>{fm.figBold()}</span>
              <select
                class="pix-select"
                value={String(selectedText.fontWeight)}
                onchange={(event) => {
                  const value = Number(stringFrom(event));
                  onCommit(
                    () =>
                      (selectedText.fontWeight = [400, 500, 600, 700, 800].includes(value)
                        ? (value as TextNode['fontWeight'])
                        : 400)
                  );
                }}
              >
                <option value="400">400</option>
                <option value="500">500</option>
                <option value="600">600</option>
                <option value="700">700</option>
                <option value="800">800</option>
              </select>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={selectedText.italic}
                onchange={(event) =>
                  onCommit(() => (selectedText.italic = checkedFrom(event)))}
              />
              {fm.figItalic()}
            </label>
            <label class="field">
              <span>{fm.figAlign()}</span>
              <select
                class="pix-select"
                value={selectedText.align}
                onchange={(event) =>
                  onCommit(() => (selectedText.align = stringFrom(event) as TextNode['align']))}
              >
                <option value="left">L</option>
                <option value="center">C</option>
                <option value="right">R</option>
              </select>
            </label>
            <label class="field">
              <span>{fm.figLineHeight()}</span>
              <input
                class="pix-input"
                type="number"
                min="0.8"
                max="3"
                step="0.05"
                value={selectedText.lineHeight}
                onchange={(event) =>
                  applyNumber(event, (value) => (selectedText.lineHeight = clamp(value, 0.8, 3)))}
              />
            </label>
            <label class="field color-field">
              <span>{fm.figColor()}</span>
              <input
                class="pix-color"
                type="color"
                value={isNone(selectedText.color) ? '#111827' : selectedText.color}
                oninput={(event) => {
                  selectedText.color = stringFrom(event);
                }}
                onfocus={onBegin}
                onblur={onEnd}
              />
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={!isNone(selectedText.background)}
                onchange={(event) =>
                  onCommit(
                    () =>
                      (selectedText.background = checkedFrom(event) ? '#ffffff' : 'none')
                  )}
              />
              {fm.figBackground()}
            </label>
          </div>
          {#if !isNone(selectedText.background)}
            <label class="field color-field">
              <span>{fm.figBackground()}</span>
              <input
                class="pix-color"
                type="color"
                value={selectedText.background}
                oninput={(event) => {
                  selectedText.background = stringFrom(event);
                }}
                onfocus={onBegin}
                onblur={onEnd}
              />
            </label>
          {/if}
        {/if}

        {#if selectedAsset}
          <div class="sub-head">{fm.figAsset()}</div>
          <div class="asset-preview">
            <img src={selectedAsset.svgFile} alt={selectedAsset.label} />
          </div>
          <div class="meta-row">
            <span class="meta-label">{fm.figAsset()}</span>
            <span>{selectedAsset.label || selectedAsset.name}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">{fm.figCreator()}</span>
            <span>{selectedAsset.creator || '—'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">{fm.figCredit()}</span>
            <span>{selectedAsset.credit || '—'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">{fm.figLicenseNote()}</span>
            <span>{selectedAsset.license || '—'}</span>
          </div>
          <div class="meta-row">
            <span class="meta-label">{fm.figCitation()}</span>
            <span>{selectedAsset.citation || '—'}</span>
          </div>
          {#if selectedAsset.sourceUrl}
            <a class="source-link" href={selectedAsset.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={11} /> {selectedAsset.sourceUrl}
            </a>
          {/if}
        {/if}

        {#if selectedImage}
          <div class="sub-head">{fm.figImage()}</div>
          {#if selectedImage.dataUrl}
            <div class="asset-preview">
              <img src={selectedImage.dataUrl} alt={selectedImage.name} />
            </div>
          {/if}
          <label class="field">
            <span>{fm.figFitMode()}</span>
            <select
              class="pix-select"
              value={selectedImage.fit}
              onchange={(event) =>
                onCommit(() => (selectedImage.fit = stringFrom(event) as ImageNode['fit']))}
            >
              <option value="contain">contain</option>
              <option value="cover">cover</option>
              <option value="stretch">stretch</option>
            </select>
          </label>
          <div class="grid2">
            <label class="check">
              <input
                type="checkbox"
                checked={selectedImage.flipX}
                onchange={(event) =>
                  onCommit(() => (selectedImage.flipX = checkedFrom(event)))}
              />
              {fm.figFlipX()}
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={selectedImage.flipY}
                onchange={(event) =>
                  onCommit(() => (selectedImage.flipY = checkedFrom(event)))}
              />
              {fm.figFlipY()}
            </label>
          </div>
          <div class="sub-head">{fm.figImageCrop()}</div>
          <div class="grid2">
            <label class="field">
              <span>{fm.figCropLeft()} (%)</span>
              <input
                class="pix-input"
                data-testid="figure-crop-left"
                type="number"
                min="0"
                max="99"
                step="0.1"
                value={cropPercent(selectedImage, 'left')}
                onchange={(event) => onCropChange(selectedImage, 'left', event)}
              />
            </label>
            <label class="field">
              <span>{fm.figCropTop()} (%)</span>
              <input
                class="pix-input"
                data-testid="figure-crop-top"
                type="number"
                min="0"
                max="99"
                step="0.1"
                value={cropPercent(selectedImage, 'top')}
                onchange={(event) => onCropChange(selectedImage, 'top', event)}
              />
            </label>
            <label class="field">
              <span>{fm.figCropRight()} (%)</span>
              <input
                class="pix-input"
                data-testid="figure-crop-right"
                type="number"
                min="0"
                max="99"
                step="0.1"
                value={cropPercent(selectedImage, 'right')}
                onchange={(event) => onCropChange(selectedImage, 'right', event)}
              />
            </label>
            <label class="field">
              <span>{fm.figCropBottom()} (%)</span>
              <input
                class="pix-input"
                data-testid="figure-crop-bottom"
                type="number"
                min="0"
                max="99"
                step="0.1"
                value={cropPercent(selectedImage, 'bottom')}
                onchange={(event) => onCropChange(selectedImage, 'bottom', event)}
              />
            </label>
          </div>
          <div class="btn-row">
            <label class="check">
              <input
                type="checkbox"
                data-testid="figure-lock-aspect"
                checked={selectedImage.lockAspect ?? false}
                onchange={(event) =>
                  onCommit(() => (selectedImage.lockAspect = checkedFrom(event)))}
              />
              {fm.figLockAspect()}
            </label>
            <button
              class="pix-btn tiny-btn"
              data-testid="figure-crop-reset"
              onclick={() => resetCrop(selectedImage)}
            >
              {fm.figCropReset()}
            </button>
          </div>
        {/if}

        {#if selectedPath}
          {@const path = selectedPath}
          <div class="sub-head">{fm.figPath()}</div>
          <label class="check">
            <input
              type="checkbox"
              data-testid="figure-path-closed"
              checked={path.closed}
              onchange={(event) => onCommit(() => (path.closed = checkedFrom(event)))}
            />
            {fm.figClosed()}
          </label>
          <div class="grid2">
            <label class="check">
              <input
                type="checkbox"
                data-testid="figure-path-head-start"
                checked={path.headStart}
                onchange={(event) => onCommit(() => (path.headStart = checkedFrom(event)))}
              />
              {fm.figHeadStart()}
            </label>
            <label class="check">
              <input
                type="checkbox"
                data-testid="figure-path-head-end"
                checked={path.headEnd}
                onchange={(event) => onCommit(() => (path.headEnd = checkedFrom(event)))}
              />
              {fm.figHeadEnd()}
            </label>
          </div>
          <label class="field">
            <span>{fm.figHeadSize()}</span>
            <input
              class="pix-input"
              data-testid="figure-path-head-size"
              type="number"
              min="1"
              max="200"
              step="1"
              value={path.headSize}
              onchange={(event) =>
                applyNumber(event, (value) => (path.headSize = clamp(value, 1, 200)))}
            />
          </label>
        {/if}

        {#if selectedChart}
          {@const chart = selectedChart}
          <div class="sub-head">{fm.figChart()}</div>
          <label class="field">
            <span>{fm.figChartType()}</span>
            <select
              class="pix-select"
              data-testid="figure-chart-type"
              value={chart.chartType}
              onchange={(event) =>
                onCommit(() => (chart.chartType = stringFrom(event) as ChartNode['chartType']))}
            >
              <option value="bar">{fm.figChartBar()}</option>
              <option value="line">{fm.figChartLine()}</option>
              <option value="scatter">{fm.figChartScatter()}</option>
            </select>
          </label>
          <label class="field">
            <span>{fm.figChartData()}</span>
            <textarea
              class="pix-input"
              data-testid="figure-chart-csv"
              rows="5"
              value={chartDraft}
              oninput={(event) => {
                chartDraft = stringFrom(event);
                chartDraftError = false;
              }}
              onchange={applyChartText}
            ></textarea>
          </label>
          <div class="pix-dim chart-hint">{fm.figChartDataHint()}</div>
          {#if chartDraftError}
            <div class="pix-dim chart-error">{fm.figChartInvalidData()}</div>
          {/if}
          <div class="btn-row">
            <button class="pix-btn tiny-btn" onclick={loadChartExample}>
              {fm.figChartUseExample()}
            </button>
          </div>
          <div class="grid2">
            <label class="field">
              <span>{fm.figChartXLabel()}</span>
              <input
                class="pix-input"
                value={chart.xLabel}
                onchange={(event) => onCommit(() => (chart.xLabel = stringFrom(event)))}
              />
            </label>
            <label class="field">
              <span>{fm.figChartYLabel()}</span>
              <input
                class="pix-input"
                value={chart.yLabel}
                onchange={(event) => onCommit(() => (chart.yLabel = stringFrom(event)))}
              />
            </label>
            <div class="field">
              <span>{fm.figChartYRange()} ({fm.figChartAuto()})</span>
              <div class="grid2">
                <input
                  class="pix-input"
                  type="number"
                  step="any"
                  placeholder={fm.figChartAuto()}
                  value={chart.yMin ?? ''}
                  onchange={(event) =>
                    applyOptionalNumber(event, (value) => (chart.yMin = value))}
                />
                <input
                  class="pix-input"
                  type="number"
                  step="any"
                  placeholder={fm.figChartAuto()}
                  value={chart.yMax ?? ''}
                  onchange={(event) =>
                    applyOptionalNumber(event, (value) => (chart.yMax = value))}
                />
              </div>
            </div>
          </div>
          <div class="grid2">
            <label class="check">
              <input
                type="checkbox"
                checked={chart.showLegend}
                onchange={(event) => onCommit(() => (chart.showLegend = checkedFrom(event)))}
              />
              {fm.figChartLegend()}
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={chart.showGrid}
                onchange={(event) => onCommit(() => (chart.showGrid = checkedFrom(event)))}
              />
              {fm.figChartGrid()}
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={chart.showValues}
                onchange={(event) => onCommit(() => (chart.showValues = checkedFrom(event)))}
              />
              {fm.figChartValues()}
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={chart.showErrorBars}
                onchange={(event) =>
                  onCommit(() => (chart.showErrorBars = checkedFrom(event)))}
              />
              {fm.figChartErrorBars()}
            </label>
          </div>
          <div class="grid2">
            <label class="field">
              <span>{fm.figFont()}</span>
              <select
                class="pix-select"
                value={chart.fontFamily}
                onchange={(event) => onCommit(() => (chart.fontFamily = stringFrom(event)))}
              >
                {#each FIGURE_FONTS as font (font)}
                  <option value={font}>{font}</option>
                {/each}
              </select>
            </label>
            <label class="field">
              <span>{fm.figFontSize()} (pt)</span>
              <input
                class="pix-input"
                type="number"
                min="4"
                max="300"
                step="0.5"
                value={chart.fontSize}
                onchange={(event) =>
                  applyNumber(event, (value) => (chart.fontSize = clamp(value, 4, 300)))}
              />
            </label>
            <label class="field color-field">
              <span>{fm.figColor()}</span>
              <input
                class="pix-color"
                type="color"
                value={isNone(chart.textColor) ? '#334155' : chart.textColor}
                oninput={(event) => {
                  chart.textColor = stringFrom(event);
                }}
                onfocus={onBegin}
                onblur={onEnd}
              />
            </label>
          </div>
          <div class="sub-head">{fm.figChartSignificance()}</div>
          {#each chart.significance as sig (sig.id)}
            <div class="sig-item">
              <div class="grid2">
                <label class="field">
                  <span>{fm.figChartFrom()}</span>
                  <select
                    class="pix-select"
                    value={sig.from}
                    onchange={(event) =>
                      changeSignificanceIndex(chart, sig, 'from', event)}
                  >
                    {#each chart.labels as label, index (index)}
                      <option value={index}>{label}</option>
                    {/each}
                  </select>
                </label>
                <label class="field">
                  <span>{fm.figChartTo()}</span>
                  <select
                    class="pix-select"
                    value={sig.to}
                    onchange={(event) => changeSignificanceIndex(chart, sig, 'to', event)}
                  >
                    {#each chart.labels as label, index (index)}
                      <option value={index}>{label}</option>
                    {/each}
                  </select>
                </label>
                <label class="field">
                  <span>{fm.figChartLabel()}</span>
                  <input
                    class="pix-input"
                    value={sig.label}
                    onchange={(event) => onCommit(() => (sig.label = stringFrom(event)))}
                  />
                </label>
                <div class="field">
                  <span>&nbsp;</span>
                  <button
                    class="pix-btn tiny-btn danger"
                    title={fm.figDelete()}
                    onclick={() => removeSignificance(chart, sig.id)}
                  >
                    <Trash2 size={10} /> {fm.figDelete()}
                  </button>
                </div>
              </div>
            </div>
          {/each}
          <div class="btn-row">
            <button
              class="pix-btn tiny-btn"
              disabled={chart.labels.length < 2}
              onclick={() => addSignificance(chart)}
            >
              {fm.figChartAddSignificance()}
            </button>
          </div>
        {/if}

        {#if selectedScaleBar}
          {@const scaleBar = selectedScaleBar}
          <div class="sub-head">{fm.figScaleBar()}</div>
          <label class="field">
            <span>{fm.figScaleLabel()}</span>
            <input
              class="pix-input"
              data-testid="figure-scalebar-label"
              value={scaleBar.label}
              onchange={(event) => onCommit(() => (scaleBar.label = stringFrom(event)))}
            />
          </label>
          <div class="grid2">
            <label class="field">
              <span>{fm.figScaleThickness()}</span>
              <input
                class="pix-input"
                data-testid="figure-scalebar-thickness"
                type="number"
                min="0.5"
                max="40"
                step="0.5"
                value={scaleBar.thickness}
                onchange={(event) =>
                  applyNumber(event, (value) => (scaleBar.thickness = clamp(value, 0.5, 40)))}
              />
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={scaleBar.ticks}
                onchange={(event) => onCommit(() => (scaleBar.ticks = checkedFrom(event)))}
              />
              {fm.figScaleTicks()}
            </label>
            <label class="field">
              <span>{fm.figFontSize()} (pt)</span>
              <input
                class="pix-input"
                type="number"
                min="4"
                max="300"
                step="0.5"
                value={scaleBar.fontSize}
                onchange={(event) =>
                  applyNumber(event, (value) => (scaleBar.fontSize = clamp(value, 4, 300)))}
              />
            </label>
            <label class="field color-field">
              <span>{fm.figColor()}</span>
              <input
                class="pix-color"
                type="color"
                value={isNone(scaleBar.textColor) ? '#111827' : scaleBar.textColor}
                oninput={(event) => {
                  scaleBar.textColor = stringFrom(event);
                }}
                onfocus={onBegin}
                onblur={onEnd}
              />
            </label>
          </div>
        {/if}

        <div class="sub-head">{fm.figLayers()}</div>
        <div class="btn-row">
          <button class="pix-btn tiny-btn" onclick={() => onZOrder('up')} title={fm.figMoveUp()}>
            <ChevronUp size={10} /> {fm.figMoveUp()}
          </button>
          <button class="pix-btn tiny-btn" onclick={() => onZOrder('down')} title={fm.figMoveDown()}>
            <ChevronDown size={10} /> {fm.figMoveDown()}
          </button>
          <button class="pix-btn tiny-btn" onclick={() => onZOrder('front')}>
            {fm.figBringFront()}
          </button>
          <button class="pix-btn tiny-btn" onclick={() => onZOrder('back')}>
            {fm.figSendBack()}
          </button>
        </div>
        <div class="btn-row">
          <button class="pix-btn tiny-btn" onclick={() => onLock(!node.locked)}>
            {#if node.locked}
              <Unlock size={10} /> {fm.figUnlock()}
            {:else}
              <Lock size={10} /> {fm.figLock()}
            {/if}
          </button>
          <button class="pix-btn tiny-btn" onclick={() => onHide(!node.hidden)}>
            {#if node.hidden}
              <Eye size={10} /> {fm.figShow()}
            {:else}
              <EyeOff size={10} /> {fm.figHide()}
            {/if}
          </button>
        </div>
        <div class="btn-row">
          <button class="pix-btn tiny-btn" onclick={onDuplicate}>
            <Copy size={10} /> {fm.figDuplicate()}
          </button>
          <button class="pix-btn tiny-btn danger" onclick={onDelete}>
            <Trash2 size={10} /> {fm.figDelete()}
          </button>
        </div>
      </div>
    </details>
  {/if}

  {#if selectedNodes.length > 1}
    <details open>
      <summary><Group size={11} /> {fm.figSelected({ n: selectedNodes.length })}</summary>
      <div class="sec-body">
        <div class="sub-head">{fm.figAlign()}</div>
        <div class="align-grid">
          {#each alignModes as mode (mode)}
            {@const Icon = alignIcon(mode)}
            <button class="pix-btn tiny-btn align-btn" title={fm.figAlign()} onclick={() => onAlign(mode)}>
              <Icon size={12} />
            </button>
          {/each}
        </div>
        <div class="btn-row">
          <button
            class="pix-btn tiny-btn"
            disabled={selectedNodes.length < 3}
            onclick={() => onDistribute('x')}
            title={fm.figAlign()}
          >
            ⇹
          </button>
          <button
            class="pix-btn tiny-btn"
            disabled={selectedNodes.length < 3}
            onclick={() => onDistribute('y')}
            title={fm.figAlign()}
          >
            ⇳
          </button>
          <button class="pix-btn tiny-btn" disabled={selectedNodes.length < 2} onclick={onGroup}>
            <Group size={10} /> {fm.figGroup()}
          </button>
          <button class="pix-btn tiny-btn" disabled={!hasGroup} onclick={onUngroup}>
            <Ungroup size={10} /> {fm.figUngroup()}
          </button>
        </div>
        <div class="btn-row">
          <button class="pix-btn tiny-btn" onclick={() => onLock(!allLocked)}>
            {#if allLocked}
              <Unlock size={10} /> {fm.figUnlock()}
            {:else}
              <Lock size={10} /> {fm.figLock()}
            {/if}
          </button>
          <button class="pix-btn tiny-btn" onclick={() => onHide(!allHidden)}>
            {#if allHidden}
              <Eye size={10} /> {fm.figShow()}
            {:else}
              <EyeOff size={10} /> {fm.figHide()}
            {/if}
          </button>
          <button class="pix-btn tiny-btn" onclick={onDuplicate}>
            <Copy size={10} /> {fm.figDuplicate()}
          </button>
          <button class="pix-btn tiny-btn danger" onclick={onDelete}>
            <Trash2 size={10} /> {fm.figDelete()}
          </button>
        </div>
      </div>
    </details>
  {/if}

  {#if selectedNodes.length === 0}
    <div class="empty-hint">
      <Layers size={20} />
      <p>{fm.figEmptyHint()}</p>
      <p class="pix-dim">{fm.figSelectHint()}</p>
    </div>
  {/if}
</div>

<style>
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    font-size: 10px;
  }
  details {
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  summary {
    cursor: pointer;
    padding: 5px 7px;
    font-weight: bold;
    color: var(--pix-accent-2);
    font-size: 10px;
    display: flex;
    align-items: center;
    gap: 5px;
    list-style: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  .sec-body {
    padding: 6px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .node-name {
    font-size: 9px;
    color: var(--pix-cyan);
    padding: 3px 5px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--pix-fg-dim);
    font-size: 8.5px;
    min-width: 0;
  }
  .field > span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
    padding: 2px 4px;
  }
  .pix-select {
    font-size: 9px;
    padding: 2px 4px;
  }
  textarea.pix-input {
    resize: vertical;
    min-height: 56px;
    line-height: 1.35;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px 7px;
    align-items: end;
  }
  .color-field {
    justify-content: flex-end;
  }
  .pix-color {
    width: 100%;
    height: 24px;
    padding: 0;
    border: 2px solid var(--pix-border-hi);
    background: var(--pix-bg);
    cursor: pointer;
  }
  .pix-color:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--pix-fg);
    font-size: 9px;
    cursor: pointer;
  }
  .sub-head {
    margin-top: 3px;
    padding-top: 5px;
    border-top: 1px dashed var(--pix-border);
    color: var(--pix-accent-2);
    font-size: 9px;
    font-weight: bold;
  }
  .btn-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .pix-btn.tiny-btn {
    padding: 2px 6px;
    font-size: 8.5px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .pix-btn.danger {
    border-color: var(--pix-red);
    color: var(--pix-red);
  }
  .pix-btn.danger:hover {
    background: var(--pix-red);
    color: #210707;
  }
  .align-grid {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 3px;
  }
  .align-btn {
    padding: 3px 0 !important;
    justify-content: center;
  }
  .readout {
    min-height: 24px;
    display: flex;
    align-items: center;
    padding: 2px 5px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
    color: var(--pix-cyan);
    font-size: 9px;
  }
  .asset-preview {
    padding: 5px;
    border: 1px solid var(--pix-border);
    background:
      repeating-conic-gradient(#e9eef5 0% 25%, #ffffff 0% 50%) 50% / 12px 12px;
    display: flex;
    justify-content: center;
  }
  .asset-preview img {
    max-width: 100%;
    max-height: 110px;
    object-fit: contain;
  }
  .meta-row {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 5px;
    font-size: 8.5px;
    color: var(--pix-fg);
    border-bottom: 1px dotted var(--pix-border);
    padding-bottom: 3px;
  }
  .meta-label {
    color: var(--pix-fg-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .source-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--pix-cyan);
    font-size: 8.5px;
    word-break: break-all;
    text-decoration: none;
  }
  .source-link:hover {
    text-decoration: underline;
  }
  .empty-hint {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 22px 10px;
    color: var(--pix-border-hi);
    text-align: center;
  }
  .empty-hint p {
    margin: 0;
    font-size: 9px;
    line-height: 1.5;
    color: var(--pix-fg-dim);
  }
  .pix-dim {
    color: var(--pix-fg-dim);
  }
  .chart-hint,
  .chart-error {
    font-size: 8.5px;
    line-height: 1.4;
  }
  .chart-error {
    color: var(--pix-red);
  }
  .sig-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg);
  }
  .style-actions {
    margin-top: 2px;
  }
</style>
