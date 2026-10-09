# AI System Design Studio — Product and Technical Specification

Status: proposed v1 specification  
Date: October 6, 2026  
Required stack: Python backend  
Working product name: System Design Studio

Implementation update: the local editor includes persistence, ChatGPT-plan diagram assistance, and text-based interview practice with persisted sessions, timing, hints/coaching, and feedback. Diagram-user authentication and background workers remain deferred. See `README.md` for the implemented slice and setup instructions; the sections below describe the broader product roadmap.

## 1. Product summary

A web application for drawing software system architectures, improving them with a context-aware AI assistant, and practicing system design interviews.

Each diagram owns its design context: the problem being solved, functional requirements, workload, constraints, assumptions, and decisions. The assistant uses that context together with the actual components and connections on the canvas. Users can ask it to generate a design, edit selected components, review tradeoffs, or act as an interviewer who introduces new constraints and probes their reasoning.

The core product promise is: **draw the system, explain its purpose, and reason about it in the same workspace.** AI output remains editable, attributable, and reversible.

## 2. Audience and goals

Primary users:

- Engineers practicing system design interviews.
- Engineers exploring architectures before implementation.
- Technical leads documenting design decisions and alternatives.

Goals:

- Make manual diagram creation fast enough to use without AI.
- Generate and edit structured diagrams from natural-language requests.
- Produce recommendations grounded in explicit requirements and assumptions.
- Help users practice requirements discovery, capacity estimation, failure analysis, and architectural tradeoffs.
- Preserve the reasoning behind a design as it evolves.

Initial scope assumes a desktop-first browser app for individual users. Mobile supports viewing; full touch editing is deferred.

Non-goals for v1: production infrastructure deployment, executable performance simulation, automatic architecture discovery from repositories, cloud cost guarantees, real-time multiplayer editing, and formal verification. The app is a reasoning and documentation tool; capacity calculations are estimates with visible inputs.

## 3. Main experience

The workspace has four areas:

1. **Canvas:** pan, zoom, select, draw connections, and arrange components.
2. **Component palette:** searchable building blocks and saved templates.
3. **Inspector/context panel:** properties of selected items or the diagram's design brief.
4. **AI panel:** conversation, suggestions, proposed changes, and interview controls.

The header shows diagram title, save status, undo/redo, version history, export, and mode selection. Context and inspector can share a collapsible panel to leave room for the canvas. Selecting an AI finding highlights the relevant diagram elements.

Modes:

| Mode | Assistant behavior | Diagram behavior |
| --- | --- | --- |
| Design | Generate, explain, and edit on request | User reviews AI changes before applying |
| Review | Identify gaps and compare improvements | Findings reference existing components; changes require a separate proposal |
| Interview | Ask focused questions and follow-ups | User edits; AI edits only after an explicit request for a solution or coaching |

### Primary journeys

**Start a design:** create a diagram → enter a short brief → optionally add structured requirements → draw manually or request a generated starting point → review the proposed diagram → apply → refine.

**Edit a design:** select a service and request “Put a queue between the API and worker” → see added/changed/deleted elements and a rationale → apply as one undoable operation.

**Review a design:** request a review focused on scale, reliability, latency, cost, security, or simplicity → inspect findings with assumptions and tradeoffs → choose a finding → request and review its proposed change.

**Practice an interview:** choose a scenario or current diagram → select difficulty and duration → discuss requirements → draw and explain the design → respond to follow-up constraints → finish with evidence-based feedback.

## 4. Functional requirements

### 4.1 Diagram editor

Required in v1:

- Create, rename, duplicate, archive, and delete diagrams.
- Add, move, resize, label, duplicate, and delete components.
- Draw directed connections with labels and optional protocol/interaction metadata.
- Support groups for regions, networks, clusters, or logical boundaries.
- Pan/zoom, fit to screen, multi-select, keyboard shortcuts, snapping, and alignment.
- Undo/redo manual edits and applied AI changes; an AI change is a single undo step.
- Autosave with visible pending/saved/error states and recovery of an unsaved local draft.
- Explicit auto-layout command; preserve existing positions during routine AI edits.
- Export PNG and portable JSON; import the app's validated JSON format.
- Restore a previous saved version without losing later versions.

Initial components: client/browser/mobile app, CDN, load balancer, API gateway, service, worker, relational database, document database, cache, queue, event stream, object storage, external service, and generic component.

Component properties: label, type, description, technology (optional), replicas, region, and typed capacity/configuration fields where applicable. Unknown values remain unknown rather than defaulting to invented numbers.

