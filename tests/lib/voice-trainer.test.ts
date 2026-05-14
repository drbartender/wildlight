import { describe, it, expect } from 'vitest';
import { INTERVIEW_QUESTIONS } from '@/lib/voice-trainer';

// The interview catalog drives upserts into voice_interview_responses
// keyed on `question_key`. Renaming a key silently orphans the prior
// answer (it stays in the DB but the UI shows the new key as empty),
// and a duplicate key collapses two questions into one row. Both
// classes of failure escape typecheck and code review, so an assertion
// at test time is the cheapest defense.

describe('INTERVIEW_QUESTIONS catalog', () => {
  it('every key is unique', () => {
    const keys = INTERVIEW_QUESTIONS.map((q) => q.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every key matches the upsert handle pattern', () => {
    // ASCII snake-case, leading letter, bounded length. Keeps SQL,
    // URL, and JSON-key shapes consistent and prevents stray hyphens
    // or capitals from leaking in.
    const KEY_RE = /^[a-z][a-z0-9_]{0,79}$/;
    for (const q of INTERVIEW_QUESTIONS) {
      expect(q.key, `bad key: ${JSON.stringify(q.key)}`).toMatch(KEY_RE);
    }
  });

  it('every category is non-empty', () => {
    for (const q of INTERVIEW_QUESTIONS) {
      expect(q.category.trim().length).toBeGreaterThan(0);
    }
  });

  it('every question text is non-empty', () => {
    for (const q of INTERVIEW_QUESTIONS) {
      expect(q.text.trim().length).toBeGreaterThan(0);
    }
  });
});
