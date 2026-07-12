import { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { LocateFixed } from 'lucide-react';

// Vite doesn't resolve Leaflet's default marker icon URLs correctly once
// bundled - the standard fix is to re-point them at the bundled asset URLs.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow });

interface Props {
  lat: number;
  lng: number;
  onChange: (lat: number, lng: number) => void;
}

function ClickToPlace({ onChange }: { onChange: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { onChange(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

// Admin-only dependency (Leaflet) for placing a step's secret target - per
// dev plan Section 8. Never rendered on any player-facing page.
export default function StepLocationPicker({ lat, lng, onChange }: Props) {
  const [locating, setLocating] = useState(false);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { onChange(pos.coords.latitude, pos.coords.longitude); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-secondary btn-sm" style={{ minHeight: 32, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={useMyLocation} disabled={locating}>
          <LocateFixed size={13} /> {locating ? 'Locating...' : 'Use my current location'}
        </button>
        <span style={{ fontSize: '0.76rem', color: 'var(--muted)' }}>or click the map to place the pin</span>
      </div>
      <div style={{ height: 260, borderRadius: 'var(--r-md)', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <MapContainer center={[lat, lng]} zoom={15} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Marker
            position={[lat, lng]}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const marker = e.target as L.Marker;
                const pos = marker.getLatLng();
                onChange(pos.lat, pos.lng);
              },
            }}
          />
          <ClickToPlace onChange={onChange} />
        </MapContainer>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 2 }}>Latitude</label>
          <input type="number" step="0.000001" className="form-input" style={{ minHeight: 32, margin: 0 }}
            value={lat} onChange={(e) => onChange(Number(e.target.value), lng)} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted)', marginBottom: 2 }}>Longitude</label>
          <input type="number" step="0.000001" className="form-input" style={{ minHeight: 32, margin: 0 }}
            value={lng} onChange={(e) => onChange(lat, Number(e.target.value))} />
        </div>
      </div>
    </div>
  );
}
