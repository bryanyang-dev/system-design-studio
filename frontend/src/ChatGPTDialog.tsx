import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { request } from './api';
import { contentOf, fingerprint, parseImport } from './domain';
import type { Diagram, Graph } from './domain';
import { Modal } from './components';

type ConnectionStatus = { connected: boolean; plan_enabled: boolean; active: string | null; message: string; accounts: { id: string; label: string }[] };
type Model = { id: string; name: string };
type Result = { explanation: string; graph: Graph | null; base: string; diagramId: string };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The request could not complete.';
const post = <T,>(path: string, body: unknown = {}) => request<T>(path, { method: 'POST', body: JSON.stringify(body) });

export function ChatGPTDialog({ diagram, editable, onClose, onApply }: {
  diagram: Diagram | null; editable: boolean; onClose: () => void;
  onApply: (graph: Graph, base: string, diagramId: string) => void;
}) {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [account, setAccount] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waiting, setWaiting] = useState(false);

  // Poll only while a browser sign-in is pending. Tokens never enter frontend storage.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 10 * 60_000;
    const refresh = async () => {
      try {
        const next = await request<ConnectionStatus>('/chatgpt/status');
        if (cancelled) return;
        setStatus(next);
        if (next.connected && !next.message.startsWith('Waiting')) setWaiting(false);
        if (waiting && Date.now() < deadline && next.message.startsWith('Waiting')) timer = setTimeout(refresh, 2000);
        else if (waiting) setWaiting(false);
      } catch (err) { if (!cancelled) { setError(errorMessage(err)); setWaiting(false); } }
    };
    void refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [waiting]);

  useEffect(() => {
    let cancelled = false;
    setModels([]); setModel('');
    if (status?.plan_enabled) {
      request<Model[]>('/chatgpt/models').then(items => {
        if (!cancelled) { setModels(items); setModel(items[0]?.id ?? ''); }
      }).catch(err => { if (!cancelled) setError(errorMessage(err)); });
    }
    return () => { cancelled = true; };
  }, [status?.active, status?.plan_enabled]);

  async function connect() {
    setError(''); setBusy(true);
    // Create the tab synchronously so browsers do not block it as an unsolicited popup.
    const popup = window.open('about:blank', '_blank');
    try {
      if (!popup) throw new Error('Allow pop-ups for this app, then try connecting again.');
      popup.opener = null;
      const reply = await post<{ url: string }>('/chatgpt/connect', { account: account || null });
      popup.location.href = reply.url;
      setWaiting(true);
    } catch (err) { popup?.close(); setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setError(''); setBusy(true);
    try { setStatus(await post<ConnectionStatus>('/chatgpt/disconnect')); setResult(null); setWaiting(false); }
    catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  async function ask() {
    if (!diagram) return;
    setError(''); setBusy(true); setResult(null);
    const base = fingerprint(diagram); const diagramId = diagram.id;
    try {
      const reply = await post<{ explanation: string; graph: Graph | null }>('/chatgpt/ask', { model, prompt, diagram: contentOf(diagram) });
      const graph = reply.graph ? parseImport({ ...contentOf(diagram), graph: reply.graph }).graph : null;
      setResult({ ...reply, graph, base, diagramId });
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  const stale = !!result && (!diagram || diagram.id !== result.diagramId || fingerprint(diagram) !== result.base);
  const changes = result?.graph && diagram ? graphChanges(diagram.graph, result.graph) : [];
  return <Modal title="ChatGPT assistant" subtitle="Use your ChatGPT plan to discuss or improve this diagram." onClose={onClose} wide>
    <div className="chatgpt-dialog">
      <p className="field-hint">Requests use your ChatGPT plan allowance. This app does not use a paid API key. <a href="https://chatgpt.com/#settings/Usage" target="_blank" rel="noreferrer">Manage usage in ChatGPT</a></p>
      <div className="chatgpt-account">
        <strong>{status?.connected ? 'ChatGPT connected' : 'Connect your ChatGPT account'}</strong>
        {status?.message && <p role="status">{status.message}</p>}
        <label>Account<select value={account} onChange={event => setAccount(event.target.value)} disabled={busy || waiting}>
          <option value="">Add an account or workspace</option>
          {status?.accounts.map(item => <option key={item.id} value={item.id}>{item.label}{item.id === status.active ? ' (active)' : ''}</option>)}
        </select></label>
        {status?.connected && <p className="field-hint">Active: {status.accounts.find(item => item.id === status.active)?.label}</p>}
        <div className="chatgpt-buttons"><button className="button button-primary" disabled={busy || waiting || !status} onClick={() => void connect()}>{waiting ? 'Waiting for sign-in…' : 'Continue with ChatGPT'}</button>
          {status?.connected && <button className="button button-outline" disabled={busy} onClick={() => void disconnect()}>Disconnect</button>}</div>
      </div>
      {error && <p className="chatgpt-error" role="alert">{error}</p>}
      <fieldset className="property-fields" disabled={busy || waiting || !status?.plan_enabled || !diagram || !editable}>
        <label>Model<select value={model} onChange={event => setModel(event.target.value)}><option value="">{status?.plan_enabled ? 'Choose a model' : 'Connect to see available models'}</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Prompt<textarea rows={4} maxLength={10000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Review this design for 100M requests per day, or add a queue between the API and a worker…" /></label>
        <p className="field-hint">Sending shares this diagram’s title, components, notes, connections, design context, and your prompt with OpenAI. Changes are proposed for your review.</p>
        <button className="button button-primary" disabled={!model || !prompt.trim()} onClick={() => void ask()}>Ask ChatGPT</button>
      </fieldset>
      {!diagram && <p className="field-hint">Open or create a diagram to ask about its design.</p>}
      {busy && <p className="chatgpt-progress" role="status"><LoaderCircle size={16} className="spin" />Working…</p>}
      {result && <section className="chatgpt-result"><h3>{result.graph ? 'Proposed changes' : 'Response'}</h3><p className="chatgpt-explanation">{result.explanation}</p>
        {result.graph && <><ul>{changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
          {!changes.length && <p>No diagram changes.</p>}
          {stale && <p role="alert">Your diagram changed since this request. Ask again to get a current proposal.</p>}
          <button className="button button-primary" disabled={busy || stale || !editable || !changes.length} onClick={() => {
            try { onApply(result.graph!, result.base, result.diagramId); onClose(); }
            catch (err) { setError(errorMessage(err)); }
          }}>Apply proposed changes</button><p className="field-hint">Applying is one undoable action and autosaves normally.</p></>}
      </section>}
    </div>
  </Modal>;
}

export function graphChanges(before: Graph, after: Graph): string[] {
  const changes: string[] = [];
  const serialize = (item: unknown) => JSON.stringify(item, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  const describe = (graph: Graph, item: Graph['nodes'][number] | Graph['edges'][number]) => {
    if ('type' in item) return `${item.type === 'text' ? 'Text' : item.type}: ${item.type === 'text' ? item.properties.description : item.label}; position (${item.position.x}, ${item.position.y}); size ${item.width} × ${item.height}${item.properties.technology ? '; ' + item.properties.technology : ''}${item.type !== 'text' && item.properties.description ? '; ' + item.properties.description : ''}${item.properties.region ? '; region ' + item.properties.region : ''}${item.properties.replicas ? '; replicas ' + item.properties.replicas : ''}`;
    const name = (id: string) => graph.nodes.find(node => node.id === id)?.label ?? id;
    return `${name(item.source)} ${item.direction === 'two_way' ? '↔' : '→'} ${name(item.target)}; ${item.source_port} / ${item.target_port}${item.label ? '; ' + item.label : ''}${item.protocol ? '; ' + item.protocol : ''}; ${item.interaction}`;
  };
  for (const kind of ['nodes', 'edges'] as const) {
    for (const item of before[kind]) if (!after[kind].some(next => next.id === item.id)) changes.push('Remove ' + describe(before, item));
    for (const item of after[kind]) {
      const previous = before[kind].find(old => old.id === item.id);
      if (!previous) changes.push('Add ' + describe(after, item));
      else if (serialize(previous) !== serialize(item)) {
        changes.push('Change ' + describe(before, previous) + ' → ' + describe(after, item));
      }
    }
  }
  return changes;
}
