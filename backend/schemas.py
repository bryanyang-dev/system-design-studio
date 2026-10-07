"""Renderer-independent diagram contract; no canvas-library objects in storage."""

import math
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


NodeType = Literal[
    "client", "cdn", "load_balancer", "gateway", "service", "worker",
    "database", "document_database", "cache", "queue", "stream",
    "storage", "external", "generic",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Point(StrictModel):
    x: float
    y: float

    @field_validator("x", "y")
    @classmethod
    def finite_coordinate(cls, value: float) -> float:
        if not math.isfinite(value) or abs(value) > 1_000_000:
            raise ValueError("Coordinates must be finite and within canvas limits")
        return value


class NodeProperties(StrictModel):
    description: str = Field(default="", max_length=5000)
    technology: str = Field(default="", max_length=200)
    region: str = Field(default="", max_length=200)
    replicas: Optional[int] = Field(default=None, ge=1, le=1_000_000)


class DiagramNode(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    type: NodeType
    label: str = Field(min_length=1, max_length=200)
    position: Point
    width: float = Field(default=200, ge=160, le=1000, allow_inf_nan=False)
    height: float = Field(default=104, ge=88, le=1000, allow_inf_nan=False)
    properties: NodeProperties = Field(default_factory=NodeProperties)


class DiagramEdge(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    source: str = Field(min_length=1, max_length=100)
    target: str = Field(min_length=1, max_length=100)
    label: str = Field(default="", max_length=200)
    protocol: str = Field(default="", max_length=100)
    interaction: Literal["synchronous", "asynchronous"] = "synchronous"


class Graph(StrictModel):
    schema_version: Literal[1] = 1
    nodes: List[DiagramNode] = Field(default_factory=list, max_length=500)
    edges: List[DiagramEdge] = Field(default_factory=list, max_length=1500)

    @model_validator(mode="after")
    def valid_references(self) -> "Graph":
        node_ids = [node.id for node in self.nodes]
        edge_ids = [edge.id for edge in self.edges]
        if len(set(node_ids)) != len(node_ids):
            raise ValueError("Node IDs must be unique")
        if len(set(edge_ids)) != len(edge_ids):
            raise ValueError("Connection IDs must be unique")
        if set(node_ids) & set(edge_ids):
            raise ValueError("Nodes and connections must have distinct IDs")
        for edge in self.edges:
            if edge.source not in node_ids or edge.target not in node_ids:
                raise ValueError("Every connection must reference existing nodes")
        return self


class Context(StrictModel):
    brief: str = Field(default="", max_length=10000)
    requirements: str = Field(default="", max_length=10000)
    constraints: str = Field(default="", max_length=10000)


class DiagramInput(StrictModel):
    title: str = Field(default="Untitled diagram", min_length=1, max_length=200)
    graph: Graph = Field(default_factory=Graph)
    context: Context = Field(default_factory=Context)

    @field_validator("title")
    @classmethod
    def meaningful_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Title cannot be blank")
        return value.strip()


class DiagramSave(DiagramInput):
    expected_version: int = Field(ge=1)


class RestoreInput(StrictModel):
    expected_version: int = Field(ge=1)
    version: int = Field(ge=1)

