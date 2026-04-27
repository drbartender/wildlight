import { describe, it, expect } from 'vitest';
import { safeHttpUrl } from '@/lib/url';

describe('safeHttpUrl', () => {
  it('returns https URLs unchanged-shape', () => {
    expect(safeHttpUrl('https://example.com/path?q=1')).toBe('https://example.com/path?q=1');
  });

  it('returns http URLs', () => {
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
  });

  it('rejects javascript: URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('JAVASCRIPT:alert(1)')).toBeNull();
    expect(safeHttpUrl('  javascript:alert(1)  ')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects vbscript: URLs', () => {
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeNull();
  });

  it('rejects file: URLs', () => {
    expect(safeHttpUrl('file:///etc/passwd')).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl('://nope')).toBeNull();
  });
});
