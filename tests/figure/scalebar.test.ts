import { describe, expect, it } from 'vitest';
import { renderScaleBarNode } from '$lib/tools/figure/scalebar';
import { PT_TO_PX, createScaleBarNode, type ScaleBarNode } from '$lib/tools/figure/types';

function bar(overrides: Partial<ScaleBarNode> = {}): ScaleBarNode {
  return { ...createScaleBarNode(10, 20, 120, 38), ...overrides };
}

describe('renderScaleBarNode', () => {
  it('draws the bar line and the label', () => {
    const svg = renderScaleBarNode(bar());
    expect(svg).toContain('<line ');
    expect(svg).toContain('10 µm');
    expect(svg).not.toContain('NaN');
  });

  it('draws end-cap lines when ticks are enabled and omits them otherwise', () => {
    const withTicks = renderScaleBarNode(bar({ ticks: true }));
    const withoutTicks = renderScaleBarNode(bar({ ticks: false }));
    expect(withTicks.match(/<line /g)).toHaveLength(3);
    expect(withoutTicks.match(/<line /g)).toHaveLength(1);
  });

  it('escapes markup characters in the label', () => {
    const svg = renderScaleBarNode(bar({ label: '5 <µm> & more' }));
    expect(svg).toContain('5 &lt;µm&gt; &amp; more');
    expect(svg).not.toContain('<µm>');
  });

  it('honours custom stroke, thickness and font size', () => {
    const svg = renderScaleBarNode(
      bar({ stroke: '#ff0000', thickness: 6, fontSize: 18, textColor: '#00ff00' }),
    );
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke-width="6"');
    const fontSize = svg.match(/font-size="([^"]+)"/)?.[1];
    expect(Number(fontSize)).toBeCloseTo(18 * PT_TO_PX, 4);
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).not.toContain('NaN');
  });

  it('clamps thickness to a visible minimum', () => {
    const svg = renderScaleBarNode(bar({ thickness: 0 }));
    expect(svg).toContain('stroke-width="0.5"');
    expect(svg).not.toContain('stroke-width="0"');
  });

  it('omits the label when it is blank', () => {
    const svg = renderScaleBarNode(bar({ label: '   ' }));
    expect(svg).not.toContain('<text ');
  });
});
