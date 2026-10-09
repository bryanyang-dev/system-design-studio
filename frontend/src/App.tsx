import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeftRight, ArrowRight, BookOpen, Check, ChevronDown, Copy, Download, FolderOpen,
  History, Link2, LoaderCircle, Maximize2, Minus, MousePointer2, PanelLeft, Plus,
  Redo2, Search, Settings2, Sparkles, Trash2, Type, Undo2, Upload, Workflow, X,
} from 'lucide-react';
import {
  Background, BackgroundVariant, ConnectionMode, MarkerType, MiniMap, ReactFlow, ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import { api } from './api';
import {
  COMPONENT_TYPES, CONNECTION_PORTS, contentOf, duplicateElements, emptyContext, emptyProperties,
  fingerprint, parseImport, removeElements, sampleGraph,
} from './domain';
import type { ComponentType, ConnectionPort, DiagramContent, DiagramEdge, DiagramNode, DiagramSummary, Version } from './domain';
import { Brand, CATALOG, ComponentNode, IconButton, InteractionContext, metadata, Modal, TextNode, TextEditContext } from './components';
import type { StudioNode } from './components';
import { useEditor } from './useEditor';
import { ConnectionEdge } from './ConnectionEdge';
import type { ConnectionFlowEdge } from './ConnectionEdge';
import { connectionLanes, nodeHandles } from './connections';
import { ChatGPTDialog } from './ChatGPTDialog';
import { InterviewPanel } from './InterviewPanel';

const nodeTypes = { component: ComponentNode, text: TextNode };
const edgeTypes = { connection: ConnectionEdge };
const dateLabel = (date: string) => new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong.';

export function App() { return <ReactFlowProvider><Studio /></ReactFlowProvider>; }

function Studio() {
  const editor = useEditor();
  const { doc, change } = editor;
  const flow = useReactFlow<StudioNode>();
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [appError, setAppError] = useState('');
  const [notice, setNotice] = useState('');
  const [library, setLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<'properties' | 'context'>('context');
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [imported, setImported] = useState<DiagramContent | null>(null);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showChatGPT, setShowChatGPT] = useState(false);
  const [showInterview, setShowInterview] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [showPalette, setShowPalette] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [zoom, setZoom] = useState(1);
  const inputFile = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const contentEdit = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await api.list();
        if (cancelled) return;
        setDiagrams(list);
        let lastId: string | null = null;
        try { lastId = localStorage.getItem('studio.last-diagram'); } catch { /* Loading works without browser storage. */ }
        const first = list.find(item => item.id === lastId) ?? list[0];
        if (first) {
          const value = await api.get(first.id);
          if (!cancelled) { editor.load(value); window.setTimeout(() => void flow.fitView({ padding: 0.3 }), 100); }
        }
      } catch (error) { if (!cancelled) setAppError(messageOf(error)); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
    // Initialize once; StrictMode cleanup prevents duplicate initialization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!doc) return;
    try { localStorage.setItem('studio.last-diagram', doc.id); } catch { /* Draft warning is shown separately. */ }
    setDiagrams(list => {
      const summary: DiagramSummary = { id: doc.id, title: doc.title, version: doc.version, updated_at: doc.updated_at, node_count: doc.graph.nodes.length, edge_count: doc.graph.edges.length };
      return [summary, ...list.filter(item => item.id !== doc.id)];
    });
  }, [doc]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => { setSelection(new Set()); setTitleEditing(false); }, [doc?.id]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setAppError('');
    try { await action(); }
    catch (error) { setAppError(messageOf(error)); }
    finally { setBusy(false); }
  }

  async function flush() {
    if (editor.draft || editor.status === 'conflict') { setAppError('Resolve the recovered draft or save conflict before switching diagrams.'); return false; }
    // No fields should be mid-edit while navigating to another diagram.
    return await editor.save();
  }

  async function create(content: Partial<DiagramContent> = {}) {
    await run(async () => {
      if (!await flush()) return;
      const created = await api.create(content);
      editor.load(created, false); setLibrary(false); setImported(null); setTab('context');
      window.setTimeout(() => void flow.fitView({ padding: 0.35 }), 100);
    });
  }

  async function openDiagram(id: string) {
    if (id === doc?.id) { setLibrary(false); return; }
    await run(async () => {
      if (!await flush()) return;
      editor.load(await api.get(id)); setLibrary(false); setTab('context');
      window.setTimeout(() => void flow.fitView({ padding: 0.3 }), 100);
    });
  }

  async function openLibrary() {
    setLibrary(true);
    await run(async () => {
      const list = await api.list();
      const current = editor.getCurrent();
      setDiagrams(current ? [{ ...current, node_count: current.graph.nodes.length, edge_count: current.graph.edges.length }, ...list.filter(item => item.id !== current.id)] : list);
    });
  }

  function select(ids: string[]) { setSelection(new Set(ids)); if (ids.length) setTab('properties'); }

  function addNode(type: ComponentType, position?: { x: number; y: number }) {
    if (!doc || busy) return;
    if (doc.graph.nodes.length >= 500) { setNotice('The diagram has reached the 500-component limit.'); return; }
    const bounds = canvasRef.current?.getBoundingClientRect();
    const center = bounds ? flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }) : { x: 100, y: 100 };
    const point = position ?? { x: center.x - 100 + (doc.graph.nodes.length % 4) * 20, y: center.y - 52 + (doc.graph.nodes.length % 4) * 20 };
    const node: DiagramNode = { id: crypto.randomUUID(), type, label: metadata(type).label, position: point, width: 200, height: 104, properties: emptyProperties() };
    change(content => ({ ...content, graph: { ...content.graph, nodes: [...content.graph.nodes, node] } }));
    select([node.id]); setShowPalette(false);
  }

  function deleteSelection() {
    if (!selection.size) return;
    change(content => ({ ...content, graph: removeElements(content.graph, selection) }));
    setSelection(new Set());
  }

  function duplicateSelection() {
    const current = editor.getCurrent(); if (!current) return;
    const result = duplicateElements(current.graph, selection);
    if (result.graph.nodes.length > 500 || result.graph.edges.length > 1500) { setNotice('Duplicating would exceed the diagram size limit.'); return; }
    if (!result.ids.length) return;
    change(content => ({ ...content, graph: result.graph })); select(result.ids);
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]') || library || versions || imported || pendingDelete || showHelp || showChatGPT || editor.draft || titleEditing) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); editor.redo(); }
      if (modifier && event.key.toLowerCase() === 's') { event.preventDefault(); void editor.save(); }
      if (modifier && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); }
      if (modifier && event.key.toLowerCase() === 'a') { event.preventDefault(); select(doc?.graph.nodes.map(node => node.id) ?? []); }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); }
      if (event.key === 'Escape') setSelection(new Set());
      if (event.key.toLowerCase() === 'f' && !modifier) void flow.fitView({ padding: 0.3, duration: 300 });
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  function nodesChanged(changes: NodeChange<StudioNode>[]) {
    const selected = changes.filter(change => change.type === 'select');
    if (selected.length) setSelection(previous => {
      const next = new Set(previous);
      for (const change of selected) if (change.type === 'select') { if (change.selected) next.add(change.id); else next.delete(change.id); }
      return next;
    });
    const edits = changes.filter(change => change.type === 'position' && change.position || change.type === 'dimensions' && change.setAttributes);
    if (!edits.length) return;
    change(content => ({ ...content, graph: { ...content.graph, nodes: content.graph.nodes.map(node => {
      let result = node;
      for (const edit of edits) {
        if (edit.type === 'position' && edit.id === node.id && edit.position) result = { ...result, position: edit.position };
        if (edit.type === 'dimensions' && edit.id === node.id && edit.dimensions) result = { ...result, width: edit.dimensions.width, height: edit.dimensions.height };
      }
      return result;
    }) } }), false);
  }

  function edgesChanged(changes: EdgeChange[]) {
    setSelection(previous => {
      const next = new Set(previous);
      for (const change of changes) if (change.type === 'select') { if (change.selected) next.add(change.id); else next.delete(change.id); }
      return next;
    });
  }

  function connect(connection: Connection) {
    if (!connection.source || !connection.target) return;
    if ((doc?.graph.edges.length ?? 0) >= 1500) { setNotice('The diagram has reached the connection limit.'); return; }
    const edge: DiagramEdge = { id: crypto.randomUUID(), source: connection.source, target: connection.target, label: '', protocol: '', interaction: 'synchronous',
      direction: 'one_way', source_port: (connection.sourceHandle ?? 'right') as ConnectionPort, target_port: (connection.targetHandle ?? 'left') as ConnectionPort };
    change(content => ({ ...content, graph: { ...content.graph, edges: [...content.graph.edges, edge] } })); select([edge.id]);
  }

  const nodes: StudioNode[] = doc?.graph.nodes.map(component => ({
    id: component.id, type: component.type === 'text' ? 'text' : 'component', position: component.position, data: { component },
    selected: selection.has(component.id), width: component.width, height: component.height,
    measured: { width: component.width, height: component.height },
    handles: component.type === 'text' ? [] : nodeHandles(component),
    connectable: component.type !== 'text',
    style: { width: component.width, height: component.height },
  })) ?? [];
  const lanes = connectionLanes(doc?.graph.edges ?? []);
  const edges: ConnectionFlowEdge[] = doc?.graph.edges.map(edge => ({
    id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.source_port ?? 'right', targetHandle: edge.target_port ?? 'left',
    label: edge.label || edge.protocol, selected: selection.has(edge.id), type: 'connection', data: lanes.get(edge.id),
    markerStart: edge.direction === 'two_way' ? { type: MarkerType.ArrowClosed, width: 16, height: 16, orient: 'auto-start-reverse', color: selection.has(edge.id) ? '#247657' : '#85958d' } : undefined,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: selection.has(edge.id) ? '#247657' : '#85958d' },
    style: { stroke: selection.has(edge.id) ? '#247657' : '#85958d', strokeWidth: selection.has(edge.id) ? 2 : 1.5, strokeDasharray: edge.interaction === 'asynchronous' ? '6 4' : undefined },
    labelStyle: { fill: '#5d6a62', fontSize: 11, fontWeight: 500 }, labelBgStyle: { fill: '#f7f8f5' }, labelBgPadding: [6, 4], labelBgBorderRadius: 4,
  })) ?? [];
  const selectedNode = selection.size === 1 ? doc?.graph.nodes.find(node => selection.has(node.id)) : undefined;
  const selectedEdge = selection.size === 1 ? doc?.graph.edges.find(edge => selection.has(edge.id)) : undefined;

  function editNode(updates: Partial<DiagramNode>) {
    if (!selectedNode) return;
    change(content => ({ ...content, graph: { ...content.graph, nodes: content.graph.nodes.map(node => node.id === selectedNode.id ? { ...node, ...updates } : node) } }), !contentEdit.current);
  }
  function editProperty(key: keyof DiagramNode['properties'], value: string | number | null) {
    if (!selectedNode) return;
    editNode({ properties: { ...selectedNode.properties, [key]: value } });
  }
  function editEdge(updates: Partial<DiagramEdge>) {
    if (!selectedEdge) return;
    change(content => ({ ...content, graph: { ...content.graph, edges: content.graph.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, ...updates } : edge) } }), !contentEdit.current);
  }
  // Each form field edit is one undoable action, regardless of how many keystrokes it uses.
  const fieldEditing = { onFocus: () => { editor.checkpoint(); contentEdit.current = true; }, onBlur: () => { contentEdit.current = false; } };

  function exportJson() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(contentOf(doc), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${doc.title.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'diagram'}.json`;
    anchor.click(); URL.revokeObjectURL(url); setNotice('Diagram exported.');
  }

  async function importFile(file: File) {
    try {
      if (file.size > 2_000_000) throw new Error('Choose a JSON file smaller than 2 MB.');
      setImported(parseImport(JSON.parse(await file.text())));
    } catch (error) { setAppError(`Import failed: ${messageOf(error)}`); }
    finally { if (inputFile.current) inputFile.current.value = ''; }
  }

  async function saveCopy() {
    await run(async () => {
      const current = editor.getCurrent(); if (!current) return;
      const created = await api.create({ ...contentOf(current), title: `${current.title.slice(0, 185)} (copy)` });
      // Retain the original conflict draft until the copy has been saved successfully.
      try { localStorage.removeItem(`studio.draft.${current.id}`); } catch { /* No loss of server data. */ }
      editor.load(created, false); setNotice('Saved as a new diagram.');
    });
  }

  async function reloadSaved() {
    await run(async () => {
      const current = editor.getCurrent(); if (!current) return;
      const saved = await api.get(current.id);
      // Keep the local draft in storage; it can still be recovered after reload.
      editor.load(saved, false); setSelection(new Set()); setNotice('Showing the saved version. Your prior draft is still stored locally.');
    });
  }

  async function showHistory() {
    await run(async () => {
      if (!doc || !await flush()) return;
      setVersions(await api.versions(doc.id));
    });
  }

  async function restore(version: number) {
    await run(async () => {
      const current = editor.getCurrent(); if (!current) return;
      const result = await api.restore(current.id, version, current.version);
      editor.load(result, false); setVersions(null); setSelection(new Set()); setNotice(`Version ${version} restored as version ${result.version}.`);
    });
  }

  async function deleteDiagram() {
    await run(async () => {
      if (!await flush()) return;
      const current = editor.getCurrent(); if (!current) return;
      await api.remove(current.id, current.version);
      try { localStorage.removeItem(`studio.draft.${current.id}`); } catch { /* Ignore unavailable local storage. */ }
      const list = await api.list(); setDiagrams(list); setPendingDelete(false); setLibrary(false);
      if (list[0]) editor.load(await api.get(list[0].id));
      else editor.load(await api.create(), false);
      setNotice('Diagram deleted.');
    });
  }

  function commitTitle() {
    const title = titleDraft.trim();
    if (title) change(content => ({ ...content, title }));
    setTitleEditing(false);
  }

  const palette = CATALOG.filter(item => `${item.label} ${item.detail}`.toLowerCase().includes(paletteSearch.toLowerCase()));
  const isModalOpen = library || !!versions || !!imported || pendingDelete || showHelp || showChatGPT || !!editor.draft;
  const disabled = busy || !doc || !!editor.draft || editor.status === 'conflict';
  const statusLabels = { saved: 'All changes saved', pending: 'Unsaved changes', saving: 'Saving…', error: 'Save failed', conflict: 'Save conflict' };

  return <div className="studio">
      <header className="app-header">
        <Brand />
        <IconButton label="Toggle component library" className="mobile-panel-toggle" onClick={() => { setShowPalette(value => !value); setShowInspector(false); }}><PanelLeft size={17} /></IconButton>
        <div className="header-divider" />
        <div className="document-heading">
          <button className="breadcrumb" onClick={() => void openLibrary()}>My diagrams <ChevronDown size={12} /></button>
          {titleEditing ? <input className="title-input" autoFocus maxLength={200} value={titleDraft} aria-label="Diagram title" onChange={event => setTitleDraft(event.target.value)} onBlur={commitTitle} onKeyDown={event => { if (event.key === 'Enter') commitTitle(); if (event.key === 'Escape') setTitleEditing(false); }} />
            : <button className="document-title" disabled={disabled} title="Rename diagram" onClick={() => { setTitleDraft(doc?.title ?? ''); setTitleEditing(true); }}>{doc?.title ?? 'Your next system starts here'}{doc && <span className="title-edit-hint">Rename</span>}</button>}
        </div>
        <div className="header-actions">
          <button className="button button-outline" onClick={() => setShowChatGPT(true)} disabled={busy}><Sparkles size={15} />ChatGPT</button>
          <button className="button button-outline" onClick={() => setShowInterview(value => !value)} disabled={busy || !doc}><BookOpen size={15} />Interview</button>
          {doc && <span className={`save-status status-${editor.status}`} role="status">{editor.status === 'saved' ? <Check size={14} /> : editor.status === 'saving' ? <LoaderCircle className="spin" size={14} /> : <span className="status-dot" />}{statusLabels[editor.status]}</span>}
          <button className="button button-quiet" onClick={() => inputFile.current?.click()} disabled={busy}><Upload size={15} />Import</button>
          <button className="button button-outline" onClick={exportJson} disabled={!doc}><Download size={15} />Export JSON</button>
          <button className="button button-primary" onClick={() => void create()} disabled={busy || !!editor.draft || editor.status === 'conflict'}><Plus size={16} />New diagram</button>
          <IconButton label="Toggle properties and context" className="mobile-panel-toggle" onClick={() => { setShowInspector(value => !value); setShowPalette(false); }}><Settings2 size={17} /></IconButton>
        </div>
      </header>

      <div className="workspace">
        {(showPalette || showInspector) && <button className="panel-scrim" aria-label="Close side panel" onClick={() => { setShowPalette(false); setShowInspector(false); }} />}
        <aside className={`palette-panel ${showPalette ? 'mobile-open' : ''}`} aria-label="Component library">
          <div className="palette-heading"><div className="eyebrow">BUILD YOUR SYSTEM</div><h2>Components</h2><p>Click to add, or drag onto the canvas.</p></div>
          <label className="search-field"><Search size={15} /><input placeholder="Find a component…" aria-label="Search components" value={paletteSearch} onChange={event => setPaletteSearch(event.target.value)} /></label>
          <div className="palette-list">
            {['Traffic & compute', 'Data & messaging', 'Other', 'Annotations'].map(category => {
              const items = palette.filter(item => item.category === category);
              return items.length > 0 && <section key={category}><h3>{category}</h3>{items.map(item => {
                const Icon = item.icon;
                return <button key={item.type} className="palette-item" disabled={disabled} draggable={!disabled} onDragStart={event => { event.dataTransfer.setData('application/studio-component', item.type); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => addNode(item.type)}>
                  <span className={`palette-icon tint-${item.color}`}><Icon size={17} strokeWidth={1.7} /></span><span><strong>{item.label}</strong><small>{item.detail}</small></span><Plus className="palette-add" size={13} />
                </button>;
              })}</section>;
            })}
            {!palette.length && <p className="subtle-message">No matching components.</p>}
          </div>
          <button className="palette-footer" onClick={() => setShowHelp(true)}><span className="help-key">?</span><span>Canvas guide<small>Shortcuts & getting started</small></span><ArrowRight size={14} /></button>
        </aside>

        <main className="canvas-area" ref={canvasRef} aria-label="Diagram editor">
          <div className="canvas-toolbar"><span className="canvas-mode"><MousePointer2 size={14} />Design canvas</span><span className="toolbar-divider" />
            <IconButton label="Add text" onClick={() => addNode('text')} disabled={disabled}><Type size={16} /></IconButton>
            <IconButton label="Undo (⌘/Ctrl Z)" onClick={editor.undo} disabled={disabled || !editor.canUndo}><Undo2 size={16} /></IconButton>
            <IconButton label="Redo (⌘/Ctrl Shift Z)" onClick={editor.redo} disabled={disabled || !editor.canRedo}><Redo2 size={16} /></IconButton>
            <span className="toolbar-divider" />
            <IconButton label="Duplicate selection (⌘/Ctrl D)" onClick={duplicateSelection} disabled={disabled || !doc?.graph.nodes.some(node => selection.has(node.id))}><Copy size={15} /></IconButton>
            <IconButton label="Delete selection" onClick={deleteSelection} disabled={disabled || !selection.size}><Trash2 size={15} /></IconButton>
            <span className="toolbar-divider" />
            <IconButton label="Version history" onClick={() => void showHistory()} disabled={disabled}><History size={16} /></IconButton>
          </div>

          {(appError || editor.error || editor.storageError) && <div className={`error-banner ${editor.status === 'conflict' ? 'conflict-banner' : ''}`} role="alert">
            <div><strong>{editor.status === 'conflict' ? 'Your edits are safe locally' : 'Something needs attention'}</strong><p>{appError || editor.error || editor.storageError}</p></div>
            {editor.status === 'conflict' ? <div className="banner-actions"><button onClick={() => void saveCopy()} disabled={busy}>Save as copy</button><button onClick={() => void reloadSaved()} disabled={busy}>View saved</button></div>
              : editor.status === 'error' ? <button onClick={() => void editor.save()}>Retry save</button> : <IconButton label="Dismiss message" onClick={() => setAppError('')}><X size={16} /></IconButton>}
          </div>}

          <InteractionContext.Provider value={{ begin: () => { editor.checkpoint(); editor.setInteracting(true); }, end: () => editor.setInteracting(false) }}>
          <TextEditContext.Provider value={{ enabled: !disabled, begin: fieldEditing.onFocus, end: fieldEditing.onBlur,
            update: (id, text) => change(content => ({ ...content, graph: { ...content.graph, nodes: content.graph.nodes.map(node => node.id === id ? { ...node, properties: { ...node.properties, description: text } } : node) } }), false) }}>
          <ReactFlow<StudioNode, ConnectionFlowEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose} onNodesChange={nodesChanged} onEdgesChange={edgesChanged} onConnect={connect}
            onNodeDragStart={() => { editor.checkpoint(); editor.setInteracting(true); }} onNodeDragStop={() => editor.setInteracting(false)}
            onNodeClick={() => setTab('properties')}
            onEdgeClick={() => setTab('properties')} onPaneClick={() => setSelection(new Set())}
            onMove={(_, viewport) => setZoom(viewport.zoom)}
            onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
            onDrop={event => { event.preventDefault(); const type = event.dataTransfer.getData('application/studio-component'); if (COMPONENT_TYPES.includes(type as ComponentType) && !disabled) addNode(type as ComponentType, flow.screenToFlowPosition({ x: event.clientX - 100, y: event.clientY - 52 })); }}
            nodesDraggable={!disabled} nodesConnectable={!disabled} elementsSelectable={!disabled}
            deleteKeyCode={null} selectionKeyCode="Shift" multiSelectionKeyCode={["Meta", "Control"]}
            snapToGrid snapGrid={[16, 16]} minZoom={0.2} maxZoom={2} fitView fitViewOptions={{ padding: 0.3 }}
            elevateEdgesOnSelect proOptions={{ hideAttribution: false }}>
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d0d8d0" />
            {(doc?.graph.nodes.length ?? 0) > 0 && <MiniMap pannable zoomable nodeColor="#dbe9df" nodeStrokeColor="#a4beaf" maskColor="rgba(247,248,245,.7)" />}
          </ReactFlow>
          </TextEditContext.Provider>
          </InteractionContext.Provider>

          {loading ? <div className="canvas-empty"><LoaderCircle className="spin" size={25} /><p>Opening your workspace…</p></div>
            : !doc ? <div className="canvas-empty"><div className="empty-illustration"><Workflow size={38} strokeWidth={1.3} /><span className="illustration-dot" /></div><div className="eyebrow">A PLACE TO THINK IN SYSTEMS</div><h1>Make your architecture visible.</h1><p>Connect the pieces. Capture the decisions.<br />Build a clearer picture of your system.</p><button className="button button-primary" disabled={busy} onClick={() => void create()}><Plus size={16} />Create your first diagram</button><button className="text-button" disabled={busy} onClick={() => void create({ title: 'Web application architecture', graph: sampleGraph(), context: { ...emptyContext(), brief: 'A web application with an API, read cache, and primary database.' } })}>Or explore a simple example <ArrowRight size={14} /></button></div>
            : !doc.graph.nodes.length && <div className="canvas-empty diagram-empty"><div className="empty-illustration"><Workflow size={32} strokeWidth={1.3} /></div><h2>A blank canvas. A new possibility.</h2><p>Add a component from the library to get started.<br />Drag between any dots to connect your system.</p><button className="button button-outline" onClick={() => { change(content => ({ ...content, graph: sampleGraph() })); window.setTimeout(() => void flow.fitView({ padding: 0.3 }), 100); }}>Start with an example <ArrowRight size={14} /></button></div>}

          <div className="canvas-bottom"><span className="canvas-tip"><Link2 size={13} />Drag between any dots · reuse dots for more connections</span><div className="zoom-controls"><IconButton label="Zoom out" onClick={() => void flow.zoomOut({ duration: 200 })}><Minus size={15} /></IconButton><span>{Math.round(zoom * 100)}%</span><IconButton label="Zoom in" onClick={() => void flow.zoomIn({ duration: 200 })}><Plus size={15} /></IconButton><span className="toolbar-divider" /><IconButton label="Fit diagram (F)" onClick={() => void flow.fitView({ padding: 0.3, duration: 300 })}><Maximize2 size={15} /></IconButton></div></div>
          {notice && <div className="toast" role="status"><Check size={15} />{notice}</div>}
        </main>

        {!showInterview && <aside className={`inspector ${showInspector ? 'mobile-open' : ''}`} aria-label="Properties and design context">
          <div className="inspector-tabs"><button className={tab === 'properties' ? 'active' : ''} onClick={() => setTab('properties')}><Settings2 size={14} />Properties</button><button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}><BookOpen size={14} />Context</button></div>
          <div className="inspector-content">
            {tab === 'context' ? <><div className="eyebrow">THE BIG PICTURE</div><h2>Design context</h2><p className="panel-description">Give this diagram a purpose. Keep requirements and decisions close to the design.</p>
              <fieldset disabled={disabled} className="property-fields">
                <label>What are you designing?<textarea {...fieldEditing} rows={5} maxLength={10000} placeholder="Describe the system, who it serves, and the problem it solves…" value={doc?.context.brief ?? ''} onChange={event => change(content => ({ ...content, context: { ...content.context, brief: event.target.value } }), false)} /></label>
                <label>Requirements<textarea {...fieldEditing} rows={5} maxLength={10000} placeholder="Key features, traffic estimates, latency and availability targets…" value={doc?.context.requirements ?? ''} onChange={event => change(content => ({ ...content, context: { ...content.context, requirements: event.target.value } }), false)} /></label>
                <label>Constraints & decisions<textarea {...fieldEditing} rows={5} maxLength={10000} placeholder="Budget, technology choices, assumptions, and tradeoffs…" value={doc?.context.constraints ?? ''} onChange={event => change(content => ({ ...content, context: { ...content.context, constraints: event.target.value } }), false)} /></label>
              </fieldset><div className="context-note"><BookOpen size={15} /><span>Context is saved with this diagram and included in its JSON export.</span></div></>
              : selectedNode?.type === 'text' ? <><div className="inspector-component-icon tint-gray"><Type size={24} /></div><div className="eyebrow">ANNOTATION</div><h2>Text</h2><p className="panel-description">Keep notes and headings beside your design.</p>
                <fieldset disabled={disabled} className="property-fields"><label>Text content<textarea {...fieldEditing} rows={8} maxLength={5000} placeholder="Write a note…" value={selectedNode.properties.description} onChange={event => editProperty('description', event.target.value)} /></label></fieldset>
                <div className="inspector-actions"><button className="button button-outline" disabled={disabled} onClick={duplicateSelection}><Copy size={14} />Duplicate</button><IconButton label="Delete text" className="danger" disabled={disabled} onClick={deleteSelection}><Trash2 size={16} /></IconButton></div>
                <p className="field-hint">Double-click the text to edit on the canvas. Drag to move it, or use the corner handles to resize. Text saves automatically.</p></>
              : selectedNode ? <><div className={`inspector-component-icon tint-${metadata(selectedNode.type).color}`}>{(() => { const Icon = metadata(selectedNode.type).icon; return <Icon size={24} strokeWidth={1.5} />; })()}</div><div className="eyebrow">COMPONENT</div><h2>{metadata(selectedNode.type).label}</h2><p className="panel-description">Describe its role in your system.</p>
                <fieldset disabled={disabled} className="property-fields">
                  <label>Label<input {...fieldEditing} maxLength={200} value={selectedNode.label} onChange={event => editNode({ label: event.target.value || 'Untitled component' })} /></label>
                  <label>Type<select value={selectedNode.type} onChange={event => editNode({ type: event.target.value as ComponentType })}>{CATALOG.filter(item => item.type !== 'text').map(item => <option value={item.type} key={item.type}>{item.label}</option>)}</select></label>
                  <label>Technology<input {...fieldEditing} maxLength={200} value={selectedNode.properties.technology} placeholder="e.g. PostgreSQL, Redis, Python" onChange={event => editProperty('technology', event.target.value)} /></label>
                  <label>Description<textarea {...fieldEditing} maxLength={5000} rows={4} value={selectedNode.properties.description} placeholder="What is this component responsible for?" onChange={event => editProperty('description', event.target.value)} /></label>
                  <div className="field-row"><label>Replicas<input {...fieldEditing} type="number" min={1} max={1000000} step={1} value={selectedNode.properties.replicas ?? ''} placeholder="Unknown" onChange={event => { const value = event.target.value; if (!value) editProperty('replicas', null); else if (Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1000000) editProperty('replicas', Number(value)); }} /></label><label>Region<input {...fieldEditing} maxLength={200} value={selectedNode.properties.region} placeholder="Optional" onChange={event => editProperty('region', event.target.value)} /></label></div>
                </fieldset><div className="inspector-actions"><button className="button button-outline" disabled={disabled} onClick={duplicateSelection}><Copy size={14} />Duplicate</button><IconButton label="Delete component" className="danger" disabled={disabled} onClick={deleteSelection}><Trash2 size={16} /></IconButton></div><p className="field-hint">{doc?.graph.edges.filter(edge => edge.source === selectedNode.id || edge.target === selectedNode.id).length} connections. Each dot can be reused for incoming and outgoing connections. Drag the component to move it; use corner handles to resize.</p></>
                : selectedEdge ? <><div className="inspector-component-icon tint-green"><Link2 size={24} strokeWidth={1.5} /></div><div className="eyebrow">CONNECTION</div><h2>Data flow</h2><p className="connection-path">{doc?.graph.nodes.find(node => node.id === selectedEdge.source)?.label}{selectedEdge.direction === 'two_way' ? <ArrowLeftRight size={14} /> : <ArrowRight size={14} />}{doc?.graph.nodes.find(node => node.id === selectedEdge.target)?.label}</p>
                  <fieldset disabled={disabled} className="property-fields">
                    <label>Label<input {...fieldEditing} maxLength={200} value={selectedEdge.label} placeholder="e.g. Read / write" onChange={event => editEdge({ label: event.target.value })} /></label>
                    <label>Direction<select value={selectedEdge.direction ?? 'one_way'} onChange={event => editEdge({ direction: event.target.value as DiagramEdge['direction'] })}><option value="one_way">One way</option><option value="two_way">Two way</option></select></label>
                    <label>Protocol<input {...fieldEditing} maxLength={100} value={selectedEdge.protocol} placeholder="e.g. HTTPS, gRPC, SQL" onChange={event => editEdge({ protocol: event.target.value })} /></label>
                    <label>Interaction<select value={selectedEdge.interaction} onChange={event => editEdge({ interaction: event.target.value as DiagramEdge['interaction'] })}><option value="synchronous">Synchronous</option><option value="asynchronous">Asynchronous</option></select></label>
                    <div className="field-row"><label>Source side<select value={selectedEdge.source_port ?? 'right'} onChange={event => editEdge({ source_port: event.target.value as ConnectionPort })}>{CONNECTION_PORTS.map(port => <option key={port} value={port}>{port[0].toUpperCase() + port.slice(1)}</option>)}</select></label><label>Target side<select value={selectedEdge.target_port ?? 'left'} onChange={event => editEdge({ target_port: event.target.value as ConnectionPort })}>{CONNECTION_PORTS.map(port => <option key={port} value={port}>{port[0].toUpperCase() + port.slice(1)}</option>)}</select></label></div>
                  </fieldset>
                  <div className="inspector-actions"><button className="button button-outline" disabled={disabled} onClick={() => editEdge({ source: selectedEdge.target, target: selectedEdge.source, source_port: selectedEdge.target_port ?? 'left', target_port: selectedEdge.source_port ?? 'right' })}><ArrowLeftRight size={14} />Reverse endpoints</button><IconButton label="Delete connection" className="danger" disabled={disabled} onClick={deleteSelection}><Trash2 size={16} /></IconButton></div>
                  <p className="field-hint">Two way adds an arrow at both ends. Multiple connections can share the same dots.</p></>
                  : selection.size > 1 ? <div className="inspector-empty"><MousePointer2 size={27} /><h3>{selection.size} elements selected</h3><p>Move selected components together, duplicate them, or remove the selection.</p><button className="button button-outline" disabled={disabled} onClick={duplicateSelection}><Copy size={14} />Duplicate components</button><button className="text-button danger" disabled={disabled} onClick={deleteSelection}>Delete selection</button></div>
                    : <div className="inspector-empty"><MousePointer2 size={27} strokeWidth={1.5} /><h3>A closer look</h3><p>Select a component or connection to edit its properties.</p><span className="keyboard-tip"><kbd>Shift</kbd> + click to select multiple</span></div>}
          </div>
          <div className="inspector-footer"><span className="local-dot" />Personal workspace<span>{doc ? `${doc.graph.nodes.length} components` : 'Local edition'}</span></div>
        </aside>}
        {showInterview && doc && <InterviewPanel key={doc.id} diagram={doc} editable={!disabled}
          onClose={() => setShowInterview(false)} onConnect={() => { setShowInterview(false); setShowChatGPT(true); }} />}
      </div>

      <input type="file" ref={inputFile} hidden accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />

      {library && <Modal title="My diagrams" subtitle="Your systems, with room to evolve." wide onClose={() => setLibrary(false)}>
        <div className="library-toolbar"><label className="search-field"><Search size={16} /><input autoFocus placeholder="Search diagrams…" aria-label="Search diagrams" value={librarySearch} onChange={event => setLibrarySearch(event.target.value)} /></label><button className="button button-primary" disabled={busy || !!editor.draft || editor.status === 'conflict'} onClick={() => void create()}><Plus size={15} />New diagram</button></div>
        <div className="diagram-list">{diagrams.filter(item => item.title.toLowerCase().includes(librarySearch.toLowerCase())).map(item => <button className={`diagram-list-item ${item.id === doc?.id ? 'current' : ''}`} key={item.id} disabled={busy} onClick={() => void openDiagram(item.id)}><span className="diagram-list-icon"><Workflow size={22} strokeWidth={1.5} /></span><span><strong>{item.title}</strong><small>{item.node_count} components · Edited {dateLabel(item.updated_at)}</small></span>{item.id === doc?.id ? <span className="current-badge">Open</span> : <ArrowRight size={16} />}</button>)}{!diagrams.length && <div className="library-empty"><FolderOpen size={26} /><p>Your first diagram is waiting to happen.</p></div>}</div>
        {doc && <div className="modal-footer"><button className="button button-quiet" disabled={busy || editor.status === 'conflict'} onClick={() => { setLibrary(false); void saveCopy(); }}><Copy size={15} />Duplicate current diagram</button><button className="text-button danger" disabled={busy || editor.status === 'conflict'} onClick={() => { setLibrary(false); setPendingDelete(true); }}><Trash2 size={14} />Delete current diagram</button></div>}
      </Modal>}

      {versions && <Modal title="Version history" subtitle="Restoring creates a new version. Your history stays intact." onClose={() => setVersions(null)}>
        <div className="version-list">{versions.map(version => <div className="version-item" key={version.version}><span className="version-dot" /><div><strong>Version {version.version}{version.version === doc?.version && <span className="current-badge">Current</span>}</strong><small>{dateLabel(version.created_at)}</small></div><button className="button button-outline" disabled={busy || version.version === doc?.version} onClick={() => void restore(version.version)}>Restore</button></div>)}</div>
      </Modal>}

      {imported && <Modal title="Import diagram" subtitle="This will create a new diagram. Your current design stays intact." onClose={() => setImported(null)}><div className="import-preview"><Workflow size={28} /><h3>{imported.title}</h3><p>{imported.graph.nodes.length} components · {imported.graph.edges.length} connections</p>{imported.context.brief && <blockquote>{imported.context.brief}</blockquote>}</div><div className="modal-footer"><button className="button button-outline" onClick={() => setImported(null)}>Cancel</button><button className="button button-primary" disabled={busy || !!editor.draft || editor.status === 'conflict'} onClick={() => void create(imported)}><Upload size={15} />Import as new diagram</button></div></Modal>}

      {pendingDelete && <Modal title="Delete this diagram?" subtitle="This removes the diagram and all its saved versions. Export a JSON copy first if you want to keep it." onClose={() => setPendingDelete(false)}><p className="delete-title">{doc?.title}</p><div className="modal-footer"><button className="button button-outline" onClick={exportJson}><Download size={14} />Export a copy</button><button className="button button-danger" disabled={busy} onClick={() => void deleteDiagram()}>Delete diagram</button></div></Modal>}

      {editor.draft && <Modal title="Recover your local draft?" subtitle="We found changes that were not saved to the server." onClose={() => { /* The user must explicitly choose to recover or discard. */ }}><p className="draft-summary">{editor.draft.content.title} · {editor.draft.content.graph.nodes.length} components</p>{editor.draft.baseVersion !== doc?.version && <p className="field-hint">The server has a newer version. Recover this draft and save it as a copy to keep both designs.</p>}<div className="modal-footer"><button className="button button-outline" onClick={() => editor.resolveDraft(false)}>Discard local draft</button><button className="button button-primary" onClick={() => editor.resolveDraft(true)}>Recover draft</button></div></Modal>}

      {showHelp && <Modal title="Make yourself at home" subtitle="A few ways to move around your design canvas." onClose={() => setShowHelp(false)}><div className="help-list"><div><strong>Add a component</strong><span>Click a library item, or drag it onto the canvas.</span></div><div><strong>Connect components</strong><span>Drag between dots on any side, or click a dot and then another. Each dot can be reused for multiple connections.</span></div><div><strong>Draw two-way arrows</strong><span>Select a connection, then choose Direction → Two way in Properties.</span></div><div><strong>Move around</strong><span>Drag the background to pan. Scroll to zoom.</span></div><div><strong>Select multiple</strong><span>Shift + drag a box, or Shift + click components.</span></div><div><strong>Undo / redo</strong><span>⌘/Ctrl Z · ⌘/Ctrl Shift Z</span></div><div><strong>Duplicate / delete</strong><span>⌘/Ctrl D · Delete or Backspace</span></div><div><strong>Fit everything on screen</strong><span>Press F, or use the fit button.</span></div><div><strong>Save</strong><span>Changes autosave. ⌘/Ctrl S saves immediately.</span></div></div><div className="modal-footer"><button className="button button-primary" onClick={() => setShowHelp(false)}>Got it <Check size={14} /></button></div></Modal>}
      {showChatGPT && <ChatGPTDialog diagram={doc} editable={!disabled} onClose={() => setShowChatGPT(false)} onApply={(graph, base, diagramId) => {
        const current = editor.getCurrent();
        if (!current || current.id !== diagramId || fingerprint(current) !== base || disabled) throw new Error('The diagram changed. Ask again before applying this proposal.');
        change(content => ({ ...content, graph })); select([]);
      }} />}
      {busy && !isModalOpen && <div className="busy-indicator" role="status"><LoaderCircle className="spin" size={16} />Working…</div>}
    </div>;
}
