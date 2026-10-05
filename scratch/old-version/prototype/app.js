// ============================================================================
// Socratic Chess Coach — app logic
// ============================================================================

let board = null;
let game = new Chess();
let engine = null;
let engineReady = false;
let analyzing = false;
let watchdog = null;

let targetMove = "";     // engine's chosen best move, e.g. "e2e4" or "e7e8q"
let analysis = null;     // tactical breakdown of targetMove, see analyzeMove()
let hintStage = 0;

const MOVETIME_MS = 4000;     // bounded search time, not unbounded depth
const WATCHDOG_MS = 20000;    // if engine says nothing for this long, something is wrong

const PIECE_NAMES = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

// ---------------------------------------------------------------------------
// Board / pieces
// ---------------------------------------------------------------------------

// Pieces are rendered as inline SVG data-URIs (Unicode chess glyphs) rather
// than remote PNGs, so the app has no external image dependency at all.
const PIECE_GLYPHS = {
    wP: '\u2659', wN: '\u2658', wB: '\u2657', wR: '\u2656', wQ: '\u2655', wK: '\u2654',
    bP: '\u265F', bN: '\u265E', bB: '\u265D', bR: '\u265C', bQ: '\u265B', bK: '\u265A'
};
function pieceDataUri(piece) {
    const glyph = PIECE_GLYPHS[piece];
    const isWhite = piece[0] === 'w';
    const fill = isWhite ? '#f0f0f0' : '#1a1a1a';
    const stroke = isWhite ? '#1a1a1a' : '#f0f0f0';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45">' +
        '<text x="50%" y="52%" dominant-baseline="central" text-anchor="middle" ' +
        'font-size="40" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1">' +
        glyph + '</text></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const config = {
    draggable: true,
    position: 'start',
    pieceTheme: pieceDataUri,
    onDrop: onMove
};
try {
    board = Chessboard('board', config);
} catch (err) {
    document.getElementById('board').innerText =
        "Board failed to load (chessboard.js didn't load). Check your network and reload.";
}

