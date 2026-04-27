'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdminTopBar } from '@/components/admin/AdminTopBar';

interface NeedsRow {
  id: number;
  slug: string;
  title: string;
  status: string;
  image_web_url: string | null;
  collection_title: string | null;
}

type RowState =
  | { kind: 'idle' }
  | { kind: 'queued' }
  | { kind: 'uploading'; pct: number }
  | { kind: 'processing' }
  | { kind: 'done'; webUrl: string }
  | { kind: 'error'; message: string };

async function presign(
  filename: string,
  contentType: string,
  size: number,
): Promise<{ key: string; url: string }> {
  const r = await fetch('/api/admin/artworks/bulk-upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, contentType, size }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `presign ${r.status}`);
  }
  return r.json();
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`PUT ${xhr.status}`));
    xhr.onerror = () => reject(new Error('PUT network error'));
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.send(file);
  });
}

async function finalizeUpdate(
  artworkId: number,
  stagedKey: string,
): Promise<{ image_web_url: string }> {
  const r = await fetch('/api/admin/artworks/bulk-upload/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'update', artworkId, stagedKey }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `finalize ${r.status}`);
  }
  return r.json();
}

async function finalizeCreate(
  stagedKey: string,
  collectionId: number | null,
): Promise<{ artworkId: number; slug: string; image_web_url: string }> {
  const r = await fetch('/api/admin/artworks/bulk-upload/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'create', stagedKey, collectionId }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `finalize ${r.status}`);
  }
  return r.json();
}

// 3-wide concurrency limiter shared by Section A and Section B uploads.
// Without it, finalize calls fan out unbounded — sharp + a 500MB master in
// memory means 5+ concurrent uploads can OOM the Vercel function (1GB).
const MAX_CONCURRENT_UPLOADS = 3;

function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      const next = queue.shift();
      if (next) next();
    }
  };
}

interface CreatedRow {
  tempId: string;
  filename: string;
  state:
    | { kind: 'queued' }
    | { kind: 'uploading'; pct: number }
    | { kind: 'processing' }
    | { kind: 'done'; artworkId: number; slug: string; title: string }
    | { kind: 'error'; message: string };
}

