import { describe, it, expect } from 'vitest';
import { clampToBoundary } from '@/lib/ai-draft';

describe('clampToBoundary', () => {
  it('passes strings at or under the limit through unchanged', () => {
    expect(clampToBoundary('short', 100)).toBe('short');
    expect(clampToBoundary('exactly ten', 11)).toBe('exactly ten');
  });

  it('cuts at the last sentence-end when one is in the safe zone', () => {
    // The first '. ' lands at index 11 of the 14-char slice — past the
    // 60% floor (8.4). The function should cut to "Hello world.".
    const s = 'Hello world. Goodbye later.';
    const out = clampToBoundary(s, 14);
    expect(out).toBe('Hello world.');
  });

  it('falls back to the last word boundary when no sentence-end is in range', () => {
    const s = 'one two three four five six seven eight nine ten eleven';
    const out = clampToBoundary(s, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    // Should end at a word boundary, not mid-word.
    expect(out).toMatch(/[^\s]$/);
    expect(s.startsWith(out)).toBe(true);
  });

  it('hard-cuts when no boundary is within the safe zone', () => {
    // No spaces; should hard-cut at the cap.
    const s = 'a'.repeat(200);
    const out = clampToBoundary(s, 50);
    expect(out.length).toBe(50);
  });

  it('trims trailing whitespace after the cut', () => {
    const s = 'word                                            extra';
    const out = clampToBoundary(s, 20);
    expect(out).toBe(out.trimEnd());
  });

  it('handles the WILDLIGHT-B failure mode (model overshoots the cap)', () => {
    // Reproduce: the model writes a slightly-too-long artist_note. The
    // composed note runs ~210 chars; cap is 180. We should land at <=180
    // and prefer the last sentence boundary (the second sentence's '.').
    const note =
      'I waited an hour for the storm to break and the light to soften ' +
      'across the granite face below. It only took a moment for the ' +
      'cloud to part and the ridge to glow gold. Worth every minute.';
    expect(note.length).toBeGreaterThan(180);
    const out = clampToBoundary(note, 180);
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out).toMatch(/\.$/);
  });
});