function flipBoard() {
    if (board) board.flip();
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updateStatus(txt) {
    document.getElementById('status').innerText = "Status: " + txt;
}
function setMessage(txt, isError) {
    const el = document.getElementById('message');
    el.innerText = txt;
    el.classList.toggle('error', !!isError);
}
function clearWatchdog() {
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
}

// ---------------------------------------------------------------------------
// Engine setup
// ---------------------------------------------------------------------------

function initEngine() {
    if (location.protocol === 'file:') {
        setMessage("You're opening this file directly (file://). Some browsers silently block Web Workers in that mode — the engine may look stuck with no error. Serve this folder locally instead, e.g. run `python3 -m http.server 8000` in this folder and open http://localhost:8000.", true);
    }
    updateStatus("Starting engine…");
    try {
        engine = new Worker('stockfish.js');
        wireEngine();
    } catch (err) {
        updateStatus("Engine failed to load");
        setMessage("Couldn't start the chess engine (Worker creation was blocked). Make sure stockfish.js is in the same folder as this page, and that you're serving/opening it properly.", true);
    }
}

function wireEngine() {
    engine.onerror = function () {
        updateStatus("Engine error");
        setMessage("The engine script failed to load — check that stockfish.js is present in the same folder, then reload.", true);
        document.getElementById('loadBtn').disabled = true;
    };

    engine.onmessage = function (e) {
        const line = typeof e.data === 'string' ? e.data : '';

        if (!engineReady) {
            if (line.includes('uciok')) {
                engine.postMessage('isready');
            } else if (line.includes('readyok')) {
                engineReady = true;
                clearWatchdog();
                updateStatus("Engine ready");
                setMessage("Paste a position to begin.");
                document.getElementById('loadBtn').disabled = false;
            }
            return;
        }

        if (!analyzing) return;

        const depthMatch = line.match(/^info .*\bdepth (\d+)/);
        if (depthMatch) {
            updateStatus("Engine thinking… depth " + depthMatch[1]);
        }

        if (line.startsWith('bestmove')) {
            clearWatchdog();
            analyzing = false;
            const parts = line.split(" ");
            const move = parts[1];

            if (!move || move === '(none)') {
                updateStatus("No legal moves");
                setMessage("This position has no legal moves (checkmate or stalemate) — try another FEN.", true);
                document.getElementById('hintBtn').style.display = "none";
                return;
            }
            targetMove = move;
            hintStage = 0;
            analysis = analyzeMove(game.fen(), targetMove);
            updateStatus("Ready for training!");
            setMessage("Find the best move on the board.");
            document.getElementById('hintBtn').style.display = "block";
            document.getElementById('loadBtn').disabled = false;
        }
    };

    engine.postMessage('uci');
    watchdog = setTimeout(function () {
        if (!engineReady) {
            updateStatus("Engine didn't respond");
            const hint = location.protocol === 'file:'
                ? " You're running this via file:// — try serving the folder locally instead (`python3 -m http.server 8000`, then open http://localhost:8000) and reload."
                : " Check that stockfish.js is present and reload.";
            setMessage("The engine loaded but never responded to initialization." + hint, true);
        }
    }, WATCHDOG_MS);
}

initEngine();

// ---------------------------------------------------------------------------
// Board geometry / attack helpers (used for the tactical hint analysis)
// ---------------------------------------------------------------------------

function fileRank(square) {
    return { file: square.charCodeAt(0) - 97, rank: parseInt(square[1], 10) - 1 };
}
function toSquare(file, rank) {
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
    return String.fromCharCode(97 + file) + (rank + 1);
}
function findKingSquare(pos, color) {
    for (let f = 0; f < 8; f++) {
        for (let r = 0; r < 8; r++) {
            const sq = toSquare(f, r);
            const p = pos.get(sq);
            if (p && p.type === 'k' && p.color === color) return sq;
        }
    }
    return null;
}

// Pseudo-legal squares attacked by whatever piece sits on `square` (ignores
// whether the attacking side is in check — that's fine for tactic-spotting).
function attackedSquares(pos, square) {
    const piece = pos.get(square);
    if (!piece) return [];
    const { file, rank } = fileRank(square);
    const out = [];
    const add = (f, r) => { const s = toSquare(f, r); if (s) out.push(s); };

    if (piece.type === 'n') {
        [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]
            .forEach(([df, dr]) => add(file + df, rank + dr));
    } else if (piece.type === 'k') {
        [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
            .forEach(([df, dr]) => add(file + df, rank + dr));
    } else if (piece.type === 'p') {
        const dr = piece.color === 'w' ? 1 : -1;
        add(file - 1, rank + dr);
        add(file + 1, rank + dr);
    } else {
        let dirs = [];
        if (piece.type === 'b') dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        else if (piece.type === 'r') dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        else dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

        dirs.forEach(([df, dr]) => {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
                const s = toSquare(f, r);
                out.push(s);
                if (pos.get(s)) break; // blocked beyond this square
                f += df; r += dr;
            }
        });
    }
    return out;
}

function isSquareDefended(pos, square, byColor) {
    for (let f = 0; f < 8; f++) {
        for (let r = 0; r < 8; r++) {
            const sq = toSquare(f, r);
            const p = pos.get(sq);
            if (p && p.color === byColor && attackedSquares(pos, sq).includes(square)) return true;
        }
    }
    return false;
}

// Looks for a pin or skewer created by a sliding piece now sitting on `square`.
function findPinOrSkewer(pos, square, movingColor) {
    const piece = pos.get(square);
    if (!piece || !['b', 'r', 'q'].includes(piece.type)) return null;
    const { file, rank } = fileRank(square);
    const enemyColor = movingColor === 'w' ? 'b' : 'w';
    let dirs = [];
    if (piece.type === 'b') dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    else if (piece.type === 'r') dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    else dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

    const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

    for (const [df, dr] of dirs) {
        let f = file + df, r = rank + dr;
        let first = null;
        while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
            const sq = toSquare(f, r);
            const p = pos.get(sq);
            if (p) {
                if (!first) {
                    if (p.color !== enemyColor || p.type === 'k') break; // own piece or adjacent king: not a pin setup
                    first = { sq, type: p.type };
                } else {
                    if (p.color === enemyColor) {
                        if (p.type === 'k') return { type: 'pin', pinnedSquare: first.sq, pinnedType: first.type };
                        if (value[p.type] > value[first.type]) return { type: 'skewer', frontSquare: first.sq, frontType: first.type, backSquare: sq, backType: p.type };
                    }
                    break; // second piece found either way — ray stops mattering past here
                }
            }
            f += df; r += dr;
        }
    }
    return null;
}

