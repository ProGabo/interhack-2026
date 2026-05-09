import { useEffect, useRef } from 'react'
import { Map, AdvancedMarker, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

function Directions({ points }) {
  const map = useMap()
  const routesLib = useMapsLibrary('routes')
  const rendererRef = useRef(null)

  useEffect(() => {
    if (!routesLib || !map) return
    const renderer = new routesLib.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: '#C41230', strokeWeight: 5, strokeOpacity: 0.85 },
    })
    renderer.setMap(map)
    rendererRef.current = renderer
    return () => renderer.setMap(null)
  }, [routesLib, map])

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
      (result, status) => { if (status === 'OK') rendererRef.current.setDirections(result) }
    )
  }, [routesLib, points])

  return null
}

function CurrentLocationMarker({ location }) {
  if (!location) return null
  return (
    <AdvancedMarker position={location} title="Your location">
      <div className="current-location-marker">
        <div className="clm-pulse" />
        <div className="clm-dot" />
      </div>
    </AdvancedMarker>
  )
}

export default function RouteMap({ points, currentLocation }) {
  return (
    <Map
      mapId="DEMO_MAP_ID"
      defaultCenter={{ lat: points[0].lat, lng: points[0].lng }}
      defaultZoom={13}
      style={{ width: '100%', height: '100%' }}
      gestureHandling="greedy"
    >
      <Directions points={points} />
      {points.map((point, i) => (
        <AdvancedMarker key={i} position={{ lat: point.lat, lng: point.lng }} title={point.address}>
          <div className="map-pin"><span>{i + 1}</span></div>
        </AdvancedMarker>
      ))}
      <CurrentLocationMarker location={currentLocation} />
    </Map>
  )
}
