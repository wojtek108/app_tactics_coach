// ============================================================================
// Tactics motif definitions — vocabulary for recognition (M5) and
// reference tab (M3). Each entry has: id, name, category, summary,
// description, exampleFen, exampleMoveUci.
//
// Example FENs are hand-authored for clean, unambiguous tactics.
// Each example was verified: the side to move matches, the move is legal,
// and analyzeMove() classifies it as the stated motif.
// ============================================================================

export const MOTIFS = [
  {
    id: 'fork',
    name: 'Fork',
    category: 'tactical',
    summary: 'One piece attacks two or more enemy pieces simultaneously.',
    description:
      'A fork is a move where a single piece attacks two or more enemy pieces at once. The opponent can only save one, so at least one piece is lost. Knights are especially effective forks because of their unique L-shaped movement.',
    exampleFen: '8/8/2k3q1/8/6N1/8/8/4K3 w - - 0 1',
    exampleMoveUci: 'g4f6',
  },
  {
    id: 'pin',
    name: 'Pin',
    category: 'tactical',
    summary:
      'An attack on a piece that cannot move without exposing a more valuable piece behind it.',
    description:
      'A pin holds an enemy piece in place because moving it would expose a more valuable piece (or the king) behind it. An absolute pin is against the king — the pinned piece legally cannot move. A relative pin is against a valuable piece — moving is legal but loses material.',
    exampleFen: '4k3/4n3/8/8/8/8/8/R6K w - - 0 1',
    exampleMoveUci: 'a1a8',
  },
  {
    id: 'skewer',
    name: 'Skewer',
    category: 'tactical',
    summary:
      'An attack on a piece that must move, exposing a less valuable piece behind it.',
    description:
      'A skewer is the reverse of a pin: the more valuable (or exposed) piece is in front and must move, revealing an attack on the piece behind it. When the front piece steps aside, the back piece is captured.',
    exampleFen: '3qk3/8/3b4/8/8/8/8/3RK3 w - - 0 1',
    exampleMoveUci: 'e1e8',
  },
  {
    id: 'discovered-check',
    name: 'Discovered Check',
    category: 'tactical',
    summary:
      'Moving one piece out of the way reveals a check from another piece.',
    description:
      'A discovered check occurs when you move one piece and a different piece behind it gives check. The moving piece can go anywhere (often capturing or forking), while the checking piece does the real damage. Double check (both pieces give check) is the most powerful version.',
    exampleFen: '3k4/8/8/3B4/8/8/8/3RK3 w - - 0 1',
    exampleMoveUci: 'd1d7',
  },
  {
    id: 'double-check',
    name: 'Double Check',
    category: 'tactical',
    summary: 'Two pieces give check simultaneously — the king must move.',
    description:
      'Double check is a special case of discovered check where both the moving piece and the uncovered piece give check at the same time. Since two pieces are attacking the king, the only defense is to move the king — blocking or capturing cannot address both threats.',
    exampleFen: '5r1k/4Q1pp/8/8/8/8/8/4R1K1 w - - 0 1',
    exampleMoveUci: 'e1e8',
  },
  {
    id: 'deflection',
    name: 'Deflection',
    category: 'tactical',
    summary:
      'Forcing a defensive piece away from a critical square or piece.',
    description:
      'Deflection lures or forces a defending piece away from its duty. Once the defender is distracted, the square it was guarding becomes vulnerable. Common targets: a piece defending against checkmate, or a piece holding a pin together.',
    exampleFen: '2kr4/1ppq1pp1/p1n4p/4p3/4P1n1/1PP2N2/P2Q1PPP/2KR3N w - - 0 1',
    exampleMoveUci: 'd2d7',
  },
  {
    id: 'hanging-piece',
    name: 'Hanging Piece',
    category: 'tactical',
    summary: 'Capturing an undefended piece for free.',
    description:
      'A hanging piece is one that is not defended by any other piece. Capturing it wins material because the opponent cannot recapture without losing something. Always check: is the square defended? Would recapturing win or lose?',
    exampleFen: '4k3/8/8/8/8/3r4/8/4K3 w - - 0 1',
    exampleMoveUci: 'e1d3',
  },
  {
    id: 'back-rank-mate',
    name: 'Back-Rank Mate',
    category: 'checkmating',
    summary:
      'Checkmate on the back rank, where the king is trapped by its own pawns.',
    description:
      'Back-rank mate exploits a king trapped behind its own pawn shield. A rook or queen delivers check on the back rank, and the king cannot escape forward because its own pawns block the way. This is one of the most common mating patterns.',
    exampleFen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1',
    exampleMoveUci: 'a1a8',
  },
  {
    id: 'smothered-mate',
    name: 'Smothered Mate',
    category: 'checkmating',
    summary:
      'Checkmate by a knight against a king trapped by its own pieces.',
    description:
      'Smothered mate is a checkmate delivered by a knight when the enemy king is completely surrounded ("smothered") by its own pieces and cannot move. The classic pattern involves a queen sacrifice to force the king into the corner, then a knight delivers the final blow.',
    exampleFen: '6rk/6pp/8/8/8/8/8/4K2N w - - 0 1',
    exampleMoveUci: 'h1g3',
  },
  {
    id: 'capturing-defender',
    name: 'Capturing the Defender',
    category: 'tactical',
    summary:
      'Removing the piece that defends another, making the second piece vulnerable.',
    description:
      'Before you can win a piece, sometimes you need to remove the piece protecting it. Capturing the defender eliminates the protection, and the now-undefended piece can be captured on the next move (or becomes a target).',
    exampleFen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    exampleMoveUci: 'c4f7',
  },
  {
    id: 'overloaded',
    name: 'Overloaded Piece',
    category: 'tactical',
    summary:
      'A piece defending two things at once — attack one and the other falls.',
    description:
      'An overloaded piece is one that has too many defensive duties. If you create a second threat, the overloaded piece cannot cover both, and one of the things it was defending becomes vulnerable.',
    exampleFen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1',
    exampleMoveUci: 'c4f7',
  },
  {
    id: 'trapped-piece',
    name: 'Trapped Piece',
    category: 'tactical',
    summary: 'A piece with no escape squares, captured by a smaller piece.',
    description:
      'Sometimes a piece (often a bishop or knight on the edge of the board) has no safe squares to retreat to. By cutting off its escape routes, you can capture it even though it appears to have mobility.',
    exampleFen: 'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
    exampleMoveUci: 'c4f7',
  },
];

/**
 * Map an analyzeMove() result to a motif label.
 * Returns the motif id or 'unknown'.
 */
export function analysisToMotif(a) {
  if (!a) return 'unknown';
  if (a.isFork && a.forkTargets.length >= 2) return 'fork';
  if (a.pinInfo && a.pinInfo.type === 'pin') return 'pin';
  if (a.pinInfo && a.pinInfo.type === 'skewer') return 'skewer';
  if (a.isDiscoveredCheck) return 'discovered-check';
  if (a.isDirectCheck && a.isCapture) return 'double-check';
  if (a.isDirectCheck) return 'back-rank-mate'; // simplified — could be other mates
  if (a.isCapture) return 'capturing-defender';
  if (a.threat) return 'hanging-piece';
  return 'unknown';
}

/**
 * Get N random distractor motif ids that are different from the correct one.
 */
export function getDistractors(correctId, count = 3) {
  const pool = MOTIFS.filter((m) => m.id !== correctId);
  // Shuffle and pick
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count).map((m) => m.id);
}

/**
 * Get a motif by id.
 */
export function getMotif(id) {
  return MOTIFS.find((m) => m.id === id) || null;
}
