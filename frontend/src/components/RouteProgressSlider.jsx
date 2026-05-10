export default function RouteProgressSlider({
  progressStop = 0,
  totalStops = 0,
  onProgressChange,
  onProcessStop,
  canProcessStop = true,
}) {
  const safeTotalStops = Math.max(0, totalStops)
  const safeProgress = Math.max(0, Math.min(safeTotalStops, progressStop))

  return (
    <section className="route-progress-card" aria-label="Route progress simulation">
      <div className="route-progress-head">
        <p className="route-progress-kicker">Reverse Logistics Simulation</p>
        <strong>
          Stop {safeProgress} / {safeTotalStops}
        </strong>
      </div>
      <input
        className="route-progress-slider"
        type="range"
        min={0}
        max={safeTotalStops}
        step={1}
        value={safeProgress}
        onChange={(event) => onProgressChange?.(Number(event.target.value))}
      />
      <div className="route-progress-actions">
        <button
          type="button"
          className="btn-process-stop"
          onClick={() => onProcessStop?.()}
          disabled={!canProcessStop}
        >
          {canProcessStop ? 'Process Stop' : 'All Stops Processed'}
        </button>
      </div>
      <p className="route-progress-caption">
        Process each stop with top-down (LIFO) unloading so return layers open only after delivery layers are cleared from the same stack.
      </p>
    </section>
  )
}
