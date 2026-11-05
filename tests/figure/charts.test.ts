import { describe, expect, it } from 'vitest';
import {
  applyChartCsv,
  chartCsv,
  chartScale,
  parseChartCsv,
  renderChartNode,
} from '$lib/tools/figure/charts';
import {
  createChartNode,
  type ChartNode,
  type ChartSeries,
} from '$lib/tools/figure/types';

function chart(overrides: Partial<ChartNode> = {}): ChartNode {
  return { ...createChartNode(10, 20, 320, 220), ...overrides };
}

function series(
  name: string,
  values: number[],
  errors: number[] = [],
  color = '#2563eb',
): ChartSeries {
  return { id: `id_${name}`, name, color, values, errors };
}

describe('parseChartCsv', () => {
  it('parses comma-delimited tables with a label column and named series', () => {
    const data = parseChartCsv('Label,A,B\nx,1,2\ny,3,4');
    expect(data).not.toBeNull();
    expect(data?.labels).toEqual(['x', 'y']);
    expect(data?.series.map((entry) => entry.name)).toEqual(['A', 'B']);
    expect(data?.series[0].values).toEqual([1, 3]);
    expect(data?.series[1].values).toEqual([2, 4]);
    expect(data?.series.every((entry) => entry.errors.every((value) => value === 0))).toBe(true);
  });

  it('detects tab and semicolon delimiters from the header row', () => {
    const tab = parseChartCsv('Label\tControl\tTreatment\nA\t1\t2\nB\t3\t4');
    expect(tab?.labels).toEqual(['A', 'B']);
    expect(tab?.series.map((entry) => entry.name)).toEqual(['Control', 'Treatment']);
    expect(tab?.series[1].values).toEqual([2, 4]);

    const semicolon = parseChartCsv('Label;Control;Treatment\nA;1;2\nB;3;4');
    expect(semicolon?.labels).toEqual(['A', 'B']);
    expect(semicolon?.series.map((entry) => entry.name)).toEqual(['Control', 'Treatment']);
    expect(semicolon?.series[0].values).toEqual([1, 3]);
  });

  it('handles quoted fields including embedded delimiters and doubled quotes', () => {
    const data = parseChartCsv('Label,"A, one","B ""quoted"""\n"x, y",1,2');
    expect(data).not.toBeNull();
    expect(data?.labels).toEqual(['x, y']);
    expect(data?.series.map((entry) => entry.name)).toEqual(['A, one', 'B "quoted"']);
    expect(data?.series[0].values).toEqual([1]);
    expect(data?.series[1].values).toEqual([2]);
  });

  it('ignores blank lines and comment lines', () => {
    const data = parseChartCsv('\n# chart data\nLabel,A\n\nx,1\n\n# skipped\ny,2\n');
    expect(data?.labels).toEqual(['x', 'y']);
    expect(data?.series[0].values).toEqual([1, 2]);
  });

  it('turns missing or invalid numeric cells into 0', () => {
    const data = parseChartCsv('Label,A,B\nx,abc\n y, ,3\n');
    expect(data?.series[0].values).toEqual([0, 0]);
    expect(data?.series[1].values).toEqual([0, 3]);
  });

  it('attaches err/error/sd/sem columns to the preceding series', () => {
    const cases: Array<[string, number]> = [
      ['Control err', 0.2],
      ['error', 0.3],
      ['sd', 0.4],
      ['sem', 0.5],
    ];
    for (const [header, expected] of cases) {
      const data = parseChartCsv(`Label,Control,${header}\nA,1,${expected}`);
      expect(data, header).not.toBeNull();
      expect(data?.series).toHaveLength(1);
      expect(data?.series[0].name).toBe('Control');
      expect(data?.series[0].errors?.at(0)).toBe(expected);
    }
  });

  it('takes the absolute value of error columns', () => {
    const data = parseChartCsv('Label,Control,Control err\nA,1,-0.25');
    expect(data?.series[0].errors).toEqual([0.25]);
  });

  it('returns null for header-only input or input with no series', () => {
    expect(parseChartCsv('Label,Control')).toBeNull();
    expect(parseChartCsv('Label,Control\n')).toBeNull();
    expect(parseChartCsv('')).toBeNull();
    expect(parseChartCsv('# only a comment')).toBeNull();
  });

  it('ignores a trailing error column with no preceding series', () => {
    expect(parseChartCsv('Label,err\nA,0.1')).toBeNull();
    expect(parseChartCsv('Label,sd\nA,B\nC,D')).toBeNull();
  });
});

