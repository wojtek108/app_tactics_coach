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
| Structural signals (hanging pieces, undervalued targets) | introduced | Board analysis | Now forwarded to the LLM every turn (previously only `best_move_san` was sent). Needed a refresher on *why* this matters (couldn't answer unprompted — "not sure") before correctly restating the engine-computes/LLM-explains pattern | 2026-08-24 |
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
| Refutation analysis | introduced | Stockfish | Wired `refute_move` into `try_hypothetical_move` (own tool session); correctly generalized the app's core pattern — engine computes tactical facts, LLM only explains them — and applied it to this tool unprompted | 2026-08-24 |

### LLM integration

| Concept | Status | Depends on | Evidence | Date |
|---------|--------|------------|----------|------|
| LLM client abstraction | introduced | Python, HTTP | Walked `build_client_from_env`'s role param (coach/nl_interpreter) and the two client classes | 2026-08-23 |
| Anthropic API | seed | LLM client | | |
| OpenAI-compatible APIs | seed | LLM client | | |
| Tool calling | introduced | LLM client | Traced why `respond_with_coaching` wasn't being called — model returned no tool_calls at all | 2026-08-23 |
| Provider-agnostic design | introduced | LLM client | Correctly reasoned `COACH_PROVIDER` (coaching text) vs `NL_INTERPRETER_PROVIDER` (move parsing) are separate concerns before being told | 2026-08-23 |
| System prompts | seed | LLM client | | |
| Conversation history (server-owned, unbounded growth) | practicing | LLM client | Redesigned `session.messages` to be server-owned in another tool's session, then explained (after one guided follow-up) that resending the full list every turn drives up both token cost and latency turn-over-turn | 2026-08-24 |
| Reasoning/"thinking" model output (hidden reasoning tokens, separate response field) | introduced | LLM client, Tool calling | New leaf, found via debug print: glm-5.1 returns empty `content` and puts its work in `reasoning_content`, apparently exhausting `max_tokens` before answering. Diagnosis explained; hypothesis not yet tested with the learner | 2026-08-23 |

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
| Environment variables | practicing | Shell, OS | Named .env as a security risk for git — keys stay in git history forever (2026-08-19). Edited `.env` directly and correctly predicted a running server wouldn't pick up the change without a restart (2026-08-23) | 2026-08-23 |
| .env files | practicing | Environment variables | Understood it holds runtime config (API keys, provider), loaded by python-dotenv on startup (2026-08-19). Made a real edit (`COACH_MODEL`) with correct understanding of what it controlled (2026-08-23) | 2026-08-23 |
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