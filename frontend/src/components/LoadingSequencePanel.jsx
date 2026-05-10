export default function LoadingSequencePanel({ sequence, onCopy }) {
  const steps = sequence?.steps ?? []

  return (
    <section className="loading-sequence-panel" aria-label="Warehouse loading sequence">
      <header className="loading-sequence-header">
        <div>
          <p className="loading-sequence-kicker">Warehouse Actionable Export</p>
          <h4>Loading Sequence List</h4>
        </div>
        <button
          type="button"
          className="loading-sequence-copy-btn"
          onClick={onCopy}
          disabled={!sequence?.plainText}
        >
          Copy list
        </button>
      </header>
      <div className="loading-sequence-steps">
        {steps.map((item) => (
          <p key={`step-${item.step}`} className="loading-sequence-step">
            {item.text}
          </p>
        ))}
      </div>
    </section>
  )
}