describe('chartCsv', () => {
  it('round-trips labels, series names, values and non-zero errors', () => {
    const node = chart({
      labels: ['Control', 'Treated'],
      series: [
        series('A', [1, 2], [0.1, 0]),
        series('B', [3, 4], [0, 0.2]),
      ],
    });
    const text = chartCsv(node);
    expect(text.split('\n')[0]).toBe('Label,A,A err,B,B err');

    const parsed = parseChartCsv(text);
    expect(parsed).not.toBeNull();
    expect(parsed?.labels).toEqual(['Control', 'Treated']);
    expect(parsed?.series.map((entry) => entry.name)).toEqual(['A', 'B']);
    expect(parsed?.series[0].values).toEqual([1, 2]);
    expect(parsed?.series[1].values).toEqual([3, 4]);
    expect(parsed?.series[0].errors).toEqual([0.1, 0]);
    expect(parsed?.series[1].errors).toEqual([0, 0.2]);
  });

  it('omits error columns when every error is zero', () => {
    const node = chart({ labels: ['A'], series: [series('S', [1], [0])] });
    expect(chartCsv(node).split('\n')[0]).toBe('Label,S');
  });
});

describe('applyChartCsv', () => {
  it('keeps the id and colour of matching series and colours new series from the palette', () => {
    const node = chart({ series: [series('A', [1], [], '#111111')] });
    node.series[0].id = 'keep_a';
    const data = parseChartCsv('Label,A,B,C\nx,1,2,3');
    expect(data).not.toBeNull();
    if (!data) return;

    applyChartCsv(node, data, ['#p0', '#p1', '#p2']);

    expect(node.labels).toEqual(['x']);
    expect(node.series.map((entry) => entry.name)).toEqual(['A', 'B', 'C']);
    expect(node.series[0].id).toBe('keep_a');
    expect(node.series[0].color).toBe('#111111');
    expect(node.series[1].color).toBe('#p1');
    expect(node.series[2].color).toBe('#p2');
  });

  it('wraps the palette and truncates errors to the label count', () => {
    const node = chart();
    const data = parseChartCsv('Label,A,B,C\nx,1,2,3\ny,4,5,6');
    expect(data).not.toBeNull();
    if (!data) return;
    data.labels = ['x'];
    data.series[0].errors = [0.1, 0.2];

    applyChartCsv(node, data, ['#p0', '#p1']);

    expect(node.series.map((entry) => entry.color)).toEqual(['#p0', '#p1', '#p0']);
    expect(node.series[0].errors).toEqual([0.1]);
  });
});

