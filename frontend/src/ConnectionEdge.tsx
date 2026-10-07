import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { Edge, EdgeProps } from '@xyflow/react';
import { parallelCurve } from './connections';

export type ConnectionFlowEdge = Edge<{ offset: number; orientation: number }, 'connection'>;

export function ConnectionEdge(props: EdgeProps<ConnectionFlowEdge>) {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  let path: string; let labelX: number; let labelY: number;
  if (props.data?.offset) {
    ({ path, labelX, labelY } = parallelCurve({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, ...props.data }));
  } else {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  return <BaseEdge id={props.id} path={path} markerStart={props.markerStart} markerEnd={props.markerEnd}
    style={props.style} interactionWidth={16} label={props.label} labelX={labelX} labelY={labelY}
    labelStyle={props.labelStyle} labelShowBg={props.labelShowBg} labelBgStyle={props.labelBgStyle}
    labelBgPadding={props.labelBgPadding} labelBgBorderRadius={props.labelBgBorderRadius} />;
}
