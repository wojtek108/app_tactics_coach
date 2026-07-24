import { Component } from 'preact';
import { useCallback, useRef, useState } from 'preact/hooks';
import './app.css';
import { AppProvider, useAppState, useAppDispatch } from './context.jsx';
import { Board } from './Board.jsx';
import { TrainPanel } from './TrainPanel.jsx';
import { MotifsView } from './MotifsView.jsx';
import { LibraryView } from './LibraryView.jsx';

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
    // Signal TrainPanel to show the recognition step — feedback comes after
    dispatch({ type: 'SHOW_RECOGNITION' });
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

          {ui.activeTab === 'Motifs' && <MotifsView />}

          {ui.activeTab === 'Library' && <LibraryView />}
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
