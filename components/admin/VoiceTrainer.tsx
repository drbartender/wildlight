'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

// VoiceTrainer — the /admin/voice-training app.
//
// Bootstraps once from /api/admin/voice-training/state, then renders
// four collapsible sections (Interview, Samples, A/B, Synthesize &
// Activate). Every mutation calls a small action route and re-fetches
// state so counts + lists stay in sync. No store, no SWR — the surface
// is small and the user is one admin.

interface InterviewQ {
  key: string;
  category: string;
  text: string;
  placeholder?: string;
  rows?: number;
  answer: string;
  answeredAt: string | null;
}

interface Sample {
  id: number;
  kind: 'positive' | 'anti';
  title: string | null;
  // Truncated to 2000 chars in the state payload — see SAMPLE_PREVIEW_CHARS
  // in the state route. `textTruncated` flags when the row was clipped.
  text: string;
  textTruncated?: boolean;
  annotation: string | null;
  createdAt: string;
}

interface AbPair {
  id: number;
  prompt: string;
  variantA: string;
  variantB: string;
  pick: 'A' | 'B' | 'neither' | null;
  pickReason: string | null;
  createdAt: string;
  judgedAt: string | null;
}

interface ProfileRule {
  category: string;
  text: string;
}
interface ProfileSample {
  title: string;
  artist_note: string;
}
interface Profile {
  id: number;
  active: boolean;
  summary: string;
  rules: ProfileRule[];
  samples: ProfileSample[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

interface State {
  questions: InterviewQ[];
  samples: Sample[];
  counts: {
    positive: number;
    anti: number;
    answered: number;
    abJudged: number;
  };
  ab: AbPair[];
  profiles: Profile[];
}

type Section = 'interview' | 'samples' | 'ab' | 'profiles';

export function VoiceTrainer() {
  const [state, setState] = useState<State | null>(null);
  const [open, setOpen] = useState<Section>('interview');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch('/api/admin/voice-training/state', {
        cache: 'no-store',
      });
      if (!r.ok) throw new Error(`load failed (${r.status})`);
      const d = (await r.json()) as State;
      setState(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!state) {
    return (
      <div style={{ padding: '24px' }}>
        {err ? (
          <div className="wl-adm-card">
            <div className="body" style={{ color: 'var(--danger, #c33)' }}>
              {err}
            </div>
          </div>
        ) : (
          <div className="wl-adm-card">
            <div className="body">Loading voice corpus…</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', display: 'grid', gap: '20px' }}>
      <Intro />
      <Counters c={state.counts} active={state.profiles.find((p) => p.active) ?? null} />
      {err && (
        <div className="wl-adm-card">
          <div className="body" style={{ color: 'var(--danger, #c33)' }}>
            {err}
          </div>
        </div>
      )}

      <SectionShell
        title="1 · Quiz · How do you want to sound?"
        sub="Open-ended interview. Answers auto-save on blur."
        isOpen={open === 'interview'}
        onToggle={() => setOpen(open === 'interview' ? 'profiles' : 'interview')}
      >
        <Interview
          questions={state.questions}
          onSaved={refresh}
          setBusy={setBusy}
          setErr={setErr}
          busy={busy}
        />
      </SectionShell>

      <SectionShell
        title="2 · Writing samples"
        sub="Paste anything you wrote that sounds like you — and AI drafts that didn't."
        isOpen={open === 'samples'}
        onToggle={() => setOpen(open === 'samples' ? 'profiles' : 'samples')}
      >
        <Samples
          samples={state.samples}
          onChange={refresh}
          setBusy={setBusy}
          setErr={setErr}
          busy={busy}
        />
      </SectionShell>

      <SectionShell
        title="3 · A/B comparisons"
        sub="Generate two short variants of the same idea — pick which sounds more like you."
        isOpen={open === 'ab'}
        onToggle={() => setOpen(open === 'ab' ? 'profiles' : 'ab')}
      >
        <AbSection
          pairs={state.ab}
          onChange={refresh}
          setBusy={setBusy}
          setErr={setErr}
          busy={busy}
        />
      </SectionShell>

      <SectionShell
        title="4 · Synthesize & activate"
        sub="Roll everything above into a voice profile, review, and make it the active one."
        isOpen={open === 'profiles'}
        onToggle={() => setOpen(open === 'profiles' ? 'interview' : 'profiles')}
      >
        <Profiles
          profiles={state.profiles}
          onChange={refresh}
          setBusy={setBusy}
          setErr={setErr}
          busy={busy}
        />
      </SectionShell>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function Intro() {
  return (
    <div className="wl-adm-card">
      <div className="body" style={{ display: 'grid', gap: '8px', lineHeight: 1.55 }}>
        <p style={{ margin: 0 }}>
          The Studio composer drafts journal and newsletter entries using a
          built-in voice corpus. This page lets you refine that corpus by
          telling the AI how you sound — through a short interview, by
          pasting writing samples, by picking between two variants the AI
          drafts on demand, and by flagging AI drafts that felt off.
        </p>
        <p style={{ margin: 0 }}>
          When you've answered enough, hit{' '}
          <strong>Synthesize voice profile</strong>. Review the result, then{' '}
          <strong>Activate</strong> it — the Studio composer will pick it up
          on the next generate.
        </p>
      </div>
    </div>
  );
}

function Counters({ c, active }: { c: State['counts']; active: Profile | null }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '12px',
      }}
    >
      <Stat label="Questions answered" value={c.answered} />
      <Stat label="Positive samples" value={c.positive} />
      <Stat label="Anti-samples" value={c.anti} />
      <Stat label="A/B picks recorded" value={c.abJudged} />
      <div className="wl-adm-panel">
        <div className="head">Active profile</div>
        <div className="big" style={{ fontSize: '14px' }}>
          {active
            ? `#${active.id} · ${active.rules.length} rules · ${active.samples.length} samples`
            : 'None — using static defaults'}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="wl-adm-panel">
      <div className="head">{label}</div>
      <div className="big">{value}</div>
    </div>
  );
}

function SectionShell({
  title,
  sub,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  sub: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="wl-adm-card">
      <div className="h">
        <button
          type="button"
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            font: 'inherit',
            color: 'inherit',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: 0,
            textAlign: 'left',
          }}
        >
          <span aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
          <span>
            <h3 style={{ margin: 0 }}>{title}</h3>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>{sub}</div>
          </span>
        </button>
      </div>
      {isOpen && <div className="body">{children}</div>}
    </div>
  );
}

function Interview({
  questions,
  onSaved,
  setBusy,
  setErr,
  busy,
}: {
  questions: InterviewQ[];
  onSaved: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  const byCategory = useMemo(() => {
    const m = new Map<string, InterviewQ[]>();
    for (const q of questions) {
      const list = m.get(q.category) ?? [];
      list.push(q);
      m.set(q.category, list);
    }
    return m;
  }, [questions]);

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {Array.from(byCategory.entries()).map(([cat, qs]) => (
        <div key={cat}>
          <div
            style={{
              fontSize: '11px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              opacity: 0.6,
              marginBottom: '8px',
            }}
          >
            {cat.replace(/-/g, ' ')}
          </div>
          <div style={{ display: 'grid', gap: '12px' }}>
            {qs.map((q) => (
              <InterviewItem
                key={q.key}
                q={q}
                onSaved={onSaved}
                setBusy={setBusy}
                setErr={setErr}
                busy={busy}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function InterviewItem({
  q,
  onSaved,
  setBusy,
  setErr,
  busy,
}: {
  q: InterviewQ;
  onSaved: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  const [value, setValue] = useState(q.answer);
  // Re-sync local state when parent reloads (e.g. after navigation).
  useEffect(() => setValue(q.answer), [q.answer]);

  async function save() {
    if (value === q.answer) return;
    setBusy(`interview:${q.key}`);
    setErr(null);
    try {
      const r = await fetch('/api/admin/voice-training/interview', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionKey: q.key, answer: value }),
        // Blur fires on tab-away / navigate; keepalive ensures the PUT
        // finishes even if the user leaves the page before the response.
        keepalive: true,
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `save failed (${r.status})`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(null);
    }
  }

  const busyHere = busy === `interview:${q.key}`;
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontWeight: 600,
          fontSize: '14px',
          marginBottom: '4px',
        }}
      >
        {q.text}
      </label>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        placeholder={q.placeholder}
        rows={q.rows ?? 2}
        disabled={busyHere}
        style={{
          width: '100%',
          padding: '8px',
          fontFamily: 'inherit',
          fontSize: '14px',
          border: '1px solid var(--border, #ccc)',
          borderRadius: '4px',
          resize: 'vertical',
          background: 'var(--bg-soft, #fafafa)',
        }}
      />
      {q.answeredAt && (
        <div style={{ fontSize: '11px', opacity: 0.5, marginTop: '2px' }}>
          saved · {new Date(q.answeredAt).toLocaleString()}
        </div>
      )}
    </div>
  );
}

function Samples({
  samples,
  onChange,
  setBusy,
  setErr,
  busy,
}: {
  samples: Sample[];
  onChange: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  const [tab, setTab] = useState<'positive' | 'anti'>('positive');
  const filtered = samples.filter((s) => s.kind === tab);

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          className={`wl-adm-btn small ${tab === 'positive' ? 'primary' : ''}`}
          onClick={() => setTab('positive')}
        >
          Sounds like me ({samples.filter((s) => s.kind === 'positive').length})
        </button>
        <button
          type="button"
          className={`wl-adm-btn small ${tab === 'anti' ? 'primary' : ''}`}
          onClick={() => setTab('anti')}
        >
          AI drafts that felt off ({samples.filter((s) => s.kind === 'anti').length})
        </button>
      </div>

      <SampleAddForm
        kind={tab}
        onAdded={onChange}
        setBusy={setBusy}
        setErr={setErr}
        busyKey={`sample-add:${tab}`}
        busy={busy}
      />

      {filtered.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: '14px' }}>
          No {tab === 'positive' ? 'positive' : 'anti-'}samples yet.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '10px' }}>
          {filtered.map((s) => (
            <SampleRow
              key={s.id}
              s={s}
              onDeleted={onChange}
              setBusy={setBusy}
              setErr={setErr}
              busy={busy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SampleAddForm({
  kind,
  onAdded,
  setBusy,
  setErr,
  busyKey,
  busy,
}: {
  kind: 'positive' | 'anti';
  onAdded: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busyKey: string;
  busy: string | null;
}) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [annotation, setAnnotation] = useState('');

  async function submit() {
    if (!text.trim()) return;
    setBusy(busyKey);
    setErr(null);
    try {
      const r = await fetch('/api/admin/voice-training/samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim() || undefined,
          text: text.trim(),
          annotation: annotation.trim() || undefined,
        }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `save failed (${r.status})`);
      }
      setTitle('');
      setText('');
      setAnnotation('');
      onAdded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(null);
    }
  }

  const busyHere = busy === busyKey;
  return (
    <div
      style={{
        border: '1px dashed var(--border, #ccc)',
        padding: '12px',
        borderRadius: '6px',
        display: 'grid',
        gap: '8px',
      }}
    >
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busyHere}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: '14px',
          border: '1px solid var(--border, #ccc)',
          borderRadius: '4px',
          background: 'var(--bg-soft, #fafafa)',
        }}
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          kind === 'positive'
            ? 'Paste a passage you wrote that sounds like you…'
            : 'Paste an AI draft that felt off…'
        }
        rows={kind === 'positive' ? 6 : 4}
        disabled={busyHere}
        style={{
          width: '100%',
          padding: '8px',
          fontFamily: 'inherit',
          fontSize: '14px',
          border: '1px solid var(--border, #ccc)',
          borderRadius: '4px',
          resize: 'vertical',
          background: 'var(--bg-soft, #fafafa)',
        }}
      />
      {kind === 'anti' && (
        <textarea
          value={annotation}
          onChange={(e) => setAnnotation(e.target.value)}
          placeholder="What about it felt off? (optional)"
          rows={2}
          disabled={busyHere}
          style={{
            width: '100%',
            padding: '8px',
            fontFamily: 'inherit',
            fontSize: '14px',
            border: '1px solid var(--border, #ccc)',
            borderRadius: '4px',
            resize: 'vertical',
            background: 'var(--bg-soft, #fafafa)',
          }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="wl-adm-btn small primary"
          onClick={submit}
          disabled={busyHere || !text.trim()}
        >
          {busyHere ? 'Saving…' : `Add ${kind === 'positive' ? 'sample' : 'anti-sample'}`}
        </button>
      </div>
    </div>
  );
}

function SampleRow({
  s,
  onDeleted,
  setBusy,
  setErr,
  busy,
}: {
  s: Sample;
  onDeleted: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  const key = `sample-del:${s.id}`;
  const busyHere = busy === key;

  async function remove() {
    if (!confirm('Delete this sample?')) return;
    setBusy(key);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/voice-training/samples/${s.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`delete failed (${r.status})`);
      onDeleted();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border, #ddd)',
        borderRadius: '6px',
        padding: '12px',
        display: 'grid',
        gap: '6px',
      }}
    >
      {s.title && (
        <div style={{ fontWeight: 600, fontSize: '14px' }}>{s.title}</div>
      )}
      <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: 1.55 }}>
        {s.text}
      </div>
      {s.textTruncated && (
        <div style={{ fontSize: '11px', opacity: 0.55, fontStyle: 'italic' }}>
          Preview truncated — full text used in synthesis.
        </div>
      )}
      {s.annotation && (
        <div
          style={{
            fontSize: '12px',
            opacity: 0.75,
            borderLeft: '3px solid var(--border, #ccc)',
            paddingLeft: '8px',
            fontStyle: 'italic',
          }}
        >
          {s.annotation}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px',
          opacity: 0.6,
        }}
      >
        <span>{new Date(s.createdAt).toLocaleString()}</span>
        <button
          type="button"
          className="wl-adm-btn small ghost"
          onClick={remove}
          disabled={busyHere}
        >
          {busyHere ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

function AbSection({
  pairs,
  onChange,
  setBusy,
  setErr,
  busy,
}: {
  pairs: AbPair[];
  onChange: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  const [seed, setSeed] = useState('');

  async function generate() {
    setBusy('ab-generate');
    setErr(null);
    try {
      const r = await fetch('/api/admin/voice-training/ab', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: seed.trim() || undefined }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `generate failed (${r.status})`);
      }
      setSeed('');
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'generate failed');
    } finally {
      setBusy(null);
    }
  }

  const busyHere = busy === 'ab-generate';

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ display: 'grid', gap: '6px' }}>
        <input
          type="text"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Optional seed — e.g. 'a foggy morning at the lake' (or leave blank for a random photographer's prompt)"
          disabled={busyHere}
          style={{
            width: '100%',
            padding: '8px 10px',
            fontFamily: 'inherit',
            fontSize: '14px',
            border: '1px solid var(--border, #ccc)',
            borderRadius: '4px',
            background: 'var(--bg-soft, #fafafa)',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="wl-adm-btn small primary"
            onClick={generate}
            disabled={busyHere}
          >
            {busyHere ? 'Drafting…' : 'Generate A/B pair'}
          </button>
        </div>
      </div>

      {pairs.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: '14px' }}>
          No pairs yet — click Generate above to start.
        </div>
      ) : (
        pairs.map((p) => (
          <AbPairCard
            key={p.id}
            p={p}
            onChange={onChange}
            setBusy={setBusy}
            setErr={setErr}
            busy={busy}
          />
        ))
      )}
    </div>
  );
}

function AbPairCard({
  p,
  onChange,
  setBusy,
  setErr,
  busy,
}: {
  p: AbPair;
  onChange: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  const [reason, setReason] = useState(p.pickReason ?? '');
  const key = `ab:${p.id}`;
  const busyHere = busy === key;

  async function judge(pick: 'A' | 'B' | 'neither') {
    setBusy(key);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/voice-training/ab/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pick, reason: reason.trim() || undefined }),
      });
      if (!r.ok) throw new Error(`save failed (${r.status})`);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed');
    } finally {
      setBusy(null);
    }
  }

  async function drop() {
    if (!confirm('Delete this pair?')) return;
    setBusy(key);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/voice-training/ab/${p.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`delete failed (${r.status})`);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      style={{
        border: '1px solid var(--border, #ddd)',
        borderRadius: '6px',
        padding: '12px',
        display: 'grid',
        gap: '10px',
      }}
    >
      <div style={{ fontSize: '12px', opacity: 0.7 }}>
        <strong>Prompt:</strong> {p.prompt}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px',
        }}
      >
        <VariantBox
          label="A"
          text={p.variantA}
          picked={p.pick === 'A'}
          onPick={() => judge('A')}
          disabled={busyHere}
        />
        <VariantBox
          label="B"
          text={p.variantB}
          picked={p.pick === 'B'}
          onPick={() => judge('B')}
          disabled={busyHere}
        />
      </div>
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why did you pick that one? (optional)"
        disabled={busyHere}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'inherit',
          fontSize: '13px',
          border: '1px solid var(--border, #ccc)',
          borderRadius: '4px',
          background: 'var(--bg-soft, #fafafa)',
        }}
      />
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between' }}>
        <button
          type="button"
          className="wl-adm-btn small ghost"
          onClick={() => judge('neither')}
          disabled={busyHere}
        >
          Neither sounds like me
        </button>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {p.judgedAt && (
            <span style={{ fontSize: '11px', opacity: 0.55 }}>
              {p.pick === 'neither' ? 'rejected' : `picked ${p.pick}`} ·{' '}
              {new Date(p.judgedAt).toLocaleString()}
            </span>
          )}
          <button
            type="button"
            className="wl-adm-btn small ghost"
            onClick={drop}
            disabled={busyHere}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function VariantBox({
  label,
  text,
  picked,
  onPick,
  disabled,
}: {
  label: 'A' | 'B';
  text: string;
  picked: boolean;
  onPick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      style={{
        textAlign: 'left',
        cursor: disabled ? 'default' : 'pointer',
        padding: '12px',
        border: picked
          ? '2px solid var(--accent, #2563eb)'
          : '1px solid var(--border, #ddd)',
        borderRadius: '6px',
        background: picked
          ? 'color-mix(in srgb, var(--accent, #2563eb) 8%, transparent)'
          : 'var(--bg-soft, #fafafa)',
        display: 'grid',
        gap: '6px',
        font: 'inherit',
        color: 'inherit',
        opacity: disabled && !picked ? 0.7 : 1,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '12px', letterSpacing: '0.06em' }}>
        Variant {label} {picked && '✓'}
      </div>
      <div style={{ whiteSpace: 'pre-wrap', fontSize: '14px', lineHeight: 1.55 }}>
        {text}
      </div>
    </button>
  );
}

