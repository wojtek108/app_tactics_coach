// ============================================================================
// Tactic analyzer — pure functions for classifying a chess move.
//
// Ported from prototype/app.js (v0.1) to chess.js 1.4. Behavior is identical
// to the prototype; only the chess.js API calls changed:
//   - sim.in_check()      -> sim.inCheck()      (chess.js 1.x rename)
//   - new Chess(fen)      throws on invalid FEN (was: returned a board you
//                          had to validate via game.load())
// All functions here are pure: they take/return plain data and never touch
// shared state. analyzeMove() works on a scratch Chess copy so it never
// disturbs the player's live game.
//
// Known limitation (inherited from the prototype, see README §Limitations):
// the analyzer only detects tactics created by the moved piece's own final
// square. It will not catch clearance sacrifices, interferences, or
// multi-move combinations.
// ============================================================================

import { Chess } from 'chess.js';

// chess.js 1.4 types Square as a strict string union ('a1' | 'a2' | ...).
// We build squares arithmetically here, so we cast at the boundary rather
// than littering every call site. The strings we produce are always valid
// board coordinates when they reach chess.js.
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
export function attackedSquares(pos, square) {
  const piece = pos.get(square);
  if (!piece) return [];
  const { file, rank } = fileRank(square);
  const out = [];
  const add = (f, r) => {
    const s = toSquare(f, r);
    if (s) out.push(s);
  };

  if (piece.type === 'n') {
    [
      [1, 2],
      [2, 1],
      [2, -1],
      [1, -2],
      [-1, -2],
      [-2, -1],
      [-2, 1],
      [-1, 2],
    ].forEach(([df, dr]) => add(file + df, rank + dr));
  } else if (piece.type === 'k') {
    [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ].forEach(([df, dr]) => add(file + df, rank + dr));
  } else if (piece.type === 'p') {
    const dr = piece.color === 'w' ? 1 : -1;
    add(file - 1, rank + dr);
    add(file + 1, rank + dr);
  } else {
    let dirs = [];
    if (piece.type === 'b')
      dirs = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
    else if (piece.type === 'r')
      dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
    else
      dirs = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];

    dirs.forEach(([df, dr]) => {
      let f = file + df;
      let r = rank + dr;
      while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
        const s = toSquare(f, r);
        out.push(s);
        if (pos.get(s)) break; // blocked beyond this square
        f += df;
        r += dr;
      }
    });
  }
  return out;
}

export function isSquareDefended(pos, square, byColor) {
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
export function findPinOrSkewer(pos, square, movingColor) {
  const piece = pos.get(square);
  if (!piece || !['b', 'r', 'q'].includes(piece.type)) return null;
  const { file, rank } = fileRank(square);
  const enemyColor = movingColor === 'w' ? 'b' : 'w';
  let dirs = [];
  if (piece.type === 'b')
    dirs = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
  else if (piece.type === 'r')
    dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
  else
    dirs = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];

  const value = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

  for (const [df, dr] of dirs) {
    let f = file + df;
    let r = rank + dr;
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
            if (p.type === 'k')
              return { type: 'pin', pinnedSquare: first.sq, pinnedType: first.type };
            if (value[p.type] > value[first.type]) {
              return {
                type: 'skewer',
                frontSquare: first.sq,
                frontType: first.type,
                backSquare: sq,
                backType: p.type,
              };
            }
          }
          break; // second piece found either way — ray stops mattering past here
        }
      }
      f += df;
      r += dr;
    }
  }
  return null;
}

// Full tactical breakdown of the engine's chosen move, computed on a scratch
// copy of the position so it never disturbs the player's live game.
export function analyzeMove(fen, moveUci) {
  const from = moveUci.slice(0, 2);
  const to = moveUci.slice(2, 4);
  const promo = moveUci.length > 4 ? moveUci[4] : undefined;

  const sim = new Chess(fen);
  const mover = sim.get(from);
  if (!mover) return null;
  const movingColor = mover.color;
  const enemyColor = movingColor === 'w' ? 'b' : 'w';

  // chess.js 1.4 throws on illegal moves (0.10.3 returned null). The
  // prototype relied on the falsy return; we restore that contract here so
  // callers can treat "not a legal move" uniformly.
  let moveResult;
  try {
    moveResult = sim.move({ from, to, promotion: promo || 'q' });
  } catch {
    return null;
  }
  if (!moveResult) return null;

  const isCapture = !!moveResult.captured;
  const capturedType = moveResult.captured || null;
  const isCheck = sim.inCheck();

  const attacked = attackedSquares(sim, to);
  const enemyKingSquare = findKingSquare(sim, enemyColor);
  const isDirectCheck = isCheck && attacked.includes(enemyKingSquare);
  const isDiscoveredCheck = isCheck && !isDirectCheck;

  const forkTargets = attacked.filter((sq) => {
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
    from,
    to,
    promo,
    movingType: mover.type,
    movingColor,
    isCapture,
    capturedType,
    isCheck,
    isDirectCheck,
    isDiscoveredCheck,
    isFork,
    forkTargets,
    pinInfo,
    threat,
  };
}
