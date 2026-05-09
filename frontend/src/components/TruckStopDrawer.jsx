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
    Math.min(routeStops.length, safeStop?.index ?? 0),
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
    () =>
      buildManifestExplainability({
        manifest,
        progressStop,
        loadStats: normalizedStop?.loadStats ?? {},
        operationalKpis: normalizedStop?.operationalKpis ?? {},
      }),
    [manifest, progressStop, normalizedStop],
  )

  const stopIndex = (safeStop?.index ?? 0) + 1
  const serviceTime = safeStop?.serviceTime ?? null
  const deliveryStatus = progressStop > (safeStop?.index ?? 0) ? 'delivered' : 'pending'
  const operationalKpis = normalizedStop?.operationalKpis ?? {}
  const canProcessStop = progressStop < routeStops.length
  const displayedUnloadMinutes = operationalKpis?.estimatedUnloadMinutes
    ?? operationalKpis?.estimatedUnloadMinutesSaved
    ?? serviceTime
    ?? 0

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

      <section className="truck-kpi-header" aria-label="KPI Impact Header">
        <article className="truck-kpi-card">
          <p className="truck-kpi-label">Descàrrega Estimada</p>
          <strong>{displayedUnloadMinutes} min</strong>
        </article>
        <article className="truck-kpi-card">
          <p className="truck-kpi-label">Ocupació del Camió</p>
          <strong>{operationalKpis?.occupancyPercent ?? 0}%</strong>
        </article>
        <article className="truck-kpi-card">
          <p className="truck-kpi-label">Km Estalviats</p>
          <strong>{operationalKpis?.kmSavedVsManual ?? operationalKpis?.distancePenaltyKm ?? 0} km</strong>
        </article>
      </section>

      <RouteProgressSlider
        progressStop={progressStop}
        totalStops={routeStops.length}
        onProgressChange={setProgressStop}
        onProcessStop={() => {
          if (!canProcessStop) return
          setProgressStop((prev) => Math.min(routeStops.length, prev + 1))
        }}
        canProcessStop={canProcessStop}
      />

      <div className="truck-stop-canvas-wrap">
        <TruckCargo3D
          stopData={normalizedStop}
          selectedStopId={safeStop?.stopId ?? normalizedStop?.stopId ?? null}
          selectedStopIndex={safeStop?.index ?? null}
          cargo={safeStop?.stopData?.cargo ?? normalizedStop?.pallets ?? []}
          ghostZones={normalizedStop?.ghostZones ?? []}
          manifest={manifest}
          progressStop={progressStop}
        />
      </div>

      <ExplainabilityWidget
        className="explainability-widget explainability-widget-drawer"
        title="AI Load Reasoning"
        kicker="Explicabilitat"
        insights={manifestInsights}
      />
      <SlotManifestGrid manifest={manifest} />
    </aside>
  )
}
