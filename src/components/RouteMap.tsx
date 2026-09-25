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

      // Real OpenStreetMap-based vector map.
      style: "https://tiles.openfreemap.org/styles/liberty",
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

    const addRoute = () => {
      if (!mapInstance.getSource(sourceId)) {
        mapInstance.addSource(sourceId, {
          type: "geojson",
          data: geojson,
        });

        mapInstance.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-join": "round",
            "line-cap": "round",
          },
          paint: {
            "line-width": 6,
            "line-color": "#2563eb",
            "line-opacity": 0.9,
          },
        });
      } else {
        (mapInstance.getSource(sourceId) as GeoJSONSource).setData(geojson);
      }
    };

    if (mapInstance.isStyleLoaded()) {
      addRoute();
    } else {
      mapInstance.once("load", addRoute);
    }
  }, [route]);

  // Keep the marker synchronized if startLocation is changed
  // from somewhere other than clicking the map.
  useEffect(() => {
    if (!map.current || !startLocation) return;

    const lngLat: [number, number] = [
      startLocation.longitude,
      startLocation.latitude,
    ];

    if (marker.current) {
      marker.current.setLngLat(lngLat);
    } else {
      marker.current = new Marker().setLngLat(lngLat).addTo(map.current);
    }
  }, [startLocation]);

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
