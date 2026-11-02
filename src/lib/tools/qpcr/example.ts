// Deterministic example plate: six samples, three targets, technical triplicates
// and two standard curves. One missing Ct, one high Ct, one outlier and one
// duplicated well name make every QC flag visible.

interface SampleSeed {
  name: string;
  group: string;
  plateRow: string;
  gapdh: [string, string, string];
  il6: [string, string, string];
  tnf: [string, string, string];
}

const SAMPLES: SampleSeed[] = [
  {
    name: 'C1',
    group: 'Control',
    plateRow: 'A',
    gapdh: ['17.95', '18.08', '18.01'],
    il6: ['25.92', '26.04', '25.97'],
    tnf: ['27.44', '27.53', '27.49'],
  },
  {
    name: 'C2',
    group: 'Control',
    plateRow: 'B',
    gapdh: ['18.02', '18.14', '18.06'],
    il6: ['26.03', '27.10', '26.08'],
    tnf: ['27.51', '27.61', '27.55'],
  },
  {
    name: 'C3',
    group: 'Control',
    plateRow: 'C',
    gapdh: ['17.98', '18.09', '18.03'],
    il6: ['25.88', '26.01', '25.94'],
    tnf: ['27.39', '27.48', '27.43'],
  },
  {
    name: 'T1',
    group: 'Treated',
    plateRow: 'D',
    gapdh: ['18.05', '18.18', '18.10'],
    il6: ['23.96', '24.08', '24.01'],
    tnf: ['25.47', '25.58', '25.52'],
  },
  {
    name: 'T2',
    group: 'Treated',
    plateRow: 'E',
    gapdh: ['18.01', '18.12', '18.07'],
    il6: ['24.03', '24.14', '24.08'],
    tnf: ['25.52', '25.63', '36.20'],
  },
  {
    name: 'T3',
    group: 'Treated',
    plateRow: 'F',
    gapdh: ['18.08', '18.19', '18.12'],
    il6: ['24.00', '24.12', 'Undetermined'],
    tnf: ['25.44', '25.55', '25.49'],
  },
];

interface TargetSeed {
  name: string;
  offset: number;
  efficiency: string;
  tm: string;
}

const TARGETS: TargetSeed[] = [
  { name: 'GAPDH', offset: 0, efficiency: '98', tm: '81.2' },
  { name: 'IL6', offset: 3, efficiency: '95', tm: '79.4' },
  { name: 'TNF', offset: 6, efficiency: '102', tm: '80.1' },
];

const STANDARDS: { target: string; row: string; cts: string[]; efficiency: string; tm: string }[] = [
  {
    target: 'IL6',
    row: 'G',
    cts: ['20.24', '23.38', '26.51', '29.66', '32.82'],
    efficiency: '95',
    tm: '79.4',
  },
  {
    target: 'TNF',
    row: 'H',
    cts: ['21.02', '24.15', '27.31', '30.44', '33.58'],
    efficiency: '102',
    tm: '80.1',
  },
];

export function buildExampleTsv(): string {
  const lines: string[] = [
    ['Well', 'Sample', 'Target', 'Ct', 'Group', 'Replicate', 'Efficiency', 'Tm', 'Quantity'].join('\t'),
  ];

  for (const sample of SAMPLES) {
    const series: Record<string, [string, string, string]> = {
      GAPDH: sample.gapdh,
      IL6: sample.il6,
      TNF: sample.tnf,
    };
    for (const target of TARGETS) {
      const values = series[target.name];
      values.forEach((ct, index) => {
        let well = `${sample.plateRow}${target.offset + index + 1}`;
        // Duplicated well name on purpose, to exercise the duplicate flag.
        if (sample.name === 'C3' && target.name === 'TNF' && index === 1) well = 'C4';
        lines.push(
          [
            well,
            sample.name,
            target.name,
            ct,
            sample.group,
            String(index + 1),
            target.efficiency,
            target.tm,
            '',
          ].join('\t'),
        );
      });
    }
  }

  for (const standard of STANDARDS) {
    standard.cts.forEach((ct, index) => {
      const quantity = String(10 ** (6 - index));
      lines.push(
        [
          `${standard.row}${index + 1}`,
          `Std 1e${6 - index}`,
          standard.target,
          ct,
          'Standard',
          '1',
          standard.efficiency,
          standard.tm,
          quantity,
        ].join('\t'),
      );
    });
  }

  return `${lines.join('\n')}\n`;
}

export const EXAMPLE_TSV = buildExampleTsv();
