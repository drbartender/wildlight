import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Event photography — Wildlight Imagery',
  description:
    'Event photography by Dan Raby — live music, performance, sport, brand and corporate events, festivals and celebrations across Denver and the Front Range. Weddings by arrangement.',
};

const offerings = [
  {
    no: 'I',
    title: 'Stage & Live Music',
    body:
      'Concerts, festivals, theater, dance. Low light is where I live — I shoot the performance the way it actually felt in the room, not the way a flash flattens it.',
  },
  {
    no: 'II',
    title: 'Sport & Action',
    body:
      'Track days, the field, the arena, the start line. Fast glass and faster reflexes for the one frame the whole moment turns on.',
  },
  {
    no: 'III',
    title: 'Brand & Corporate',
    body:
      'Conferences, launches, galas, team days. Coverage that hands your comms team a year of usable images — plus the candid frames that actually get shared.',
  },
  {
    no: 'IV',
    title: 'Celebrations',
    body:
      "Milestones, parties, family gatherings — and yes, weddings, for couples who want a documentary eye over a shot list. Tell me about the day and we'll see if it's a fit.",
  },
];

export default function EventsService() {
  return (
    <div className="wl-portraits">
      <section className="wlsv-hero">
        <span className="wl-eyebrow">Services</span>
        <h1>
          Event photography
          <br /> by <em>Dan Raby.</em>
        </h1>
        <p className="lede">
          Live music, performance, sport, brand work, and the moments worth
          keeping — across Denver and the Front Range. For the right event, Dan
          travels.
        </p>
      </section>

      <section className="wlsv-offer">
        <div className="wlsv-offer-h">
          <span className="wl-eyebrow">What Dan shoots</span>
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
            Tell Dan about your <em>event.</em>
          </h2>
          <p>
            Every booking starts with a short conversation about the day, the
            light, and what you want to walk away with. Drop a note and Dan will
            reply, usually within a day.
          </p>
          <Link
            className="wl-btn primary"
            href="/contact?reason=events"
          >
            Tell Dan about your event →
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
            <h4>Based in</h4>
            <p>
              Aurora, Colorado
              <br />
              Front Range &amp; beyond
            </p>
          </div>
          <div className="block">
            <h4>Booking</h4>
            <p>
              Dates by arrangement
              <br />
              Weekends fill first
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
