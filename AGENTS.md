# Repository development guidance

Applies to all work in this repository. Follow explicit user instructions and any more specific instructions in subdirectories.

## Dependency installation policy

- Never install, update, remove, download, enable, or activate a package,
  dependency, runtime, CLI tool, service, plugin, browser extension, model,
  or system component without explicit user approval.
- Before running any command that may install or download software, stop and
  show the user:
  1. The exact command.
  2. What it will install or change.
  3. Why it is required.
- Wait for an explicit approval message before running the command.
- Approval applies only to the commands displayed. It does not authorize
  additional packages, alternative installers, upgrades, or follow-up commands.
- This rule includes commands such as:
  - brew install, upgrade, or bundle
  - npm, pnpm, or yarn install, add, update, or dlx
  - npx or package-manager create commands
  - corepack downloads or activation
  - go get, go install, or go mod tidy when they download or change dependencies
  - curl or wget downloads
  - Docker image pulls
  - model downloads
  - operating-system installers
- If an installation attempt fails, do not try an alternative installation
  method. Report the failure and return control to the user.
- Read-only inspection and version checks are allowed without approval.
- Editing source files is not permission to install their dependencies.

## General approach

- Inspect existing code and conventions before making changes. Prefer small,
  cohesive changes; avoid unrelated refactors and speculative abstractions.
- Preserve user data and unrelated working-tree changes. Use disposable records
  for verification and do not alter existing diagrams to test a feature.
- Keep credentials out of source, logs, examples, and exports. Configure secrets
  through environment variables and document names without real values.
- Update relevant documentation when behavior, the graph contract, or setup changes.

## React and TypeScript

- Scope context providers to the smallest common ancestor of their consumers.
  Canvas-only contexts belong around React Flow, rather than the entire studio.
  Keep providers broader when consumers actually require that scope: for example,
  `ReactFlowProvider` must remain above `Studio`, which calls `useReactFlow`.
- Use props for local communication and context for values shared across a subtree.
  Keep transient UI state near its owner; avoid duplicating state that can be derived.
- Keep persisted diagram data separate from React Flow renderer state. Store domain
  nodes and edges, not selection, measured bounds, DOM references, or library objects.
- Update state immutably. Use functional updates when a change depends on previous
  state, and stable IDs for keys rather than array indexes.
- Use effects to synchronize with external systems, not to calculate derived values
  or replace event handlers. Include complete dependencies and clean up subscriptions,
  listeners, and timers. Prevent stale asynchronous results from overwriting newer state.
- Keep hooks unconditional and components focused. Extract components or hooks when
  they clarify responsibilities; avoid adding abstraction for its own sake.
- Type domain models, props, and API boundaries explicitly. Validate unknown input
  at runtime; a TypeScript assertion does not validate imported JSON or server data.
- Avoid speculative memoization. Stabilize callbacks or context values when profiling
  or a library integration shows a concrete need.
- Use accessible native controls, descriptive labels, and visible focus indicators.
  Preserve keyboard navigation and prevent canvas shortcuts from hijacking text editing.
- Keep editing, dragging, and resizing compatible with undo and autosave. Group a
  continuous interaction into one undoable action and avoid saving every pointer move.
- Render user text as text. Do not inject untrusted HTML into the page.

## Python backend

- Keep request validation in Pydantic schemas. Enforce field limits, finite coordinates,
  unique IDs, and valid graph references on the server, even when the client validates them.
- Keep route handlers focused on HTTP behavior. Extract domain or persistence helpers
  when logic becomes substantial or shared; avoid unnecessary architectural layers.
- Add useful type hints to new or changed functions. Use clear names and concise
  docstrings or comments that explain intent and non-obvious invariants.
- Match execution style to dependencies: synchronous SQLAlchemy operations belong in
  synchronous FastAPI handlers. Do not block an async handler with synchronous database
  or network work; use supported async clients or appropriate thread offloading.
- Scope database sessions to requests and close them reliably. Use transactions so a
  diagram update and its revision are committed atomically; roll back failed operations.
- Preserve optimistic concurrency checks. Updates, deletes, and restores must validate
  the expected version. A stale client must not silently overwrite newer edits.
- Keep revisions immutable. Restoring creates a new version; it does not rewrite history.
  Avoid generating a revision for a semantically unchanged save.
- Use SQLAlchemy expressions or parameterized queries. Never interpolate user input into SQL.
- Return meaningful HTTP statuses and safe error messages. Catch only exceptions that can
  be handled usefully; do not conceal programming errors with broad exception handling.
- Evolve stored graph schemas deliberately. Supply additive defaults for older records
  and imports; use explicit migrations for deployed relational schema changes.
- Preserve the current loopback binding, origin checks, and request-size limits. Do not
  expose this local edition publicly or add AI, authentication, or workers without scope.

## Verification

- Run checks appropriate to the change using already installed tools:
  - Frontend types and production build: `npm run build --prefix frontend`
  - Frontend behavior tests: `npm test --prefix frontend`
  - Backend tests: `.venv/bin/python -m pytest backend/tests -q`
  - Whitespace/diff check: `git diff --check`
- Add meaningful tests for new domain behavior, validation, compatibility, and failure
  paths. Do not add tests that merely mirror implementation or trivial visual styling.
- For canvas changes, verify relevant editing, selection, movement, undo, and persistence
  behavior in the browser. Check narrow layouts when the change affects layout.
- SQLite tests do not establish PostgreSQL-specific behavior. Use the existing opt-in
  PostgreSQL smoke test when relevant and when the database is already available; do not
  start services or pull images without the approval required above.
- Report which checks passed, skipped, or could not run. Do not claim unperformed validation.
