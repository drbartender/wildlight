'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  type RecentItem,
  type StudioDraft,
  type StudioImage,
  type StudioKind,
  type StudioMeta,
} from '@/lib/studio-drafts';
import type {
  JournalDraft,
  SeoEnrichment,
} from '@/lib/studio';
import { htmlToComposerText } from '@/lib/composer-text';
import { StudioImageGallery } from './StudioImageGallery';

interface Props {
  initialKind: StudioKind;
  initialId: number | null;
  forceNew: boolean;
}

// ─── Utilities ──────────────────────────────────────────────────────

function relTime(d: Date | null): string {
  if (!d) return '—';
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function countWords(s: string): number {
  return s
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

interface ComposerLabels {
  pageTitle: string;          // what AdminTopBar shows
  titleLabel: string;
  titlePlaceholder: string;
  subjectLabel: string;
  subjectPlaceholder: string;
  primaryTarget: string;      // "Journal" / "Subscribers"
  primaryHint: string;        // url / count
  crossTarget: string;        // "Cross-post to subscribers" / "Mirror to journal"
  crossHint: string;
  publishLabel: string;
  recentTitle: string;
}

function labelsFor(kind: StudioKind): ComposerLabels {
  if (kind === 'journal') {
    return {
      pageTitle: 'Journal entry',
      titleLabel: 'Title',
      titlePlaceholder: 'A morning above the city',
      subjectLabel: 'Subject (preview blurb)',
      subjectPlaceholder: 'One sentence shown in the index',
      primaryTarget: 'Journal',
      primaryHint: 'wildlightimagery.shop/journal',
      crossTarget: 'Cross-post to subscribers',
      crossHint: 'sends a broadcast at publish',
      publishLabel: 'Publish →',
      recentTitle: 'Recent entries',
    };
  }
  return {
    pageTitle: 'Newsletter',
    titleLabel: 'Subject line',
    titlePlaceholder: 'New from the studio · Spring 2026',
    subjectLabel: 'Preheader',
    subjectPlaceholder: 'Shows after the subject in the inbox',
    primaryTarget: 'Subscribers',
    primaryHint: 'active list',
    crossTarget: 'Mirror to journal',
    crossHint: 'creates a published journal entry',
    publishLabel: 'Send →',
    recentTitle: 'Recent broadcasts',
  };
}

// ─── State shape (everything that auto-saves) ───────────────────────

interface DocState {
  title: string;
  subject: string;
  body: string;
  images: StudioImage[];
  chooseForMe: boolean;
  seo: SeoEnrichment | null;
}

const EMPTY_DOC: DocState = {
  title: '',
  subject: '',
  body: '',
  images: [],
  chooseForMe: false,
  seo: null,
};

// Subset patched up to the server; matches the PATCH endpoint zod.
interface PatchPayload {
  title?: string;
  subject?: string;
  body?: string;
  studioMeta?: StudioMeta;
}

// ─── Component ──────────────────────────────────────────────────────

export default function StudioComposer({
  initialKind,
  initialId,
  forceNew,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [kind, setKind] = useState<StudioKind>(initialKind);
  const [draftId, setDraftId] = useState<number | null>(initialId);
  const [doc, setDoc] = useState<DocState>(EMPTY_DOC);

  // We no longer block first paint waiting for a draft row to be POSTed
  // when ?new=1. The composer renders empty immediately; the first
  // keystroke triggers the existing `flushSave` "no id → create row →
  // PATCH" branch. Loading is true only while we're hydrating an
  // existing draft.
  const [loading, setLoading] = useState(initialId != null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crossPublish, setCrossPublish] = useState(false);
  const [showSeo, setShowSeo] = useState(true);

  const [recent, setRecent] = useState<RecentItem[] | null>(null);

  const labels = useMemo(() => labelsFor(kind), [kind]);
  const wordCount = countWords(doc.body);

  // ─── Auto-save plumbing ──────────────────────────────────────────
  // First user-driven change triggers a debounced PATCH (or POST first
  // when there's no row yet). We coalesce in-flight saves: if a save is
  // running, the next request stashes its payload and fires once the
  // first one returns. Keeps us from racing duplicate POSTs while the
  // user types fast on a fresh draft.

  const savingRef = useRef(false);
  const pendingRef = useRef<PatchPayload | null>(null);
  const draftIdRef = useRef<number | null>(initialId);
  const kindRef = useRef<StudioKind>(initialKind);
  const dirtyRef = useRef(false); // becomes true after first user edit
  // List of resolvers waiting for the queue to drain. Awaiting one of
  // these is the "real flush" — replaces the previous 850ms blind
  // setTimeout in handlePublish.
  const flushWaitersRef = useRef<Array<() => void>>([]);
  // The debounce timer that schedules the next auto-save PATCH from
  // useEffect below. flushPending needs a handle on it so it can fire
  // the queued payload synchronously when Publish is clicked between
  // a keystroke and the 800ms tick — otherwise the publish reads stale
  // state.
  const pendingTimerRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    payload: PatchPayload | null;
  }>({ timer: null, payload: null });

  // Keep refs in sync with state — refs are read inside the async
  // save flow which can run after several state changes have batched.
  useEffect(() => {
    draftIdRef.current = draftId;
  }, [draftId]);
  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);

  const flushSave = useCallback(
    async (patch: PatchPayload) => {
      if (savingRef.current) {
        // Coalesce — only the latest payload matters; the running save
        // hasn't yet picked up these fields, so when it finishes we'll
        // fire one more PATCH with the merged latest.
        pendingRef.current = { ...(pendingRef.current ?? {}), ...patch };
        return;
      }
      savingRef.current = true;
      setSaving(true);
      setError(null);
      try {
        let id = draftIdRef.current;
        if (id == null) {
          const created = await fetch('/api/admin/studio/draft', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: kindRef.current }),
          });
          if (!created.ok) throw new Error(`create failed (${created.status})`);
          const j = (await created.json()) as { id: number };
          id = j.id;
          setDraftId(id);
          draftIdRef.current = id;
          // Replace URL so reload + back-button keep the draft id.
          const sp = new URLSearchParams(searchParams?.toString() ?? '');
          sp.set('kind', kindRef.current);
          sp.set('id', String(id));
          sp.delete('new');
          router.replace(`/admin/studio?${sp.toString()}`, { scroll: false });
        }
        const r = await fetch(
          `/api/admin/studio/draft/${id}?kind=${kindRef.current}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          },
        );
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `save failed (${r.status})`);
        }
        setSavedAt(new Date());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'save failed');
      } finally {
        savingRef.current = false;
        setSaving(false);
        if (pendingRef.current) {
          const next = pendingRef.current;
          pendingRef.current = null;
          // Fire-and-forget tail call so the UI isn't blocked on chain depth.
          void flushSave(next);
        } else {
          // Queue is fully drained — wake any flushPending() waiters so
          // a publish click that's been awaiting can proceed.
          const waiters = flushWaitersRef.current;
          flushWaitersRef.current = [];
          for (const w of waiters) w();
        }
      }
    },
    [router, searchParams],
  );

  // Resolves once savingRef and pendingRef are both empty — i.e. when
  // the auto-save queue has drained. Returns immediately if nothing is
  // in flight. Used by handlePublish to ensure pending edits hit the
  // server before the publish UPDATE reads the row.
  //
  // Three states to drain before resolving:
  //   1. A debounce-scheduled save that hasn't fired yet → we cancel
  //      the timer and fire it immediately with the captured payload.
  //   2. A save currently in flight (savingRef) → wake on its finally.
  //   3. A coalesced pending payload (pendingRef) → wake on the
  //      tail-call's finally.
  const flushPending = useCallback(async (): Promise<void> => {
    // 1. Drain the timer.
    const slot = pendingTimerRef.current;
    if (slot.timer != null && slot.payload != null) {
      clearTimeout(slot.timer);
      const payload = slot.payload;
      slot.timer = null;
      slot.payload = null;
      void flushSave(payload);
    }
    // 2 + 3: nothing else to wait on.
    if (!savingRef.current && !pendingRef.current) return;
    return new Promise<void>((resolve) => {
      flushWaitersRef.current.push(resolve);
    });
  }, [flushSave]);

  // Debounced patch builder. Watches the doc fields that round-trip to
  // the server and fires after 800ms of quiet. The first user edit on
  // a clean draft sets dirtyRef so we don't auto-save the EMPTY_DOC
  // state during initial mount. The current payload + timer handle are
  // mirrored into pendingTimerRef so flushPending can fire them early.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const meta: StudioMeta = {
      images: doc.images,
      chooseForMe: doc.chooseForMe,
      seo: doc.seo
        ? { ...doc.seo, generatedAt: new Date().toISOString() }
        : undefined,
    };
    const payload: PatchPayload = {
      title: doc.title,
      subject: doc.subject,
      body: doc.body,
      studioMeta: meta,
    };
    const t = setTimeout(() => {
      pendingTimerRef.current = { timer: null, payload: null };
      void flushSave(payload);
    }, 800);
    pendingTimerRef.current = { timer: t, payload };
    return () => {
      clearTimeout(t);
      // Only clear the slot if it's still pointing at THIS timer; a
      // flushPending() call may have already fired it and set the slot
      // to a fresh state.
      if (pendingTimerRef.current.timer === t) {
        pendingTimerRef.current = { timer: null, payload: null };
      }
    };
  }, [
    doc.title,
    doc.subject,
    doc.body,
    doc.images,
    doc.chooseForMe,
    doc.seo,
    flushSave,
  ]);

  // ─── Initial load ───────────────────────────────────────────────
  // `forceNew` (=`?new=1`) is intentionally a no-op now: rendering an
  // empty composer immediately is faster than waiting on a POST. The
  // first keystroke creates the draft row via `flushSave`'s no-id
  // branch; the URL is replaced with `?id=…` at that point.
  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (initialId == null) {
        setDoc(EMPTY_DOC);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/admin/studio/draft/${initialId}?kind=${kind}`,
        );
        if (!r.ok) throw new Error(`load failed (${r.status})`);
        const j = (await r.json()) as { draft: StudioDraft };
        if (cancelled) return;
        setDoc({
          title: j.draft.title,
          subject: j.draft.subject,
          body: j.draft.body,
          images: j.draft.studioMeta.images ?? [],
          chooseForMe: !!j.draft.studioMeta.chooseForMe,
          seo: j.draft.studioMeta.seo
            ? {
                keywords: j.draft.studioMeta.seo.keywords,
                meta: j.draft.studioMeta.seo.meta,
                related: j.draft.studioMeta.seo.related,
                readingTime: j.draft.studioMeta.seo.readingTime,
              }
            : null,
        });
        setSavedAt(new Date(j.draft.updatedAt));
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // Intentionally deps-light: re-run only when these route inputs
    // change. Internal state (draftId, doc) is owned past first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  // ─── Recent rail ─────────────────────────────────────────────────
  // Refetch only when the user crosses kinds, lands on a different
  // draft, or returns from a publish (caller bumps `recentVersion`).
  // Previously we also keyed on `savedAt`, which thrashed every
  // 800ms-debounced keystroke into a fresh GET — eliminated.
  const [recentVersion, setRecentVersion] = useState(0);
  const bumpRecent = useCallback(() => setRecentVersion((v) => v + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/studio/recent?kind=${kind}&limit=5`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { items: RecentItem[] } | null) => {
        if (cancelled) return;
        setRecent(j?.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setRecent([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, draftId, recentVersion]);

  // ─── Handlers ────────────────────────────────────────────────────

  const update = useCallback((patch: Partial<DocState>) => {
    dirtyRef.current = true;
    setDoc((d) => ({ ...d, ...patch }));
  }, []);

  // Imperative variant for callers that need the latest state inside a
  // single tick (e.g. moveImg).
  const updateImagesFn = useCallback(
    (fn: (prev: StudioImage[]) => StudioImage[]) => {
      dirtyRef.current = true;
      setDoc((d) => ({ ...d, images: fn(d.images) }));
    },
    [],
  );

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      try {
        // Upload sequentially so an early failure surfaces clearly. The
        // first upload also creates the draft row (via auto-save fire)
        // and pinpointing which file was the problem matters for UX.
        // Vercel's serverless function body limit is 4.5MB. Cap the
        // function-mediated path at 4MB to leave room for multipart
        // form-data overhead — anything heavier presigns straight to R2.
        const SMALL_FILE_BYTES = 4 * 1024 * 1024;
        const out: StudioImage[] = [];
        for (const file of files) {
          if (file.size <= SMALL_FILE_BYTES) {
            const fd = new FormData();
            fd.append('file', file);
            const r = await fetch('/api/admin/journal/upload-image', {
              method: 'POST',
              body: fd,
            });
            if (!r.ok) {
              const j = (await r.json().catch(() => ({}))) as {
                error?: string;
              };
              throw new Error(j.error || `upload failed (${r.status})`);
            }
            const j = (await r.json()) as { url: string; key?: string };
            out.push({ url: j.url, key: j.key });
          } else {
            // Presign → direct PUT to R2 → record url+key.
            const presign = await fetch('/api/admin/studio/upload-presign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: file.name,
                type: file.type,
                size: file.size,
              }),
            });
            if (!presign.ok) {
              const j = (await presign.json().catch(() => ({}))) as {
                error?: string;
              };
              throw new Error(j.error || `presign failed (${presign.status})`);
            }
            const { uploadUrl, url, key, contentType } =
              (await presign.json()) as {
                uploadUrl: string;
                url: string;
                key: string;
                contentType: string;
              };
            const put = await fetch(uploadUrl, {
              method: 'PUT',
              headers: { 'Content-Type': contentType },
              body: file,
            });
            if (!put.ok) {
              throw new Error(
                `upload to R2 failed (${put.status}) — check public bucket CORS`,
              );
            }
            out.push({ url, key });
          }
        }
        updateImagesFn((prev) => [...prev, ...out]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'upload failed');
      } finally {
        setUploading(false);
      }
    },
    [updateImagesFn],
  );
  // Note: bumpRecent fires on publish + discard. Auto-save changes
  // don't refetch the rail; the active draft is already at the top by
  // updated_at and will stay there until the next publish/discard.

  const handleRemoveImg = useCallback(
    (url: string) => {
      updateImagesFn((prev) => prev.filter((i) => i.url !== url));
    },
    [updateImagesFn],
  );

  const handleMoveImg = useCallback(
    (url: string, dir: -1 | 1) => {
      updateImagesFn((prev) => {
        const i = prev.findIndex((x) => x.url === url);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= prev.length) return prev;
        const next = prev.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      });
    },
    [updateImagesFn],
  );

  const handleSwitchKind = useCallback(
    (next: StudioKind) => {
      if (next === kind) return;
      // Switching kind always lands on a clean composer for that kind.
      // The existing draft stays where it is (unsaved changes have
      // already been auto-saved on debounce — within the 800ms window
      // there may still be a pending save; we let it run).
      const sp = new URLSearchParams();
      sp.set('kind', next);
      router.push(`/admin/studio?${sp.toString()}`);
    },
    [kind, router],
  );

  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'unified',
          kind,
          imageUrls: doc.images.map((i) => i.url),
          title: doc.title || undefined,
          subject: doc.subject || undefined,
          body: doc.body || undefined,
          chooseForMe: doc.chooseForMe,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `generate failed (${r.status})`);
      }
      const j = (await r.json()) as {
        draft: JournalDraft;
        seo: SeoEnrichment;
      };
      // The studio API returns HTML body (the model writes through the
      // draft_journal tool with `<p>`/`<em>`/etc). Our textarea wants
      // plain-text-with-markdown, so convert before setting state —
      // otherwise the user sees literal `<p>` tags. On save the body
      // round-trips back to HTML for public render.
      const aiBodyText = htmlToComposerText(j.draft.body);

      // Merge logic — chooseForMe gives the model full control; without
      // it we keep whatever the user typed and only fill blanks.
      dirtyRef.current = true;
      setDoc((d) => {
        if (d.chooseForMe) {
          return {
            ...d,
            title: j.draft.title,
            subject: j.draft.excerpt,
            body: aiBodyText,
            seo: j.seo,
          };
        }
        return {
          ...d,
          title: d.title || j.draft.title,
          subject: d.subject || j.draft.excerpt,
          body: d.body || aiBodyText,
          seo: j.seo,
        };
      });
      setShowSeo(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'generate failed');
    } finally {
      setGenerating(false);
    }
  }, [kind, doc]);

  const handlePublish = useCallback(async () => {
    if (!draftId) {
      setError('save first');
      return;
    }
    if (!doc.title.trim()) {
      setError(kind === 'newsletter' ? 'subject line required' : 'title required');
      return;
    }
    if (!doc.body.trim()) {
      setError('body required');
      return;
    }
    // Confirm destructive sends. Newsletter sends are always confirmed
    // (one click goes to live subscribers); journal cross-publish only
    // confirms when the box is checked.
    if (kind === 'newsletter') {
      if (
        !confirm(
          crossPublish
            ? 'Send to active subscribers AND publish a journal mirror?'
            : 'Send to active subscribers now?',
        )
      ) {
        return;
      }
    } else if (
      crossPublish &&
      !confirm('Publish this entry AND cross-post it to your subscribers?')
    ) {
      return;
    }

    setPublishing(true);
    setError(null);
    try {
      // Real flush — wait for the auto-save queue to drain so the
      // publish UPDATE reads the latest version of the draft. No
      // blind sleep, no timing gamble.
      await flushPending();
      const r = await fetch(
        `/api/admin/studio/draft/${draftId}/publish?kind=${kind}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crossPublish }),
        },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `publish failed (${r.status})`);
      }
      const j = (await r.json()) as {
        slug?: string;
        crossSlug?: string | null;
        sent?: number;
      };
      // Journal: land on the published chapter URL. Newsletter: land on
      // the mirror chapter if cross-published, otherwise stay put with
      // a confirmation toast (kind=newsletter, sent_at on the draft now
      // shows it shipped — refresh shows the right rail entry move into
      // "sent" state).
      if (kind === 'journal' && j.slug) {
        window.location.href = `/journal/${j.slug}`;
        return;
      }
      if (kind === 'newsletter' && j.crossSlug) {
        window.location.href = `/journal/${j.crossSlug}`;
        return;
      }
      // Stay on composer, force a reload so the saved state reflects
      // sent_at and the action bar reads correctly.
      router.refresh();
      bumpRecent();
      setError(null);
      alert(
        kind === 'newsletter'
          ? `Sent to ${j.sent ?? 0} subscriber${j.sent === 1 ? '' : 's'}.`
          : 'Published.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'publish failed');
    } finally {
      setPublishing(false);
    }
  }, [draftId, doc, kind, crossPublish, router, bumpRecent, flushPending]);

  const handleDiscard = useCallback(async () => {
    if (!draftId) return;
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    try {
      const r = await fetch(
        `/api/admin/studio/draft/${draftId}?kind=${kind}`,
        { method: 'DELETE' },
      );
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `delete failed (${r.status})`);
      }
    } catch (err) {
      // If the delete failed the row is still there — surface the
      // error and keep the user on the composer so they can retry
      // instead of silently ending up on an empty new draft.
      setError(err instanceof Error ? err.message : 'discard failed');
      return;
    }
    bumpRecent();
    router.push(`/admin/studio?kind=${kind}`);
  }, [draftId, kind, router, bumpRecent]);

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="wl-stu-composer">
      {/* ── Composer column ────────────────────────────────── */}
      <div className="wl-stu-col">
        {/* Mode tabs + save + counts */}
        <div className="wl-stu-head">
          <div className="wl-stu-kind" role="tablist">
            <button
              role="tab"
              aria-selected={kind === 'journal'}
              className={kind === 'journal' ? 'on' : ''}
              onClick={() => handleSwitchKind('journal')}
            >
              Journal entry
            </button>
            <button
              role="tab"
              aria-selected={kind === 'newsletter'}
              className={kind === 'newsletter' ? 'on' : ''}
              onClick={() => handleSwitchKind('newsletter')}
            >
              Newsletter
            </button>
          </div>
          <span className="wl-stu-save" aria-live="polite">
            <span
              className={`wl-stu-save-dot ${saving ? 'on' : ''}`}
              aria-hidden="true"
            />
            {saving
              ? 'Saving…'
              : savedAt
                ? `Saved ${relTime(savedAt)}`
                : draftId
                  ? 'Auto-save on'
                  : 'Auto-save on'}
          </span>
          <span className="wl-stu-counts">
            {wordCount} words · {doc.images.length} images
          </span>
        </div>

        {error && <p className="wl-adm-err wl-stu-err">{error}</p>}

        {loading ? (
          <p className="wl-stu-loading">Loading draft…</p>
        ) : (
          <>
            <StudioImageGallery
              images={doc.images}
              uploading={uploading}
              onAdd={handleAddFiles}
              onRemove={handleRemoveImg}
              onMove={handleMoveImg}
            />

            <label className="wl-stu-field">
              <span className="wl-stu-field-label">{labels.titleLabel}</span>
              <input
                type="text"
                className="wl-stu-title"
                value={doc.title}
                onChange={(e) => update({ title: e.target.value })}
                placeholder={labels.titlePlaceholder}
                maxLength={200}
              />
            </label>

            <label className="wl-stu-field">
              <span className="wl-stu-field-label">{labels.subjectLabel}</span>
              <input
                type="text"
                className="wl-stu-subject"
                value={doc.subject}
                onChange={(e) => update({ subject: e.target.value })}
                placeholder={labels.subjectPlaceholder}
                maxLength={500}
              />
            </label>

            <label className="wl-stu-field">
              <span className="wl-stu-field-label">
                Body
                <span className="wl-stu-field-hint">
                  Plain text · paragraphs split on blank lines
                </span>
              </span>
              <textarea
                className="wl-stu-body"
                value={doc.body}
                onChange={(e) => update({ body: e.target.value })}
                rows={14}
                placeholder={
                  kind === 'journal'
                    ? 'Taken from a 17th-floor hotel room on State Street during the early-morning fog-burn…'
                    : 'Dear friends,\n\nFive new pieces from The Land — quiet mornings along the Oregon coast…'
                }
                maxLength={50000}
              />
            </label>

            {doc.seo && showSeo && (
              <section
                className="wl-stu-seo"
                aria-label="Generated SEO research"
              >
                <header>
                  <h4>SEO research</h4>
                  <button
                    type="button"
                    className="wl-stu-seo-hide"
                    onClick={() => setShowSeo(false)}
                  >
                    Hide
                  </button>
                </header>
                {doc.seo.keywords.length > 0 && (
                  <div className="wl-stu-seo-row">
                    <div className="wl-stu-field-label">Suggested keywords</div>
                    <div className="wl-stu-seo-kws">
                      {doc.seo.keywords.map((k) => (
                        <span key={k}>{k}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="wl-stu-seo-row">
                  <div className="wl-stu-field-label">Reading time</div>
                  <div className="wl-stu-seo-rt">{doc.seo.readingTime}</div>
                </div>
                {doc.seo.meta && (
                  <div className="wl-stu-seo-row">
                    <div className="wl-stu-field-label">Meta description</div>
                    <p className="wl-stu-seo-meta">{doc.seo.meta}</p>
                  </div>
                )}
                {doc.seo.related.length > 0 && (
                  <div className="wl-stu-seo-row">
                    <div className="wl-stu-field-label">Cross-link ideas</div>
                    <p className="wl-stu-seo-related">
                      {doc.seo.related.join(' · ')}
                    </p>
                  </div>
                )}
              </section>
            )}

            <div className="wl-stu-actions">
              <label className="wl-stu-toggle">
                <input
                  type="checkbox"
                  checked={doc.chooseForMe}
                  onChange={(e) =>
                    update({ chooseForMe: e.target.checked })
                  }
                />
                <span className="wl-stu-toggle-track" aria-hidden="true">
                  <span className="wl-stu-toggle-thumb" />
                </span>
                <span>
                  <strong>Choose for me</strong>
                  <span className="wl-stu-toggle-help">
                    {' '}
                    — title, subject &amp; body
                  </span>
                </span>
              </label>
              <span className="wl-stu-actions-spacer" />
              <button
                type="button"
                className="wl-adm-btn"
                onClick={handleGenerate}
                disabled={generating}
                title="Run SEO research and draft an entry from your inputs"
              >
                {generating ? 'Researching…' : 'Generate · with SEO'}
              </button>
              <button
                type="button"
                className="wl-adm-btn primary"
                onClick={handlePublish}
                disabled={
                  publishing ||
                  generating ||
                  !doc.title.trim() ||
                  (kind === 'journal' && !doc.body.trim())
                }
              >
                {publishing ? 'Publishing…' : labels.publishLabel}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Right rail ──────────────────────────────────────── */}
      <aside className="wl-stu-rail">
        <RecentRail
          title={labels.recentTitle}
          items={recent}
          activeId={draftId}
        />

        <section className="wl-stu-rail-block">
          <h3 className="wl-stu-rail-h">Publish to</h3>
          <label className="wl-stu-publish-target">
            <input type="checkbox" checked readOnly />
            <span>
              <span className="wl-stu-publish-name">{labels.primaryTarget}</span>
              <span className="wl-stu-publish-hint">{labels.primaryHint}</span>
            </span>
          </label>
          <label className="wl-stu-publish-target">
            <input
              type="checkbox"
              checked={crossPublish}
              onChange={(e) => setCrossPublish(e.target.checked)}
            />
            <span>
              <span className="wl-stu-publish-name">{labels.crossTarget}</span>
              <span className="wl-stu-publish-hint">{labels.crossHint}</span>
            </span>
          </label>
        </section>

        <section className="wl-stu-rail-block wl-stu-tip">
          <div className="wl-stu-tip-h">Composer tip</div>
          <p>
            Generate runs an SEO research pass before drafting — it pulls
            keywords from current photography conversations and proposes a
            meta description anchored to whatever you&apos;ve typed.
          </p>
        </section>

        {draftId && (
          <section className="wl-stu-rail-block wl-stu-rail-foot">
            <button
              type="button"
              className="wl-stu-discard"
              onClick={handleDiscard}
            >
              Discard draft
            </button>
          </section>
        )}
      </aside>
    </div>
  );
}

// Memoized so prose typing in the body textarea doesn't re-run the
// items.map() on every keystroke. Props are referentially stable —
// `items` only changes when the recent-rail effect actually fetches,
// `activeId` only on draft load.
interface RecentRailProps {
  title: string;
  items: RecentItem[] | null;
  activeId: number | null;
}

const RecentRail = memo(function RecentRail({
  title,
  items,
  activeId,
}: RecentRailProps) {
  return (
    <section className="wl-stu-rail-block">
      <h3 className="wl-stu-rail-h">{title}</h3>
      {items === null ? (
        <p className="wl-stu-rail-loading">Loading…</p>
      ) : items.length === 0 ? (
        <p className="wl-stu-rail-empty">
          Nothing here yet — your work will show up as you save.
        </p>
      ) : (
        <ul className="wl-stu-recent">
          {items.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <Link
                href={
                  r.id < 0
                    ? `/admin/subscribers/history#b-${-r.id}`
                    : `/admin/studio?kind=${r.kind}&id=${r.id}`
                }
                className={
                  r.id === activeId ? 'wl-stu-recent-active' : undefined
                }
              >
                <span className="wl-stu-recent-title">{r.title}</span>
                <span className="wl-stu-recent-meta">
                  {new Date(r.updatedAt).toLocaleDateString()} ·{' '}
                  <em>{r.status}</em>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});
