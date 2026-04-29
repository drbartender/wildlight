// Composer-text → HTML normalizer.
//
// The Studio composer's body is a textarea. We want it to feel like a
// notes app: blank lines split paragraphs, single newlines turn into
// soft breaks, and the basic markdown tokens you'd reach for while
// writing — bold, italic, headings, links, blockquotes — render as
// real HTML on save.
//
// HTML input (anything containing one of the canonical block tags) is
// passed through unchanged so AI-generated drafts and round-tripped
// chapters keep their structure. The downstream sanitizer
// (sanitizeJournalHtml) is the safety net for whatever this produces.
//
// Deliberately not pulling in `marked` or `markdown-it` — those bundle
// 30-50KB of parser surface for features we don't expose (tables,
// tasklists, GFM extensions). The handful of inline + block tokens
// below covers what the composer documents in its body-field hint.

// Anchored to the start of the trimmed input so casual mentions of
// `<br>`, `<p>` etc inside prose don't accidentally trigger pass-through.
// Pre-anchored input only — caller has already trimmed.
const BLOCK_TAG_RE =
  /^<(?:p|h[1-6]|ul|ol|li|blockquote|figure|figcaption|pre|table|hr|br)\b/i;

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline transforms run on already-escaped text — operating order
// matters: links first (so URL contents don't get wrecked by emphasis
// regex), then **strong**, then *em*. Code is intentionally absent;
// the journal voice rarely uses inline code and it would conflict with
// the asterisk markers.
function applyInlines(escaped: string): string {
  // [text](https://url) — only http/https/mailto/relative/anchor URIs.
  // Reject anything that looks like a javascript: or data: scheme.
  let out = escaped.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, label: string, url: string) => {
      if (/^(?:https?:|mailto:|tel:|\/|#)/i.test(url)) {
        return `<a href="${url}">${label}</a>`;
      }
      return `[${label}](${url})`;
    },
  );

  // **strong** — non-greedy, doesn't consume trailing space.
  out = out.replace(/\*\*([^*\n][^*\n]*?)\*\*/g, '<strong>$1</strong>');

  // *em* — same shape but single asterisk.
  out = out.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');

  return out;
}

// Renders a single paragraph block: split single newlines into <br />
// inside the <p>. Inlines apply after escaping.
function renderParagraph(text: string): string {
  const lines = text.split(/\n/).map((l) => applyInlines(escapeHtmlText(l)));
  return `<p>${lines.join('<br />')}</p>`;
}

function renderHeading(level: 2 | 3, text: string): string {
  const inner = applyInlines(escapeHtmlText(text.trim()));
  return `<h${level}>${inner}</h${level}>`;
}

function renderBlockquote(lines: string[]): string {
  // Markdown blockquote semantics: each `> ` line becomes part of one
  // <blockquote>. Inner content runs through the inline pipeline so
  // **emphasis** inside a quote still resolves.
  const inner = lines
    .map((l) => l.replace(/^>\s?/, ''))
    .map((l) => applyInlines(escapeHtmlText(l)))
    .join('<br />');
  return `<blockquote>${inner}</blockquote>`;
}

export function composerTextToHtml(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return '';

  // Pass-through path — caller handed us real HTML (AI output or a
  // round-tripped chapter). Anchored regex (matches only at index 0)
  // keeps casual mentions of `<br>` etc inside prose from escaping
  // the markdown path. Sanitizer downstream takes care of safety.
  if (BLOCK_TAG_RE.test(trimmed)) return trimmed;

  // Split on blank lines for blocks. Each block is then classified by
  // its first character/run.
  const blocks = trimmed.split(/\n{2,}/);
  const out: string[] = [];

  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;

    if (b.startsWith('### ')) {
      out.push(renderHeading(3, b.slice(4)));
      continue;
    }
    if (b.startsWith('## ')) {
      out.push(renderHeading(2, b.slice(3)));
      continue;
    }
    if (b.startsWith('> ')) {
      out.push(renderBlockquote(b.split(/\n/)));
      continue;
    }
    out.push(renderParagraph(b));
  }

  return out.join('\n');
}

// ─── Reverse: HTML → composer-text ──────────────────────────────────
//
// Used in two places:
//
//   * On load, when an entry has no `studio_meta.bodySource` (legacy or
//     pre-composer rows), we fall back to converting the rendered HTML
//     back to a plain-text approximation so the textarea isn't full of
//     literal `<p>` tags.
//   * After AI Generate, the studio API returns HTML. We convert it to
//     text before setting the composer state so the user keeps seeing
//     a plain-text editor; the publish-side conversion regenerates HTML
//     from whatever the user ends up with.
//
// Lossy by design — emphasis tags, links, headings collapse to text
// markers (`**`, `*`, `## `, `[text](url)`) which composerTextToHtml
// understands as round-trip tokens. Anything we can't represent (tables,
// inline styles, images) drops to plain text.
const ENTITY_MAP: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITY_MAP[m] ?? m);
}

export function htmlToComposerText(html: string): string {
  if (!html) return '';
  let s = html;

  // Headings — collapse open + close to a single `## ` / `### ` marker.
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, '\n\n## $1\n\n');
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, '\n\n### $1\n\n');
  // Other heading levels collapse to h2-style text — rare in practice.
  s = s.replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n\n## $1\n\n');

  // Blockquote — prefix each inner line with `> `.
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const lines = String(inner)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
      .replace(/<\/?p[^>]*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .split(/\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => `> ${l}`)
      .join('\n');
    return `\n\n${lines}\n\n`;
  });

  // Inline emphasis + links.
  s = s.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**');
  s = s.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*');
  s = s.replace(
    /<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href: string, text: string) => `[${text}](${href})`,
  );

  // Paragraphs / breaks → newlines.
  s = s.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
  s = s.replace(/<\/?p[^>]*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // Strip everything else.
  s = s.replace(/<[^>]+>/g, '');

  // Decode entities AFTER tag stripping so escaped angle-brackets in
  // user prose survive ("Use &lt;br&gt;" → "Use <br>").
  s = decodeEntities(s);

  // Normalize whitespace runs.
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s;
}
