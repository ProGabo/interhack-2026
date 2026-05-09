import { useEffect, useMemo, useState } from 'react'
import { normalizeStopData } from '../adapters/normalizeStopData'
import {
  buildManifestExplainability,
  buildRouteProgressStatus,
  buildSlotManifest,
} from '../adapters/operationalHeuristics'
import TruckCargo3D from './TruckCargo3D'
import ExplainabilityWidget from './ExplainabilityWidget'
import RouteProgressSlider from './RouteProgressSlider'
import SlotManifestGrid from './SlotManifestGrid'

export default function TruckStopDrawer({ selectedStop, onClose }) {
  const safeStop = selectedStop ?? {}
  const routeStops = safeStop?.routeStops ?? safeStop?.routeContext?.stops ?? []
  const deliveryStatusList = safeStop?.routeDeliveryStatus ?? []
  const selectedStopProgress = Math.max(
    0,
    Math.min(routeStops.length, (safeStop?.index ?? -1) + 1),
  )
  const defaultProgressStop = deliveryStatusList.filter((status) => status === 'delivered').length
  const [progressStop, setProgressStop] = useState(
    selectedStopProgress || defaultProgressStop,
  )

  useEffect(() => {
    // Sync slider with map-selected stop, while still allowing manual slider override afterwards.
    setProgressStop(selectedStopProgress)
  }, [safeStop?.stopId, safeStop?.index, selectedStopProgress])

  const progressDeliveryStatus = useMemo(
    () => buildRouteProgressStatus(routeStops.length, progressStop),
    [routeStops, progressStop],
  )

  const stopForNormalization = useMemo(
    () => ({
      ...safeStop,
      routeDeliveryStatus: progressDeliveryStatus,
    }),
    [safeStop, progressDeliveryStatus],
  )

  const normalizedStop = useMemo(
    () => normalizeStopData(stopForNormalization),
    [stopForNormalization],
  )
  const manifest = useMemo(
    () =>
      buildSlotManifest({
        routeStops,
        progressStop,
        matrix: normalizedStop?.matrix ?? [],
      }),
    [routeStops, progressStop, normalizedStop],
  )
  const manifestInsights = useMemo(
    () => buildManifestExplainability({ manifest, progressStop }),
    [manifest, progressStop],
  )

  const stopIndex = (safeStop?.index ?? 0) + 1
  const serviceTime = safeStop?.serviceTime ?? null
  const deliveryStatus = progressStop > (safeStop?.index ?? 0) ? 'delivered' : 'pending'

  if (!selectedStop) return null

  return (
    <aside className="truck-stop-drawer" role="dialog" aria-modal="false" aria-label="Stop cargo details">
      <header className="truck-stop-drawer-header">
        <div>
          <p className="truck-stop-kicker">Stop {stopIndex}</p>
          <h3 className="truck-stop-title">{normalizedStop?.address ?? 'Delivery point'}</h3>
        </div>
        <button type="button" className="truck-stop-close-btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="truck-stop-meta-grid">
        <div className="truck-stop-meta-card">
          <span className="truck-stop-meta-label">Truck</span>
          <strong>{safeStop?.truckId ?? normalizedStop?.truckId ?? 'N/A'}</strong>
        </div>
        <div className="truck-stop-meta-card">
          <span className="truck-stop-meta-label">Status</span>
          <strong>{deliveryStatus}</strong>
        </div>
        <div className="truck-stop-meta-card">
          <span className="truck-stop-meta-label">Service</span>
          <strong>{serviceTime != null ? `${serviceTime} min` : 'N/A'}</strong>
        </div>
        <div className="truck-stop-meta-card">
          <span className="truck-stop-meta-label">Pallets</span>
          <strong>{normalizedStop?.pallets?.length ?? 0}</strong>
        </div>
      </div>

      <RouteProgressSlider
        progressStop={progressStop}
        totalStops={routeStops.length}
        onProgressChange={setProgressStop}
      />

      <div className="truck-stop-canvas-wrap">
        <TruckCargo3D
          stopData={normalizedStop}
          selectedStopId={safeStop?.stopId ?? normalizedStop?.stopId ?? null}
          selectedStopIndex={safeStop?.index ?? null}
          cargo={safeStop?.stopData?.cargo ?? normalizedStop?.pallets ?? []}
          ghostZones={normalizedStop?.ghostZones ?? []}
          manifest={manifest}
        />
      </div>

      <ExplainabilityWidget
        className="explainability-widget explainability-widget-drawer"
        title="Why These Slots Were Assigned"
        kicker="Judge Explicability"
        insights={manifestInsights}
      />
      <SlotManifestGrid manifest={manifest} />
    </aside>
  )
}
