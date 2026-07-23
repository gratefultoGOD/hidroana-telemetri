import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './SatelliteMap.css'

function vehicleIcon(heading) {
  return L.divIcon({
    className: 'vehicle-marker',
    html: `<div class="vehicle-marker__arrow" style="transform: rotate(${heading}deg)"></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function FollowVehicle({ position }) {
  const map = useMap()
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      map.setView([position.lat, position.lng], 17)
      initialized.current = true
      return
    }
    map.panTo([position.lat, position.lng], { animate: true, duration: 0.9 })
  }, [position, map])

  return null
}

export default function SatelliteMap({ position, heading, speedKph }) {
  return (
    <section className="map-panel">
      <header className="map-panel__header">
        <span className="system-panel__icon">🛰️</span>
        <h2>Araç Konumu · Uydu</h2>
        <div className="map-panel__stats">
          <span>{speedKph.toFixed(0)} km/h</span>
          <span>{position.lat.toFixed(5)}, {position.lng.toFixed(5)}</span>
        </div>
      </header>
      <div className="map-panel__map">
        <MapContainer
          center={[position.lat, position.lng]}
          zoom={17}
          scrollWheelZoom={true}
          zoomControl={false}
          attributionControl={false}
          className="map-panel__container"
        >
          <TileLayer
            url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
            attribution="&copy; Google"
            maxZoom={20}
          />
          <Marker position={[position.lat, position.lng]} icon={vehicleIcon(heading)} />
          <FollowVehicle position={position} />
        </MapContainer>
      </div>
    </section>
  )
}
