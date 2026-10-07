export const COMPONENT_TYPES = [
  'client', 'cdn', 'load_balancer', 'gateway', 'service', 'worker',
  'database', 'document_database', 'cache', 'queue', 'stream', 'storage', 'external', 'generic', 'text',
] as const;
export type ComponentType = typeof COMPONENT_TYPES[number];
export const CONNECTION_PORTS = ['top', 'right', 'bottom', 'left'] as const;
export type ConnectionPort = typeof CONNECTION_PORTS[number];
export type Properties = { description: string; technology: string; region: string; replicas: number | null };
export type DiagramNode = {
  id: string; type: ComponentType; label: string; position: { x: number; y: number };
  width: number; height: number; properties: Properties;
};
export type DiagramEdge = {
  id: string; source: string; target: string; label: string; protocol: string;
  interaction: 'synchronous' | 'asynchronous';
  direction: 'one_way' | 'two_way';
  source_port: ConnectionPort; target_port: ConnectionPort;
};
export type Graph = { schema_version: 1; nodes: DiagramNode[]; edges: DiagramEdge[] };
export type DesignContext = { brief: string; requirements: string; constraints: string };
export type DiagramContent = { title: string; graph: Graph; context: DesignContext };
export type DiagramSummary = { id: string; title: string; version: number; updated_at: string; node_count: number; edge_count: number };
export type Diagram = DiagramContent & DiagramSummary;
export type Version = { version: number; title: string; created_at: string };
export const emptyProperties = (): Properties => ({ description: '', technology: '', region: '', replicas: null });
export const emptyGraph = (): Graph => ({ schema_version: 1, nodes: [], edges: [] });
export const emptyContext = (): DesignContext => ({ brief: '', requirements: '', constraints: '' });
export const contentOf = (doc: DiagramContent): DiagramContent => ({ title: doc.title, graph: doc.graph, context: doc.context });
// PostgreSQL JSONB reorders object keys; compare meaning rather than insertion order.
export const fingerprint = (doc: DiagramContent) => JSON.stringify({
  ...contentOf(doc), graph: { ...doc.graph, edges: doc.graph.edges.map(edge => ({
    ...edge, direction: edge.direction ?? 'one_way', source_port: edge.source_port ?? 'right', target_port: edge.target_port ?? 'left',
  })) },
}, (_key, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  }
  return value;
});

export function removeElements(graph: Graph, ids: Set<string>): Graph {
  return {
    ...graph,
    nodes: graph.nodes.filter(node => !ids.has(node.id)),
    edges: graph.edges.filter(edge => !ids.has(edge.id) && !ids.has(edge.source) && !ids.has(edge.target)),
  };
}

export function duplicateElements(graph: Graph, ids: Set<string>, makeId: () => string = () => crypto.randomUUID()): { graph: Graph; ids: string[] } {
  const mapping = new Map(graph.nodes.filter(node => ids.has(node.id)).map(node => [node.id, makeId()]));
  const nodes = graph.nodes.filter(node => mapping.has(node.id)).map(node => ({
    ...node, id: mapping.get(node.id)!, position: { x: node.position.x + 40, y: node.position.y + 40 },
    properties: { ...node.properties },
  }));
  // Only copy connections within the duplicated selection.
  const edges = graph.edges.filter(edge => mapping.has(edge.source) && mapping.has(edge.target)).map(edge => ({
    ...edge, id: makeId(), source: mapping.get(edge.source)!, target: mapping.get(edge.target)!,
  }));
  return { graph: { ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] }, ids: nodes.map(node => node.id) };
}

