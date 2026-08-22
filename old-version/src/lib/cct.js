// ============================================================================
// CCT helper — list every check and every capture available from a FEN.
//
// Used by Train Stage 1 (forcing-move enumeration). Pure functions only.
// ============================================================================

import { Chess } from 'chess.js';

/**
 * @typedef {{ uci: string, san: string, from: string, to: string, promo?: string, isCheck: boolean, isCapture: boolean, kind: 'check' | 'capture' | 'both' }} ForcingMove
 */

/**
 * All legal checks and captures for the side to move.
 * A move that is both a check and a capture appears once with kind 'both'.
 *
 * @param {string} fen
 * @returns {{ checks: ForcingMove[], captures: ForcingMove[], all: ForcingMove[] }}
 */
export function listChecksAndCaptures(fen) {
  const root = new Chess(fen);
  /** @type {ForcingMove[]} */
  const all = [];

  for (const m of root.moves({ verbose: true })) {
    const sim = new Chess(fen);
    let result;
    try {
      result = sim.move({
        from: m.from,
        to: m.to,
        promotion: m.promotion,
      });
    } catch {
      continue;
    }
    if (!result) continue;

    const isCapture = !!result.captured;
    const isCheck = sim.inCheck();
    if (!isCapture && !isCheck) continue;

    const promo = m.promotion || undefined;
    const uci = m.from + m.to + (promo || '');
    let kind = 'capture';
    if (isCheck && isCapture) kind = 'both';
    else if (isCheck) kind = 'check';

    all.push({
      uci,
      san: result.san,
      from: m.from,
      to: m.to,
      promo,
      isCheck,
      isCapture,
      kind,
    });
  }

  // Prefer non-promo-duplicate: chess.js already expands promotions as separate moves.
  const checks = all.filter((x) => x.isCheck);
  const captures = all.filter((x) => x.isCapture);
  return { checks, captures, all };
}

/** Normalize a user UCI so e7e8 and e7e8q both match a catalog entry when possible. */
export function findForcingMatch(all, uci) {
  const exact = all.find((m) => m.uci === uci);
  if (exact) return exact;
  // User picked a promo piece that wasn't the catalog's default listing for that square pair
  const base = uci.slice(0, 4);
  return all.find((m) => m.uci.slice(0, 4) === base) || null;
}
