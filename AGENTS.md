# Repository development guidance

Applies to all work in this repository. Follow explicit user instructions and any more specific instructions in subdirectories.

## General approach

- Inspect existing code and conventions before making changes. Prefer small,
  cohesive changes; avoid unrelated refactors and speculative abstractions.
- Preserve user data and unrelated working-tree changes. Use disposable records
  for verification and do not alter existing diagrams to test a feature.
- Keep credentials out of source, logs, examples, and exports. Configure secrets
  through environment variables and document names without real values.
- Update relevant documentation when behavior, the graph contract, or setup changes.
- Prefer explicit blocks over single-line control-flow statements. Use braces and line breaks for if, for, while, and similar constructs when they contain executable statements. Optimize for readability over terseness.

## React and TypeScript

- Scope context providers to the smallest common ancestor of their consumers.
  Canvas-only contexts belong around React Flow rather than the entire studio.
  `ReactFlowProvider` must remain above `Studio`, which calls `useReactFlow`.

- Keep persisted diagram data separate from React Flow renderer state. Persist
  domain nodes and edges, not selection, measured bounds, DOM references, or
  React Flow objects.

- Validate external data at runtime even when TypeScript types exist.

- Keep canvas editing compatible with undo and autosave. Treat a continuous
  drag/resize/edit interaction as one undoable action and do not persist every
  pointer movement.

- Preserve keyboard navigation and ensure canvas shortcuts do not interfere
  with text editing.

## Python backend

- Validate graph input through Pydantic schemas. Enforce field limits, finite
  coordinates, unique IDs, and valid graph references server-side.

- Keep route handlers focused on HTTP behavior. Extract shared or substantial
  domain/persistence logic rather than introducing architectural layers
  preemptively.

- The backend currently uses synchronous SQLAlchemy. Do not perform blocking
  database or network operations from async handlers.

- Scope database sessions to requests. Diagram updates and their revisions
  must commit atomically.

- Preserve optimistic concurrency. Updates, deletes, and restores must verify
  the expected version and must not silently overwrite newer edits.

- Revisions are immutable. Restoring creates a new version rather than
  rewriting history. Do not create revisions for semantically unchanged saves.

- Maintain backward compatibility for stored graph data using additive
  defaults where appropriate. Use explicit migrations for relational schema
  changes.

- Preserve loopback binding, origin checks, and request-size limits unless
  explicitly changing the deployment model.

## Verification

- Run checks appropriate to the change:
  - Frontend types and production build: `npm run build --prefix frontend`
  - Frontend behavior tests: `npm test --prefix frontend`
  - Backend tests: `.venv/bin/python -m pytest backend/tests -q`
  - Whitespace/diff check: `git diff --check`
- Add meaningful tests for new domain behavior, validation, compatibility, and failure
  paths. Do not add tests that merely mirror implementation or trivial visual styling.
- For canvas changes, verify relevant editing, selection, movement, undo, and persistence
  behavior in the browser. Check narrow layouts when the change affects layout.
- SQLite tests do not establish PostgreSQL-specific behavior. Use the existing opt-in
  PostgreSQL smoke test when relevant and when the database is already available.
- Report which checks passed, skipped, or could not run. Do not claim unperformed validation.
