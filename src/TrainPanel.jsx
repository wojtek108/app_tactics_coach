import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Chess } from 'chess.js';
import { createEngine } from './lib/engine.js';
import { analyzeMove } from './lib/analyzer.js';

const SIDES = [
  { value: 'fen', label: 'From FEN' },
  { value: 'w', label: 'White to move' },
  { value: 'b', label: 'Black to move' },
];

// ---------------------------------------------------------------------------
// Sample positions — curated FENs with known tactical themes
// ---------------------------------------------------------------------------
const SAMPLE_POSITIONS = [
  { label: '— Try a sample puzzle —', fen: '' },
  { label: 'Knight fork (easy)', fen: '8/8/2k3q1/8/6N1/8/8/4K3 w - - 0 1' },
  { label: 'Pin to the king', fen: '4k3/4n3/8/8/8/8/8/R6K w - - 0 1' },
  { label: 'Discovered check', fen: '3k4/8/8/3B4/8/8/8/3RK3 w - - 0 1' },
  { label: 'Skewer (rook)', fen: '3qk3/8/3b4/8/8/8/8/3RK3 w - - 0 1' },
  { label: 'Back-rank mate', fen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1' },
  { label: 'Queen fork', fen: '4k3/8/4n3/8/8/8/8/Q3K3 w - - 0 1' },
  { label: 'Double attack', fen: '4k3/8/3r1b2/8/8/8/8/3QK3 w - - 0 1' },
];

const PIECE_NAMES = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King',
};

// ---------------------------------------------------------------------------
// Hint text helpers (ported from prototype)
// ---------------------------------------------------------------------------

function categoryHint(a) {
  if (a.isDiscoveredCheck) {
    return "There's a discovered check hiding here — moving one piece out of the way unleashes an attack from another.";
  }
  if (a.isDirectCheck) {
    return "There's a direct check available for you.";
  }
  if (a.isFork) {
    return 'One of your pieces can land on a square that attacks two enemy pieces at once — a fork.';
  }
  if (a.pinInfo && a.pinInfo.type === 'pin') {
    return 'Look for a move that pins an enemy piece against something more valuable behind it.';
  }
  if (a.pinInfo && a.pinInfo.type === 'skewer') {
    return "There's a skewer available — attacking one piece exposes something bigger standing right behind it.";
  }
  if (a.isCapture) {
    return "There's a profitable capture on the board.";
  }
  if (a.threat) {
    return "This move creates a threat against an enemy piece that isn't defended.";
  }
  return 'Look at how your pieces line up with the enemy king and with undefended pieces along ranks, files, and diagonals.';
}

function explainMove(a) {
  const parts = [];
  if (a.isCapture)
    parts.push(`it captures the ${PIECE_NAMES[a.capturedType].toLowerCase()} on ${a.to}`);
  if (a.isDiscoveredCheck) parts.push('it opens a discovered check from another piece');
  else if (a.isDirectCheck) parts.push('it delivers check directly');
  if (a.isFork) parts.push(`it forks ${a.forkTargets.length} pieces at once`);
  if (a.pinInfo && a.pinInfo.type === 'pin')
    parts.push(
      `it pins the ${PIECE_NAMES[a.pinInfo.pinnedType].toLowerCase()} on ${a.pinInfo.pinnedSquare} to the king`,
    );
  if (a.pinInfo && a.pinInfo.type === 'skewer')
    parts.push(
      `it skewers the ${PIECE_NAMES[a.pinInfo.frontType].toLowerCase()} into the ${PIECE_NAMES[a.pinInfo.backType].toLowerCase()} behind it`,
    );
  if (a.threat && parts.length === 0)
    parts.push(`it threatens the undefended ${PIECE_NAMES[a.threat.type].toLowerCase()} on ${a.threat.square}`);

  if (parts.length === 0)
    return "It's the strongest positional option available — not a forcing tactic, just the best improvement on the board.";
  return parts.join(', and ') + '.';
}

