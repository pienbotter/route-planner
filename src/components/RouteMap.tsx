import { useEffect, useRef } from "react";
import { Map, Marker, setWorkerUrl, type GeoJSONSource } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

setWorkerUrl(workerUrl);

interface Location {
  latitude: number;
  longitude: number;
}

interface Route {
  distance: number;
  time: number;
  coordinates: [number, number][];
}

interface RouteMapProps {
  startLocation: Location | null;
  onStartLocationChange: (location: Location) => void;
  route: Route | null;
}

function RouteMap({
  startLocation,
  onStartLocationChange,
  route,
}: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<Map | null>(null);
  const marker = useRef<Marker | null>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new Map({
      container: mapContainer.current,
      center: [4.9, 52.37],
      zoom: 11,
      style: "https://demotiles.maplibre.org/style.json",
    });

    map.current = mapInstance;

    mapInstance.on("click", (event) => {
      const { lng, lat } = event.lngLat;

      onStartLocationChange({
        latitude: lat,
        longitude: lng,
      });

      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new Marker().setLngLat([lng, lat]).addTo(mapInstance);
      }
    });

    return () => {
      marker.current?.remove();
      mapInstance.remove();
      map.current = null;
    };
  }, [onStartLocationChange]);

  useEffect(() => {
    if (!map.current || !route) return;

    const mapInstance = map.current;

    const sourceId = "route";
    const layerId = "route";

    const geojson = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: route.coordinates,
      },
    };

    if (mapInstance.getSource(sourceId)) {
      (mapInstance.getSource(sourceId) as GeoJSONSource).setData(geojson);
    } else {
      const addRoute = () => {
        mapInstance.addSource(sourceId, {
          type: "geojson",
          data: geojson,
        });

        mapInstance.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          paint: {
            "line-width": 5,
            "line-color": "#2563eb",
          },
        });
      };

      if (mapInstance.isStyleLoaded()) {
        addRoute();
      } else {
        mapInstance.once("load", addRoute);
      }
    }
  }, [route]);

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
