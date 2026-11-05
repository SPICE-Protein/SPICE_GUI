<script lang="ts">
  // Layer tree for Figure Studio. Groups render as labelled sections with
  // their members indented; ungrouped nodes follow, both topmost first.
  import {
    BarChart3,
    ChevronDown,
    ChevronUp,
    Circle,
    Eye,
    EyeOff,
    Image as ImageIcon,
    Layers,
    Lock,
    Minus,
    MoveUpRight,
    Ruler,
    Route,
    Shapes,
    Square,
    Type,
    Unlock
  } from 'lucide-svelte';
  import { fm } from './messages';
  import type { FigureDocument, FigureNode } from './types';

  interface LayersProps {
    doc: FigureDocument;
    selectedIds: string[];
    onSelect: (ids: string[], additive: boolean) => void;
    onToggleHidden: (id: string, hidden: boolean) => void;
    onToggleLocked: (id: string, locked: boolean) => void;
    onMoveZ: (id: string, delta: number) => void;
    onSelectGroup: (groupId: string) => void;
    onToggleGroupHidden: (groupId: string, hidden: boolean) => void;
    onToggleGroupLocked: (groupId: string, locked: boolean) => void;
  }

  let {
    doc,
    selectedIds,
    onSelect,
    onToggleHidden,
    onToggleLocked,
    onMoveZ,
    onSelectGroup,
    onToggleGroupHidden,
    onToggleGroupLocked
  }: LayersProps = $props();

  const groupSections = $derived(
    doc.groups.map((group) => ({
      group,
      members: doc.nodes.filter((node) => node.groupId === group.id).slice().reverse()
    }))
  );
  const ungrouped = $derived(doc.nodes.filter((node) => !node.groupId).slice().reverse());

  function nodeLabel(node: FigureNode): string {
    if (node.type === 'text') {
      const line = node.text.split('\n')[0].trim();
      return line ? (line.length > 34 ? `${line.slice(0, 34)}…` : line) : node.name;
    }
    if (node.type === 'asset' && 'label' in node && node.label) return node.label;
    return node.name || node.type;
  }

  function nodeIcon(node: FigureNode) {
    switch (node.type) {
      case 'rect':
        return Square;
      case 'ellipse':
        return Circle;
      case 'line':
        return Minus;
      case 'arrow':
        return MoveUpRight;
      case 'text':
        return Type;
      case 'asset':
        return Shapes;
      case 'image':
        return ImageIcon;
      case 'chart':
        return BarChart3;
      case 'scalebar':
        return Ruler;
      case 'path':
        return Route;
      default:
        return Square;
    }
  }

  function groupSelected(groupId: string): boolean {
    const members = doc.nodes.filter((node) => node.groupId === groupId);
    return members.length > 0 && members.every((node) => selectedIds.includes(node.id));
  }

  function groupHidden(groupId: string): boolean {
    return !!doc.groups.find((group) => group.id === groupId)?.hidden;
  }

  function groupLockedStyle(groupId: string): boolean {
    return !!doc.groups.find((group) => group.id === groupId)?.locked;
  }

  function toggleNode(event: MouseEvent, node: FigureNode) {
    onSelect([node.id], event.shiftKey);
  }
</script>

