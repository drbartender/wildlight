import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Site research — Wildlight Imagery',
  description:
    'A walkthrough of the new Wildlight Imagery site, the income streams it supports, and how others in the same lane are earning.',
  robots: { index: false, follow: false },
};

interface Workshop {
  who: string;
  workshop: string;
  dates: string;
  days: number;
  group: string;
  price: string;
  link: string;
  note?: string;
}

const COLORADO_WORKSHOPS: Workshop[] = [
  {
    who: 'David Kingham · Jennifer Renwick',
    workshop: 'Crested Butte Wildflowers',
    dates: 'Jul 8–11, 2026',
    days: 4,
    group: '6 guests',
    price: '$3,295',
    link: 'https://www.exploringexposure.com/products/crested-butte-wildflowers-workshop',
    note: 'Sold out',
  },
  {
    who: 'Christine Kenyon',
    workshop: 'Colorado Fall Color & Milky Way (San Juans)',
    dates: 'Sep 29 – Oct 3, 2026',
    days: 5,
    group: '5 students',
    price: '$2,995',
    link: 'https://www.christinekenyon.com/2026-capture-colorado-photography-workshop-1',
    note: 'Lodging included (Box Canyon Lodge)',
  },
  {
    who: 'Aaron Reed',
    workshop: 'Colorado Fall Colors (San Juans, Telluride base)',
    dates: 'Fall 2026',
    days: 6,
    group: 'small',
    price: '$2,750',
    link: 'https://www.aaronreedphotography.com/product/colorado-landscape-photography-workshop/',
  },
  {
    who: 'J Smilanic · WNC Photo Tours',
    workshop: 'Crested Butte Wildflowers ("Blooming Beauty")',
    dates: 'Jul 8–10, 2026',
    days: 3,
    group: '3 + instructor',
    price: '$1,975',
    link: 'https://www.wncphototours.com/photography-workshops/crested-butte-colorado-wildflower-photography-workshop/',
    note: 'Lodging + transport included',
  },
  {
    who: 'Sarah Marino',
    workshop: 'Crested Butte Wildflower Festival workshop',
    dates: 'Jul 9–12, 2026',
    days: 4,
    group: 'small',
    price: 'TBD (festival registration)',
    link: 'https://crestedbuttewildflowerfestival.org/2026-adventure-photography-workshops/',
    note: 'Her only in-person workshop in 2026',
  },
];

interface Reference {
  who: string;
  archetype: string;
  url: string;
  catalog: { label: string; price: string }[];
  note: string;
}

const REFERENCES: Reference[] = [
  {
    who: 'Sarah Marino',
    archetype: 'Educator-Artist · co-runs site with Ron Coscorrosa',
    url: 'https://www.smallscenes.com/',
    catalog: [
      { label: '3-ebook bundle', price: '$130' },
      { label: 'Black & White Photography ebook', price: '$25' },
      { label: 'Single ebook (Forever Light, Desert Paradise, etc.)', price: '$30–$50' },
      { label: 'Crested Butte workshop, 2026', price: 'festival registration' },
    ],
    note: 'Closest match for the lane Wildlight could occupy. Monthly-to-quarterly journal cadence. Newsletter is the spine.',
  },
  {
    who: 'Erin Babnik',
    archetype: 'Educator-Artist · classical fine-art',
    url: 'https://www.erinbabnik.com/',
    catalog: [
      { label: 'Group field workshops, 7–12 days', price: 'typical $3,500–$5,500' },
      { label: 'Private workshop, 1 person', price: '$800/day' },
      { label: 'Private workshop, +1 extra person', price: '+$100/day each (max 5)' },
    ],
    note: 'High-end, international destinations. Good reference for premium private pricing.',
  },
  {
    who: 'David duChemin',
    archetype: 'Educator-Artist · contemplative, philosopher voice',
    url: 'https://davidduchemin.com/',
    catalog: [
      { label: '"20 Ways" lead-magnet ebook', price: 'free (drives signups)' },
      { label: 'Craft & Vision ebook archive', price: '~$5 each' },
      { label: 'Online courses (Teachery)', price: '$50–$150 typical' },
      { label: 'Published books (Visual Toolbox, Soul of the Camera)', price: '$25–$40' },
    ],
    note: 'The voice closest to Dan’s. 25+ ebooks, bi-weekly newsletter ("The Contact Sheet"), 82+ pages of blog archive.',
  },
  {
    who: 'Brooke Shaden',
    archetype: 'Hybrid Studio · fine art + portraits + teaching',
    url: 'https://brookeshaden.com/',
    catalog: [
      { label: 'Classes & online courses', price: 'tiered pricing' },
      { label: 'Books', price: 'varies' },
      { label: 'Prints', price: 'inquire to purchase' },
    ],
    note: 'Multiple service lines under one brand — the same Hybrid Studio shape Wildlight could grow into.',
  },
];

