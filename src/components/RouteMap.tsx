import { useEffect, useRef } from "react";
import { Map, Marker, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

interface Location {
  latitude: number;
  longitude: number;
}

interface RouteMapProps {
  startLocation: Location | null;
  onStartLocationChange: (location: Location) => void;
}

function RouteMap({ startLocation, onStartLocationChange }: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const marker = useRef<Marker | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new Map({
      container: mapContainer.current,
      center: [4.9, 52.37],
      zoom: 11,
      style: "https://demotiles.maplibre.org/style.json",
    });

    map.on("click", (event) => {
      const { lng, lat } = event.lngLat;

      onStartLocationChange({
        latitude: lat,
        longitude: lng,
      });

      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new Marker().setLngLat([lng, lat]).addTo(map);
      }
    });

    return () => {
      marker.current?.remove();
      map.remove();
    };
  }, [onStartLocationChange]);

  return (
    <div
      ref={mapContainer}
      style={{
        width: "100vw",
        height: "100vh",
      }}
    />
  );
}

export default RouteMap;
