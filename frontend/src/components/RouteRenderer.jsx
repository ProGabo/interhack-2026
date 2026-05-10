import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

// Straight gray lines drawn over completed segments — no extra API call
export function CompletedSegments({ points, deliveryStatus }) {
  const map = useMap()
  const linesRef = useRef([])

  useEffect(() => {
    if (!map || !window.google) return
    linesRef.current.forEach((l) => l.setMap(null))
    linesRef.current = []

    if (!deliveryStatus || !Array.isArray(points) || points.length < 2) return

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

// Active segment polyline starting from the first pending stop
export function ActiveDirections({ points, deliveryStatus, color }) {
  const map = useMap()
  const activeLineRef = useRef(null)

  useEffect(() => {
    if (!map || !window.google || !Array.isArray(points) || points.length < 2) return

    const firstPending = deliveryStatus ? deliveryStatus.findIndex((s) => s === 'pending') : 0
    const remaining = firstPending > 0 ? points.slice(firstPending - 1) : points

    if (activeLineRef.current) {
      activeLineRef.current.setMap(null)
      activeLineRef.current = null
    }
    if (firstPending !== -1 && remaining.length >= 2) {
      activeLineRef.current = new window.google.maps.Polyline({
        path: remaining.map((point) => ({ lat: point.lat, lng: point.lng })),
        strokeColor: color,
        strokeOpacity: 0.85,
        strokeWeight: 5,
        map,
      })
    }

    return () => {
      if (activeLineRef.current) {
        activeLineRef.current.setMap(null)
        activeLineRef.current = null
      }
    }
  }, [map, points, deliveryStatus, color])

  return null
}
