import { useEffect, useMemo, useState } from 'react'
import { normalizeStopData } from '../adapters/normalizeStopData'
import {
  buildDDIMetrics,
  buildManifestExplainability,
  buildRouteProgressStatus,
  buildSlotManifest,
} from '../adapters/operationalHeuristics'
import TruckCargo3D from './TruckCargo3D'
import ExplainabilityWidget from './ExplainabilityWidget'
import RouteProgressSlider from './RouteProgressSlider'
import SlotManifestGrid from './SlotManifestGrid'

function MetricCard({ label, value, detail }) {
  return (
    <article className="truck-kpi-card">
      <p className="truck-kpi-label">{label}</p>
      <strong>{value}</strong>
      {detail ? <span className="truck-kpi-detail">{detail}</span> : null}
    </article>
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
  const stopIndex = (safeStop?.index ?? 0) + 1
  const serviceTime = safeStop?.serviceTime ?? null
  const deliveryStatus = progressStop > (safeStop?.index ?? 0) ? 'delivered' : 'pending'
  const ddiMetrics = useMemo(
    () =>
      buildDDIMetrics({
        manifest,
        routeStops,
        progressStop,
        loadStats: normalizedStop?.loadStats ?? {},
      }),
    [manifest, routeStops, progressStop, normalizedStop?.loadStats],
  )
  const manifestInsights = useMemo(
    () => {
      const baseInsights = buildManifestExplainability({
        manifest,
        progressStop,
        loadStats: normalizedStop?.loadStats ?? {},
        ddiMetrics,
      })
      return highlightInsight ? [highlightInsight, ...baseInsights] : baseInsights
    },
    [manifest, progressStop, normalizedStop, ddiMetrics, highlightInsight],
  )
  const canProcessStop = progressStop < routeStops.length
  const rehandleRisk = Math.max(0, Number(ddiMetrics.blockedRehandleRisk ?? 0))
  const sideAccessStatus = String(ddiMetrics.sideAccessStatus ?? 'CLEAR')
  const overflowStatus = ddiMetrics.projectedOverflowRisk ? 'RISK' : 'OK'
  const blockedCoordinates = (ddiMetrics.blockedPallets ?? []).slice(0, 3).map((slot) => slot.coordinate)
  const blockedStackCoordinates = (ddiMetrics.verticalBlockedSlots ?? []).slice(0, 3).map((slot) => slot.coordinate)

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
        <MetricCard
          label="Blocked Pallets / Re-handle Risk"
          value={rehandleRisk}
          detail={`${Math.max(0, Number(ddiMetrics.blockedPalletsCount) || 0)} lateral blockers + ${Math.max(0, Number(ddiMetrics.extraMoves) || 0)} vertical extra moves.`}
        />
        <MetricCard
          label="Side-Access Status"
          value={sideAccessStatus}
          detail={`${Math.max(0, Number(ddiMetrics.sideAccessPercent) || 0)}% of current-stop layers remain on side-curtain lanes.`}
        />
        <MetricCard
          label="Capacity Overflow Risk"
          value={overflowStatus}
          detail={`Returns pending ${Math.max(0, Number(ddiMetrics.projectedPendingReturnVolume) || 0).toFixed(1)} m3 vs free ${Math.max(0, Number(ddiMetrics.returnsVolumeAvailable) || 0).toFixed(1)} m3.`}
        />
      </section>
      <section className={`truck-recommendation-banner${ddiMetrics.projectedOverflowRisk ? ' is-risk' : ''}`} aria-label="Operational recommendation">
        <p className="truck-recommendation-label">Decision Recommendation</p>
        <strong>{ddiMetrics.recommendation}</strong>
      </section>
      <section className="truck-micro-insights" aria-label="Metric assumptions and blockers">
        <article className="truck-micro-card">
          <p className="truck-micro-label">Blocked Slot IDs</p>
          <strong>{[...blockedCoordinates, ...blockedStackCoordinates].slice(0, 3).join(', ') || 'None'}</strong>
          <span className="truck-micro-detail">Top 3 slots creating lateral or vertical re-handle risk for the current stop.</span>
        </article>
        <article className="truck-micro-card">
          <p className="truck-micro-label">Side Lane Reservation</p>
          <strong>
            {ddiMetrics.sideAccessDetail}
          </strong>
          <span className="truck-micro-detail">Inner lanes should absorb return payload first so both curtains remain reachable.</span>
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
        <TruckCargo3D
          items={selectedStop?.stopData?.items ?? []}
          itemGrid={selectedStop?.stopData?.itemGrid ?? null}
          selectedStopId={selectedStop?.stopId ?? normalizedStop?.stopId ?? null}
          selectedStopIndex={selectedStop?.index ?? null}
          stopData={normalizedStop}
          cargo={selectedStop?.stopData?.cargo ?? normalizedStop?.pallets ?? []}
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
