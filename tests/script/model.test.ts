import { describe, expect, it } from 'vitest';
import {
  createScript,
  formatScriptValue,
  normalizePermissions,
  normalizeStoredScript,
  parseArgsText,
  sanitizePatch,
  validateScript,
} from '../../src/lib/script/model';

describe('script records', () => {
  it('creates a runnable default record', () => {
    const script = createScript();
    expect(script.id).toMatch(/^script_/);
    expect(script.name).toBe('Untitled script');
    expect(script.permissions).toEqual(['doc:read']);
    expect(script.source).toBe('');
  });

  it('keeps only known permissions and always grants read', () => {
    expect(normalizePermissions(['doc:write', 'io:write', 'doc:write'])).toEqual([
      'doc:read',
      'doc:write',
    ]);
    expect(normalizePermissions(undefined)).toEqual(['doc:read']);
  });

  it('rejects empty name or source and oversized sources', () => {
    expect(validateScript({ name: ' ', source: 'return 1' }).ok).toBe(false);
    expect(validateScript({ name: 'x', source: '  ' }).ok).toBe(false);
    expect(validateScript({ name: 'x', source: 'return 1' }).ok).toBe(true);
    expect(validateScript({ name: 'x', source: 'a'.repeat(200_001) }).ok).toBe(false);
  });

  it('rehydrates only records with an id, name, and source', () => {
    const script = normalizeStoredScript({
      id: 'script_1',
      name: 'Keep',
      source: 'return 1',
      permissions: ['doc:write'],
    });
    expect(script?.permissions).toEqual(['doc:read', 'doc:write']);
    expect(normalizeStoredScript({ id: 'script_2', name: 'No source' })).toBeNull();
    expect(normalizeStoredScript('nope')).toBeNull();
  });
});

describe('arguments', () => {
  it('accepts an empty box and a JSON object', () => {
    expect(parseArgsText('')).toEqual({ args: {} });
    expect(parseArgsText('{"window": 50}')).toEqual({ args: { window: 50 } });
  });

  it('rejects arrays, primitives, and malformed JSON', () => {
    expect(parseArgsText('[1, 2]').error).toBeTruthy();
    expect(parseArgsText('42').error).toBeTruthy();
    expect(parseArgsText('{oops}').error).toBeTruthy();
  });
});

describe('patch validation', () => {
  it('normalises whitespace and case in a sequence', () => {
    const { patch } = sanitizePatch({ sequence: 'ac gt\nac' });
    expect(patch).toEqual({ sequence: 'ACGTAC' });
  });

  it('accepts a name-only patch and trims it', () => {
    expect(sanitizePatch({ name: '  pUC19  ' }).patch).toEqual({ name: 'pUC19' });
  });

  it('rejects unknown fields, empty tables, and non-DNA sequence', () => {
    expect(sanitizePatch({ sequenze: 'ACGT' }).error).toContain('Unknown patch field');
    expect(sanitizePatch({}).error).toBeTruthy();
    expect(sanitizePatch({ sequence: 'ACGT!' }).error).toContain('IUPAC');
    expect(sanitizePatch({ name: 'x'.repeat(121) }).error).toBeTruthy();
    expect(sanitizePatch('ACGT').error).toBeTruthy();
  });
});

describe('result formatting', () => {
  it('returns an empty string for nil results', () => {
    expect(formatScriptValue(undefined)).toBe('');
    expect(formatScriptValue(null)).toBe('');
  });

  it('serialises nested values and replaces functions', () => {
    const text = formatScriptValue({ hits: [{ start: 1 }], cb: () => 1 });
    expect(JSON.parse(text)).toEqual({ hits: [{ start: 1 }], cb: '[function]' });
  });

  it('marks circular references', () => {
    const value: Record<string, unknown> = { ok: true };
    value.self = value;
    expect(formatScriptValue(value)).toContain('[circular]');
  });
});
