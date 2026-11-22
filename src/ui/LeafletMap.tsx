'use client';

import { useEffect, useRef } from 'react';

interface LeafletMapProps {
  lat: number;
  lon: number;
  label: string;
}

export default function LeafletMap({ lat, lon, label }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mapInstance: import('leaflet').Map | null = null;
    let active = true;

    (async () => {
      const L = await import('leaflet');
      if (!active || !containerRef.current) return;

      mapInstance = L.map(containerRef.current, {
        center: [lat, lon],
        zoom: 14,
        scrollWheelZoom: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(mapInstance);

      const marker = L.circleMarker([lat, lon], {
        radius: 9,
        color: '#0284c7',
        fillColor: '#0ea5e9',
        fillOpacity: 0.7,
        weight: 2,
      }).addTo(mapInstance);
      marker.bindPopup(label).openPopup();
    })();

    return () => {
      active = false;
      if (mapInstance) {
        mapInstance.remove();
        mapInstance = null;
      }
    };
  }, [lat, lon, label]);

  return (
    <div
      ref={containerRef}
      className="h-72 w-full rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden z-0"
      aria-label={`Peta lokasi ${lat}, ${lon}`}
    />
  );
}