Connection properties: source/target ports on any side of a component, one-way or two-way direction, label, protocol, synchronous/asynchronous interaction, payload description, and optional estimated throughput. Each node and port supports multiple connections; parallel connections should remain visually distinguishable. Connections describe interactions; they do not implicitly prove reliability or delivery guarantees.

Deleting a component removes its attached connections in the same transaction. Group membership must be acyclic. JSON imports have size limits, schema validation, and a preview before replacing or creating a diagram.

### 4.2 Per-diagram context

Context is both a freeform brief and structured fields:

| Field | Examples |
| --- | --- |
| Problem and users | Design a photo-sharing app for consumers |
| Functional requirements | Upload photos, follow users, read a feed |
| Workload | Active users, requests/day, peak requests/second, read/write ratio |
| Data | Object size, retention, growth, sensitive data categories |
| Quality targets | p95 latency, availability target, consistency needs |
| Constraints | Budget, team size, geographic scope, preferred technologies |
| Assumptions | Peak traffic is 5× average; marked unconfirmed |
| Decisions and open questions | Why use fan-out on write; handling celebrity accounts unresolved |

Requirements have stable IDs so findings and decisions can reference them. Numeric values include units and time windows. Distinguish user-confirmed facts, AI-proposed assumptions, and unresolved questions.

Users may start with only a short brief. The assistant asks for missing information when it materially changes the answer, or makes clearly labeled assumptions when asked to proceed. AI-proposed context changes require review. Context edits create a new version and mark earlier analyses as potentially stale.

Hypothetical interview constraints belong to the session unless the user explicitly promotes them to the diagram's base context.

### 4.3 AI generation and editing

Requests can target the whole diagram, a selection, or specific named components. Selection limits permitted mutations by default; the assistant must disclose when a requested change needs to affect connected components beyond the selection.

Every proposed change includes:

- The interpreted request and relevant requirements.
- A structured patch against a specific diagram version.
- Added, changed, and removed elements, shown visually and in a readable list.
- A short rationale, assumptions, and important tradeoffs.
- Apply, dismiss, and revise controls.

Newly generated diagrams also use proposals. No model response directly changes the saved diagram. Applying a proposal validates and commits the entire patch atomically. A failed patch applies nothing. Applying again with the same idempotency key creates no duplicate elements.

For existing diagrams, preserve component IDs, unrelated labels/configuration, and manual positions. Layout new components near related components. Full rearrangement requires an explicit layout request.

If the user edits the diagram while AI is working, the returned proposal retains its original base version. If that version is no longer current, disable Apply and offer regeneration against the latest version. v1 does not silently merge stale AI changes.

### 4.4 Design review and optimizations

A review returns findings, not automatic mutations. Each finding has:

- Category and priority; distinguish requirement violations from optional improvements.
- Referenced component, connection, and requirement IDs.
- Evidence visible in the graph or context.
- Expected benefit and associated cost/complexity/tradeoffs.
- Explicit assumptions and missing evidence.
- Suggested next step or a question needed to evaluate it.

Review categories: bottlenecks, failure domains, consistency, scalability, latency, cost, security boundaries, operational complexity, and requirement coverage.

Example: “The write path has one database instance. If writes must remain available during an instance failure, describe failover or add a replication strategy.” The assistant must not assert that replicas increase write capacity or that a cache fixes a workload without explaining the mechanism and constraints.

Comparisons evaluate alternatives against the user's objectives. The app does not equate more infrastructure with a better design. When evidence is insufficient, it explains uncertainty and asks a targeted question.

### 4.5 Interview practice

Setup: current diagram or a scenario template, difficulty (introductory/intermediate/advanced), duration (15/30/45/60 minutes or untimed), and focus areas. Sessions can begin with a blank canvas for realistic requirements discovery.

Interview phases: requirements clarification → workload estimation → high-level design → selected deep dives → changing constraints → recap. Phases guide the session without forcing a rigid script.

The assistant:

- Asks one main question at a time and waits for the response.
- Uses the current graph and user's explanations to choose follow-ups.
- Probes mechanisms and tradeoffs, rather than accepting component names as complete answers.
- Introduces one new constraint at a time and states its units/time window.
- Supports pause, resume, skip question, hint, coaching, and end session.
- Keeps solutions hidden until requested; records hint/coaching use for the final assessment.
- Can continue discussing a selected component without editing it.

For “What if we need to scale to 100M requests?”, first clarify whether this means per day, per second, or another period. With a confirmed daily target, average throughput is about 1,157 requests/second; a stated 5× peak assumption produces about 5,787 requests/second. Ask the user to identify the limiting path and justify capacity assumptions before suggesting sharding or other changes.