describe('chartScale', () => {
  it('includes zero in the automatic bar-chart domain', () => {
    const node = chart({
      chartType: 'bar',
      labels: ['a', 'b'],
      series: [series('S', [5, 10])],
      showErrorBars: false,
    });
    const scale = chartScale(node);
    expect(scale.min).toBeLessThanOrEqual(0);
    expect(scale.ticks).toContain(0);
    expect(scale.ticks).toEqual([...scale.ticks].sort((a, b) => a - b));
  });

  it('honours explicit yMin and yMax without padding', () => {
    const node = chart({
      chartType: 'bar',
      labels: ['a', 'b'],
      series: [series('S', [2, 8])],
      showErrorBars: false,
      yMin: 0,
      yMax: 10,
    });
    const scale = chartScale(node);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(10);
    expect(scale.ticks).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('does not collapse to a zero-span domain for all-equal values', () => {
    const line = chart({
      chartType: 'line',
      labels: ['a', 'b'],
      series: [series('S', [4, 4])],
      showErrorBars: false,
    });
    const lineScale = chartScale(line);
    expect(lineScale.max).toBeGreaterThan(lineScale.min);
    expect(lineScale.ticks.length).toBeGreaterThan(1);
    expect(lineScale.ticks.every((value) => Number.isFinite(value))).toBe(true);

    const zeros = chart({
      chartType: 'bar',
      labels: ['a', 'b'],
      series: [series('S', [0, 0])],
      showErrorBars: false,
    });
    const zeroScale = chartScale(zeros);
    expect(zeroScale.max).toBeGreaterThan(zeroScale.min);
    expect(zeroScale.ticks).toContain(0);
  });
});

describe('renderChartNode', () => {
  it('draws one rect per bar', () => {
    const node = chart({
      chartType: 'bar',
      labels: ['A', 'B'],
      series: [series('S', [1, 2])],
      showLegend: false,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    const { svg } = renderChartNode(node);
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg).not.toContain('NaN');
  });

  it('draws a polyline plus markers for line charts and markers only for scatter', () => {
    const labels = ['A', 'B', 'C'];
    const line = chart({
      chartType: 'line',
      labels,
      series: [series('S', [1, 2, 3])],
      showLegend: false,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    const lineSvg = renderChartNode(line).svg;
    expect(lineSvg).toContain('<polyline ');
    expect(lineSvg.match(/<circle /g)).toHaveLength(3);

    const scatter = chart({
      chartType: 'scatter',
      labels,
      series: [series('S', [1, 2, 3])],
      showLegend: false,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    const scatterSvg = renderChartNode(scatter).svg;
    expect(scatterSvg).not.toContain('<polyline ');
    expect(scatterSvg.match(/<circle /g)).toHaveLength(3);
  });

  it('draws error-bar lines only when error bars are enabled', () => {
    const node = chart({
      chartType: 'bar',
      labels: ['A'],
      series: [series('S', [1], [0.2])],
      strokeWidth: 2,
      showLegend: false,
      showGrid: false,
      significance: [],
    });
    const withErrors = renderChartNode(node).svg;
    const withoutErrors = renderChartNode({ ...node, showErrorBars: false }).svg;
    expect(withErrors.match(/<line /g)!.length).toBeGreaterThan(
      withoutErrors.match(/<line /g)!.length,
    );
    // Error bars use a fixed 1px stroke, unlike the 2px axes.
    expect(withErrors).toContain('stroke-width="1"');
  });

  it('draws a significance bracket path and its label', () => {
    const node = chart({
      labels: ['A', 'B'],
      series: [series('S', [1, 2])],
      significance: [{ id: 'sig', from: 0, to: 1, label: '*' }],
      showLegend: false,
      showGrid: false,
      showErrorBars: false,
    });
    const { svg } = renderChartNode(node);
    expect(svg).toContain('<path d="M ');
    expect(svg).toContain('>*</text>');
  });

  it('renders the legend only when enabled', () => {
    const node = chart({
      labels: ['A'],
      series: [series('Unique legend', [1])],
      showLegend: true,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    expect(renderChartNode(node).svg).toContain('Unique legend');
    expect(renderChartNode({ ...node, showLegend: false }).svg).not.toContain('Unique legend');
  });

  it('renders axis labels', () => {
    const node = chart({
      labels: ['A'],
      series: [series('S', [1])],
      xLabel: 'Condition',
      yLabel: 'Signal',
      showLegend: false,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    const { svg } = renderChartNode(node);
    expect(svg).toContain('>Condition</text>');
    expect(svg).toContain('>Signal</text>');
  });

  it('escapes markup characters in category labels and series names', () => {
    const node = chart({
      labels: ['A & <B>'],
      series: [series('S & <1>', [1])],
      showLegend: true,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    const { svg } = renderChartNode(node);
    expect(svg).toContain('A &amp; &lt;B&gt;');
    expect(svg).toContain('S &amp; &lt;1&gt;');
    expect(svg).not.toContain('<B>');
    expect(svg).not.toContain('<1>');
  });

  it('renders negative values on the correct side of the baseline without NaN', () => {
    const node = chart({
      chartType: 'bar',
      labels: ['A', 'B'],
      series: [series('S', [-5, 3])],
      showLegend: false,
      showGrid: false,
      showErrorBars: true,
      significance: [],
    });
    const { svg } = renderChartNode(node);
    expect(svg).not.toContain('NaN');
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg).toContain('height="');

    const line = chart({
      chartType: 'line',
      labels: ['A', 'B'],
      series: [series('S', [-2, 1])],
      showLegend: false,
      showGrid: false,
      showErrorBars: false,
      significance: [],
    });
    expect(renderChartNode(line).svg).not.toContain('NaN');
  });

  it('produces finite geometry for a chart with no series', () => {
    const node = chart({
      labels: ['A', 'B'],
      series: [],
      significance: [],
      showLegend: true,
    });
    const { svg, scale } = renderChartNode(node);
    expect(svg.length).toBeGreaterThan(0);
    expect(svg).not.toContain('NaN');
    expect(Number.isFinite(scale.min)).toBe(true);
    expect(Number.isFinite(scale.max)).toBe(true);
    expect(scale.max).toBeGreaterThan(scale.min);
    expect(scale.ticks.every((value) => Number.isFinite(value))).toBe(true);
  });
});
