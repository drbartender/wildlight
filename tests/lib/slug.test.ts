import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '@/lib/slug';

describe('slugify', () => {
  it('lowercases, replaces non-alnum with dashes, trims edges', () => {
    expect(slugify('The Sun')).toBe('the-sun');
    expect(slugify('  Lime   Fruit! ')).toBe('lime-fruit');
    expect(slugify('20WLI_0039-1')).toBe('20wli-0039-1');
  });
  it('returns empty string on null/undefined', () => {
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });
  it('caps at 80 chars', () => {
    const s = slugify('a'.repeat(200));
    expect(s.length).toBeLessThanOrEqual(80);
  });
});

describe('uniqueSlug', () => {
  it('returns base when not taken', () => {
    expect(uniqueSlug('foo', new Set())).toBe('foo');
  });
  it('appends numeric suffix when taken', () => {
    const taken = new Set(['foo', 'foo-2']);
    expect(uniqueSlug('foo', taken)).toBe('foo-3');
  });
});
