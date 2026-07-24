// ============================================================================
// localStorage CRUD for positions (M6) and attempts (M7).
//
// Positions: localStorage['scc.positions'] → Position[]
// Attempts:  localStorage['scc.attempts']  → Attempt[]
//
// Never auto-save. Explicit "Save to library" button only.
// ============================================================================

const POSITIONS_KEY = 'scc.positions';
const ATTEMPTS_KEY = 'scc.attempts';

// ---------------------------------------------------------------------------
// Positions (M6)
// ---------------------------------------------------------------------------

export function loadPositions() {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY)) || [];
  } catch {
    return [];
  }
}

export function savePositions(positions) {
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
}

export function addPosition(pos) {
  const positions = loadPositions();
  positions.push(pos);
  savePositions(positions);
  return pos;
}

export function updatePosition(id, updates) {
  const positions = loadPositions();
  const idx = positions.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  positions[idx] = { ...positions[idx], ...updates };
  savePositions(positions);
  return positions[idx];
}

export function deletePosition(id) {
  const positions = loadPositions().filter((p) => p.id !== id);
  savePositions(positions);
  // Also delete attempts for this position
  const attempts = loadAttempts().filter((a) => a.positionId !== id);
  saveAttempts(attempts);
}

export function getPosition(id) {
  return loadPositions().find((p) => p.id === id) || null;
}

// ---------------------------------------------------------------------------
// Attempts (M7)
// ---------------------------------------------------------------------------

export function loadAttempts() {
  try {
    return JSON.parse(localStorage.getItem(ATTEMPTS_KEY)) || [];
  } catch {
    return [];
  }
}

export function saveAttempts(attempts) {
  localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
}

export function addAttempt(attempt) {
  const attempts = loadAttempts();
  attempts.push(attempt);
  saveAttempts(attempts);
  return attempt;
}

export function getAttemptsForPosition(positionId) {
  return loadAttempts().filter((a) => a.positionId === positionId);
}

// ---------------------------------------------------------------------------
// Export / Import (M9 placeholder — full implementation later)
// ---------------------------------------------------------------------------

export function exportLibrary() {
  return {
    positions: loadPositions(),
    attempts: loadAttempts(),
    exportedAt: new Date().toISOString(),
  };
}

export function importLibrary(data, mode = 'merge') {
  if (!data || !Array.isArray(data.positions)) return false;

  if (mode === 'replace') {
    savePositions(data.positions);
    saveAttempts(data.attempts || []);
  } else {
    // Merge by id — skip duplicates
    const existing = new Set(loadPositions().map((p) => p.id));
    const existingAttempts = new Set(loadAttempts().map((a) => a.id));
    const newPositions = data.positions.filter((p) => !existing.has(p.id));
    const newAttempts = (data.attempts || []).filter((a) => !existingAttempts.has(a.id));
    savePositions([...loadPositions(), ...newPositions]);
    saveAttempts([...loadAttempts(), ...newAttempts]);
  }
  return true;
}
