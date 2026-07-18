import { useState, useCallback } from 'preact/hooks';
import './app.css';
import { Board } from './Board.jsx';
import { TrainPanel } from './TrainPanel.jsx';

const TABS = ['Train', 'Motifs', 'Library'];

export function App() {
  const [fen, setFen] = useState('start');
  const [orientation, setOrientation] = useState('white');
  const [lastMove, setLastMove] = useState(null);
  const [activeTab, setActiveTab] = useState('Train');

  const handleFlip = useCallback(() => {
    setOrientation((o) => (o === 'white' ? 'black' : 'white'));
  }, []);

  const handlePositionLoad = useCallback((newFen, side) => {
    setFen(newFen);
    setOrientation(side === 'b' ? 'black' : 'white');
    setLastMove(null);
  }, []);

  return (
    <div class="app">
      <h1>♟ Socratic Chess Coach</h1>

      <Board fen={fen} orientation={orientation} lastMove={lastMove} onMove={setLastMove} />

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

        {activeTab === 'Train' && <TrainPanel onLoad={handlePositionLoad} onFlip={handleFlip} />}

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
