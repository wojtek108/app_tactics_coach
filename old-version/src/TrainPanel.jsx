import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import { Chess } from 'chess.js';
import { createEngine } from './lib/engine.js';
import { analyzeMove } from './lib/analyzer.js';
import { listChecksAndCaptures, findForcingMatch } from './lib/cct.js';
import { useAppState, useAppDispatch } from './context.jsx';
import { MOTIFS, analysisToMotif, getDistractors, getMotif } from './motifs.js';
import { addPosition, addAttempt } from './storage.js';

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

function buildCelebration(analysis) {
  if (!analysis) return '🎉 Correct! That is the best move.';
  const piece = PIECE_NAMES[analysis.movingType];
  const to = analysis.to;
  let why = '';
  if (analysis.isFork) why = ` — it's a fork attacking ${analysis.forkTargets.length} pieces`;
  else if (analysis.pinInfo && analysis.pinInfo.type === 'pin')
    why = ` — it pins the enemy ${piece} to the king`;
  else if (analysis.pinInfo && analysis.pinInfo.type === 'skewer') why = ' — it\'s a skewer';
  else if (analysis.isDiscoveredCheck) why = ' — a discovered check';
  else if (analysis.isDirectCheck) why = ' — a direct check';
  return `🎉 Correct! ${piece} to ${to} is the best move.${why}`;
}