// Full tactical breakdown of the engine's chosen move, computed on a scratch
// copy of the position so it never disturbs the player's live game.
function analyzeMove(fen, moveUci) {
    const from = moveUci.slice(0, 2);
    const to = moveUci.slice(2, 4);
    const promo = moveUci.length > 4 ? moveUci[4] : undefined;

    const sim = new Chess(fen);
    const mover = sim.get(from);
    if (!mover) return null;
    const movingColor = mover.color;
    const enemyColor = movingColor === 'w' ? 'b' : 'w';

    const moveResult = sim.move({ from, to, promotion: promo || 'q' });
    if (!moveResult) return null;

    const isCapture = !!moveResult.captured;
    const capturedType = moveResult.captured || null;
    const isCheck = sim.in_check();

    const attacked = attackedSquares(sim, to);
    const enemyKingSquare = findKingSquare(sim, enemyColor);
    const isDirectCheck = isCheck && attacked.includes(enemyKingSquare);
    const isDiscoveredCheck = isCheck && !isDirectCheck;

    const forkTargets = attacked.filter(sq => {
        const p = sim.get(sq);
        return p && p.color === enemyColor;
    });
    const isFork = forkTargets.length >= 2;

    const pinInfo = findPinOrSkewer(sim, to, movingColor);

    let threat = null;
    for (const sq of attacked) {
        const p = sim.get(sq);
        if (p && p.color === enemyColor && !isSquareDefended(sim, sq, enemyColor)) {
            threat = { square: sq, type: p.type };
            break;
        }
    }

    return {
        from, to, promo,
        movingType: mover.type, movingColor,
        isCapture, capturedType,
        isCheck, isDirectCheck, isDiscoveredCheck,
        isFork, forkTargets,
        pinInfo,
        threat
    };
}

// ---------------------------------------------------------------------------
// Session / move handling
// ---------------------------------------------------------------------------

function getSelectedSide() {
    const sel = document.querySelector('input[name="side"]:checked');
    return sel ? sel.value : 'fen';
}

function applySideOverride(fen, side) {
    if (side === 'fen') return fen;
    const fields = fen.split(/\s+/);
    while (fields.length < 6) fields.push(fields.length === 3 ? '-' : (fields.length === 2 ? '-' : (fields.length === 4 ? '0' : '1')));
    fields[1] = side;      // active color
    fields[3] = '-';       // en passant target no longer valid once we flip the mover
    return fields.join(' ');
}

function startSession() {
    if (!engineReady) {
        setMessage("The engine isn't ready yet — give it a moment and try again.", true);
        return;
    }
    const raw = document.getElementById('fenInput').value.trim();
    if (!raw) {
        setMessage("Paste a FEN first.", true);
        return;
    }
    const fen = applySideOverride(raw, getSelectedSide());

    if (!game.load(fen)) {
        setMessage("That doesn't look like a valid FEN.", true);
        return;
    }
    if (game.game_over()) {
        setMessage("This position is already over (checkmate/stalemate) — try another one.", true);
        return;
    }

    board.position(fen);
    hintStage = 0;
    targetMove = "";
    analysis = null;
    setMessage("Analyzing… this can take a few seconds.");
    document.getElementById('hintBtn').style.display = "none";
    document.getElementById('loadBtn').disabled = true;

    board.orientation(game.turn() === 'w' ? 'white' : 'black');

    updateStatus("Engine thinking…");
    analyzing = true;
    clearWatchdog();
    engine.postMessage("stop");
    engine.postMessage("ucinewgame");
    engine.postMessage("position fen " + fen);
    engine.postMessage("go movetime " + MOVETIME_MS);

    watchdog = setTimeout(function () {
        if (analyzing) {
            analyzing = false;
            updateStatus("Engine timed out");
            setMessage("The engine didn't return a move in time. Try a different position or reload the page.", true);
            document.getElementById('loadBtn').disabled = false;
        }
    }, MOVETIME_MS + WATCHDOG_MS);
}

