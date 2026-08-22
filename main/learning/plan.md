# Chess Tactics Coach — Forward Plan

## Inherited stack decisions

These were chosen by the AI that built the app. You inherit them — the goal is to understand each one well enough to maintain and extend it.

| Decision | What it is | Usual or unusual? | Status | Revisit in |
|----------|-----------|-------------------|--------|------------|
| **Python** | The language. Popular, huge ecosystem. | Boring default | seed | Section 2 (you'll write Python that touches the DB) |
| **FastAPI** | Web framework — turns HTTP requests into Python function calls. Most popular Python API framework right now. | Boring default | seed | Section 2 (you'll modify a FastAPI route) |
| **Stockfish** via **python-chess** | Chess engine (strongest free one) + the Python library that talks to it. | Boring default | introduced | Section 2 (engine is called every chat turn) |
| **LLM integration** (Anthropic + Z.ai) | AI coaching. Two providers with an abstraction layer so the routes don't care which one is active. | Unusual — most people pick one and hardcode it | seed | — |
| **SQLite** via **SQLAlchemy** | Database + ORM. Currently frozen (tables exist but chat doesn't write to them). | Boring default | seed | Section 2 (this is the whole point) |
| **Single HTML file** | No build step, no framework. Board from cm-chessboard CDN. | Simple but limits growth | seed | — |
| **In-memory sessions** | Game state lives in a Python dict. Lost on restart. | Fine for local dev, blocks deployment at scale | introduced | Section 2 (you'll replace this) |
| **uvicorn** | ASGI server that runs FastAPI. | Boring default | seed | Section 3 |
| **python-dotenv + .env** | Configuration via environment variables. | Boring default | seed | Section 3 (deploy needs proper env config) |

## Sections

---

### Section 1 — Make the ground solid ✅

- [x] Clean venv + pyproject.toml with uv
- [x] Verify app runs end-to-end
- [x] .gitignore + git baseline commit

**Goal:** Your project can never be lost again.

**What happens:**
- Clean up the `.venv` — it's currently polluted with other projects (bookmarks_webapp, google-ads) and missing core dependencies (fastapi, chess, anthropic, openai aren't installed). Create a fresh, project-specific virtual environment with a `requirements.txt` so it's reproducible.
- Confirm the app actually runs end-to-end (Stockfish, LLM, board, chat all working).
- Git baseline commit: commit everything that matters (the Python app, `learning/`, `.gitignore`), including the React-era deletions so the repo is clean.
- Commit the `learning/` directory so your progress tracking is versioned too.

**Visible outcome:** `./start.sh` starts a working app, `git log` shows one clean baseline commit, `pip install -r requirements.txt` in a fresh venv gives you a runnable app.

**Reclaim task:** None — this section is infrastructure, not concept work. The reclaim starts in Section 2.

---

### Section 2 — Wire up database persistence

**Goal:** Sessions survive a server restart. The frozen DB code becomes live.

**What happens:**
- Activate the frozen `database.py` — the models (Position, Session, Turn, Tag) already exist and match the PRD's data model.
- Modify the `/session/start` and `/chat` routes in `main.py` to write session and turn data to SQLite instead of (and eventually in addition to) the in-memory dict. Board state can stay in memory (it's transient per-session), but the conversation history and session metadata get persisted.
- On startup, the app can optionally reload incomplete sessions from the DB so a user can resume.

**Visible outcome:** Restart the server mid-conversation, reload the page, and continue the session. Check the SQLite file and see your turns recorded.

**Reclaim task:** `database.py` (parked → known). You'll explain what each model does, break the DB connection on purpose, predict the error, and fix it. Flips the SQLAlchemy/ORM/SQLite graph entries from seed toward introduced.

---

### Section 3 — Deploy online

**Goal:** The app is reachable from the internet, usable from any browser.

**What happens:**
- Set up a systemd service on your VPS so the app starts automatically and restarts on crash.
- Put Cloudflare (or your existing reverse proxy) in front of it for HTTPS and basic access protection (the PRD recommends Cloudflare Zero Trust or basic auth — no app-level auth needed for single user).
- Move `.env` and API keys to proper server-side environment variables, not committed to the repo.
- Stockfish needs to be installed on the VPS (or bundled).

**Visible outcome:** You open your domain in a browser on your phone, paste a FEN, and get coached.

**Reclaim task:** `.env` / environment variables (parked → known). You'll explain why API keys must never be in the repo, predict what happens if someone finds your `.env` in git history, and clean up the repo (the current `.env` with real keys is already committed — that needs fixing). Flips env-var concepts from seed toward introduced.

---

### Section 4 — New frontend with drag-and-drop *(later)*

**Goal:** A proper frontend inspired by qchess.net — drag pieces to make moves, better UI.

**What happens:**
- Replace the single HTML file with a real frontend (likely using chessground — Lichess's board library — which has native drag-and-drop, or enable cm-chessboard's built-in movable pieces).
- When a piece is dragged to a square, the frontend sends that move to `/chat` instead of requiring typed input.
- Keep the chat panel alongside the board.

**Visible outcome:** You drag a piece on the board instead of typing "Nf3" in the chat box.

**Reclaim task:** `static/index.html` (parked → known). The whole frontend becomes yours.

---

## What you now own

- A file map with no mystery boxes (`learning/file-map.md`)
- A knowledge graph that tells the truth (`learning/knowledge-graph.md`)
- A project brief that records what this is and why (`learning/project.md`)
- This plan, which builds forward while reclaiming backward (`learning/plan.md`)

**Next step:** run `/next-lesson` to start Section 1.

## Notes

- **Coaching quality is a blocker.** The current model (glm-4.7 via Z.ai) doesn't just hallucinate squares — it fundamentally fails to understand tactical lines, misleads the user, and gives poor coaching. This isn't a code bug; the code correctly passes the FEN, engine analysis, and verification tools. The model is too weak for this task. Fix: switch `COACH_PROVIDER` to `anthropic` (Claude) and test. This should be evaluated **before** Section 2 — there's no point persisting sessions to a database if the coaching itself is broken.
- The PRD (`chess-tactics-coach-prd.md`) exists in the repo and describes the full original vision including a dashboard with per-tag stats, PGN upload, and more. Those are candidates for future sections — not invented here, recorded as they were written.
- Section 4 is deliberately vague — the right frontend choice depends on what you've learned by the time you get there.
