'use client';

import { memo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import Image from 'next/image';
import type { StudioImage } from '@/lib/studio-drafts';

interface Props {
  images: StudioImage[];
  // True while we're awaiting upload responses for files just dropped.
  uploading: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (url: string) => void;
  onMove: (url: string, dir: -1 | 1) => void;
}

// Drag-drop dropzone that morphs into a thumbnail grid once images
// are present. First thumb is the cover (rendered above the title on
// the published page). Reorder controls appear on hover; remove sits
// in a corner.
//
// Memoized — the parent composer's `doc` state changes on every
// keystroke. The gallery only depends on `images`/`uploading` and the
// stable `useCallback` handlers, so memo cuts gallery + thumb re-renders
// on prose typing.
function StudioImageGalleryInner({
  images,
  uploading,
  onAdd,
  onRemove,
  onMove,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) onAdd(files);
    e.target.value = '';
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDrag(false);
    const files = e.dataTransfer?.files
      ? Array.from(e.dataTransfer.files)
      : [];
    if (files.length) onAdd(files);
  }

  const empty = images.length === 0;

  return (
    <div
      className={`wl-stu-dropzone ${drag ? 'is-drag' : ''} ${empty ? 'is-empty' : 'is-filled'} ${uploading ? 'is-uploading' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={onDrop}
    >
      {empty ? (
        <div className="wl-stu-dropzone-empty">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <rect x="3" y="4" width="18" height="14" rx="1" />
            <circle cx="9" cy="10" r="2" />
            <path d="m4 17 5-5 4 4 3-3 4 4" />
          </svg>
          <div className="wl-stu-dropzone-headline">Drop images here</div>
          <div className="wl-stu-dropzone-help">
            or{' '}
            <button
              type="button"
              className="wl-stu-dropzone-browse"
              onClick={() => inputRef.current?.click()}
            >
              browse files
            </button>{' '}
            · multi-select supported · jpg, png, webp, gif up to 100 MB
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={pick}
            hidden
          />
        </div>
      ) : (
        <>
          <div className="wl-stu-thumbs">
            {images.map((img, idx) => (
              <div className="wl-stu-thumb" key={img.url}>
                <Image
                  src={img.url}
                  alt=""
                  fill
                  sizes="(max-width: 900px) 30vw, 160px"
                  style={{ objectFit: 'cover' }}
                />
                <span className="wl-stu-thumb-idx">{idx + 1}</span>
                <div className="wl-stu-thumb-tools">
                  <button
                    type="button"
                    onClick={() => onMove(img.url, -1)}
                    disabled={idx === 0}
                    aria-label="Move left"
                    title="Move left"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(img.url, 1)}
                    disabled={idx === images.length - 1}
                    aria-label="Move right"
                    title="Move right"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(img.url)}
                    aria-label="Remove"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="wl-stu-thumb wl-stu-thumb-add"
              onClick={() => inputRef.current?.click()}
            >
              <span>+ Add</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={pick}
              hidden
            />
          </div>
          <div className="wl-stu-thumbs-foot">
            <span>
              {images.length} image{images.length === 1 ? '' : 's'}
            </span>
            <span className="wl-stu-thumbs-foot-r">
              First image becomes the cover
            </span>
          </div>
        </>
      )}
      {uploading && <div className="wl-stu-dropzone-uploading">Uploading…</div>}
    </div>
  );
}

export const StudioImageGallery = memo(StudioImageGalleryInner);
