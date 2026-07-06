"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Known dev-only quirk: under `npm run dev`, React 18/19 StrictMode's
// double-invoke of the mount effect can throw "Map container is already
// initialized" the first time this mounts (react-leaflet doesn't tolerate
// the rapid mount→cleanup→remount StrictMode does in development). This
// does NOT happen in production (`next build && next start`) — confirmed
// with the identical component in the Kokoland app. Not a real bug.

// Leaflet's default marker icon references image paths that don't survive
// Next.js's bundler — without this, markers render as broken images.
const riderIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

function Recenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom(), { animate: true });
  }, [lat, lng, map]);
  return null;
}

export default function RiderMap({
  lat,
  lng,
  label,
  height = 200,
}: {
  lat: number;
  lng: number;
  label?: string;
  height?: number;
}) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      scrollWheelZoom={false}
      style={{ height, width: "100%", borderRadius: "1rem" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]} icon={riderIcon}>
        <Popup>{label ?? "Rider"}</Popup>
      </Marker>
      <Recenter lat={lat} lng={lng} />
    </MapContainer>
  );
}
