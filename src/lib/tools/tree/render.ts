// Standalone SVG renderer. The same string is injected into the live preview
// and written to disk, so the exported figure contains real <text> nodes and
// does not depend on the application stylesheet.
import type { LayoutNode, TreeLayout, TreeSettings } from './types';
import { formatNumber, normalizedSupport } from './types';

export interface ThemeColors {
  background: string;
  foreground: string;
  dim: string;
  border: string;
  accent: string;
  link: string;
  highlight: string;
  support: string;
  title: string;
  caption: string;
}

export const THEME_COLORS: Record<'dark' | 'light', ThemeColors> = {
  dark: {
    background: '#0b0e14',
    foreground: '#d8e1f2',
    dim: '#8b96b5',
    border: '#2a3450',
    accent: '#ffd23f',
    link: '#8b96b5',
    highlight: '#4cd6ff',
    support: '#ffd23f',
    title: '#ffd23f',
    caption: '#8b96b5'
  },
  light: {
    background: '#ffffff',
    foreground: '#1b2333',
    dim: '#5c677d',
    border: '#c7cede',
    accent: '#b45309',
    link: '#5c677d',
    highlight: '#0369a1',
    support: '#b45309',
    title: '#0f172a',
    caption: '#475569'
  }
};

export interface RenderInput {
  layout: TreeLayout;
  settings: TreeSettings;
  selectedId: string | null;
  hoveredId: string | null;
  pathIds: Set<string>;
  hoverPathIds: Set<string>;
  searchMatches: Set<string>;
  focusGroup: string | null;
  title: string;
  caption: string;
  collapseLabel: string;
  expandLabel: string;
  unitLabel: string;
  unnamedLabel: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function point(centerX: number, centerY: number, radius: number, angle: number): [number, number] {
  return [centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle)];
}

function flipDegrees(angle: number): { degrees: number; anchor: 'start' | 'end' } {
  let degrees = (angle * 180) / Math.PI;
  if (Math.cos(angle) < 0) {
    degrees += 180;
    return { degrees, anchor: 'end' };
  }
  return { degrees, anchor: 'start' };
}

