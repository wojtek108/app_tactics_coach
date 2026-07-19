// ============================================================================
// Stockfish Web Worker wrapper — minimal async interface
// ============================================================================

const MOVETIME_MS = 4000;

/**
 * Creates and initializes a Stockfish engine running in a Web Worker.
 *
 * Returns an object with:
 *   ready()       — Promise that resolves when engine is initialized
 *   analyze(fen)  — Promise that resolves with the best move UCI string
 *   destroy()     — Terminates the worker
 */
export function createEngine({ onStatus } = {}) {
  const worker = new Worker('/stockfish.js');
  let ready = false;
  let readyResolve;
  const readyPromise = new Promise((r) => {
    readyResolve = r;
  });
  let pendingResolve = null;

  worker.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : '';

    // Initialization handshake
    if (!ready) {
      if (line.includes('uciok')) worker.postMessage('isready');
      else if (line.includes('readyok')) {
        ready = true;
        readyResolve();
      }
      return;
    }

    // Forward depth updates if a status callback is provided
    if (onStatus) {
      const depthMatch = line.match(/^info .*\bdepth (\d+)/);
      if (depthMatch && pendingResolve) {
        onStatus(`Engine thinking… depth ${depthMatch[1]}`);
      }
    }

    // Pending analysis — intercept bestmove
    if (pendingResolve && line.startsWith('bestmove')) {
      const move = line.split(' ')[1];
      pendingResolve(move === '(none)' ? null : move);
      pendingResolve = null;
    }
  };

  worker.postMessage('uci');

  return {
    ready: () => readyPromise,

    analyze(fen, movetime = MOVETIME_MS) {
      return new Promise((resolve) => {
        worker.postMessage('stop');
        worker.postMessage('ucinewgame');
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go movetime ${movetime}`);
        pendingResolve = resolve;

        // Safety timeout: resolve with null if engine hangs
        setTimeout(() => {
          if (pendingResolve === resolve) {
            pendingResolve = null;
            resolve(null);
          }
        }, movetime + 10000);
      });
    },

    destroy() {
      worker.terminate();
    },
  };
}
