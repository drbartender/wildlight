'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export interface JournalEntry {
  id?: number;
  slug?: string;
  title: string;
  excerpt: string | null;
  body: string;
  cover_image_url: string | null;
  published?: boolean;
  published_at?: string | null;
}

export interface JournalEditorProps {
  initial?: JournalEntry;
  /** True when editing existing; false when creating new. */
  isEdit: boolean;
}

export function JournalEditor({ initial, isEdit }: JournalEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [excerpt, setExcerpt] = useState(initial?.excerpt ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [cover, setCover] = useState(initial?.cover_image_url ?? '');
  const [published, setPublished] = useState(initial?.published ?? false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Auto-derive slug from title until the user touches the slug field.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80),
    );
  }, [title, slugTouched]);

  async function uploadImage(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/admin/journal/upload-image', {
      method: 'POST',
      body: fd,
    });
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(e.error || `upload failed (${r.status})`);
    }
    const j = (await r.json()) as { url: string };
    return j.url;
  }

  async function pickCover(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      setCover(await uploadImage(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
    e.target.value = '';
  }

  async function insertInlineImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const url = await uploadImage(file);
      const ta = bodyRef.current;
      const snippet = `\n<img src="${url}" alt="" />\n`;
      if (ta) {
        const at = ta.selectionStart;
        const next = body.slice(0, at) + snippet + body.slice(at);
        setBody(next);
        queueMicrotask(() => {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = at + snippet.length;
        });
      } else {
        setBody(body + snippet);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    }
    e.target.value = '';
  }

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      title,
      slug: slug || undefined,
      excerpt: excerpt || null,
      body,
      cover_image_url: cover || null,
    };
    try {
      const url = isEdit
        ? `/api/admin/journal/${initial!.id}`
        : '/api/admin/journal';
      const r = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `save failed (${r.status})`);
      }
      const j = (await r.json()) as { id: number; slug: string };
      if (!isEdit) {
        router.push(`/admin/journal/${j.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    if (!isEdit || !initial?.id) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/journal/${initial.id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published: !published }),
      });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || 'publish toggle failed');
      }
      setPublished((p) => !p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish toggle failed');
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!isEdit || !initial?.id) return;
    if (!confirm('Delete this entry permanently?')) return;
    const r = await fetch(`/api/admin/journal/${initial.id}`, {
      method: 'DELETE',
    });
    if (r.ok) router.push('/admin/journal');
    else setError('delete failed');
  }

  return (
    <div className="wl-adm-journal-editor">
      <div className="wl-adm-journal-h">
        <h1>{isEdit ? 'Edit chapter' : 'New chapter'}</h1>
        <div className="actions">
          {isEdit && (
            <button
              type="button"
              className={`wl-adm-btn ${published ? 'ghost' : 'primary'}`}
              onClick={togglePublish}
              disabled={saving}
            >
              {published ? 'Unpublish' : 'Publish'}
            </button>
          )}
          <button
            type="button"
            className="wl-adm-btn primary"
            onClick={save}
            disabled={saving || !title || !body}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {error && <p className="wl-adm-err">{error}</p>}

      <label className="wl-adm-field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          required
        />
      </label>

      <label className="wl-adm-field">
        <span>Slug</span>
        <input
          type="text"
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          maxLength={100}
        />
      </label>

      <label className="wl-adm-field">
        <span>Excerpt (optional, used in listing + meta description)</span>
        <textarea
          rows={3}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          maxLength={500}
        />
      </label>

      <div className="wl-adm-field">
        <span>Cover image</span>
        <div className="wl-adm-cover">
          {cover && (
            <div className="wl-adm-cover-prev">
              <Image
                src={cover}
                alt="Cover preview"
                width={240}
                height={150}
                style={{ objectFit: 'cover' }}
              />
            </div>
          )}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={pickCover}
          />
          {cover && (
            <button
              type="button"
              className="wl-adm-btn ghost small"
              onClick={() => setCover('')}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="wl-adm-field">
        <span>Body (HTML)</span>
        <div className="wl-adm-body-toolbar">
          <label className="wl-adm-btn ghost small">
            Insert image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={insertInlineImage}
              style={{ display: 'none' }}
            />
          </label>
          <button
            type="button"
            className="wl-adm-btn ghost small"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? 'Hide preview' : 'Show preview'}
          </button>
        </div>
        <textarea
          ref={bodyRef}
          rows={20}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="<p>Your chapter starts here…</p>"
          required
        />
        {preview && (
          <div
            className="wl-adm-body-preview wl-journal-body"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        )}
      </div>

      {isEdit && (
        <div className="wl-adm-journal-foot">
          <button
            type="button"
            className="wl-adm-btn danger"
            onClick={destroy}
          >
            Delete chapter
          </button>
        </div>
      )}
    </div>
  );
}
