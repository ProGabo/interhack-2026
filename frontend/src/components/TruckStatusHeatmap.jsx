import { useMemo } from 'react'
import { buildTruckStatusHeatmap } from '../adapters/operationalHeuristics'

export default function TruckStatusHeatmap({ manifest, progressStop = 0, totalStops = 0 }) {
  const heatmap = useMemo(
    () => buildTruckStatusHeatmap({ manifest }),
    [manifest],
  )

  return (
    <section className="truck-status-card" aria-label="Truck status heatmap">
      <header className="truck-status-header">
        <div>
          <p className="truck-status-kicker">Truck Status</p>
          <h4>Top-down delivery and reverse logistics map</h4>
        </div>
        <p className="truck-status-progress">
          Stop {Math.min(progressStop + 1, Math.max(totalStops, 1))} / {Math.max(totalStops, 1)}
        </p>
      </header>

      <div
        className="truck-status-grid"
        style={{ gridTemplateColumns: `repeat(${Math.max(heatmap.cols, 1)}, minmax(0, 1fr))` }}
      >
        {heatmap.cells.map((cell) => (
          <article
            key={cell.key}
            className={`truck-status-cell truck-status-${cell.status}${cell.redZone ? ' truck-status-red-zone' : ''}`}
            title={`${cell.assignment} - ${cell.access}`}
          >
            <span className="truck-status-cell-slot">R{cell.row + 1}C{cell.col + 1}</span>
            <span className="truck-status-cell-state">
              {cell.status === 'delivery' ? 'Delivery' : cell.status === 'returnable' ? 'Return' : 'Empty'}
            </span>
            {cell.redZone && <span className="truck-status-cell-warning">Red Zone</span>}
          </article>
        ))}
      </div>

      <div className="truck-status-legend">
        <span className="truck-status-legend-item">
          <i className="truck-status-dot truck-status-dot-delivery" />
          Delivery pending (blue)
        </span>
        <span className="truck-status-legend-item">
          <i className="truck-status-dot truck-status-dot-empty" />
          Delivered / empty (green)
        </span>
        <span className="truck-status-legend-item">
          <i className="truck-status-dot truck-status-dot-return" />
          Reverse logistics (orange)
        </span>
      </div>

      {heatmap.redZoneWarnings.length > 0 && (
        <p className="truck-status-redzone-note">
          Red Zone warning: {heatmap.redZoneWarnings.length} returnable slot(s) are in inner lanes and may force extra warehouse or driver handling.
        </p>
      )}
    </section>
  )
}
