<script lang="ts">
  // Newick tree viewer and figure workstation.
  // The component owns transient interaction state; parsing, layout, metadata
  // and export live in the sibling .ts modules.
  import { onMount, tick } from 'svelte';
  import {
    TreePine, Search, ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut,
    RefreshCw, Upload, Download, Image as ImageIcon, FileText, Braces,
    RotateCw, ListTree, Palette, Trash2, SlidersHorizontal, FileUp
  } from 'lucide-svelte';
  import { m } from './i18n';
  import { pushToast } from '$lib/ui/toast.svelte.ts';
  import { backend } from '$lib/backend/api';
  import type {
    LayoutMode, PaletteId, TreeDoc, TreeNode, TreeMetadata, TreeProject, TreeSettings
  } from './types';
  import {
    defaultSettings, emptyMetadata, formatNumber, PALETTE_IDS
  } from './types';
  import { parseNewick, NewickParseError, toNewick, type NewickErrorCode } from './newick';
  import { computeLayout } from './layout';
  import { renderTreeSvg, THEME_COLORS } from './render';
  import {
    MetadataParseError, metadataToCsv, parseMetadataTable, resolveMetadata
  } from './metadata';
  import {
    expandAncestors, isDescendantOf, ladderizeTree, midpointRoot,
    rotateChildren, sortTreeAlphabetically, sortTreeByGroup
  } from './treeops';
  import {
    deserializeTree, nodeToSerialized, normalizeMetadata, normalizeSettings,
    parseProjectJson, serializeProject, svgToPng
  } from './export';
  import { clearSession, hasSession, loadSession, saveSession } from './storage';
  import { EXAMPLE_METADATA, EXAMPLE_NEWICK } from './example';

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MIN_ZOOM = 0.08;
  const MAX_ZOOM = 24;

  let ready = $state(false);
  let inputText = $state('');
  let doc = $state.raw<TreeDoc | null>(null);
  let settings = $state<TreeSettings>(defaultSettings());
  let metadata = $state<TreeMetadata>(emptyMetadata());
  let collapsed = $state<Set<string>>(new Set());
  let selectedId = $state<string | null>(null);
  let hoveredId = $state<string | null>(null);
  let tooltip = $state<{ x: number; y: number } | null>(null);
  let searchQuery = $state('');
  let searchPos = $state(0);
  let focusGroup = $state<string | null>(null);
  let title = $state('');
  let caption = $state('');
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let metaText = $state('');
  let metaError = $state<{ row: number } | null>(null);
  let parseError = $state<{ code: NewickErrorCode; position: number; found: string } | null>(null);
  let dragOver = $state(false);
  let isPanning = $state(false);
  let autosaveAt = $state<number | null>(null);

  let viewportEl = $state<HTMLDivElement | undefined>();
  let searchInput = $state<HTMLInputElement | undefined>();
  let uploadInput = $state<HTMLInputElement | undefined>();
  let metaInput = $state<HTMLInputElement | undefined>();
  let projectInput = $state<HTMLInputElement | undefined>();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  // ------------------------------------------------------------ derived tree

  const resolvedMeta = $derived(resolveMetadata(metadata));

  const treeIndex = $derived.by(() => {
    const byId = new Map<string, TreeNode>();
    const parent = new Map<string, string | null>();
    const leaves: TreeNode[] = [];
    if (doc) {
      const visit = (node: TreeNode, parentId: string | null) => {
        byId.set(node.id, node);
        parent.set(node.id, parentId);
        if (node.children.length === 0) leaves.push(node);
        for (const child of node.children) visit(child, node.id);
      };
      visit(doc.root, null);
    }
    return { byId, parent, leaves };
  });

  const layout = $derived(doc
    ? computeLayout({
        root: doc.root,
        mode: settings.mode,
        fontSize: settings.fontSize,
        labelAngle: settings.labelAngle,
        showBranchLengths: settings.showBranchLengths,
        showScaleBar: settings.showScaleBar,
        title,
        caption,
        collapsed,
        metadata: resolvedMeta
      })
    : null);

  const searchMatches = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [] as TreeNode[];
    return treeIndex.leaves.filter((leaf) =>
      (leaf.name || '').toLowerCase().includes(query) ||
      (leaf.comment || '').toLowerCase().includes(query)
    );
  });

  const searchStatus = $derived.by(() => {
    if (!searchQuery.trim()) return '';
    if (searchMatches.length === 0) return m.treeSearchNoMatch();
    const index = Math.min(searchPos, searchMatches.length - 1);
    return m.treeSearchMatches({
      i: String(index + 1),
      n: String(searchMatches.length)
    });
  });

  const pathIds = $derived.by(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    let cursor: string | null | undefined = selectedId;
    while (cursor) {
      ids.add(cursor);
      cursor = treeIndex.parent.get(cursor) ?? null;
    }
    return ids;
  });

  const hoverPathIds = $derived.by(() => {
    const ids = new Set<string>();
    if (!hoveredId) return ids;
    let cursor: string | null | undefined = hoveredId;
    while (cursor) {
      ids.add(cursor);
      cursor = treeIndex.parent.get(cursor) ?? null;
    }
    return ids;
  });

  const selectedLayout = $derived(selectedId && layout ? layout.byId.get(selectedId) ?? null : null);
  const selectedTreeNode = $derived(selectedId ? treeIndex.byId.get(selectedId) ?? null : null);
  const selectedIsInternal = $derived((selectedTreeNode?.children.length ?? 0) > 0);
  const selectedCollapsed = $derived(selectedId ? collapsed.has(selectedId) : false);
  const hoveredNode = $derived(hoveredId && layout ? layout.byId.get(hoveredId) ?? null : null);

  const legend = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const leaf of treeIndex.leaves) {
      const group = resolvedMeta.byLeaf[leaf.name]?.group;
      if (!group) continue;
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return resolvedMeta.groupOrder
      .filter((group) => counts.has(group))
      .map((group) => ({
        group,
        color: resolvedMeta.groupColors[group] ?? '#8b96b5',
        count: counts.get(group) ?? 0
      }));
  });

  const ungroupedCount = $derived(
    treeIndex.leaves.filter((leaf) => !resolvedMeta.byLeaf[leaf.name]?.group).length
  );

  const totalNodes = $derived(treeIndex.byId.size);
  const totalLeaves = $derived(treeIndex.leaves.length);

  const errorSnippet = $derived.by(() => {
    if (!parseError) return null;
    const position = Math.max(0, Math.min(inputText.length, parseError.position));
    const start = Math.max(0, position - 26);
    const end = Math.min(inputText.length, position + 26);
    return {
      before: inputText.slice(start, position),
      at: inputText[position] ?? '',
      after: inputText.slice(position + 1, end),
      position
    };
  });

  const svgMarkup = $derived.by(() => {
    if (!layout) return '';
    return renderTreeSvg({
      layout,
      settings,
      selectedId,
      hoveredId,
      pathIds,
      hoverPathIds,
      searchMatches: new Set(searchMatches.map((leaf) => leaf.id)),
      focusGroup,
      title,
      caption,
      collapseLabel: m.treeCollapse(),
      expandLabel: m.treeExpand(),
      unitLabel: m.treeUnits(),
      unnamedLabel: m.treeUnnamed()
    });
  });

  // Exports must not carry interactive dimming, hover traces or search marks.
  const exportMarkup = $derived.by(() => {
    if (!layout) return '';
    return renderTreeSvg({
      layout,
      settings,
      selectedId: null,
      hoveredId: null,
      pathIds: new Set<string>(),
      hoverPathIds: new Set<string>(),
      searchMatches: new Set<string>(),
      focusGroup: null,
      title,
      caption,
      collapseLabel: m.treeCollapse(),
      expandLabel: m.treeExpand(),
      unitLabel: m.treeUnits(),
      unnamedLabel: m.treeUnnamed()
    });
  });

  // ----------------------------------------------------------- view helpers

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  async function fitView(): Promise<void> {
    await tick();
    const current = layout;
    if (!current) return;
    const target = 0.92;
    zoom = target;
    panX = (current.width * (1 - target)) / 2;
    panY = (current.height * (1 - target)) / 2;
  }

  function screenToUser(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = viewportEl?.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const mapped = point.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  }

  function zoomAt(clientX: number, clientY: number, factor: number): void {
    const user = screenToUser(clientX, clientY);
    if (!user) return;
    const next = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (Math.abs(next - zoom) < 0.00001) return;
    const ratio = next / zoom;
    panX = user.x - (user.x - panX) * ratio;
    panY = user.y - (user.y - panY) * ratio;
    zoom = next;
  }

  function panByScreen(dx: number, dy: number): void {
    const svg = viewportEl?.querySelector('svg') as SVGSVGElement | null;
    const ctm = svg?.getScreenCTM();
    if (!ctm) return;
    panX += dx / ctm.a;
    panY += dy / ctm.d;
  }

  function zoomCenter(factor: number): void {
    const rect = viewportEl?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  async function focusNode(id: string, targetZoom = 2.6): Promise<void> {
    await tick();
    const current = layout;
    const node = current?.byId.get(id);
    if (!current || !node) return;
    zoom = clamp(targetZoom, MIN_ZOOM, MAX_ZOOM);
    panX = current.width / 2 - zoom * node.x;
    panY = current.height / 2 - zoom * node.y;
  }

  // --------------------------------------------------------- tree loading

  function errorMessage(error: { code: NewickErrorCode }): string {
    switch (error.code) {
      case 'empty': return m.treeErrEmpty();
      case 'unclosed': return m.treeErrUnclosed();
      case 'badLength': return m.treeErrBadLength();
      case 'unexpectedComma': return m.treeErrUnexpectedComma();
      case 'unexpectedEnd': return m.treeErrUnexpectedEnd();
      case 'badQuoted': return m.treeErrBadQuoted();
      case 'badComment': return m.treeErrBadComment();
      case 'noRoot': return m.treeErrNoRoot();
      default: return m.treeErrUnexpected();
    }
  }

  function loadNewick(text: string, sourceName: string | null = null, notify = true): boolean {
    const clean = text.trim();
    if (!clean) {
      parseError = { code: 'empty', position: 0, found: '' };
      if (notify) pushToast('error', m.treeParseErrorTitle(), m.treeErrEmpty());
      return false;
    }
    inputText = clean;
    try {
      const parsed = parseNewick(clean);
      doc = {
        root: parsed.root,
        originalNewick: clean,
        rooted: parsed.rooted,
        sourceName
      };
      collapsed = new Set();
      selectedId = null;
      hoveredId = null;
      tooltip = null;
      focusGroup = null;
      parseError = null;
      autosaveAt = null;
      void fitView();
      if (notify) pushToast('success', m.treeLoadedToast(), sourceName ?? '');
      return true;
    } catch (error) {
      if (error instanceof NewickParseError) {
        parseError = { code: error.code, position: error.position, found: error.found };
        if (notify) {
          pushToast(
            'error',
            m.treeParseErrorTitle(),
            `${errorMessage(error)} · ${m.treePosition({ pos: String(error.position + 1) })}`
          );
        }
      } else {
        if (notify) pushToast('error', m.treeParseErrorTitle(), String((error as Error)?.message ?? error));
      }
      return false;
    }
  }

  function loadExample(): void {
    if (!loadNewick(EXAMPLE_NEWICK, 'example.nwk', false)) return;
    metaText = EXAMPLE_METADATA;
    applyMetadataText(EXAMPLE_METADATA, false);
    pushToast('success', m.treeLoadedToast(), 'example.nwk');
  }

  function onLoadClick(): void {
    loadNewick(inputText, null, true);
  }

  async function readTextFile(file: File): Promise<string> {
    if (file.size > MAX_FILE_BYTES) throw new Error('too large');
    return file.text();
  }

  async function onUploadPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      pushToast('error', m.treeFileTooLarge());
      return;
    }
    try {
      const text = await readTextFile(file);
      loadNewick(text, file.name);
    } catch {
      pushToast('error', m.treeReadFailed());
    }
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
    dragOver = true;
  }

  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragOver = false;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      pushToast('error', m.treeFileTooLarge());
      return;
    }
    try {
      const text = await readTextFile(file);
      loadNewick(text, file.name);
    } catch {
      pushToast('error', m.treeReadFailed());
    }
  }

  // --------------------------------------------------------- interactions

  interface PointerState { x: number; y: number }

  const pointers = new Map<number, PointerState>();
  let drag: {
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    nodeId: string | null;
    toggleId: string | null;
  } | null = null;
  let pinchDistance = 0;
  let pinchMid: { x: number; y: number } | null = null;

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!layout) return;
    const target = event.target as Element | null;
    const node = target?.closest('[data-node-id]') ?? null;
    const toggle = target?.closest('[data-toggle-id]') ?? null;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      drag = {
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        nodeId: node?.getAttribute('data-node-id') ?? null,
        toggleId: toggle?.getAttribute('data-toggle-id') ?? null
      };
    } else if (pointers.size === 2) {
      drag = null;
      const [a, b] = [...pointers.values()];
      pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1 && drag) {
        const dx = event.clientX - drag.lastX;
        const dy = event.clientY - drag.lastY;
        drag.lastX = event.clientX;
        drag.lastY = event.clientY;
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) {
          drag.moved = true;
        }
        if (drag.moved) {
          isPanning = true;
          panByScreen(dx, dy);
          hoveredId = null;
          tooltip = null;
        }
      } else if (pointers.size === 2 && pinchMid && pinchDistance > 0) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const previousMid = pinchMid;
        zoomAt(mid.x, mid.y, distance / pinchDistance);
        panByScreen(mid.x - previousMid.x, mid.y - previousMid.y);
        pinchDistance = distance;
        pinchMid = mid;
      }
      return;
    }

    if (!viewportEl) return;
    if (!(event.target instanceof Node) || !viewportEl.contains(event.target)) {
      hoveredId = null;
      tooltip = null;
      return;
    }
    const element = (event.target as Element).closest?.('[data-node-id]') ?? null;
    const id = element?.getAttribute('data-node-id') ?? null;
    const rect = viewportEl.getBoundingClientRect();
    if (id) {
      hoveredId = id;
      tooltip = {
        x: clamp(event.clientX - rect.left + 14, 8, Math.max(8, rect.width - 238)),
        y: clamp(event.clientY - rect.top + 14, 8, Math.max(8, rect.height - 132))
      };
    } else {
      hoveredId = null;
      tooltip = null;
    }
  }

  function onPointerUp(event: PointerEvent): void {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (pointers.size < 2) {
      pinchDistance = 0;
      pinchMid = null;
    }
    if (drag && !drag.moved) {
      if (drag.toggleId) toggleCollapse(drag.toggleId);
      else if (drag.nodeId) selectNode(drag.nodeId);
      else selectedId = null;
    }
    if (pointers.size === 0) {
      drag = null;
      isPanning = false;
    }
  }

  function onWindowBlur(): void {
    pointers.clear();
    drag = null;
    pinchDistance = 0;
    pinchMid = null;
    isPanning = false;
    hoveredId = null;
    tooltip = null;
  }

  function onWheel(event: WheelEvent): void {
    if (!layout) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomAt(event.clientX, event.clientY, clamp(factor, 0.5, 2));
  }

  function selectNode(id: string): void {
    selectedId = id;
  }

  function toggleCollapse(id: string): void {
    if (!doc) return;
    const node = treeIndex.byId.get(id);
    if (!node || node.children.length === 0 || node.id === doc.root.id) return;
    const next = new Set(collapsed);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (selectedId && selectedId !== id && isDescendantOf(node, selectedId)) {
        selectedId = id;
      }
      if (hoveredId && hoveredId !== id && isDescendantOf(node, hoveredId)) {
        hoveredId = null;
        tooltip = null;
      }
    }
    collapsed = next;
  }

  function toggleSelectedCollapse(): void {
    if (!selectedId) return;
    const node = treeIndex.byId.get(selectedId);
    if (node && node.children.length > 0) toggleCollapse(selectedId);
  }

  function rotateSelected(): void {
    if (!doc || !selectedId) return;
    const node = treeIndex.byId.get(selectedId);
    if (!node || node.children.length < 2) return;
    doc = { ...doc, root: rotateChildren(doc.root, selectedId) };
  }

  function toggleFocus(group: string): void {
    focusGroup = focusGroup === group ? null : group;
  }

  function onSearchInput(event: Event): void {
    searchQuery = (event.target as HTMLInputElement).value;
    searchPos = 0;
  }

  async function gotoMatch(delta: number): Promise<void> {
    const matches = searchMatches;
    if (!doc || matches.length === 0) return;
    searchPos = ((searchPos + delta) % matches.length + matches.length) % matches.length;
    const leaf = matches[searchPos];
    selectedId = leaf.id;
    collapsed = expandAncestors(doc.root, leaf.id, collapsed);
    await tick();
    await focusNode(leaf.id, 2.8);
  }

  function onSearchKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      void gotoMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      searchQuery = '';
      searchPos = 0;
      (event.target as HTMLInputElement).blur();
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing = Boolean(target && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable
    ));

    if (event.key === 'Escape') {
      if (typing) {
        (event.target as HTMLElement).blur();
        return;
      }
      selectedId = null;
      hoveredId = null;
      tooltip = null;
      focusGroup = null;
      return;
    }
    if (typing) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === '/') {
      event.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }
    if (!doc) return;

    const key = event.key.toLowerCase();
    if (key === 'f' || key === '0') {
      event.preventDefault();
      void fitView();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomCenter(1.25);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      zoomCenter(1 / 1.25);
    } else if (key === 'r') {
      event.preventDefault();
      rotateSelected();
    } else if (key === 'c') {
      event.preventDefault();
      toggleSelectedCollapse();
    } else if (key === 'l') {
      event.preventDefault();
      doLadderize(false);
    }
  }

  // ------------------------------------------------------------- beautify

  function setMode(mode: LayoutMode): void {
    settings.mode = mode;
    void fitView();
  }

  function doLadderize(descending: boolean): void {
    if (!doc) return;
    doc = { ...doc, root: ladderizeTree(doc.root, descending) };
    pushToast('success', m.treeLadderizedToast());
  }

  function doSortAlphabetically(): void {
    if (!doc) return;
    doc = { ...doc, root: sortTreeAlphabetically(doc.root) };
    pushToast('success', m.treeSortedToast());
  }

  function doSortByGroup(): void {
    if (!doc) return;
    doc = { ...doc, root: sortTreeByGroup(doc.root, resolvedMeta) };
    pushToast('success', m.treeSortedToast());
  }

  async function doMidpointRoot(): Promise<void> {
    if (!doc) return;
    const rooted = midpointRoot(doc.root);
    if (!rooted) {
      pushToast('warn', m.treeNoMidpoint());
      return;
    }
    doc = { ...doc, root: rooted, rooted: true };
    selectedId = null;
    hoveredId = null;
    tooltip = null;
    pushToast('success', m.treeRootedToast());
    await tick();
    await fitView();
  }

  function resetTree(): void {
    if (!doc) return;
    loadNewick(doc.originalNewick, doc.sourceName);
  }

  function resetSettings(): void {
    settings = defaultSettings();
    void fitView();
  }

  // ------------------------------------------------------------- metadata

  function applyMetadataText(text: string, notify = true): boolean {
    try {
      const entries = parseMetadataTable(text);
      const leafNames = new Set(treeIndex.leaves.map((leaf) => leaf.name));
      const matched = entries.filter((entry) => leafNames.has(entry.leaf)).length;
      metadata = { ...metadata, entries };
      metaError = null;
      focusGroup = null;
      if (notify) {
        if (matched === 0) pushToast('info', m.treeMetadataEmptyToast());
        else pushToast('success', m.treeMetadataAppliedToast({ n: String(matched) }));
      }
      return true;
    } catch (error) {
      if (error instanceof MetadataParseError) {
        metaError = { row: error.row };
        if (notify) {
          pushToast(
            'error',
            m.treeMetadataErrorToast(),
            m.treeMetaRowError({ row: String(error.row) })
          );
        }
      } else if (notify) {
        pushToast('error', m.treeMetadataErrorToast());
      }
      return false;
    }
  }

  async function onMetadataPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      pushToast('error', m.treeFileTooLarge());
      return;
    }
    try {
      const text = await readTextFile(file);
      metaText = text;
      applyMetadataText(text);
    } catch {
      pushToast('error', m.treeReadFailed());
    }
  }

  function clearMetadata(): void {
    metadata = emptyMetadata();
    metaText = '';
    metaError = null;
    focusGroup = null;
  }

  // --------------------------------------------------------------- project

  function buildProject(): TreeProject | null {
    if (!doc) return null;
    return {
      format: 'spice-tree',
      version: 1,
      originalNewick: doc.originalNewick,
      tree: nodeToSerialized(doc.root),
      rooted: doc.rooted,
      sourceName: doc.sourceName,
      collapsedIds: [...collapsed],
      settings: { ...settings },
      metadata: {
        entries: metadata.entries.map((entry) => ({ ...entry })),
        paletteId: metadata.paletteId
      },
      title,
      caption,
      savedAt: new Date().toISOString()
    };
  }

  function applyProject(project: TreeProject): void {
    const root = deserializeTree(project.tree);
    doc = {
      root,
      originalNewick: project.originalNewick,
      rooted: project.rooted,
      sourceName: project.sourceName
    };
    settings = normalizeSettings(project.settings);
    metadata = normalizeMetadata(project.metadata);
    collapsed = new Set(project.collapsedIds);
    title = project.title;
    caption = project.caption;
    inputText = project.originalNewick;
    metaText = project.metadata.entries.length ? metadataToCsv(project.metadata) : '';
    selectedId = null;
    hoveredId = null;
    tooltip = null;
    focusGroup = null;
    parseError = null;
    metaError = null;
    autosaveAt = null;
    void fitView();
  }

  async function onProjectPicked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      pushToast('error', m.treeFileTooLarge());
      return;
    }
    try {
      const text = await file.text();
      const project = parseProjectJson(text);
      applyProject(project);
      pushToast('success', m.treeLoadedToast(), file.name);
    } catch {
      pushToast('error', m.treeImportFailToast(), m.treeInvalidProject());
    }
  }

  function forgetSession(): void {
    clearSession();
    doc = null;
    collapsed = new Set();
    selectedId = null;
    hoveredId = null;
    tooltip = null;
    focusGroup = null;
    metadata = emptyMetadata();
    metaText = '';
    metaError = null;
    title = '';
    caption = '';
    inputText = '';
    parseError = null;
    autosaveAt = null;
    pushToast('info', m.treeSessionCleared());
  }

  // ---------------------------------------------------------------- export

  function fileBase(): string {
    const cleaned = title.trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60);
    return cleaned || m.treeFileBase();
  }

  async function saveExport(name: string, data: string | Uint8Array): Promise<void> {
    const result = await backend.saveExport(name, data);
    if (result.data?.saved) {
      pushToast('success', m.treeExportOkToast({ name: result.data.path ?? name }));
    } else if (result.error) {
      pushToast('error', m.treeExportFailToast(), result.error);
    }
  }

  async function exportSvg(): Promise<void> {
    if (!layout) return;
    await saveExport(`${fileBase()}.svg`, exportMarkup);
  }

  async function exportPng(dpi: number): Promise<void> {
    if (!layout) return;
    try {
      const result = await svgToPng(
        exportMarkup,
        layout.width,
        layout.height,
        dpi,
        THEME_COLORS[settings.theme].background
      );
      if (result.reduced) pushToast('warn', m.treePngTooLarge({ dpi: String(dpi) }));
      await saveExport(`${fileBase()}_${dpi}dpi.png`, result.bytes);
    } catch (error) {
      pushToast('error', m.treeExportFailToast(), String((error as Error)?.message ?? error));
    }
  }

  async function exportNewick(original: boolean): Promise<void> {
    if (!doc) return;
    const text = original ? doc.originalNewick : toNewick(doc.root, { collapsed });
    const suffix = original ? 'original' : 'edited';
    await saveExport(`${fileBase()}_${suffix}.nwk`, text);
  }

  async function exportProject(): Promise<void> {
    const project = buildProject();
    if (!project) return;
    await saveExport(`${fileBase()}.tree.json`, serializeProject(project));
  }

  // --------------------------------------------------------------- effects

  $effect(() => {
    void svgMarkup;
    const container = viewportEl;
    if (!container) return;
    const viewport = container.querySelector('svg .tree-viewport') as SVGGElement | null;
    if (!viewport) return;
    viewport.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoom})`);
  });

  $effect(() => {
    if (!ready) return;
    const project = buildProject();
    if (!project) {
      clearSession();
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (saveSession(project)) autosaveAt = Date.now();
    }, 700);
    return () => clearTimeout(saveTimer);
  });

  onMount(() => {
    const session = loadSession();
    if (session) {
      applyProject(session);
      pushToast('info', m.treeAutosaveRestored());
    } else if (hasSession()) {
      pushToast('warn', m.treeRestoreFailedToast());
    }
    ready = true;
  });

  function fmtTime(timestamp: number): string {
    const date = new Date(timestamp);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function paletteLabel(id: PaletteId): string {
    switch (id) {
      case 'warm': return m.treePaletteWarm();
      case 'cool': return m.treePaletteCool();
      case 'colorblind': return m.treePaletteColorblind();
      default: return m.treePaletteDefault();
    }
  }

  function fmtLength(value: number | null): string {
    return value === null ? m.treeLengthMissing() : formatNumber(value);
  }
</script>

<svelte:window
  onkeydown={onKeydown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onblur={onWindowBlur}
/>

<div class="tree-tool">
  <div class="tree-workspace">
    <!-- ============================ LEFT PANEL ============================ -->
    <aside class="panel panel-left">
      <section class="pix-section">
        <h3 class="sec-title"><TreePine size={11} /> {m.treeInputTitle()}</h3>
        <textarea
          class="input-area"
          rows={5}
          spellcheck="false"
          placeholder={m.treePastePh()}
          bind:value={inputText}
          oninput={() => { if (parseError) parseError = null; }}
        ></textarea>
        <div class="btn-row">
          <button class="pix-btn tiny ok" onclick={onLoadClick} disabled={!inputText.trim()}>
            {m.treeLoadBtn()}
          </button>
          <button class="pix-btn tiny" onclick={() => uploadInput?.click()}>
            <Upload size={10} /> {m.treeUploadBtn()}
          </button>
          <button class="pix-btn tiny" onclick={loadExample}>
            {m.treeExampleBtn()}
          </button>
        </div>
        <div class="hint">{m.treeInputHint()}</div>
        {#if parseError && errorSnippet}
          <div class="parse-error">
            <div class="pe-head">{m.treeParseErrorTitle()}</div>
            <div class="pe-msg">
              {errorMessage(parseError)}
              <span class="pe-pos">{m.treePosition({ pos: String(errorSnippet.position + 1) })}</span>
            </div>
            <pre class="pe-snippet">{errorSnippet.before}<mark>{errorSnippet.at || ' '}</mark>{errorSnippet.after}</pre>
          </div>
        {/if}
      </section>

      <section class="pix-section">
        <h3 class="sec-title"><SlidersHorizontal size={11} /> {m.treeSettingsTitle()}</h3>
        <div class="field-label">{m.treeLayoutTitle()}</div>
        <div class="seg-row">
          <button class="seg" class:active={settings.mode === 'phylogram'} onclick={() => setMode('phylogram')}>
            {m.treeLayoutPhylogram()}
          </button>
          <button class="seg" class:active={settings.mode === 'cladogram'} onclick={() => setMode('cladogram')}>
            {m.treeLayoutCladogram()}
          </button>
          <button class="seg" class:active={settings.mode === 'circular'} onclick={() => setMode('circular')}>
            {m.treeLayoutCircular()}
          </button>
        </div>
        {#if layout?.fallbackCladogram && settings.mode !== 'cladogram'}
          <div class="warn-note">{m.treeNoBranchLengths()}</div>
        {/if}

        <label class="range-row">
          <span>{m.treeFontSize()}</span>
          <input type="range" min="6" max="24" step="1" bind:value={settings.fontSize} />
          <b>{settings.fontSize}</b>
        </label>
        <label class="range-row">
          <span>{m.treeBranchWidth()}</span>
          <input type="range" min="0.5" max="5" step="0.5" bind:value={settings.branchWidth} />
          <b>{settings.branchWidth}</b>
        </label>
        <label class="range-row" class:disabled={settings.mode === 'circular'}>
          <span>{m.treeLabelAngle()}</span>
          <input
            type="range"
            min="0"
            max="90"
            step="5"
            bind:value={settings.labelAngle}
            disabled={settings.mode === 'circular'}
          />
          <b>{settings.labelAngle}°</b>
        </label>
        {#if settings.mode === 'circular'}
          <div class="hint">{m.treeLabelAngleNote()}</div>
        {/if}
        <label class="range-row">
          <span>{m.treeSupportThreshold()}</span>
          <input type="range" min="0" max="100" step="1" bind:value={settings.supportThreshold} />
          <b>{settings.supportThreshold}</b>
        </label>
        {#if settings.supportThreshold > 0}
          <div class="hint">{m.treeSupportFiltered()}</div>
        {/if}

        <div class="check-grid">
          <label class="check"><input type="checkbox" bind:checked={settings.showBranchLengths} /> {m.treeShowBranchLengths()}</label>
          <label class="check"><input type="checkbox" bind:checked={settings.showSupport} /> {m.treeShowSupport()}</label>
          <label class="check"><input type="checkbox" bind:checked={settings.showNodeDots} /> {m.treeShowNodeDots()}</label>
          <label class="check"><input type="checkbox" bind:checked={settings.showScaleBar} /> {m.treeShowScaleBar()}</label>
        </div>

        <div class="field-label">{m.treeTheme()}</div>
        <div class="seg-row">
          <button class="seg" class:active={settings.theme === 'dark'} onclick={() => (settings.theme = 'dark')}>
            {m.treeThemeDark()}
          </button>
          <button class="seg" class:active={settings.theme === 'light'} onclick={() => (settings.theme = 'light')}>
            {m.treeThemeLight()}
          </button>
        </div>
        <button class="pix-btn tiny" onclick={resetSettings}>
          <RefreshCw size={10} /> {m.treeResetSettings()}
        </button>
      </section>

      <section class="pix-section">
        <h3 class="sec-title"><ListTree size={11} /> {m.treeBeautifyTitle()}</h3>
        <div class="btn-grid">
          <button class="pix-btn tiny" onclick={() => doLadderize(false)} disabled={!doc}>{m.treeLadderizeAsc()}</button>
          <button class="pix-btn tiny" onclick={() => doLadderize(true)} disabled={!doc}>{m.treeLadderizeDesc()}</button>
          <button class="pix-btn tiny" onclick={doSortAlphabetically} disabled={!doc}>{m.treeSortAlpha()}</button>
          <button class="pix-btn tiny" onclick={doSortByGroup} disabled={!doc}>{m.treeSortGroup()}</button>
          <button class="pix-btn tiny" onclick={() => void doMidpointRoot()} disabled={!doc}>{m.treeMidpointRoot()}</button>
          <button class="pix-btn tiny" onclick={resetTree} disabled={!doc}>{m.treeResetTree()}</button>
        </div>
        {#if doc}
          <div class="root-badge">{doc.rooted ? m.treeRooted() : m.treeUnrooted()}</div>
        {/if}
      </section>

      <section class="pix-section">
        <h3 class="sec-title"><FileText size={11} /> {m.treeFigureSection()}</h3>
        <label class="field-label" for="tree-title-input">{m.treeFigureTitle()}</label>
        <input id="tree-title-input" class="pix-input" bind:value={title} placeholder={m.treeTitlePh()} />
        <label class="field-label" for="tree-caption-input">{m.treeCaption()}</label>
        <textarea id="tree-caption-input" class="pix-input caption-input" rows={3} bind:value={caption} placeholder={m.treeCaptionPh()}></textarea>
      </section>

      <section class="pix-section">
        <h3 class="sec-title"><Download size={11} /> {m.treeExportTitle()}</h3>
        <div class="btn-grid">
          <button class="pix-btn tiny" onclick={() => void exportSvg()} disabled={!doc}>
            <Download size={10} /> {m.treeExportSvg()}
          </button>
          <button class="pix-btn tiny" onclick={() => void exportPng(300)} disabled={!doc}>
            <ImageIcon size={10} /> {m.treeExportPng300()}
          </button>
          <button class="pix-btn tiny" onclick={() => void exportPng(600)} disabled={!doc}>
            <ImageIcon size={10} /> {m.treeExportPng600()}
          </button>
          <button class="pix-btn tiny" onclick={() => void exportNewick(false)} disabled={!doc}>
            <FileText size={10} /> {m.treeExportNewick()}
          </button>
          <button class="pix-btn tiny" onclick={() => void exportNewick(true)} disabled={!doc}>
            <FileText size={10} /> {m.treeExportOriginalNewick()}
          </button>
          <button class="pix-btn tiny" onclick={() => void exportProject()} disabled={!doc}>
            <Braces size={10} /> {m.treeExportProject()}
          </button>
          <button class="pix-btn tiny" onclick={() => projectInput?.click()}>
            <FileUp size={10} /> {m.treeImportProject()}
          </button>
          <button class="pix-btn tiny" onclick={forgetSession}>
            <Trash2 size={10} /> {m.treeAutosaveClear()}
          </button>
        </div>
        <div class="hint">{m.treeExportNote()}</div>
      </section>
    </aside>

    <!-- ============================== CANVAS ============================== -->
    <section class="canvas-col">
      <div class="canvas-toolbar">
        <div class="search-box">
          <Search size={12} />
          <input
            class="search-input"
            bind:this={searchInput}
            value={searchQuery}
            placeholder={m.treeSearchPh()}
            oninput={onSearchInput}
            onkeydown={onSearchKeydown}
          />
          {#if searchQuery.trim()}
            <span class="search-status">{searchStatus}</span>
            <button class="icon-btn" title={m.treeSearchPrev()} onclick={() => void gotoMatch(-1)} disabled={!searchMatches.length}>
              <ChevronLeft size={12} />
            </button>
            <button class="icon-btn" title={m.treeSearchNext()} onclick={() => void gotoMatch(1)} disabled={!searchMatches.length}>
              <ChevronRight size={12} />
            </button>
          {/if}
        </div>
        <span class="toolbar-spacer"></span>
        {#if doc}
          <span class="root-badge small">{doc.rooted ? m.treeRooted() : m.treeUnrooted()}</span>
        {/if}
        <button class="icon-btn" title={m.treeFit()} onclick={() => void fitView()}><Maximize2 size={13} /></button>
        <button class="icon-btn" title={m.treeZoomOut()} onclick={() => zoomCenter(1 / 1.25)}><ZoomOut size={13} /></button>
        <span class="zoom-level">{m.treeZoomLevel({ pct: String(Math.round(zoom * 100)) })}</span>
        <button class="icon-btn" title={m.treeZoomIn()} onclick={() => zoomCenter(1.25)}><ZoomIn size={13} /></button>
        <button class="icon-btn" title={m.treeZoomReset()} onclick={() => void fitView()}><RefreshCw size={13} /></button>
      </div>

      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="canvas-wrap"
        class:drag-over={dragOver}
        class:panning={isPanning}
        bind:this={viewportEl}
        role="application"
        onpointerdown={onPointerDown}
        onwheel={onWheel}
        ondragover={onDragOver}
        ondragleave={() => (dragOver = false)}
        ondrop={onDrop}
        onpointerleave={() => { hoveredId = null; tooltip = null; }}
      >
        {#if layout}
          {@html svgMarkup}
          {#if hoveredNode && tooltip}
            <div class="tree-tooltip" style="left:{tooltip.x}px; top:{tooltip.y}px">
              <div class="tt-name">{hoveredNode.name || m.treeUnnamed()}</div>
              <div class="tt-row"><span>{m.treeBranchLength()}</span><b>{fmtLength(hoveredNode.length)}</b></div>
              <div class="tt-row"><span>{m.treeSupport()}</span><b>{hoveredNode.support === null ? m.treeSupportNone() : formatNumber(hoveredNode.support)}</b></div>
              {#if hoveredNode.group}
                <div class="tt-row"><span>{m.treeGroup()}</span><span><i class="tt-swatch" style="background:{hoveredNode.color ?? '#8b96b5'}"></i> {hoveredNode.group}</span></div>
              {/if}
              <div class="tt-row"><span>{m.treeLeafCount({ n: hoveredNode.leafCount })}</span></div>
              {#if hoveredNode.comment}
                <div class="tt-comment">{hoveredNode.comment}</div>
              {/if}
            </div>
          {/if}
        {:else}
          <div class="canvas-empty" onpointerdown={(event) => event.stopPropagation()}>
            <div class="empty-icon"><TreePine size={54} /></div>
            <div class="empty-title">{m.treeEmptyTitle()}</div>
            <div class="empty-hint">{m.treeEmptyHint()}</div>
            <div class="empty-btns">
              <button class="pix-btn ok" onclick={() => uploadInput?.click()}><Upload size={12} /> {m.treeUploadBtn()}</button>
              <button class="pix-btn" onclick={loadExample}>{m.treeExampleBtn()}</button>
            </div>
            <div class="hint">{m.treeDropHint()}</div>
          </div>
        {/if}
      </div>

      <div class="status-bar">
        {#if layout}
          <span>{m.treeStatusLeaves({ n: String(layout.leafCount) })}</span>
          <span>{m.treeStatusNodes({ n: String(totalNodes) })}</span>
          <span>{m.treeStatusDepth({ value: formatNumber(layout.maxDepth) })}</span>
          {#if collapsed.size > 0}
            <span>{m.treeStatusCollapsed({ n: String(collapsed.size) })}</span>
          {/if}
          {#if layout.fallbackCladogram && settings.mode !== 'cladogram'}
            <span class="warn-text">{m.treeNoBranchLengths()}</span>
          {/if}
        {:else}
          <span>{m.treeLeafCount({ n: '0' })}</span>
        {/if}
        <span class="status-spacer"></span>
        {#if autosaveAt}
          <span class="autosave">{m.treeAutosaveSaved()} {fmtTime(autosaveAt)}</span>
        {/if}
        <span class="hint-inline">{m.treeHoverHint()}</span>
      </div>
    </section>

    <!-- ============================ RIGHT PANEL =========================== -->
    <aside class="panel panel-right">
      <section class="pix-section">
        <h3 class="sec-title"><Palette size={11} /> {m.treeMetadataTitle()}</h3>
        <textarea
          class="input-area meta-area"
          rows={4}
          spellcheck="false"
          placeholder={m.treeMetadataPh()}
          bind:value={metaText}
          oninput={() => { if (metaError) metaError = null; }}
        ></textarea>
        <div class="btn-row">
          <button class="pix-btn tiny ok" onclick={() => applyMetadataText(metaText)}>{m.treeMetadataApply()}</button>
          <button class="pix-btn tiny" onclick={() => metaInput?.click()}>
            <Upload size={10} /> {m.treeMetadataFile()}
          </button>
          <button class="pix-btn tiny" onclick={clearMetadata}>{m.treeMetadataClear()}</button>
        </div>
        {#if metaError}
          <div class="warn-note">{m.treeMetaRowError({ row: String(metaError.row) })}</div>
        {/if}
        <label class="field-label" for="tree-palette">{m.treePalette()}</label>
        <select
          id="tree-palette"
          class="pix-input"
          value={metadata.paletteId}
          onchange={(event) => (metadata.paletteId = (event.currentTarget as HTMLSelectElement).value as PaletteId)}
        >
          {#each PALETTE_IDS as id (id)}
            <option value={id}>{paletteLabel(id)}</option>
          {/each}
        </select>
        <div class="hint">{m.treeMetadataHint()}</div>
      </section>

      <section class="pix-section">
        <h3 class="sec-title"><Palette size={11} /> {m.treeLegendTitle()}</h3>
        {#if focusGroup}
          <button class="pix-btn tiny" onclick={() => (focusGroup = null)}>{m.treeFocusClear()}</button>
          <div class="focused-note">{m.treeFocusedGroup({ group: focusGroup })}</div>
        {/if}
        {#if legend.length > 0 || ungroupedCount > 0}
          <div class="legend">
            {#each legend as item (item.group)}
              <button class="legend-row" class:active={focusGroup === item.group} onclick={() => toggleFocus(item.group)}>
                <span class="swatch" style="background:{item.color}"></span>
                <span class="legend-name">{item.group}</span>
                <span class="legend-count">{item.count}</span>
              </button>
            {/each}
            {#if ungroupedCount > 0}
              <div class="legend-row static">
                <span class="swatch ungrouped"></span>
                <span class="legend-name">{m.treeUngrouped()}</span>
                <span class="legend-count">{ungroupedCount}</span>
              </div>
            {/if}
          </div>
          <div class="hint">{m.treeGroupFocusHint()}</div>
        {:else}
          <div class="hint">{m.treeNoMetadata()}</div>
        {/if}
        <div class="stats-line">
          <span>{m.treeLeafCount({ n: String(totalLeaves) })}</span>
          <span>{m.treeGroupCount({ n: String(legend.length) })}</span>
        </div>
      </section>

      <section class="pix-section">
        <h3 class="sec-title"><Search size={11} /> {m.treeSelectionTitle()}</h3>
        {#if selectedLayout && selectedTreeNode}
          <div class="sel-type">
            {selectedIsInternal ? m.treeSelectedClade() : m.treeSelectedLeaf()}
            {#if selectedLayout.isCollapsed}
              <span class="pill">{m.treeCollapsedBadge({ n: String(selectedLayout.leafCount) })}</span>
            {/if}
          </div>
          <div class="kv"><span>{m.treeName()}</span><b>{selectedLayout.name || m.treeUnnamed()}</b></div>
          <div class="kv"><span>{m.treeBranchLength()}</span><b>{fmtLength(selectedLayout.length)}</b></div>
          <div class="kv"><span>{m.treeSupport()}</span><b>{selectedLayout.support === null ? m.treeSupportNone() : formatNumber(selectedLayout.support)}</b></div>
          {#if selectedLayout.group}
            <div class="kv"><span>{m.treeGroup()}</span><b><i class="swatch inline" style="background:{selectedLayout.color ?? '#8b96b5'}"></i> {selectedLayout.group}</b></div>
          {/if}
          {#if selectedIsInternal}
            <div class="kv"><span>{m.treeChildren()}</span><b>{selectedTreeNode?.children.length ?? 0}</b></div>
          {/if}
          <div class="kv"><span>{m.treeLeaf()}</span><b>{selectedLayout.leafCount}</b></div>
          {#if selectedLayout.comment}
            <div class="kv"><span>{m.treeComment()}</span><b class="comment">{selectedLayout.comment}</b></div>
          {/if}
          <div class="path-note">{m.treePathToRoot()}</div>
          <div class="btn-grid">
            {#if selectedIsInternal}
              <button class="pix-btn tiny" onclick={toggleSelectedCollapse}>
                {selectedCollapsed ? m.treeExpand() : m.treeCollapse()}
              </button>
              <button class="pix-btn tiny" onclick={rotateSelected} disabled={(selectedTreeNode?.children.length ?? 0) < 2}>
                <RotateCw size={10} /> {m.treeRotate()}
              </button>
            {/if}
            <button class="pix-btn tiny" onclick={() => (selectedId = null)}>{m.treeClearSelection()}</button>
          </div>
        {:else}
          <div class="hint">{m.treeNoSelection()}</div>
          <div class="hint">{m.treeHoverHint()}</div>
        {/if}
      </section>

      <section class="pix-section shortcuts">
        <h3 class="sec-title"><SlidersHorizontal size={11} /> {m.treeShortcutsTitle()}</h3>
        <div class="shortcut"><kbd>F</kbd><span>{m.treeShortcutFit()}</span></div>
        <div class="shortcut"><kbd>+</kbd><kbd>-</kbd><span>{m.treeShortcutZoom()}</span></div>
        <div class="shortcut"><kbd>/</kbd><span>{m.treeShortcutSearch()}</span></div>
        <div class="shortcut"><kbd>Esc</kbd><span>{m.treeShortcutEscape()}</span></div>
        <div class="shortcut"><kbd>R</kbd><span>{m.treeShortcutRotate()}</span></div>
        <div class="shortcut"><kbd>C</kbd><span>{m.treeShortcutCollapse()}</span></div>
        <div class="shortcut"><kbd>L</kbd><span>{m.treeShortcutLadderize()}</span></div>
      </section>
    </aside>
  </div>
</div>

<input class="hidden-input" type="file" accept=".nwk,.tree,.newick,.txt" bind:this={uploadInput} onchange={onUploadPicked} />
<input class="hidden-input" type="file" accept=".csv,.tsv,.txt" bind:this={metaInput} onchange={onMetadataPicked} />
<input class="hidden-input" type="file" accept=".json,application/json" bind:this={projectInput} onchange={onProjectPicked} />

<style>
  .tree-tool {
    flex: 1;
    min-height: 0;
    display: flex;
    background: var(--pix-bg);
    font-family: var(--pix-font);
    overflow: hidden;
  }
  .tree-workspace {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 268px minmax(0, 1fr) 292px;
    grid-template-rows: minmax(0, 1fr);
    overflow: hidden;
  }

  /* ---------------------------------------------------------- panels */
  .panel {
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--pix-bg-2);
  }
  .panel-left { border-right: 2px solid var(--pix-border); }
  .panel-right { border-left: 2px solid var(--pix-border); }
  .pix-section {
    padding: 9px 10px 11px;
    border-bottom: 2px solid var(--pix-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sec-title {
    margin: 0;
    font-size: 9.5px;
    font-weight: 900;
    letter-spacing: 1.4px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .hint {
    font-size: 9px;
    line-height: 1.55;
    color: var(--pix-fg-dim);
  }
  .warn-note {
    font-size: 9.5px;
    line-height: 1.5;
    color: var(--pix-accent);
    border: 1px dashed var(--pix-accent);
    background: rgba(255, 159, 28, 0.08);
    padding: 4px 6px;
  }
  .warn-text { color: var(--pix-accent); }

  .input-area {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 64px;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 10px;
    line-height: 1.5;
    padding: 5px 7px;
  }
  .input-area:focus { outline: none; border-color: var(--pix-cyan); }
  .meta-area { min-height: 60px; }
  .caption-input { resize: vertical; font-size: 10px; }

  .btn-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .btn-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
  }
  .btn-grid .pix-btn, .btn-row .pix-btn { justify-content: center; }
  .pix-btn.tiny {
    font-size: 9px;
    padding: 3px 6px;
    letter-spacing: 0.4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    box-shadow: 2px 2px 0 rgba(0, 0, 0, 0.55);
  }
  .pix-btn.tiny:disabled, .icon-btn:disabled { opacity: 0.42; cursor: default; }

  .field-label {
    font-size: 9px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--pix-fg-dim);
    font-weight: 700;
  }
  .pix-input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--pix-font);
    font-size: 10.5px;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg);
    padding: 3px 6px;
  }
  .pix-input:focus { outline: none; border-color: var(--pix-cyan); }

  .seg-row { display: flex; gap: 4px; flex-wrap: wrap; }
  .seg {
    flex: 1 1 auto;
    font-family: var(--pix-font);
    font-size: 9px;
    padding: 3px 6px;
    cursor: pointer;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg-dim);
    white-space: nowrap;
  }
  .seg:hover { border-color: var(--pix-border-hi); color: var(--pix-fg); }
  .seg.active { border-color: var(--pix-cyan); color: var(--pix-cyan); box-shadow: inset 0 0 0 1px rgba(76, 214, 255, 0.25); }

  .range-row {
    display: grid;
    grid-template-columns: 74px 1fr 28px;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    color: var(--pix-fg-dim);
  }
  .range-row b { font-size: 9.5px; color: var(--pix-fg); text-align: right; }
  .range-row input[type='range'] { width: 100%; accent-color: var(--pix-cyan); }
  .range-row.disabled { opacity: 0.45; }

  .check-grid { display: grid; grid-template-columns: 1fr; gap: 3px; }
  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 9.5px;
    color: var(--pix-fg-dim);
    cursor: pointer;
  }
  .check input { accent-color: var(--pix-cyan); }
  .hint-inline { font-size: 8.5px; color: var(--pix-fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 42%; }
  .root-badge {
    align-self: flex-start;
    font-size: 8.5px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--pix-green);
    border: 1px solid var(--pix-green);
    padding: 1px 6px;
  }
  .root-badge.small { margin-right: 4px; }

  /* --------------------------------------------------------- canvas */
  .canvas-col { display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--pix-bg); }
  .canvas-toolbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    background: var(--pix-bg-2);
    border-bottom: 2px solid var(--pix-border);
    min-height: 30px;
  }
  .toolbar-spacer { flex: 1; }
  .search-box {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    padding: 2px 6px;
    color: var(--pix-fg-dim);
    max-width: 390px;
    flex: 0 1 auto;
  }
  .search-box:focus-within { border-color: var(--pix-cyan); }
  .search-input {
    background: transparent;
    border: none;
    outline: none;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 10.5px;
    min-width: 120px;
    width: 160px;
  }
  .search-status { font-size: 8.5px; white-space: nowrap; color: var(--pix-fg-dim); }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    background: var(--pix-bg-3);
    border: 2px solid var(--pix-border);
    color: var(--pix-fg-dim);
    cursor: pointer;
  }
  .icon-btn:hover { color: var(--pix-cyan); border-color: var(--pix-cyan); }
  .zoom-level { font-size: 8.5px; color: var(--pix-fg-dim); min-width: 54px; text-align: center; }

  .canvas-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    background: var(--pix-bg);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .canvas-wrap.panning { cursor: grabbing; }
  .canvas-wrap.drag-over { outline: 2px dashed var(--pix-cyan); outline-offset: -4px; }
  .canvas-wrap :global(svg.tree-svg) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .canvas-wrap :global(text) { user-select: none; }

  .canvas-empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--pix-fg-dim);
    text-align: center;
    padding: 24px;
  }
  .empty-icon { color: var(--pix-cyan); display: inline-flex; filter: drop-shadow(0 0 8px rgba(76, 214, 255, 0.35)); }
  .empty-title { font-size: 15px; font-weight: 900; letter-spacing: 1.5px; color: var(--pix-accent-2); }
  .empty-hint { font-size: 11px; max-width: 430px; line-height: 1.7; }
  .empty-btns { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .empty-btns .pix-btn { display: inline-flex; align-items: center; gap: 5px; }

  .status-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 3px 8px;
    background: var(--pix-bg-2);
    border-top: 2px solid var(--pix-border);
    font-size: 8.5px;
    color: var(--pix-fg-dim);
    white-space: nowrap;
    overflow: hidden;
  }
  .status-spacer { flex: 1; }
  .autosave { color: var(--pix-green); }

  .tree-tooltip {
    position: absolute;
    z-index: 20;
    pointer-events: none;
    min-width: 180px;
    max-width: 225px;
    padding: 6px 8px;
    background: var(--pix-bg-2);
    border: 2px solid var(--pix-border-hi);
    border-left: 4px solid var(--pix-cyan);
    box-shadow: 4px 4px 0 rgba(0, 0, 0, 0.55);
    font-size: 9.5px;
    color: var(--pix-fg);
  }
  .tt-name { font-size: 10.5px; font-weight: 700; color: var(--pix-cyan); margin-bottom: 3px; word-break: break-word; }
  .tt-row { display: flex; justify-content: space-between; gap: 8px; color: var(--pix-fg-dim); line-height: 1.5; }
  .tt-row b { color: var(--pix-fg); font-weight: 700; }
  .tt-swatch { display: inline-block; width: 10px; height: 10px; border: 1px solid var(--pix-border-hi); }
  .tt-comment { margin-top: 3px; font-size: 8.5px; color: var(--pix-fg-dim); font-style: italic; word-break: break-word; }

  .parse-error {
    border: 2px solid var(--pix-red);
    background: rgba(255, 93, 93, 0.08);
    padding: 5px 7px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .pe-head { font-size: 9.5px; font-weight: 700; color: var(--pix-red); }
  .pe-msg { font-size: 9px; color: var(--pix-fg); line-height: 1.5; }
  .pe-pos { color: var(--pix-fg-dim); margin-left: 4px; }
  .pe-snippet {
    margin: 0;
    font-size: 8.5px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
  }
  .pe-snippet mark { background: var(--pix-red); color: #fff; padding: 0 1px; }

  /* ----------------------------------------------------- right panel */
  .legend { display: flex; flex-direction: column; gap: 2px; }
  .legend-row {
    display: grid;
    grid-template-columns: 12px 1fr auto;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--pix-fg-dim);
    font-family: var(--pix-font);
    font-size: 9.5px;
    text-align: left;
    padding: 2px 4px;
    cursor: pointer;
  }
  .legend-row:hover { border-color: var(--pix-border-hi); color: var(--pix-fg); }
  .legend-row.active { border-color: var(--pix-cyan); color: var(--pix-cyan); background: rgba(76, 214, 255, 0.07); }
  .legend-row.static { cursor: default; }
  .legend-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .legend-count { color: var(--pix-fg-dim); }
  .swatch { width: 10px; height: 10px; border: 1px solid var(--pix-border-hi); display: inline-block; }
  .swatch.ungrouped { background: repeating-linear-gradient(45deg, #2a3450, #2a3450 2px, #10141f 2px, #10141f 4px); }
  .swatch.inline { display: inline-block; }
  .focused-note { font-size: 8.5px; color: var(--pix-cyan); }
  .stats-line { display: flex; justify-content: space-between; font-size: 8.5px; color: var(--pix-fg-dim); border-top: 1px dashed var(--pix-border); padding-top: 4px; }

  .sel-type { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--pix-accent-2); font-weight: 700; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .pill { font-size: 8px; letter-spacing: 0.4px; text-transform: none; color: var(--pix-fg-dim); border: 1px solid var(--pix-border-hi); padding: 0 4px; }
  .kv { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 5px; font-size: 9.5px; color: var(--pix-fg-dim); align-items: center; }
  .kv b { color: var(--pix-fg); font-weight: 700; word-break: break-word; }
  .kv .comment { font-weight: 400; font-style: italic; }
  .path-note { font-size: 8.5px; color: var(--pix-cyan); }

  .shortcuts { gap: 3px; }
  .shortcut { display: grid; grid-template-columns: auto 1fr; gap: 6px; align-items: center; font-size: 8.5px; color: var(--pix-fg-dim); }
  .shortcut kbd {
    font-family: var(--pix-font);
    font-size: 8px;
    border: 1px solid var(--pix-border-hi);
    background: var(--pix-bg-3);
    color: var(--pix-fg);
    padding: 0 4px;
  }

  .hidden-input { display: none; }

  /* ------------------------------------------------------- responsive */
  @media (max-width: 1180px) {
    .tree-workspace {
      grid-template-columns: 232px minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
    }
    .panel-right {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border-left: none;
      border-top: 2px solid var(--pix-border);
      max-height: 260px;
    }
    .panel-right .pix-section { border-bottom: none; border-right: 2px solid var(--pix-border); }
  }
  @media (max-width: 780px) {
    .tree-workspace {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto auto;
      grid-auto-rows: min-content;
      overflow-y: auto;
    }
    .panel-left { max-height: 40vh; border-right: none; border-bottom: 2px solid var(--pix-border); }
    .panel-right { grid-template-columns: 1fr; max-height: 300px; }
    .panel-right .pix-section { border-right: none; }
    .canvas-col { min-height: 46vh; }
    .hint-inline { display: none; }
    .search-input { width: 110px; min-width: 90px; }
  }
</style>