function applySideOverride(fen, side) {
  if (side === 'fen') return fen;
  const fields = fen.split(/\s+/);
  const placement = fields[0] || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const castling = fields[2] || '-';
  const halfmove = fields[4] || '0';
  const fullmove = fields[5] || '1';
  return `${placement} ${side} ${castling} - ${halfmove} ${fullmove}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TrainPanel({ onFlip, onAnalysisReady, onBoardModeChange, probeHandlerRef }) {
  const { feedback, showRecognition } = useAppState();
  const dispatch = useAppDispatch();
  const engineRef = useRef(null);

  // UI state
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

  // Socratic staged flow state
  const [socraticStage, setSocraticStage] = useState(null);
  const [visionNote, setVisionNote] = useState('');
  const [cctFound, setCctFound] = useState([]);
  const [cctTarget, setCctTarget] = useState(null);
  const [candidateUci, setCandidateUci] = useState(null);
  const [candidateInfo, setCandidateInfo] = useState(null);
  const [engineReply, setEngineReply] = useState(null);
  const [engineReplyAnalysis, setEngineReplyAnalysis] = useState(null);
  const currentFenRef = useRef(null);
  const currentSideRef = useRef(null);

  // Recognition state (M5)
  const [recognitionOptions, setRecognitionOptions] = useState([]);
  const [recognitionCorrectId, setRecognitionCorrectId] = useState(null);
  const [recognitionAnswered, setRecognitionAnswered] = useState(false);
  const [labelCorrect, setLabelCorrect] = useState(null);

  // Save state (M6)
  const [showSave, setShowSave] = useState(false);
  const [saveMotif, setSaveMotif] = useState('');
  const [saveNotes, setSaveNotes] = useState('');
  const [saved, setSaved] = useState(false);

  // Init engine on mount, destroy on unmount
  useEffect(() => {
    const eng = createEngine({
      onStatus: (s) => setStatus(s),
    });
    engineRef.current = eng;

    eng.ready().then(() => {
      setStatus('Engine ready');
      setMessage('Paste a position or pick a sample puzzle below.');
    });

    return () => eng.destroy();
  }, []);

  // ---- Board mode management ----
  const getBoardMode = useCallback(() => {
    if (socraticStage === 0) return 'view';
    if (socraticStage === 1) return 'enumerate';
    if (socraticStage === 2) return 'try';
    if (socraticStage === 3) return 'commit';
    return 'view';
  }, [socraticStage]);

  useEffect(() => {
    if (onBoardModeChange) onBoardModeChange(getBoardMode());
  }, [socraticStage, onBoardModeChange, getBoardMode]);

  // ---- Stage transitions ----

  const enterStage = useCallback(
    (next) => {
      setSocraticStage(next);
      setMessageError(false);

      if (next === 0) {
        setMessage('');
      } else if (next === 1) {
        const ccts = listChecksAndCaptures(currentFenRef.current);
        setCctTarget(ccts);
        setCctFound([]);
        setMessage(
          'List every check and every capture available to your side. Click moves on the board — they snap back after you try them.',
        );
      } else if (next === 2) {
        setCandidateUci(null);
        setCandidateInfo(null);
        setEngineReply(null);
        setEngineReplyAnalysis(null);
        setMessage(
          'Of those, which creates the strongest threat? Play a candidate — the engine will show the opponent\'s reply.',
        );
      } else if (next === 3) {
        setMessage('Play the move you think is strongest.');
      }
    },
    [],
  );

  // ---- Position loading ----

  const loadPosition = useCallback(
    async (fen) => {
      let game;
      try {
        game = new Chess(fen);
      } catch {
        setMessage("That doesn't look like a valid FEN.", true);
        return;
      }
      if (game.isGameOver()) {
        setMessage('This position is already over (checkmate/stalemate) — try another one.', true);
        return;
      }

      currentFenRef.current = fen;
      currentSideRef.current = game.turn();
      setTargetMove(null);
      setAnalysis(null);
      setHintStage(0);
      setSocraticStage(null);
      setVisionNote('');
      setCctFound([]);
      setCctTarget(null);
      setCandidateUci(null);
      setCandidateInfo(null);
      setEngineReply(null);
      setEngineReplyAnalysis(null);
      setRecognitionOptions([]);
      setRecognitionCorrectId(null);
      setRecognitionAnswered(false);
      setLabelCorrect(null);
      setShowSave(false);
      setSaveMotif('');
      setSaveNotes('');
      setSaved(false);
      setMessageError(false);
      setLoading(true);
      setStatus('Engine thinking…');
      setMessage('Analyzing…');

      dispatch({ type: 'SET_FEN', fen });
      dispatch({ type: 'SET_ORIENTATION', orientation: game.turn() === 'b' ? 'black' : 'white' });
      dispatch({ type: 'SET_LAST_MOVE', lastMove: null });
      dispatch({ type: 'SESSION_END' });
      dispatch({ type: 'CLEAR_RECOGNITION' });

      const eng = engineRef.current;
      if (!eng) return;

      try {
        const bestMove = await eng.analyze(fen);
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
        onAnalysisReady(result);
        setHintStage(0);
        setStatus('Ready for training!');
        setLoading(false);

        dispatch({ type: 'SESSION_START', targetMove: bestMove, analysis: result });
        enterStage(0);
      } catch {
        setStatus('Engine error');
        setMessage('Something went wrong with the engine. Try reloading.', true);
        setLoading(false);
      }
    },
    [dispatch, onAnalysisReady, enterStage],
  );

  // Listen for FEN load requests from Motifs tab
  useEffect(() => {
    const handler = (e) => {
      if (e.detail && e.detail.fen) {
        setFenInput(e.detail.fen);
        setSide('fen');
        setTimeout(() => loadPosition(e.detail.fen), 0);
      }
    };
    window.addEventListener('scc:load-fen', handler);
    return () => window.removeEventListener('scc:load-fen', handler);
  }, [loadPosition]);

  const handleLoad = useCallback(() => {
    if (!fenInput.trim()) {
      setMessage('Paste a FEN first.');
      setMessageError(true);
      return;
    }
    const fen = applySideOverride(fenInput.trim(), side);
    loadPosition(fen);
  }, [fenInput, side, loadPosition]);

  const handleSampleChange = useCallback(
    (e) => {
      const fen = e.target.value;
      if (!fen) return;
      setFenInput(fen);
      setSide('fen');
      setTimeout(() => loadPosition(fen), 0);
    },
    [loadPosition],
  );

  // ---- Stage 1: CCT enumeration probe ----

  const handleEnumerateProbe = useCallback(
    (moveInfo) => {
      if (!cctTarget) return;
      const match = findForcingMatch(cctTarget.all, moveInfo.uci);
      if (match && !cctFound.find((m) => m.uci === match.uci)) {
        setCctFound((prev) => [...prev, match]);
      }
    },
    [cctTarget, cctFound],
  );

  // ---- Stage 2: Candidate evaluation probe ----

  const handleCandidateProbe = useCallback(
    async (moveInfo) => {
      setCandidateUci(moveInfo.uci);
      setCandidateInfo(moveInfo);

      const eng = engineRef.current;
      if (!eng) return;

      const game = new Chess(currentFenRef.current);
      try {
        const moveResult = game.move({
          from: moveInfo.from,
          to: moveInfo.to,
          promotion: moveInfo.promo || undefined,
        });
        if (!moveResult) return;

        const replyFen = game.fen();
        setStatus('Engine thinking…');
        const replyUci = await eng.analyze(replyFen);
        if (replyUci) {
          const replyResult = analyzeMove(replyFen, replyUci);
          setEngineReply(replyUci);
          setEngineReplyAnalysis(replyResult);
          setStatus('Ready for training!');
        }
      } catch {
        setStatus('Ready for training!');
      }
    },
    [],
  );

  const handleEvalDone = useCallback(() => {
    enterStage(3);
  }, [enterStage]);

  useEffect(() => {
    if (!probeHandlerRef) return;
    if (socraticStage === 1) {
      probeHandlerRef.current = handleEnumerateProbe;
    } else if (socraticStage === 2) {
      probeHandlerRef.current = handleCandidateProbe;
    } else {
      probeHandlerRef.current = null;
    }
    return () => { probeHandlerRef.current = null; };
  }, [socraticStage, probeHandlerRef, handleEnumerateProbe, handleCandidateProbe]);

  // ---- Recognition step (M5) ----

  // When showRecognition becomes true, set up the multiple-choice question
  useEffect(() => {
    if (!showRecognition || !analysis) return;
    const correctId = analysisToMotif(analysis);
    const distractors = getDistractors(correctId, 3);
    const options = [correctId, ...distractors];
    // Shuffle
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    setRecognitionOptions(options);
    setRecognitionCorrectId(correctId);
    setRecognitionAnswered(false);
    setLabelCorrect(null);
    setMessage('Before I explain — what kind of tactic was that?');
  }, [showRecognition, analysis]);

  const handleRecognitionAnswer = useCallback(
    (pickedId) => {
      if (recognitionAnswered) return;
      setRecognitionAnswered(true);
      const correct = pickedId === recognitionCorrectId;
      setLabelCorrect(correct);

      // Show the explanation/celebration
      const celebration = buildCelebration(analysis);
      dispatch({
        type: 'SET_FEEDBACK',
        feedback: { text: celebration, error: false },
      });
    },
    [recognitionAnswered, recognitionCorrectId, analysis, dispatch],
  );

  const handleSkipRecognition = useCallback(() => {
    if (recognitionAnswered) return;
    setRecognitionAnswered(true);
    setLabelCorrect(null);
    const celebration = buildCelebration(analysis);
    dispatch({
      type: 'SET_FEEDBACK',
      feedback: { text: celebration, error: false },
    });
  }, [recognitionAnswered, analysis, dispatch]);

  // ---- Save to library (M6) ----

  const handleShowSave = useCallback(() => {
    const correctId = analysis ? analysisToMotif(analysis) : 'unknown';
    setSaveMotif(correctId);
    setShowSave(true);
  }, [analysis]);

  const handleSave = useCallback(() => {
    if (!currentFenRef.current) return;
    const id = crypto.randomUUID();
    const position = {
      id,
      fen: currentFenRef.current,
      side: currentSideRef.current,
      motif: saveMotif,
      motifConfirmed: saveMotif,
      notes: saveNotes || undefined,
      createdAt: new Date().toISOString(),
      source: 'manual',
    };
    addPosition(position);

    // Log the attempt (M7)
    const attempt = {
      id: crypto.randomUUID(),
      positionId: id,
      date: new Date().toISOString(),
      foundClean: hintStage === 0,
      hintsUsed: hintStage,
      labelCorrect,
      boardVisionNote: visionNote || undefined,
    };
    addAttempt(attempt);

    setSaved(true);
    setShowSave(false);
  }, [saveMotif, saveNotes, hintStage, labelCorrect, visionNote]);

  // ---- Hint ladder (Stage 4) ----

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
      const promoTxt = analysis.promo ? '=' + analysis.promo.toUpperCase() : '';
      setMessage(`The best move is ${analysis.from}–${analysis.to}${promoTxt}. ${explainMove(analysis)}`);
    }
  }, [targetMove, analysis, hintStage]);

  // ---- Render ----

  const isActive = socraticStage !== null && !feedback;

  return (
    <>
      <div id="status">Status: {status}</div>

      {!isActive && !showRecognition && !feedback && (
        <>
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
        </>
      )}

      {/* ---- Stage 0: Board vision ---- */}
      {socraticStage === 0 && !feedback && (
        <div class="socratic-stage">
          <div class="stage-prompt">
            Before looking for a move — what stands out? Name two or three
            things about this position.
          </div>
          <textarea
            class="vision-input"
            placeholder="e.g. The black king is exposed, the rook on d6 is undefended…"
            value={visionNote}
            onInput={(e) => setVisionNote(e.target.value)}
            rows={3}
          />
          <button class="btn-main" onClick={() => enterStage(1)}>
            Continue to forcing moves →
          </button>
        </div>
      )}

      {/* ---- Stage 1: CCT enumeration ---- */}
      {socraticStage === 1 && !feedback && (
        <div class="socratic-stage">
          <div class="cct-progress">
            Found {cctFound.length} of {cctTarget ? cctTarget.all.length : 0} forcing moves
          </div>

          {cctFound.length > 0 && (
            <div class="cct-found">
              <div class="cct-label">You found:</div>
              <div class="cct-chips">
                {cctFound.map((m) => (
                  <span key={m.uci} class={`cct-chip cct-${m.kind}`}>
                    {m.san}
                  </span>
                ))}
              </div>
            </div>
          )}

          {cctTarget && cctFound.length === cctTarget.all.length && cctTarget.all.length > 0 && (
            <div class="cct-complete">You found them all!</div>
          )}

          <button class="btn-main" onClick={() => enterStage(2)}>
            {cctFound.length > 0 ? 'Done — evaluate candidates →' : 'Skip — evaluate candidates →'}
          </button>

          {cctFound.length === 0 && (
            <button class="btn-hint" onClick={() => enterStage(2)} style="margin-top: 4px;">
              {"I didn't find any — continue anyway"}
            </button>
          )}
        </div>
      )}

      {/* ---- Stage 2: Candidate evaluation ---- */}
      {socraticStage === 2 && !feedback && (
        <div class="socratic-stage">
          {candidateUci && (
            <div class="candidate-info">
              <span class="candidate-label">Your candidate:</span>{' '}
              <strong>{candidateInfo?.san || candidateUci}</strong>
            </div>
          )}

          {engineReply && (
            <div class="engine-reply">
              <span class="reply-label">Opponent replies:</span>{' '}
              <strong>{engineReplyAnalysis?.san || engineReply}</strong>
              {engineReplyAnalysis && (
                <span class="reply-detail">
                  {engineReplyAnalysis.isCheck && ' (check)'}
                  {engineReplyAnalysis.isCapture && ' (captures)'}
                </span>
              )}
            </div>
          )}

          <button class="btn-main" onClick={handleEvalDone}>
            Commit to a move →
          </button>
        </div>
      )}

      {/* ---- Stage 3: Commit — hint + give-up ---- */}
      {socraticStage === 3 && targetMove && !feedback && !showRecognition && (
        <button class="btn-hint" onClick={handleHint}>
          I need a hint
        </button>
      )}

      {/* ---- Recognition step (M5) ---- */}
      {showRecognition && !recognitionAnswered && (
        <div class="socratic-stage recognition-step">
          <div class="stage-prompt">
            Before I explain — what kind of tactic was that?
          </div>
          <div class="recognition-options">
            {recognitionOptions.map((id) => {
              const motif = getMotif(id);
              return (
                <button
                  key={id}
                  class="recognition-btn"
                  onClick={() => handleRecognitionAnswer(id)}
                >
                  {motif ? motif.name : id}
                </button>
              );
            })}
          </div>
          <button class="btn-hint" onClick={handleSkipRecognition}>
            Skip — just show me
          </button>
        </div>
      )}

      {/* ---- Post-solve / feedback ---- */}
      {feedback && (
        <div class="solved-actions">
          {!saved && (
            <button class="btn-save" onClick={handleShowSave}>
              Save to library
            </button>
          )}
          {saved && (
            <div class="save-confirmation">Saved to library!</div>
          )}
          <button class="btn-next" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            Pick another puzzle above or paste a new FEN.
          </button>
        </div>
      )}

      {/* ---- Save dialog (M6) ---- */}
      {showSave && (
        <div class="save-dialog">
          <div class="save-label">Motif:</div>
          <select
            class="save-motif-select"
            value={saveMotif}
            onChange={(e) => setSaveMotif(e.target.value)}
          >
            {MOTIFS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
            <option value="unknown">Unknown / Other</option>
          </select>
          <textarea
            class="vision-input"
            placeholder="Notes (optional)"
            value={saveNotes}
            onInput={(e) => setSaveNotes(e.target.value)}
            rows={2}
          />
          <div class="btn-row">
            <button class="btn-main" onClick={handleSave}>Save</button>
            <button class="btn-flip" onClick={() => setShowSave(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div id="message" class={messageError || (feedback && feedback.error) ? 'error' : ''}>
        {feedback ? feedback.text : message}
      </div>
    </>
  );
}