The timer is based on persisted server timestamps and accumulated paused duration, so reloads do not reset it. Ending the timer prompts a wrap-up; the user can extend or finish. A session stores its initial graph/context version, subsequent diagram versions used in questioning, transcript, phase, introduced constraints, and hint usage.

Final feedback evaluates requirements discovery, quantitative reasoning, architecture fit, tradeoffs, reliability, and communication. Use a 1–5 rubric with examples from the transcript/diagram and “not observed” where appropriate. Separate unaided reasoning from coached progress. Provide strengths, concrete gaps, and two or three next practice actions. Scores are learning feedback, not hiring predictions.

## 5. MVP and subsequent scope

**MVP must include:** authenticated private diagrams, editor and core palette, context editing, autosave and revisions, AI generation/edit proposals, focused design review, text-based interview sessions with feedback, JSON import/export, and PNG export.

**Next release candidates:** scenario library, saved component templates, version comparison, SVG export, read-only sharing, richer capacity worksheets, and interview progress tracking.

**Later:** collaborative editing, organization workspaces, voice interviews, repository/infrastructure imports, cloud-specific component catalogs, and reusable organization design policies.

Do not add collaboration synchronization or vector search to the MVP unless implementation evidence establishes a need.

## 6. Recommended technical architecture

These are proposed choices; no dependencies have been installed.

| Layer | Proposed choice | Reason |
| --- | --- | --- |
| Frontend | React + TypeScript with Vite | Interactive browser editor; no initial need for server-rendered pages |
| Diagram canvas | React Flow with custom components | Fits a graph of typed nodes/connections; supports custom nodes and save/restore workflows |
| Client state | Zustand for editor state; TanStack Query for server state | Separate transient canvas interactions from persisted data and requests |
| Backend | Python + FastAPI + Pydantic | Typed request/response and patch validation; asynchronous AI orchestration |
| Persistence | PostgreSQL; SQLAlchemy and Alembic | Ownership/metadata in relational tables; graph/context documents in JSONB |
| Background work | Separate Python worker with a PostgreSQL-backed job table initially | Durable AI requests and cancellation without introducing an additional queue service |
| AI integration | Provider adapter with structured output and streaming capabilities | Keep model choice replaceable; choose provider/model through product-specific evaluation |
| Authentication | Managed OIDC provider selected before launch | Avoid implementing password storage and account recovery |
| Delivery | Containerized API and worker; static frontend; managed PostgreSQL | Small, independently deployable components |

