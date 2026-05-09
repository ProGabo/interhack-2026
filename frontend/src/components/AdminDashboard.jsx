import { useEffect, useRef, useState } from 'react'
// RouteDirections uses useMapsLibrary('routes') — same as the driver map
import { Map, AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { useAuth } from '../context/AuthContext'
import { subscribeToRoutes } from '../firebase'

const COLORS = ['#C41230', '#2563EB', '#059669', '#D97706', '#7C3AED']

function RouteDirections({ points, color }) {
  const map = useMap()
  const routesLib = useMapsLibrary('routes')
  const rendererRef = useRef(null)

  useEffect(() => {
    if (!routesLib || !map) return
    const renderer = new routesLib.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: color, strokeWeight: 4, strokeOpacity: 0.7 },
    })
    renderer.setMap(map)
    rendererRef.current = renderer
    return () => renderer.setMap(null)
  }, [routesLib, map, color])

  useEffect(() => {
    if (!rendererRef.current || !routesLib || points.length < 2) return
    const service = new routesLib.DirectionsService()
    service.route(
      {
        origin: { lat: points[0].lat, lng: points[0].lng },
        destination: { lat: points.at(-1).lat, lng: points.at(-1).lng },
        waypoints: points.slice(1, -1).map((p) => ({ location: { lat: p.lat, lng: p.lng }, stopover: true })),
        travelMode: 'DRIVING',
      },
      (result, status) => { if (status === 'OK') rendererRef.current?.setDirections(result) }
    )
  }, [routesLib, points])

  return null
}

function BoundsFitter({ routes }) {
  const map = useMap()

  useEffect(() => {
    if (!map || !window.google || !routes.length) return
    const bounds = new window.google.maps.LatLngBounds()
    routes.forEach((r) => (r.points ?? []).forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng })))
    if (!bounds.isEmpty()) map.fitBounds(bounds, 60)
  }, [map, routes.length]) // eslint-disable-line

  return null
}

function FleetLegend({ routes }) {
  return (
    <div className="fleet-legend">
      <div className="fleet-legend-title">Fleet</div>
      {routes.length === 0 && <div className="fleet-item" style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>Loading…</div>}
      {routes.map((route, i) => (
        <div className="fleet-item" key={route.driver_id}>
          <span className="fleet-color" style={{ background: COLORS[i % COLORS.length] }} />
          <div className="fleet-info">
            <div className="fleet-driver">{route.driver_id}</div>
            <div className="fleet-truck">{route.truck_id}</div>
          </div>
          <span className={`fleet-gps ${route.location ? 'active' : ''}`}>
            {route.location ? 'LIVE' : '···'}
          </span>
        </div>
      ))}
    </div>
  )
}

function AdminMap({ routes }) {
  return (
    <Map
      mapId="DEMO_MAP_ID"
      defaultCenter={{ lat: 41.3951, lng: 2.1734 }}
      defaultZoom={12}
      style={{ width: '100%', height: '100%' }}
      gestureHandling="greedy"
    >
      <BoundsFitter routes={routes} />
      {routes.map((route, i) => (
        <RouteDirections
          key={route.driver_id}
          points={route.points ?? []}
          color={COLORS[i % COLORS.length]}
        />
      ))}

      {routes.map((route, ri) =>
        (route.points ?? []).map((point, i) => (
          <AdvancedMarker
            key={`${route.driver_id}-${i}`}
            position={{ lat: point.lat, lng: point.lng }}
            title={`${route.driver_id}: ${point.address}`}
          >
            <div
              className="admin-stop-pin"
              style={{ borderColor: COLORS[ri % COLORS.length], color: COLORS[ri % COLORS.length] }}
            >
              {i + 1}
            </div>
          </AdvancedMarker>
        ))
      )}

      {routes.map((route) =>
        route.location ? (
          <AdvancedMarker
            key={`live-${route.driver_id}`}
            position={route.location}
            title={`${route.driver_id} — live`}
          >
            <div className="truck-live-marker">
              <div className="tlm-pulse" />
              <div className="tlm-icon">🚛</div>
            </div>
          </AdvancedMarker>
        ) : null
      )}
    </Map>
  )
}

export default function AdminDashboard() {
  const { logout } = useAuth()
  const [routes, setRoutes] = useState([])

  useEffect(() => {
    const unsub = subscribeToRoutes(
      setRoutes,
      (err) => console.error('Fleet subscription error:', err)
    )
    return unsub
  }, [])

  return (
    <div className="dashboard">
      <nav className="navbar">
        <div className="navbar-brand">
          <span className="star">★</span>
          Damm Motion
          <span className="admin-badge">Admin</span>
        </div>
        <div className="navbar-driver">
          Fleet: <span>{routes.length} truck{routes.length !== 1 ? 's' : ''}</span>
        </div>
        <button className="btn-logout" onClick={logout}>Log out</button>
      </nav>
      <div className="dashboard-body">
        <main className="map-container">
          <AdminMap routes={routes} />
          <FleetLegend routes={routes} />
        </main>
      </div>
    </div>
  )
}
