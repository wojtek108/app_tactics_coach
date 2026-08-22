import json
import re
import uuid
import chess
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine_service import ChessAnalysisService
from database import init_db
from llm_client import build_client_from_env

chess_service = ChessAnalysisService(stockfish_path="/usr/games/stockfish")
SessionLocal = None


@dataclass
class PlyRecord:
    student_move_san: str
    opponent_reply_san: Optional[str]  # None if it was the student's last move (mate/no reply yet)
    material_delta_cp: int  # material swing caused by the student's move, in centipawns


@dataclass
class GameSession:
    board: chess.Board
    student_color: bool  # chess.WHITE or chess.BLACK -- whichever side was "to move" at load time
    history: List[PlyRecord] = field(default_factory=list)
    max_student_plies: int = 6


# In-memory session store. Fine for a single-user local/VPS deployment;
# would need Redis or a DB-backed store for multi-worker/multi-process
# deployment, since this dict only lives in one process's memory.
game_sessions: Dict[str, GameSession] = {}


PIECE_VALUES = {
    chess.PAWN: 100, chess.KNIGHT: 300, chess.BISHOP: 300,
    chess.ROOK: 500, chess.QUEEN: 900, chess.KING: 0,
}


def material_balance_white_pov(board: chess.Board) -> int:
    """Material balance in centipawns, positive favors White."""
    total = 0
    for piece_type, value in PIECE_VALUES.items():
        total += value * len(board.pieces(piece_type, chess.WHITE))
        total -= value * len(board.pieces(piece_type, chess.BLACK))
    return total


@asynccontextmanager
async def lifespan(app: FastAPI):
    global SessionLocal
    SessionLocal = init_db()
    await chess_service.start()
    yield
    await chess_service.stop()


app = FastAPI(title="Chess Tactics Coach", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


def get_engine_service() -> ChessAnalysisService:
    return chess_service


class AnalyzeRequest(BaseModel):
    fen: str


class StartSessionResponse(BaseModel):
    session_id: str
    fen: str
    best_move_san: Optional[str]
    student_color: str  # "white" or "black"
    structural_signals: Dict[str, Any]


class ChatRequest(BaseModel):
    session_id: str
    user_message: str
    conversation_history: List[Dict[str, str]]


class ChatResponse(BaseModel):
    assistant_reply: str
    highlight_squares: List[str]
    user_solved_this_turn: bool
    refutation_context: Optional[Dict[str, Any]] = None
    fen: str  # current board state, for the frontend to redraw
    line_complete: bool = False


def extract_candidate_move(user_text: str, board: chess.Board) -> Optional[str]:
    clean_text = user_text.strip().rstrip(".!?")
    try:
        move = board.parse_san(clean_text)
        return board.san(move)
    except ValueError:
        pass

    tokens = re.findall(r'\b(?:[NBKRQ]?[a-h]?[1-8]?x?[a-h][1-8](?:=[NBKRQ])?|O-O(?:-O)?)\b', user_text)
    for token in tokens:
        try:
            move = board.parse_san(token)
            return board.san(move)
        except ValueError:
            continue

    bare_squares = re.findall(r'\b([a-h][1-8])\b', user_text)
    for sq_name in bare_squares:
        square = chess.parse_square(sq_name)
        matches = [m for m in board.legal_moves if m.to_square == square]
        if len(matches) == 1:
            return board.san(matches[0])

    return None


async def interpret_natural_language_move(user_text: str, board: chess.Board) -> Optional[str]:
    """Fallback for free-form descriptions like 'I'll take the rook with my
    pawn' that extract_candidate_move() can't parse as notation. Uses a
    small, separate model call constrained via a tool schema enum to the
    position's ACTUAL legal moves -- so even if the model misreads intent,
    it is structurally impossible for it to return an illegal move. Final
    correctness (does this match the engine's best move?) is still decided
    in plain code afterward, same as every other path; this function only
    ever returns a SAN string that was already confirmed legal, or None."""
    legal_sans = [board.san(m) for m in board.legal_moves]
    if not legal_sans:
        return None

    nl_client = build_client_from_env("nl_interpreter")

    try:
        result = await nl_client.call(
            system=(
                "A chess student described their intended move in plain English. "
                "Match it to exactly one of the provided legal moves (SAN notation) "
                "if their intent is reasonably clear. If it's too vague or ambiguous "
                "to confidently pick one move, say so instead of guessing."
            ),
            messages=[{
                "role": "user",
                "content": (
                    f"Legal moves available: {', '.join(legal_sans)}\n\n"
                    f"Student said: \"{user_text}\"\n\n"
                    "Which legal move (if any) are they describing?"
                ),
            }],
            tools=[{
                "name": "resolve_move",
                "description": "Report which legal move the student's description matches, if any.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "matched": {"type": "boolean", "description": "True only if you're reasonably confident which move they mean."},
                        "move_san": {
                            "type": "string",
                            "enum": legal_sans,
                            "description": "The matching legal move in SAN, only present if matched=True.",
                        },
                    },
                    "required": ["matched"],
                },
            }],
            force_tool="resolve_move",
            max_tokens=300,
        )
    except Exception:
        # If this fallback call itself fails (network, auth, etc.), don't
        # let it take down the whole /chat turn -- just fall through to
        # "couldn't identify a move," same as the deterministic path does.
        return None

    resolve_call = next((tc for tc in result.tool_calls if tc.name == "resolve_move"), None)
    if resolve_call is None or not resolve_call.input.get("matched"):
        return None

    candidate = resolve_call.input.get("move_san")
    # Belt-and-suspenders: the enum constraint should guarantee this, but
    # never trust a model output as legal without checking it against the
    # actual board -- confirm it's really in legal_sans before using it.
    return candidate if candidate in legal_sans else None