<div class="layers" data-testid="figure-layers">
  <div class="layers-head">
    <span><Layers size={11} /> {fm.figLayers()}</span>
    <span class="pix-dim">{doc.nodes.length}</span>
  </div>

  {#each groupSections as section (section.group.id)}
    <div
      class="group-section"
      class:group-selected={groupSelected(section.group.id)}
      class:group-hidden={section.group.hidden}
      data-testid={`figure-group-${section.group.id}`}
    >
      <div class="group-row">
        <button class="group-pick" onclick={() => onSelectGroup(section.group.id)} title={section.group.name}>
          <Shapes size={11} />
          <span>{section.group.name}</span>
          <span class="pix-dim tiny">{section.members.length}</span>
        </button>
        <button
          class="icon"
          title={section.group.hidden ? fm.figShow() : fm.figHide()}
          onclick={() => onToggleGroupHidden(section.group.id, !section.group.hidden)}
        >
          {#if section.group.hidden}
            <EyeOff size={11} />
          {:else}
            <Eye size={11} />
          {/if}
        </button>
        <button
          class="icon"
          title={section.group.locked ? fm.figUnlock() : fm.figLock()}
          onclick={() => onToggleGroupLocked(section.group.id, !section.group.locked)}
        >
          {#if section.group.locked}
            <Lock size={11} />
          {:else}
            <Unlock size={11} />
          {/if}
        </button>
      </div>
      <div class="group-members">
        {#each section.members as node (node.id)}
          {@const Icon = nodeIcon(node)}
          <div
            class="layer-row member"
            class:active={selectedIds.includes(node.id)}
            class:hidden-node={node.hidden}
            data-testid={`figure-layer-${node.id}`}
          >
            <button class="pick" onclick={(event) => toggleNode(event, node)} title={nodeLabel(node)}>
              <Icon size={11} />
              <span class="label">{nodeLabel(node)}</span>
            </button>
            <button
              class="icon"
              title={groupLockedStyle(section.group.id) ? fm.figUnlock() : fm.figLock()}
              disabled={groupLockedStyle(section.group.id)}
              onclick={() => onToggleLocked(node.id, !node.locked)}
            >
              {#if node.locked}
                <Lock size={10} />
              {:else}
                <Unlock size={10} />
              {/if}
            </button>
            <button
              class="icon"
              title={node.hidden ? fm.figShow() : fm.figHide()}
              onclick={() => onToggleHidden(node.id, !node.hidden)}
            >
              {#if node.hidden}
                <EyeOff size={10} />
              {:else}
                <Eye size={10} />
              {/if}
            </button>
            <button class="icon" title={fm.figMoveUp()} onclick={() => onMoveZ(node.id, 1)}>
              <ChevronUp size={10} />
            </button>
            <button class="icon" title={fm.figMoveDown()} onclick={() => onMoveZ(node.id, -1)}>
              <ChevronDown size={10} />
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/each}

  {#each ungrouped as node (node.id)}
    {@const Icon = nodeIcon(node)}
    <div
      class="layer-row"
      class:active={selectedIds.includes(node.id)}
      class:hidden-node={node.hidden}
      data-testid={`figure-layer-${node.id}`}
    >
      <button class="pick" onclick={(event) => toggleNode(event, node)} title={nodeLabel(node)}>
        <Icon size={11} />
        <span class="label">{nodeLabel(node)}</span>
      </button>
      <button
        class="icon"
        title={node.locked ? fm.figUnlock() : fm.figLock()}
        onclick={() => onToggleLocked(node.id, !node.locked)}
      >
        {#if node.locked}
          <Lock size={10} />
        {:else}
          <Unlock size={10} />
        {/if}
      </button>
      <button
        class="icon"
        title={node.hidden ? fm.figShow() : fm.figHide()}
        onclick={() => onToggleHidden(node.id, !node.hidden)}
      >
        {#if node.hidden}
          <EyeOff size={10} />
        {:else}
          <Eye size={10} />
        {/if}
      </button>
      <button class="icon" title={fm.figMoveUp()} onclick={() => onMoveZ(node.id, 1)}>
        <ChevronUp size={10} />
      </button>
      <button class="icon" title={fm.figMoveDown()} onclick={() => onMoveZ(node.id, -1)}>
        <ChevronDown size={10} />
      </button>
    </div>
  {:else}
    {#if groupSections.length === 0}
      <div class="empty pix-dim">{fm.figEmptyHint()}</div>
    {/if}
  {/each}
</div>

<style>
  .layers {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    min-height: 0;
  }
  .layers-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 9px;
    font-weight: bold;
    color: var(--pix-accent-2);
    padding: 2px 2px 5px;
    border-bottom: 1px dashed var(--pix-border);
  }
  .layers-head span:first-child {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .group-section {
    border: 1px solid var(--pix-border);
    background: var(--pix-bg-2);
  }
  .group-section.group-selected {
    border-color: var(--pix-accent-2);
  }
  .group-section.group-hidden {
    opacity: 0.55;
  }
  .group-row {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 3px;
    background: var(--pix-bg-3);
    border-bottom: 1px dashed var(--pix-border);
  }
  .group-pick {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    color: var(--pix-accent-2);
    font-family: var(--pix-font);
    font-size: 9px;
    font-weight: bold;
    text-align: left;
    cursor: pointer;
    padding: 2px;
  }
  .group-pick span:first-of-type {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-members {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px 2px 3px 12px;
    border-left: 2px solid var(--pix-border-hi);
    margin-left: 6px;
  }
  .layer-row {
    display: flex;
    align-items: center;
    gap: 1px;
    border: 1px solid transparent;
    background: var(--pix-bg);
    padding: 1px 2px;
  }
  .layer-row.active {
    border-color: var(--pix-cyan);
    background: rgba(76, 214, 255, 0.08);
  }
  .layer-row.hidden-node {
    opacity: 0.55;
  }
  .layer-row.member {
    background: var(--pix-bg-3);
  }
  .pick {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: none;
    border: none;
    color: var(--pix-fg);
    font-family: var(--pix-font);
    font-size: 9px;
    padding: 2px;
    cursor: pointer;
    text-align: left;
  }
  .pick .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--pix-fg-dim);
    padding: 1px;
    display: inline-flex;
    align-items: center;
  }
  .icon:hover {
    color: var(--pix-cyan);
  }
  .icon:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .empty {
    padding: 14px 6px;
    text-align: center;
    font-size: 9px;
    line-height: 1.5;
  }
  .tiny {
    font-size: 8px;
  }
</style>