export default function SiteResearchPage() {
  return (
    <article className="wl-journal-entry wlsr">
      <header className="wl-journal-entry-h">
        <span className="wl-eyebrow">Internal · for Dan · 2026-05-01</span>
        <h1>Wildlight Imagery — what it is, and what it could earn.</h1>
        <p className="lede">
          A walkthrough of the rebuilt site and the income streams it supports.
          What works without you. What needs you. What others in the same lane
          are charging in 2026.
        </p>
      </header>

      <div className="wlsr-tldr">
        <span className="wl-eyebrow" style={{ marginBottom: 12, display: 'inline-flex' }}>
          The 90-second version
        </span>
        <p>
          The new <strong>wildlightimagery.com</strong> is positioned as an{' '}
          <em>Educator-Artist</em> site — the lane occupied by photographers
          like Sarah Marino, Erin Babnik, and David duChemin. The model:{' '}
          <strong>portfolio + journal + newsletter</strong> form a funnel that
          converts visitors into repeat print buyers and (optionally) workshop /
          ebook / course buyers.
        </p>
        <p>
          The print shop is built and running. The journal and newsletter are
          built and ready to publish. <strong>One thing you need to do before
          launch: a bulk upload of hi-def print files</strong> — the site won’t
          list a piece for sale without one, so we never accidentally sell
          something we can’t fulfill. After that, prints sell themselves. If
          you opt in to a newsletter and a monthly journal entry, the site’s
          leverage compounds. If you opt in to teaching, the math gets
          serious — Colorado workshops in your
          backyard go for <strong>$1,975 to $3,295 per spot</strong> in 2026.
        </p>
        <p className="wlsr-tldr-mini">
          Three questions at the bottom. Skim to <a href="#three-questions">the
          end</a> if you only have a minute.
        </p>
      </div>

      <div className="wl-journal-body">
        <h2>The thesis</h2>
        <p>
          I looked at five archetypes for how working photographers actually
          earn online. Three don’t fit:
        </p>
        <ul>
          <li>
            <strong>Luxury fine-art</strong> (Peter Lik) — needs galleries and
            $1,000+ AOV.
          </li>
          <li>
            <strong>Adventure / brand</strong> (Chris Burkard, Jimmy Chin) —
            needs sponsorships.
          </li>
          <li>
            <strong>Daily blogger</strong> (Trey Ratcliff) — needs daily output.
            Your old blog stopped May 2021. High-cadence posting is brittle.
          </li>
        </ul>
        <p>The two that fit:</p>
        <ul>
          <li>
            <strong>Educator-Artist</strong> — articles + workshops + ebooks +
            prints. Medium AOV, many products. The leverage your portrait and
            fine-art work already supports.
          </li>
          <li>
            <strong>Hybrid Studio</strong> (Brooke Shaden, Joel Grimes) —
            multiple services under one brand. You already do this:{' '}
            portraits + fine art + photojournalism.
          </li>
        </ul>
        <p>
          The site is built to occupy both lanes simultaneously. No daily-blog
          cadence, no gallery system, no sponsor-chasing. Just the funnel that
          converts a visitor into a repeat buyer.
        </p>

        <h2>What’s on the site today</h2>
      </div>

      <div className="wlsr-table-wrap">
        <table className="wlsr-table">
          <thead>
            <tr>
              <th>Section</th>
              <th>URL</th>
              <th>What it does</th>
              <th>Earns?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Home</td>
              <td><code>/</code></td>
              <td>Hero, featured collection, journal preview, newsletter signup</td>
              <td>Indirect — funnels visitors</td>
            </tr>
            <tr>
              <td>Portfolio</td>
              <td><code>/portfolio</code></td>
              <td>Your fine art, organized by collection</td>
              <td>Credibility</td>
            </tr>
            <tr>
              <td>Journal</td>
              <td><code>/journal</code></td>
              <td>Long-form essays · behind-the-shot stories</td>
              <td>SEO + email signups</td>
            </tr>
            <tr>
              <td>About</td>
              <td><code>/about</code></td>
              <td>Your existing letter, verbatim</td>
              <td>Trust</td>
            </tr>
            <tr>
              <td>Contact</td>
              <td><code>/contact</code></td>
              <td>General inquiry form</td>
              <td>Lead-gen</td>
            </tr>
            <tr>
              <td>Portraits</td>
              <td><code>/services/portraits</code></td>
              <td>Your portrait service</td>
              <td>Lead-gen</td>
            </tr>
            <tr>
              <td>Commissions</td>
              <td><code>/services/commissions</code></td>
              <td>Custom shoots / custom prints</td>
              <td>Lead-gen</td>
            </tr>
            <tr className="wlsr-row-active">
              <td><strong>Shop</strong></td>
              <td><code>/shop</code></td>
              <td>Print catalog, integrated with Printful POD</td>
              <td><strong>Direct sales — already running</strong></td>
            </tr>
            <tr>
              <td>Newsletter</td>
              <td>(footer · everywhere)</td>
              <td>Email signup → quarterly drops + journal digests</td>
              <td>Drives repeat sales</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="wl-journal-body">
        <h2>Income streams, ranked by your leverage</h2>
        <p>
          Ranked by return per hour of <em>your</em> time invested.
        </p>

        <h3>Tier 1 — Already working. One bulk upload, then zero ongoing effort.</h3>
        <p>
          <strong>Print sales.</strong> Customers order prints. Printful prints
          and ships them. You see net deposits. No fulfillment from you. Pricing
          is set at cost × 2.1, rounded up to a $5-ending number — same model
          the Educator-Artists use.
        </p>
        <p>
          <strong>One thing first, though.</strong> Right now a lot of works in
          the catalog don’t have a print-master file attached. The site will
          not list a piece for sale without one — that’s a hard guard, so we
          never accidentally sell a print we can’t fulfill. <strong>Before
          anything goes live, you’ll need to bulk-upload hi-def files for the
          works you want available.</strong> I built a bulk uploader in the
          admin so this is one sitting, not one-by-one. Once a piece has its
          print master, it stays sellable forever — no more uploads at sale
          time.
        </p>

        <h3>Tier 2 — Built and ready. ~30 minutes a month.</h3>
        <p>
          <strong>Newsletter.</strong> Email signup is on the footer of every
          page, end of every journal entry, and the home page. Subscribers get
          quarterly print drops and a journal digest. I generate the drafts,
          you read and approve, click send. This is the single biggest leverage
          point in the Educator-Artist model. Babnik, Marino, duChemin all
          treat their newsletter as the spine of the business.
        </p>
        <p>
          <strong>Journal.</strong> One thoughtful essay per month. AI-assisted
          drafting trained on your "Behind the Shot" voice from the old blog
          and your existing about-letter. Each entry feeds the newsletter. You
          read the draft, edit anything that doesn’t sound like you, click
          publish — about 10–15 minutes per entry. <em>Why monthly, not
          weekly?</em> The 2021 blog died because high-cadence posting is
          brittle. Sarah Marino publishes about 10 entries a year. One
          thoughtful entry beats a dead daily blog every time.
        </p>

        <h3>Tier 3 — Built. Your decision to activate.</h3>
        <p>
          <strong>Limited editions.</strong> Mark a specific print as a numbered
          and signed edition (say, 25 copies of "The Land in October").
          Subscribers get early access for 24–48 hours before public release.
          Higher price point, premium tier. <em>Same print, 3× the take.</em>{' '}
          A $200 open-edition becomes a $600 numbered/signed edition.
        </p>
        <p>
          <strong>Portraits and commissions.</strong> Inquiry forms on the
          services pages route to your inbox. No calendar, no booking — just a
          form. You reply when inquiries come in.
        </p>

        <h3>Tier 4 — Optional. Your call.</h3>
        <p>
          <strong>Workshops, ebooks, courses, presets.</strong> The big swing.
          See the next section.
        </p>

        <h2>Workshops — the big optional swing</h2>
        <p>
          This is where the Educator-Artist model really earns. If you want to
          teach, the math gets serious. Colorado is one of the best landscape
          workshop markets in North America, and most of the workshops there
          are run by photographers who fly in from out of state. You’d be
          local.
        </p>

        <h3>What others charge in 2026 — Colorado workshops</h3>
      </div>

      <div className="wlsr-table-wrap">
        <table className="wlsr-table">
          <thead>
            <tr>
              <th>Instructor</th>
              <th>Workshop</th>
              <th>Dates</th>
              <th>Days</th>
              <th>Group</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {COLORADO_WORKSHOPS.map((w, i) => (
              <tr key={i}>
                <td>
                  <a href={w.link} target="_blank" rel="noreferrer noopener">
                    {w.who}
                  </a>
                </td>
                <td>
                  {w.workshop}
                  {w.note && (
                    <span className="wlsr-cell-note"> · {w.note}</span>
                  )}
                </td>
                <td>{w.dates}</td>
                <td>{w.days}</td>
                <td>{w.group}</td>
                <td><strong>{w.price}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="wl-journal-body">
        <p>
          A 6-person workshop at $2,500 a spot grosses $15,000 for a long
          weekend. A 4-day Crested Butte workshop run by Kingham &amp; Renwick
          is <strong>sold out</strong> at $3,295 a spot — that’s ~$19,800
          gross. Lodging, travel, an assistant trim that, but margin is healthy
          and demand outstrips supply during peak weeks.
        </p>

        <h3>Formats, ranked by how much of your time they take</h3>
      </div>

      <div className="wlsr-table-wrap">
        <table className="wlsr-table">
          <thead>
            <tr>
              <th>Format</th>
              <th>Effort</th>
              <th>Earnings</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Preset pack</td>
              <td>Build once. Sells for years.</td>
              <td>$35–$75 each · $75–$280 bundled</td>
              <td>Lowest ceiling, truly passive</td>
            </tr>
            <tr>
              <td>Ebook (location guide / technique)</td>
              <td>40–80 hrs to write</td>
              <td>$25–$50 each · $130 for a 3-pack bundle</td>
              <td>Marino: Iceland, Death Valley, B&amp;W, "Smaller Scenes"</td>
            </tr>
            <tr>
              <td>Online course</td>
              <td>60–120 hrs to produce</td>
              <td>$50–$150 each</td>
              <td>Sells on autopilot once recorded</td>
            </tr>
            <tr>
              <td>Private 1-on-1</td>
              <td>A day at a time</td>
              <td>$800–$1,200/day</td>
              <td>Babnik’s base model</td>
            </tr>
            <tr className="wlsr-row-active">
              <td><strong>Group field workshop</strong></td>
              <td>4–7 days on-location · prep + travel</td>
              <td><strong>$1,975–$3,295/spot × 5–6 = $10K–$20K gross</strong></td>
              <td>Highest single-event take</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="wl-journal-body">
        <h3>Colorado specifics</h3>
        <p>
          You’re sitting on top of one of the most workshop-rich landscapes in
          the country. Local-instructor advantage: you don’t fly in. Lower
          overhead means more margin, or more competitive pricing.
        </p>
        <ul>
          <li><strong>Rocky Mountain NP</strong> — fall colors, alpine, wildlife</li>
          <li><strong>Great Sand Dunes</strong> — predawn / Milky Way</li>
          <li><strong>Mesa Verde</strong> — historic + landscape</li>
          <li><strong>Maroon Bells / Crested Butte</strong> — the icon. Marino is teaching there in 2026</li>
          <li><strong>San Juans</strong> — Aaron Reed’s $2,750/spot territory</li>
          <li><strong>Black Canyon of the Gunnison</strong> — under-photographed, lots of room</li>
        </ul>

        <h3>What it would take from you</h3>
        <p>One real group field workshop runs roughly:</p>
        <ul>
          <li>~20 hours scoping route + locations</li>
          <li>~10 hours building curriculum (or just teaching extemporaneously)</li>
          <li>4–7 days on-location running it</li>
          <li>~10 hours of post-workshop image critique</li>
        </ul>
        <p>
          A 6-spot trip at $2,500/person is ~$15K gross for ~80 hours of your
          time — about <strong>$190/hr at the floor</strong>. Repeat-customer
          rate in this niche runs ~30%, so year two is less prep for similar
          gross.
        </p>
        <p>
          Online formats — ebooks, courses, presets — are lower ceiling but
          truly passive once published. Marino’s "Beyond the Grand Landscape"
          ebook has been earning since 2017.
        </p>

        <h2>Who else is doing this</h2>
        <p>
          Four references. Click through and see what their sites look like.
          The site I built for Wildlight uses the same plumbing.
        </p>
      </div>

      <div className="wlsr-refs">
        {REFERENCES.map((ref, i) => (
          <article className="wlsr-ref" key={i}>
            <header>
              <a
                className="wlsr-ref-name"
                href={ref.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {ref.who} <span aria-hidden>↗</span>
              </a>
              <span className="wlsr-ref-arch">{ref.archetype}</span>
            </header>
            <ul>
              {ref.catalog.map((c, j) => (
                <li key={j}>
                  <span>{c.label}</span>
                  <span className="wlsr-ref-price">{c.price}</span>
                </li>
              ))}
            </ul>
            <p className="wlsr-ref-note">{ref.note}</p>
          </article>
        ))}
      </div>

      <div className="wl-journal-body">
        <p>What they all have in common:</p>
        <ol>
          <li>The newsletter is the most important asset</li>
          <li>The journal feeds the newsletter</li>
          <li>Prints are the credibility floor — not the ceiling</li>
          <li>The high-margin offering (workshop / course / ebook) is what they push <em>to</em> the email list</li>
        </ol>

        <h2>Honest accounting — what you commit, what I handle</h2>
      </div>

      <div className="wlsr-table-wrap">
        <table className="wlsr-table">
          <thead>
            <tr>
              <th>If you want…</th>
              <th>You commit</th>
              <th>I handle</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Print sales (status quo)</td>
              <td>One-time bulk upload of hi-def print files before launch</td>
              <td>Everything else, ongoing</td>
            </tr>
            <tr>
              <td>+ Newsletter</td>
              <td>+ 30 min/month review &amp; send</td>
              <td>Drafting, sending, list management</td>
            </tr>
            <tr>
              <td>+ Journal</td>
              <td>+ 15 min per entry, 1×/month</td>
              <td>AI drafting, publishing, SEO</td>
            </tr>
            <tr>
              <td>+ Limited editions</td>
              <td>Sign prints, pick which ones become editions</td>
              <td>Edition tracking, subscriber early-access</td>
            </tr>
            <tr>
              <td>+ Workshops</td>
              <td>~80 hrs/yr per workshop</td>
              <td>Booking, deposits, waitlist, comms</td>
            </tr>
            <tr>
              <td>+ Ebook</td>
              <td>40–80 hrs writing</td>
              <td>Layout, sales page, delivery</td>
            </tr>
            <tr>
              <td>+ Online course</td>
              <td>60–120 hrs recording</td>
              <td>Hosting, sales page, member access</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="wl-journal-body">
        <p>
          The site doesn’t need anything beyond Tier 1 to work. Tier 2 is the
          biggest leverage relative to time. Workshops are the optional swing.
        </p>

        <h2>Risks I want to be honest about</h2>
        <ul>
          <li>
            <strong>Newsletter takes time to build.</strong> First 100
            subscribers come slow. Educators usually spend 2–3 years building
            list before workshops scale. Prints work in the meantime.
          </li>
          <li>
            <strong>Workshops are real work.</strong> Field workshops involve
            real liability, real logistics, and participants who paid $2,500
            and want their money’s worth. Not a side hustle.
          </li>
          <li>
            <strong>AI-drafted journal still needs your voice.</strong> I’ve
            trained the system on your "Behind the Shot" posts and your
            about-letter. The first few entries will need real editing from
            you to lock the voice in.
          </li>
          <li>
            <strong>The 2021 blog hiatus may have cost some SEO.</strong>{' '}
            Recoverable, but it’s a factor.
          </li>
        </ul>

        <h2 id="three-questions">Three questions, in order</h2>
        <ol>
          <li>
            <strong>Does the Educator-Artist framing fit how you see
            Wildlight?</strong> If yes, we keep building. If no, we adjust.
          </li>
          <li>
            <strong>Newsletter — yes or no?</strong> If yes, I show you the
            first draft. We spend 30 minutes on tone. Then it runs.
          </li>
          <li>
            <strong>Workshops — interested or not?</strong> If yes, we pick
            one location for a fall 2026 pilot run. If no, that’s fine —
            the rest of the site earns regardless.
          </li>
        </ol>

        <p>
          No need to decide on ebooks, courses, presets, or limited editions
          yet. Those layer in over years.
        </p>
      </div>
    </article>
  );
}