@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")


@app.post("/analyze")
async def analyze_fen(
    payload: AnalyzeRequest,
    engine_svc: ChessAnalysisService = Depends(get_engine_service)
):
    try:
        return await engine_svc.analyze_position(payload.fen)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid FEN or engine error: {str(e)}")


@app.post("/session/start", response_model=StartSessionResponse)
async def start_session(
    payload: AnalyzeRequest,
    engine_svc: ChessAnalysisService = Depends(get_engine_service)
):
    try:
        board = chess.Board(payload.fen)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid FEN: {str(e)}")

    session_id = str(uuid.uuid4())
    game_sessions[session_id] = GameSession(board=board, student_color=board.turn)

    analysis = await engine_svc.analyze_position(payload.fen)

    return StartSessionResponse(
        session_id=session_id,
        fen=payload.fen,
        best_move_san=analysis.get("best_move_san"),
        student_color="white" if board.turn == chess.WHITE else "black",
        structural_signals=analysis.get("structural_signals", {}),
    )


@app.post("/chat", response_model=ChatResponse)
async def handle_chat_turn(
    payload: ChatRequest,
    engine_svc: ChessAnalysisService = Depends(get_engine_service)
):
    session = game_sessions.get(payload.session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found or expired. Start a new session.")

    board = session.board

    if board.is_game_over():
        raise HTTPException(status_code=400, detail="This line has already ended (checkmate/stalemate/draw).")

    # Best move is recomputed fresh against the CURRENT board state, not a
    # value fixed at session start -- this is what makes multi-ply lines
    # work at all, since the "correct" move changes every ply.
    current_fen = board.fen()
    analysis = await engine_svc.analyze_position(current_fen, depth=18, time_limit=1.0)
    best_move_san = analysis.get("best_move_san")

    candidate_move_san = extract_candidate_move(payload.user_message, board)
    used_nl_fallback = False
    if candidate_move_san is None:
        candidate_move_san = await interpret_natural_language_move(payload.user_message, board)
        used_nl_fallback = candidate_move_san is not None
    user_solved = False
    refutation_data = None
    opponent_reply_san = None
    line_complete = False

    if candidate_move_san and candidate_move_san == best_move_san:
        user_solved = True

        material_before = material_balance_white_pov(board)
        board.push(board.parse_san(candidate_move_san))
        material_after_student = material_balance_white_pov(board)
        # signed so it's always "in the student's favor" regardless of color
        material_delta = (material_after_student - material_before) * (1 if session.student_color == chess.WHITE else -1)

        # Auto-play the opponent's reply so the student keeps solving their
        # own side's moves without needing to also play the opponent.
        if not board.is_game_over():
            opp_analysis = await engine_svc.analyze_position(board.fen(), depth=18, time_limit=1.0)
            opp_move_san = opp_analysis.get("best_move_san")
            if opp_move_san:
                opponent_reply_san = opp_move_san
                board.push(board.parse_san(opp_move_san))

        session.history.append(PlyRecord(
            student_move_san=candidate_move_san,
            opponent_reply_san=opponent_reply_san,
            material_delta_cp=material_delta,
        ))

        if board.is_game_over() or len(session.history) >= session.max_student_plies:
            line_complete = True
    elif candidate_move_san:
        refutation_data = await engine_svc.refute_move(current_fen, candidate_move_san)

    system_prompt = (
        "You are an expert Socratic chess coach guiding a student through a "
        "multi-move tactical combination, not just a single move. Your goal "
        "is to guide the student to discover each move in the line without "
        "giving it away prematurely.\n"
        "Guidelines:\n"
        "- Ask one targeted question at a time.\n"
        "- Acknowledge correct observations before probing for missing elements.\n"
        "- If the student names a target (e.g. 'I can take the rook') without "
        "specifying which of their own pieces does it, don't imply that might "
        "not actually be possible -- ask directly which piece captures it and "
        "from where (e.g. 'Right idea -- which of your pieces can capture it, "
        "and from which square?'). Never frame a piece-of-capture question as "
        "an either/or between two things that could be the same move (e.g. "
        "'a rook capture, or is it actually a pawn capture' is misleading when "
        "a pawn capturing IS how the rook gets captured).\n"
        "- If candidate_move_was_natural_language is True, the student described "
        "their move in plain English rather than notation -- briefly confirm "
        "what you understood them to mean (e.g. 'Got it, bxc4') before continuing, "
        "so they know their phrasing was understood correctly.\n"
        "- If user_solved_this_turn is True: confirm the move, explain WHY it "
        "works, name the tactical theme, then mention the opponent's reply "
        "(if any) and prompt for the student's NEXT move in the line.\n"
        "- If line_complete is True: congratulate the student, briefly summarize "
        "the whole combination they found, and note that the position has "
        "settled (or the game ended) so this is a natural stopping point.\n"
        "- Always trigger the `respond_with_coaching` tool to output your text and "
        "any squares that should be highlighted on the board."
    )

    prompt_context = {
        "fen_before_this_turn": current_fen,
        "fen_after_this_turn": board.fen(),
        "best_move_san": best_move_san,
        "user_solved_this_turn": user_solved,
        "candidate_move_detected": candidate_move_san,
        "candidate_move_was_natural_language": used_nl_fallback,
        "refutation_details": refutation_data,
        "opponent_auto_reply_san": opponent_reply_san,
        "plies_solved_so_far": [
            {"student_move": h.student_move_san, "opponent_reply": h.opponent_reply_san, "material_swing_cp": h.material_delta_cp}
            for h in session.history
        ],
        "line_complete": line_complete,
    }

    tools = [
        {
            "name": "check_square",
            "description": (
                "Look up who attacks and defends a given square right now. "
                "Use this to verify claims before stating them -- e.g. before "
                "saying a piece is defended, hanging, or that a capture is safe."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "square": {"type": "string", "description": "e.g. 'f5'"},
                },
                "required": ["square"],
            },
        },
        {
            "name": "try_hypothetical_move",
            "description": (
                "Try a move HYPOTHETICALLY against the current position, without "
                "actually playing it. Returns whether it's legal, whether it gives "
                "check, the resulting material balance, and the engine's best reply. "
                "Use this to verify claims like 'does this move work' or 'what "
                "happens if I play X' before answering -- never guess or reason "
                "purely from intuition about a hypothetical when you can check it."
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "move_san": {"type": "string", "description": "e.g. 'Qb1' or 'Rxe3'"},
                },
                "required": ["move_san"],
            },
        },
        {
            "name": "respond_with_coaching",
            "description": "Returns the coaching reply along with squares to visually highlight on the board. Call this LAST, once you're done verifying anything you needed to check.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "response_text": {
                        "type": "string",
                        "description": "The Socratic question or explanation to display to the user.",
                    },
                    "highlight_squares": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of square coordinates (e.g. ['e8', 'f8']) relevant to the current hint.",
                    },
                },
                "required": ["response_text", "highlight_squares"],
            },
        },
    ]

    def execute_tool(tool_name: str, tool_input: Dict[str, Any]) -> Any:
        """Executes a verification tool against a SCRATCH COPY of the
        current board -- never the real session board. This boundary
        matters: exploring 'what if I play X' must never actually commit
        X to the game the student is solving."""
        scratch = board.copy()

        if tool_name == "check_square":
            try:
                square = chess.parse_square(tool_input["square"])
            except ValueError:
                return {"error": f"'{tool_input.get('square')}' is not a valid square"}
            piece = scratch.piece_at(square)
            return {
                "square": tool_input["square"],
                "occupied_by": piece.symbol() if piece else None,
                "white_attackers": [chess.square_name(s) for s in scratch.attackers(chess.WHITE, square)],
                "black_attackers": [chess.square_name(s) for s in scratch.attackers(chess.BLACK, square)],
            }

        elif tool_name == "try_hypothetical_move":
            move_san = tool_input.get("move_san", "")
            try:
                move = scratch.parse_san(move_san)
            except ValueError as e:
                return {"legal": False, "error": str(e)}
            material_before = material_balance_white_pov(scratch)
            scratch.push(move)
            return {
                "legal": True,
                "gives_check": scratch.is_check(),
                "resulting_fen": scratch.fen(),
                "material_balance_white_pov_cp": material_balance_white_pov(scratch),
                "material_swing_from_this_move_cp": material_balance_white_pov(scratch) - material_before,
            }

        return {"error": f"unknown tool '{tool_name}'"}

    messages = payload.conversation_history + [
        {
            "role": "user",
            "content": f"[Engine Context: {json.dumps(prompt_context)}]\nStudent: {payload.user_message}",
        }
    ]

    coach_client = build_client_from_env("coach")

    final_reply_text = None
    final_highlights: List[str] = []
    MAX_TOOL_ITERATIONS = 5

    for _ in range(MAX_TOOL_ITERATIONS):
        result = await coach_client.call(
            system=system_prompt,
            messages=messages,
            tools=tools,
        )

        if not result.tool_calls:
            # Model replied with plain text instead of calling
            # respond_with_coaching -- shouldn't normally happen since the
            # system prompt asks for it, but don't crash if it does.
            final_reply_text = result.text or "Let's keep going -- what do you see?"
            break

        respond_call = next((tc for tc in result.tool_calls if tc.name == "respond_with_coaching"), None)
        if respond_call:
            final_reply_text = respond_call.input.get("response_text", "")
            final_highlights = respond_call.input.get("highlight_squares", [])
            break

        # Otherwise it called one or more verification tools -- execute
        # them all and feed results back for the next iteration.
        tool_results = [execute_tool(tc.name, tc.input) for tc in result.tool_calls]
        messages.append(result.raw_assistant_message)
        messages.extend(coach_client.format_tool_results(result.tool_calls, tool_results))
    else:
        # Hit the iteration cap without a final reply -- fail safe rather
        # than loop forever on a confused model.
        final_reply_text = "Sorry, I got a bit stuck verifying that -- could you rephrase or try a specific move?"

    return ChatResponse(
        assistant_reply=final_reply_text,
        highlight_squares=final_highlights,
        user_solved_this_turn=user_solved,
        refutation_context=refutation_data,
        fen=board.fen(),
        line_complete=line_complete,
    )
