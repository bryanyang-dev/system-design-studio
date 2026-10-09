export type InterviewAction = 'answer' | 'hint' | 'coaching' | 'skip' | 'finish' | 'pause' | 'resume' | 'extend';
export type Feedback = { rubric: { criterion: string; score: number | null; evidence: string; turn_ids: number[] }[]; strengths: string[]; gaps: string[]; next_steps: string[] };
export type InterviewTurn = { id: number; action: string; answer: string; diagram_version: number; reply: { phase: string; message: string; constraints: string[]; feedback: Feedback | null } };
export type InterviewSession = { id: string; diagram_id: string; version: number; status: 'active' | 'paused' | 'finished'; model: string; difficulty: string; turns: InterviewTurn[]; constraints: string[]; remaining_seconds: number | null };

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid interview response. Reload the session.');
  }
  return value as Record<string, unknown>;
};
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1;

export function parseSession(value: unknown): InterviewSession {
  const data = object(value);
  if (typeof data.id !== 'string' || typeof data.diagram_id !== 'string' || !integer(data.version)
    || !['active', 'paused', 'finished'].includes(String(data.status)) || typeof data.model !== 'string'
    || typeof data.difficulty !== 'string' || !strings(data.constraints) || !Array.isArray(data.turns)
    || !(data.remaining_seconds === null || (typeof data.remaining_seconds === 'number' && Number.isFinite(data.remaining_seconds) && data.remaining_seconds >= 0))) {
    throw new Error('Invalid interview response. Reload the session.');
  }
  for (const value of data.turns) {
    const turn = object(value); const reply = object(turn.reply);
    if (!integer(turn.id) || !integer(turn.diagram_version) || typeof turn.action !== 'string' || typeof turn.answer !== 'string'
      || typeof reply.message !== 'string' || typeof reply.phase !== 'string' || !strings(reply.constraints)) {
      throw new Error('Invalid interview turn. Reload the session.');
    }
    if (reply.feedback !== null) {
      const feedback = object(reply.feedback);
      if (!strings(feedback.strengths) || !strings(feedback.gaps) || !strings(feedback.next_steps) || !Array.isArray(feedback.rubric)) {
        throw new Error('Invalid interview feedback.');
      }
      for (const value of feedback.rubric) {
        const item = object(value);
        if (typeof item.criterion !== 'string' || typeof item.evidence !== 'string'
          || !(item.score === null || (integer(item.score) && item.score <= 5))
          || !Array.isArray(item.turn_ids) || !item.turn_ids.every(integer)) {
          throw new Error('Invalid interview assessment.');
        }
      }
    }
  }
  return data as unknown as InterviewSession;
}

export function remainingTime(session: InterviewSession, receivedAt: number, currentTime: number): number | null {
  if (session.remaining_seconds === null) {
    return null;
  }
  return Math.max(0, Math.ceil(session.remaining_seconds - (session.status === 'active' ? Math.max(0, currentTime - receivedAt) / 1000 : 0)));
}
