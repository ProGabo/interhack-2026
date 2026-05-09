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
      polylineOptions: {
        strokeColor: '#C41230',
        strokeWeight: 5,
        strokeOpacity: 0.85,
      },
    })
    renderer.setMap(map)
    rendererRef.current = renderer

    return () => renderer.setMap(null)
  }, [routesLib, map])

  useEffect(() => {
    if (!rendererRef.current || !routesLib || points.length < 2) return

    const service = new routesLib.DirectionsService()
    const waypoints = points.slice(1, -1).map((p) => ({
      location: { lat: p.lat, lng: p.lng },
      stopover: true,
    }))

    service.route(
      {
        origin: { lat: points[0].lat, lng: points[0].lng },
        destination: { lat: points.at(-1).lat, lng: points.at(-1).lng },
        waypoints,
        travelMode: 'DRIVING',
      },
      (result, status) => {
        if (status === 'OK') rendererRef.current.setDirections(result)
      }
    )
  }, [routesLib, points])

  return null
}

export default function RouteMap({ points }) {
  const center = { lat: points[0].lat, lng: points[0].lng }

  return (
    <Map
      mapId="DEMO_MAP_ID"
      defaultCenter={center}
      defaultZoom={13}
      style={{ width: '100%', height: '100%' }}
      gestureHandling="greedy"
      disableDefaultUI={false}
    >
      <Directions points={points} />
      {points.map((point, i) => (
        <AdvancedMarker
          key={i}
          position={{ lat: point.lat, lng: point.lng }}
          title={point.address}
        >
          <div className="map-pin">
            <span>{i + 1}</span>
          </div>
        </AdvancedMarker>
      ))}
    </Map>
  )
}
