"""
Corrected engine analysis service.

Fixes vs. the previous draft:
1. Pin/skewer detection uses python-chess's board.is_pinned() instead of
   naive rank/file/diagonal matching (which flagged ~every piece on the
   board as "aligned" with a king).
2. Single persistent engine process (started once, reused across
   requests) instead of popen_uci()/quit() per call.
3. Consistent eval perspective: always reported from White's point of
   view (pov(chess.WHITE)) so the sign doesn't flip depending on whose
   move it is after a refutation push.
"""

import chess
import chess.engine
from typing import Dict, Any, List, Optional


class ChessAnalysisService:
    def __init__(self, stockfish_path: str = "/usr/games/stockfish"):
        self.stockfish_path = stockfish_path
        self._engine: Optional[chess.engine.UciProtocol] = None
        self._transport = None

    async def start(self):
        """Call once at app startup."""
        self._transport, self._engine = await chess.engine.popen_uci(self.stockfish_path)

    async def stop(self):
        """Call once at app shutdown."""
        if self._engine:
            await self._engine.quit()

    async def _analyse_with_retry(self, board: chess.Board, limit: chess.engine.Limit, **kwargs):
        """Runs engine.analyse(), restarting the engine once and retrying
        if the process died (e.g. OOM kill) since the last call.

        Note: engine.transport.is_closing() is NOT a reliable pre-flight
        health check here — verified it stays False even after SIGKILLing
        the process. The only reliable signal is EngineTerminatedError
        raised when you actually try to use the dead engine, so recovery
        has to be reactive (catch-and-restart), not a check-before-use.
        """
        try:
            return await self._engine.analyse(board, limit, **kwargs)
        except chess.engine.EngineTerminatedError:
            await self.start()
            return await self._engine.analyse(board, limit, **kwargs)

    async def analyze_position(self, fen: str, depth: int = 20, time_limit: float = 2.0) -> Dict[str, Any]:
        board = chess.Board(fen)

        info = await self._analyse_with_retry(
            board,
            chess.engine.Limit(depth=depth, time=time_limit),
            multipv=3,
        )

        best_move = info[0]["pv"][0] if info and "pv" in info[0] else None

        return {
            "fen": fen,
            "best_move_uci": best_move.uci() if best_move else None,
            "best_move_san": board.san(best_move) if best_move else None,
            "eval_cp_white_pov": info[0]["score"].pov(chess.WHITE).score(mate_score=10000) if info else 0,
            "multipv": [
                {
                    "rank": idx + 1,
                    "move_uci": line["pv"][0].uci(),
                    "move_san": board.san(line["pv"][0]),
                    "eval_cp_white_pov": line["score"].pov(chess.WHITE).score(mate_score=10000),
                }
                for idx, line in enumerate(info) if "pv" in line
            ],
            "structural_signals": {
                "hanging_pieces": self._get_hanging_pieces(board),
                "undervalued_targets": self._get_undervalued_targets(board),
                "pins": self._get_real_pins(board),
            },
        }

    async def refute_move(self, fen: str, proposed_move_san: str) -> Optional[Dict[str, Any]]:
        board = chess.Board(fen)

        try:
            user_move = board.parse_san(proposed_move_san)
        except ValueError:
            return None  # illegal or unparseable

        board.push(user_move)

        info = await self._analyse_with_retry(
            board,
            chess.engine.Limit(depth=12, time=0.5),
        )

        pv = info.get("pv", [])
        refutation_move = pv[0] if pv else None  # empty pv is possible on sudden mate

        return {
            "proposed_move": proposed_move_san,
            "refutation_move_san": board.san(refutation_move) if refutation_move else None,
            # consistent White-POV eval so the sign means the same thing
            # regardless of whose move it now is
            "eval_cp_white_pov": info["score"].pov(chess.WHITE).score(mate_score=10000),
        }

    async def compare_candidates(
        self, fen: str, candidate_moves_san: List[str], depth: int = 16, pv_length: int = 6
    ) -> List[Dict[str, Any]]:
        """Evaluates multiple candidate first moves HEAD TO HEAD from the
        same position, each restricted via root_moves so the engine is
        forced to actually analyse that specific move rather than just
        reporting its single overall favorite. This is what makes genuine
        candidate-move comparison possible -- 'if I play A vs if I play B'
        side by side -- rather than only ever seeing the engine's one top
        choice. Verified against a real position: comparing e3 vs an
        immediate Qb1 correctly showed e3 at +2.42 and Qb1 at essentially
        -infinity (walks into a forced mate), matching hand analysis.

        Illegal candidates are reported with legal=False rather than
        raising, so one bad candidate in a list doesn't kill the others."""
        board = chess.Board(fen)
        results = []

        for cand_san in candidate_moves_san:
            try:
                move = board.parse_san(cand_san)
            except ValueError as e:
                results.append({"candidate": cand_san, "legal": False, "error": str(e)})
                continue

            info = await self._analyse_with_retry(
                board, chess.engine.Limit(depth=depth), root_moves=[move]
            )
            pv = info.get("pv", [])
            b2 = board.copy()
            pv_sans = []
            for m in pv[:pv_length]:
                pv_sans.append(b2.san(m))
                b2.push(m)

            results.append({
                "candidate": cand_san,
                "legal": True,
                "eval_cp_white_pov": info["score"].pov(chess.WHITE).score(mate_score=100000),
                "continuation": pv_sans,
            })

        return results

    async def explore_line(self, fen: str, moves_san: List[str]) -> Dict[str, Any]:
        """Plays out a SPECIFIC sequence of moves (student's own calculated
        line) against a scratch board, stopping and reporting exactly where
        it breaks if a move turns out to be illegal. On success, also
        returns the engine's own suggested continuation from the resulting
        position, so 'what happens after my calculated line' doesn't
        require the student to specify every subsequent move themselves."""
        board = chess.Board(fen)
        played = []

        for i, move_san in enumerate(moves_san):
            try:
                move = board.parse_san(move_san)
            except ValueError as e:
                return {
                    "fully_legal": False,
                    "moves_played": played,
                    "failed_at_move_index": i,
                    "failed_move": move_san,
                    "error": str(e),
                }
            played.append(board.san(move))
            board.push(move)

        result: Dict[str, Any] = {
            "fully_legal": True,
            "moves_played": played,
            "resulting_fen": board.fen(),
            "gives_check": board.is_check(),
            "is_checkmate": board.is_checkmate(),
        }

        if not board.is_game_over():
            info = await self._analyse_with_retry(board, chess.engine.Limit(depth=16))
            pv = info.get("pv", [])
            b2 = board.copy()
            pv_sans = []
            for m in pv[:6]:
                pv_sans.append(b2.san(m))
                b2.push(m)
            result["eval_cp_white_pov"] = info["score"].pov(chess.WHITE).score(mate_score=100000)
            result["engine_suggested_continuation"] = pv_sans

        return result

    def _get_undervalued_targets(self, board: chess.Board) -> List[Dict[str, Any]]:
        """Flags pieces attacked by something worth LESS, regardless of
        defender count. _get_hanging_pieces() alone misses this: a rook
        attacked once by a pawn and 'defended' once by a bishop looks even
        by attacker/defender count, but the pawn can still take the rook
        for a huge material swing -- the count never being unequal doesn't
        mean the trade is fair. This is what a static-exchange-evaluation
        (SEE) check catches that a naive count doesn't. Verified against a
        real position where this was the entire point of the tactic and
        _get_hanging_pieces returned nothing for it."""
        piece_values = {
            chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3,
            chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0,
        }
        flagged = []
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if not piece:
                continue
            attackers = board.attackers(not piece.color, square)
            if not attackers:
                continue
            cheapest_attacker_value = min(piece_values[board.piece_at(a).piece_type] for a in attackers)
            piece_value = piece_values[piece.piece_type]
            if cheapest_attacker_value < piece_value:
                flagged.append({
                    "square": chess.square_name(square),
                    "piece": piece.symbol(),
                    "piece_value": piece_value,
                    "cheapest_attacker_value": cheapest_attacker_value,
                })
        return flagged

    def _get_hanging_pieces(self, board: chess.Board) -> List[Dict[str, Any]]:
        hanging = []
        for square in chess.SQUARES:
            piece = board.piece_at(square)
            if piece:
                attackers = board.attackers(not piece.color, square)
                # "defenders" = pieces of the SAME color attacking their own
                # square (python-chess has no separate defenders() method —
                # attackers() by the piece's own color is exactly this)
                defenders = board.attackers(piece.color, square)
                if len(attackers) > len(defenders):
                    hanging.append({
                        "square": chess.square_name(square),
                        "piece": piece.symbol(),
                        "attackers_count": len(attackers),
                        "defenders_count": len(defenders),
                    })
        return hanging

    def _get_real_pins(self, board: chess.Board) -> List[Dict[str, Any]]:
        """Uses python-chess's built-in pin detection instead of manual
        rank/file/diagonal geometry, which produces false positives for
        every piece that merely shares a line with a king."""
        pins = []
        for color in (chess.WHITE, chess.BLACK):
            for square in chess.SQUARES:
                piece = board.piece_at(square)
                if piece and piece.color == color and board.is_pinned(color, square):
                    pins.append({
                        "pinned_color": "white" if color else "black",
                        "pinned_square": chess.square_name(square),
                        "pinned_piece": piece.symbol(),
                    })
        return pins

