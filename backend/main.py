"""Local-only API. AI and authentication are intentionally outside this slice."""

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from backend.database import Base, DiagramRecord, RevisionRecord, make_engine, now, session_factory
from backend.schemas import DiagramInput, DiagramSave, Graph, RestoreInput


def summary(record):
    return {
        "id": record.id,
        "title": record.title,
        "version": record.version,
        "updated_at": record.updated_at,
        "node_count": len(record.graph["nodes"]),
        "edge_count": len(record.graph["edges"]),
    }


def document(record):
    # Supply additive connection defaults for diagrams/revisions saved by older clients.
    return {**summary(record), "graph": Graph.model_validate(record.graph).model_dump(), "context": record.context}


def revision(record):
    return RevisionRecord(
        diagram_id=record.id, version=record.version, title=record.title,
        graph=record.graph, context=record.context,
    )


def create_app(database_url=None):
    engine = make_engine(database_url) if database_url else make_engine()
    sessions = session_factory(engine)

    @asynccontextmanager
    async def lifespan(app):
        # Initial schema only. Introduce explicit migrations before changing deployed tables.
        Base.metadata.create_all(engine)
        yield
        engine.dispose()

    app = FastAPI(title="System Design Studio", version="0.1.0", lifespan=lifespan)

    @app.middleware("http")
    async def local_request_guard(request: Request, call_next):
        # Bind to loopback, reject foreign browser origins, and bound JSON request size.
        origin = request.headers.get("origin")
        allowed = {"http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8000", "http://127.0.0.1:8000"}
        if origin and origin not in allowed:
            return Response("Origin not allowed", status_code=403)
        if request.method in {"POST", "PATCH", "PUT"}:
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 2_000_000:
                    return Response("Document is too large", status_code=413)
            request._body = bytes(body)
        return await call_next(request)

    def db():
        with sessions() as session:
            yield session

    def get_record(session, diagram_id):
        record = session.get(DiagramRecord, diagram_id)
        if record is None:
            raise HTTPException(404, "Diagram not found")
        return record

    def save_record(session, record, values, expected_version):
        # Compare-and-swap remains safe when two tabs save concurrently.
        result = session.execute(
            update(DiagramRecord)
            .where(DiagramRecord.id == record.id, DiagramRecord.version == expected_version)
            .values(**values, version=expected_version + 1, updated_at=now())
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            session.rollback()
            session.expire_all()
            current = get_record(session, record.id)
            raise HTTPException(409, {"message": "This diagram changed in another tab", "current_version": current.version})
        session.expire_all()
        updated = get_record(session, record.id)
        session.add(revision(updated))
        session.commit()
        return document(updated)

    @app.get("/api/health")
    def health(session: Session = Depends(db)):
        session.execute(select(1))
        return {"status": "ok"}

    @app.get("/api/diagrams")
    def list_diagrams(session: Session = Depends(db)):
        records = session.scalars(select(DiagramRecord).order_by(DiagramRecord.updated_at.desc())).all()
        return [summary(record) for record in records]

    @app.post("/api/diagrams", status_code=201)
    def create_diagram(payload: DiagramInput, session: Session = Depends(db)):
        record = DiagramRecord(id=str(uuid4()), **payload.model_dump(), version=1)
        session.add(record)
        session.flush()
        session.add(revision(record))
        session.commit()
        return document(record)

    @app.get("/api/diagrams/{diagram_id}")
    def get_diagram(diagram_id: str, session: Session = Depends(db)):
        return document(get_record(session, diagram_id))

    @app.patch("/api/diagrams/{diagram_id}")
    def save_diagram(diagram_id: str, payload: DiagramSave, session: Session = Depends(db)):
        record = get_record(session, diagram_id)
        values = payload.model_dump(exclude={"expected_version"})
        current = document(record)
        if record.version == payload.expected_version and all(current[key] == value for key, value in values.items()):
            return document(record)
        return save_record(session, record, values, payload.expected_version)

    @app.delete("/api/diagrams/{diagram_id}", status_code=204)
    def delete_diagram(diagram_id: str, expected_version: int, session: Session = Depends(db)):
        get_record(session, diagram_id)
        # Lock/delete by version to prevent deleting someone else's later edits.
        result = session.execute(delete(DiagramRecord).where(DiagramRecord.id == diagram_id, DiagramRecord.version == expected_version))
        if result.rowcount != 1:
            session.rollback()
            raise HTTPException(409, "Diagram changed; reload before deleting")
        session.execute(delete(RevisionRecord).where(RevisionRecord.diagram_id == diagram_id))
        session.commit()
        return Response(status_code=204)

    @app.get("/api/diagrams/{diagram_id}/versions")
    def list_versions(diagram_id: str, session: Session = Depends(db)):
        get_record(session, diagram_id)
        records = session.scalars(select(RevisionRecord).where(RevisionRecord.diagram_id == diagram_id).order_by(RevisionRecord.version.desc())).all()
        return [{"version": record.version, "title": record.title, "created_at": record.created_at} for record in records]

    @app.post("/api/diagrams/{diagram_id}/restore")
    def restore_diagram(diagram_id: str, payload: RestoreInput, session: Session = Depends(db)):
        record = get_record(session, diagram_id)
        previous = session.get(RevisionRecord, (diagram_id, payload.version))
        if previous is None:
            raise HTTPException(404, "Version not found")
        values = {"title": previous.title, "graph": previous.graph, "context": previous.context}
        return save_record(session, record, values, payload.expected_version)

    return app


app = create_app()
