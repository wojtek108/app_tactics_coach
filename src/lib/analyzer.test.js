// Tests for the tactic analyzer. Each test is a hand-crafted position where
// one specific tactic is the dominant feature, plus a UCI move that triggers
// it. These tests document the analyzer's *current* (prototype-inherited)
// behavior — including its known limitations — not aspirational behavior.

import { describe, it, expect } from 'vitest';
import { analyzeMove, attackedSquares, findPinOrSkewer } from './analyzer.js';
import { Chess } from 'chess.js';

describe('analyzeMove — tactic detection', () => {
  it('detects a direct check', () => {
    // White queen a1 -> e5, checking the black king on e8 down the e-file.
    const fen = '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1';
    const result = analyzeMove(fen, 'a1e5');
    expect(result).toBeTruthy();
    expect(result.isCheck).toBe(true);
    expect(result.isDirectCheck).toBe(true);
    expect(result.isDiscoveredCheck).toBe(false);
  });

  it('detects a discovered check', () => {
    // White bishop d5 blocks the white rook on d1 from the black king on d8.
    // Moving the bishop away (d5-e4) discovers check; the bishop itself is silent.
    const fen = '3k4/8/8/3B4/8/8/8/3RK3 w - - 0 1';
    const result = analyzeMove(fen, 'd5e4');
    expect(result).toBeTruthy();
    expect(result.isCheck).toBe(true);
    expect(result.isDiscoveredCheck).toBe(true);
    expect(result.isDirectCheck).toBe(false);
  });

  it('detects a knight fork hitting two pieces', () => {
    // Knight g4 -> e5 forks the black king on c6 and the black queen on g6.
    const fen = '8/8/2k3q1/8/6N1/8/8/4K3 w - - 0 1';
    const result = analyzeMove(fen, 'g4e5');
    expect(result).toBeTruthy();
    expect(result.isFork).toBe(true);
    expect(result.forkTargets.length).toBeGreaterThanOrEqual(2);
  });

  it('detects a pin to the king', () => {
    // Rook a1 -> e1 pins the black knight on e7 to the black king on e8.
    // (White king parked on h1 so the e1 square is free to land on.)
    const fen = '4k3/4n3/8/8/8/8/8/R6K w - - 0 1';
    const result = analyzeMove(fen, 'a1e1');
    expect(result).toBeTruthy();
    expect(result.pinInfo).toBeTruthy();
    expect(result.pinInfo.type).toBe('pin');
  });

  it('detects a skewer', () => {
    // Rook d1 -> d5 sees the black bishop on d6 (front) then the black queen
    // on d8 (back) along the d-file — a 3-vs-9 skewer.
    const fen = '3qk3/8/3b4/8/8/8/8/3RK3 w - - 0 1';
    const result = analyzeMove(fen, 'd1d5');
    expect(result).toBeTruthy();
    expect(result.pinInfo).toBeTruthy();
    expect(result.pinInfo.type).toBe('skewer');
  });

  it('detects a profitable capture', () => {
    // White rook b1 captures the black rook on a1.
    const fen = '4k3/8/8/8/8/8/8/rR2K3 w - - 0 1';
    const result = analyzeMove(fen, 'b1a1');
    expect(result).toBeTruthy();
    expect(result.isCapture).toBe(true);
    expect(result.capturedType).toBe('r');
  });

  it('detects a threat against an undefended piece', () => {
    // Queen a1 -> a2 attacks the black knight on d5 via the a2-d5 diagonal.
    // No check, no capture, no fork, no pin — but the knight hangs.
    const fen = '4k3/8/8/3n4/8/8/8/Q3K3 w - - 0 1';
    const result = analyzeMove(fen, 'a1a2');
    expect(result).toBeTruthy();
    expect(result.threat).toBeTruthy();
    expect(result.threat.type).toBe('n');
    expect(result.isCheck).toBe(false);
    expect(result.isFork).toBe(false);
    expect(result.isCapture).toBe(false);
  });

  it('returns an all-false result for a quiet positional move', () => {
    // Starting position, e2-e4: nothing forcing.
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const result = analyzeMove(fen, 'e2e4');
    expect(result).toBeTruthy();
    expect(result.isCheck).toBe(false);
    expect(result.isCapture).toBe(false);
    expect(result.isFork).toBe(false);
    expect(result.pinInfo).toBeNull();
    expect(result.threat).toBeNull();
  });
});

describe('analyzeMove — edge cases', () => {
  it('parses a promotion move', () => {
    // Pawn b7 captures the black rook on a8 and promotes to a queen.
    const fen = 'r2k4/1P6/8/8/8/8/8/4K3 w - - 0 1';
    const result = analyzeMove(fen, 'b7a8q');
    expect(result).toBeTruthy();
    expect(result.promo).toBe('q');
    expect(result.movingType).toBe('p');
    expect(result.capturedType).toBe('r');
  });

  it('returns null when the from-square is empty', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const result = analyzeMove(fen, 'a1a3'); // a1 is empty
    expect(result).toBeNull();
  });

  it('returns null for an illegal move', () => {
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const result = analyzeMove(fen, 'e1e3'); // king can't jump two squares
    expect(result).toBeNull();
  });

  it('returns a coherent result for a checkmating move', () => {
    // Back-rank mate: Ra1-a8+ traps the black king behind its own pawns.
    const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
    const result = analyzeMove(fen, 'a1a8');
    expect(result).toBeTruthy();
    expect(result.isCheck).toBe(true);
    expect(result.isDirectCheck).toBe(true);
  });
});

describe('geometry helpers', () => {
  it('attackedSquares lists knight L-moves', () => {
    const pos = new Chess('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1');
    const attacked = attackedSquares(pos, 'd4');
    // Knight on d4 attacks 8 squares: b3,b5,c2,c6,e2,e6,f3,f5.
    expect(attacked.length).toBe(8);
    expect(attacked).toContain('b3');
    expect(attacked).toContain('f5');
  });

  it('attackedSquares is empty for an empty square', () => {
    const pos = new Chess('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
    expect(attackedSquares(pos, 'd4')).toEqual([]);
  });

  it('findPinOrSkewer returns null for a non-sliding piece', () => {
    const pos = new Chess('4k3/8/8/8/3N4/8/8/4K3 w - - 0 1');
    expect(findPinOrSkewer(pos, 'd4', 'w')).toBeNull();
  });
});
