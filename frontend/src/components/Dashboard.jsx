import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { getRoute } from '../firebase'
import { useDriverLocation } from '../hooks/useDriverLocation'
import RouteMap from './Map'

function buildGoogleMapsUrl(points) {
  if (!points || points.length < 2) return '#'
  const origin = `${points[0].lat},${points[0].lng}`
  const dest = `${points.at(-1).lat},${points.at(-1).lng}`
  const waypoints = points
    .slice(1, -1)
    .map((p) => `${p.lat},${p.lng}`)
    .join('|')
  const base = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`
  return waypoints ? `${base}&waypoints=${waypoints}` : base
}

export default function Dashboard() {
  const { driverId, logout } = useAuth()
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(true)
  const { location: currentLocation } = useDriverLocation(driverId)

  useEffect(() => {
    getRoute(driverId).then((data) => {
      console.log('route data:', JSON.stringify(data, null, 2))
      setRoute(data)
      setLoading(false)
    })
  }, [driverId])

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
        <button className="btn-logout" onClick={logout}>
          Log out
        </button>
      </nav>

      <div className="dashboard-body">
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Today's route</h2>
            {route && (
              <span className="truck-badge">🚛 {route.truck_id}</span>
            )}
          </div>

          <div className="stops-list">
            {loading && <p className="sidebar-state">Loading…</p>}
            {!loading && !route && (
              <p className="sidebar-state">No route assigned for today.</p>
            )}
            {route?.points.map((point, i) => (
              <div className="stop-item" key={i}>
                <div className="stop-number">{i + 1}</div>
                <div className="stop-details">
                  <div className="stop-address">
                    {point.address || 'Delivery point'}
                  </div>
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
              </div>
            ))}
          </div>

          {route && (
            <div className="sidebar-footer">
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

        <main className="map-container">
          {loading ? (
            <div className="map-empty">
              <div className="spinner" />
            </div>
          ) : !route ? (
            <div className="map-empty">
              <p>No route assigned for today.</p>
            </div>
          ) : (
            <RouteMap points={route.points} currentLocation={currentLocation} />
          )}
        </main>
      </div>
    </div>
  )
}
