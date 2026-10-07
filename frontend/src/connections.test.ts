import { Position } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { connectionLanes, nodeHandles, parallelCurve } from './connections';
import { duplicateElements, parseImport, sampleGraph } from './domain';
import type { DiagramEdge } from './domain';

describe('multi-connection diagrams', () => {
  it('keeps distinct lanes for repeated and reverse connections on shared ports', () => {
    const base = sampleGraph().edges[1];
    const forward = { ...base, id: 'forward' };
    const repeated = { ...base, id: 'repeated', direction: 'two_way' as const };
    const reverse = { ...base, id: 'reverse', source: base.target, target: base.source, source_port: base.target_port, target_port: base.source_port };
    const otherPort = { ...base, id: 'other-port', source_port: 'bottom' as const };
    const lanes = connectionLanes([forward, repeated, reverse, otherPort]);
    expect([lanes.get('forward')?.offset, lanes.get('repeated')?.offset, lanes.get('reverse')?.offset]).toEqual([-56, 0, 56]);
    expect(lanes.get('reverse')?.orientation).toBe(-lanes.get('forward')!.orientation);
    expect(lanes.get('other-port')?.offset).toBe(0);
    const geometry = { sourceX: 0, sourceY: 0, targetX: 300, targetY: 0, sourcePosition: Position.Right, targetPosition: Position.Left };
    const first = parallelCurve({ ...geometry, ...lanes.get('forward')! });
    const last = parallelCurve({ ...geometry, sourceX: 300, targetX: 0, sourcePosition: Position.Left, targetPosition: Position.Right, ...lanes.get('reverse')! });
    expect(first.labelY).toBeLessThan(0);
    expect(last.labelY).toBeGreaterThan(0);
    expect(first.path).not.toBe(last.path);
  });

  it('derives four reusable handles and moves them when a node is resized', () => {
    const node = sampleGraph().nodes[0];
    const handles = nodeHandles(node);
    expect(handles.map(handle => handle.id)).toEqual(['top', 'right', 'bottom', 'left']);
    expect(handles.every(handle => handle.type === 'source')).toBe(true);
    const resized = nodeHandles({ ...node, width: 300, height: 160 });
    expect(resized.find(handle => handle.id === 'right')).toMatchObject({ x: 296, y: 76 });
    expect(resized.find(handle => handle.id === 'bottom')).toMatchObject({ x: 146, y: 156 });
  });

  it('imports legacy edges with defaults and preserves two-way ports through export and duplication', () => {
    const graph = sampleGraph();
    const legacy = { ...graph, edges: graph.edges.map(({ direction: _direction, source_port: _source, target_port: _target, ...edge }) => edge) };
    const imported = parseImport({ title: 'Legacy', graph: legacy });
    expect(imported.graph.edges[0]).toMatchObject({ direction: 'one_way', source_port: 'right', target_port: 'left' });
    const twoWay: DiagramEdge = { ...graph.edges[0], direction: 'two_way', source_port: 'bottom', target_port: 'top' };
    graph.edges[0] = twoWay;
    expect(parseImport(JSON.parse(JSON.stringify({ title: 'New', graph }))).graph.edges[0]).toEqual(twoWay);
    const copy = duplicateElements(graph, new Set(['web', 'api']));
    expect(copy.graph.edges.at(-1)).toMatchObject({ direction: 'two_way', source_port: 'bottom', target_port: 'top' });
    expect(() => parseImport({ title: 'Bad', graph: { ...graph, edges: [{ ...twoWay, direction: 'unknown' }] } })).toThrow('direction');
    expect(() => parseImport({ title: 'Bad', graph: { ...graph, edges: [{ ...twoWay, target_port: 'unknown' }] } })).toThrow('side');
  });
});
