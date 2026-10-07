# System Design Studio

A local web app for creating and editing software system diagrams. This first implementation has no AI integration, model calls, background workers, or authentication.

## Current slice

- Create, rename, open, duplicate, and delete diagrams.
- Add 14 kinds of components by clicking or dragging from the palette.
- Move, resize, multi-select, duplicate, and delete components.
- Draw directed connections; edit labels, protocols, and synchronous/asynchronous interaction.
- Edit component descriptions, technology, replica counts, and regions.
- Keep a separate brief, requirements, and constraints for each diagram.
- Pan, zoom, snap to grid, fit the diagram, and use a minimap.
- Undo/redo, autosave, recover unsaved browser drafts, and handle version conflicts.
- Save immutable revisions and restore an earlier revision as a new version.
- Import portable JSON into a new diagram after a summary preview; export JSON.

AI, interview practice, sign-in, sharing, groups, auto-layout, and PNG export are deferred. This is a single-user local development slice; bind both servers to loopback rather than exposing them publicly.

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

Setup has been completed in this workspace. Verified: five backend tests (including the PostgreSQL integration check), four frontend tests, and the production build. Browser checks covered creation, renaming, properties/context edits, connections, movement, resize/undo, duplication/delete/undo, switching diagrams, and persistence after reload. The editor also adapts to narrow windows with collapsible side panels.

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
