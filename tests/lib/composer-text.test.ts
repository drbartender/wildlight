import { describe, it, expect } from 'vitest';
import { composerTextToHtml, htmlToComposerText } from '@/lib/composer-text';

describe('composerTextToHtml', () => {
  it('returns empty for whitespace-only input', () => {
    expect(composerTextToHtml('')).toBe('');
    expect(composerTextToHtml('   \n  ')).toBe('');
  });

  it('passes already-HTML input through unchanged', () => {
    const html = '<p>Already wrapped.</p>';
    expect(composerTextToHtml(html)).toBe(html);
  });

  it('wraps single paragraph in <p>', () => {
    expect(composerTextToHtml('Plain text line.')).toBe(
      '<p>Plain text line.</p>',
    );
  });

  it('splits paragraphs on blank lines', () => {
    const out = composerTextToHtml('First.\n\nSecond.');
    expect(out).toBe('<p>First.</p>\n<p>Second.</p>');
  });

  it('renders single newlines as <br /> within a paragraph', () => {
    const out = composerTextToHtml('Line one.\nLine two.');
    expect(out).toBe('<p>Line one.<br />Line two.</p>');
  });

  it('escapes HTML entities in plain text', () => {
    expect(composerTextToHtml('A & B <c>')).toBe(
      '<p>A &amp; B &lt;c&gt;</p>',
    );
  });

  it('parses **bold** and *italic*', () => {
    expect(composerTextToHtml('A **bold** and *italic* word.')).toBe(
      '<p>A <strong>bold</strong> and <em>italic</em> word.</p>',
    );
  });

  it('parses ## h2 and ### h3', () => {
    expect(composerTextToHtml('## A heading')).toBe('<h2>A heading</h2>');
    expect(composerTextToHtml('### Smaller')).toBe('<h3>Smaller</h3>');
  });

  it('parses [text](url) links — http/https only', () => {
    expect(
      composerTextToHtml('See [the docs](https://example.com).'),
    ).toBe('<p>See <a href="https://example.com">the docs</a>.</p>');
  });

  it('rejects javascript: URLs in links', () => {
    const out = composerTextToHtml('[xss](javascript:alert(1))');
    expect(out).not.toContain('href="javascript');
    // Falls back to literal text, escaped.
    expect(out).toContain('[xss]');
  });

  it('escapes quotes inside link URLs so they cannot break out of href', () => {
    // Reviewer P2 — regression vector. If escapeHtmlText leaves `"`
    // alone, the markdown URL `https://a"onerror="b` would emit a
    // broken `<a href="https://a"onerror="b">` (sanitizer would still
    // strip the event handler today, but defense-in-depth requires
    // we don't even get there).
    const out = composerTextToHtml('[x](https://a"onerror="b)');
    expect(out).not.toMatch(/<a [^>]*"\s*onerror/i);
    expect(out).toContain('&quot;');
  });

  it('parses > blockquote', () => {
    const out = composerTextToHtml('> A quoted line.\n> A second.');
    expect(out).toBe(
      '<blockquote>A quoted line.<br />A second.</blockquote>',
    );
  });

  it('mixes blocks: paragraph, heading, paragraph', () => {
    const md = 'Intro line.\n\n## Section\n\nBody under section.';
    expect(composerTextToHtml(md)).toBe(
      '<p>Intro line.</p>\n<h2>Section</h2>\n<p>Body under section.</p>',
    );
  });

  it('does not transform asterisks inside HTML pass-through', () => {
    const html = '<p>**not bold**</p>';
    expect(composerTextToHtml(html)).toBe(html);
  });

  it('treats casual mentions of `<br>` etc as plain text, not HTML', () => {
    // Reviewer P0 #6 — BLOCK_TAG_RE was unanchored, so this slipped
    // through pass-through and angle brackets stopped being escaped.
    const out = composerTextToHtml('Use the <br> tag to break a line.');
    expect(out).toBe(
      '<p>Use the &lt;br&gt; tag to break a line.</p>',
    );
  });

  it('still detects pass-through when input starts with a block tag', () => {
    const html = '<p>Real HTML.</p>\n<p>Another paragraph.</p>';
    expect(composerTextToHtml(html)).toBe(html);
  });
});

describe('htmlToComposerText', () => {
  it('returns empty for empty input', () => {
    expect(htmlToComposerText('')).toBe('');
  });

  it('unwraps <p> tags into blank-line separated text', () => {
    expect(htmlToComposerText('<p>One.</p><p>Two.</p>')).toBe('One.\n\nTwo.');
  });

  it('preserves <strong> and <em> as **bold** and *italic*', () => {
    expect(
      htmlToComposerText('<p>A <strong>bold</strong> and <em>italic</em>.</p>'),
    ).toBe('A **bold** and *italic*.');
  });

  it('roundtrips a link to [text](url)', () => {
    expect(
      htmlToComposerText('<p>See <a href="https://x.example">x</a>.</p>'),
    ).toBe('See [x](https://x.example).');
  });

  it('renders <h2> and <h3> as ## and ###', () => {
    expect(htmlToComposerText('<h2>Section</h2><p>Body.</p>')).toBe(
      '## Section\n\nBody.',
    );
    expect(htmlToComposerText('<h3>Sub</h3>')).toBe('### Sub');
  });

  it('renders <blockquote> with > prefixes per line', () => {
    expect(
      htmlToComposerText('<blockquote>Quoted.<br />Second.</blockquote>'),
    ).toBe('> Quoted.\n> Second.');
  });

  it('decodes common HTML entities AFTER tag stripping', () => {
    expect(htmlToComposerText('<p>Use &lt;br&gt; for breaks.</p>')).toBe(
      'Use <br> for breaks.',
    );
  });

  it('round-trips composer text through HTML and back', () => {
    const original = 'A line.\n\n## Heading\n\n**bold** and *italic*.';
    const html = composerTextToHtml(original);
    expect(htmlToComposerText(html)).toBe(original);
  });
});
