import { describe, it, expect } from 'vitest';
import { planManifestSlugs } from '@/lib/manifest-slugs';

const collections = [
  {
    slug: 'the-sun-3',
    title: 'The Sun',
    artworks: [
      { title: 'Meadow Storm', slug: 'meadow-storm', filename: 'a.jpg' },
      { title: 'Ash Grove', slug: 'ash-grove', filename: 'b.jpg' },
    ],
  },
  {
    slug: 'the-land',
    title: 'The Land',
    artworks: [{ title: 'Rimrock', slug: 'rimrock', filename: 'c.jpg' }],
  },
];

describe('planManifestSlugs', () => {
  it('namespaces each slug by its canonical collection', () => {
    const plan = planManifestSlugs(collections);
    expect(plan[0].canon).toBe('the-sun'); // the trailing -3 is a scraper artefact
    expect(plan[0].slugs).toEqual(['the-sun-meadow-storm', 'the-sun-ash-grove']);
    expect(plan[1].slugs).toEqual(['the-land-rimrock']);
  });

  // THE WHOLE POINT. The old code seeded the "taken" set from every slug in the
  // database, so on a second run each entry's own row made its own slug look
  // taken and it got a NEW one (-2, then -3). ON CONFLICT (slug) then never
  // fired, so the catalogue was duplicated and every image re-uploaded, because
  // the R2 key embeds the slug.
  it('is DETERMINISTIC: the same manifest always plans the same slugs', () => {
    const a = planManifestSlugs(collections);
    const b = planManifestSlugs(collections);
    expect(b).toEqual(a);
  });

  it('still disambiguates a genuine collision WITHIN one manifest', () => {
    const dupes = [
      {
        slug: 'the-sun',
        title: 'The Sun',
        artworks: [
          { title: 'Meadow Storm', slug: 'x', filename: 'a.jpg' },
          { title: 'Meadow Storm', slug: 'y', filename: 'b.jpg' },
          { title: 'Meadow Storm', slug: 'z', filename: 'c.jpg' },
        ],
      },
    ];
    expect(planManifestSlugs(dupes)[0].slugs).toEqual([
      'the-sun-meadow-storm',
      'the-sun-meadow-storm-2',
      'the-sun-meadow-storm-3',
    ]);
    // and that disambiguation is itself stable across runs
    expect(planManifestSlugs(dupes)).toEqual(planManifestSlugs(dupes));
  });

  it('falls back to a positional name when title and slug both slugify to nothing', () => {
    const blank = [
      {
        slug: 'the-macro',
        title: 'The Macro',
        artworks: [{ title: '', slug: '', filename: 'a.jpg' }],
      },
    ];
    expect(planManifestSlugs(blank)[0].slugs).toEqual(['the-macro-the-macro-001']);
  });

  it('does not let two collections collide with each other', () => {
    const cross = [
      { slug: 'the-sun', title: 'The Sun', artworks: [{ title: 'Dawn', slug: 'd', filename: 'a.jpg' }] },
      { slug: 'the-land', title: 'The Land', artworks: [{ title: 'Dawn', slug: 'd', filename: 'b.jpg' }] },
    ];
    const plan = planManifestSlugs(cross);
    expect(plan[0].slugs).toEqual(['the-sun-dawn']);
    expect(plan[1].slugs).toEqual(['the-land-dawn']); // NOT the-land-dawn-2
  });
});
