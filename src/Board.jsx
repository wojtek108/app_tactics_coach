import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

/**
 * Thin Preact wrapper around chessground.
 *
 * Modes:
 *   view      — no moves (Stage 0 journaling, post-solve, loading)
 *   enumerate — Stage 1: any legal move is tried then snapped back;
 *               parent decides if it counts as a CCT find
 *   try       — Stage 2: any legal move is reported (candidate trial);
 *               parent may update FEN after engine reply
 *   commit    — Stage 3: only targetMove is accepted
 *
 * Promotion: chessground has no built-in picker. When a pawn reaches the
 * last rank we intercept, show a Q/R/B/N overlay, then commit/probe.
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

function matchesTarget(orig, dest, promo, targetUci) {
  if (!targetUci) return true;
  if (orig + dest !== targetUci.slice(0, 4)) return false;
  if (targetUci.length >= 5) {
    return (promo || 'q') === targetUci[4];
  }
  return true;
}

function toUci(orig, dest, promo) {
  return orig + dest + (promo || '');
}

/**
 * @param {object} props
 * @param {'view'|'enumerate'|'try'|'commit'} [props.mode]
 */
export function Board({
  fen,
  orientation,
  lastMove,
  onMove,
  mode = 'view',
  targetMove,
  onWrongMove,
  onCorrectMove,
  onProbeMove,
}) {
  const containerRef = useRef(null);
  const cgRef = useRef(null);
  const fenRef = useRef(fen);
  const modeRef = useRef(mode);
  const onMoveRef = useRef(onMove);
  const targetMoveRef = useRef(targetMove);
  const onWrongMoveRef = useRef(onWrongMove);
  const onCorrectMoveRef = useRef(onCorrectMove);
  const onProbeMoveRef = useRef(onProbeMove);

  const [pendingPromo, setPendingPromo] = useState(null);

  fenRef.current = fen;
  modeRef.current = mode;
  onMoveRef.current = onMove;
  targetMoveRef.current = targetMove;
  onWrongMoveRef.current = onWrongMove;
  onCorrectMoveRef.current = onCorrectMove;
  onProbeMoveRef.current = onProbeMove;

  function computeDests() {
    if (modeRef.current === 'view') return new Map();
    const game = new Chess(fenRef.current);
    const dests = new Map();
    for (const move of game.moves({ verbose: true })) {
      const entry = dests.get(move.from) || [];
      entry.push(move.to);
      dests.set(move.from, entry);
    }
    return dests;
  }

  function movableColor() {
    if (modeRef.current === 'view') return undefined;
    return orientation === 'white' ? 'white' : 'black';
  }

  function snapBack(cg) {
    if (cg) {
      cg.set({
        fen: fenRef.current,
        lastMove: undefined,
        movable: {
          color: movableColor(),
          dests: computeDests(),
          free: false,
        },
      });
    }
  }

  /** Probe modes: validate, report UCI, snap board back (parent owns FEN). */
  const probeMove = useCallback((orig, dest, promo) => {
    const cg = cgRef.current;
    const game = new Chess(fenRef.current);
    const moveOpts = { from: orig, to: dest };
    if (promo) moveOpts.promotion = promo;

    let move;
    try {
      move = game.move(moveOpts);
    } catch {
      snapBack(cg);
      return;
    }
    if (!move) {
      snapBack(cg);
      return;
    }

    const uci = toUci(orig, dest, promo || move.promotion || null);
    snapBack(cg);
    if (onProbeMoveRef.current) {
      onProbeMoveRef.current({
        uci,
        san: move.san,
        from: orig,
        to: dest,
        promo: promo || move.promotion || null,
        isCheck: game.inCheck(),
        isCapture: !!move.captured,
      });
    }
  }, []);

  /** Commit mode: enforce targetMove, update board on success. */
  const commitMove = useCallback((orig, dest, promo) => {
    const cg = cgRef.current;
    const game = new Chess(fenRef.current);
    const moveOpts = { from: orig, to: dest };
    if (promo) moveOpts.promotion = promo;

    let move;
    try {
      move = game.move(moveOpts);
    } catch {
      snapBack(cg);
      return;
    }
    if (!move) {
      snapBack(cg);
      return;
    }

    if (targetMoveRef.current) {
      if (!matchesTarget(orig, dest, promo, targetMoveRef.current)) {
        snapBack(cg);
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
        movable: { color: undefined, dests: new Map(), free: false },
      });
    }
    if (onMoveRef.current) onMoveRef.current(lm);
  }, []);

  const handleResolvedMove = useCallback(
    (orig, dest, promo) => {
      const m = modeRef.current;
      if (m === 'view') {
        snapBack(cgRef.current);
        return;
      }
      if (m === 'enumerate' || m === 'try') {
        probeMove(orig, dest, promo);
        return;
      }
      // commit
      commitMove(orig, dest, promo);
    },
    [probeMove, commitMove],
  );

  const cancelPromo = useCallback(() => {
    setPendingPromo(null);
    snapBack(cgRef.current);
  }, []);

  const pickPromo = useCallback(
    (letter) => {
      if (!pendingPromo) return;
      const { orig, dest } = pendingPromo;
      setPendingPromo(null);
      handleResolvedMove(orig, dest, letter);
    },
    [pendingPromo, handleResolvedMove],
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
          color: movableColor(),
          dests: computeDests(),
          free: false,
        },
        animation: { enabled: true, duration: 200 },
        drawable: { enabled: false },
        events: {
          move: (orig, dest) => {
            if (modeRef.current === 'view') {
              snapBack(cg);
              return;
            }
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
            handleResolvedMove(orig, dest, null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync props → chessground
  useEffect(() => {
    setPendingPromo(null);
    const cg = cgRef.current;
    if (!cg) return;
    cg.set({
      fen,
      orientation,
      lastMove: lastMove || undefined,
      movable: {
        color: movableColor(),
        dests: computeDests(),
        free: false,
      },
    });
  }, [fen, orientation, lastMove, mode, targetMove]);

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
          <div class="promo-picker" onClick={(e) => e.stopPropagation()}>
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
