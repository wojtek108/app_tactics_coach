import { useEffect, useRef } from 'preact/hooks';
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
 */
/**
 * targetMove  — UCI string (e.g. "e2e4"). When set, only this exact move
 *               is accepted; all other legal moves snap back and call
 *               onWrongMove.
 * onWrongMove — called with (from, to) when the user makes a legal-but-wrong move
 * onCorrectMove — called with (from, to) when the user finds the target move
 */
export function Board({ fen, orientation, lastMove, onMove, targetMove, onWrongMove, onCorrectMove }) {
  const containerRef = useRef(null);
  const cgRef = useRef(null);
  const fenRef = useRef(fen);
  const onMoveRef = useRef(onMove);
  const targetMoveRef = useRef(targetMove);
  const onWrongMoveRef = useRef(onWrongMove);
  const onCorrectMoveRef = useRef(onCorrectMove);

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

  // Init chessground once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const cg = Chessground(containerRef.current, {
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
            const game = new Chess(fenRef.current);
            const move = game.move({ from: orig, to: dest, promotion: 'q' });

            if (move) {
              // Legal move. If training with a target, check correctness.
              if (targetMoveRef.current) {
                const userMove = orig + dest;
                // targetMove may have a 5th char for promotion (e.g. "e7e8q")
                if (userMove !== targetMoveRef.current.slice(0, 4)) {
                  cg.set({ fen: fenRef.current });
                  if (onWrongMoveRef.current) onWrongMoveRef.current(orig, dest);
                  return;
                }
                if (onCorrectMoveRef.current) onCorrectMoveRef.current(orig, dest);
              }
              const lm = [orig, dest];
              if (onMoveRef.current) onMoveRef.current(lm);
            } else {
              // Illegal — reset the board state
              cg.set({ fen: fenRef.current });
            }
          },
        },
      });

      cgRef.current = cg;
    } catch (err) {
      console.error('Chessground init failed:', err);
    }

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  // Update chessground when props change
  useEffect(() => {
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

  return <div class="board-container cg-wrap" ref={containerRef} />;
}
