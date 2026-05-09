import { useEffect, useRef } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

// Straight gray lines drawn over completed segments — no extra API call
export function CompletedSegments({ points, deliveryStatus }) {
  const map = useMap()
  const linesRef = useRef([])

  useEffect(() => {
    if (!map || !window.google) return
    linesRef.current.forEach((l) => l.setMap(null))
    linesRef.current = []

    if (!deliveryStatus) return

    for (let i = 1; i < points.length; i++) {
      if (deliveryStatus[i] === 'delivered') {
        linesRef.current.push(
          new window.google.maps.Polyline({
            path: [
              { lat: points[i - 1].lat, lng: points[i - 1].lng },
              { lat: points[i].lat, lng: points[i].lng },
            ],
            strokeColor: '#6B7280',
            strokeOpacity: 0.45,
            strokeWeight: 4,
            map,
          })
        )
      }
    }

    return () => { linesRef.current.forEach((l) => l.setMap(null)); linesRef.current = [] }
  }, [map, points, deliveryStatus])

  return null
}

// Road-following colored route starting from the first pending stop
export function ActiveDirections({ points, deliveryStatus, color }) {
  const map = useMap()
  const routesLib = useMapsLibrary('routes')

  useEffect(() => {
    if (!routesLib || !map) return

    const renderer = new routesLib.DirectionsRenderer({
      suppressMarkers: true,
      polylineOptions: { strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85 },
    })
    renderer.setMap(map)

    const firstPending = deliveryStatus ? deliveryStatus.findIndex((s) => s === 'pending') : 0
    if (firstPending !== -1) {
      // Start from the driver's current position (last delivered stop), not the next pending one
      const remaining = firstPending > 0 ? points.slice(firstPending - 1) : points
      if (remaining.length >= 2) {
        const service = new routesLib.DirectionsService()
        service.route(
          {
            origin: { lat: remaining[0].lat, lng: remaining[0].lng },
            destination: { lat: remaining.at(-1).lat, lng: remaining.at(-1).lng },
            waypoints: remaining.slice(1, -1).map((p) => ({ location: { lat: p.lat, lng: p.lng }, stopover: true })),
            travelMode: 'DRIVING',
          },
          (result, status) => { if (status === 'OK') renderer.setDirections(result) }
        )
      }
    }

    return () => renderer.setMap(null)
  }, [routesLib, map, points, deliveryStatus, color])

  return null
}
