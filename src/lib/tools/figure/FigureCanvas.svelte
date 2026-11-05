<script lang="ts">
  // Interactive SVG canvas for Figure Studio. The canvas owns pointer gestures
  // and viewport pan/zoom, while the document itself stays in the orchestrator
  // so history and project write-back see every mutation.
  import { onMount } from 'svelte';
  import {
    alignmentGuides,
    handlePoints,
    hitTestHandle,
    hitTestNode,
    moveNodes,
    nodeBounds,
    nodesBounds,
    resizeRect,
    snapNodeRect,
    type AlignmentGuide,
    type Handle,
    type Point,
    type Rect
  } from './geometry';
  import { isNodeVisible, lineEndpoints } from './render';
  import { renderChartNode } from './charts';
  import { renderScaleBarNode } from './scalebar';
  import { renderPathNode } from './paths';
  import { fm } from './messages';
  import {
    PT_TO_PX,
    clamp,
    createEllipseNode,
    createLineNode,
    createRectNode,
    createTextNode,
    documentHeightPx,
    documentWidthPx,
    mmToPx,
    selectionWithGroups,
    type AssetNode,
    type FigureDocument,
    type FigureNode,
    type ImageNode,
    type LineNode,
    type TextNode
  } from './types';

  export type FigureToolId = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'pan';

  interface CanvasProps {
    doc: FigureDocument;
    selectedIds: string[];
    tool: FigureToolId;
    zoom: number;
    pan: Point;
    onSelect: (ids: string[]) => void;
    onBegin: () => void;
    onEnd: () => void;
    onReplaceNodes: (nodes: FigureNode[]) => void;
    onAddNode: (node: FigureNode, keepTool: boolean) => void;
    onZoomAt: (nextZoom: number, screenX: number, screenY: number) => void;
    onPanChange: (next: Point) => void;
    onViewportChange: (size: { w: number; h: number }) => void;
    onEditText: (id: string) => void;
  }

  let {
    doc,
    selectedIds,
    tool,
    zoom,
    pan,
    onSelect,
    onBegin,
    onEnd,
    onReplaceNodes,
    onAddNode,
    onZoomAt,
    onPanChange,
    onViewportChange,
    onEditText
  }: CanvasProps = $props();

  type CreateTool = 'rect' | 'ellipse' | 'line' | 'arrow';

  interface MoveDrag {
    kind: 'move';
    start: Point;
    ids: string[];
    startNodes: FigureNode[];
    startBounds: Rect;
    blocked: Set<string>;
  }
  interface ResizeDrag {
    kind: 'resize';
    start: Point;
    nodeId: string;
    handle: Handle;
    startRect: Rect;
    lockAspect: boolean;
  }
  interface RotateDrag {
    kind: 'rotate';
    nodeId: string;
    centre: Point;
    startAngle: number;
    startRotation: number;
  }
  interface MarqueeDrag {
    kind: 'marquee';
    start: Point;
    current: Point;
    base: string[];
  }
  interface CreateDrag {
    kind: 'create';
    tool: CreateTool;
    start: Point;
    current: Point;
  }
  interface PanDrag {
    kind: 'pan';
    startClient: Point;
    startPan: Point;
  }
  type DragState = MoveDrag | ResizeDrag | RotateDrag | MarqueeDrag | CreateDrag | PanDrag;

  const HANDLE_KEYS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
  const CREATE_TOOLS: readonly FigureToolId[] = ['rect', 'ellipse', 'line', 'arrow'];
  /** Smart guides feel constant on screen, like the grid threshold. */
  const GUIDE_THRESHOLD_PX = 6;

  let viewportEl = $state<HTMLDivElement | null>(null);
  let drag = $state<DragState | null>(null);
  let hoverHandle = $state<Handle | null>(null);
  let spaceDown = $state(false);
  let viewportBox = $state({ w: 0, h: 0 });
  let guideLines = $state<AlignmentGuide[]>([]);

  const pageW = $derived(documentWidthPx(doc));
  const pageH = $derived(documentHeightPx(doc));
  const selectedNodes = $derived(doc.nodes.filter((node) => selectedIds.includes(node.id)));
  const singleNode = $derived(selectedNodes.length === 1 ? selectedNodes[0] : null);
  const singleBounds = $derived(singleNode ? nodeBounds(singleNode) : null);
  const handleMap = $derived(singleBounds ? handlePoints(singleBounds) : null);
  const rotatePoint = $derived(
    singleBounds
      ? { x: singleBounds.x + singleBounds.w / 2, y: singleBounds.y - 24 / zoom }
      : null
  );
  const multiBounds = $derived(selectedNodes.length > 1 ? nodesBounds(selectedNodes) : null);
  const handleSize = $derived(9 / zoom);

  const grid = $derived.by(() => {
    if (!doc.grid.show) return { minor: '', major: '' };
    const step = mmToPx(doc.grid.sizeMm);
    if (!(step > 0) || step * zoom < 1.5) return { minor: '', major: '' };
    const minor: string[] = [];
    const major: string[] = [];
    let index = 1;
    for (let x = step; x < pageW - 0.01; x += step, index++) {
      (index % 5 === 0 ? major : minor).push(`M${round(x)} 0V${round(pageH)}`);
    }
    index = 1;
    for (let y = step; y < pageH - 0.01; y += step, index++) {
      (index % 5 === 0 ? major : minor).push(`M0 ${round(y)}H${round(pageW)}`);
    }
    return { minor: minor.join(' '), major: major.join(' ') };
  });

  const cursor = $derived.by(() => {
    if (drag?.kind === 'pan') return 'grabbing';
    if (tool === 'pan' || spaceDown) return 'grab';
    if (CREATE_TOOLS.includes(tool) || tool === 'text') return 'crosshair';
    if (hoverHandle === 'rotate') return 'grab';
    if (hoverHandle === 'nw' || hoverHandle === 'se') return 'nwse-resize';
    if (hoverHandle === 'ne' || hoverHandle === 'sw') return 'nesw-resize';
    if (hoverHandle === 'n' || hoverHandle === 's') return 'ns-resize';
    if (hoverHandle === 'e' || hoverHandle === 'w') return 'ew-resize';
    return 'default';
  });

  function round(value: number): number {
    return Math.round(value * 100) / 100;
  }

  function clampPoint(point: Point): Point {
    return { x: clamp(point.x, 0, pageW), y: clamp(point.y, 0, pageH) };
  }

  function screenToDoc(event: PointerEvent | WheelEvent | MouseEvent): Point {
    const el = viewportEl;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - el.clientLeft - pan.x) / Math.max(0.0001, zoom),
      y: (event.clientY - rect.top - el.clientTop - pan.y) / Math.max(0.0001, zoom)
    };
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'SELECT' ||
      el.isContentEditable
    );
  }

  function groupLocked(node: FigureNode): boolean {
    if (!node.groupId) return false;
    return !!doc.groups.find((group) => group.id === node.groupId)?.locked;
  }

  function isLocked(node: FigureNode): boolean {
    return node.locked || groupLocked(node) || node.hidden;
  }

  /** Screen-constant rotate handle plus the eight axis-aligned resize handles. */
  function handleAt(node: FigureNode, point: Point): Handle | null {
    if (rotatePoint && Math.hypot(point.x - rotatePoint.x, point.y - rotatePoint.y) <= 10 / zoom) {
      return 'rotate';
    }
    const handle = hitTestHandle(node, point.x, point.y, 10 / zoom);
    return handle === 'rotate' ? null : handle;
  }

  function cloneNode(node: FigureNode): FigureNode {
    return { ...node } as FigureNode;
  }

  function nodeAt(point: Point): FigureNode | null {
    for (let index = doc.nodes.length - 1; index >= 0; index -= 1) {
      const node = doc.nodes[index];
      if (!isNodeVisible(doc, node)) continue;
      if (hitTestNode(node, point.x, point.y)) return node;
    }
    return null;
  }

  function expandedSelection(ids: string[]): string[] {
    return selectionWithGroups(doc, ids);
  }

  /**
   * Visible nodes that are not part of the active drag are alignment targets.
   * Locked nodes stay eligible; hidden nodes (and hidden groups) do not.
   */
  function alignmentTargets(excluded: ReadonlySet<string>): Rect[] {
    const rects: Rect[] = [];
    for (const node of doc.nodes) {
      if (excluded.has(node.id) || !isNodeVisible(doc, node)) continue;
      rects.push(nodeBounds(node));
    }
    return rects;
  }

  function intersects(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function capturePointer(event: PointerEvent) {
    viewportEl?.setPointerCapture(event.pointerId);
  }

  function releasePointer(event: PointerEvent) {
    if (viewportEl?.hasPointerCapture(event.pointerId)) viewportEl.releasePointerCapture(event.pointerId);
  }

  function startPan(event: PointerEvent) {
    drag = {
      kind: 'pan',
      startClient: { x: event.clientX, y: event.clientY },
      startPan: { x: pan.x, y: pan.y }
    };
    capturePointer(event);
  }

  function startMove(point: Point, ids: string[]) {
    const movable = doc.nodes.filter((node) => ids.includes(node.id) && !isLocked(node));
    if (!movable.length) return;
    const bounds = nodesBounds(movable);
    if (!bounds) return;
    onBegin();
    drag = {
      kind: 'move',
      start: point,
      ids: movable.map((node) => node.id),
      startNodes: doc.nodes.map(cloneNode),
      startBounds: bounds,
      blocked: new Set(doc.nodes.filter((node) => isLocked(node)).map((node) => node.id))
    };
  }

  function onPointerDown(event: PointerEvent) {
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button === 1) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    guideLines = [];
    const point = screenToDoc(event);

    if (tool === 'pan' || spaceDown) {
      event.preventDefault();
      startPan(event);
      return;
    }

    if (tool === 'text') {
      event.preventDefault();
      const target = clampPoint(point);
      onBegin();
      const node = createTextNode(target.x, target.y, fm.figTextTool());
      onAddNode(node, event.shiftKey);
      onEnd();
      return;
    }

    if ((CREATE_TOOLS as readonly string[]).includes(tool)) {
      event.preventDefault();
      onBegin();
      const target = clampPoint(point);
      drag = { kind: 'create', tool: tool as CreateTool, start: target, current: target };
      capturePointer(event);
      return;
    }

    if (singleNode && singleBounds && handleMap && !isLocked(singleNode)) {
      const handle = handleAt(singleNode, point);
      if (handle) {
        event.preventDefault();
        onBegin();
        if (handle === 'rotate') {
          const centre = {
            x: singleNode.x + singleNode.w / 2,
            y: singleNode.y + singleNode.h / 2
          };
          drag = {
            kind: 'rotate',
            nodeId: singleNode.id,
            centre,
            startAngle: Math.atan2(point.y - centre.y, point.x - centre.x) * (180 / Math.PI),
            startRotation: singleNode.rotation
          };
        } else {
          drag = {
            kind: 'resize',
            start: point,
            nodeId: singleNode.id,
            handle,
            startRect: { x: singleNode.x, y: singleNode.y, w: singleNode.w, h: singleNode.h },
            lockAspect: singleNode.type === 'image' && !!singleNode.lockAspect
          };
        }
        capturePointer(event);
        return;
      }
    }

    const hit = nodeAt(point);
    if (hit) {
      event.preventDefault();
      const base = expandedSelection([hit.id]);
      const allSelected = base.every((id) => selectedIds.includes(id));
      let next: string[];
      if (event.shiftKey) {
        next = allSelected
          ? selectedIds.filter((id) => !base.includes(id))
          : [...new Set([...selectedIds, ...base])];
      } else if (selectedIds.includes(hit.id)) {
        // Keep a multi-selection intact so dragging one member moves them all.
        next = selectedIds;
      } else {
        next = base;
      }
      onSelect(next);
      if (!event.shiftKey && next.includes(hit.id) && !isLocked(hit)) {
        startMove(point, next);
      }
      capturePointer(event);
      return;
    }

    const base = event.shiftKey ? selectedIds : [];
    if (!event.shiftKey && selectedIds.length) onSelect([]);
    drag = { kind: 'marquee', start: point, current: point, base };
    capturePointer(event);
  }

  function onPointerMove(event: PointerEvent) {
    if (!event.isPrimary) return;
    const point = screenToDoc(event);
    const current = drag;

    if (!current) {
      if (tool === 'select' && singleNode && !isLocked(singleNode)) {
        const next = handleAt(singleNode, point);
        if (next !== hoverHandle) hoverHandle = next;
      } else if (hoverHandle) {
        hoverHandle = null;
      }
      return;
    }

    switch (current.kind) {
      case 'pan': {
        onPanChange({
          x: current.startPan.x + (event.clientX - current.startClient.x),
          y: current.startPan.y + (event.clientY - current.startClient.y)
        });
        break;
      }
      case 'move': {
        let dx = point.x - current.start.x;
        let dy = point.y - current.start.y;
        let proposed: Rect = {
          x: current.startBounds.x + dx,
          y: current.startBounds.y + dy,
          w: current.startBounds.w,
          h: current.startBounds.h
        };
        if (doc.grid.snap) {
          const step = mmToPx(doc.grid.sizeMm);
          if (step > 0) {
            proposed = snapNodeRect(proposed, step, Math.min(step / 2, 5 / zoom));
          }
        }
        // Smart guides take over after the grid snap whenever another object is
        // within six screen pixels of a start/centre/end edge.
        const excluded = new Set([...selectedIds, ...current.ids]);
        const aligned = alignmentGuides(
          proposed,
          alignmentTargets(excluded),
          GUIDE_THRESHOLD_PX / zoom
        );
        guideLines = aligned.guides;
        dx = aligned.rect.x - current.startBounds.x;
        dy = aligned.rect.y - current.startBounds.y;
        const moved = moveNodes(current.startNodes, current.ids, dx, dy);
        onReplaceNodes(
          moved.map((node, index) => (current.blocked.has(node.id) ? current.startNodes[index] : node))
        );
        break;
      }
      case 'resize': {
        const dx = point.x - current.start.x;
        const dy = point.y - current.start.y;
        let rect = resizeRect(
          current.startRect,
          current.handle,
          dx,
          dy,
          event.shiftKey || current.lockAspect
        );
        // Snapping either axis would break a locked aspect ratio, so both the
        // grid and the smart guides step aside in that mode.
        if (doc.grid.snap && !current.lockAspect) {
          const step = mmToPx(doc.grid.sizeMm);
          if (step > 0) rect = snapNodeRect(rect, step, Math.min(step / 2, 5 / zoom));
        }
        const resized = doc.nodes.find((node) => node.id === current.nodeId);
        if (resized && !resized.rotation && !current.lockAspect) {
          // Rotated nodes keep their own frame, so guides would fight the
          // existing bounds rounding. Only align the axis-aligned case.
          const excluded = new Set([...selectedIds, current.nodeId]);
          const aligned = alignmentGuides(
            rect,
            alignmentTargets(excluded),
            GUIDE_THRESHOLD_PX / zoom
          );
          rect = aligned.rect;
          guideLines = aligned.guides;
        } else {
          guideLines = [];
        }
        onReplaceNodes(
          doc.nodes.map((node) =>
            node.id === current.nodeId
              ? { ...node, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
              : node
          )
        );
        break;
      }
      case 'rotate': {
        guideLines = [];
        const angle = Math.atan2(point.y - current.centre.y, point.x - current.centre.x) * (180 / Math.PI);
        let rotation = current.startRotation + (angle - current.startAngle);
        if (event.shiftKey) rotation = Math.round(rotation / 15) * 15;
        rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
        onReplaceNodes(
          doc.nodes.map((node) => (node.id === current.nodeId ? { ...node, rotation } : node))
        );
        break;
      }
      case 'marquee': {
        current.current = point;
        drag = current;
        const rect: Rect = {
          x: Math.min(current.start.x, point.x),
          y: Math.min(current.start.y, point.y),
          w: Math.abs(point.x - current.start.x),
          h: Math.abs(point.y - current.start.y)
        };
        const hits: string[] = [];
        for (const node of doc.nodes) {
          if (!isNodeVisible(doc, node)) continue;
          if (intersects(nodeBounds(node), rect)) hits.push(node.id);
        }
        const expanded = expandedSelection(hits);
        onSelect([...new Set([...current.base, ...expanded])]);
        break;
      }
      case 'create': {
        current.current = clampPoint(point);
        drag = current;
        break;
      }
    }
  }

  function finishCreate(current: CreateDrag, shift: boolean) {
    const start = current.start;
    const end = current.current;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    let node: FigureNode | null = null;

    if (current.tool === 'rect' || current.tool === 'ellipse') {
      const w = Math.abs(dx);
      const h = Math.abs(dy);
      if (w < 4 || h < 4) return;
      if (current.tool === 'rect') {
        node = createRectNode(left, top, w, h);
        node.name = fm.figRect();
      } else {
        node = createEllipseNode(left, top, w, h);
        node.name = fm.figEllipse();
      }
    } else {
      const length = Math.hypot(dx, dy);
      if (length < 4) return;
      const w = Math.max(4, Math.abs(dx));
      const h = Math.max(4, Math.abs(dy));
      const x = Math.abs(dx) < 4 ? start.x - w / 2 : left;
      const y = Math.abs(dy) < 4 ? start.y - h / 2 : top;
      const arrow = current.tool === 'arrow';
      const line = createLineNode(x, y, w, h, arrow);
      line.name = arrow ? fm.figArrow() : fm.figLine();
      line.direction = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
      if (arrow) {
        const backwards = line.direction === 'horizontal' ? dx < 0 : dy < 0;
        line.headStart = backwards;
        line.headEnd = !backwards;
      }
      node = line;
    }

    const x = clamp(node.x, 0, Math.max(0, pageW - node.w));
    const y = clamp(node.y, 0, Math.max(0, pageH - node.h));
    node = { ...node, x, y };
    onAddNode(node, shift);
  }

  function onPointerUp(event: PointerEvent) {
    const current = drag;
    drag = null;
    hoverHandle = null;
    guideLines = [];
    releasePointer(event);
    if (!current) return;

    if (current.kind === 'create') {
      finishCreate(current, event.shiftKey);
      onEnd();
      return;
    }
    if (current.kind === 'move' || current.kind === 'resize' || current.kind === 'rotate') {
      onEnd();
    }
  }

  function onPointerCancel(event: PointerEvent) {
    const current = drag;
    drag = null;
    hoverHandle = null;
    guideLines = [];
    releasePointer(event);
    if (current?.kind === 'create') {
      onEnd();
    } else if (current?.kind === 'move' || current?.kind === 'resize' || current?.kind === 'rotate') {
      onEnd();
    }
  }

  function onDoubleClick(event: MouseEvent) {
    const point = screenToDoc(event);
    const hit = nodeAt(point);
    if (hit?.type === 'text') onEditText(hit.id);
  }

  function onWheel(event: WheelEvent) {
    event.preventDefault();
    const el = viewportEl;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const next = clamp(zoom * factor, 0.05, 8);
      onZoomAt(next, event.clientX - rect.left - el.clientLeft, event.clientY - rect.top - el.clientTop);
      return;
    }
    onPanChange({ x: pan.x - event.deltaX, y: pan.y - event.deltaY });
  }

  function arrowPoints(tipX: number, tipY: number, fromX: number, fromY: number, size: number): string {
    const angle = Math.atan2(tipY - fromY, tipX - fromX);
    const spread = 0.45;
    const ax = tipX - size * Math.cos(angle - spread);
    const ay = tipY - size * Math.sin(angle - spread);
    const bx = tipX - size * Math.cos(angle + spread);
    const by = tipY - size * Math.sin(angle + spread);
    return `${round(tipX)},${round(tipY)} ${round(ax)},${round(ay)} ${round(bx)},${round(by)}`;
  }

  function dashArray(node: FigureNode): string | undefined {
    if (node.dash === 'dashed') {
      return `${Math.max(3, node.strokeWidth * 3)} ${Math.max(2, node.strokeWidth * 2)}`;
    }
    if (node.dash === 'dotted') {
      return `${Math.max(0.75, node.strokeWidth)} ${Math.max(1.5, node.strokeWidth * 2)}`;
    }
    return undefined;
  }

  function isNone(color: string | undefined): boolean {
    const value = (color ?? '').trim().toLowerCase();
    return !value || value === 'none' || value === 'transparent';
  }

  function preserveAspect(fit: string): string {
    if (fit === 'cover') return 'xMidYMid slice';
    if (fit === 'stretch') return 'none';
    return 'xMidYMid meet';
  }

  function textAnchor(align: string): string {
    return align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
  }

  function flipTransform(node: AssetNode | ImageNode): string | undefined {
    if (!node.flipX && !node.flipY) return undefined;
    const cx = node.x + node.w / 2;
    const cy = node.y + node.h / 2;
    const sx = node.flipX ? -1 : 1;
    const sy = node.flipY ? -1 : 1;
    return `translate(${round(cx)} ${round(cy)}) scale(${sx} ${sy}) translate(${round(-cx)} ${round(-cy)})`;
  }

  function draftRect(current: CreateDrag): Rect {
    return {
      x: Math.min(current.start.x, current.current.x),
      y: Math.min(current.start.y, current.current.y),
      w: Math.abs(current.current.x - current.start.x),
      h: Math.abs(current.current.y - current.start.y)
    };
  }

  function draftLine(current: CreateDrag) {
    const horizontal = Math.abs(current.current.x - current.start.x) >= Math.abs(current.current.y - current.start.y);
    if (horizontal) {
      return {
        x1: current.start.x,
        y1: current.start.y,
        x2: current.current.x,
        y2: current.start.y
      };
    }
    return {
      x1: current.start.x,
      y1: current.start.y,
      x2: current.start.x,
      y2: current.current.y
    };
  }

  onMount(() => {
    const el = viewportEl;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
      if (next.w !== viewportBox.w || next.h !== viewportBox.h) {
        viewportBox = next;
        onViewportChange(next);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  });

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || isEditableTarget(event.target)) return;
      if (event.type === 'keydown') {
        if (!spaceDown) spaceDown = true;
        event.preventDefault();
      } else {
        spaceDown = false;
      }
    };
    const reset = () => (spaceDown = false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      window.removeEventListener('blur', reset);
    };
  });
