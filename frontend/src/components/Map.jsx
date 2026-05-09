import { Map, AdvancedMarker } from '@vis.gl/react-google-maps'
import { CompletedSegments, ActiveDirections } from './RouteRenderer'

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

export default function RouteMap({ points, currentLocation, deliveryStatus }) {
  return (
    <Map
      mapId="DEMO_MAP_ID"
      defaultCenter={{ lat: points[0].lat, lng: points[0].lng }}
      defaultZoom={13}
      style={{ width: '100%', height: '100%' }}
      gestureHandling="greedy"
    >
      <CompletedSegments points={points} deliveryStatus={deliveryStatus} />
      <ActiveDirections points={points} deliveryStatus={deliveryStatus} color="#C41230" />

      {points.map((point, i) => {
        const delivered = deliveryStatus?.[i] === 'delivered'
        return (
          <AdvancedMarker key={i} position={{ lat: point.lat, lng: point.lng }} title={point.address}>
            <div className={`map-pin${delivered ? ' delivered' : ''}`}>
              <span>{i + 1}</span>
            </div>
          </AdvancedMarker>
        )
      })}

      <CurrentLocationMarker location={currentLocation} />
    </Map>
  )
}
