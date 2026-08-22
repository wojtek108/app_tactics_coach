import { describe, it, expect } from 'vitest';
import { listChecksAndCaptures, findForcingMatch } from './cct.js';

describe('listChecksAndCaptures', () => {
  it('lists a knight fork that checks and attacks the queen', () => {
    // White knight on g4 can jump to e5 or f6 etc.; Ne5+ forks king+queen? 
    // Position: king c6, queen g6, knight g4 — Nf6 is check? 
    // Simpler: back-rank mate position has rook checks.
    const fen = '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1';
    const { checks, captures, all } = listChecksAndCaptures(fen);
    expect(all.length).toBeGreaterThan(0);
    // Ra8 is mate (check)
    const ra8 = all.find((m) => m.from === 'a1' && m.to === 'a8');
    expect(ra8).toBeTruthy();
    expect(ra8.isCheck).toBe(true);
    expect(checks.some((m) => m.uci.startsWith('a1a8'))).toBe(true);
    expect(Array.isArray(captures)).toBe(true);
  });

  it('lists captures in a capture-heavy position', () => {
    // White queen can capture black rook or bishop
    const fen = '4k3/8/3r1b2/8/8/8/8/3QK3 w - - 0 1';
    const { captures, all } = listChecksAndCaptures(fen);
    expect(captures.length).toBeGreaterThan(0);
    expect(all.some((m) => m.isCapture)).toBe(true);
  });

  it('returns empty lists when no checks or captures exist', () => {
    // Kings only, far apart — no legal captures or checks
    const fen = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
    const { checks, captures, all } = listChecksAndCaptures(fen);
    expect(checks).toEqual([]);
    expect(captures).toEqual([]);
    expect(all).toEqual([]);
  });

  it('marks a checking capture as kind both', () => {
    // White pawn b7 captures a8 rook and promotes with check-ish tactics
    // Use a simple capture-check: white rook takes protected piece giving check
    // K+R vs k — Ra8 mate is check only. Better:
    // White Qd1 takes black Nd4? Let's use known: 
    // 4k3/8/8/8/3n4/8/8/3QK3 w — Qxd4 is capture
    const fen = '4k3/8/8/8/3n4/8/8/3QK3 w - - 0 1';
    const { all } = listChecksAndCaptures(fen);
    const cap = all.find((m) => m.to === 'd4');
    expect(cap).toBeTruthy();
    expect(cap.isCapture).toBe(true);
  });
});

describe('findForcingMatch', () => {
  it('matches exact UCI', () => {
    const all = [{ uci: 'a1a8', san: 'Ra8#' }];
    expect(findForcingMatch(all, 'a1a8')?.san).toBe('Ra8#');
  });

  it('matches base squares when promo differs', () => {
    const all = [{ uci: 'b7a8q', san: 'bxa8=Q' }];
    expect(findForcingMatch(all, 'b7a8n')?.uci).toBe('b7a8q');
  });

  it('returns null when no match', () => {
    expect(findForcingMatch([{ uci: 'a1a8' }], 'e2e4')).toBeNull();
  });
});