function Profiles({
  profiles,
  onChange,
  setBusy,
  setErr,
  busy,
}: {
  profiles: Profile[];
  onChange: () => void;
  setBusy: (s: string | null) => void;
  setErr: (s: string | null) => void;
  busy: string | null;
}) {
  async function synthesize() {
    if (!confirm('Synthesize a new voice profile from everything above?')) return;
    setBusy('synth');
    setErr(null);
    try {
      const r = await fetch('/api/admin/voice-training/synthesize', {
        method: 'POST',
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `synthesize failed (${r.status})`);
      }
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'synthesize failed');
    } finally {
      setBusy(null);
    }
  }

  async function activate(id: number) {
    setBusy(`activate:${id}`);
    setErr(null);
    try {
      const r = await fetch(
        `/api/admin/voice-training/profile/${id}/activate`,
        { method: 'POST' },
      );
      if (!r.ok) throw new Error(`activate failed (${r.status})`);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'activate failed');
    } finally {
      setBusy(null);
    }
  }

  async function deactivateAll() {
    if (!confirm('Deactivate all profiles? Generation falls back to static defaults.'))
      return;
    setBusy('deactivate-all');
    setErr(null);
    try {
      const r = await fetch('/api/admin/voice-training/profile/0/activate', {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`deactivate failed (${r.status})`);
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'deactivate failed');
    } finally {
      setBusy(null);
    }
  }

  async function deleteProfile(id: number) {
    if (!confirm(`Delete profile #${id}? This cannot be undone.`)) return;
    setBusy(`delete:${id}`);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/voice-training/profile/${id}`, {
        method: 'DELETE',
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `delete failed (${r.status})`);
      }
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(null);
    }
  }

  const busySynth = busy === 'synth';

  return (
    <div style={{ display: 'grid', gap: '14px' }}>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="wl-adm-btn primary"
          onClick={synthesize}
          disabled={busySynth}
        >
          {busySynth ? 'Synthesizing…' : 'Synthesize voice profile'}
        </button>
        <button
          type="button"
          className="wl-adm-btn ghost"
          onClick={deactivateAll}
          disabled={busy === 'deactivate-all' || !profiles.some((p) => p.active)}
        >
          Deactivate all
        </button>
      </div>

      {profiles.length === 0 ? (
        <div style={{ opacity: 0.6, fontSize: '14px' }}>
          No profiles yet — synthesize one once you've answered some questions
          or added a sample.
        </div>
      ) : (
        profiles.map((p) => (
          <ProfileCard
            key={p.id}
            p={p}
            onActivate={() => activate(p.id)}
            onDelete={() => deleteProfile(p.id)}
            busy={busy === `activate:${p.id}`}
            busyDelete={busy === `delete:${p.id}`}
          />
        ))
      )}
    </div>
  );
}

function ProfileCard({
  p,
  onActivate,
  onDelete,
  busy,
  busyDelete,
}: {
  p: Profile;
  onActivate: () => void;
  onDelete: () => void;
  busy: boolean;
  busyDelete: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        border: p.active
          ? '2px solid var(--accent, #2563eb)'
          : '1px solid var(--border, #ddd)',
        borderRadius: '6px',
        padding: '12px',
        display: 'grid',
        gap: '8px',
      }}
    >
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}
      >
        <div>
          <strong>Profile #{p.id}</strong>{' '}
          {p.active && (
            <span
              style={{
                background: 'var(--accent, #2563eb)',
                color: 'white',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '11px',
                marginLeft: '6px',
              }}
            >
              ACTIVE
            </span>
          )}
          <span style={{ fontSize: '11px', opacity: 0.6, marginLeft: '6px' }}>
            {new Date(p.createdAt).toLocaleString()}
            {p.createdBy && ` · ${p.createdBy}`}
            {p.updatedAt && p.updatedAt !== p.createdAt && (
              <> · toggled {new Date(p.updatedAt).toLocaleString()}</>
            )}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <a
            href={`/api/admin/voice-training/profile/${p.id}/export`}
            className="wl-adm-btn small ghost"
            style={{ textDecoration: 'none' }}
          >
            Export TS
          </a>
          {!p.active && (
            <button
              type="button"
              className="wl-adm-btn small primary"
              onClick={onActivate}
              disabled={busy}
            >
              {busy ? 'Activating…' : 'Activate'}
            </button>
          )}
          {!p.active && (
            <button
              type="button"
              className="wl-adm-btn small ghost"
              onClick={onDelete}
              disabled={busyDelete}
              title="Permanently delete this profile"
            >
              {busyDelete ? 'Deleting…' : 'Delete'}
            </button>
          )}
        </div>
      </div>

      <div style={{ fontSize: '14px', lineHeight: 1.55 }}>{p.summary}</div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: '12px',
          opacity: 0.7,
          cursor: 'pointer',
          color: 'inherit',
          justifySelf: 'start',
        }}
      >
        {open ? 'Hide' : `Show ${p.rules.length} rules · ${p.samples.length} samples`}
      </button>

      {open && (
        <div style={{ display: 'grid', gap: '10px', marginTop: '6px' }}>
          {p.rules.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  opacity: 0.6,
                  marginBottom: '4px',
                }}
              >
                Rules
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.55 }}>
                {p.rules.map((r, i) => (
                  <li key={i}>
                    <span style={{ opacity: 0.6 }}>[{r.category}]</span> {r.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.samples.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  opacity: 0.6,
                  marginBottom: '4px',
                }}
              >
                Samples
              </div>
              <div style={{ display: 'grid', gap: '6px' }}>
                {p.samples.map((s, i) => (
                  <div key={i} style={{ fontSize: '13px', lineHeight: 1.5 }}>
                    <strong>{s.title}</strong> — {s.artist_note}
                  </div>
                ))}
              </div>
            </div>
          )}
          {p.notes && (
            <div>
              <div
                style={{
                  fontSize: '11px',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  opacity: 0.6,
                  marginBottom: '4px',
                }}
              >
                Notes
              </div>
              <div style={{ fontSize: '13px', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
                {p.notes}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