function applySideOverride(fen, side) {
  if (side === 'fen') return fen;
  const fields = fen.split(/\s+/);
  while (fields.length < 6)
    fields.push(
      fields.length === 3 ? '-' : fields.length === 2 ? '-' : fields.length === 4 ? '0' : '1',
    );
  fields[1] = side; // active color
  fields[3] = '-'; // en passant no longer valid
  return fields.join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrainPanel({ onLoad, onFlip, feedback, puzzleSolved }) {
  const engineRef = useRef(null);

  const [fenInput, setFenInput] = useState('');
  const [side, setSide] = useState('fen');
  const [status, setStatus] = useState('Starting engine…');
  const [message, setMessage] = useState('Waiting for the engine to start up…');
  const [messageError, setMessageError] = useState(false);
  const [loading, setLoading] = useState(false);

  // Training state
  const [targetMove, setTargetMove] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [hintStage, setHintStage] = useState(0);

  // Init engine on mount, destroy on unmount
  useEffect(() => {
    const engine = createEngine({
      onStatus: (s) => setStatus(s),
    });
    engineRef.current = engine;

    engine.ready().then(() => {
      setStatus('Engine ready');
      setMessage('Paste a position or pick a sample puzzle below.');
    });

    return () => engine.destroy();
  }, []);

  // When puzzle is solved, show celebration
  useEffect(() => {
    if (puzzleSolved && analysis) {
      setMessage(`YES! That is the strongest move. ${explainMove(analysis)}`);
      setStatus('Solved!');
    }
  }, [puzzleSolved, analysis]);

  const handleLoad = useCallback(async () => {
    if (!fenInput.trim()) {
      setMessage('Paste a FEN first.');
      setMessageError(true);
      return;
    }

    // Validate FEN
    let fen;
    try {
      fen = applySideOverride(fenInput.trim(), side);
      new Chess(fen); // chess.js 1.x throws on invalid FEN
    } catch {
      setMessage("That doesn't look like a valid FEN.", true);
      return;
    }

    const game = new Chess(fen);
    if (game.isGameOver()) {
      setMessage('This position is already over (checkmate/stalemate) — try another one.', true);
      return;
    }

    // Clear any previous training state
    setTargetMove(null);
    setAnalysis(null);
    setHintStage(0);
    setMessageError(false);
    setLoading(true);
    setStatus('Engine thinking…');
    setMessage('Analyzing…');

    // Load board position immediately
    onLoad(fen, game.turn());

    // Get engine's best move
    const engine = engineRef.current;
    if (!engine) return;

    try {
      const bestMove = await engine.analyze(fen);
      if (!bestMove) {
        setStatus('Engine timed out');
        setMessage('The engine didn\'t return a move in time. Try a different position or reload.', true);
        setLoading(false);
        return;
      }

      const result = analyzeMove(fen, bestMove);
      setTargetMove(bestMove);
      setAnalysis(result);
      setHintStage(0);
      setStatus('Ready for training!');
      setMessage('Find the best move on the board.');
      setLoading(false);

      // Pass target move up so Board can enforce it
      onLoad(fen, game.turn(), bestMove);
    } catch {
      setStatus('Engine error');
      setMessage('Something went wrong with the engine. Try reloading.', true);
      setLoading(false);
    }
  }, [fenInput, side, onLoad]);

  // Auto-load a sample position when selected
  const handleSampleChange = useCallback(
    (e) => {
      const fen = e.target.value;
      if (!fen) return;
      setFenInput(fen);
      setSide('fen');
      // Trigger load on next tick so state settles first
      setTimeout(() => {
        const game = new Chess(fen);
        if (game.isGameOver()) return;

        setTargetMove(null);
        setAnalysis(null);
        setHintStage(0);
        setMessageError(false);
        setLoading(true);
        setStatus('Engine thinking…');
        setMessage('Analyzing…');

        onLoad(fen, game.turn());

        const engine = engineRef.current;
        if (!engine) return;

        engine.analyze(fen).then((bestMove) => {
          if (!bestMove) {
            setStatus('Engine timed out');
            setMessage(
              "The engine didn't return a move in time. Try a different position or reload.",
              true,
            );
            setLoading(false);
            return;
          }
          const result = analyzeMove(fen, bestMove);
          setTargetMove(bestMove);
          setAnalysis(result);
          setHintStage(0);
          setStatus('Ready for training!');
          setMessage('Find the best move on the board.');
          setLoading(false);
          onLoad(fen, game.turn(), bestMove);
        }).catch(() => {
          setStatus('Engine error');
          setMessage('Something went wrong with the engine. Try reloading.', true);
          setLoading(false);
        });
      }, 0);
    },
    [onLoad],
  );

  const handleHint = useCallback(() => {
    if (!targetMove || !analysis) return;

    const nextStage = hintStage + 1;
    setHintStage(nextStage);

    if (nextStage === 1) {
      setMessage(
        'Before calculating anything fancy, run the basics: any checks available? Any profitable captures? Any pieces you could attack that aren\'t defended?',
      );
    } else if (nextStage === 2) {
      setMessage(categoryHint(analysis));
    } else if (nextStage === 3) {
      const pieceName = PIECE_NAMES[analysis.movingType];
      setMessage(
        `Your ${pieceName} on ${analysis.from} is the key piece — look at everything it can reach from there.`,
      );
    } else {
      // Final stage: full reveal
      const promoTxt = analysis.promo ? '=' + analysis.promo.toUpperCase() : '';
      setMessage(`The best move is ${analysis.from}–${analysis.to}${promoTxt}. ${explainMove(analysis)}`);
    }
  }, [targetMove, analysis, hintStage]);

  return (
    <>
      <div id="status">Status: {status}</div>

      <select
        class="sample-select"
        onChange={handleSampleChange}
        disabled={loading}
        value=""
      >
        {SAMPLE_POSITIONS.map(({ label, fen }) => (
          <option key={label} value={fen}>
            {label}
          </option>
        ))}
      </select>

      <input
        type="text"
        id="fenInput"
        placeholder="Paste FEN here (from Lichess/Chess.com)"
        value={fenInput}
        onInput={(e) => setFenInput(e.target.value)}
        disabled={loading}
      />

      <div class="side-toggle">
        {SIDES.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="side"
              value={value}
              checked={side === value}
              onChange={(e) => setSide(e.target.value)}
              disabled={loading}
            />
            {label}
          </label>
        ))}
      </div>

      <div class="btn-row">
        <button class="btn-main" onClick={handleLoad} disabled={loading}>
          Load Position
        </button>
        <button class="btn-flip" onClick={onFlip}>
          ⇅ Flip
        </button>
      </div>

      {targetMove && !puzzleSolved && (
        <button class="btn-hint" onClick={handleHint}>
          I need a hint
        </button>
      )}

      {puzzleSolved && (
        <button class="btn-next" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          🎉 Solved! Pick another sample puzzle above or paste a new FEN.
        </button>
      )}

      <div id="message" class={messageError || (feedback && feedback.error) ? 'error' : ''}>
        {feedback ? feedback.text : message}
      </div>
    </>
  );
}
