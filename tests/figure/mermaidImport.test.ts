import { describe, expect, it } from 'vitest';
import { MERMAID_EXAMPLE, importMermaid } from '$lib/tools/figure/mermaidImport';

describe('MERMAID_EXAMPLE', () => {
  it('is a flowchart with four labelled nodes and their edges', () => {
    expect(MERMAID_EXAMPLE).toMatch(/^flowchart\s+TD/);
    expect(MERMAID_EXAMPLE).toContain('A[Sample]');
    expect(MERMAID_EXAMPLE).toContain('B[QC]');
    expect(MERMAID_EXAMPLE).toContain('C[Analyze]');
    expect(MERMAID_EXAMPLE).toContain('D[Repeat]');
    expect(MERMAID_EXAMPLE).toContain('B -->|pass| C');
    expect(MERMAID_EXAMPLE).toContain('B -->|fail| D');
    expect(MERMAID_EXAMPLE).toContain('D --> A');
  });
});

describe('importMermaid source validation', () => {
  it('rejects empty source before loading Mermaid', async () => {
    await expect(importMermaid('')).rejects.toThrow(/empty/i);
    await expect(importMermaid('   \n\t ')).rejects.toThrow(/empty/i);
    await expect(importMermaid('%% just a comment')).rejects.toThrow(/empty/i);
  });

  it('rejects non-flowchart diagram types with an SVG suggestion', async () => {
    const cases = [
      'sequenceDiagram\n  A->>B: Hello',
      'classDiagram\n  Animal <|-- Duck',
      'stateDiagram-v2\n  [*] --> Idle',
      'erDiagram\n  CUSTOMER ||--o{ ORDER : places',
      'gantt\n  title A plan',
      'pie title Pets\n  "Dogs" : 10',
    ];
    for (const source of cases) {
      await expect(importMermaid(source)).rejects.toThrow(/SVG tab/i);
    }
  });

  it('names the unsupported diagram type in the error', async () => {
    await expect(importMermaid('sequenceDiagram\n  A->>B: Hello')).rejects.toThrow(/sequenceDiagram/);
  });

  it('ignores frontmatter, directives and comments when detecting the type', async () => {
    // A flowchart keyword past the preamble is accepted; without a DOM the
    // importer then stops at the browser-environment guard instead of the
    // diagram-type guard.
    const source = `---
title: Sample
---
%%{init: {"theme": "base"}}%%
%% a comment

flowchart LR
  A --> B`;
    await expect(importMermaid(source)).rejects.toThrow(/browser environment/i);
  });

  it('accepts graph and flowchart variants', async () => {
    await expect(importMermaid('graph TD\n  A --> B')).rejects.toThrow(/browser environment/i);
    await expect(importMermaid('flowchart-beta TD\n  A --> B')).rejects.toThrow(
      /browser environment/i,
    );
  });

  it('reports a missing browser environment before importing Mermaid', async () => {
    await expect(importMermaid(MERMAID_EXAMPLE)).rejects.toThrow(/browser environment/i);
  });
});
