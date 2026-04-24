import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Studio — Wildlight Imagery' };

// Dan's letter — verbatim from the studio. Paragraphs split on blank lines only;
// no edits to words, punctuation, or capitalization. Keep it that way.
const LETTER: string[] = [
  `My name is Dan Raby I am the owner and Chief photographer here at Wildlight Imagery.  We work in Aurora Colorado which is an outlier of Denver Colorado in the USA. We work in many different styles of photography but we specialize in Portrait Photography,  Fine Art Photography, and  Freelance Photojournalism.`,
  `as for me personally, I have been a photographer exploring my light for as long as I can remember. My father handed me a camera when I was but a child and I never put it down.  I studied photography at The Colorado Institute of Art. There I learned accepted techniques and photographic rules. I learned the right way to capture light and record my world.  Since then I have practiced and honed my craft but being a typical normal photographer isn’t where my passion lies.`,
  `I am always trying something different photographically.  I usually try and work beyond what I know and look for the light in unusual places. I like to consider myself a photographic rebel. Taking those well established photographic rules, that I learned in school,  and doing something else. Experimenting with new techniques constantly trying to find different ways to get the best image. Let’s try this and see what happens.`,
  `But I also can use what I know and stay true to the customer requirements. Working together to create the perfect shot. I look forward to seeing what we can do for you!`,
];

export default function AboutPage() {
  return (
    <section className="wl-about">
      <div className="side">
        <div className="portrait">
          <Image
            src="/dan-portrait.jpg"
            alt="Dan Raby"
            fill
            sizes="(max-width: 900px) 100vw, 50vw"
            priority
            style={{ objectFit: 'cover' }}
          />
        </div>
        <div className="caption">
          <span>Dan Raby, at the studio</span>
          <span>Aurora, CO</span>
        </div>
      </div>

      <div className="letter">
        <span
          className="wl-eyebrow"
          style={{ display: 'inline-flex', marginBottom: 24 }}
        >
          A letter from the chief photographer
        </span>
        <h1>
          My name is <em>Dan Raby</em>.
        </h1>

        {LETTER.map((p, i) => (
          <p key={i}>{p}</p>
        ))}

        <div className="sig">— Dan</div>
        <div className="sig-sub">Chief Photographer · Wildlight Imagery</div>

        <div style={{ marginTop: 48, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link className="wl-btn primary" href="/contact?reason=commission">
            Commission Dan →
          </Link>
          <Link className="wl-btn ghost" href="/collections">
            Browse work
          </Link>
        </div>
      </div>
    </section>
  );
}
