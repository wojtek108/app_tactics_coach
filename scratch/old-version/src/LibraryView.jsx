import { useState, useMemo, useCallback } from 'preact/hooks';
import { Chessground } from 'chessground';
import { loadPositions, loadAttempts, deletePosition, updatePosition, exportLibrary, importLibrary } from './storage.js';
import { MOTIFS } from './motifs.js';
import { useAppDispatch } from './context.jsx';

/**
 * Library view (M8) — table of saved positions with filters, sort, actions.
 * Export/Import (M9) — download/upload JSON backup.
 */

function MiniThumb({ fen, lastMove }) {
  const ref = (el) => {
    if (!el) return;
    el.innerHTML = '';
    try {
      Chessground(el, {
        fen,
        viewOnly: true,
        coordinates: false,
        lastMove: lastMove || undefined,
        animation: { enabled: false },
        drawable: { enabled: false },
      });
    } catch {
      // Silent
    }
  };
  return <div class="lib-thumb cg-wrap" ref={ref} />;
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getMotifName(id) {
  const m = MOTIFS.find((x) => x.id === id);
  return m ? m.name : id || '—';
}

export function LibraryView() {
  const dispatch = useAppDispatch();
  const [positions, setPositions] = useState(() => loadPositions());
  const [attempts, setAttempts] = useState(() => loadAttempts());
  const [filterMotif, setFilterMotif] = useState('');
  const [filterNeedsWork, setFilterNeedsWork] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editMotif, setEditMotif] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [importMessage, setImportMessage] = useState(null);

  // Reload from storage
  const reload = useCallback(() => {
    setPositions(loadPositions());
    setAttempts(loadAttempts());
  }, []);

  // Compute enrichment for each position
  const enriched = useMemo(() => {
    return positions.map((pos) => {
      const posAttempts = attempts.filter((a) => a.positionId === pos.id);
      const lastAttempt = posAttempts.sort(
        (a, b) => new Date(b.date) - new Date(a.date),
      )[0];
      const attemptCount = posAttempts.length;
      const lastAttempted = lastAttempt ? lastAttempt.date : null;
      const hintsUsed = lastAttempt ? lastAttempt.hintsUsed : null;
      const needsWork = hintsUsed !== null && (hintsUsed >= 3 || hintsUsed === 4);
      return { ...pos, attemptCount, lastAttempted, hintsUsed, needsWork };
    });
  }, [positions, attempts]);

  // Sort: longest-unseen first (never attempted → oldest createdAt first)
  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      const aDate = a.lastAttempted || a.createdAt;
      const bDate = b.lastAttempted || b.createdAt;
      return new Date(aDate) - new Date(bDate); // oldest first = longest unseen
    });
  }, [enriched]);

  // Filter
  const filtered = useMemo(() => {
    let result = sorted;
    if (filterMotif) {
      result = result.filter((p) => p.motif === filterMotif || p.motifConfirmed === filterMotif);
    }
    if (filterNeedsWork) {
      result = result.filter((p) => p.needsWork);
    }
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      result = result.filter(
        (p) =>
          p.fen.toLowerCase().includes(q) ||
          (p.notes && p.notes.toLowerCase().includes(q)) ||
          getMotifName(p.motif).toLowerCase().includes(q),
      );
    }
    return result;
  }, [sorted, filterMotif, filterNeedsWork, searchText]);

  // Distinct motifs in library (for filter dropdown)
  const distinctMotifs = useMemo(() => {
    const ids = new Set(positions.map((p) => p.motif).filter(Boolean));
    return [...ids];
  }, [positions]);

  // Actions
  const handleTrain = (pos) => {
    dispatch({ type: 'SET_TAB', tab: 'Train' });
    window.dispatchEvent(new CustomEvent('scc:load-fen', { detail: { fen: pos.fen } }));
  };

  const handleEdit = (pos) => {
    setEditingId(pos.id);
    setEditMotif(pos.motif || 'unknown');
    setEditNotes(pos.notes || '');
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    updatePosition(editingId, { motif: editMotif, motifConfirmed: editMotif, notes: editNotes || undefined });
    setEditingId(null);
    reload();
  };

  const handleDelete = (id) => {
    deletePosition(id);
    setConfirmDeleteId(null);
    reload();
  };

  // Export (M9)
  const handleExport = () => {
    const data = exportLibrary();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `scc-library-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import (M9)
  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (!data || !Array.isArray(data.positions)) {
            setImportMessage({ text: 'Invalid file format.', error: true });
            return;
          }
          // Offer merge (default)
          const ok = importLibrary(data, 'merge');
          if (ok) {
            reload();
            setImportMessage({ text: `Imported ${data.positions.length} positions.`, error: false });
          } else {
            setImportMessage({ text: 'Import failed.', error: true });
          }
        } catch {
          setImportMessage({ text: 'Could not parse JSON file.', error: true });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Empty state
  if (positions.length === 0) {
    return (
      <div class="library-empty">
        <p>No positions yet.</p>
        <p>Train on a FEN and save it, or click a motif in the Motifs tab.</p>
        <div class="library-actions">
          <button class="btn-hint" onClick={handleImport}>Import library</button>
        </div>
      </div>
    );
  }

  return (
    <div class="library">
      {/* Filters */}
      <div class="lib-filters">
        <select
          class="lib-filter-select"
          value={filterMotif}
          onChange={(e) => setFilterMotif(e.target.value)}
        >
          <option value="">All motifs</option>
          {distinctMotifs.map((id) => (
            <option key={id} value={id}>{getMotifName(id)}</option>
          ))}
        </select>

        <label class="lib-checkbox">
          <input
            type="checkbox"
            checked={filterNeedsWork}
            onChange={(e) => setFilterNeedsWork(e.target.checked)}
          />
          Needs work
        </label>

        <input
          type="text"
          class="lib-search"
          placeholder="Search FEN / notes…"
          value={searchText}
          onInput={(e) => setSearchText(e.target.value)}
        />
      </div>

      {/* Import/Export */}
      <div class="lib-io">
        <button class="btn-io" onClick={handleExport}>Export</button>
        <button class="btn-io" onClick={handleImport}>Import</button>
        {importMessage && (
          <span class={importMessage.error ? 'lib-msg-error' : 'lib-msg-ok'}>
            {importMessage.text}
          </span>
        )}
      </div>

      {/* Table */}
      <div class="lib-table">
        {filtered.length === 0 && (
          <div class="lib-empty-filtered">No positions match your filters.</div>
        )}
        {filtered.map((pos) => (
          <div key={pos.id} class="lib-row">
            <div class="lib-thumb-wrap">
              <MiniThumb fen={pos.fen} />
            </div>

            <div class="lib-info">
              <div class="lib-motif-tag">{getMotifName(pos.motif)}</div>
              <div class="lib-meta">
                {pos.attemptCount} attempt{pos.attemptCount !== 1 ? 's' : ''}
                {pos.lastAttempted ? ` · last ${formatDate(pos.lastAttempted)}` : ' · never attempted'}
              </div>
              {pos.notes && <div class="lib-notes">{pos.notes}</div>}

              {/* Edit form */}
              {editingId === pos.id && (
                <div class="lib-edit-form">
                  <select value={editMotif} onChange={(e) => setEditMotif(e.target.value)}>
                    {MOTIFS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                    <option value="unknown">Unknown</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Notes"
                    value={editNotes}
                    onInput={(e) => setEditNotes(e.target.value)}
                  />
                  <div class="btn-row">
                    <button class="btn-main" onClick={handleSaveEdit}>Save</button>
                    <button class="btn-flip" onClick={() => setEditingId(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            <div class="lib-actions">
              <button class="lib-action-btn" onClick={() => handleTrain(pos)} title="Train">▶</button>
              <button class="lib-action-btn" onClick={() => handleEdit(pos)} title="Edit">✎</button>
              {confirmDeleteId === pos.id ? (
                <span class="lib-confirm-delete">
                  <button class="lib-action-btn lib-danger" onClick={() => handleDelete(pos.id)}>Yes</button>
                  <button class="lib-action-btn" onClick={() => setConfirmDeleteId(null)}>No</button>
                </span>
              ) : (
                <button class="lib-action-btn" onClick={() => setConfirmDeleteId(pos.id)} title="Delete">✕</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
