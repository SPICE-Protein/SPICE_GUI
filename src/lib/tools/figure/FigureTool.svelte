<script lang="ts">
  // Figure Studio orchestrator: document lifecycle, undo history, project
  // write-back, export pipeline and the editor shell.
  import { onDestroy, onMount, tick } from 'svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { backend } from '$lib/backend/api';
  import { projectStore } from '$lib/project/store.svelte.ts';
  import { saveReproBundle, type ReproFile } from '$lib/repro/bundle';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import ToolProjectBar from '$lib/tools/shared/ToolProjectBar.svelte';
  import {
    ensureProjectLoaded,
    finishToolCapture,
    takeToolHandoff
  } from '$lib/tools/shared/projectBridge';
  import { bytesToDataUrl } from '$lib/tools/shared/canvas';
  import {
    BarChart3,
    Circle,
    Copy,
    Download,
    FileDown,
    FilePlus,
    FileInput,
    FileText,
    FolderOpen,
    Group as GroupIcon,
    Hand,
    ImagePlus,
    LayoutTemplate,
    Maximize,
    Minus,
    MousePointer2,
    MoveUpRight,
    Package,
    Redo2,
    Ruler,
    Save,
    Shapes,
    ShieldCheck,
    Square,
    Trash2,
    Type,
    Undo2,
    Ungroup,
    ZoomIn,
    ZoomOut
  } from 'lucide-svelte';
  import FigureCanvas, { type FigureToolId } from './FigureCanvas.svelte';
  import FigureInspector from './FigureInspector.svelte';
  import FigureLayers from './FigureLayers.svelte';
  import FigureAssetPanel from './FigureAssetPanel.svelte';
  import FigureImportDialog from './FigureImportDialog.svelte';
  import FigureCheckDialog from './FigureCheckDialog.svelte';
  import { fm } from './messages';
  import {
    alignRects,
    distributeRects,
    groupSelection,
    moveNodes,
    ungroupSelection,
    zoomToFit,
    type AlignMode
  } from './geometry';
  import { figureDocumentJson, parseFigureDocumentText } from './normalize';
  import {
    citationMarkdown,
    exportPdfFile,
    exportPngFile,
    exportPptxFile,
    exportSvgFile,
    exportTiffFile,
    figureFileBase,
    type ExportedFile
  } from './exporters';
  import { renderThumbnail, isNodeVisible, type ResolvedAsset, type ResolvedAssets } from './render';
  import {
    FIGURE_PRESETS,
    clamp,
    createAssetNode,
    createChartNode,
    createEllipseNode,
    createFigureDocument,
    createFigureId,
    createImageNode,
    createLineNode,
    createRectNode,
    createScaleBarNode,
    createTextNode,
    documentHeightPx,
    documentWidthPx,
    pxToMm,
    CHART_PALETTE,
    type AssetManifestEntry,
    type AssetNode,
    type FigureDocument,
    type FigureNode
  } from './types';
  import { FIGURE_TEMPLATES, applyFigureTemplate } from './templates';
  import {
    figureDocName,
    figureMethods,
    figureParameters,
    figureSummary,
    normalizeFigurePayload,
    standaloneFigureName
  } from './projectDoc';
  import { assetById, assetDataUrl, loadAssetManifest } from './assets';
  import { takeFigurePanel } from '$lib/tools/shared/figureBridge';
  import {
    placeVectorImport,
    type VectorImportResult
  } from './importVector';
  import {
    checkFigure,
    complianceCounts,
    type ComplianceIssue
  } from './compliance';
  import {
    registerFigureCommandHandler,
    type FigureAgentCommand
  } from './figureAgent';
  import { aiState } from '$lib/ui/aiState.svelte.ts';

  type SidebarTab = 'inspector' | 'layers' | 'assets' | 'templates';
  type BusyKind =
    | 'idle'
    | 'svg'
    | 'png'
    | 'tiff'
    | 'pptx'
    | 'pdf'
    | 'citations'
    | 'repro'
    | 'save';

  const DRAFT_KEY = 'spice_figure_v1';
  const HISTORY_LIMIT = 80;

  let doc = $state<FigureDocument>(createFigureDocument());
  let ready = $state(false);
  let selectedIds = $state<string[]>([]);
  let tool = $state<FigureToolId>('select');
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let viewport = $state({ w: 0, h: 0 });
  let sidebarTab = $state<SidebarTab>('inspector');
  let textFocusToken = $state(0);
  let busy = $state<BusyKind>('idle');
  let exportOpen = $state(false);
  let newOpen = $state(false);
  let savedJson = $state('');
  let undoStack = $state.raw<FigureDocument[]>([]);
  let redoStack = $state.raw<FigureDocument[]>([]);
  let nodeClipboard = $state.raw<FigureNode[]>([]);
  let styleClipboard = $state.raw<FigureNode | null>(null);
  let importOpen = $state(false);
  let checkOpen = $state(false);
  let checkBusy = $state(false);
  let checkIssues = $state.raw<ComplianceIssue[]>([]);
  let checkCounts = $state({ errors: 0, warns: 0, infos: 0, total: 0 });
  let unregisterFigureCommands: (() => void) | null = null;
  let aiUndoOwned: (() => void) | null = null;
  let aiUndoPrevious: (() => void) | null = null;

  let fileInput = $state<HTMLInputElement | null>(null);
  let imageInput = $state<HTMLInputElement | null>(null);

  let gestureBefore: FigureDocument | null = null;
  let projectTimer: ReturnType<typeof setTimeout> | null = null;
  let draftTimer: ReturnType<typeof setTimeout> | null = null;
  let skipProjectCommit = false;
  let fitted = false;
  let userZoomed = false;
  const assetCache = new Map<string, ResolvedAsset>();

  const docJson = $derived(JSON.stringify($state.snapshot(doc)));
  const dirty = $derived(ready && docJson !== savedJson);
  const canUndo = $derived(undoStack.length > 0);
  const canRedo = $derived(redoStack.length > 0);
  const busyAny = $derived(busy !== 'idle');
  const selectedNodes = $derived(doc.nodes.filter((node) => selectedIds.includes(node.id)));

  const toolDefs: { id: FigureToolId; test: string; icon: typeof Square }[] = [
    { id: 'select', test: 'figure-tool-select', icon: MousePointer2 },
    { id: 'rect', test: 'figure-tool-rect', icon: Square },
    { id: 'ellipse', test: 'figure-tool-ellipse', icon: Circle },
    { id: 'line', test: 'figure-tool-line', icon: Minus },
    { id: 'arrow', test: 'figure-tool-arrow', icon: MoveUpRight },
    { id: 'text', test: 'figure-tool-text', icon: Type },
    { id: 'pan', test: 'figure-tool-pan', icon: Hand }
  ];

  function toolLabel(id: FigureToolId): string {
    switch (id) {
      case 'select':
        return fm.figSelect();
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
      case 'pan':
        return fm.figPan();
    }
  }

  function templateText(key: string): string {
    const table = fm as unknown as Record<string, (() => string) | undefined>;
    return table[key]?.() ?? key;
  }

  // ------------------------------------------------------------ snapshots

  function snapshotDoc(): FigureDocument {
    return $state.snapshot(doc) as FigureDocument;
  }

  function readDraft(): FigureDocument | null {
    try {
      const text = localStorage.getItem(DRAFT_KEY);
      return text ? parseFigureDocumentText(text) : null;
    } catch {
      return null;
    }
  }

  function writeDraft(json: string) {
    try {
      localStorage.setItem(DRAFT_KEY, json);
    } catch {
      /* storage may be unavailable or full; the in-memory document still works */
    }
  }

  function pushHistory(before: FigureDocument) {
    if (JSON.stringify(before) === docJson) return;
    undoStack = [...undoStack, before].slice(-HISTORY_LIMIT);
    redoStack = [];
  }

  function beginGesture() {
    if (!gestureBefore) gestureBefore = snapshotDoc();
  }

  function endGesture() {
    const before = gestureBefore;
    gestureBefore = null;
    if (before) pushHistory(before);
  }

  function withCommit(mutate: () => void) {
    const before = snapshotDoc();
    mutate();
    pushHistory(before);
  }

  function resetHistory() {
    undoStack = [];
    redoStack = [];
    gestureBefore = null;
  }

  function filterSelection() {
    const ids = new Set(doc.nodes.map((node) => node.id));
    selectedIds = selectedIds.filter((id) => ids.has(id));
  }

  function undo() {
    if (!undoStack.length) return;
    const current = snapshotDoc();
    const previous = undoStack[undoStack.length - 1];
    undoStack = undoStack.slice(0, -1);
    redoStack = [...redoStack, current].slice(-HISTORY_LIMIT);
    doc = previous;
    gestureBefore = null;
    filterSelection();
  }

  function redo() {
    if (!redoStack.length) return;
    const current = snapshotDoc();
    const next = redoStack[redoStack.length - 1];
    redoStack = redoStack.slice(0, -1);
    undoStack = [...undoStack, current].slice(-HISTORY_LIMIT);
    doc = next;
    gestureBefore = null;
    filterSelection();
  }

  // ------------------------------------------------------------ viewport

  function fitView() {
    const result = zoomToFit(
      documentWidthPx(doc),
      documentHeightPx(doc),
      Math.max(1, viewport.w),
      Math.max(1, viewport.h),
      44
    );
    zoom = result.scale;
    pan = { x: result.offsetX, y: result.offsetY };
    fitted = true;
  }

  async function requestFit() {
    userZoomed = false;
    await tick();
    fitView();
  }

  function zoomAt(next: number, screenX: number, screenY: number) {
    const target = clamp(next, 0.05, 8);
    const docX = (screenX - pan.x) / Math.max(0.0001, zoom);
    const docY = (screenY - pan.y) / Math.max(0.0001, zoom);
    zoom = target;
    pan = { x: screenX - docX * target, y: screenY - docY * target };
    userZoomed = true;
  }

  function zoomBy(factor: number) {
    zoomAt(zoom * factor, viewport.w / 2, viewport.h / 2);
  }

  function actualSize() {
    zoomAt(1, viewport.w / 2, viewport.h / 2);
  }

  function fitToolbar() {
    fitView();
    userZoomed = false;
  }

  // ---------------------------------------------------------- selection

  function selectNodes(ids: string[], additive = false) {
    if (!additive) {
      selectedIds = selectionWithGroupsLocal(ids);
      return;
    }
    const next = new Set(selectedIds);
    for (const id of ids) {
      const expanded = selectionWithGroupsLocal([id]);
      const allSelected = expanded.every((member) => next.has(member));
      for (const member of expanded) {
        if (allSelected) next.delete(member);
        else next.add(member);
      }
    }
    selectedIds = [...next];
  }

  function selectionWithGroupsLocal(ids: string[]): string[] {
    const selected = new Set(ids);
    const groupIds = new Set<string>();
    for (const node of doc.nodes) {
      if (selected.has(node.id) && node.groupId) groupIds.add(node.groupId);
    }
    for (const node of doc.nodes) {
      if (node.groupId && groupIds.has(node.groupId)) selected.add(node.id);
    }
    return [...selected];
  }

  function selectGroup(groupId: string) {
    selectedIds = doc.nodes.filter((node) => node.groupId === groupId).map((node) => node.id);
  }

  function selectAll() {
    selectedIds = doc.nodes.filter((node) => isNodeVisible(doc, node)).map((node) => node.id);
  }

  // ---------------------------------------------------- document actions

  function adoptDocument(next: FigureDocument, clean: boolean) {
    doc = next;
    selectedIds = [];
    tool = 'select';
    resetHistory();
    if (clean) savedJson = JSON.stringify($state.snapshot(doc));
    void requestFit();
  }

  function adoptDraft() {
    const stored = readDraft();
    const next = stored ?? applyFigureTemplate('single-column');
    doc = next;
    selectedIds = [];
    tool = 'select';
    resetHistory();
    savedJson = JSON.stringify($state.snapshot(doc));
  }

  function confirmDiscard(): boolean {
    return !dirty || confirm(fm.figUnsaved());
  }

  function newDocument(presetId: string) {
    if (!confirmDiscard()) return;
    const preset = FIGURE_PRESETS.find((candidate) => candidate.id === presetId) ?? FIGURE_PRESETS[0];
    doc = createFigureDocument('Figure', preset.widthMm, preset.heightMm);
    selectedIds = [];
    tool = 'select';
    sidebarTab = 'inspector';
    newOpen = false;
    savedJson = '';
    resetHistory();
    void requestFit();
  }

  function applyTemplate(id: string) {
    if (!confirmDiscard()) return;
    withCommit(() => {
      doc = applyFigureTemplate(id);
    });
    selectedIds = [];
    tool = 'select';
    void requestFit();
  }

  function onOpenFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseFigureDocumentText(String(reader.result ?? ''));
      if (!parsed) {
        pushToast('error', fm.figInvalidFile());
        return;
      }
      if (!confirmDiscard()) return;
      adoptDocument(parsed, true);
    };
    reader.onerror = () => pushToast('error', fm.figInvalidFile());
    reader.readAsText(file);
  }

  // ---------------------------------------------------------- node actions

  function insertNode(node: FigureNode) {
    doc.nodes = [...doc.nodes, node];
    selectedIds = [node.id];
    sidebarTab = 'inspector';
  }

  function addShape(kind: 'rect' | 'ellipse' | 'line' | 'arrow' | 'text') {
    const pageW = documentWidthPx(doc);
    const pageH = documentHeightPx(doc);
    const cx = pageW / 2;
    const cy = pageH / 2;
    let node: FigureNode;
    switch (kind) {
      case 'rect':
        node = createRectNode(cx - 80, cy - 45, 160, 90);
        node.name = fm.figRect();
        break;
      case 'ellipse':
        node = createEllipseNode(cx - 60, cy - 40, 120, 80);
        node.name = fm.figEllipse();
        break;
      case 'line':
        node = createLineNode(cx - 80, cy - 20, 160, 40, false);
        node.name = fm.figLine();
        break;
      case 'arrow':
        node = createLineNode(cx - 80, cy - 20, 160, 40, true);
        node.name = fm.figArrow();
        break;
      case 'text':
        node = createTextNode(cx - 90, cy - 24, fm.figTextTool());
        break;
    }
    withCommit(() => {
      doc.nodes = [...doc.nodes, node];
    });
    selectedIds = [node.id];
    tool = 'select';
    sidebarTab = 'inspector';
  }

  function addChart() {
    const pageW = documentWidthPx(doc);
    const pageH = documentHeightPx(doc);
    const width = Math.min(360, Math.max(220, pageW * 0.55));
    const height = Math.min(260, Math.max(170, pageH * 0.45));
    const node = createChartNode((pageW - width) / 2, (pageH - height) / 2, width, height);
    node.name = fm.figChart();
    withCommit(() => {
      doc.nodes = [...doc.nodes, node];
    });
    selectedIds = [node.id];
    sidebarTab = 'inspector';
  }

  function addScaleBar() {
    const pageW = documentWidthPx(doc);
    const pageH = documentHeightPx(doc);
    const node = createScaleBarNode((pageW - 120) / 2, pageH - 64, 120, 38);
    node.name = fm.figScaleBar();
    withCommit(() => {
      doc.nodes = [...doc.nodes, node];
    });
    selectedIds = [node.id];
    sidebarTab = 'inspector';
  }

  function insertPendingPanel() {
    const pending = takeFigurePanel();
    if (!pending) return;
    const pageW = documentWidthPx(doc);
    const pageH = documentHeightPx(doc);
    const scale = Math.min(1, (pageW * 0.6) / pending.width, (pageH * 0.6) / pending.height);
    const width = Math.max(20, pending.width * scale);
    const height = Math.max(20, pending.height * scale);
    const node = createImageNode(
      pending.dataUrl,
      'image/png',
      (pageW - width) / 2,
      (pageH - height) / 2,
      width,
      height
    );
    node.name = pending.name;
    node.lockAspect = true;
    withCommit(() => {
      doc.nodes = [...doc.nodes, node];
    });
    selectedIds = [node.id];
    sidebarTab = 'inspector';
    // The insert is a real document change, so let the project commit effect
    // run even when the mount itself was restoring a project document.
    skipProjectCommit = false;
    pushToast('success', fm.figPanelAdded({ name: pending.name }));
  }

  function handleVectorImport(result: VectorImportResult, mode: 'insert' | 'new') {
    if (mode === 'new') {
      if (!confirmDiscard()) return;
      const widthMm = clamp(pxToMm(result.width) + 16, 40, 2000);
      const heightMm = clamp(pxToMm(result.height) + 16, 40, 2000);
      const next = createFigureDocument('Imported diagram', widthMm, heightMm);
      const placed = placeVectorImport(
        result,
        documentWidthPx(next),
        documentHeightPx(next),
      );
      next.nodes = placed.nodes;
      next.groups = placed.groups;
      adoptDocument(next, false);
    } else {
      withCommit(() => {
        const placed = placeVectorImport(
          result,
          documentWidthPx(doc),
          documentHeightPx(doc),
        );
        doc.nodes = [...doc.nodes, ...placed.nodes];
        doc.groups = [...doc.groups, ...placed.groups];
        selectedIds = placed.nodes.map((node) => node.id);
      });
    }
    sidebarTab = 'inspector';
    void requestFit();
    pushToast(
      'success',
      fm.figImportVectorTitle(),
      result.warnings.length ? fm.figImportWarnings({ n: result.warnings.length }) : undefined,
    );
  }

  function imagePixelSize(url: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const image = new Image();
      let settled = false;
      const finish = (value: { width: number; height: number } | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => finish(null);
      setTimeout(() => finish(null), 5000);
      image.src = url;
    });
  }

  async function runPublicationCheck() {
    checkOpen = true;
    checkBusy = true;
    try {
      const current = snapshotDoc();
      const sizes = new Map<string, { width: number; height: number }>();
      await Promise.all(
        current.nodes.map(async (node) => {
          if (node.type !== 'image' || !node.dataUrl) return;
          const size = await imagePixelSize(node.dataUrl);
          if (size) sizes.set(node.id, size);
        }),
      );
      checkIssues = checkFigure(current, sizes);
      checkCounts = complianceCounts(checkIssues);
    } finally {
      checkBusy = false;
    }
  }

  function installFigureAgent() {
    unregisterFigureCommands?.();
    unregisterFigureCommands = registerFigureCommandHandler((command: FigureAgentCommand) => {
      if (command.type !== 'add-chart') return;
      const spec = command.spec;
      const pageW = documentWidthPx(doc);
      const pageH = documentHeightPx(doc);
      const width = Math.min(360, Math.max(220, pageW * 0.55));
      const height = Math.min(260, Math.max(170, pageH * 0.45));
      const node = createChartNode((pageW - width) / 2, (pageH - height) / 2, width, height);
      node.name = spec.name;
      node.chartType = spec.chartType;
      node.labels = [...spec.labels];
      node.series = spec.series.map((entry, index) => ({
        id: createFigureId('series'),
        name: entry.name,
        color: entry.color ?? CHART_PALETTE[index % CHART_PALETTE.length],
        values: [...entry.values],
        errors: entry.errors
          ? [...entry.errors]
          : (new Array(spec.labels.length).fill(0) as number[])
      }));
      node.xLabel = spec.xLabel ?? '';
      node.yLabel = spec.yLabel ?? '';
      withCommit(() => {
        doc.nodes = [...doc.nodes, node];
      });
      selectedIds = [node.id];
      tool = 'select';
      sidebarTab = 'inspector';
    });
  }

  function addNodeFromCanvas(node: FigureNode, keepTool: boolean) {
    doc.nodes = [...doc.nodes, node];
    selectedIds = [node.id];
    if (!keepTool) tool = 'select';
    sidebarTab = 'inspector';
  }

  function groupLocked(node: FigureNode): boolean {
    if (!node.groupId) return false;
    return !!doc.groups.find((group) => group.id === node.groupId)?.locked;
  }

  function duplicateSelected() {
    const source = selectedNodes;
    if (!source.length) return;
    withCommit(() => {
      const groupMap = new Map<string, string>();
      for (const node of source) {
        if (!node.groupId || groupMap.has(node.groupId)) continue;
        const original = doc.groups.find((group) => group.id === node.groupId);
        const id = createFigureId('grp');
        groupMap.set(node.groupId, id);
        doc.groups.push({
          id,
          name: original?.name ?? fm.figGroup(),
          hidden: original?.hidden ?? false,
          locked: original?.locked ?? false
        });
      }
      const clones = source.map((node) => {
        const copy = {
          ...node,
          id: createFigureId('node'),
          x: node.x + 10,
          y: node.y + 10
        } as FigureNode;
        if (node.groupId) copy.groupId = groupMap.get(node.groupId);
        return copy;
      });
      doc.nodes = [...doc.nodes, ...clones];
      selectedIds = clones.map((clone) => clone.id);
    });
  }

  function copySelected() {
    if (!selectedNodes.length) return;
    nodeClipboard = $state.snapshot(selectedNodes) as FigureNode[];
  }

  function pasteClipboard() {
    if (!nodeClipboard.length) return;
    withCommit(() => {
      const groupMap = new Map<string, string>();
      for (const node of nodeClipboard) {
        if (!node.groupId || groupMap.has(node.groupId)) continue;
        const original = doc.groups.find((group) => group.id === node.groupId);
        const id = createFigureId('grp');
        groupMap.set(node.groupId, id);
        doc.groups.push({
          id,
          name: original?.name ?? fm.figGroup(),
          hidden: original?.hidden ?? false,
          locked: original?.locked ?? false
        });
      }
      const clones = nodeClipboard.map((node) => {
        const copy = {
          ...node,
          id: createFigureId('node'),
          x: node.x + 12,
          y: node.y + 12
        } as FigureNode;
        if (node.groupId) copy.groupId = groupMap.get(node.groupId);
        return copy;
      });
      doc.nodes = [...doc.nodes, ...clones];
      selectedIds = clones.map((clone) => clone.id);
    });
  }

  function copyStyle() {
    const source = selectedNodes[0];
    if (!source) return;
    styleClipboard = $state.snapshot(source) as FigureNode;
    pushToast('info', fm.figCopyStyle());
  }

  function pasteStyle() {
    const style = styleClipboard;
    if (!style || !selectedIds.length) return;
    const ids = new Set(selectedIds);
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => {
        if (!ids.has(node.id)) return node;
        const next: FigureNode = {
          ...node,
          fill: style.fill,
          stroke: style.stroke,
          strokeWidth: style.strokeWidth,
          dash: style.dash,
          cornerRadius: style.cornerRadius,
          opacity: style.opacity
        };
        if (next.type === 'text' && style.type === 'text') {
          next.fontFamily = style.fontFamily;
          next.fontSize = style.fontSize;
          next.fontWeight = style.fontWeight;
          next.italic = style.italic;
          next.align = style.align;
          next.lineHeight = style.lineHeight;
          next.color = style.color;
          next.background = style.background;
        } else if (next.type === 'chart' && style.type === 'chart') {
          next.fontFamily = style.fontFamily;
          next.fontSize = style.fontSize;
          next.textColor = style.textColor;
          next.plotBackground = style.plotBackground;
        } else if (next.type === 'scalebar' && style.type === 'scalebar') {
          next.fontFamily = style.fontFamily;
          next.fontSize = style.fontSize;
          next.textColor = style.textColor;
          next.thickness = style.thickness;
          next.ticks = style.ticks;
        }
        return next;
      });
    });
    pushToast('info', fm.figPasteStyle());
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    withCommit(() => {
      const ids = new Set(selectedIds);
      doc.nodes = doc.nodes.filter((node) => !ids.has(node.id));
      doc.groups = doc.groups.filter((group) =>
        doc.nodes.some((node) => node.groupId === group.id)
      );
      selectedIds = [];
    });
  }

  function groupSelected() {
    if (selectedIds.length < 2) return;
    withCommit(() => {
      const id = createFigureId('grp');
      doc.groups.push({
        id,
        name: `${fm.figGroup()} ${doc.groups.length + 1}`,
        hidden: false,
        locked: false
      });
      doc.nodes = groupSelection(doc.nodes, selectedIds, id);
    });
  }

  function ungroupSelected() {
    const ids = new Set(
      selectedNodes.map((node) => node.groupId).filter((id): id is string => !!id)
    );
    if (!ids.size) return;
    withCommit(() => {
      for (const id of ids) doc.nodes = ungroupSelection(doc.nodes, id);
      doc.groups = doc.groups.filter((group) => !ids.has(group.id));
    });
  }

  function alignSelected(mode: AlignMode) {
    if (selectedIds.length < 2) return;
    const items = selectedNodes.map((node) => ({
      id: node.id,
      rect: { x: node.x, y: node.y, w: node.w, h: node.h }
    }));
    const moves = alignRects(items, mode);
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => {
        const move = moves[node.id];
        return move ? { ...node, x: move.x, y: move.y } : node;
      });
    });
  }

  function distributeSelected(axis: 'x' | 'y') {
    if (selectedIds.length < 3) return;
    const items = selectedNodes.map((node) => ({
      id: node.id,
      rect: { x: node.x, y: node.y, w: node.w, h: node.h }
    }));
    const moves = distributeRects(items, axis);
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => {
        const move = moves[node.id];
        return move ? { ...node, x: move.x, y: move.y } : node;
      });
    });
  }

  function zOrder(order: 'up' | 'down' | 'front' | 'back') {
    if (!selectedIds.length) return;
    const selected = new Set(selectedIds);
    withCommit(() => {
      let nodes = [...doc.nodes];
      if (order === 'front') {
        nodes = [
          ...nodes.filter((node) => !selected.has(node.id)),
          ...nodes.filter((node) => selected.has(node.id))
        ];
      } else if (order === 'back') {
        nodes = [
          ...nodes.filter((node) => selected.has(node.id)),
          ...nodes.filter((node) => !selected.has(node.id))
        ];
      } else if (order === 'up') {
        for (let index = nodes.length - 2; index >= 0; index -= 1) {
          if (selected.has(nodes[index].id) && !selected.has(nodes[index + 1].id)) {
            [nodes[index], nodes[index + 1]] = [nodes[index + 1], nodes[index]];
          }
        }
      } else {
        for (let index = 1; index < nodes.length; index += 1) {
          if (selected.has(nodes[index].id) && !selected.has(nodes[index - 1].id)) {
            [nodes[index], nodes[index - 1]] = [nodes[index - 1], nodes[index]];
          }
        }
      }
      doc.nodes = nodes;
    });
  }

  function moveLayerZ(id: string, delta: number) {
    const index = doc.nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    const target = index + delta;
    if (target < 0 || target >= doc.nodes.length) return;
    withCommit(() => {
      const nodes = [...doc.nodes];
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
      doc.nodes = nodes;
    });
  }

  function setSelectedLocked(locked: boolean) {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => (ids.has(node.id) ? { ...node, locked } : node));
    });
  }

  function setSelectedHidden(hidden: boolean) {
    if (!selectedIds.length) return;
    const ids = new Set(selectedIds);
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => (ids.has(node.id) ? { ...node, hidden } : node));
    });
  }

  function toggleNodeLocked(id: string, locked: boolean) {
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => (node.id === id ? { ...node, locked } : node));
    });
  }

  function toggleNodeHidden(id: string, hidden: boolean) {
    withCommit(() => {
      doc.nodes = doc.nodes.map((node) => (node.id === id ? { ...node, hidden } : node));
    });
  }

  function toggleGroupHidden(groupId: string, hidden: boolean) {
    withCommit(() => {
      doc.groups = doc.groups.map((group) => (group.id === groupId ? { ...group, hidden } : group));
    });
  }

  function toggleGroupLocked(groupId: string, locked: boolean) {
    withCommit(() => {
      doc.groups = doc.groups.map((group) => (group.id === groupId ? { ...group, locked } : group));
    });
  }

  function nudgeSelected(dx: number, dy: number) {
    if (!selectedIds.length) return;
    const beforeNodes = doc.nodes;
    const blocked = new Set(
      beforeNodes.filter((node) => node.locked || node.hidden || groupLocked(node)).map((node) => node.id)
    );
    const moved = moveNodes(beforeNodes, selectedIds, dx, dy);
    withCommit(() => {
      doc.nodes = moved.map((node, index) => (blocked.has(node.id) ? beforeNodes[index] : node));
    });
  }

  function editText(id: string) {
    selectedIds = [id];
    sidebarTab = 'inspector';
    textFocusToken += 1;
  }

  // ------------------------------------------------------------- assets

  function insertAsset(asset: AssetManifestEntry) {
    const pageW = documentWidthPx(doc);
    const pageH = documentHeightPx(doc);
    const node = createAssetNode(asset, 0, 0, 140);
    node.x = (pageW - node.w) / 2;
    node.y = (pageH - node.h) / 2;
    withCommit(() => {
      doc.nodes = [...doc.nodes, node];
    });
    selectedIds = [node.id];
  }

  async function fetchAssetData(path: string): Promise<string> {
    const response = await fetch(path);
    if (!response.ok) throw new Error(path);
    const text = await response.text();
    return bytesToDataUrl(new TextEncoder().encode(text), 'image/svg+xml');
  }

  async function resolveAssetsFor(current: FigureDocument): Promise<ResolvedAssets> {
    const out: ResolvedAssets = new Map();
    const nodes = current.nodes.filter((node): node is AssetNode => node.type === 'asset');
    if (!nodes.length) return out;
    let manifest = null;
    try {
      manifest = await loadAssetManifest();
    } catch {
      manifest = null;
    }
    for (const node of nodes) {
      if (out.has(node.assetId)) continue;
      let resolved = assetCache.get(node.assetId);
      if (!resolved) {
        try {
          const entry = manifest ? assetById(manifest, node.assetId) : null;
          let dataUrl: string | null = null;
          if (entry) {
            try {
              dataUrl = await assetDataUrl(entry);
            } catch {
              dataUrl = null;
            }
          }
          if (!dataUrl) dataUrl = await fetchAssetData(node.svgFile);
          if (dataUrl) {
            resolved = { dataUrl, width: node.w, height: node.h };
            assetCache.set(node.assetId, resolved);
          }
        } catch {
          resolved = undefined;
        }
      }
      if (resolved) out.set(node.assetId, resolved);
    }
    return out;
  }

  async function previewFigure(current: FigureDocument): Promise<string | null> {
    try {
      const assets = await resolveAssetsFor(current);
      return await renderThumbnail(current, assets, 480);
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ lifecycle

  $effect(() => {
    if (!ready) return;
    const json = docJson;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = null;
      writeDraft(json);
    }, 500);
  });

  $effect(() => {
    if (!ready) return;
    const json = docJson;
    if (projectStore.activeDocKind !== 'figure') return;
    if (skipProjectCommit) {
      skipProjectCommit = false;
      return;
    }
    if (projectTimer) clearTimeout(projectTimer);
    projectTimer = setTimeout(() => {
      projectTimer = null;
      projectStore.commitDoc('figure', JSON.parse(json) as unknown);
    }, 400);
  });

  $effect(() => {
    if (!ready) return;
    const size = viewport;
    if (size.w < 2 || size.h < 2) return;
    if (!fitted || !userZoomed) fitView();
  });

  onMount(() => {
    ensureProjectLoaded();
    const handoff = takeToolHandoff('figure');
    let capture = false;
    if (handoff?.type === 'open') {
      const opened = normalizeFigurePayload(handoff.payload);
      if (opened) {
        skipProjectCommit = true;
        doc = opened;
        selectedIds = [];
        resetHistory();
        savedJson = JSON.stringify($state.snapshot(doc));
      } else {
        pushToast('error', fm.figInvalidFile());
        adoptDraft();
      }
    } else {
      adoptDraft();
    }
    if (projectStore.activeDocKind === 'figure') skipProjectCommit = true;
    capture = handoff?.type === 'capture';
    ready = true;
    insertPendingPanel();
    installFigureAgent();
    aiUndoPrevious = aiState.onUndoAiChange;
    aiUndoOwned = () => undo();
    aiState.onUndoAiChange = aiUndoOwned;
    window.addEventListener('beforeunload', flushDraft);
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (capture) void captureToProject();
  });

  onDestroy(() => {
    if (projectTimer) clearTimeout(projectTimer);
    if (draftTimer) clearTimeout(draftTimer);
    unregisterFigureCommands?.();
    unregisterFigureCommands = null;
    if (aiUndoOwned && aiState.onUndoAiChange === aiUndoOwned) {
      aiState.onUndoAiChange = aiUndoPrevious;
    }
    window.removeEventListener('beforeunload', flushDraft);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  function flushDraft() {
    if (!ready) return;
    writeDraft(docJson);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushDraft();
  }

  async function captureToProject() {
    const current = snapshotDoc();
    const preview = await previewFigure(current);
    finishToolCapture(
      'figure',
      figureDocName(current),
      current,
      preview ?? undefined,
      figureSummary(current)
    );
  }

  // -------------------------------------------------------------- exports

  async function saveFile(file: ExportedFile): Promise<boolean> {
    try {
      const result = await backend.saveExport(file.name, file.bytes);
      if (result.data?.saved) {
        pushToast('success', fm.figExportDone(), result.data.path);
        return true;
      }
      if (result.error) pushToast('error', fm.figExportFailed(), result.error);
      else pushToast('info', m.projectSaveCanceled());
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    }
    return false;
  }

  async function saveText(name: string, text: string): Promise<boolean> {
    try {
      const result = await backend.saveExport(name, text);
      if (result.data?.saved) {
        pushToast('success', fm.figExportDone(), result.data.path);
        return true;
      }
      if (result.error) pushToast('error', fm.figExportFailed(), result.error);
      else pushToast('info', m.projectSaveCanceled());
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    }
    return false;
  }

  async function exportSvg() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'svg';
    try {
      const current = snapshotDoc();
      const assets = await resolveAssetsFor(current);
      await saveFile(exportSvgFile(current, assets));
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportPng() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'png';
    try {
      const current = snapshotDoc();
      const assets = await resolveAssetsFor(current);
      await saveFile(await exportPngFile(current, assets, 300));
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportPptx() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'pptx';
    try {
      const current = snapshotDoc();
      const assets = await resolveAssetsFor(current);
      await saveFile(await exportPptxFile(current, assets));
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportPdf() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'pdf';
    try {
      const current = snapshotDoc();
      const assets = await resolveAssetsFor(current);
      await saveFile(await exportPdfFile(current, assets, 300));
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportTiff() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'tiff';
    try {
      const current = snapshotDoc();
      const assets = await resolveAssetsFor(current);
      await saveFile(await exportTiffFile(current, assets, 300));
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportCitations() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'citations';
    try {
      const current = snapshotDoc();
      const base = figureFileBase(current).replace(/\.spicefig$/i, '');
      await saveText(`${base}-citations.md`, citationMarkdown(current));
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function exportRepro() {
    if (busyAny) return;
    exportOpen = false;
    busy = 'repro';
    try {
      const current = snapshotDoc();
      const assets = await resolveAssetsFor(current);
      const svg = exportSvgFile(current, assets);
      const png = await exportPngFile(current, assets, 300);
      const base = figureFileBase(current).replace(/\.spicefig$/i, '');
      const files: ReproFile[] = [
        { name: svg.name, mime: svg.mime, data: svg.bytes },
        { name: png.name, mime: png.mime, data: png.bytes },
        { name: `${base}-citations.md`, mime: 'text/markdown', data: citationMarkdown(current) }
      ];
      const result = await saveReproBundle({
        tool: 'Figure Studio',
        title: figureDocName(current),
        files,
        parameters: figureParameters(current),
        methods: figureMethods(current),
        project: current
      });
      if (result.ok) pushToast('success', fm.figExportDone(), result.path);
      else if (result.canceled) pushToast('info', m.projectSaveCanceled());
      else pushToast('error', fm.figExportFailed(), result.error);
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  async function saveStandalone(saveAs = false) {
    if (busyAny) return;
    if (saveAs) {
      const next = prompt(fm.figFigureName(), doc.name);
      if (next === null) return;
      const trimmed = next.trim();
      if (trimmed && trimmed !== doc.name) {
        withCommit(() => {
          doc.name = trimmed;
        });
      }
    }
    busy = 'save';
    try {
      const current = snapshotDoc();
      const result = await backend.saveExport(standaloneFigureName(current), figureDocumentJson(current));
      if (result.data?.saved) {
        savedJson = JSON.stringify(current);
        pushToast('success', fm.figSaved(), result.data.path);
      } else if (result.error) {
        pushToast('error', fm.figExportFailed(), result.error);
      } else {
        pushToast('info', m.projectSaveCanceled());
      }
    } catch (error) {
      pushToast('error', fm.figExportFailed(), error instanceof Error ? error.message : String(error));
    } finally {
      busy = 'idle';
    }
  }

  // ------------------------------------------------------------- keyboard

  function isEditableTarget(target: EventTarget | null): boolean {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return (
      element.tagName === 'INPUT' ||
      element.tagName === 'TEXTAREA' ||
      element.tagName === 'SELECT' ||
      element.isContentEditable
    );
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isEditableTarget(event.target)) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === 'y') {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === 'a') {
      event.preventDefault();
      selectAll();
      return;
    }
    if (mod && event.altKey && key === 'c') {
      event.preventDefault();
      copyStyle();
      return;
    }
    if (mod && event.altKey && key === 'v') {
      event.preventDefault();
      pasteStyle();
      return;
    }
    if (mod && key === 'c') {
      event.preventDefault();
      copySelected();
      return;
    }
    if (mod && key === 'v') {
      event.preventDefault();
      pasteClipboard();
      return;
    }
    if (mod && key === 'x') {
      event.preventDefault();
      copySelected();
      deleteSelected();
      return;
    }
    if (mod && key === 'd') {
      event.preventDefault();
      duplicateSelected();
      return;
    }
    if (mod && key === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroupSelected();
      else groupSelected();
      return;
    }
    if (mod && key === 's') {
      event.preventDefault();
      if (!busyAny) void saveStandalone(event.shiftKey);
      return;
    }
    if (mod && (key === '0' || event.code === 'Digit0')) {
      event.preventDefault();
      fitToolbar();
      return;
    }
    if (mod && (key === '=' || key === '+')) {
      event.preventDefault();
      zoomBy(1.2);
      return;
    }
    if (mod && key === '-') {
      event.preventDefault();
      zoomBy(1 / 1.2);
      return;
    }
    if (!mod && !event.altKey) {
      const toolKeys: Record<string, FigureToolId> = {
        v: 'select',
        r: 'rect',
        o: 'ellipse',
        l: 'line',
        a: 'arrow',
        t: 'text',
        h: 'pan'
      };
      const nextTool = toolKeys[key];
      if (nextTool) {
        event.preventDefault();
        tool = nextTool;
        return;
      }
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedIds.length) {
        event.preventDefault();
        deleteSelected();
      }
      return;
    }
    if (event.key === 'Escape') {
      exportOpen = false;
      newOpen = false;
      selectedIds = [];
      tool = 'select';
      gestureBefore = null;
      return;
    }
    if (event.key.startsWith('Arrow') && selectedIds.length) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') nudgeSelected(-step, 0);
      else if (event.key === 'ArrowRight') nudgeSelected(step, 0);
      else if (event.key === 'ArrowUp') nudgeSelected(0, -step);
      else if (event.key === 'ArrowDown') nudgeSelected(0, step);
    }
  }

  // -------------------------------------------------------------- picking

  function onPickImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const image = new Image();
      image.onload = () => {
        const maxWidth = 320;
        const scale = Math.min(1, maxWidth / Math.max(1, image.naturalWidth));
        const width = Math.max(8, image.naturalWidth * scale);
        const height = Math.max(8, image.naturalHeight * scale);
        const pageW = documentWidthPx(doc);
        const pageH = documentHeightPx(doc);
        const node = createImageNode(
          dataUrl,
          file.type || 'image/png',
          (pageW - width) / 2,
          (pageH - height) / 2,
          width,
          height
        );
        node.name = fm.figImage();
        withCommit(() => {
          doc.nodes = [...doc.nodes, node];
        });
        selectedIds = [node.id];
        sidebarTab = 'inspector';
      };
      image.onerror = () => pushToast('error', fm.figImportFailed());
      image.src = dataUrl;
    };
    reader.onerror = () => pushToast('error', fm.figImportFailed());
    reader.readAsDataURL(file);
  }

  function setTool(next: FigureToolId) {
    tool = next;
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="figure-tool" data-testid="figure-tool">
  <input
    class="hidden-input"
    type="file"
    data-testid="figure-file-input"
    accept=".spicefig,.figure.json,.json,application/json"
    bind:this={fileInput}
    onchange={onOpenFile}
  />
  <input
    class="hidden-input"
    type="file"
    accept="image/*"
    data-testid="figure-image-input"
    bind:this={imageInput}
    onchange={onPickImage}
  />

  <ToolProjectBar
    kind="figure"
    getPayload={() => snapshotDoc()}
    getName={() => figureDocName(snapshotDoc())}
    getPreview={() => previewFigure(snapshotDoc())}
    getSummary={() => figureSummary(snapshotDoc())}
  />

  <div class="figure-toolbar">
    <label class="name-field">
      <span class="pix-dim">▤</span>
      <input
        class="pix-input figure-name"
        data-testid="figure-name"
        value={doc.name}
        aria-label={fm.figFigureName()}
        oninput={(event) => {
          doc.name = (event.currentTarget as HTMLInputElement).value;
        }}
        onfocus={beginGesture}
        onblur={endGesture}
      />
    </label>

    <div class="toolbar-group">
      <button
        class="pix-btn icon-only"
        data-testid="figure-undo"
        disabled={!canUndo}
        title={fm.figUndo()}
        aria-label={fm.figUndo()}
        onclick={undo}
      >
        <Undo2 size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-redo"
        disabled={!canRedo}
        title={fm.figRedo()}
        aria-label={fm.figRedo()}
        onclick={redo}
      >
        <Redo2 size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-delete"
        disabled={!selectedIds.length}
        title={fm.figDelete()}
        aria-label={fm.figDelete()}
        onclick={deleteSelected}
      >
        <Trash2 size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-duplicate"
        disabled={!selectedIds.length}
        title={fm.figDuplicate()}
        aria-label={fm.figDuplicate()}
        onclick={duplicateSelected}
      >
        <Copy size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-group"
        disabled={selectedIds.length < 2}
        title={fm.figGroup()}
        aria-label={fm.figGroup()}
        onclick={groupSelected}
      >
        <GroupIcon size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-ungroup"
        disabled={!selectedNodes.some((node) => !!node.groupId)}
        title={fm.figUngroup()}
        aria-label={fm.figUngroup()}
        onclick={ungroupSelected}
      >
        <Ungroup size={13} />
      </button>
    </div>

    <div class="toolbar-group">
      <details class="menu" bind:open={newOpen}>
        <summary class="pix-btn menu-trigger" title={fm.figNew()}>
          <FilePlus size={13} /> <span class="menu-text">{fm.figNew()}</span>
          <span class="caret">▾</span>
        </summary>
        <div class="menu-pop">
          {#each FIGURE_PRESETS as preset (preset.id)}
            <button class="menu-item" onclick={() => newDocument(preset.id)}>
              {preset.widthMm} × {preset.heightMm} mm
            </button>
          {/each}
        </div>
      </details>
      <button
        class="pix-btn icon-only"
        data-testid="figure-open"
        title={fm.figOpen()}
        aria-label={fm.figOpen()}
        onclick={() => fileInput?.click()}
      >
        <FolderOpen size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-save"
        disabled={busyAny}
        title={fm.figSave()}
        aria-label={fm.figSave()}
        onclick={() => saveStandalone(false)}
      >
        <Save size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-save-as"
        disabled={busyAny}
        title={fm.figSaveAs()}
        aria-label={fm.figSaveAs()}
        onclick={() => saveStandalone(true)}
      >
        <FileDown size={13} />
      </button>
    </div>

    <div class="toolbar-group">
      <details class="menu" bind:open={exportOpen}>
        <summary
          class="pix-btn menu-trigger icon-only"
          data-testid="figure-export-menu"
          title={fm.figExportSvg()}
          aria-label={fm.figExportSvg()}
        >
          <Download size={13} />
          <span class="caret">▾</span>
        </summary>
        <div class="menu-pop">
          <button class="menu-item" disabled={busyAny} data-testid="figure-export-svg" onclick={exportSvg}>
            <Download size={11} /> {fm.figExportSvg()}
          </button>
          <button class="menu-item" disabled={busyAny} data-testid="figure-export-png" onclick={exportPng}>
            <Download size={11} /> {fm.figExportPng()}
          </button>
          <button class="menu-item" disabled={busyAny} data-testid="figure-export-pptx" onclick={exportPptx}>
            <Package size={11} /> {fm.figExportPptx()}
          </button>
          <button class="menu-item" disabled={busyAny} data-testid="figure-export-pdf" onclick={exportPdf}>
            <FileDown size={11} /> {fm.figExportPdf()}
          </button>
          <button class="menu-item" disabled={busyAny} data-testid="figure-export-tiff" onclick={exportTiff}>
            <FileDown size={11} /> {fm.figExportTiff()}
          </button>
          <button class="menu-item" disabled={busyAny} data-testid="figure-citations" onclick={exportCitations}>
            <FileText size={11} /> {fm.figExportCitations()}
          </button>
          <button class="menu-item" disabled={busyAny} data-testid="figure-repro" onclick={exportRepro}>
            <Package size={11} /> {m.zipExport()}
          </button>
        </div>
      </details>
      <button
        class="pix-btn icon-only"
        title={fm.figImportImage()}
        aria-label={fm.figImportImage()}
        data-testid="figure-import-image"
        onclick={() => imageInput?.click()}
      >
        <ImagePlus size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        title={fm.figImportVectorTitle()}
        aria-label={fm.figImportVectorTitle()}
        data-testid="figure-import-vector"
        onclick={() => (importOpen = true)}
      >
        <FileInput size={13} />
      </button>
    </div>

    <div class="spacer"></div>

    <div class="toolbar-group">
      <button
        class="pix-btn icon-only"
        data-testid="figure-check"
        title={fm.figCheckTitle()}
        aria-label={fm.figCheckTitle()}
        onclick={() => void runPublicationCheck()}
      >
        <ShieldCheck size={13} />
      </button>
      <button
        class="pix-btn"
        class:active={sidebarTab === 'templates'}
        title={fm.figTemplates()}
        onclick={() => (sidebarTab = 'templates')}
      >
        <LayoutTemplate size={13} /> <span class="menu-text">{fm.figTemplates()}</span>
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-zoom-out"
        title={fm.figZoomOut()}
        aria-label={fm.figZoomOut()}
        onclick={() => zoomBy(1 / 1.25)}
      >
        <ZoomOut size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-zoom-in"
        title={fm.figZoomIn()}
        aria-label={fm.figZoomIn()}
        onclick={() => zoomBy(1.25)}
      >
        <ZoomIn size={13} />
      </button>
      <button
        class="pix-btn icon-only"
        data-testid="figure-zoom-fit"
        title={fm.figFit()}
        aria-label={fm.figFit()}
        onclick={fitToolbar}
      >
        <Maximize size={13} />
      </button>
      <button class="pix-btn actual-size" title={fm.figActualSize()} onclick={actualSize}>
        100%
      </button>
    </div>
  </div>

  <div class="figure-body">
    <aside class="tool-rail" aria-label={fm.figSelect()}>
      {#each toolDefs as item (item.id)}
        <button
          class="rail-btn"
          class:active={tool === item.id}
          data-testid={item.test}
          title={toolLabel(item.id)}
          aria-label={toolLabel(item.id)}
          aria-pressed={tool === item.id}
          onclick={() => setTool(item.id)}
        >
          <item.icon size={15} />
        </button>
      {/each}

      <div class="rail-sep"></div>

      <button
        class="rail-btn add"
        data-testid="figure-add-rect"
        title={fm.figRect()}
        aria-label={fm.figRect()}
        onclick={() => addShape('rect')}
      >
        <Square size={14} />
        <span class="plus">+</span>
      </button>
      <button
        class="rail-btn add"
        data-testid="figure-add-text"
        title={fm.figTextTool()}
        aria-label={fm.figTextTool()}
        onclick={() => addShape('text')}
      >
        <Type size={14} />
        <span class="plus">+</span>
      </button>
      <button
        class="rail-btn add"
        data-testid="figure-add-arrow"
        title={fm.figArrow()}
        aria-label={fm.figArrow()}
        onclick={() => addShape('arrow')}
      >
        <MoveUpRight size={14} />
        <span class="plus">+</span>
      </button>
      <button
        class="rail-btn add"
        data-testid="figure-add-chart"
        title={fm.figChart()}
        aria-label={fm.figChart()}
        onclick={addChart}
      >
        <BarChart3 size={14} />
        <span class="plus">+</span>
      </button>
      <button
        class="rail-btn add"
        data-testid="figure-add-scalebar"
        title={fm.figScaleBar()}
        aria-label={fm.figScaleBar()}
        onclick={addScaleBar}
      >
        <Ruler size={14} />
        <span class="plus">+</span>
      </button>
    </aside>

    <section class="canvas-column">
      <FigureCanvas
        {doc}
        {selectedIds}
        {tool}
        {zoom}
        {pan}
        onSelect={selectNodes}
        onBegin={beginGesture}
        onEnd={endGesture}
        onReplaceNodes={(nodes) => (doc.nodes = nodes)}
        onAddNode={addNodeFromCanvas}
        onZoomAt={zoomAt}
        onPanChange={(next) => (pan = next)}
        onViewportChange={(size) => (viewport = size)}
        onEditText={editText}
      />
      <div class="status-bar">
        <span>{doc.widthMm.toFixed(1)} × {doc.heightMm.toFixed(1)} mm</span>
        <span data-testid="figure-status-nodes">{fm.figNodes({ n: doc.nodes.length })}</span>
        <span>{fm.figSelected({ n: selectedIds.length })}</span>
        <span class="spacer"></span>
        <span>{Math.round(zoom * 100)}%</span>
        <span
          class="dirty-led"
          class:dirty
          data-testid="figure-dirty"
          data-dirty={dirty ? 'true' : 'false'}
        >
          {dirty ? fm.figUnsaved() : fm.figSaved()}
        </span>
      </div>
    </section>

    <aside class="figure-sidebar">
      <div class="sidebar-tabs" role="tablist">
        <button
          class="tab"
          class:active={sidebarTab === 'inspector'}
          data-testid="figure-sidebar-tab-inspector"
          role="tab"
          aria-selected={sidebarTab === 'inspector'}
          onclick={() => (sidebarTab = 'inspector')}
        >
          <Shapes size={11} /> {fm.figDocument()}
        </button>
        <button
          class="tab"
          class:active={sidebarTab === 'layers'}
          data-testid="figure-sidebar-tab-layers"
          role="tab"
          aria-selected={sidebarTab === 'layers'}
          onclick={() => (sidebarTab = 'layers')}
        >
          <GroupIcon size={11} /> {fm.figLayers()}
        </button>
        <button
          class="tab"
          class:active={sidebarTab === 'assets'}
          data-testid="figure-sidebar-tab-assets"
          role="tab"
          aria-selected={sidebarTab === 'assets'}
          onclick={() => (sidebarTab = 'assets')}
        >
          <ImagePlus size={11} /> {fm.figAssets()}
        </button>
        <button
          class="tab"
          class:active={sidebarTab === 'templates'}
          data-testid="figure-sidebar-tab-templates"
          role="tab"
          aria-selected={sidebarTab === 'templates'}
          onclick={() => (sidebarTab = 'templates')}
        >
          <LayoutTemplate size={11} /> {fm.figTemplates()}
        </button>
      </div>

      <div class="sidebar-scroll">
        {#if sidebarTab === 'inspector'}
          <FigureInspector
            {doc}
            {selectedIds}
            focusToken={textFocusToken}
            onCommit={withCommit}
            onBegin={beginGesture}
            onEnd={endGesture}
            onDelete={deleteSelected}
            onDuplicate={duplicateSelected}
            onGroup={groupSelected}
            onUngroup={ungroupSelected}
            onAlign={alignSelected}
            onDistribute={distributeSelected}
            onZOrder={zOrder}
            onLock={setSelectedLocked}
            onHide={setSelectedHidden}
            onCopyStyle={copyStyle}
            onPasteStyle={pasteStyle}
            canPasteStyle={!!styleClipboard}
          />
        {:else if sidebarTab === 'layers'}
          <FigureLayers
            {doc}
            {selectedIds}
            onSelect={selectNodes}
            onToggleHidden={toggleNodeHidden}
            onToggleLocked={toggleNodeLocked}
            onMoveZ={moveLayerZ}
            onSelectGroup={selectGroup}
            onToggleGroupHidden={toggleGroupHidden}
            onToggleGroupLocked={toggleGroupLocked}
          />
        {:else if sidebarTab === 'assets'}
          <FigureAssetPanel onInsert={insertAsset} />
        {:else}
          <div class="template-panel">
            <div class="template-note pix-dim">{fm.figEmptyHint()}</div>
            {#each FIGURE_TEMPLATES as template, index (template.id)}
              <button
                class="template-card"
                data-testid={`figure-template-${template.id}`}
                onclick={() => applyTemplate(template.id)}
              >
                <span class="template-art art-{index % 4}">
                  <span></span><span></span><span></span>
                </span>
                <span class="template-name">{templateText(template.nameKey)}</span>
                <span class="template-desc">{templateText(template.descKey)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </aside>
  </div>

  <FigureImportDialog
    open={importOpen}
    onClose={() => (importOpen = false)}
    onImport={handleVectorImport}
  />
  <FigureCheckDialog
    open={checkOpen}
    issues={checkIssues}
    counts={checkCounts}
    busy={checkBusy}
    onRun={() => void runPublicationCheck()}
    onClose={() => (checkOpen = false)}
    onExportTiff={() => {
      checkOpen = false;
      void exportTiff();
    }}
  />
</div>

<style>
  .figure-tool {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    overflow: hidden;
    font-family: var(--pix-font);
    font-size: 10px;
    color: var(--pix-fg);
  }
  .hidden-input {
    display: none;
  }

  .figure-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 5px 7px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
    flex: 0 0 auto;
  }
  .toolbar-group {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding-left: 6px;
    border-left: 1px dashed var(--pix-border);
  }
  .toolbar-group:first-of-type {
    border-left: none;
    padding-left: 0;
  }
  .spacer {
    flex: 1;
  }
  .name-field {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 150px;
    flex: 0 1 240px;
  }
  .figure-name {
    width: 100%;
    height: 25px;
    font-size: 10px;
    font-weight: bold;
    color: var(--pix-accent-2);
    border: 2px solid var(--pix-border-hi);
  }
  .pix-input {
    background: var(--pix-bg);
    color: var(--pix-fg);
    border: 2px solid var(--pix-border-hi);
    font-family: var(--pix-font);
    font-size: 9.5px;
    padding: 2px 4px;
  }
  .pix-btn {
    padding: 3px 7px;
    font-size: 9px;
  }
  .pix-btn.icon-only {
    min-width: 28px;
    padding: 3px 6px;
  }
  .pix-btn.active {
    border-color: var(--pix-cyan);
    color: var(--pix-cyan);
    background: rgba(76, 214, 255, 0.08);
  }
  .actual-size {
    font-size: 8.5px;
    padding: 3px 5px;
  }

  .menu {
    position: relative;
  }
  .menu > summary {
    list-style: none;
    user-select: none;
  }
  .menu > summary::-webkit-details-marker {
    display: none;
  }
  .menu .caret {
    font-size: 8px;
    margin-left: 1px;
  }
  .menu-pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 40;
    min-width: 190px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 4px;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border-hi);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.6);
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 7px;
    background: none;
    border: 1px solid transparent;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 9px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .menu-item:hover {
    background: rgba(76, 214, 255, 0.10);
    border-color: var(--pix-cyan);
    color: var(--pix-cyan);
  }

  .figure-body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 6px;
  }
  .tool-rail {
    width: 40px;
    flex: 0 0 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 5px 3px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
    overflow-y: auto;
  }
  .rail-btn {
    position: relative;
    width: 31px;
    height: 31px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--pix-bg-3);
    color: var(--pix-fg-dim);
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .rail-btn:hover {
    color: var(--pix-cyan);
    border-color: var(--pix-border-hi);
  }
  .rail-btn.active {
    color: var(--pix-cyan);
    border-color: var(--pix-cyan);
    background: rgba(76, 214, 255, 0.10);
    box-shadow: 0 0 8px rgba(76, 214, 255, 0.25);
  }
  .rail-btn .plus {
    position: absolute;
    right: 0;
    bottom: -2px;
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-accent-2);
    background: var(--pix-bg-2);
    line-height: 1;
    padding: 0 1px;
  }
  .rail-sep {
    width: 24px;
    height: 1px;
    margin: 3px 0;
    background: var(--pix-border);
  }

  .canvas-column {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .status-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    padding: 4px 7px;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
    font-size: 8.5px;
    color: var(--pix-fg-dim);
    flex: 0 0 auto;
  }
  .status-bar .spacer {
    flex: 1;
  }
  .dirty-led {
    color: var(--pix-green);
    font-weight: bold;
  }
  .dirty-led.dirty {
    color: var(--pix-accent);
  }

  .figure-sidebar {
    width: 312px;
    min-width: 280px;
    max-width: 340px;
    flex: 0 0 312px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  .sidebar-tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--pix-border);
    background: var(--pix-bg);
    flex: 0 0 auto;
  }
  .tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 5px 1px;
    background: none;
    border: none;
    border-right: 1px solid var(--pix-border);
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 8px;
    cursor: pointer;
  }
  .tab:last-child {
    border-right: none;
  }
  .tab:hover {
    color: var(--pix-fg);
    background: var(--pix-bg-3);
  }
  .tab.active {
    color: var(--pix-accent-2);
    background: var(--pix-bg-2);
    box-shadow: inset 0 -2px 0 var(--pix-accent-2);
  }
  .sidebar-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-color: var(--pix-border-hi) var(--pix-bg);
  }

  .template-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
  }
  .template-note {
    font-size: 8.5px;
    line-height: 1.45;
    border: 1px dashed var(--pix-border);
    padding: 5px 6px;
  }
  .template-card {
    display: grid;
    grid-template-columns: 54px 1fr;
    grid-template-rows: auto auto;
    gap: 1px 8px;
    align-items: center;
    padding: 6px;
    background: var(--pix-bg);
    border: 1px solid var(--pix-border);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    text-align: left;
    cursor: pointer;
  }
  .template-card:hover {
    border-color: var(--pix-accent-2);
    background: var(--pix-bg-3);
  }
  .template-art {
    grid-row: 1 / 3;
    display: flex;
    gap: 2px;
    align-items: flex-end;
    justify-content: center;
    height: 36px;
    padding: 4px;
    background: var(--pix-bg-2);
    border: 1px solid var(--pix-border-hi);
  }
  .template-art span {
    display: block;
    width: 11px;
    background: var(--pix-border-hi);
  }
  .template-art.art-0 span {
    height: 45%;
  }
  .template-art.art-0 span:nth-child(2) {
    height: 85%;
    background: var(--pix-accent-2);
  }
  .template-art.art-1 span {
    height: 70%;
  }
  .template-art.art-1 span:nth-child(1) {
    background: var(--pix-cyan);
  }
  .template-art.art-2 span {
    height: 100%;
  }
  .template-art.art-2 span:nth-child(2) {
    background: var(--pix-accent);
  }
  .template-art.art-3 span {
    height: 30%;
  }
  .template-art.art-3 span:nth-child(3) {
    height: 75%;
    background: var(--pix-green);
  }
  .template-name {
    font-size: 9.5px;
    font-weight: bold;
    color: var(--pix-accent-2);
  }
  .template-desc {
    font-size: 8.5px;
    color: var(--pix-fg-dim);
    line-height: 1.35;
  }
  .pix-dim {
    color: var(--pix-fg-dim);
  }

  @media (max-width: 1180px) {
    .menu-text {
      display: none;
    }
    .figure-sidebar {
      width: 286px;
      flex-basis: 286px;
    }
  }
  @media (max-width: 980px) {
    .figure-tool {
      overflow-y: auto;
    }
    .figure-body {
      flex-wrap: wrap;
      overflow: visible;
    }
    .tool-rail {
      flex-direction: row;
      width: 100%;
      flex-basis: auto;
      overflow-x: auto;
      overflow-y: hidden;
    }
    .rail-sep {
      width: 1px;
      height: 24px;
      margin: 0 3px;
    }
    .canvas-column {
      flex-basis: 100%;
      min-height: 52vh;
    }
    .figure-sidebar {
      width: 100%;
      max-width: none;
      flex-basis: 100%;
      max-height: none;
      min-height: 320px;
    }
    .figure-toolbar {
      gap: 4px;
    }
  }
  @media (max-width: 620px) {
    .figure-toolbar .pix-btn {
      font-size: 8px;
      padding: 2px 5px;
    }
    .figure-sidebar {
      min-height: 360px;
    }
  }
</style>
