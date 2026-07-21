'use client';

import Link from 'next/link';

// Shared tile controls for the Wall and Shop shelves. Extracted from
// WallArranger so ShopShelf can use them without importing from its former
// parent, which would be a circular import.

/** Jump to the artwork's detail page. Available on EVERY thumbnail. */
export function EditLink({ id, title }: { id: number; title: string }) {
  return (
    <Link
      href={`/admin/artworks/${id}`}
      className="wl-adm-ws-act"
      aria-label={`Edit ${title} details`}
      title={`Edit ${title} details`}
      draggable={false}
      onClick={(e) => e.stopPropagation()}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
      </svg>
    </Link>
  );
}

/**
 * Take a photo OFF a shelf. Deliberately NEUTRAL-coloured, unlike the red
 * Library delete: same shape, but this one is reversible and must not read as
 * "destroy". Expands to a word on the confirm step so an icon-only control never
 * commits on a single click.
 */
export function RemoveButton({
  confirming,
  disabled,
  label,
  onClick,
}: {
  confirming: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`wl-adm-ws-act wl-adm-ws-rm ${confirming ? 'confirming' : ''}`}
      aria-label={confirming ? `${label} — activate again to confirm` : label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {confirming ? (
        'Remove?'
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      )}
    </button>
  );
}
