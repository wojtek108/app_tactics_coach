import { Component } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import './app.css';
import { AppProvider, useAppState, useAppDispatch } from './context.jsx';
import { Board } from './Board.jsx';
import { TrainPanel } from './TrainPanel.jsx';

const TABS = ['Train', 'Motifs', 'Library'];

class ErrorBoundary extends Component {
  state = { error: null };
  componentDidCatch(error) {
    this.setState({ error });
  }
  render() {
    if (this.state.error) {
      return (
        <div class="panel" style="text-align:center; padding:40px;">
          <p style="color:#ef5350; margin-bottom:12px;">Something went wrong.</p>
          <button class="btn-main" onClick={() => location.reload()}>Reload the page</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppInner() {
  const { board, session, ui } = useAppState();
  const dispatch = useAppDispatch();

  // Latest analysis from the engine, stored in a ref so the Board's
  // onCorrectMove handler (which has a stale closure) can still produce
  // a celebration message.
  const analysisRef = useRef(null);

  // Board mode controlled by TrainPanel's staged flow
  const [boardMode, setBoardMode] = useState('view');

  // Ref to TrainPanel's probe handler — set by TrainPanel on mount
  const probeHandlerRef = useRef(null);

  const handleFlip = useCallback(() => {
    dispatch({ type: 'FLIP_ORIENTATION' });
  }, [dispatch]);

  const handleAnalysisReady = useCallback((analysis) => {
    analysisRef.current = analysis;
  }, []);

  const handleWrongMove = useCallback(() => {
    dispatch({
      type: 'SET_FEEDBACK',
      feedback: { text: "That's legal, but there's a much better way. Try again!", error: false },
    });
  }, [dispatch]);

  const handleCorrectMove = useCallback(() => {
    dispatch({ type: 'SESSION_END' });
    dispatch({ type: 'SET_LAST_MOVE', lastMove: null });

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

      dispatch({
        type: 'SET_FEEDBACK',
        feedback: { text: `🎉 Correct! ${piece} to ${to} is the best move.${why}`, error: false },
      });
    } else {
      dispatch({
        type: 'SET_FEEDBACK',
        feedback: { text: '🎉 Correct! That is the best move.', error: false },
      });
    }
  }, [dispatch]);

  // Board probe handler — delegates to TrainPanel's current stage handler
  const handleBoardProbe = useCallback((moveInfo) => {
    if (probeHandlerRef.current) probeHandlerRef.current(moveInfo);
  }, []);

  return (
    <ErrorBoundary>
      <div class="app">
        <h1>♟ Socratic Chess Coach</h1>

        <Board
          fen={board.fen}
          orientation={board.orientation}
          lastMove={board.lastMove}
          onMove={(lm) => dispatch({ type: 'SET_LAST_MOVE', lastMove: lm })}
          mode={boardMode}
          targetMove={session ? session.targetMove : null}
          onWrongMove={handleWrongMove}
          onCorrectMove={handleCorrectMove}
          onProbeMove={boardMode === 'enumerate' || boardMode === 'try' ? handleBoardProbe : undefined}
        />

        <div class="panel">
          <div class="tabs">
            {TABS.map((tab) => (
              <button
                key={tab}
                class={`tab-btn ${ui.activeTab === tab ? 'active' : ''}`}
                onClick={() => dispatch({ type: 'SET_TAB', tab })}
              >
                {tab}
              </button>
            ))}
          </div>

          {ui.activeTab === 'Train' && (
            <TrainPanel
              onFlip={handleFlip}
              onAnalysisReady={handleAnalysisReady}
              onBoardModeChange={setBoardMode}
              probeHandlerRef={probeHandlerRef}
            />
          )}

          {ui.activeTab === 'Motifs' && (
            <div style="text-align:center; padding:40px; color:#666;">
              Tactics reference — coming soon
            </div>
          )}

          {ui.activeTab === 'Library' && (
            <div style="text-align:center; padding:40px; color:#666;">
              Position library — coming soon
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  );
}
