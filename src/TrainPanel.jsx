import { useState } from 'preact/hooks';

const SIDES = [
  { value: 'fen', label: 'From FEN' },
  { value: 'w',   label: 'White to move' },
  { value: 'b',   label: 'Black to move' },
];

export function TrainPanel({ onLoad, onFlip }) {
  const [fenInput, setFenInput] = useState('');
  const [side, setSide] = useState('fen');
  const [status, setStatus] = useState('Engine ready');
  const [message, setMessage] = useState('Paste a position to begin.');
  const [messageError, setMessageError] = useState(false);

  function handleLoad() {
    if (!fenInput.trim()) {
      setMessage('Paste a FEN first.');
      setMessageError(true);
      return;
    }
    // For the prototype, just set the position directly
    // (in the real app this goes through engine.js + analyzer.js)
    setStatus('Ready for training!');
    setMessage('Find the best move on the board.');
    setMessageError(false);
    onLoad(fenInput.trim(), side);
  }

  return (
    <>
      <div id="status">Status: {status}</div>

      <input
        type="text"
        id="fenInput"
        placeholder="Paste FEN here (from Lichess/Chess.com)"
        value={fenInput}
        onInput={e => setFenInput(e.target.value)}
      />

      <div class="side-toggle">
        {SIDES.map(({ value, label }) => (
          <label key={value}>
            <input
              type="radio"
              name="side"
              value={value}
              checked={side === value}
              onChange={e => setSide(e.target.value)}
            />
            {label}
          </label>
        ))}
      </div>

      <div class="btn-row">
        <button class="btn-main" onClick={handleLoad}>
          Load Position
        </button>
        <button class="btn-flip" onClick={onFlip}>
          ⇅ Flip
        </button>
      </div>

      <button class="btn-hint">
        I need a hint
      </button>

      <div id="message" class={messageError ? 'error' : ''}>
        {message}
      </div>
    </>
  );
}
