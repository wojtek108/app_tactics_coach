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
export function Board({ fen, orientation, lastMove, onMove }) {
  const containerRef = useRef(null);
  const cgRef = useRef(null);
  const fenRef = useRef(fen);
  const onMoveRef = useRef(onMove);

  fenRef.current = fen;
  onMoveRef.current = onMove; // always point to latest callback (avoids stale closure)

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
          // When the user drops, chessground has already moved the piece
          // visually. We validate against chess.js. If illegal, we reset.
          const game = new Chess(fenRef.current);
          const move = game.move({ from: orig, to: dest, promotion: 'q' });

          if (move) {
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
