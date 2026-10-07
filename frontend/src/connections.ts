import { Position } from '@xyflow/react';
import type { ConnectionPort, DiagramEdge, DiagramNode } from './domain';

export const PORT_POSITIONS: Record<ConnectionPort, Position> = {
  top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left,
};

export function nodeHandles(node: DiagramNode) {
  return [
    { id: 'top', type: 'source' as const, position: Position.Top, x: node.width / 2 - 4, y: -4, width: 8, height: 8 },
    { id: 'right', type: 'source' as const, position: Position.Right, x: node.width - 4, y: node.height / 2 - 4, width: 8, height: 8 },
    { id: 'bottom', type: 'source' as const, position: Position.Bottom, x: node.width / 2 - 4, y: node.height - 4, width: 8, height: 8 },
    { id: 'left', type: 'source' as const, position: Position.Left, x: -4, y: node.height / 2 - 4, width: 8, height: 8 },
  ];
}

const endpoints = (edge: DiagramEdge) => [JSON.stringify([edge.source, edge.source_port ?? 'right']), JSON.stringify([edge.target, edge.target_port ?? 'left'])];

/** Separate parallel and reverse connections that share the same two attachment points. */
export function connectionLanes(edges: DiagramEdge[]): Map<string, { offset: number; orientation: number }> {
  const groups = new Map<string, DiagramEdge[]>();
  for (const edge of edges) {
    const key = JSON.stringify(endpoints(edge).sort());
    const group = groups.get(key) ?? [];
    group.push(edge); groups.set(key, group);
  }
  const lanes = new Map<string, { offset: number; orientation: number }>();
  for (const group of groups.values()) group.forEach((edge, index) => {
    const [source, target] = endpoints(edge);
    lanes.set(edge.id, { offset: (index - (group.length - 1) / 2) * 56, orientation: source <= target ? 1 : -1 });
  });
  return lanes;
}

type CurveInput = {
  sourceX: number; sourceY: number; targetX: number; targetY: number;
  sourcePosition: Position; targetPosition: Position; offset: number; orientation: number;
};

/** Cubic paths bow away from one another; the normal is stable for reversed endpoints. */
export function parallelCurve(input: CurveInput): { path: string; labelX: number; labelY: number } {
  const { sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, offset, orientation } = input;
  const length = Math.hypot(tx - sx, ty - sy) || 1;
  const nx = -(ty - sy) / length * orientation; const ny = (tx - sx) / length * orientation;
  const distance = Math.max(40, Math.min(160, length / 3));
  const shift = (position: Position) => ({
    x: position === Position.Right ? distance : position === Position.Left ? -distance : 0,
    y: position === Position.Bottom ? distance : position === Position.Top ? -distance : 0,
  });
  const from = shift(input.sourcePosition); const to = shift(input.targetPosition);
  const c1x = sx + from.x + nx * offset; const c1y = sy + from.y + ny * offset;
  const c2x = tx + to.x + nx * offset; const c2y = ty + to.y + ny * offset;
  return {
    path: `M ${sx},${sy} C ${c1x},${c1y} ${c2x},${c2y} ${tx},${ty}`,
    labelX: (sx + 3 * c1x + 3 * c2x + tx) / 8,
    labelY: (sy + 3 * c1y + 3 * c2y + ty) / 8,
  };
}
