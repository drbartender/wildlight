import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portrait photography — Wildlight Imagery',
  description:
    'Headshots, families, and editorial commissions by Dan Raby. Studio + on-location, in Denver and Aurora.',
};

const offerings = [
  {
    no: 'I',
    title: 'Studio Sessions',
    body:
      "Headshots, family portraits, and product work shot in a controlled studio environment in Aurora. We talk through what you have in mind, then I do my best to find the version of you that the camera doesn't usually catch.",
  },
  {
    no: 'II',
    title: 'On-Location Sessions',
    body:
      'Outdoors, in your home, at the office, or anywhere the light is doing something interesting. Denver and the Front Range; further afield by arrangement. Working together to create the perfect shot.',
  },
  {
    no: 'III',
    title: 'Editorial & Commercial',
    body:
      "For publications, businesses, and brands. I can stay true to a brief, a brand book, or an art director's vision — and bring my own eye when you want one. Let's try this and see what happens.",
  },
];

export default function PortraitsService() {
  return (
    <div className="wl-portraits">
      <section className="wlsv-hero">
        <span className="wl-eyebrow">Services</span>
        <h1>
          Portrait photography
          <br /> by <em>Dan Raby.</em>
        </h1>
        <p className="lede">
          Headshots, families, and editorial commissions. Studio +
          on-location, in Denver and Aurora — and wherever else the work
          calls for.
        </p>
      </section>

      <section className="wlsv-offer">
        <div className="wlsv-offer-h">
          <span className="wl-eyebrow">What we offer</span>
          <div className="wl-rule" />
        </div>
        <div className="wlsv-offer-grid">
          {offerings.map((o) => (
            <div key={o.no} className="wlsv-offer-card">
              <span className="wlsv-offer-no">{o.no}</span>
              <h3>
                {o.title}
                <em>.</em>
              </h3>
              <p>{o.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="wlsv-inquire">
        <div className="wlsv-inquire-body">
          <h2>
            Tell Dan what you have in <em>mind.</em>
          </h2>
          <p>
            Every commission begins with a short conversation. Drop a note
            about the shoot you&apos;re imagining and Dan will reply, usually
            within a day.
          </p>
          <Link
            className="wl-btn primary"
            href="/contact?reason=commission&topic=portraits"
          >
            Tell Dan what you have in mind →
          </Link>
        </div>
        <div className="wlsv-inquire-side">
          <div className="block">
            <h4>Direct</h4>
            <p>
              dan@wildlightimagery.shop
              <br />
              720.363.9430
            </p>
          </div>
          <div className="block">
            <h4>Studio</h4>
            <p>
              Aurora, Colorado
              <br />
              By appointment only
            </p>
          </div>
          <div className="block">
            <h4>Hours</h4>
            <p>
              Mon–Fri, most afternoons
              <br />
              Weekends in the field
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