export function renderTreeSvg(input: RenderInput): string {
  const { layout, settings } = input;
  const theme = THEME_COLORS[settings.theme] ?? THEME_COLORS.dark;
  const fs = settings.fontSize;
  const circular = layout.mode === 'circular';
  const nodes = layout.nodes;
  const selectedActive = input.selectedId !== null;

  const isDimmed = (node: LayoutNode): boolean => {
    if (input.focusGroup && node.group !== input.focusGroup) return true;
    if (selectedActive && !input.pathIds.has(node.id)) return true;
    return false;
  };

  const edgePaths: string[] = [];
  const arcPaths: string[] = [];
  const lengthLabels: string[] = [];
  const wedges: string[] = [];
  const dots: string[] = [];
  const labels: string[] = [];
  const supports: string[] = [];

  for (const node of nodes) {
    const dim = isDimmed(node) ? ' dim' : '';
    const onPath = selectedActive && input.pathIds.has(node.id);
    const onHoverPath = input.hoverPathIds.has(node.id);
    const hovered = input.hoveredId === node.id;
    const strokeColor = onPath
      ? theme.highlight
      : onHoverPath
        ? theme.accent
        : node.color || theme.link;
    const width = settings.branchWidth + (onPath ? 1.1 : onHoverPath ? 0.6 : 0) + (hovered ? 0.7 : 0);

    if (node.parentId) {
      let d: string;
      if (circular) {
        const [sx, sy] = point(layout.centerX, layout.centerY, node.parentRadius, node.angle);
        d = `M ${round(sx)} ${round(sy)} L ${round(node.x)} ${round(node.y)}`;
      } else {
        d = `M ${round(node.parentX)} ${round(node.parentY)} L ${round(node.x)} ${round(node.parentY)} L ${round(node.x)} ${round(node.y)}`;
      }
      edgePaths.push(
        `<path class="branch${dim}" d="${d}" fill="none" stroke="${strokeColor}" stroke-width="${round(width)}" stroke-linecap="square" stroke-linejoin="miter"/>` +
        `<path class="branch-hit" data-node-id="${esc(node.id)}" d="${d}" fill="none" stroke="transparent" stroke-width="${round(Math.max(10, width + 8))}" pointer-events="stroke"/>`
      );

      if (settings.showBranchLengths && node.length !== null && node.length !== undefined && !node.isLeaf && !node.isCollapsed) {
        const text = formatNumber(node.length);
        if (circular) {
          const middle = (node.parentRadius + node.radius) / 2;
          const [tx, ty] = point(layout.centerX, layout.centerY, middle, node.angle);
          const { degrees, anchor } = flipDegrees(node.angle);
          lengthLabels.push(
            `<text class="blen${dim}" x="${round(tx)}" y="${round(ty)}" text-anchor="${anchor}" dominant-baseline="middle" transform="rotate(${round(degrees)} ${round(tx)} ${round(ty)})">${esc(text)}</text>`
          );
        } else if (Math.abs(node.x - node.parentX) > 2) {
          const tx = (node.parentX + node.x) / 2;
          lengthLabels.push(
            `<text class="blen${dim}" x="${round(tx)}" y="${round(node.parentY - 3)}" text-anchor="middle">${esc(text)}</text>`
          );
        }
      }
    }

    if (circular && node.children.length >= 2 && node.radius > 0) {
      const [x0, y0] = point(layout.centerX, layout.centerY, node.radius, node.startAngle);
      const [x1, y1] = point(layout.centerX, layout.centerY, node.radius, node.endAngle);
      const large = node.endAngle - node.startAngle > Math.PI ? 1 : 0;
      arcPaths.push(
        `<path class="branch-arc${dim}" d="M ${round(x0)} ${round(y0)} A ${round(node.radius)} ${round(node.radius)} 0 ${large} 1 ${round(x1)} ${round(y1)}" fill="none" stroke="${strokeColor}" stroke-width="${round(width)}" stroke-linecap="butt"/>`
      );
    }

    if (node.isCollapsed) {
      const fill = node.color || theme.accent;
      if (circular) {
        const delta = Math.min(0.16, Math.max(0.05, (Math.PI * 2) / Math.max(4, layout.terminals.length) / 2));
        const startRadius = Math.max(3, node.parentRadius);
        const [x0, y0] = point(layout.centerX, layout.centerY, startRadius, node.angle - delta);
        const [x1, y1] = point(layout.centerX, layout.centerY, startRadius, node.angle + delta);
        wedges.push(
          `<path class="collapsed-wedge${dim}" data-node-id="${esc(node.id)}" data-toggle-id="${esc(node.id)}" d="M ${round(x0)} ${round(y0)} A ${round(startRadius)} ${round(startRadius)} 0 0 1 ${round(x1)} ${round(y1)} L ${round(node.x)} ${round(node.y)} Z" fill="${fill}" fill-opacity="0.72" stroke="${fill}" stroke-width="1"><title>${esc(input.expandLabel)}</title></path>`
        );
      } else {
        const half = Math.max(4, fs * 0.42);
        const startX = Math.min(node.parentX, node.x - 5);
        wedges.push(
          `<path class="collapsed-wedge${dim}" data-node-id="${esc(node.id)}" data-toggle-id="${esc(node.id)}" d="M ${round(startX)} ${round(node.y - half)} L ${round(startX)} ${round(node.y + half)} L ${round(node.x)} ${round(node.y)} Z" fill="${fill}" fill-opacity="0.72" stroke="${fill}" stroke-width="1"><title>${esc(input.expandLabel)}</title></path>`
        );
      }
    }

    if (settings.showNodeDots) {
      const radius = node.isLeaf || node.isCollapsed
        ? Math.max(1.8, settings.branchWidth * 0.8 + 1.1)
        : Math.max(2.6, settings.branchWidth + 1.6);
      const fill = onPath ? theme.highlight : node.color || theme.foreground;
      if (circular) {
        dots.push(
          `<circle class="node-dot${node.children.length > 0 ? ' node-toggle' : ''}${dim}" data-node-id="${esc(node.id)}"${node.children.length > 0 ? ` data-toggle-id="${esc(node.id)}"` : ''} cx="${round(node.x)}" cy="${round(node.y)}" r="${round(radius)}" fill="${fill}" stroke="${theme.background}" stroke-width="1"><title>${esc(node.children.length > 0 ? (node.isCollapsed ? input.expandLabel : input.collapseLabel) : node.name || input.unnamedLabel)}</title></circle>`
        );
      } else {
        dots.push(
          `<circle class="node-dot${node.children.length > 0 ? ' node-toggle' : ''}${dim}" data-node-id="${esc(node.id)}"${node.children.length > 0 ? ` data-toggle-id="${esc(node.id)}"` : ''} cx="${round(node.x)}" cy="${round(node.y)}" r="${round(radius)}" fill="${fill}" stroke="${theme.background}" stroke-width="1"><title>${esc(node.children.length > 0 ? (node.isCollapsed ? input.expandLabel : input.collapseLabel) : node.name || input.unnamedLabel)}</title></circle>`
        );
      }
    }

    // Text labels: terminal names and named internal nodes.
    const showName = node.isLeaf || node.isCollapsed || node.name !== '';
    if (showName) {
      let display = node.name || (node.isCollapsed ? '' : input.unnamedLabel);
      if (node.isCollapsed) {
        const badge = `[${node.leafCount}]`;
        display = display ? `${display} ${badge}` : badge;
      }
      const match = input.searchMatches.has(node.id) ? ' match' : '';
      const selected = selectedActive && input.pathIds.has(node.id) ? ' sel' : '';
      const fill = selectedActive && input.pathIds.has(node.id)
        ? theme.highlight
        : onHoverPath
          ? theme.accent
          : node.color || theme.foreground;
      const className = node.isLeaf || node.isCollapsed ? 'leaf-label' : 'int-label';
      let text = `<tspan class="lbl">${esc(display)}</tspan>`;
      if (settings.showBranchLengths && node.length !== null && node.length !== undefined && (node.isLeaf || node.isCollapsed)) {
        text += `<tspan class="blen-inline" dx="5">${esc(formatNumber(node.length))}</tspan>`;
      }

      if (circular) {
        const [tx, ty] = point(layout.centerX, layout.centerY, node.radius + 6, node.angle);
        const { degrees, anchor } = flipDegrees(node.angle);
        labels.push(
          `<text class="${className}${dim}${match}${selected}" data-node-id="${esc(node.id)}" x="${round(tx)}" y="${round(ty)}" fill="${fill}" font-size="${round(fs)}" text-anchor="${anchor}" dominant-baseline="middle" transform="rotate(${round(degrees)} ${round(tx)} ${round(ty)})">${text}</text>`
        );
      } else {
        const tx = node.x + 6;
        const ty = node.y;
        const rotation = settings.labelAngle
          ? ` transform="rotate(${round(-settings.labelAngle)} ${round(tx)} ${round(ty)})"`
          : '';
        labels.push(
          `<text class="${className}${dim}${match}${selected}" data-node-id="${esc(node.id)}" x="${round(tx)}" y="${round(ty)}" fill="${fill}" font-size="${round(fs)}" text-anchor="start" dominant-baseline="middle"${rotation}>${text}</text>`
        );
      }
    }

    if (settings.showSupport && node.support !== null) {
      const support = normalizedSupport(node.support);
      if (support !== null && support >= settings.supportThreshold) {
        const text = formatNumber(node.support);
        if (circular) {
          const [tx, ty] = point(layout.centerX, layout.centerY, Math.max(2, node.radius - 7), node.angle);
          const { degrees, anchor } = flipDegrees(node.angle);
          supports.push(
            `<text class="support${dim}" x="${round(tx)}" y="${round(ty)}" font-size="${round(fs * 0.78)}" text-anchor="${anchor}" dominant-baseline="middle" transform="rotate(${round(degrees)} ${round(tx)} ${round(ty)})">${esc(text)}</text>`
          );
        } else {
          supports.push(
            `<text class="support${dim}" x="${round(node.x + 5)}" y="${round(node.y - 6)}" font-size="${round(fs * 0.78)}" text-anchor="start">${esc(text)}</text>`
          );
        }
      }
    }
  }

  const titleLines = layout.titleLines.map((line, index) =>
    `<text class="fig-title" x="${round(layout.width / 2)}" y="${round(layout.titleY + index * layout.titleFont * 1.35)}" font-size="${round(layout.titleFont)}" text-anchor="middle">${esc(line)}</text>`
  ).join('');
  const captionLines = layout.captionLines.map((line, index) =>
    `<text class="fig-caption" x="${round(layout.width / 2)}" y="${round(layout.captionY + index * layout.captionFont * 1.35)}" font-size="${round(layout.captionFont)}" text-anchor="middle">${esc(line)}</text>`
  ).join('');

  let scaleBar = '';
  if (settings.showScaleBar && layout.scaleBar) {
    const bar = layout.scaleBar;
    const x1 = bar.x;
    const x2 = bar.x + bar.lengthPx;
    const y = bar.y;
    scaleBar =
      `<g class="scale-bar">` +
      `<line class="scale-line" x1="${round(x1)}" y1="${round(y)}" x2="${round(x2)}" y2="${round(y)}"/>` +
      `<line class="scale-line" x1="${round(x1)}" y1="${round(y - 4)}" x2="${round(x1)}" y2="${round(y + 4)}"/>` +
      `<line class="scale-line" x1="${round(x2)}" y1="${round(y - 4)}" x2="${round(x2)}" y2="${round(y + 4)}"/>` +
      `<text class="scale-label" x="${round(x1)}" y="${round(y - 7)}" font-size="${round(Math.max(8, fs * 0.78))}">${esc(formatNumber(bar.unit))} ${esc(input.unitLabel)}</text>` +
      `</g>`;
  }

  const css = `
.tree-bg{fill:${theme.background}}
.branch{pointer-events:none}
.branch-arc{pointer-events:none}
.branch-hit{cursor:pointer}
.node-dot{pointer-events:all}
.node-toggle{cursor:pointer}
.collapsed-wedge{cursor:pointer}
.leaf-label,.int-label{font-family:"SFMono-Regular","JetBrains Mono","Fira Code","Menlo","Consolas","Courier New",monospace;pointer-events:auto;cursor:pointer}
.int-label{font-style:italic;opacity:.92}
.support{font-family:"SFMono-Regular","JetBrains Mono","Fira Code","Menlo","Consolas","Courier New",monospace;font-weight:700;fill:${theme.support};pointer-events:none}
.blen,.blen-inline{font-family:"SFMono-Regular","JetBrains Mono","Fira Code","Menlo","Consolas","Courier New",monospace;fill:${theme.dim};opacity:.9;pointer-events:none}
.blen-inline{font-size:.82em}
.dim{opacity:.26}
.match{text-decoration:underline;text-decoration-thickness:1.5px}
.sel{font-weight:700}
.fig-title{font-family:"SFMono-Regular","JetBrains Mono","Fira Code","Menlo","Consolas","Courier New",monospace;font-weight:700;fill:${theme.title}}
.fig-caption{font-family:"SFMono-Regular","JetBrains Mono","Fira Code","Menlo","Consolas","Courier New",monospace;fill:${theme.caption}}
.scale-line{stroke:${theme.foreground};stroke-width:1.2;stroke-linecap:square}
.scale-label{font-family:"SFMono-Regular","JetBrains Mono","Fira Code","Menlo","Consolas","Courier New",monospace;fill:${theme.dim}}
`;

  const titleText = input.title ? input.title.replace(/\s+/g, ' ').trim() : input.unnamedLabel;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${round(layout.width)}" height="${round(layout.height)}" viewBox="0 0 ${round(layout.width)} ${round(layout.height)}" class="tree-svg" role="img">` +
    `<title>${esc(titleText)}</title>` +
    `<style>${css}</style>` +
    `<rect class="tree-bg" x="0" y="0" width="${round(layout.width)}" height="${round(layout.height)}"/>` +
    `<g class="tree-viewport" transform="translate(0, 0) scale(1)">` +
    titleLines +
    captionLines +
    `<g class="links">${arcPaths.join('')}${edgePaths.join('')}</g>` +
    `<g class="wedges">${wedges.join('')}</g>` +
    `<g class="dots">${dots.join('')}</g>` +
    `<g class="labels">${labels.join('')}</g>` +
    `<g class="supports">${supports.join('')}</g>` +
    `<g class="lengths">${lengthLabels.join('')}</g>` +
    scaleBar +
    `</g>` +
    `</svg>`
  );
}
