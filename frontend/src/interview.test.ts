import { describe, expect, it } from 'vitest';
import { parseSession, remainingTime } from './interview';

const example = () => ({ id: 'session', diagram_id: 'diagram', version: 2, model: 'model', difficulty: 'intermediate',
  status: 'active', constraints: ['100M requests/day'], remaining_seconds: 120,
  turns: [{ id: 1, action: 'start', answer: '', diagram_version: 1,
    reply: { phase: 'requirements', message: 'Who are the users?', constraints: [], feedback: null } }] });

describe('Interview session restoration', () => {
  it('validates a persisted transcript before displaying it', () => {
    expect(parseSession(example()).turns[0].reply.message).toBe('Who are the users?');
    expect(() => parseSession({ ...example(), turns: [{ reply: { message: {} } }] })).toThrow();
    expect(() => parseSession({ ...example(), remaining_seconds: NaN })).toThrow();
    expect(() => parseSession({ ...example(), constraints: {} })).toThrow();
    const invalid = example();
    Object.assign(invalid.turns[0].reply, { feedback: { rubric: [{ criterion: 'reliability', score: 8, evidence: 'x', turn_ids: [] }], strengths: [], gaps: [], next_steps: [] } });
    expect(() => parseSession(invalid)).toThrow();
  });

  it('counts down from server time, freezes paused sessions and handles untimed practice', () => {
    const session = parseSession(example());
    expect(remainingTime(session, 1000, 31000)).toBe(90);
    expect(remainingTime(session, 1000, 999000)).toBe(0);
    expect(remainingTime({ ...session, status: 'paused' }, 1000, 31000)).toBe(120);
    expect(remainingTime({ ...session, status: 'finished' }, 1000, 31000)).toBe(120);
    expect(remainingTime({ ...session, remaining_seconds: null }, 1000, 31000)).toBeNull();
  });
});