export function sampleGraph(): Graph {
  const node = (id: string, type: ComponentType, label: string, x: number, y: number, technology = ''): DiagramNode => ({
    id, type, label, position: { x, y }, width: 200, height: 104, properties: { ...emptyProperties(), technology },
  });
  const edge = (id: string, source: string, target: string, label: string): DiagramEdge => ({
    id, source, target, label, protocol: '', interaction: 'synchronous',
    direction: 'one_way', source_port: 'right', target_port: 'left',
  });
  return {
    schema_version: 1,
    nodes: [node('web', 'client', 'Web application', 0, 180), node('api', 'service', 'API service', 300, 180),
      node('cache', 'cache', 'Read cache', 600, 60, 'Redis'), node('db', 'database', 'Primary database', 600, 300, 'PostgreSQL')],
    edges: [edge('web-api', 'web', 'api', 'HTTPS'), edge('api-cache', 'api', 'cache', 'Look up'), edge('api-db', 'api', 'db', 'Read / write')],
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object in the diagram file.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error('A text field is invalid or too long.');
  return value;
}
function number(value: unknown, min: number, max: number, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('A coordinate or size is invalid.');
  return value;
}

/** Parse/normalize portable JSON without ever importing renderer state or arbitrary properties. */
export function parseImport(value: unknown): DiagramContent {
  const doc = record(value);
  const graph = record(doc.graph);
  if (graph.schema_version !== 1) throw new Error('This diagram schema version is not supported.');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length > 500 || graph.edges.length > 1500) {
    throw new Error('Diagram must have at most 500 components and 1,500 connections.');
  }
  const ids = new Set<string>();
  const uniqueId = (value: unknown) => {
    const id = text(value, 100);
    if (!id || ids.has(id)) throw new Error('Every component and connection needs a unique ID.');
    ids.add(id); return id;
  };
  const nodes: DiagramNode[] = graph.nodes.map(value => {
    const node = record(value); const position = record(node.position); const props = record(node.properties ?? {});
    if (!COMPONENT_TYPES.includes(node.type as ComponentType)) throw new Error('Unknown component type.');
    const label = text(node.label, 200);
    if (!label.trim()) throw new Error('Every component needs a label.');
    const replicas = props.replicas == null ? null : number(props.replicas, 1, 1_000_000);
    if (replicas !== null && !Number.isInteger(replicas)) throw new Error('Replicas must be a whole number.');
    return {
      id: uniqueId(node.id), type: node.type as ComponentType, label,
      position: { x: number(position.x, -1_000_000, 1_000_000), y: number(position.y, -1_000_000, 1_000_000) },
      width: number(node.width, 160, 1000, 200), height: number(node.height, 88, 1000, 104),
      properties: { description: text(props.description, 5000), technology: text(props.technology, 200), region: text(props.region, 200), replicas },
    };
  });
  const nodeIds = new Set(nodes.map(node => node.id));
  const textIds = new Set(nodes.filter(node => node.type === 'text').map(node => node.id));
  const edges: DiagramEdge[] = graph.edges.map(value => {
    const edge = record(value); const source = text(edge.source, 100); const target = text(edge.target, 100);
    if (!nodeIds.has(source) || !nodeIds.has(target)) throw new Error('A connection references a missing component.');
    if (textIds.has(source) || textIds.has(target)) throw new Error('Text annotations cannot have connections.');
    const interaction = edge.interaction ?? 'synchronous';
    if (interaction !== 'synchronous' && interaction !== 'asynchronous') throw new Error('Unknown interaction type.');
    const direction = edge.direction ?? 'one_way';
    if (direction !== 'one_way' && direction !== 'two_way') throw new Error('Unknown connection direction.');
    const sourcePort = edge.source_port ?? 'right'; const targetPort = edge.target_port ?? 'left';
    if (!CONNECTION_PORTS.includes(sourcePort as ConnectionPort) || !CONNECTION_PORTS.includes(targetPort as ConnectionPort)) throw new Error('Unknown connection side.');
    return { id: uniqueId(edge.id), source, target, label: text(edge.label, 200), protocol: text(edge.protocol, 100), interaction,
      direction, source_port: sourcePort as ConnectionPort, target_port: targetPort as ConnectionPort };
  });
  const context = record(doc.context ?? {});
  return {
    title: text(doc.title, 200, 'Imported diagram').trim() || 'Imported diagram',
    graph: { schema_version: 1, nodes, edges },
    context: { brief: text(context.brief, 10000), requirements: text(context.requirements, 10000), constraints: text(context.constraints, 10000) },
  };
}
