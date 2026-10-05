"""
Database layer -- verified end-to-end (table creation, tag seeding,
position insert/commit all tested against a live SQLite file).
No changes needed vs. the original draft; included here for completeness
alongside the corrected engine_service_v2.py, chat_route.py, and
index.html.
"""

import datetime
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, ForeignKey, Table
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

Base = declarative_base()

position_tags = Table(
    'position_tags',
    Base.metadata,
    Column('position_id', Integer, ForeignKey('positions.id'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id'), primary_key=True)
)


class Position(Base):
    __tablename__ = 'positions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    fen = Column(String, nullable=False, unique=True)
    source_note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    sessions = relationship("Session", back_populates="position")
    tags = relationship("Tag", secondary=position_tags, back_populates="positions")


class Tag(Base):
    __tablename__ = 'tags'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)

    positions = relationship("Position", secondary=position_tags, back_populates="tags")


class Session(Base):
    __tablename__ = 'sessions'

    id = Column(Integer, primary_key=True, autoincrement=True)
    position_id = Column(Integer, ForeignKey('positions.id'), nullable=False)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)
    solved = Column(Boolean, default=False)
    questions_asked = Column(Integer, default=0)
    final_user_move = Column(String, nullable=True)
    best_move = Column(String, nullable=False)
    eval_cp = Column(Integer, nullable=False)

    position = relationship("Position", back_populates="sessions")
    turns = relationship("Turn", back_populates="session", cascade="all, delete-orphan")


class Turn(Base):
    __tablename__ = 'turns'

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey('sessions.id'), nullable=False)
    turn_number = Column(Integer, nullable=False)
    role = Column(String, nullable=False)  # 'assistant' or 'user'
    content = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    session = relationship("Session", back_populates="turns")


SEED_TACTICAL_TAGS = [
    "pin", "fork", "skewer", "back_rank", "discovered_attack",
    "discovered_check", "double_check", "overloaded_defender",
    "remove_the_defender", "deflection", "attraction", "hanging_piece",
    "trapped_piece", "zwischenzug", "weak_dark_squares",
    "weak_light_squares", "mating_net", "pawn_breakdown",
    "clearance_sacrifice", "interference",
]


def init_db(db_url: str = "sqlite:///./chess_coach.db"):
    """Initializes tables and seeds the taxonomy tags on first run."""
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()

    try:
        if db.query(Tag).count() == 0:
            for tag_name in SEED_TACTICAL_TAGS:
                db.add(Tag(name=tag_name))
            db.commit()
    finally:
        db.close()

    return SessionLocal
