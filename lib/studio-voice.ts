// Voice corpus loaded into the studio system prompt. Two arrays:
//
//  - VOICE_LETTER: Dan's verbatim letter from app/(shop)/about/page.tsx.
//    The canonical voice. Reproduced here (not imported) so the studio
//    doesn't transitively pull a server component into a server-only lib.
//
//  - VOICE_NOTE_SAMPLES: Curated artist-note examples. Hand-picked to
//    show the voice across moods: contemplative, terse, sensory.
//
// Edit this file to evolve the voice. Both arrays are wrapped in XML
// when injected into the system prompt so the model treats them as
// data, not instructions.

export const VOICE_LETTER: readonly string[] = [
  `My name is Dan Raby I am the owner and Chief photographer here at Wildlight Imagery.  We work in Aurora Colorado which is an outlier of Denver Colorado in the USA. We work in many different styles of photography but we specialize in Portrait Photography,  Fine Art Photography, and  Freelance Photojournalism.`,
  `as for me personally, I have been a photographer exploring my light for as long as I can remember. My father handed me a camera when I was but a child and I never put it down.  I studied photography at The Colorado Institute of Art. There I learned accepted techniques and photographic rules. I learned the right way to capture light and record my world.  Since then I have practiced and honed my craft but being a typical normal photographer isn't where my passion lies.`,
  `I am always trying something different photographically.  I usually try and work beyond what I know and look for the light in unusual places. I like to consider myself a photographic rebel. Taking those well established photographic rules, that I learned in school,  and doing something else. Experimenting with new techniques constantly trying to find different ways to get the best image. Let's try this and see what happens.`,
  `But I also can use what I know and stay true to the customer requirements. Working together to create the perfect shot. I look forward to seeing what we can do for you!`,
];

export interface VoiceNoteSample {
  title: string;
  artist_note: string;
}

export const VOICE_NOTE_SAMPLES: readonly VoiceNoteSample[] = [
  {
    title: 'Stormy Sunset, Lake Michigan',
    artist_note:
      'A front moving east. I stayed on the dune past the last good light, then this opened up.',
  },
  {
    title: 'Moon, Through Pines',
    artist_note:
      'Snow falling toward the lens. The moon found a seam in the trees.',
  },
  {
    title: 'Lily, Low Key',
    artist_note: 'Lily in a low-key study. Shadow doing most of the work.',
  },
  {
    title: 'Lime Fruit',
    artist_note:
      'A single lime, sliced, lit from behind with dew held on glass. The interior architecture of a fruit.',
  },
  {
    title: 'Mr. Bee',
    artist_note: 'He tolerated me for fourteen seconds. I got two frames.',
  },
  {
    title: 'Last Room',
    artist_note: 'An abandoned room I stayed in longer than I should have.',
  },
];
