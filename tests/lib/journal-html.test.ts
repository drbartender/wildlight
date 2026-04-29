import { describe, it, expect } from 'vitest';
import { sanitizeJournalHtml } from '@/lib/journal-html';

describe('sanitizeJournalHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeJournalHtml('<p>hi</p><script>alert(1)</script>')).toBe(
      '<p>hi</p>',
    );
  });
  it('strips javascript: URIs', () => {
    const out = sanitizeJournalHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });
  it('strips event-handler attributes', () => {
    const out = sanitizeJournalHtml(
      '<a href="https://x.com" onclick="x()">ok</a>',
    );
    expect(out).toContain('href="https://x.com"');
    expect(out).not.toContain('onclick');
  });
  it('preserves prose tags', () => {
    const out = sanitizeJournalHtml(
      '<p>One</p><h2>Two</h2><blockquote>Three</blockquote>',
    );
    expect(out).toContain('<p>One</p>');
    expect(out).toContain('<h2>Two</h2>');
    expect(out).toContain('<blockquote>Three</blockquote>');
  });
  it('preserves img with src and alt', () => {
    const out = sanitizeJournalHtml(
      '<img src="https://images.wildlightimagery.shop/journal/x.jpg" alt="x">',
    );
    expect(out).toContain('src="https://images.wildlightimagery.shop/journal/x.jpg"');
    expect(out).toContain('alt="x"');
  });
});
