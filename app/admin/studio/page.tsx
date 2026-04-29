'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'image' | 'title' | 'seo' | 'combination' | 'improve';

interface JournalDraft {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
}

interface SeoAngle {
  title: string;
  rationale: string;
  keywords: string[];
}

const MODE_LABELS: Record<Mode, string> = {
  image: 'Image',
  title: 'Title',
  seo: 'SEO Trend',
  combination: 'Combination',
  improve: 'Improve Draft',
};

export default function StudioPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('title');
  const [draft, setDraft] = useState<JournalDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mode-specific input state
  const [title, setTitle] = useState('');
  const [titleHint, setTitleHint] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [body, setBody] = useState('');
  const [feedback, setFeedback] = useState('');

  // SEO mode
  const [angles, setAngles] = useState<SeoAngle[] | null>(null);

  function reset() {
    setDraft(null);
    setError(null);
    setAngles(null);
  }

  async function generate() {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      let res: Response;
      if ((mode === 'image' || mode === 'combination') && imageFile) {
        const fd = new FormData();
        fd.append('mode', mode);
        fd.append('file', imageFile);
        if (mode === 'image' && titleHint) fd.append('titleHint', titleHint);
        if (mode === 'combination') fd.append('title', title);
        res = await fetch('/api/admin/studio/generate', {
          method: 'POST',
          body: fd,
        });
      } else {
        const payload =
          mode === 'title'
            ? { mode, title }
            : mode === 'image'
              ? { mode, imageUrl, titleHint: titleHint || undefined }
              : mode === 'combination'
                ? { mode, imageUrl, title }
                : { mode, body, feedback: feedback || undefined };
        res = await fetch('/api/admin/studio/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `generate failed (${res.status})`);
      }
      const j = (await res.json()) as { draft: JournalDraft };
      setDraft(j.draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generation failed');
    } finally {
      setBusy(false);
    }
  }

  async function research() {
    setBusy(true);
    setError(null);
    setAngles(null);
    try {
      const r = await fetch('/api/admin/studio/seo-research', {
        method: 'POST',
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `research failed (${r.status})`);
      }
      const j = (await r.json()) as { angles: SeoAngle[] };
      setAngles(j.angles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'research failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/journal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title,
          slug: draft.slug,
          excerpt: draft.excerpt,
          body: draft.body,
        }),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || 'save failed');
      }
      const j = (await r.json()) as { id: number; slug: string };
      router.push(`/admin/journal/${j.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
      setBusy(false);
    }
  }

  return (
    <div className="wl-adm-studio">
      <header className="wl-adm-studio-h">
        <h1>Studio</h1>
        <p className="muted">
          Generate journal drafts. Save to the journal as a draft, then
          edit + publish in the journal admin.
        </p>
      </header>

      <div className="wl-adm-studio-modes">
        {(['title', 'image', 'seo', 'combination', 'improve'] as Mode[]).map(
          (m) => (
            <button
              key={m}
              type="button"
              className={`wl-adm-studio-mode ${mode === m ? 'on' : ''}`}
              onClick={() => {
                setMode(m);
                reset();
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ),
        )}
      </div>

      {error && <p className="wl-adm-err">{error}</p>}

      {mode === 'title' && (
        <div className="wl-adm-studio-form">
          <label>
            <span>Title or topic</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Patience and overcast skies"
              maxLength={200}
            />
          </label>
          <button
            type="button"
            className="wl-adm-btn primary"
            disabled={!title || busy}
            onClick={generate}
          >
            {busy ? 'Generating…' : 'Generate →'}
          </button>
        </div>
      )}

      {mode === 'image' && (
        <div className="wl-adm-studio-form">
          <label>
            <span>Image URL (or upload below)</span>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setImageFile(null);
              }}
              placeholder="https://images.wildlightimagery.shop/..."
            />
          </label>
          <label>
            <span>…or upload a file (≤ 5 MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                setImageFile(e.target.files?.[0] ?? null);
                setImageUrl('');
              }}
            />
          </label>
          <label>
            <span>Title hint (optional)</span>
            <input
              type="text"
              value={titleHint}
              onChange={(e) => setTitleHint(e.target.value)}
              placeholder="e.g. The Land in October"
              maxLength={200}
            />
          </label>
          <button
            type="button"
            className="wl-adm-btn primary"
            disabled={(!imageUrl && !imageFile) || busy}
            onClick={generate}
          >
            {busy ? 'Generating…' : 'Generate →'}
          </button>
        </div>
      )}

      {mode === 'seo' && (
        <div className="wl-adm-studio-form">
          <p className="muted">
            Research what&apos;s currently being discussed in fine-art and
            landscape photography. Returns 3-5 candidate angles.
          </p>
          <button
            type="button"
            className="wl-adm-btn primary"
            disabled={busy}
            onClick={research}
          >
            {busy ? 'Researching…' : 'Research trending angles →'}
          </button>
          {angles && angles.length > 0 && (
            <div className="wl-adm-studio-angles">
              {angles.map((a, i) => (
                <div key={i} className="wl-adm-studio-angle">
                  <h3>{a.title}</h3>
                  <p className="muted">{a.rationale}</p>
                  {a.keywords.length > 0 && (
                    <div className="kw">
                      {a.keywords.map((k) => (
                        <span key={k}>{k}</span>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="wl-adm-btn small"
                    onClick={() => {
                      setMode('title');
                      setTitle(a.title);
                      setAngles(null);
                    }}
                  >
                    Use this angle →
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'combination' && (
        <div className="wl-adm-studio-form">
          <label>
            <span>Image URL (or upload)</span>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => {
                setImageUrl(e.target.value);
                setImageFile(null);
              }}
              placeholder="https://images.wildlightimagery.shop/..."
            />
          </label>
          <label>
            <span>…or upload a file (≤ 5 MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => {
                setImageFile(e.target.files?.[0] ?? null);
                setImageUrl('');
              }}
            />
          </label>
          <label>
            <span>Title (required)</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Stormy Sunset, Lake Michigan"
              maxLength={200}
              required
            />
          </label>
          <button
            type="button"
            className="wl-adm-btn primary"
            disabled={(!imageUrl && !imageFile) || !title || busy}
            onClick={generate}
          >
            {busy ? 'Generating…' : 'Generate →'}
          </button>
        </div>
      )}

      {mode === 'improve' && (
        <div className="wl-adm-studio-form">
          <label>
            <span>Existing body (HTML)</span>
            <textarea
              rows={14}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Paste your draft here…</p>"
              maxLength={50000}
            />
          </label>
          <label>
            <span>Feedback (optional)</span>
            <textarea
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="e.g. tighten by half, make more contemplative"
              maxLength={1000}
            />
          </label>
          <button
            type="button"
            className="wl-adm-btn primary"
            disabled={!body || busy}
            onClick={generate}
          >
            {busy ? 'Refining…' : 'Refine →'}
          </button>
        </div>
      )}

      {draft && (
        <section className="wl-adm-studio-draft">
          <header>
            <h2>Draft</h2>
            <div className="actions">
              <button
                type="button"
                className="wl-adm-btn"
                onClick={() => setDraft(null)}
              >
                Discard
              </button>
              <button
                type="button"
                className="wl-adm-btn primary"
                onClick={saveDraft}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save to journal as draft →'}
              </button>
            </div>
          </header>
          <label>
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            <span>Slug</span>
            <input
              type="text"
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
            />
          </label>
          <label>
            <span>Excerpt</span>
            <textarea
              rows={3}
              value={draft.excerpt}
              onChange={(e) =>
                setDraft({ ...draft, excerpt: e.target.value })
              }
            />
          </label>
          <label>
            <span>Body (HTML)</span>
            <textarea
              rows={20}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </label>
          <div
            className="wl-journal-body wl-adm-studio-preview"
            dangerouslySetInnerHTML={{ __html: draft.body }}
          />
        </section>
      )}
    </div>
  );
}
