import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

/**
 * Thin Preact wrapper around chessground.
 *
 * chessground is imperative — you call Chessground(el, config) and then
 * call .set(config) to update it. This component manages that lifecycle
 * so the rest of the app sees declarative props.
 *
 * Moves are validated against chess.js: when the user drops a piece,
 * we try the move on a scratch game. Legal moves become lastMove[]
 * so the board gets a highlight; illegal pieces snap back.
 *
 * Promotion: chessground has no built-in picker. When a pawn reaches the
 * last rank we intercept, show a Q/R/B/N overlay, and only then commit
 * the move (including the promotion piece in the UCI string for training).
 */
/**
 * targetMove  — UCI string (e.g. "e2e4" or "e7e8q"). When set, only this
 *               exact move is accepted; all other legal moves snap back
 *               and call onWrongMove.
 * onWrongMove — called with (from, to) when the user makes a legal-but-wrong move
 * onCorrectMove — called with (from, to) when the user finds the target move
 */

const PROMO_CHOICES = [
  { letter: 'q', role: 'queen', label: 'Queen' },
  { letter: 'r', role: 'rook', label: 'Rook' },
  { letter: 'n', role: 'knight', label: 'Knight' },
  { letter: 'b', role: 'bishop', label: 'Bishop' },
];

function isPromotionMove(fen, orig, dest) {
  const game = new Chess(fen);
  const piece = game.get(orig);
  if (!piece || piece.type !== 'p') return false;
  const rank = dest[1];
  return (piece.color === 'w' && rank === '8') || (piece.color === 'b' && rank === '1');
}

/** True if the user's move matches the engine target (incl. underpromotion). */
function matchesTarget(orig, dest, promo, targetUci) {
  if (!targetUci) return true;
  if (orig + dest !== targetUci.slice(0, 4)) return false;
  // Target specifies a promotion piece — must match exactly.
  if (targetUci.length >= 5) {
    return (promo || 'q') === targetUci[4];
  }
  return true;
}

export function Board({ fen, orientation, lastMove, onMove, targetMove, onWrongMove, onCorrectMove }) {
  const containerRef = useRef(null);
  const cgRef = useRef(null);
  const fenRef = useRef(fen);
  const onMoveRef = useRef(onMove);
  const targetMoveRef = useRef(targetMove);
  const onWrongMoveRef = useRef(onWrongMove);
  const onCorrectMoveRef = useRef(onCorrectMove);

  // Pending promotion: { orig, dest, color: 'w'|'b' }
  const [pendingPromo, setPendingPromo] = useState(null);

  fenRef.current = fen;
  onMoveRef.current = onMove;
  targetMoveRef.current = targetMove;
  onWrongMoveRef.current = onWrongMove;
  onCorrectMoveRef.current = onCorrectMove;

  // Compute legal move destinations for the selected piece
  function computeDests() {
    const game = new Chess(fenRef.current);
    const dests = new Map();
    for (const move of game.moves({ verbose: true })) {
      const entry = dests.get(move.from) || [];
      entry.push(move.to);
      dests.set(move.from, entry);
    }
    return dests;
  }

  /** Commit a validated move (promo is 'q'|'r'|'n'|'b' or null). */
  const commitMove = useCallback((orig, dest, promo) => {
    const cg = cgRef.current;
    const game = new Chess(fenRef.current);
    const moveOpts = { from: orig, to: dest };
    if (promo) moveOpts.promotion = promo;

    const move = game.move(moveOpts);
    if (!move) {
      if (cg) cg.set({ fen: fenRef.current });
      return;
    }

    // Training mode: check against engine target (full UCI for promos)
    if (targetMoveRef.current) {
      if (!matchesTarget(orig, dest, promo, targetMoveRef.current)) {
        if (cg) cg.set({ fen: fenRef.current, lastMove: undefined });
        if (onWrongMoveRef.current) onWrongMoveRef.current(orig, dest);
        return;
      }
      if (onCorrectMoveRef.current) onCorrectMoveRef.current(orig, dest);
    }

    const lm = [orig, dest];
    if (cg) {
      cg.set({
        fen: game.fen(),
        lastMove: lm,
        movable: { dests: new Map() }, // freeze after a move until parent reloads
      });
    }
    if (onMoveRef.current) onMoveRef.current(lm);
  }, []);

  const cancelPromo = useCallback(() => {
    setPendingPromo(null);
    const cg = cgRef.current;
    if (cg) cg.set({ fen: fenRef.current });
  }, []);

  const pickPromo = useCallback(
    (letter) => {
      if (!pendingPromo) return;
      const { orig, dest } = pendingPromo;
      setPendingPromo(null);
      commitMove(orig, dest, letter);
    },
    [pendingPromo, commitMove],
  );

  // Init chessground once on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;

    try {
      const cg = Chessground(el, {
        fen,
        orientation,
        lastMove: lastMove || undefined,
        movable: {
          color: orientation === 'white' ? 'white' : 'black',
          dests: computeDests(),
          free: false,
        },
        animation: { enabled: true, duration: 200 },
        drawable: { enabled: false },
        events: {
          move: (orig, dest) => {
            // Promotion: chessground already dragged the pawn visually —
            // snap back and ask the user which piece they want.
            if (isPromotionMove(fenRef.current, orig, dest)) {
              cg.set({ fen: fenRef.current });
              const piece = new Chess(fenRef.current).get(orig);
              setPendingPromo({
                orig,
                dest,
                color: piece?.color === 'b' ? 'black' : 'white',
              });
              return;
            }

            commitMove(orig, dest, null);
          },
        },
      });

      cgRef.current = cg;
    } catch (err) {
      console.error('Chessground init failed:', err);
    }

    return () => {
      el.innerHTML = '';
    };
    // Mount-only: fen/orientation/lastMove applied via the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update chessground when props change; drop any open promotion dialog.
  useEffect(() => {
    setPendingPromo(null);
    const cg = cgRef.current;
    if (!cg) return;
    cg.set({
      fen,
      orientation,
      lastMove: lastMove || undefined,
      movable: {
        color: orientation === 'white' ? 'white' : 'black',
        dests: computeDests(),
        free: false,
      },
    });
  }, [fen, orientation, lastMove]);

  // Escape cancels promotion (defaults not applied — user must re-move)
  useEffect(() => {
    if (!pendingPromo) return;
    const onKey = (e) => {
      if (e.key === 'Escape') cancelPromo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingPromo, cancelPromo]);

  return (
    <div class="board-wrap">
      <div class="board-container cg-wrap" ref={containerRef} />

      {pendingPromo && (
        <div
          class="promo-overlay"
          role="dialog"
          aria-label="Choose promotion piece"
          onClick={cancelPromo}
        >
          <div
            class="promo-picker"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="promo-label">Promote to</div>
            <div class="promo-choices">
              {PROMO_CHOICES.map(({ letter, role, label }) => (
                <button
                  key={letter}
                  type="button"
                  class="promo-btn"
                  title={label}
                  aria-label={label}
                  onClick={() => pickPromo(letter)}
                >
                  <piece class={`${pendingPromo.color} ${role}`} />
                </button>
              ))}
            </div>
            <button type="button" class="promo-cancel" onClick={cancelPromo}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
