import { describe, it, expect } from 'vitest';
import { safeString } from '@/lib/voice-export';

// safeString has been the source of two review-caught bugs in two
// rounds: the original hand-rolled escape that missed CR/backtick/
// separators, and the JSON.stringify-based replacement that claimed
// to escape U+2028/U+2029 but did not under modern V8. Both failures
// were silent at typecheck and at runtime — they would only surface
// when an operator pasted exotic input and the generated .ts file
// either failed to parse or behaved unexpectedly downstream. These
// tests give the function the coverage it needs to stop being a
// regression magnet.

const LS = String.fromCharCode(0x2028); // U+2028 LINE SEPARATOR
const PS = String.fromCharCode(0x2029); // U+2029 PARAGRAPH SEPARATOR

describe('safeString', () => {
  it('escapes the basic JSON.stringify suite (backslash, quote, CR/LF, control)', () => {
    expect(safeString('\\')).toBe('"\\\\"');
    expect(safeString('a"b')).toBe('"a\\"b"');
    expect(safeString('a\nb')).toBe('"a\\nb"');
    expect(safeString('a\rb')).toBe('"a\\rb"');
    expect(safeString('a\tb')).toBe('"a\\tb"');
    expect(safeString('\x00')).toBe('"\\u0000"');
  });

  it('emits a literal 6-char escape for U+2028 and U+2029', () => {
    expect(safeString('a' + LS + 'b')).toBe('"a\\u2028b"');
    expect(safeString('a' + PS + 'b')).toBe('"a\\u2029b"');
  });

  it('output contains no raw U+2028 / U+2029 even on adversarial input', () => {
    const adversarial = 'before' + LS + 'mid' + PS + 'after';
    const out = safeString(adversarial);
    expect(out.includes(LS)).toBe(false);
    expect(out.includes(PS)).toBe(false);
    expect(out.includes('\\u2028')).toBe(true);
    expect(out.includes('\\u2029')).toBe(true);
  });

  it('keeps template-literal interpolation inert (double-quoted output)', () => {
    // The generated TS embeds safeString output as a string literal.
    // Backticks and ${...} must remain literal — JSON.stringify's
    // double-quoted output handles this without further work.
    const out = safeString('hello `world` ${process.env.SECRET}');
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
    expect(out.includes('${process.env.SECRET}')).toBe(true);
    expect(out.includes('`world`')).toBe(true);
  });

  it('round-trips via eval (matches the contract the exported .ts file relies on)', () => {
    // The exported file is committed and loaded by tsc/Next at build.
    // Effectively: each safeString(x) must round-trip such that the
    // evaluated string literal equals the original x.
    const cases = [
      'plain',
      '\\',
      '\\\\\\',
      'a' + LS + 'b',
      'a' + PS + 'b',
      '<script>',
      '`backtick` and ${expr}',
      LS + PS + LS + PS,
      '\x7f',
      'mixed\nlines\rand\ttabs',
    ];
    for (const c of cases) {
      // eslint-disable-next-line no-eval
      const round = eval(safeString(c));
      expect(round).toBe(c);
    }
  });
});
