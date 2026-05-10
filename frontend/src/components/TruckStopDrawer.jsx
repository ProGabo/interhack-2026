import { useEffect, useMemo, useRef, useState } from 'react'
import { animate } from 'framer-motion'
import { normalizeStopData } from '../adapters/normalizeStopData'
import {
  buildManifestExplainability,
  computeReturnableSpaceReuse,
  buildRouteProgressStatus,
  buildSlotManifest,
} from '../adapters/operationalHeuristics'
import TruckCargo3D from './TruckCargo3D'
import ExplainabilityWidget from './ExplainabilityWidget'
import RouteProgressSlider from './RouteProgressSlider'
import SlotManifestGrid from './SlotManifestGrid'

// Local fallback prevents crashes if the heatmap component is missing.
function TruckStatusHeatmap({ manifest, trackedSlots }) {
  const manifestSlots = Array.isArray(manifest?.slots) ? manifest.slots.length : 0
  const slots = Number.isFinite(trackedSlots) ? trackedSlots : manifestSlots
  return (
    <div className="truck-status-heatmap-fallback" aria-label="Truck status fallback">
      <strong>Truck Status</strong>
      <span>{slots} slots tracked</span>
    </div>
  )
}

export default function TruckStopDrawer({ selectedStop, onClose }) {
  const safeStop = selectedStop ?? {}
  const routeStops = safeStop?.routeStops ?? safeStop?.routeContext?.stops ?? []
  const deliveryStatusList = safeStop?.routeDeliveryStatus ?? []
  const selectedStopProgress = Math.max(
    0,
    Math.min(routeStops.length, safeStop?.index ?? 0),
  )
  const defaultProgressStop = deliveryStatusList.filter((status) => status === 'delivered').length
  const [progressStop, setProgressStop] = useState(selectedStopProgress ?? defaultProgressStop)
  const [trackedSlots, setTrackedSlots] = useState(0)
  const [processTransitionTrigger, setProcessTransitionTrigger] = useState(0)
  const [progressAction, setProgressAction] = useState('sync')
  const [highlightInsight, setHighlightInsight] = useState('')

  useEffect(() => {
    // Sync slider with map-selected stop, while still allowing manual slider override afterwards.
    setProgressAction('sync')
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
    () => {
      const baseInsights = buildManifestExplainability({
        manifest,
        progressStop,
        loadStats: normalizedStop?.loadStats ?? {},
        operationalKpis: normalizedStop?.operationalKpis ?? {},
      })
      return highlightInsight ? [highlightInsight, ...baseInsights] : baseInsights
    },
    [manifest, progressStop, normalizedStop, highlightInsight],
  )

  const stopIndex = (safeStop?.index ?? 0) + 1
  const serviceTime = safeStop?.serviceTime ?? null
  const deliveryStatus = progressStop > (safeStop?.index ?? 0) ? 'delivered' : 'pending'
  const operationalKpis = normalizedStop?.operationalKpis ?? {}
  const returnableSpaceReuse = useMemo(
    () => computeReturnableSpaceReuse({ manifest }),
    [manifest],
  )
  const canProcessStop = progressStop < routeStops.length
  const displayedTimeSaved = operationalKpis?.estimatedUnloadMinutesSaved
    ?? operationalKpis?.estimatedUnloadMinutes
    ?? serviceTime
    ?? 0
  const displayedCo2Saved = operationalKpis?.co2SavedKg ?? 0
  const [animatedTimeSaved, setAnimatedTimeSaved] = useState(Number(displayedTimeSaved) || 0)
  const [animatedCo2Saved, setAnimatedCo2Saved] = useState(Number(displayedCo2Saved) || 0)
  const previousTimeSavedRef = useRef(Number(displayedTimeSaved) || 0)
  const previousCo2SavedRef = useRef(Number(displayedCo2Saved) || 0)

  useEffect(() => {
    const nextTime = Number(displayedTimeSaved) || 0
    const fromTime = previousTimeSavedRef.current
    if (fromTime === nextTime) {
      setAnimatedTimeSaved(nextTime)
      return () => {}
    }
    const controls = animate(fromTime, nextTime, {
      duration: 0.45,
      ease: 'easeOut',
      onUpdate: (latest) => setAnimatedTimeSaved(latest),
    })
    previousTimeSavedRef.current = nextTime
    return () => controls.stop()
  }, [displayedTimeSaved])

  useEffect(() => {
    const nextCo2 = Number(displayedCo2Saved) || 0
    const fromCo2 = previousCo2SavedRef.current
    if (fromCo2 === nextCo2) {
      setAnimatedCo2Saved(nextCo2)
      return () => {}
    }
    const controls = animate(fromCo2, nextCo2, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (latest) => setAnimatedCo2Saved(latest),
    })
    previousCo2SavedRef.current = nextCo2
    return () => controls.stop()
  }, [displayedCo2Saved])

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
          <p className="truck-kpi-label">Time Saved</p>
          <strong>{Math.max(0, Math.round(animatedTimeSaved))} min</strong>
        </article>
        <article className="truck-kpi-card">
          <p className="truck-kpi-label">CO2 Saved</p>
          <strong>{Math.max(0, animatedCo2Saved).toFixed(1)} kg</strong>
        </article>
        <article className="truck-kpi-card">
          <p className="truck-kpi-label">Returnable Space Reuse</p>
          <strong>{returnableSpaceReuse}%</strong>
        </article>
      </section>

      <RouteProgressSlider
        progressStop={progressStop}
        totalStops={routeStops.length}
        onProgressChange={(nextStop) => {
          setProgressAction('slider')
          setProgressStop(nextStop)
        }}
        onProcessStop={() => {
          if (!canProcessStop) return
          setProgressAction('process')
          setProcessTransitionTrigger((prev) => prev + 1)
          setProgressStop((prev) => Math.min(routeStops.length, prev + 1))
        }}
        canProcessStop={canProcessStop}
      />

      <div className="truck-stop-canvas-wrap">
        <TruckStatusHeatmap
          manifest={manifest}
          trackedSlots={trackedSlots}
          progressStop={progressStop}
          totalStops={routeStops.length}
        />
        <TruckCargo3D
          stopData={normalizedStop}
          selectedStopId={safeStop?.stopId ?? normalizedStop?.stopId ?? null}
          selectedStopIndex={safeStop?.index ?? null}
          cargo={safeStop?.stopData?.cargo ?? normalizedStop?.pallets ?? []}
          routeContext={safeStop?.routeContext ?? null}
          deliveryStatus={progressDeliveryStatus}
          ghostZones={normalizedStop?.ghostZones ?? []}
          manifest={manifest}
          progressStop={progressStop}
          activeStopIndex={Math.max(0, Math.min(routeStops.length, progressStop))}
          processTransitionTrigger={processTransitionTrigger}
          progressAction={progressAction}
          onTrackedSlotsChange={setTrackedSlots}
          onHighlightReasonChange={setHighlightInsight}
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
