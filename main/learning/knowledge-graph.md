# Chess Tactics Coach — Knowledge Graph

**Status legend:**
- `seed` — haven't touched this yet
- `introduced` — discussed today, surface-level
- `practicing` — used it with guidance
- `understood` — you explained it unprompted

---

## Chess domain concepts

### Chess notation → [[chess-coach-idea]]

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| FEN notation (Forsyth-Edwards Notation) | seed | - | | |
| Standard Algebraic Notation (SAN) | introduced | FEN | Recognized multiple notations exist, gave example `Ng1-f3` | 2026-08-17 |
| Coordinate notation (e.g., `Ng1-f3`) | introduced | SAN | Gave as example of different notation type | 2026-08-17 |
| UCI notation (Universal Chess Interface) | seed | SAN | | |
| Chess move legality | seed | SAN, UCI, board state | | |
| Tactical themes (pin, fork, skewer, etc.) | seed | Chess rules | | |
| Material evaluation | seed | Piece values | | |
| Structural signals (hanging pieces, undervalued targets) | seed | Board analysis | | |
| Multi-ply tactical lines | seed | Chess rules | | |

---

## Python backend

### Web framework

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| FastAPI | seed | Python, HTTP | | |
| Async/await | seed | Python | | |
| HTTP methods (GET, POST) | seed | HTTP | | |
| Request/response models (Pydantic) | seed | Python type hints | | |
| Lifespan management | seed | FastAPI | | |
| Static file serving | seed | FastAPI, HTTP | | |

### Chess engine

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Stockfish | introduced | Chess rules, engine protocol | Recognized engine_service.py is connected to Stockfish and does evaluation | 2026-08-17 |
| Engine protocol (UCI) | seed | Stockfish | | |
| Position analysis (depth, time limits) | seed | Stockfish | | |
| Engine evaluation (centipawns, mate scores) | seed | Stockfish | | |
| Persistent engine process | seed | Stockfish, async | | |
| Refutation analysis | seed | Stockfish | | |

### LLM integration

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| LLM client abstraction | seed | Python, HTTP | | |
| Anthropic API | seed | LLM client | | |
| OpenAI-compatible APIs | seed | LLM client | | |
| Tool calling | seed | LLM client | | |
| Provider-agnostic design | seed | LLM client | | |
| System prompts | seed | LLM client | | |
| Conversation history | seed | LLM client | | |

### App-specific backend

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Session management (in-memory) | seed | Python dict, UUID | | |
| Natural language move interpretation | seed | LLM client, chess notation | | |
| Socratic coaching | seed | LLM client, chess coaching | | |
| Move parsing strategies | seed | Chess notation, regex | | |
| Board state management | seed | python-chess library | | |

### Database (frozen)

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| SQLAlchemy ORM | seed | Python, SQL | | |
| SQLite | seed | Database | | |
| Models and relationships | seed | SQLAlchemy | | |
| Database seeding | seed | SQLAlchemy | | |
| Frozen code (unused features) | introduced | Code reading | Correctly spotted database.py is not used during chat | 2026-08-17 |

---

## Frontend

### HTML/JS basics

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Single-page app (no build step) | seed | HTML, JS | | |
| Fetch API | seed | HTTP, JS | | |
| DOM manipulation | seed | HTML, JS | | |
| Event handlers | seed | HTML, JS | | |

### Chessboard library

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| cm-chessboard | seed | JS libraries | | |
| Board state synchronization | seed | cm-chessboard, FEN | | |
| Square highlighting (markers) | seed | cm-chessboard | | |
| Board rotation | seed | cm-chessboard | | |

---

## Engineering practices

### Version control

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Git basics (commit, branch) | practicing | - | Made baseline commit with staged deletions and new Python app | 2026-08-19 | |
| Git status awareness | practicing | Git | Used git status and git add -n dry run to verify .env exclusion before committing | 2026-08-19 |
| Git history cleanup | seed | Git | Old React files still in history (noted in project.md) | 2026-08-17 |

### Environment & configuration

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Environment variables | introduced | Shell, OS | Named .env as a security risk for git — keys stay in git history forever | 2026-08-19 | |
| .env files | introduced | Environment variables | Understood it holds runtime config (API keys, provider), loaded by python-dotenv on startup | 2026-08-19 | |
| API key security | seed | Environment variables | | |
| Virtual environments | practicing | Python | Created fresh venv with uv, explained why the polluted one was a problem | 2026-08-19 | |

### Testing

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Automated testing | seed | - | Only manual test scripts exist (test_loop.py, test_zai.py) | 2026-08-17 |
| Test-driven development | seed | Automated testing | | |

### Deployment

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Local development server | seed | uvicorn | | |
| Production deployment | seed | Deployment | | |
| Process scaling (multi-worker) | seed | Deployment | Engine process lifecycle issue noted in code | 2026-08-17 |

---

## Python-specific

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| Dataclasses | seed | Python | | |
| Type hints | seed | Python | | |
| Async context managers | seed | Python, async | | |
| Dependency injection | seed | FastAPI | | |
| Process lifecycle | seed | Python, async | | |