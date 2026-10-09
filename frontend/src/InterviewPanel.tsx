import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { request } from './api';
import { contentOf } from './domain';
import type { Diagram } from './domain';
import { parseSession, remainingTime } from './interview';
import type { InterviewAction, InterviewSession } from './interview';

type Summary = { id: string; status: string; started_at: number; difficulty: string };
const post = (path: string, body: unknown) => request<unknown>(path, { method: 'POST', body: JSON.stringify(body) });
const message = (error: unknown) => error instanceof Error ? error.message : 'The interview request failed.';

export function InterviewPanel({ diagram, editable, onClose, onConnect }: {
  diagram: Diagram; editable: boolean; onClose: () => void; onConnect: () => void;
}) {
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [history, setHistory] = useState<Summary[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [connected, setConnected] = useState(false);
  const [model, setModel] = useState('');
  const [difficulty, setDifficulty] = useState('intermediate');
  const [duration, setDuration] = useState(30);
  const [focus, setFocus] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(Date.now());
  const receivedAt = useRef(Date.now());
  const transcript = useRef<HTMLDivElement>(null);

  function accept(value: unknown) {
    const next = parseSession(value);
    if (next.diagram_id !== diagram.id) {
      throw new Error('This interview belongs to a different diagram.');
    }
    receivedAt.current = Date.now();
    setClock(Date.now()); setSession(next);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const items = await request<Summary[]>(`/interviews?diagram_id=${encodeURIComponent(diagram.id)}`);
        if (cancelled) { return; }
        setHistory(items);
        if (items.length) {
          const current = await request<unknown>(`/interviews/${items[0].id}`);
          if (cancelled) { return; }
          accept(current);
        }
        const status = await request<{ plan_enabled: boolean }>('/chatgpt/status');
        if (cancelled) { return; }
        setConnected(status.plan_enabled);
        if (status.plan_enabled) {
          const available = await request<{ id: string; name: string }[]>('/chatgpt/models');
          if (cancelled) { return; }
          setModels(available); setModel(available[0]?.id ?? '');
        }
      } catch (err) {
        if (!cancelled) { setError(message(err)); }
      } finally {
        if (!cancelled) { setBusy(false); }
      }
    }
    void load();
    return () => { cancelled = true; };
    // App keys this panel by diagram ID; edits must not reload the session.
  }, [diagram.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: 'smooth' });
  }, [session?.turns.length]);

  async function reload(id: string) {
    setBusy(true); setError('');
    try {
      accept(await request<unknown>(`/interviews/${id}`)); setAnswer('');
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function start() {
    setBusy(true); setError('');
    try {
      accept(await post('/interviews', { diagram_id: diagram.id, diagram: contentOf(diagram), diagram_version: diagram.version,
        model, difficulty, duration_minutes: duration, focus }));
      setHistory(await request<Summary[]>(`/interviews?diagram_id=${encodeURIComponent(diagram.id)}`));
      setAnswer('');
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function act(action: InterviewAction) {
    if (!session) { return; }
    setBusy(true); setError('');
    try {
      accept(await post(`/interviews/${session.id}/actions`, { expected_version: session.version, action,
        answer: action === 'answer' ? answer : '', diagram: contentOf(diagram), diagram_version: diagram.version }));
      if (action === 'answer') { setAnswer(''); }
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  const remaining = session ? remainingTime(session, receivedAt.current, clock) : null;
  const active = session?.status === 'active';
  const disabled = busy || !editable;
  const feedback = session?.turns.at(-1)?.reply.feedback;
  return <aside className="interview-panel" aria-label="System design interview">
    <header className="interview-heading"><div><h2>Design interview</h2><p>Explain your choices. Explore the tradeoffs.</p></div>
      <button className="icon-button" aria-label="Close interview panel" onClick={onClose}><X size={18} /></button></header>
    <div className="interview-body">
      {!connected && !busy && <p className="field-hint">Connect ChatGPT to start or continue an interview. <button className="text-button" onClick={onConnect}>Open ChatGPT connection</button></p>}
      {error && <p role="alert" className="chatgpt-error">{error} {session && <button className="text-button" disabled={busy} onClick={() => void reload(session.id)}>Reload session</button>}</p>}
      {history.length > 0 && <label className="interview-history">Saved sessions<select disabled={busy} value={session?.id ?? ''} onChange={event => {
        if (event.target.value) { void reload(event.target.value); }
        else { setSession(null); setAnswer(''); }
      }}>
        <option value="">New interview</option>{history.map(item => <option key={item.id} value={item.id}>{new Date(item.started_at * 1000).toLocaleString()} · {item.difficulty}</option>)}</select></label>}
      {!session ? <fieldset className="property-fields" disabled={disabled || !connected}>
        <label>Model<select value={model} onChange={event => setModel(event.target.value)}><option value="">Choose a model</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Difficulty<select value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="introductory">Introductory</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></label>
        <label>Duration<select value={duration} onChange={event => setDuration(Number(event.target.value))}>{[15, 30, 45, 60, 0].map(value => <option key={value} value={value}>{value ? `${value} minutes` : 'Untimed'}</option>)}</select></label>
        <label>Focus areas<input maxLength={2000} value={focus} onChange={event => setFocus(event.target.value)} placeholder="Scaling, reliability, capacity estimates…" /></label>
        <p className="field-hint">Uses this diagram and its design context. Your transcript and design snapshots are saved with the diagram. Each AI turn shares these with OpenAI.</p>
        <button className="button button-primary" disabled={!model} onClick={() => void start()}>Start interview</button>
      </fieldset> : <>
        <div className="interview-status"><strong>{session.status === 'finished' ? 'Completed' : session.status === 'paused' ? 'Paused' : 'In progress'}</strong>
          <span>{remaining === null ? 'Untimed' : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining`}</span></div>
        <p className="field-hint">{session.difficulty} · {session.model}. Edit the canvas as you go; the next turn sees your current design.</p>
        {active && remaining === 0 && <p role="status" className="interview-timeout">Time is up. Finish for feedback or extend by 15 minutes.</p>}
        <div className="interview-transcript" ref={transcript} role="log" aria-label="Interview transcript">
          {session.turns.map(turn => <article className="interview-turn" key={turn.id}>
            {turn.answer && <div className="interview-answer"><strong>You · turn {turn.id}</strong><p>{turn.answer}</p></div>}
            <div><small>{turn.reply.phase.replace('_', ' ')} · {turn.action} · design v{turn.diagram_version}</small><p>{turn.reply.message}</p></div>
          </article>)}
        </div>
        {session.constraints.length > 0 && <details><summary>Interview constraints ({session.constraints.length})</summary><ul>{session.constraints.map((text, index) => <li key={index}>{text}</li>)}</ul><p className="field-hint">These do not change the diagram’s base context.</p></details>}
        {session.status !== 'finished' && <>
          <fieldset className="property-fields" disabled={disabled || !active || !connected}>
            <label>Your answer<textarea rows={4} maxLength={10000} value={answer} onChange={event => setAnswer(event.target.value)} placeholder="Explain your reasoning and any changes you made…" /></label>
            <button className="button button-primary" disabled={!answer.trim()} onClick={() => void act('answer')}>Send answer</button>
            <div className="chatgpt-buttons"><button className="button button-outline" onClick={() => void act('hint')}>Hint</button><button className="button button-outline" onClick={() => void act('coaching')}>Coaching</button><button className="button button-quiet" onClick={() => void act('skip')}>Skip question</button></div>
          </fieldset>
          <div className="chatgpt-buttons"><button className="button button-outline" disabled={disabled} onClick={() => void act(active ? 'pause' : 'resume')}>{active ? 'Pause' : 'Resume'}</button>
            {remaining !== null && <button className="button button-quiet" disabled={disabled} onClick={() => void act('extend')}>+15 minutes</button>}
            <button className="button button-outline" disabled={disabled || !connected} onClick={() => void act('finish')}>Finish & get feedback</button></div>
          <p className="field-hint">Hints and coaching are recorded for feedback. Closing this panel does not pause the timer.</p>
        </>}
        {feedback && <section className="interview-feedback"><h3>Your practice feedback</h3>
          {feedback.rubric.map(item => <div key={item.criterion}><strong>{item.criterion.replaceAll('_', ' ')} · {item.score === null ? 'Not observed' : `${item.score}/5`}</strong><p>{item.evidence}{item.turn_ids.length > 0 && ` (Turns ${item.turn_ids.join(', ')})`}</p></div>)}
          {([['Strengths', feedback.strengths], ['Practice gaps', feedback.gaps], ['Next steps', feedback.next_steps]] as const).map(([title, items]) => <div key={title}><h4>{title}</h4><ul>{items.map((text, index) => <li key={index}>{text}</li>)}</ul></div>)}
          <p className="field-hint">Learning feedback, not a hiring prediction.</p>
        </section>}
        <button className="text-button" disabled={busy} onClick={() => { setSession(null); setAnswer(''); setError(''); }}>Set up a new interview</button>
      </>}
      {busy && <p className="chatgpt-progress" role="status"><LoaderCircle size={16} className="spin" />Working…</p>}
    </div>
  </aside>;
}