// ---------------------------------------------------------------------------
// Socratic hint ladder
// ---------------------------------------------------------------------------

function giveHint() {
    if (!targetMove || !analysis) return;
    hintStage++;

    if (hintStage === 1) {
        setMessage("Before calculating anything fancy, run the basics: any checks available? Any profitable captures? Any pieces you could attack that aren't defended?");
        return;
    }

    if (hintStage === 2) {
        setMessage(categoryHint(analysis));
        return;
    }

    if (hintStage === 3) {
        const pieceName = PIECE_NAMES[analysis.movingType];
        setMessage(`Your ${pieceName} on ${analysis.from} is the key piece — look at everything it can reach from there.`);
        return;
    }

    // Final stage: reveal the move and explain why.
    const promoTxt = analysis.promo ? ('=' + analysis.promo.toUpperCase()) : '';
    setMessage(`The best move is ${analysis.from}–${analysis.to}${promoTxt}. ${explainMove(analysis)}`);
}

function categoryHint(a) {
    if (a.isDiscoveredCheck) {
        return "There's a discovered check hiding here — moving one piece out of the way unleashes an attack from another.";
    }
    if (a.isDirectCheck) {
        return "There's a direct check available for you.";
    }
    if (a.isFork) {
        return "One of your pieces can land on a square that attacks two enemy pieces at once — a fork.";
    }
    if (a.pinInfo && a.pinInfo.type === 'pin') {
        return "Look for a move that pins an enemy piece against something more valuable behind it.";
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
    return "Look at how your pieces line up with the enemy king and with undefended pieces along ranks, files, and diagonals.";
}

function explainMove(a) {
    const parts = [];
    if (a.isCapture) parts.push(`it captures the ${PIECE_NAMES[a.capturedType].toLowerCase()} on ${a.to}`);
    if (a.isDiscoveredCheck) parts.push("it opens a discovered check from another piece");
    else if (a.isDirectCheck) parts.push("it delivers check directly");
    if (a.isFork) parts.push(`it forks ${a.forkTargets.length} pieces at once`);
    if (a.pinInfo && a.pinInfo.type === 'pin') parts.push(`it pins the ${PIECE_NAMES[a.pinInfo.pinnedType].toLowerCase()} on ${a.pinInfo.pinnedSquare} to the king`);
    if (a.pinInfo && a.pinInfo.type === 'skewer') parts.push(`it skewers the ${PIECE_NAMES[a.pinInfo.frontType].toLowerCase()} into the ${PIECE_NAMES[a.pinInfo.backType].toLowerCase()} behind it`);
    if (a.threat && parts.length === 0) parts.push(`it threatens the undefended ${PIECE_NAMES[a.threat.type].toLowerCase()} on ${a.threat.square}`);

    if (parts.length === 0) return "It's the strongest positional option available — not a forcing tactic, just the best improvement on the board.";
    return parts.join(', and ') + '.';
}

function onMove(source, target) {
    const playerMove = source + target;

    // Compare only the from/to squares — targetMove may have a 5th promotion
    // character (e.g. "e7e8q") that a 4-char move can't match.
    if (targetMove && playerMove === targetMove.slice(0, 4)) {
        setMessage(`YES! That is the strongest move. ${explainMove(analysis)}`);
        game.move({ from: source, to: target, promotion: 'q' });
        document.getElementById('hintBtn').style.display = "none";
        return;
    }

    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    game.undo();
    setMessage("That's legal, but there's a much better way. Try again!");
    return 'snapback';
}
