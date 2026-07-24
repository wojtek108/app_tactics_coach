import { useState, useCallback, useRef } from 'preact/hooks';
import './app.css';
import { Board } from './Board.jsx';
import { TrainPanel } from './TrainPanel.jsx';

const TABS = ['Train', 'Motifs', 'Library'];

export function App() {
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [orientation, setOrientation] = useState('white');
  const [lastMove, setLastMove] = useState(null);
  const [activeTab, setActiveTab] = useState('Train');

  // Training mode state
  const [targetMove, setTargetMove] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [puzzleSolved, setPuzzleSolved] = useState(false);

  // Latest analysis from the engine, stored in a ref so the Board's
  // onCorrectMove handler (which has a stale closure over trainPanel state)
  // can still produce a celebration message.
  const analysisRef = useRef(null);

  const handleFlip = useCallback(() => {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  }, []);

  const handlePositionLoad = useCallback((newFen, side, engineMove) => {
    setFen(newFen);
    setOrientation(side === 'b' ? 'black' : 'white');
    setLastMove(null);
    setTargetMove(engineMove || null);
    setFeedback(null);
    setPuzzleSolved(false);
  }, []);

  // TrainPanel calls this when the engine finishes analyzing, so App
  // can produce a celebration message when the user finds the move.
  const handleAnalysisReady = useCallback((analysis) => {
    analysisRef.current = analysis;
  }, []);

  const handleWrongMove = useCallback(() => {
    setFeedback({ text: "That's legal, but there's a much better way. Try again!", error: false });
  }, []);

  const handleCorrectMove = useCallback(() => {
    setPuzzleSolved(true);
    setTargetMove(null);

    // Build celebration from the analysis ref — avoids dependency on
    // TrainPanel's useEffect which can fail if analysis state is stale.
    const a = analysisRef.current;
    if (a) {
      const piece = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' }[a.movingType];
      const to = a.to;
      let why = '';
      if (a.isFork) why = ` — it's a fork attacking ${a.forkTargets.length} pieces`;
      else if (a.pinInfo && a.pinInfo.type === 'pin') why = ` — it pins the enemy ${piece} to the king`;
      else if (a.pinInfo && a.pinInfo.type === 'skewer') why = ` — it's a skewer`;
      else if (a.isDiscoveredCheck) why = ' — a discovered check';
      else if (a.isDirectCheck) why = ' — a direct check';

      setFeedback({
        text: `🎉 Correct! ${piece} to ${to} is the best move.${why}`,
        error: false,
      });
    } else {
      setFeedback({ text: '🎉 Correct! That is the best move.', error: false });
    }
  }, []);

  return (
    <div class="app">
      <h1>♟ Socratic Chess Coach</h1>

      <Board
        fen={fen}
        orientation={orientation}
        lastMove={lastMove}
        onMove={setLastMove}
        targetMove={targetMove}
        onWrongMove={handleWrongMove}
        onCorrectMove={handleCorrectMove}
      />

      <div class="panel">
        <div class="tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              class={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'Train' && (
          <TrainPanel
            onLoad={handlePositionLoad}
            onFlip={handleFlip}
            feedback={feedback}
            puzzleSolved={puzzleSolved}
            onAnalysisReady={handleAnalysisReady}
          />
        )}

        {activeTab === 'Motifs' && (
          <div style="text-align:center; padding:40px; color:#666;">
            Tactics reference — coming soon
          </div>
        )}

        {activeTab === 'Library' && (
          <div style="text-align:center; padding:40px; color:#666;">
            Position library — coming soon
          </div>
        )}
      </div>
    </div>
  );
}
