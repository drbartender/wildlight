#!/usr/bin/env node
/*
 * Builds scraped/curate.html — a single self-contained page for picking the
 * 50 launch images out of the 198 imported drafts.
 *
 * - Reads scraped/manifest.json
 * - Inlines my pre-votes (PREVOTES below) so the page works offline
 * - Image src uses scraper's relative path: scraped/<collection-title>/<filename>
 *
 * Re-run after editing PREVOTES to refresh the page.
 */
const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const MANIFEST_PATH = resolve(__dirname, '..', 'scraped', 'manifest.json');
const OUT_PATH = resolve(__dirname, '..', 'scraped', 'curate.html');

// ---- pre-votes by filename --------------------------------------------------
// values: 'in' (strong pick) | 'maybe' (worth considering) | 'out' (skip)
// Anything not listed = unvoted, the user decides.
const PREVOTES = {
  // ------- the-night-1 (14) ----------------------------------------------
  'us3-1-scaled.jpg': 'in',                                       // Union Station front + light trails — HERO
  '129338.jpg': 'in',                                             // Lighthouse + aurora — HERO
  'light1.jpg': 'in',                                             // Lighthouse + Milky Way
  'mb1-1-scaled.jpg': 'in',                                       // DaVita bridge upward, graphic
  'dia.jpg': 'in',                                                // DIA airport tents B&W
  '57882405-10218444640092443-8767196533780119552-o-copy.jpg': 'in', // Red light trails
  'us1-1-scaled.jpg': 'maybe',                                    // Union Station underbridge alt
  '0001.jpg': 'maybe',                                            // Lit tree B&W
  '1-0001.jpg': 'maybe',                                          // Lit tree color
  'mb2-1-scaled.jpg': 'out',
  'mb3-1-scaled.jpg': 'out',
  '147691.jpg': 'out',                                            // Soft moon
  'sony-dsc.jpg': 'out',                                          // Lunar eclipse, mostly black
  'dc-260-790c38473813b.jpg': 'out',                              // Old film red trails

  // ------- the-unique (22) -----------------------------------------------
  'wi24573d-scaled.jpg': 'in',                                    // Red umbrella in snow + lake
  'wi24557-scaled.jpg': 'in',                                     // Red coat walker, snowy hillside
  'wi24624-scaled.jpg': 'in',                                     // Multicolor umbrellas in city snow
  'or11wm-scaled.jpg': 'in',                                      // Turtle close-up
  'or14wm-scaled.jpg': 'in',                                      // Swan portrait
  'wi23472-scaled.jpg': 'in',                                     // Pink light trail through snow
  'no-smoking.jpg': 'in',                                         // Burning Marlboro pack — statement
  'melting-icicles-3.jpg': 'in',                                  // Sharp icicle macro w/ bokeh
  'pride-day-v2.jpg': 'maybe',                                    // Rainbow pocket (cleaner of two)
  'or12wm-scaled.jpg': 'maybe',                                   // Egret takeoff
  'lr1-2-scaled.jpg': 'maybe',                                    // Train at Union Station
  'seasons.jpg': 'maybe',                                         // Three-panel stream seasons
  'or11bwm-scaled.jpg': 'maybe',                                  // Turtle in grass
  'pride-day.jpg': 'out',                                         // Alt of pride-day-v2
  'girl.jpg': 'out',                                              // Vintage B&W jeans, off-brand
  'poison-ivy.jpg': 'out',                                        // Generic leaf
  'concert.jpg': 'out',                                           // Blurry zoom
  'cookies.jpg': 'out',                                           // Low-quality scan
  'melting-icicles.jpg': 'out',                                   // Alt of -3
  'melting-icicles-1.jpg': 'out',
  'melting-icicles-2.jpg': 'out',
  'melting-icicles-4.jpg': 'out',

  // ------- the-sun-3 (24) ------------------------------------------------
  'brisk-sailing-captured-at-sunset.jpg': 'in',                   // Purple/red sailboat — HERO
  'stormy-sunset-on-lake-michigan-1.jpg': 'in',                   // Purple mammatus fisheye
  'sailboat-sunset-on-lake-michigan-2.jpg': 'in',                 // Red rowboat with paddles
  'stormy-sunset-on-lake-michigan-4.jpg': 'in',                   // Vertical blue/red sky
  'little-pointe-sable-lighthouse.jpg': 'in',                     // Beach lighthouse colored sky
  'love-on-the-lake.jpg': 'in',                                   // Heart hands at sunset (popular)
  'sun-and-birds-on-the-lake.jpg': 'in',                          // Birds + sunset, classic
  'grand-lake-sunset.jpg': 'in',                                  // Pink Colorado mountain stream
  'or16wm-scaled.jpg': 'maybe',                                   // Orlando skyline w/ fountain
  'or15wm-scaled.jpg': 'maybe',                                   // Florida silhouette trees
  'stormy-sunset-on-lake-michigan-3.jpg': 'maybe',                // Vertical purple/blue
  'sail-boat.jpg': 'maybe',                                       // Orange sailboat
  'little-pointe-sable-lighthouse-1.jpg': 'maybe',                // Daytime lighthouse
  'sailboat-sunset-on-lake-michigan-1.jpg': 'maybe',              // Fisheye sand at dusk
  'sunset-on-lake-michigan-1.jpg': 'maybe',                       // Purple storm cloud
  'fishers-of-man.jpg': 'maybe',                                  // Vertical purple sunset
  'sailboat-sunset-on-lake-michigan.jpg': 'out',                  // Fisheye dunes (mistitled)
  'sunset-on-lake-michigan.jpg': 'out',
  'stormy-sunset-on-lake-michigan-2.jpg': 'out',
  'stormy-sunset-on-lake-michigan.jpg': 'out',
  'water-fun-in-lake-michigan.jpg': 'out',                        // Splash silhouette, dynamic but cluttered
  'water-fun-in-lake-michigan-1.jpg': 'out',                      // Hair flip alt
  'i-am-woman-hear-me-roar.jpg': 'out',                           // Mostly dark
  'sunset-on-the-deck.jpg': 'out',                                // Lens flare, weak

  // ------- the-land (28) -------------------------------------------------
  'wi23116-scaled.jpg': 'in',                                     // Snow trees with falling flakes
  'chicago-il-1.jpg': 'in',                                       // Cloud Gate at night — ICONIC
  'chicago-il-3.jpg': 'in',                                       // Chicago Theatre marquee
  'chicago-il-4.jpg': 'in',                                       // Skyline highway w/ light beam
  'kansas-city-3.jpg': 'in',                                      // Liberty Memorial column
  'kansas-city-5.jpg': 'in',                                      // Kauffman Center white arches
  'kansas-city-9.jpg': 'in',                                      // Town Topic Hamburgers neon
  'kansas-city-7.jpg': 'in',                                      // Negro Leagues mural + field
  'or08wm-scaled.jpg': 'maybe',                                   // Modern blue/red glass building
  'or9bwm-scaled.jpg': 'maybe',                                   // Palm tree from below
  'or10wm-scaled.jpg': 'maybe',                                   // Palm tree color version
  'or04wm-scaled.jpg': 'maybe',                                   // Yellow corridor with arches
  'or05wm-scaled.jpg': 'maybe',                                   // Same corridor B&W
  'chicago-il-2.jpg': 'maybe',                                    // American flag building
  'chicago-il-5.jpg': 'maybe',                                    // Marina City corncob towers
  'chicago-il.jpg': 'maybe',                                      // Bean ultrawide alt
  'kansas-city-10.jpg': 'maybe',                                  // Scout sculpture w/ KC skyline
  'kansas-city.jpg': 'maybe',                                     // Kemper cables/glass
  'kansas-city-2.jpg': 'maybe',                                   // "Don't Give Up" sign
  'kansas-city-6.jpg': 'maybe',                                   // YMCA building, red fire escape
  'or07wm-scaled.jpg': 'maybe',                                   // Winter Park train station
  'dc-260-790c38473316.jpg': 'out',                               // Dated film flatiron
  'bloods-point-cemetary-rockford-illinois.jpg': 'out',           // Gravestone
  '1dr7961g3.jpg': 'out',                                         // Mundane bridge sidewalk
  'kansas-city-4.jpg': 'out',
  'kansas-city-8.jpg': 'out',
  'kansas-city-11.jpg': 'out',                                    // Cake Alley graffiti

  // ------- the-macro-8 (34) ----------------------------------------------
  'bubbles.jpg': 'in',                                            // Rainbow soap bubble — best of 7
  'kiwi-fruit.jpg': 'in',                                         // Kiwi cross-section in bubbles
  'grape-fruit.jpg': 'in',                                        // Grapefruit cross section, hot pink
  'lemon-fruit.jpg': 'in',                                        // Lemon slice on dark blue
  'lime-fruit-1.jpg': 'in',                                       // Lime cross-section w/ bubbles
  'star-fruit.jpg': 'in',                                         // Starfruit shape in bubbles
  'tiny-pine-cones.jpg': 'in',                                    // Sharp small reddish cones
  'mr-bee.jpg': 'in',                                             // Bee on white flowers
  'flower-town.jpg': 'in',                                        // Orange flower stamen
  'a-flower.jpg': 'maybe',                                        // Daisy w/ water drops
  'bug-on-a-flower.jpg': 'maybe',                                 // Green bug on daisy
  'orange-fruit.jpg': 'maybe',                                    // Orange slice macro
  'lime-fruit-lemon-colored.jpg': 'maybe',                        // Yellow lime macro
  'leaf.jpg': 'maybe',                                            // Green leaf veins
  'seeds.jpg': 'maybe',                                           // Pomegranate seeds
  'electronics.jpg': 'maybe',                                     // Capacitors macro
  'kids20181226190275.jpg': 'maybe',                              // Housefly macro
  'bubbles-1.jpg': 'out',                                         // Bubble alts
  'bubbles-2.jpg': 'out',
  'bubbles-3.jpg': 'out',
  'bubbles-4.jpg': 'out',
  'bubbles-5.jpg': 'out',
  'bubbles-6.jpg': 'out',
  'lime-fruit.jpg': 'out',
  'lime-fruit-2.jpg': 'out',
  'lime-fruit-3.jpg': 'out',
  'lemon-fruit-1.jpg': 'out',
  'lights-in-the-kitchen.jpg': 'out',
  'lights-in-the-kitchen-v2.jpg': 'out',
  'after-a-hail-storm.jpg': 'out',
  'breakfast.jpg': 'out',                                         // Cereal, off-brand
  'mr-bee-1.jpg': 'out',
  'kids20181226190273.jpg': 'out',
  'kids20181226190274.jpg': 'out',

  // ------- flowers (76) — partial pre-votes from named/high-res set ------
  't1.jpg': 'in',                                                 // Dense yellow/red tulips backlit — painterly
  'f01.jpg': 'in',                                                // White/pink crocus on rocks, water drops
  'f04.jpg': 'in',                                                // Pink crocus macro w/ exquisite drops
  'f06.jpg': 'in',                                                // Purple phlox carpet — graphic
  'f08.jpg': 'in',                                                // 4 red tulips top-down with stamens — clean classic
  'f09.jpg': 'in',                                                // Pink/purple/white tulips at park — environmental
  'f12.jpg': 'in',                                                // Orange tulips backlit — luminous
  'f18.jpg': 'in',                                                // Hyacinth in snow — atmospheric
  'f19.jpg': 'in',                                                // Daffodil in falling snow — HERO mood
  'f20.jpg': 'in',                                                // Red lily detail w/ anthers — exquisite macro
  'wi24302bb-scaled.jpg': 'in',                                   // Red tulip macro with anthers — painterly
  't2.jpg': 'maybe',                                              // Yellow tulips w/ raindrops
  't3.jpg': 'maybe',                                              // Red/yellow tulip cluster (alt of t1)
  't4.jpg': 'maybe',                                              // Close-up red/yellow tulip cluster
  't5.jpg': 'maybe',                                              // Tulips against sky w/ house
  'f1.jpg': 'maybe',                                              // Red lily macro w/ green leaf
  'f2.jpg': 'maybe',                                              // Pink/white tulips cluster
  'f13.jpg': 'maybe',                                              // Purple tulips w/ white-spotted variants
  'f15.jpg': 'maybe',                                              // Phlox split purple/pink — color dynamic
  'f17.jpg': 'maybe',                                              // Yellow daisy macro
  'lilywlic30-1.jpg': 'maybe',                                    // Red/orange lily w/ stamens
  'wi24317-scaled.jpg': 'out',                                    // Architecture (misfiled — hexagonal shingles)
  'f16.jpg': 'out',                                               // Distant orange tulips in field — too far
  'lilywlid30.jpg': 'out',                                        // Succulent rosettes — boring
  // (51 unvoted flowers — user clicks through to confirm or pick alternates)
};

