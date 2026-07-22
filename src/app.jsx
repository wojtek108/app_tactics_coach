import { useState, useCallback } from 'preact/hooks';
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

  const handleWrongMove = useCallback(() => {
    setFeedback({ text: "That's legal, but there's a much better way. Try again!", error: false });
  }, []);

  const handleCorrectMove = useCallback(() => {
    setPuzzleSolved(true);
    setTargetMove(null);
    setFeedback(null);
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
