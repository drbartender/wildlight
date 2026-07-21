import { slugify, uniqueSlug } from '@/lib/slug';

// Slug planning for scripts/import-manifest.ts, extracted so it can be tested.
// This is where the importer's idempotence lives, and where it used to be lost.
//
// THE OLD BUG. The script seeded its "taken slugs" set from EVERY slug already
// in the database. On a second run each entry's own row therefore made its own
// slug look taken, so `uniqueSlug` handed back a fresh one (`-2`, then `-3`).
// That slug was new, so `ON CONFLICT (slug)` never fired and the row was
// INSERTed again; and because the R2 key embeds the slug, the target URL
// differed too, so the upload-skip missed and every image was re-uploaded.
// A "safe to re-run" script duplicated the entire catalogue.
//
// The fix is that planning depends ONLY on the manifest: the same manifest
// always plans the same slugs, so a re-run collides with its own prior rows by
// design and the caller can make that collision a no-op.

export interface ManifestArtworkRef {
  title: string;
  slug: string;
  filename: string;
}

export interface ManifestCollectionRef {
  slug: string;
  title: string;
  artworks: ManifestArtworkRef[];
}

export interface PlannedCollection {
  /** Canonical collection slug, with the scraper's `-\d+` dedup suffix stripped. */
  canon: string;
  /** One slug per artwork, in manifest order. */
  slugs: string[];
}

/**
 * Strip the trailing `-\d+` dedup suffix the scraper added when it discovered
 * the same collection through more than one URL. "the-sun-3" -> "the-sun".
 */
export function canonicalSlug(raw: string): string {
  return slugify(raw).replace(/-\d+$/, '');
}

/**
 * Deterministic slug for every artwork in a manifest.
 *
 * The `taken` set is per-CALL, never seeded from the database. It exists only
 * to disambiguate genuine collisions *within one manifest*, which are stable
 * because manifest order is stable. Seeding it from the database is precisely
 * the bug described above.
 */
export function planManifestSlugs(
  collections: ManifestCollectionRef[],
): PlannedCollection[] {
  const taken = new Set<string>();
  return collections.map((c) => {
    const canon = canonicalSlug(c.slug) || canonicalSlug(c.title);
    const slugs = c.artworks.map((a, idx) => {
      const baseName =
        slugify(a.title === a.slug ? '' : a.title) ||
        slugify(a.slug) ||
        `${canon}-${String(idx + 1).padStart(3, '0')}`;
      // Namespaced by collection, so two collections cannot collide with each
      // other and only a true within-collection duplicate gets a suffix.
      const slug = uniqueSlug(`${canon}-${baseName}`, taken);
      taken.add(slug);
      return slug;
    });
    return { canon, slugs };
  });
}
