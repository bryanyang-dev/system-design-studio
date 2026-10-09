# System Design Studio

A local web app for creating and editing software system diagrams, with an optional assistant connected through Sign in with ChatGPT. No background workers or diagram-user authentication are included.

## Current slice

- Create, rename, open, duplicate, and delete diagrams.
- Add 14 kinds of components by clicking or dragging from the palette.
- Move, resize, multi-select, duplicate, and delete components.
- Add multiline text with the canvas toolbar or Text palette item. Double-click to edit on the canvas, or use Text content in Properties; drag, resize, duplicate, and undo notes like other elements.
- Draw one-way or two-way connections from reusable dots on all four sides of each component. Nodes and individual dots accept multiple connections; parallel connections use separate paths.
- Edit connection labels, protocols, source/target sides, direction, and synchronous/asynchronous interaction.
- Edit component descriptions, technology, replica counts, and regions.
- Keep a separate brief, requirements, and constraints for each diagram.
- Pan, zoom, snap to grid, fit the diagram, and use a minimap.
- Undo/redo, autosave, recover unsaved browser drafts, and handle version conflicts.
- Save immutable revisions and restore an earlier revision as a new version.
- Import portable JSON into a new diagram after a summary preview; export JSON.
- Connect a ChatGPT account, choose an available model, ask design questions, and review proposed diagram changes before applying them.

Diagram-user sign-in, sharing, groups, auto-layout, and PNG export are deferred. This is a single-user local development slice; bind both servers to loopback rather than exposing them publicly.

## ChatGPT plan integration

1. Run the frontend on port 5173 and backend on port 8000 using the existing startup instructions.
2. Click **ChatGPT** in the header, then **Continue with ChatGPT**. Complete sign-in and authorize ChatGPT plan usage in the OpenAI browser window.
3. Return to the app. The dialog shows the active account and its available models. Select a model and send a prompt.
4. Reviews return an explanation. Diagram edits include a validated replacement graph and a before/after change list. Click **Apply proposed changes** to apply as one undoable edit. Changes to the source diagram invalidate an outstanding proposal.

This uses OpenAI's [ChatGPT plan usage flow for local/open-source apps](https://developers.openai.com/siwc/token-sharing-open-source), subject to account eligibility and allowance. There is no API-key fallback. Configure app usage/credit limits in ChatGPT Settings; this app cannot guarantee provider-side charges beyond the limits you authorize. Successful sign-in or a model listing alone does not establish inference access; only a completed request does.

The backend uses PKCE, state plus an HTTP-only callback cookie, nonce, and RS256 ID-token verification against OpenAI's JWKS. The callback URI is fixed to `http://127.0.0.1:8000/api/chatgpt/callback`; initial registration must use this URI. OAuth callback query parameters are redacted before access logging. The frontend receives connection status and model names, never OAuth tokens.

Credentials, account/client mappings, and the stable host ID are stored under `.local/chatgpt/connection.json`, outside diagram exports and PostgreSQL. The directory is mode 0700 and atomic credential files are mode 0600 on Unix; they are protected by filesystem permissions, not encrypted at rest. `.local/` is ignored by Git. Run one backend process against this store so refresh-token rotation remains serialized. Do not copy the credential store to another computer as a shortcut for sign-in.

Choose a saved account in the dialog and continue to reauthorize it, or choose **Add an account or workspace** for a new registration. Disconnect clears local tokens and attempts remote refresh-token revocation while preserving account registration and host identity. If revocation cannot be confirmed, disconnect the app in ChatGPT Settings. Restarting the backend preserves completed connections but cancels pending sign-ins; start again if a callback expires.

Assistant requests send the current diagram and design context when you click **Ask ChatGPT**. The provider response is consumed as an SSE stream with `store: false` and `stream: true`, then returned after a completed event. Invalid graphs, failed/incomplete streams, and allowance errors cannot modify the diagram. HTTP requests have bounded inactivity timeouts; the current UI displays progress rather than token-by-token output. The diagram assistant remains single-turn; interview mode maintains its own transcript.

