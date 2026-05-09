export default function RouteProgressSlider({
  progressStop = 0,
  totalStops = 0,
  onProgressChange,
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
      <p className="route-progress-caption">
        Slide to fade delivered full pallets and auto-assign return ghost slots.
      </p>
    </section>
  )
}