</script>

<div
  class="canvas-viewport"
  data-testid="figure-canvas"
  bind:this={viewportEl}
  role="application"
  aria-label="Figure canvas"
  style:cursor
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerCancel}
  onpointerleave={() => (hoverHandle = null)}
  ondblclick={onDoubleClick}
  onwheel={onWheel}
>
  <div
    class="page-frame"
    style:width={`${pageW * zoom}px`}
    style:height={`${pageH * zoom}px`}
    style:transform={`translate(${pan.x}px, ${pan.y}px)`}
  >
    <svg
      class="figure-page"
      data-testid="figure-page"
      xmlns="http://www.w3.org/2000/svg"
      width={pageW * zoom}
      height={pageH * zoom}
      viewBox={`0 0 ${pageW} ${pageH}`}
    >
      <rect x="0" y="0" width={pageW} height={pageH} fill={doc.background || '#ffffff'} />

      {#if grid.minor}
        <path d={grid.minor} fill="none" stroke="rgba(31,111,139,0.16)" stroke-width={1 / zoom} />
      {/if}
      {#if grid.major}
        <path d={grid.major} fill="none" stroke="rgba(31,111,139,0.32)" stroke-width={1.2 / zoom} />
      {/if}

      {#each doc.nodes as node (node.id)}
        {#if isNodeVisible(doc, node)}
          <g
            data-testid="figure-node"
            data-node-id={node.id}
            data-node-type={node.type}
            opacity={node.opacity < 1 ? node.opacity : undefined}
            transform={node.rotation
              ? `rotate(${round(node.rotation)} ${round(node.x + node.w / 2)} ${round(node.y + node.h / 2)})`
              : undefined}
          >
            {#if node.type === 'rect'}
              <rect
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                rx={node.cornerRadius > 0 ? node.cornerRadius : undefined}
                ry={node.cornerRadius > 0 ? node.cornerRadius : undefined}
                fill={isNone(node.fill) ? 'none' : node.fill}
                stroke={isNone(node.stroke) ? 'none' : node.stroke}
                stroke-width={node.strokeWidth}
                stroke-dasharray={dashArray(node)}
              />
            {:else if node.type === 'ellipse'}
              <ellipse
                cx={node.x + node.w / 2}
                cy={node.y + node.h / 2}
                rx={Math.abs(node.w / 2)}
                ry={Math.abs(node.h / 2)}
                fill={isNone(node.fill) ? 'none' : node.fill}
                stroke={isNone(node.stroke) ? 'none' : node.stroke}
                stroke-width={node.strokeWidth}
                stroke-dasharray={dashArray(node)}
              />
            {:else if node.type === 'line' || node.type === 'arrow'}
              {@const line = node as LineNode}
              {@const ends = lineEndpoints(line)}
              <line
                x1={ends.x1}
                y1={ends.y1}
                x2={ends.x2}
                y2={ends.y2}
                stroke={isNone(line.stroke) ? 'none' : line.stroke}
                stroke-width={line.strokeWidth}
                stroke-dasharray={dashArray(line)}
                stroke-linecap={line.dash === 'dotted' ? 'round' : 'butt'}
                fill="none"
              />
              {#if line.headSize > 0 && !isNone(line.stroke)}
                {#if line.headStart}
                  <polygon
                    points={arrowPoints(ends.x1, ends.y1, ends.x2, ends.y2, line.headSize)}
                    fill={line.stroke}
                  />
                {/if}
                {#if line.headEnd}
                  <polygon
                    points={arrowPoints(ends.x2, ends.y2, ends.x1, ends.y1, line.headSize)}
                    fill={line.stroke}
                  />
                {/if}
              {/if}
            {:else if node.type === 'text'}
              {@const text = node as TextNode}
              {#if !isNone(text.background)}
                <rect x={text.x} y={text.y} width={text.w} height={text.h} fill={text.background} />
              {/if}
              {@const textX =
                text.align === 'center'
                  ? text.x + text.w / 2
                  : text.align === 'right'
                    ? text.x + text.w - text.padding
                    : text.x + text.padding}
              {@const lineStep = text.fontSize * PT_TO_PX * Math.max(0.5, text.lineHeight)}
              <text
                font-family={text.fontFamily}
                font-size={text.fontSize * PT_TO_PX}
                font-weight={text.fontWeight}
                font-style={text.italic ? 'italic' : undefined}
                text-anchor={textAnchor(text.align)}
                fill={isNone(text.color) ? 'none' : text.color}
                dominant-baseline="text-before-edge"
                xml:space="preserve"
              >
                {#each text.text.split('\n') as line, index (index)}
                  <tspan x={textX} y={text.y + text.padding + index * lineStep}>{line}</tspan>
                {/each}
              </text>
            {:else if node.type === 'asset'}
              {@const asset = node as AssetNode}
              <image
                href={asset.svgFile}
                x={asset.x}
                y={asset.y}
                width={asset.w}
                height={asset.h}
                preserveAspectRatio="xMidYMid meet"
                transform={flipTransform(asset)}
              />
            {:else if node.type === 'image'}
              {@const image = node as ImageNode}
              {#if image.dataUrl}
                {#if image.crop}
                  {@const crop = image.crop}
                  {@const clipId = `canvas-crop-${image.id}`}
                  <defs>
                    <clipPath id={clipId}>
                      <rect x={image.x} y={image.y} width={image.w} height={image.h} />
                    </clipPath>
                  </defs>
                  <g clip-path={`url(#${clipId})`}>
                    <image
                      href={image.dataUrl}
                      x={image.x - (crop.x / crop.w) * image.w}
                      y={image.y - (crop.y / crop.h) * image.h}
                      width={image.w / crop.w}
                      height={image.h / crop.h}
                      preserveAspectRatio="none"
                      transform={flipTransform(image)}
                    />
                  </g>
                {:else}
                  <image
                    href={image.dataUrl}
                    x={image.x}
                    y={image.y}
                    width={image.w}
                    height={image.h}
                    preserveAspectRatio={preserveAspect(image.fit)}
                    transform={flipTransform(image)}
                  />
                {/if}
              {/if}
            {:else if node.type === 'chart'}
              <g class="chart-node">{@html renderChartNode(node).svg}</g>
            {:else if node.type === 'scalebar'}
              <g class="scalebar-node">{@html renderScaleBarNode(node)}</g>
            {:else if node.type === 'path'}
              <g class="path-node">{@html renderPathNode(node)}</g>
            {/if}
          </g>
        {/if}
      {/each}

      {#if guideLines.length}
        <g class="alignment-guides" pointer-events="none">
          {#each guideLines as guide (guide.axis + ':' + guide.position)}
            {#if guide.axis === 'x'}
              <line
                data-testid="figure-guide"
                data-guide-axis="x"
                x1={guide.position}
                y1={guide.from}
                x2={guide.position}
                y2={guide.to}
                stroke="#22d3ee"
                stroke-width={1 / zoom}
                stroke-linecap="round"
              />
            {:else}
              <line
                data-testid="figure-guide"
                data-guide-axis="y"
                x1={guide.from}
                y1={guide.position}
                x2={guide.to}
                y2={guide.position}
                stroke="#22d3ee"
                stroke-width={1 / zoom}
                stroke-linecap="round"
              />
            {/if}
          {/each}
        </g>
      {/if}

      {#if singleBounds && singleNode}
        <g class="selection-overlay" pointer-events="none">
          <rect
            x={singleBounds.x}
            y={singleBounds.y}
            width={singleBounds.w}
            height={singleBounds.h}
            fill="none"
            stroke="#4cd6ff"
            stroke-width={1.2 / zoom}
            stroke-dasharray={`${4 / zoom} ${3 / zoom}`}
          />
          {#if handleMap}
            {#if rotatePoint}
              <line
                x1={singleBounds.x + singleBounds.w / 2}
                y1={singleBounds.y}
                x2={rotatePoint.x}
                y2={rotatePoint.y}
                stroke="#4cd6ff"
                stroke-width={1 / zoom}
              />
              <circle
                cx={rotatePoint.x}
                cy={rotatePoint.y}
                r={handleSize / 2}
                fill="#0b0e14"
                stroke="#ffd23f"
                stroke-width={1.4 / zoom}
              />
            {/if}
            {#each HANDLE_KEYS as key (key)}
              <rect
                x={handleMap[key].x - handleSize / 2}
                y={handleMap[key].y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                fill="#0b0e14"
                stroke="#4cd6ff"
                stroke-width={1.4 / zoom}
              />
            {/each}
          {/if}
        </g>
      {/if}

      {#if multiBounds}
        <rect
          class="selection-overlay"
          pointer-events="none"
          x={multiBounds.x}
          y={multiBounds.y}
          width={multiBounds.w}
          height={multiBounds.h}
          fill="none"
          stroke="#ffd23f"
          stroke-width={1.4 / zoom}
          stroke-dasharray={`${5 / zoom} ${3 / zoom}`}
        />
      {/if}

      {#if drag?.kind === 'marquee'}
        <rect
          pointer-events="none"
          x={Math.min(drag.start.x, drag.current.x)}
          y={Math.min(drag.start.y, drag.current.y)}
          width={Math.abs(drag.current.x - drag.start.x)}
          height={Math.abs(drag.current.y - drag.start.y)}
          fill="rgba(76,214,255,0.08)"
          stroke="#4cd6ff"
          stroke-width={1 / zoom}
          stroke-dasharray={`${4 / zoom} ${3 / zoom}`}
        />
      {/if}

      {#if drag?.kind === 'create'}
        {#if drag.tool === 'rect' || drag.tool === 'ellipse'}
          {@const rect = draftRect(drag)}
          {#if drag.tool === 'rect'}
            <rect
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              fill="rgba(76,214,255,0.10)"
              stroke="#4cd6ff"
              stroke-width={1.2 / zoom}
              stroke-dasharray={`${4 / zoom} ${3 / zoom}`}
              pointer-events="none"
            />
          {:else}
            <ellipse
              cx={rect.x + rect.w / 2}
              cy={rect.y + rect.h / 2}
              rx={rect.w / 2}
              ry={rect.h / 2}
              fill="rgba(76,214,255,0.10)"
              stroke="#4cd6ff"
              stroke-width={1.2 / zoom}
              stroke-dasharray={`${4 / zoom} ${3 / zoom}`}
              pointer-events="none"
            />
          {/if}
        {:else}
          {@const line = draftLine(drag)}
          <line
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="#4cd6ff"
            stroke-width={1.4 / zoom}
            pointer-events="none"
          />
        {/if}
      {/if}
    </svg>
  </div>
</div>

<style>
  .canvas-viewport {
    position: relative;
    flex: 1;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    background: #04060a;
    border: 1px solid var(--pix-border);
    touch-action: none;
    user-select: none;
    background-image:
      linear-gradient(rgba(74, 90, 130, 0.12) 1px, transparent 1px),
      linear-gradient(90deg, rgba(74, 90, 130, 0.12) 1px, transparent 1px);
    background-size: 24px 24px;
  }
  .page-frame {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
    box-shadow:
      0 0 0 1px var(--pix-border-hi),
      6px 6px 0 rgba(0, 0, 0, 0.55),
      0 0 26px rgba(76, 214, 255, 0.08);
    background: #ffffff;
    line-height: 0;
    will-change: transform;
  }
  .figure-page {
    display: block;
    overflow: visible;
  }
  .figure-page text {
    pointer-events: none;
  }
</style>
