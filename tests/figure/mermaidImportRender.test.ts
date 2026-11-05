// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock('mermaid', () => ({ default: mermaidMock }));

import { importMermaid } from '$lib/tools/figure/mermaidImport';

const RENDERED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">
  <g class="node default" id="flowchart-A-0">
    <rect x="0" y="0" width="60" height="40" fill="#eeeeee" stroke="#333333"/>
    <text x="30" y="25" font-size="14" fill="#111111" text-anchor="middle">Sample</text>
  </g>
  <path d="M60 20 L120 20" fill="none" stroke="#333333" stroke-width="2"/>
</svg>`;

beforeEach(() => {
  mermaidMock.initialize.mockReset();
  mermaidMock.render.mockReset();
  mermaidMock.render.mockResolvedValue({ svg: RENDERED_SVG });
});

describe('importMermaid rendering', () => {
  it('initialises Mermaid safely and converts the rendered SVG', async () => {
    const result = await importMermaid('flowchart TD\n  A --> B');

    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        flowchart: { htmlLabels: false },
      }),
    );
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    expect(mermaidMock.render.mock.calls[0][1]).toBe('flowchart TD\n  A --> B');

    expect(result.nodes).toHaveLength(3);
    expect(result.nodes.some((node) => node.type === 'rect')).toBe(true);
    expect(result.nodes.some((node) => node.type === 'text')).toBe(true);
    expect(result.nodes.some((node) => node.type === 'path')).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].name).toBe('Sample');
  });

  it('wraps render failures with a clear message', async () => {
    mermaidMock.render.mockRejectedValueOnce(new Error('Parse error on line 2'));

    await expect(importMermaid('flowchart TD\n  A -->')).rejects.toThrow(
      /Mermaid could not render this diagram: Parse error on line 2/,
    );
  });
});