React Flow's documented [custom nodes](https://reactflow.dev/learn/customization/custom-nodes) and [save/restore approach](https://reactflow.dev/examples/interaction/save-and-restore) support the editor choice. PostgreSQL's [JSON types](https://www.postgresql.org/docs/current/datatype-json.html) support document storage alongside relational metadata. FastAPI also supports [WebSockets](https://fastapi.tiangolo.com/advanced/websockets/) if later bidirectional features require them. The initial AI event feed can use SSE rather than requiring WebSockets.

Keep a domain graph format independent of React Flow. A frontend adapter maps domain nodes/edges into renderer objects. Rendering-library internals must not become the persisted contract.

Request flow:

```text
Browser ──authenticated REST requests──> Python API ──> PostgreSQL
                                            │
                                       durable AI job
                                            │
                                       Python worker ──> Model provider
                                            │
                                   validated proposal/events
                                            │
Browser <──resumable event feed / polling────┘
```

Polling remains a fallback for proxies or clients where event streaming fails. The worker persists results before reporting completion. Jobs use leases/heartbeats and bounded retries so worker restarts do not strand work.

## 7. Domain model and persistence

| Entity | Main fields |
| --- | --- |
| User | ID, identity-provider subject, preferences |
| Diagram | ID, owner ID, title, current version, archive state, timestamps |
| DiagramVersion | Diagram ID, version number, schema version, graph JSONB, context JSONB, actor/source, timestamp |
| Conversation | ID, diagram ID, mode |
| Message | Conversation ID, role, content, referenced version, timestamp |
| AIRequest | ID, owner/diagram ID, intent, base version, selection IDs, status, idempotency key, usage metadata |
| Proposal | Request ID, base version, validated operations, explanation, lifecycle state |
| Review | Request ID, analyzed version, findings |
| InterviewSession | Diagram ID, initial version, settings, phase/state, hypothetical context, timing, feedback |
| InterviewTurn | Session ID, question/answer, observed version, phase, hint state |

Versions are immutable, contain both graph and context, and use a monotonically increasing version per diagram. Autosave batches short bursts of edits; dragging must not create one server version per pixel. Undo/restore writes a new version. Viewport and panel preferences are user view state and do not invalidate architecture reviews.

Graph document:

```json
{
  "schema_version": 1,
  "nodes": [
    {
      "id": "service-api",
      "type": "service",
      "label": "API Service",
      "position": {"x": 240, "y": 160},
      "parent_id": null,
      "properties": {"replicas": 3, "description": "Handles feed reads"}
    }
  ],
  "edges": [],
  "annotations": []
}
```

Schema migrations preserve IDs and provenance. Context field schemas also carry a version. AI conversations are scoped to a diagram; information from other diagrams is never included automatically.

## 8. API outline

All diagram/session endpoints enforce ownership, not merely possession of an ID.

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/diagrams` | Create a diagram |
| `GET /v1/diagrams` | List owned diagrams with pagination |
| `GET /v1/diagrams/{id}` | Retrieve graph, context, and current version |
| `PATCH /v1/diagrams/{id}` | Save validated graph/context edits with expected version |
| `DELETE /v1/diagrams/{id}` | Delete diagram and associated records under retention policy |
| `GET /v1/diagrams/{id}/versions` | List revisions |
| `POST /v1/diagrams/{id}/restore` | Restore a revision as a new current version |
| `POST /v1/diagrams/{id}/ai-requests` | Generate/edit/review/explain request; returns job ID |
| `GET /v1/ai-requests/{id}` | Retrieve status and result |
| `GET /v1/ai-requests/{id}/events` | Stream persisted progress/results with resume cursor |
| `POST /v1/ai-requests/{id}/cancel` | Request cancellation |
| `POST /v1/proposals/{id}/apply` | Atomically apply a validated proposal at its base version |
| `POST /v1/interview-sessions` | Start a session |
| `POST /v1/interview-sessions/{id}/turns` | Submit answer plus observed diagram version |
| `PATCH /v1/interview-sessions/{id}` | Pause/resume/update timing |
| `POST /v1/interview-sessions/{id}/hints` | Request a hint or coaching |
| `POST /v1/interview-sessions/{id}/finish` | End and generate feedback |

Mutations use expected-version checks; conflicts return `409` with the current version. Long-running requests return `202`. Request creation and proposal application support idempotency keys. Error responses distinguish validation errors, conflicts, quota exhaustion, provider failure, and authorization failures.

## 9. AI contract and processing

Inputs: explicit user request, intent/mode, versioned graph and context, selection, relevant conversation turns, and allowed component/operation schemas. Always include confirmed requirements and unresolved assumptions; summarize older conversation separately. Detect excessive input size and ask for a narrower scope instead of silently dropping relevant context.

Pipeline:

1. Authorize the request and capture an immutable base version.
2. Classify intent and identify material ambiguity; ask a question when necessary.
3. Construct model input with user content clearly separated from application instructions.
4. Request schema-constrained output: proposal, findings, explanation, or interview turn.
5. Validate output on the server. Retry malformed output at most once, then return a useful failure.
6. Persist and display the result; apply only on user acceptance and a matching current version.

Allowlisted patch operations: add/update/remove node, add/update/remove edge, add/update/remove annotation, update group membership, and propose context changes. Do not accept arbitrary code or a generic unrestricted JSON patch.

Validation covers schema/type/size limits, unique IDs, existing references, valid edge endpoints, group cycles, selection scope, and atomic consistency. Graph cycles may be legitimate and are not universally prohibited. Flag meaningful architecture concerns as findings rather than treating them as structural errors.

Deterministic checks handle arithmetic and graph integrity. Capacity calculations show their formulas, units, inputs, and peak factors. The model provides interpretations and tradeoffs; it cannot verify real throughput from a diagram alone.

Example proposal envelope:

```json
{
  "base_version": 12,
  "summary": "Decouple notification delivery from the API",
  "assumptions": ["Notification delivery may be eventually consistent"],
  "operations": [
    {"op": "add_node", "node": {"id": "notification-queue", "type": "queue", "label": "Notification Queue", "position": {"x": 480, "y": 240}, "properties": {}}}
  ],
  "tradeoffs": ["Requires retry handling and duplicate-safe consumers"]
}
```

The example illustrates the contract; a complete decoupling proposal would also change the relevant connections and consumers.

## 10. Reliability, privacy, and operational requirements

- Private by default; authorize database reads, event subscriptions, jobs, and exports.
- Send model providers only data needed for the request. Explain provider processing in the product before first AI use; finalize provider retention terms before launch.
- Do not log raw diagrams/prompts by default. Log request IDs, latency, token usage, result status, and validation failures; redact sensitive content from diagnostics.
- Model API keys stay server-side. No shell execution, arbitrary network tools, or credentials are exposed to model output.
- Treat diagram text as untrusted input; sanitize rendered text and validate imported documents.
- Limit prompt size, graph size, request rate, concurrent jobs, and per-user model spend. Make quota failures understandable.
- Handle provider timeouts with visible retry/cancel controls and preserve the editor draft.
- Browser drafts are scoped to the signed-in account and removed on sign-out. On reconnect, compare versions and offer recovery instead of silently overwriting server work.
- Define deletion/backup retention before launch; deletion removes live records and provider-held artifacts where supported, while backups expire on the published schedule.
- Use PostgreSQL backups and verify restoration. Worker retries must not automatically apply proposals or duplicate interview turns.

Proposed performance targets, to validate during implementation:

- Smooth pan/zoom and editing at 200 components and 400 connections on a representative modern laptop.
- Autosave begins within one second after an edit burst and ordinarily persists within two seconds on a healthy connection.
- AI request acknowledgement within one second; visible progress within two seconds. Target complete proposals within 30 seconds for typical requests; communicate slower cases.
- Editor controls remain usable while AI jobs run; cancellation prevents application but may not immediately stop provider billing.

Accessibility: keyboard-accessible palette, forms, AI controls, selection and movement; labeled controls; visible focus; sufficient contrast; change previews that use labels in addition to color; a list view for inspecting components/connections. Assess complete canvas accessibility during the editor prototype.

## 11. Acceptance criteria and validation

| Area | Required evidence |
| --- | --- |
| Manual editor | Create a system with groups and labeled edges; reload/export/import preserves graph semantics and layout |
| Context isolation | Two diagrams with conflicting requirements receive responses grounded in their respective contexts |
| AI generation | A short brief produces a valid editable proposal; unknown workload values appear as assumptions/questions |
| Scoped editing | Adding a queue preserves unrelated IDs, labels, properties, and positions |
| Application safety | Invalid references fail without partial changes; stale proposals cannot apply; duplicate apply is idempotent |
| Recovery | Undo reverses the entire AI patch; failed saves preserve a recoverable draft; restore creates a new revision |
| Review quality | Findings reference actual graph/context evidence and expose missing capacity inputs |
| Interview behavior | One main question at a time; ambiguous “100M requests” is clarified; no unsolicited solution or diagram mutation |
| Interview feedback | Claims cite observed turns/versions; unobserved skills are marked; hints are recorded |
| Access control | Another account cannot access diagrams, AI jobs, event streams, revisions, or sessions |

Tests: unit tests for domain validation, patch application, arithmetic and timer state; integration tests for authorization, version conflicts, durable job recovery and idempotency; browser tests for the primary journeys. Use malformed imports and adversarial diagram text in validation cases.

Maintain a reviewed evaluation set covering simple CRUD services, read-heavy feeds, write-heavy ingestion, queues/retries, regional failures, ambiguous scale, and constrained budgets. Measure schema validity, requirement adherence, preservation of unrelated content, recommendation grounding, and interview answer leakage. Compare model/prompt revisions against the same cases before release; do not choose the model solely on fluent output.

## 12. Delivery sequence

1. **Editor foundation:** domain schema, canvas prototype, context forms, persistence, revisions, import/export. Exit when a diagram round-trips and conflicted saves are recoverable.
2. **AI change workflow:** durable jobs, provider adapter, validated proposals, previews, apply/undo. Exit when changes preserve unaffected content and cannot apply stale or invalid patches.
3. **Design review:** findings with graph/requirement references, deterministic estimates, proposal conversion. Exit when benchmark reviews are grounded and explicit about assumptions.
4. **Interview mode:** session state, adaptive questioning, timing, hints, and feedback. Exit when realistic practice sessions work across refreshes and do not leak solutions by default.
5. **Launch hardening:** authorization tests, accessibility review, quotas, recovery, backups, evaluation regression checks, and product analytics.

## 13. Success measures and decisions to finalize

Track time to first useful diagram, proposal acceptance and subsequent undo rates, manual correction effort, repeated weekly use, completed interview sessions, and user-rated feedback usefulness. Track provider cost and latency per completed workflow. Set numeric business targets after an initial pilot; acceptance rate alone is not proof of recommendation quality.

Decisions before implementation: identity provider and deployment target; model/provider after a focused evaluation; initial scenario templates; maximum diagram size and usage quotas; retention policy; and whether the first audience is interview preparation or professional architecture work. This spec assumes both use the same core editor, with interview preparation shaping the first templates.

The foundational decisions are a renderer-independent graph, versioned context, reviewable AI patches, and distinct interviewer behavior. These should be established before adding collaboration, elaborate component catalogs, or infrastructure integrations.
