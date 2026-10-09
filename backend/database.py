import os
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, sessionmaker


DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://diagram:diagram_local@127.0.0.1:55432/diagram_ai",
)
Base = declarative_base()
document_type = JSON().with_variant(JSONB(), "postgresql")


def now():
    return datetime.now(timezone.utc)


class DiagramRecord(Base):
    __tablename__ = "diagrams"

    id = Column(String(36), primary_key=True)
    title = Column(String(200), nullable=False)
    version = Column(Integer, nullable=False, default=1)
    graph = Column(document_type, nullable=False)
    context = Column(document_type, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now)


class RevisionRecord(Base):
    __tablename__ = "diagram_versions"

    diagram_id = Column(String(36), ForeignKey("diagrams.id", ondelete="CASCADE"), primary_key=True)
    version = Column(Integer, primary_key=True)
    title = Column(String(200), nullable=False)
    graph = Column(document_type, nullable=False)
    context = Column(document_type, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=now)


class InterviewRecord(Base):
    __tablename__ = "interview_sessions"

    id = Column(String(36), primary_key=True)
    diagram_id = Column(String(36), ForeignKey("diagrams.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    data = Column(document_type, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=now)


def make_engine(url=DATABASE_URL):
    options = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        options["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **options)


def session_factory(engine):
    return sessionmaker(bind=engine, expire_on_commit=False)