export default function BulkUploadPage() {
  const [rows, setRows] = useState<NeedsRow[]>([]);
  const [states, setStates] = useState<Record<number, RowState>>({});
  const [hideDone, setHideDone] = useState(false);

  const [collections, setCollections] = useState<
    Array<{ id: number; title: string }>
  >([]);
  const [defaultCollection, setDefaultCollection] = useState<number | null>(null);
  const [created, setCreated] = useState<CreatedRow[]>([]);
  const browseRef = useRef<HTMLInputElement>(null);

  // Single shared limiter so Section A + Section B together never exceed
  // the cap. useRef so the queue persists across renders.
  const limiterRef = useRef(createLimiter(MAX_CONCURRENT_UPLOADS));

  const [orphanCount, setOrphanCount] = useState<number | null>(null);
  const [demoting, setDemoting] = useState(false);

  const reloadOrphans = useCallback(async () => {
    const r = await fetch('/api/admin/artworks/bulk-upload/cleanup-orphans');
    if (!r.ok) return;
    const d = (await r.json()) as { count: number };
    setOrphanCount(d.count);
  }, []);

  useEffect(() => {
    void reloadOrphans();
  }, [reloadOrphans]);

  async function demote() {
    if (!orphanCount) return;
    if (
      !confirm(
        `Demote ${orphanCount} artwork(s) to draft? They keep their slugs and metadata, but stop displaying publicly.`,
      )
    ) {
      return;
    }
    setDemoting(true);
    try {
      const r = await fetch('/api/admin/artworks/bulk-upload/cleanup-orphans', {
        method: 'POST',
      });
      if (!r.ok) throw new Error(`demote ${r.status}`);
      await reloadOrphans();
      void reload();
    } finally {
      setDemoting(false);
    }
  }

  const reload = useCallback(async () => {
    const r = await fetch('/api/admin/artworks?needs_print=1');
    const d = (await r.json()) as { rows: NeedsRow[] };
    setRows(d.rows);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/admin/collections');
      const d = (await r.json()) as { rows: Array<{ id: number; title: string }> };
      setCollections(d.rows.map((c) => ({ id: c.id, title: c.title })));
      if (d.rows.length) setDefaultCollection(d.rows[0].id);
    })();
  }, []);

  const setRowState = useCallback((id: number, s: RowState) => {
    setStates((prev) => ({ ...prev, [id]: s }));
  }, []);

  useEffect(() => {
    const inFlight =
      Object.values(states).some(
        (s) =>
          s.kind === 'queued' ||
          s.kind === 'uploading' ||
          s.kind === 'processing',
      ) ||
      created.some(
        (c) =>
          c.state.kind === 'queued' ||
          c.state.kind === 'uploading' ||
          c.state.kind === 'processing',
      );
    if (!inFlight) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [states, created]);

  async function uploadOne(row: NeedsRow, file: File) {
    setRowState(row.id, { kind: 'queued' });
    await limiterRef.current(async () => {
      setRowState(row.id, { kind: 'uploading', pct: 0 });
      try {
        const { key, url } = await presign(file.name, file.type, file.size);
        await putWithProgress(url, file, (pct) =>
          setRowState(row.id, { kind: 'uploading', pct }),
        );
        setRowState(row.id, { kind: 'processing' });
        const res = await finalizeUpdate(row.id, key);
        setRowState(row.id, { kind: 'done', webUrl: res.image_web_url });
      } catch (err) {
        setRowState(row.id, {
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async function uploadNew(file: File) {
    const tempId = crypto.randomUUID();
    const updateState = (state: CreatedRow['state']) =>
      setCreated((prev) =>
        prev.map((p) => (p.tempId === tempId ? { ...p, state } : p)),
      );
    setCreated((prev) => [
      ...prev,
      { tempId, filename: file.name, state: { kind: 'queued' } },
    ]);
    await limiterRef.current(async () => {
      try {
        updateState({ kind: 'uploading', pct: 0 });
        const { key, url } = await presign(file.name, file.type, file.size);
        await putWithProgress(url, file, (pct) =>
          updateState({ kind: 'uploading', pct }),
        );
        updateState({ kind: 'processing' });
        const res = await finalizeCreate(key, defaultCollection);
        const title = await fetch(`/api/admin/artworks/${res.artworkId}`)
          .then((r) => r.json())
          .then((d: { artwork: { title: string } }) => d.artwork.title)
          .catch(() => res.slug);
        updateState({
          kind: 'done',
          artworkId: res.artworkId,
          slug: res.slug,
          title,
        });
        void reload();
      } catch (err) {
        updateState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    files.forEach(uploadNew);
  }

  const visibleRows = hideDone
    ? rows.filter((r) => states[r.id]?.kind !== 'done')
    : rows;

  return (
    <>
      <AdminTopBar
        title="Bulk upload"
        subtitle="Add print masters, create new artworks, clean up orphans"
      />

      <div className="wl-adm-page">
        <section className="wl-adm-card wl-bulk-section">
          <header className="wl-bulk-section-header">
            <h2>
              Print masters needed{' '}
              <span className="wl-bulk-count">({rows.length})</span>
            </h2>
            <label className="wl-bulk-toggle">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)}
              />
              Hide artworks already in this batch
            </label>
          </header>

          {!rows.length && (
            <p className="wl-bulk-empty">No artworks need a print master.</p>
          )}

          <ul className="wl-bulk-rows">
            {visibleRows.map((row) => (
              <BulkRow
                key={row.id}
                row={row}
                state={states[row.id] || { kind: 'idle' }}
                onPick={uploadOne}
              />
            ))}
          </ul>
        </section>

        <section className="wl-adm-card wl-bulk-section">
          <header className="wl-bulk-section-header">
            <h2>Add new artworks</h2>
            <label className="wl-bulk-toggle">
              Default collection:
              <select
                value={defaultCollection ?? ''}
                onChange={(e) =>
                  setDefaultCollection(
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              >
                <option value="">(none)</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </header>

          <div
            className="wl-bulk-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => browseRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') browseRef.current?.click();
            }}
          >
            <p>Drop files here, or click to browse</p>
            <p className="wl-bulk-drop-sub">
              Each file becomes a new draft artwork — AI drafts the title and
              description on upload.
            </p>
            <input
              ref={browseRef}
              type="file"
              accept="image/jpeg,image/png,image/tiff"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                files.forEach(uploadNew);
                e.target.value = '';
              }}
            />
          </div>

          {created.length === 0 ? null : (
            <ul className="wl-bulk-rows wl-bulk-created">
              {created.map((c) => (
                <li key={c.tempId} className="wl-bulk-row" data-state={c.state.kind}>
                  <div className="wl-bulk-row-thumb">
                    <div className="wl-bulk-row-thumb-placeholder">+</div>
                  </div>
                  <div className="wl-bulk-row-meta">
                    <div className="wl-bulk-row-title">{c.filename}</div>
                    <div className="wl-bulk-row-sub">
                      {c.state.kind === 'done' && (
                        <a href={`/admin/artworks/${c.state.artworkId}`}>
                          → &ldquo;{c.state.title}&rdquo; ({c.state.slug}) — review &amp; publish
                        </a>
                      )}
                      {c.state.kind === 'error' && (
                        <span className="wl-bulk-error">{c.state.message}</span>
                      )}
                    </div>
                  </div>
                  <div className="wl-bulk-row-state">
                    {c.state.kind === 'queued' && (
                      <span className="wl-bulk-processing">queued…</span>
                    )}
                    {c.state.kind === 'uploading' && (
                      <div className="wl-bulk-progress">
                        <div
                          className="wl-bulk-progress-bar"
                          style={{ width: `${c.state.pct}%` }}
                        />
                        <span>{c.state.pct}%</span>
                      </div>
                    )}
                    {c.state.kind === 'processing' && (
                      <span className="wl-bulk-processing">processing…</span>
                    )}
                    {c.state.kind === 'done' && (
                      <span className="wl-bulk-done">✓ created</span>
                    )}
                    {c.state.kind === 'error' && (
                      <span className="wl-bulk-error">✗</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="wl-adm-card wl-bulk-section">
          <header className="wl-bulk-section-header">
            <h2>Cleanup</h2>
          </header>
          {orphanCount === null ? (
            <p className="wl-bulk-empty">Checking…</p>
          ) : orphanCount === 0 ? (
            <p className="wl-bulk-empty">
              No published artworks are missing a master.
            </p>
          ) : (
            <div className="wl-bulk-cleanup">
              <p>
                <strong>{orphanCount}</strong> published artwork(s) have no
                print master.
              </p>
              <button
                className="wl-adm-btn small danger"
                onClick={demote}
                disabled={demoting}
              >
                {demoting ? 'Demoting…' : `Demote ${orphanCount} to draft`}
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function BulkRow({
  row,
  state,
  onPick,
}: {
  row: NeedsRow;
  state: RowState;
  onPick: (row: NeedsRow, file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <li className="wl-bulk-row" data-state={state.kind}>
      <div className="wl-bulk-row-thumb">
        {row.image_web_url ? (
          <Image src={row.image_web_url} alt="" width={48} height={48} unoptimized />
        ) : (
          <div className="wl-bulk-row-thumb-placeholder">—</div>
        )}
      </div>
      <div className="wl-bulk-row-meta">
        <div className="wl-bulk-row-title">{row.title}</div>
        <div className="wl-bulk-row-sub">
          {state.kind === 'error' ? (
            <span className="wl-bulk-error">{state.message}</span>
          ) : (
            <>
              {row.collection_title || 'no collection'} · {row.slug}
            </>
          )}
        </div>
      </div>
      <div className="wl-bulk-row-state">
        {/* Input is always rendered so Retry (in error state) can open the
            picker too — without this, inputRef.current is null when the row
            is showing the Retry button and the click silently no-ops. */}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/tiff"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPick(row, f);
            e.target.value = '';
          }}
        />
        {state.kind === 'idle' && (
          <button
            className="wl-adm-btn small"
            onClick={() => inputRef.current?.click()}
          >
            Choose file…
          </button>
        )}
        {state.kind === 'queued' && <span className="wl-bulk-processing">queued…</span>}
        {state.kind === 'uploading' && (
          <div className="wl-bulk-progress">
            <div
              className="wl-bulk-progress-bar"
              style={{ width: `${state.pct}%` }}
            />
            <span>{state.pct}%</span>
          </div>
        )}
        {state.kind === 'processing' && (
          <span className="wl-bulk-processing">processing…</span>
        )}
        {state.kind === 'done' && <span className="wl-bulk-done">✓ uploaded</span>}
        {state.kind === 'error' && (
          <button
            className="wl-adm-btn small ghost"
            onClick={() => inputRef.current?.click()}
            aria-label={`Retry — ${state.message}`}
          >
            Retry
          </button>
        )}
      </div>
    </li>
  );
}