Backend logs include each inference request body (model, instructions, prompt, and diagram/context), the validated response, and elapsed time. Matching `call` IDs connect request, response, and failure lines. These appear in the Uvicorn terminal and any file capturing its output. Logs therefore contain diagram content; OAuth credentials, authorization headers, and raw exception/provider error bodies are excluded. Failures record only the exception type and HTTP status when available.

Automated integration tests use disposable RSA keys, temporary credential stores, and mock OpenAI responses. They do not sign into a real account or consume ChatGPT allowance. Live OAuth consent and a completed inference request must be verified by the account owner.

## Interview practice

Open a diagram (including an empty one), supply its design context, and click **Interview**. Connect ChatGPT first, then choose a model, difficulty, duration or untimed practice, and optional focus areas. The side panel leaves the canvas editable. The interviewer asks one main question at a time, probes your reasoning, and introduces hypothetical constraints with explicit units. Solutions are withheld by instruction unless you request **Hint** or **Coaching**; model adherence is not guaranteed.

Answer in the panel and edit the diagram as needed. Each AI turn sends the current diagram/context, transcript, previous observed component summaries, and session settings to OpenAI. The interviewer cannot return or apply a graph. Hypothetical constraints stay in the interview and never overwrite the diagram context. Hint, coaching, and skipped-question turns are recorded.

Sessions, transcript, per-turn design snapshots/observed diagram versions, settings, timestamps, and feedback persist in PostgreSQL's new `interview_sessions` table, created on backend startup without changing existing tables. Snapshots can include unsaved canvas edits; their observed version is the last saved version. Closing the panel does not pause the clock. Use **Pause**, **Resume**, or **+15 minutes**; expiration invites you to finish or extend. The timer uses server timestamps and persisted paused duration, so refreshes and backend restarts do not reset it.

Reopening the panel loads the latest session for that diagram; use **Saved sessions** to revisit others. **Finish & get feedback** produces six rubric assessments, transcript evidence, strengths, gaps, and next practice actions. Unobserved criteria should be marked as such; numeric scores require citations to actual answer turns. Concurrent updates return a conflict requiring reload, and failed AI turns do not advance the session. Sessions are capped at 40 turns before wrap-up; timed sessions can be extended up to 180 minutes. Deleting a diagram deletes its interviews. Scenario templates, voice, transcript export, and progress tracking are deferred.

Text annotations are stored as nodes with `type: "text"`; their content is in `properties.description`. They have no connection dots. Notes are included in autosave, revisions, JSON import/export, and the 500-node limit. Existing diagrams need no database migration.

## Stack and layout

```text
frontend/                 React + TypeScript + React Flow editor
backend/                  Python + FastAPI API and SQLAlchemy persistence
backend/tests/            Validation, conflict, restore, and persistence tests
compose.yaml              Local PostgreSQL with a persistent named volume
SPEC.md                   Product and technical specification
```

The domain graph in `frontend/src/domain.ts` and `backend/schemas.py` is independent of the rendering library. Graph/context documents are stored in PostgreSQL JSONB columns. No canvas renderer fields such as selection or measured dimensions are stored.

## Dependency approval

The workspace's dependency policy requires explicit user approval before installing packages or downloading/starting PostgreSQL. The source and manifests can be prepared without installation. These are the proposed one-time setup commands, to be run from the repository root **only after approval**:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
npm install --prefix frontend
docker compose up -d postgres
```

The first command creates an isolated Python environment including its bundled pip. The second installs the backend runtime and test dependencies listed in `backend/requirements.txt`. The third installs the frontend/runtime/build/test packages listed in `frontend/package.json` and writes the npm lockfile. The final command may download the PostgreSQL 17 image; it starts the database service and creates its persistent volume. Do not substitute alternative installers or retry failed installations without further approval.

## Start the app after setup

From the repository root, run the backend in one terminal:

```sh
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Run the frontend in a second terminal:

```sh
npm run dev --prefix frontend
```

Open <http://127.0.0.1:5173>. The frontend proxies `/api` to the Python backend. The API documentation is at <http://127.0.0.1:8000/docs>.

