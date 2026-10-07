import { createContext, useContext, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowRightLeft, Box, Braces, Database, Globe, HardDrive, Laptop,
  Layers3, Network, Radio, Server, Shield, Workflow, X, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Handle, NodeResizer } from '@xyflow/react';
import type { Node, NodeProps } from '@xyflow/react';
import { CONNECTION_PORTS } from './domain';
import type { ComponentType, DiagramNode } from './domain';
import { PORT_POSITIONS } from './connections';

export const CATALOG: { type: ComponentType; label: string; detail: string; icon: LucideIcon; color: string; category: string }[] = [
  { type: 'client', label: 'Client', detail: 'Browser or mobile app', icon: Laptop, color: 'blue', category: 'Traffic & compute' },
  { type: 'cdn', label: 'CDN', detail: 'Deliver content at the edge', icon: Globe, color: 'blue', category: 'Traffic & compute' },
  { type: 'load_balancer', label: 'Load balancer', detail: 'Distribute incoming requests', icon: Network, color: 'blue', category: 'Traffic & compute' },
  { type: 'gateway', label: 'API gateway', detail: 'Route and authenticate traffic', icon: Shield, color: 'blue', category: 'Traffic & compute' },
  { type: 'service', label: 'Service', detail: 'Application or API', icon: Braces, color: 'green', category: 'Traffic & compute' },
  { type: 'worker', label: 'Worker', detail: 'Process background jobs', icon: Server, color: 'green', category: 'Traffic & compute' },
  { type: 'database', label: 'Database', detail: 'Relational data store', icon: Database, color: 'purple', category: 'Data & messaging' },
  { type: 'document_database', label: 'Document store', detail: 'Flexible document records', icon: Layers3, color: 'purple', category: 'Data & messaging' },
  { type: 'cache', label: 'Cache', detail: 'Fast, temporary storage', icon: Zap, color: 'amber', category: 'Data & messaging' },
  { type: 'queue', label: 'Queue', detail: 'Decouple producers and workers', icon: ArrowRightLeft, color: 'amber', category: 'Data & messaging' },
  { type: 'stream', label: 'Event stream', detail: 'Continuous event processing', icon: Radio, color: 'amber', category: 'Data & messaging' },
  { type: 'storage', label: 'Object storage', detail: 'Files, images and other objects', icon: HardDrive, color: 'purple', category: 'Data & messaging' },
  { type: 'external', label: 'External service', detail: 'A third-party dependency', icon: Globe, color: 'gray', category: 'Other' },
  { type: 'generic', label: 'Custom component', detail: 'Make it your own', icon: Box, color: 'gray', category: 'Other' },
];

export const metadata = (type: ComponentType) => CATALOG.find(item => item.type === type)!;
export type StudioNode = Node<{ component: DiagramNode }, 'component'>;
export const InteractionContext = createContext({ begin: () => {}, end: () => {} });

export function ComponentNode({ data, selected }: NodeProps<StudioNode>) {
  const component = data.component; const info = metadata(component.type); const Icon = info.icon;
  const interaction = useContext(InteractionContext);
  return <div className={`component-node ${selected ? 'is-selected' : ''}`}>
    <NodeResizer isVisible={selected} minWidth={160} minHeight={88} maxWidth={1000} maxHeight={1000}
      color="#247657" onResizeStart={interaction.begin} onResizeEnd={interaction.end} />
    {CONNECTION_PORTS.map(port => <Handle key={port} type="source" position={PORT_POSITIONS[port]} id={port}
      aria-label={`Connect ${component.label} ${port}`} title={`${port} connection — reusable for incoming and outgoing connections`} />)}
    <div className="node-top"><span className={`node-icon tint-${info.color}`}><Icon size={18} strokeWidth={1.8} /></span>
      <span className="node-kind">{info.label}</span>{component.properties.replicas && <span className="node-replicas">×{component.properties.replicas}</span>}</div>
    <div className="node-label">{component.label}</div>
    {component.properties.technology && <div className="node-technology">{component.properties.technology}</div>}
  </div>;
}

export function Brand({ small = false }: { small?: boolean }) {
  return <div className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark"><Workflow size={21} strokeWidth={1.8} /></span>
    {!small && <span>System Design<span className="brand-subtitle">STUDIO</span></span>}</div>;
}

export function IconButton({ label, children, onClick, disabled, className = '' }: {
  label: string; children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
}) {
  return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export function Modal({ title, subtitle, children, onClose, wide = false }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    container.current?.querySelector<HTMLElement>('button, input, textarea, select, [tabindex="0"]')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, select, [tabindex="0"]') ?? []);
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={container} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><IconButton label="Close dialog" onClick={onClose}><X size={18} /></IconButton></div>
      {children}
    </div>
  </div>;
}
