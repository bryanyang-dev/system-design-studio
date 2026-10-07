import { describe, expect, it } from 'vitest';
import { graphChanges } from './ChatGPTDialog';
import { sampleGraph } from './domain';

describe('AI proposal review', () => {
  it('shows nested text, properties, position and edge-direction changes before applying', () => {
    const before = sampleGraph();
    before.nodes[0].type = 'text';
    before.nodes[0].properties.description = 'Original note';
    before.edges = before.edges.filter(edge => edge.source !== before.nodes[0].id);
    const after = structuredClone(before);
    after.nodes[0].properties.description = 'Updated note';
    after.nodes[1].position.x += 80;
    after.nodes[1].properties.replicas = 3;
    after.edges[0].direction = 'two_way';
    const changes = graphChanges(before, after);
    expect(changes).toHaveLength(3);
    expect(changes.join('\n')).toContain('Original note');
    expect(changes.join('\n')).toContain('Updated note');
    expect(changes.join('\n')).toContain('replicas 3');
    expect(changes.join('\n')).toContain('↔');
    expect(graphChanges(before, structuredClone(before))).toEqual([]);
  });

  it('shows additions and removals and ignores JSON object key order', () => {
    const before = sampleGraph();
    const after = structuredClone(before);
    after.nodes.pop();
    after.edges.pop();
    after.nodes.push({ ...before.nodes[0], id: 'new', label: 'New client' });
    expect(graphChanges(before, after).filter(change => change.startsWith('Remove'))).toHaveLength(2);
    expect(graphChanges(before, after).some(change => change.includes('Add client: New client'))).toBe(true);
    const reordered = { ...before, nodes: before.nodes.map(({ position, ...node }) => ({ position: { y: position.y, x: position.x }, ...node })) };
    expect(graphChanges(before, reordered)).toEqual([]);
  });
});