PostgreSQL listens on `127.0.0.1:55432`, using database `diagram_ai` and development-only credentials configured in `compose.yaml`. The backend defaults to that connection. To use an existing database, set `DATABASE_URL` to a SQLAlchemy PostgreSQL URL (`postgresql+psycopg://...`) before starting it. Never commit production credentials.

On startup the backend creates the initial tables. There is no schema migration runner yet; introduce migrations before modifying tables with existing user data.

To restart an already-created database container without potentially downloading an image:

```sh
docker compose start postgres
```

## Persistence and recovery

PostgreSQL data lives in the `diagram_ai_data` named Docker volume (Compose prefixes the volume name with its project name). Stopping the servers or database does not remove the volume. `docker compose stop` safely stops the database. Avoid commands that delete volumes unless you intend to erase all diagrams.

Changes are saved after a short idle period. Drag/resize gestures are batched; editing a text field and dragging a component each make one undo checkpoint. Undo history is limited to 100 in-session changes. Saved server revisions persist across restarts.

Unsaved content is also written to browser local storage. Reopening that diagram offers recovery. If the server has a newer version, recovered content cannot overwrite it; use **Save as copy** to preserve both designs, or export the recovered JSON. Local drafts belong to that browser profile; PostgreSQL remains the canonical saved store. Draft storage failure is reported in the editor.

Two tabs cannot silently overwrite each other: every save includes `expected_version`, and the server updates only when that version matches. On conflict, autosave stops and offers a copy or the saved server version.

## Checks after dependencies are approved

Setup has been completed in this workspace. Verified: seven backend tests (including the PostgreSQL integration check), seven frontend tests, and the production build. Browser checks covered creation, renaming, properties/context edits, two-way arrows, multiple connections sharing a dot, top/bottom connections, movement, resize/undo, duplication/delete/undo, switching diagrams, and persistence after reload. The editor also adapts to narrow windows with collapsible side panels.

The dependency audit reports three advisories in development test tooling (`vitest`, `@vitest/mocker`, and `tinypool`). No upgrade or automatic audit fix was run; dependency upgrades need separate approval under the workspace policy. The Vitest UI/server is not started by the development app.

```sh
.venv/bin/python -m pytest backend/tests -q
npm test --prefix frontend
npm run build --prefix frontend
```

To include the PostgreSQL check:

```sh
RUN_POSTGRES_SMOKE=1 .venv/bin/python -m pytest backend/tests -q
```

API tests use temporary SQLite files to test persistence and concurrency contracts without modifying local PostgreSQL data. The production/local app defaults to PostgreSQL; SQLite is only a test adapter. A separate smoke check against the running PostgreSQL instance should verify create → save → reload → restore → delete.

Manual editor check: create a diagram, add two nodes, connect them, label the connection, resize/move a node, add context, undo/redo, and reload. Export/import the JSON and verify labels, metadata, connections, and positions. Open two tabs and verify a stale save becomes a conflict.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Database connectivity |
| `GET /api/diagrams` | List diagrams |
| `POST /api/diagrams` | Create from optional title/graph/context |
| `GET /api/diagrams/{id}` | Read full document |
| `PATCH /api/diagrams/{id}` | Save with expected version |
| `DELETE /api/diagrams/{id}?expected_version=N` | Delete diagram and revisions |
| `GET /api/diagrams/{id}/versions` | List revisions |
| `POST /api/diagrams/{id}/restore` | Restore with expected version |

Documents support up to 500 components and 1,500 connections, and requests/imports are limited to 2 MB. Validation rejects duplicate IDs, missing connection endpoints, unsupported component types, invalid dimensions, and non-finite coordinates. A save and its new revision commit in one database transaction.

Connections store `direction` (`one_way` / `two_way`), `source_port`, and `target_port` (`top` / `right` / `bottom` / `left`). Older diagrams and exports remain compatible: missing values default to a one-way connection from the right to the left. No SQL table migration is required because these fields live inside the graph JSON document. Select a connection and choose **Direction → Two way** in Properties to put arrowheads at both ends; endpoint sides can also be changed there.
