import { createContext } from 'preact';
import { useContext, useReducer } from 'preact/hooks';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

const initialState = {
  board: {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    orientation: 'white',
    lastMove: null,
  },
  engine: {
    status: 'idle', // 'idle' | 'loading' | 'ready' | 'thinking'
  },
  session: null, // { targetMove, analysis, hintStage } | null
  feedback: null, // { text, error } | null — transient UI message
  ui: {
    activeTab: 'Train',
  },
};

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function reducer(state, action) {
  switch (action.type) {
    case 'SET_FEN':
      return { ...state, board: { ...state.board, fen: action.fen } };

    case 'SET_ORIENTATION':
      return { ...state, board: { ...state.board, orientation: action.orientation } };

    case 'FLIP_ORIENTATION':
      return {
        ...state,
        board: {
          ...state.board,
          orientation: state.board.orientation === 'white' ? 'black' : 'white',
        },
      };

    case 'SET_LAST_MOVE':
      return { ...state, board: { ...state.board, lastMove: action.lastMove } };

    case 'ENGINE_STATUS':
      return { ...state, engine: { ...state.engine, status: action.status } };

    case 'SESSION_START':
      return {
        ...state,
        session: {
          targetMove: action.targetMove,
          analysis: action.analysis,
          hintStage: 0,
        },
      };

    case 'SESSION_HINT':
      return {
        ...state,
        session: state.session
          ? { ...state.session, hintStage: state.session.hintStage + 1 }
          : null,
      };

    case 'SESSION_END':
      return { ...state, session: null };

    case 'SET_FEEDBACK':
      return { ...state, feedback: action.feedback };

    case 'CLEAR_FEEDBACK':
      return { ...state, feedback: null };

    case 'SET_TAB':
      return { ...state, ui: { ...state.ui, activeTab: action.tab } };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context + provider + hook
// ---------------------------------------------------------------------------

const AppStateContext = createContext(null);
const AppDispatchContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <AppStateContext.Provider value={state}>
      <AppDispatchContext.Provider value={dispatch}>{children}</AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used within AppProvider');
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider');
  return ctx;
}