// ---- build ------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wildlight launch — pick 50</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: #0e1a2c;
    color: #e7eaf0;
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    padding: 16px 16px 96px;
  }
  h1 { color: #fff; font-weight: 300; font-size: 22px; margin: 0 0 4px; letter-spacing: .02em; }
  h1 em { color: #5dd6ff; font-style: normal; font-weight: 400; }
  .sub { color: #8ba1c4; font-size: 12px; margin: 0 0 16px; }
  .sub kbd { background: #1d2c44; border: 1px solid #2a3a52; border-radius: 3px; padding: 1px 5px; font-family: inherit; font-size: 11px; }

  .stickyhdr {
    position: sticky; top: 0; z-index: 10;
    background: rgba(14,26,44,0.92);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    padding: 12px 0;
    border-bottom: 1px solid #2a3a52;
    margin: 0 -16px 16px;
    padding: 12px 16px;
  }
  .row { display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
  .count { font-size: 32px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; }
  .countgood { color: #5dd6ff; }
  .countunder { color: #ffd25d; }
  .countover { color: #ff7a7a; }
  .countlbl { color: #8ba1c4; font-size: 13px; }
  .balance { display: flex; gap: 4px; height: 28px; margin-top: 12px; padding-top: 14px; }
  .bbar {
    flex: 1; min-width: 60px; background: #1d2c44; border-radius: 4px; overflow: hidden;
    position: relative;
  }
  .bbar > i {
    display: block; height: 100%;
    background: linear-gradient(180deg, #5dd6ff, #2ab7e6);
    transition: width .15s;
  }
  .bbar > span {
    position: absolute; top: -16px; left: 0; right: 0;
    font-size: 10px; color: #8ba1c4; text-align: center;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .filter { display: inline-flex; gap: 4px; margin-left: auto; }
  .filter button {
    background: #1d2c44; color: #8ba1c4; border: 1px solid #2a3a52;
    padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;
  }
  .filter button.on { background: #5dd6ff; color: #0e1a2c; border-color: #5dd6ff; }

  .cat { margin: 32px 0 12px; color: #5dd6ff; font-weight: 500; font-size: 15px; letter-spacing: .04em; text-transform: uppercase; }
  .cat .cnt { color: #8ba1c4; font-weight: 400; font-size: 12px; margin-left: 8px; text-transform: none; letter-spacing: 0; }
  .cat .tip { color: #5e759a; font-weight: 400; font-size: 11px; margin-left: 12px; text-transform: none; letter-spacing: 0; font-style: italic; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 8px;
  }
  .card {
    position: relative; aspect-ratio: 4/3;
    background: #1d2c44;
    border-radius: 6px; overflow: hidden;
    cursor: pointer;
    transition: transform .1s, box-shadow .1s, opacity .15s;
    user-select: none;
  }
  .card img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card:hover { transform: scale(1.015); z-index: 2; }
  .card.in { box-shadow: 0 0 0 3px #5dd6ff, 0 4px 12px #5dd6ff33; }
  .card.maybe { box-shadow: 0 0 0 3px #ffd25d; }
  .card.out { opacity: .22; filter: grayscale(.6); }
  .card.out:hover { opacity: .55; }

  .vote {
    position: absolute; top: 6px; right: 6px;
    background: rgba(0,0,0,.65);
    color: #fff;
    width: 26px; height: 26px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 14px;
  }
  .vote.in { background: #5dd6ff; color: #0e1a2c; }
  .vote.maybe { background: #ffd25d; color: #0e1a2c; }
  .vote.out { background: rgba(255,122,122,.85); color: #fff; font-size: 12px; }

  .meta {
    position: absolute; bottom: 0; left: 0; right: 0;
    background: linear-gradient(transparent, rgba(0,0,0,.85));
    padding: 24px 8px 6px;
    font-size: 11px; color: #d8e0ed;
    pointer-events: none;
  }
  .meta b { color: #fff; font-weight: 500; }
  .meta .kb { color: #8ba1c4; font-size: 10px; }

  .controls {
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #0a1422;
    border-top: 1px solid #2a3a52;
    padding: 12px 16px;
    display: flex; gap: 8px; align-items: center;
    z-index: 20;
  }
  button.primary {
    background: linear-gradient(180deg, #5dd6ff, #2ab7e6);
    color: #0a1422; border: 0;
    padding: 9px 18px; font-weight: 600;
    border-radius: 4px; cursor: pointer; font-size: 13px;
  }
  button.primary:hover { filter: brightness(1.1); }
  button.secondary {
    background: #1d2c44; color: #e7eaf0; border: 1px solid #2a3a52;
    padding: 9px 14px; border-radius: 4px; cursor: pointer; font-size: 13px;
  }
  .legend { color: #8ba1c4; font-size: 11px; margin-left: auto; }
</style>
</head>
<body>
  <h1>wildlight launch — pick <em>50</em></h1>
  <p class="sub">
    Click cycles: <kbd style="color:#5dd6ff">IN</kbd> → <kbd style="color:#ffd25d">MAYBE</kbd> → <kbd style="color:#ff7a7a">OUT</kbd> → unvoted.
    Shift-click jumps straight to MAYBE. Ctrl-click jumps straight to OUT.
    My pre-votes are loaded; your changes save automatically. Hit <em>Save selections.json</em> when you're at 50.
  </p>

  <div class="stickyhdr">
    <div class="row">
      <div>
        <span class="count" id="count">0</span>
        <span class="countlbl">/ 50 selected</span>
      </div>
      <div style="margin-left:24px">
        <span class="countlbl">maybe</span>
        <span style="font-size:18px;color:#ffd25d;font-weight:600;font-variant-numeric:tabular-nums" id="maybeCount">0</span>
      </div>
      <div class="filter">
        <button data-f="all" class="on">All</button>
        <button data-f="in">In</button>
        <button data-f="maybe">Maybe</button>
        <button data-f="unvoted">Unvoted</button>
        <button data-f="out">Out</button>
      </div>
    </div>
    <div class="balance" id="balance"></div>
  </div>

  <div id="content"></div>

  <div class="controls">
    <button class="primary" onclick="exportJson()">Save selections.json</button>
    <button class="secondary" onclick="if(confirm('Reset to my pre-votes? Loses your edits.')) reset()">Reset to pre-votes</button>
    <button class="secondary" onclick="if(confirm('Clear ALL votes?')) clearAll()">Clear all</button>
    <span class="legend">Saved automatically to browser. Open in same browser to resume.</span>
  </div>

<script>
const MANIFEST = ${JSON.stringify(manifest)};
const PREVOTES = ${JSON.stringify(PREVOTES)};
const TARGET = 50;
const STORAGE_KEY = 'wildlight-curate-votes-v1';

let votes = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {...PREVOTES};
let filterMode = 'all';

function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(votes)); render(); }
function reset() { votes = {...PREVOTES}; save(); }
function clearAll() { votes = {}; save(); }

function cycle(filename, ev) {
  const cur = votes[filename];
  if (ev.shiftKey) { votes[filename] = 'maybe'; }
  else if (ev.ctrlKey || ev.metaKey) { votes[filename] = 'out'; }
  else if (!cur) votes[filename] = 'in';
  else if (cur === 'in') votes[filename] = 'maybe';
  else if (cur === 'maybe') votes[filename] = 'out';
  else delete votes[filename];
  save();
}

document.querySelectorAll('.filter button').forEach(b => {
  b.onclick = () => {
    filterMode = b.dataset.f;
    document.querySelectorAll('.filter button').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    render();
  };
});

function passesFilter(v) {
  if (filterMode === 'all') return true;
  if (filterMode === 'unvoted') return !v;
  return v === filterMode;
}

function render() {
  const inCount = Object.values(votes).filter(v => v === 'in').length;
  const maybeCount = Object.values(votes).filter(v => v === 'maybe').length;

  const ce = document.getElementById('count');
  ce.textContent = inCount;
  ce.className = 'count ' + (inCount === TARGET ? 'countgood' : inCount > TARGET ? 'countover' : 'countunder');
  document.getElementById('maybeCount').textContent = maybeCount;

  // category balance bars
  const balance = document.getElementById('balance');
  balance.innerHTML = '';
  for (const c of MANIFEST.collections) {
    const inCat = c.artworks.filter(a => votes[a.filename] === 'in').length;
    const maybeCat = c.artworks.filter(a => votes[a.filename] === 'maybe').length;
    const max = c.artworks.length;
    const pct = max ? (inCat / max * 100) : 0;
    const bar = document.createElement('div');
    bar.className = 'bbar';
    bar.title = c.title + ': ' + inCat + ' in (+' + maybeCat + ' maybe) of ' + max;
    bar.innerHTML = '<span>' + c.title.replace(/-\\d+$/, '') + ' · ' + inCat + (maybeCat ? ' (+' + maybeCat + ')' : '') + '</span><i style="width:' + pct + '%"></i>';
    balance.appendChild(bar);
  }

  // grid
  const root = document.getElementById('content');
  root.innerHTML = '';
  for (const c of MANIFEST.collections) {
    const visible = c.artworks.filter(a => passesFilter(votes[a.filename]));
    if (!visible.length) continue;

    const head = document.createElement('h2');
    head.className = 'cat';
    const inCat = c.artworks.filter(a => votes[a.filename] === 'in').length;
    head.innerHTML = c.title.replace(/-\\d+$/, '') +
      '<span class="cnt">' + inCat + ' in / ' + c.artworks.length + ' total</span>' +
      (visible.length !== c.artworks.length ? '<span class="tip">showing ' + visible.length + ' (filtered)</span>' : '');
    root.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const a of visible) {
      const v = votes[a.filename];
      const card = document.createElement('div');
      card.className = 'card ' + (v || '');
      card.title = a.title + ' (' + Math.round(a.bytes/1024) + ' kB) — click to cycle';
      card.onclick = (e) => cycle(a.filename, e);
      const symbol = v === 'in' ? '✓' : v === 'maybe' ? '?' : v === 'out' ? '✕' : '';
      card.innerHTML =
        '<img loading="lazy" src="' + c.title + '/' + a.filename + '" alt="' + a.title.replace(/"/g, '&quot;') + '">' +
        (v ? '<div class="vote ' + v + '">' + symbol + '</div>' : '') +
        '<div class="meta"><b>' + a.title + '</b><span class="kb"> · ' + Math.round(a.bytes/1024) + ' kB</span></div>';
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }
}

function exportJson() {
  const inCount = Object.values(votes).filter(v => v === 'in').length;
  if (inCount !== TARGET) {
    if (!confirm('You have ' + inCount + ' selected (target: ' + TARGET + '). Export anyway?')) return;
  }
  const ins = [];
  for (const c of MANIFEST.collections) {
    for (const a of c.artworks) {
      if (votes[a.filename] === 'in') {
        ins.push({
          collection_title: c.title,
          collection_index: c.artworks.indexOf(a),
          filename: a.filename,
          slug: a.slug,
          title: a.title,
        });
      }
    }
  }
  const payload = {
    exported_at: new Date().toISOString(),
    count: ins.length,
    target: TARGET,
    selections: ins,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'selections.json';
  a.click();
  URL.revokeObjectURL(url);
}

render();
</script>
</body>
</html>
`;

writeFileSync(OUT_PATH, html);
console.log('Wrote ' + OUT_PATH);
console.log('Open in browser:  file://' + OUT_PATH.replace(/\\/g, '/'));
const totalIn = Object.values(PREVOTES).filter(v => v === 'in').length;
const totalMaybe = Object.values(PREVOTES).filter(v => v === 'maybe').length;
const totalVoted = Object.keys(PREVOTES).length;
const totalArtworks = manifest.collections.reduce((s, c) => s + c.artworks.length, 0);
console.log(`Pre-votes: ${totalIn} in, ${totalMaybe} maybe, ${totalVoted - totalIn - totalMaybe} out (${totalVoted}/${totalArtworks} of total).`);
console.log('Unvoted (mostly flowers): ' + (totalArtworks - totalVoted));
