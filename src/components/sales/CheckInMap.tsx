'use client';

// Map of sales check-ins (Leaflet + OpenStreetMap map tiles, as in the reference project).
// Only runs in the browser: load it with next/dynamic and ssr: false.
import React, { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import dayjs from 'dayjs';
import { formatDuration } from './checkInFormat';
import type { SalesCheckIn } from '@/types';

/** Map pin drawn in code (no image files fetched from other sites) */
const pin = (colour: string) =>
  L.divIcon({
    className: '',
    html: `<svg width="26" height="38" viewBox="0 0 26 38" xmlns="http://www.w3.org/2000/svg">
      <path d="M13 1C6.4 1 1 6.3 1 12.9c0 8.9 12 23.6 12 23.6s12-14.7 12-23.6C25 6.3 19.6 1 13 1z"
            fill="${colour}" stroke="#ffffff" stroke-width="2"/>
      <circle cx="13" cy="13" r="4.5" fill="#ffffff"/></svg>`,
    iconSize: [26, 38],
    iconAnchor: [13, 37],
    popupAnchor: [0, -32],
  });

const CHECK_IN_PIN = pin('#2b9a3e');
const CHECK_OUT_PIN = pin('#0a6ed1');

/** Kuala Lumpur, until there are visits to fit the map to */
const DEFAULT_CENTRE: [number, number] = [3.139, 101.6869];

const point = (lat: number | null, lng: number | null): [number, number] | null =>
  lat != null && lng != null ? [Number(lat), Number(lng)] : null;

/** Zoom the map to show every pin */
function FitToPins({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 16);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.15));
  }, [map, JSON.stringify(points)]);
  return null;
}

function VisitPopup({ visit, label, address }: { visit: SalesCheckIn; label: string; address: string | null }) {
  return (
    <div style={{ minWidth: 200 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6a6d70', marginBottom: 4 }}>{label}</div>
      <strong>{visit.cardName ?? visit.cardCode}</strong> ({visit.cardCode})
      <br />
      Visit {visit.docNum} · {visit.slpName ?? ''}
      <br />
      Check In: {dayjs(visit.checkInTime).format('DD.MM.YY HH:mm')}
      <br />
      Check Out: {visit.checkOutTime ? dayjs(visit.checkOutTime).format('DD.MM.YY HH:mm') : 'still checked in'}
      {visit.duration != null && (
        <>
          <br />
          Duration: {formatDuration(visit.duration)}
        </>
      )}
      <br />
      Purpose: {visit.purpose}
      {address && (
        <>
          <br />
          <span style={{ color: '#6a6d70' }}>{address}</span>
        </>
      )}
    </div>
  );
}

interface CheckInMapProps {
  visits: SalesCheckIn[];
  height?: number | string;
  /** Click on a pin's visit No. link (e.g. open the visit) */
  onOpenVisit?: (visit: SalesCheckIn) => void;
}

/**
 * Pins for each visit: green = check-in, blue = check-out, joined by a dashed line when both are known.
 * Click a pin for the visit's customer, times, duration, purpose and address.
 */
export default function CheckInMap({ visits, height = 480, onOpenVisit }: CheckInMapProps) {
  const allPoints = visits.flatMap((v) =>
    [point(v.checkInLat, v.checkInLng), point(v.checkOutLat, v.checkOutLng)].filter((p): p is [number, number] => p !== null)
  );

  return (
    <MapContainer center={DEFAULT_CENTRE} zoom={11} style={{ height, width: '100%', borderRadius: 4 }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <FitToPins points={allPoints} />
      {visits.map((visit) => {
        const inPoint = point(visit.checkInLat, visit.checkInLng);
        const outPoint = point(visit.checkOutLat, visit.checkOutLng);
        const open = onOpenVisit ? () => onOpenVisit(visit) : undefined;
        return (
          <React.Fragment key={visit.docEntry}>
            {inPoint && (
              <Marker position={inPoint} icon={CHECK_IN_PIN} eventHandlers={{ dblclick: open }}>
                <Popup>
                  <VisitPopup visit={visit} label="CHECK-IN" address={visit.checkInAddress} />
                </Popup>
              </Marker>
            )}
            {outPoint && (
              <Marker position={outPoint} icon={CHECK_OUT_PIN} eventHandlers={{ dblclick: open }}>
                <Popup>
                  <VisitPopup visit={visit} label="CHECK-OUT" address={visit.checkOutAddress} />
                </Popup>
              </Marker>
            )}
            {inPoint && outPoint && (
              <Polyline positions={[inPoint, outPoint]} pathOptions={{ color: '#6a6d70', weight: 2, dashArray: '6 4', opacity: 0.7 }} />
            )}
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
}
