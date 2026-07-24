import { useState } from 'preact/hooks';
import { Chess } from 'chess.js';
import { Chessground } from 'chessground';
import { MOTIFS } from './motifs.js';
import { useAppDispatch } from './context.jsx';

/**
 * Motifs reference tab (M3).
 *
 * Each motif card shows name, category, summary. Click to expand and see
 * the full description plus a mini chessground diagram. Click the diagram
 * or "Train on this" button to load the example into Train mode.
 */

function MiniBoard({ fen, lastMove }) {
  // Chessground is imperative — we init on mount and clean up on unmount.
  // Using a ref + useEffect to manage the lifecycle.
  const ref = (el) => {
    if (!el) return;
    el.innerHTML = '';
    try {
      Chessground(el, {
        fen,
        viewOnly: true,
        coordinates: false,
        lastMove: lastMove || undefined,
        animation: { enabled: false },
        drawable: { enabled: false },
      });
    } catch {
      // Silent — mini boards are decorative
    }
  };

  return <div class="motif-board cg-wrap" ref={ref} />;
}

export function MotifsView() {
  const dispatch = useAppDispatch();
  const [expandedId, setExpandedId] = useState(null);

  const handleLoadExample = (motif) => {
    // Load the example FEN into Train mode
    dispatch({ type: 'SET_TAB', tab: 'Train' });
    // Signal to TrainPanel: we'll dispatch a custom event
    window.dispatchEvent(
      new CustomEvent('scc:load-fen', { detail: { fen: motif.exampleFen } }),
    );
  };

  return (
    <div class="motifs-list">
      {MOTIFS.map((motif) => {
        const isExpanded = expandedId === motif.id;
        let lastMove = null;
        try {
          const game = new Chess(motif.exampleFen);
          const move = game.move({
            from: motif.exampleMoveUci.slice(0, 2),
            to: motif.exampleMoveUci.slice(2, 4),
            promotion: motif.exampleMoveUci.length > 4 ? motif.exampleMoveUci[4] : undefined,
          });
          if (move) {
            lastMove = [move.from, move.to];
          }
        } catch {
          // Ignore — mini board just won't show last move
        }

        return (
          <div
            key={motif.id}
            class={`motif-card ${isExpanded ? 'expanded' : ''}`}
            onClick={() => setExpandedId(isExpanded ? null : motif.id)}
          >
            <div class="motif-card-header">
              <span class="motif-card-name">{motif.name}</span>
              <span class="motif-card-category">{motif.category}</span>
            </div>
            <div class="motif-card-summary">{motif.summary}</div>

            {isExpanded && (
              <div class="motif-card-body" onClick={(e) => e.stopPropagation()}>
                <div class="motif-description">{motif.description}</div>
                <div class="motif-board-wrap">
                  <MiniBoard fen={motif.exampleFen} lastMove={lastMove} />
                </div>
                <button
                  class="motif-example-btn"
                  onClick={() => handleLoadExample(motif)}
                >
                  Train on this position
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
