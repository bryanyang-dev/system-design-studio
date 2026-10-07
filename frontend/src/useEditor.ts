import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { contentOf, fingerprint, parseImport } from './domain';
import type { Diagram, DiagramContent } from './domain';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
type Draft = { baseVersion: number; content: DiagramContent };
const draftKey = (id: string) => `studio.draft.${id}`;

export function useEditor() {
  const [doc, setDoc] = useState<Diagram | null>(null);
  const current = useRef<Diagram | null>(null);
  const saved = useRef('');
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<{ past: DiagramContent[]; future: DiagramContent[] }>({ past: [], future: [] });
  const inFlight = useRef<Promise<boolean> | null>(null);
  const suspended = useRef(false);
  const interacting = useRef(false);
  const [tick, setTick] = useState(0);

  const persistDraft = useCallback((value: Diagram) => {
    try {
      localStorage.setItem(draftKey(value.id), JSON.stringify({ baseVersion: value.version, content: contentOf(value) }));
      setStorageError('');
    } catch { setStorageError('Local draft storage is unavailable. Keep this tab open until changes are saved, or export a JSON copy.'); }
  }, []);

  const clearDraft = (id: string) => { try { localStorage.removeItem(draftKey(id)); } catch { /* Server copy remains intact. */ } };

  const load = useCallback((value: Diagram, checkDraft = true) => {
    saved.current = fingerprint(value);
    current.current = value; setDoc(value);
    setHistory({ past: [], future: [] }); setStatus('saved'); setError(''); setDraft(null);
    suspended.current = false;
    if (checkDraft) {
      try {
        const raw = localStorage.getItem(draftKey(value.id));
        if (raw) {
          const candidate = JSON.parse(raw);
          const recovered = parseImport(candidate.content);
          if (!Number.isInteger(candidate.baseVersion) || candidate.baseVersion < 1) throw new Error('Invalid draft version');
          if (fingerprint(recovered) !== saved.current) {
            suspended.current = true;
            setDraft({ content: recovered, baseVersion: candidate.baseVersion });
          } else clearDraft(value.id);
        }
      } catch { setStorageError('A stored local draft could not be read. The saved server diagram is still available.'); }
    }
  }, []);

  const checkpoint = useCallback(() => {
    if (!current.current) return;
    const snapshot = contentOf(current.current);
    setHistory(h => ({ past: [...h.past, snapshot].slice(-100), future: [] }));
  }, []);

  const change = useCallback((update: (content: DiagramContent) => DiagramContent, recordHistory = true) => {
    const before = current.current;
    if (!before || suspended.current) return;
    const next = { ...before, ...update(contentOf(before)) };
    if (fingerprint(next) === fingerprint(before)) return;
    if (recordHistory) checkpoint();
    current.current = next; setDoc(next); persistDraft(next);
    setStatus(previous => previous === 'conflict' ? 'conflict' : 'pending');
  }, [checkpoint, persistDraft]);

  const travel = (direction: 'undo' | 'redo') => {
    const before = current.current;
    if (!before || suspended.current) return;
    const source = direction === 'undo' ? history.past : history.future;
    if (!source.length) return;
    const content = source[source.length - 1];
    setHistory(direction === 'undo'
      ? { past: history.past.slice(0, -1), future: [...history.future, contentOf(before)] }
      : { past: [...history.past, contentOf(before)], future: history.future.slice(0, -1) });
    const next = { ...before, ...content };
    current.current = next; setDoc(next); persistDraft(next);
    setStatus(previous => previous === 'conflict' ? 'conflict' : 'pending');
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) {
      const result = await inFlight.current;
      if (!result) return false;
      // Include edits made during an earlier in-flight save before navigating away.
      return save();
    }
    const before = current.current;
    if (!before) return true;
    if (suspended.current) return false;
    const snapshot = fingerprint(before);
    if (snapshot === saved.current) { setStatus('saved'); return true; }
    setStatus('saving'); setError('');
    const work = (async () => {
      try {
        const response = await api.save(before.id, contentOf(before), before.version);
        if (current.current?.id !== before.id) return true;
        saved.current = fingerprint(response);
        const latest = { ...current.current, version: response.version, updated_at: response.updated_at };
        current.current = latest; setDoc(latest);
        if (fingerprint(latest) === saved.current) { clearDraft(before.id); setStatus('saved'); }
        else { persistDraft(latest); setStatus('pending'); }
        return true;
      } catch (error) {
        if (current.current?.id !== before.id) return false;
        const conflict = error instanceof ApiError && error.status === 409;
        suspended.current = conflict;
        setStatus(conflict ? 'conflict' : 'error');
        setError(error instanceof Error ? error.message : 'Save failed');
        return false;
      }
    })();
    inFlight.current = work;
    try { return await work; }
    finally { inFlight.current = null; setTick(value => value + 1); }
  }, [persistDraft]);

  useEffect(() => {
    if (!doc || status !== 'pending' || interacting.current || suspended.current) return;
    const timer = window.setTimeout(() => { void save(); }, 800);
    return () => window.clearTimeout(timer);
  }, [doc, status, save, tick]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (current.current && fingerprint(current.current) !== saved.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const resolveDraft = (recover: boolean) => {
    if (!current.current || !draft) return;
    if (recover) {
      const conflict = draft.baseVersion !== current.current.version;
      const next = { ...current.current, ...draft.content, version: draft.baseVersion };
      current.current = next; setDoc(next); suspended.current = conflict;
      setStatus(conflict ? 'conflict' : 'pending');
      if (conflict) setError('The saved diagram changed since this draft was made. Save your recovered draft as a new diagram.');
      persistDraft(next);
    } else { suspended.current = false; clearDraft(current.current.id); }
    setDraft(null);
  };

  const setInteracting = (value: boolean) => { interacting.current = value; setTick(t => t + 1); };
  const getCurrent = () => current.current;
  return { doc, status, error, storageError, draft, load, change, checkpoint, save, getCurrent, resolveDraft, setInteracting,
    undo: () => travel('undo'), redo: () => travel('redo'), canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
}

