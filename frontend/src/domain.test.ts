import { describe, expect, it } from 'vitest';
import { duplicateElements, fingerprint, parseImport, removeElements, sampleGraph } from './domain';

describe('diagram operations', () => {
  it('compares documents independently of JSONB object key ordering', () => {
    const graph = sampleGraph();
    const first = { title: 'Feed', graph, context: { brief: '', requirements: '', constraints: '' } };
    const reordered = { title: 'Feed', graph: { edges: graph.edges, nodes: graph.nodes, schema_version: graph.schema_version }, context: { constraints: '', requirements: '', brief: '' } };
    expect(fingerprint(first)).toBe(fingerprint(reordered));
    expect(fingerprint({ ...first, title: 'Changed' })).not.toBe(fingerprint(first));
    const legacy = { ...first, graph: { ...graph, edges: graph.edges.map(({ direction: _direction, source_port: _source, target_port: _target, ...edge }) => edge) } };
    expect(fingerprint(legacy as typeof first)).toBe(fingerprint(first));
  });
  it('deletes attached connections and preserves unrelated nodes', () => {
    const original = sampleGraph();
    const next = removeElements(original, new Set(['cache']));
    expect(next.nodes.map(node => node.id)).toEqual(['web', 'api', 'db']);
    expect(next.edges.map(edge => edge.id)).toEqual(['web-api', 'api-db']);
    expect(original.nodes).toHaveLength(4);
  });
  it('duplicates internal connections without connecting to original nodes', () => {
    let id = 0;
    const result = duplicateElements(sampleGraph(), new Set(['web', 'api']), () => `copy-${++id}`);
    expect(result.ids).toEqual(['copy-1', 'copy-2']);
    expect(result.graph.edges.at(-1)).toMatchObject({ source: 'copy-1', target: 'copy-2' });
    expect(result.graph.edges).toHaveLength(4);
  });
  it('round-trips portable data and rejects dangling references and unsupported schemas', () => {
    const input = { title: 'Example', graph: sampleGraph(), context: { brief: 'A feed' } };
    expect(parseImport(JSON.parse(JSON.stringify(input))).graph).toEqual(input.graph);
    expect(() => parseImport({ ...input, graph: { ...input.graph, nodes: [] } })).toThrow('missing');
    expect(() => parseImport({ ...input, graph: { ...input.graph, schema_version: 2 } })).toThrow('schema');
    expect(() => parseImport({ ...input, graph: { ...input.graph, nodes: [...input.graph.nodes, input.graph.nodes[0]] } })).toThrow('unique');
  });
  it('preserves multiline annotations through import and duplication and rejects connections to text', () => {
    const graph = sampleGraph();
    const note = { ...graph.nodes[0], id: 'note', type: 'text' as const, label: 'Text', properties: { ...graph.nodes[0].properties, description: 'Traffic: 100M requests\nCache popular reads' } };
    graph.nodes.push(note);
    const imported = parseImport({ title: 'Annotated', graph });
    expect(imported.graph.nodes.at(-1)).toEqual(note);
    const copy = duplicateElements(imported.graph, new Set(['note']), () => 'note-copy');
    expect(copy.graph.nodes.at(-1)).toMatchObject({ type: 'text', properties: note.properties });
    expect(copy.graph.edges).toHaveLength(graph.edges.length);
    expect(removeElements(copy.graph, new Set(['note'])).nodes.some(node => node.id === 'note-copy')).toBe(true);
    expect(() => parseImport({ title: 'Invalid', graph: { ...graph, edges: [...graph.edges, { ...graph.edges[0], id: 'bad', target: 'note' }] } })).toThrow('Text annotations');
  });
});
