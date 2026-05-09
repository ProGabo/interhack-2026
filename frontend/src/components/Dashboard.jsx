import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { subscribeToRoute, markStopDelivered } from '../firebase'
import { useDriverLocation } from '../hooks/useDriverLocation'
import RouteMap from './Map'
import VoiceAssistant from './VoiceAssistant'
import TruckView from './TruckView'

function buildGoogleMapsUrl(points) {
  if (!points || points.length < 2) return '#'
  const origin = `${points[0].lat},${points[0].lng}`
  const dest = `${points.at(-1).lat},${points.at(-1).lng}`
  const waypoints = points.slice(1, -1).map((p) => `${p.lat},${p.lng}`).join('|')
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`
  return waypoints ? `${base}&waypoints=${waypoints}` : base
}

export default function Dashboard() {
  const { driverId, logout } = useAuth()
  const [route, setRoute] = useState(null)
  const [deliveryStatus, setDeliveryStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showTruck, setShowTruck] = useState(false)
  const { location: currentLocation } = useDriverLocation(driverId)

  useEffect(() => {
    return subscribeToRoute(driverId, (data) => {
      setRoute(data)
      setLoading(false)
      if (data) {
        setDeliveryStatus((prev) =>
          prev ?? (data.delivery_status ?? new Array(data.points.length).fill('pending'))
        )
      }
    })
  }, [driverId])

  function canToggle(index) {
    const delivered = deliveryStatus[index] === 'delivered'
    if (!delivered) {
      // Can only mark delivered if all previous stops are delivered
      return deliveryStatus.slice(0, index).every((s) => s === 'delivered')
    } else {
      // Can only undo if all subsequent stops are still pending
      return deliveryStatus.slice(index + 1).every((s) => s === 'pending')
    }
  }

  async function handleToggleDelivered(index) {
    if (!canToggle(index)) return
    const updated = [...deliveryStatus]
    updated[index] = updated[index] === 'delivered' ? 'pending' : 'delivered'
    setDeliveryStatus(updated)
    await markStopDelivered(driverId, updated)
  }

  return (
    <div className="dashboard">
      <nav className="navbar">
        <div className="navbar-brand">
          <span className="star">★</span>
          Damm Motion
        </div>
        <div className="navbar-driver">
          Driver: <span>{driverId}</span>
        </div>
        <button className="btn-logout" onClick={logout}>Log out</button>
      </nav>

      <div className="dashboard-body">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Today's route</h2>
            {route && <span className="truck-badge">🚛 {route.truck_id}</span>}
          </div>

          <div className="stops-list">
            {loading && <p className="sidebar-state">Loading…</p>}
            {!loading && !route && <p className="sidebar-state">No route assigned for today.</p>}
            {route?.points.map((point, i) => {
              const delivered = deliveryStatus?.[i] === 'delivered'
              return (
                <div className={`stop-item${delivered ? ' delivered' : ''}`} key={i}>
                  <div className="stop-number">{i + 1}</div>
                  <div className="stop-details">
                    <div className="stop-address">{point.address || 'Delivery point'}</div>
                    {route.windows?.[i] && (
                      <div className="stop-meta">
                        <span className="meta-label">Window</span>
                        {route.windows[i].start} – {route.windows[i].end}
                      </div>
                    )}
                    {route.service_times?.[i] != null && (
                      <div className="stop-meta">
                        <span className="meta-label">Service</span>
                        {route.service_times[i]} min
                      </div>
                    )}
                    <div className="stop-coords">
                      {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                    </div>
                  </div>
                  <button
                    className={`btn-deliver${delivered ? ' done' : ''}`}
                    onClick={() => handleToggleDelivered(i)}
                    disabled={!canToggle(i)}
                    title={
                      delivered
                        ? canToggle(i) ? 'Click to undo' : 'Complete later stops first'
                        : canToggle(i) ? 'Mark as delivered' : 'Complete previous stops first'
                    }
                  >
                    {delivered ? '✓' : '○'}
                  </button>
                </div>
              )
            })}
          </div>

          {route && (
            <div className="sidebar-footer">
              {route.pallets && (
                <button className="btn-truck-view" onClick={() => setShowTruck(true)}>
                  View truck interior
                </button>
              )}
              <a
                className="btn-gmaps"
                href={buildGoogleMapsUrl(route.points)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Google Maps ↗
              </a>
            </div>
          )}
        </aside>

        {showTruck && route?.pallets && (
          <TruckView
            layout={route.truck_layout}
            pallets={route.pallets}
            deliveries={route.deliveries}
            deliveryStatus={deliveryStatus}
            truckId={route.truck_id}
            onClose={() => setShowTruck(false)}
          />
        )}

        <main className="map-container">
          {loading ? (
            <div className="map-empty"><div className="spinner" /></div>
          ) : !route ? (
            <div className="map-empty"><p>No route assigned for today.</p></div>
          ) : (
            <>
              <RouteMap
                points={route.points}
                currentLocation={currentLocation}
                deliveryStatus={deliveryStatus}
              />
              <VoiceAssistant
                route={route}
                deliveryStatus={deliveryStatus}
                canToggle={canToggle}
                onMarkDelivered={handleToggleDelivered}
              />
            </>
          )}
        </main>
      </div>
    </div>
  )
}
