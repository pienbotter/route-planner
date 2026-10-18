import { useEffect, useRef } from "react";

import {
  Map,
  Marker,
  LngLatBounds,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";

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

  // Initialize the map once and clean it up on unmount.
  useEffect(() => {
    if (!mapContainer.current) {
      return;
    }

    const mapInstance = new Map({
      container: mapContainer.current,
      center: [4.9, 52.37],
      zoom: 11,
      style: "https://tiles.openfreemap.org/styles/liberty",
    });

    map.current = mapInstance;

    const handleMapClick = (event: {
      lngLat: { lng: number; lat: number };
    }) => {
      onStartLocationChange({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    };

    mapInstance.on("click", handleMapClick);

    return () => {
      mapInstance.off("click", handleMapClick);

      marker.current?.remove();
      marker.current = null;

      mapInstance.remove();
      map.current = null;
    };
  }, [onStartLocationChange]);

  // Keep the starting-point marker synchronized with state.
  useEffect(() => {
    const mapInstance = map.current;

    if (!mapInstance || !startLocation) {
      return;
    }

    const coordinates: [number, number] = [
      startLocation.longitude,
      startLocation.latitude,
    ];

    if (marker.current) {
      marker.current.setLngLat(coordinates);
    } else {
      marker.current = new Marker().setLngLat(coordinates).addTo(mapInstance);
    }
  }, [startLocation]);

  // Draw the latest generated route.
  useEffect(() => {
    const mapInstance = map.current;

    if (
      !mapInstance ||
      !route ||
      !Array.isArray(route.coordinates) ||
      route.coordinates.length < 2
    ) {
      return;
    }

    const sourceId = "generated-route";
    const layerId = "generated-route-line";

    let cancelled = false;

    const geojson = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: route.coordinates,
      },
    };

    const addOrUpdateRoute = () => {
      if (cancelled || !mapInstance.isStyleLoaded()) {
        return;
      }

      const existingSource = mapInstance.getSource(sourceId);

      if (existingSource) {
        (existingSource as GeoJSONSource).setData(geojson);
      } else {
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
            "line-width": 5,
            "line-color": "#2563eb",
            "line-opacity": 0.9,
          },
        });
      }

      const bounds = new LngLatBounds();

      for (const coordinate of route.coordinates) {
        bounds.extend(coordinate);
      }

      mapInstance.fitBounds(bounds, {
        padding: {
          top: 80,
          bottom: 60,
          left: 330,
          right: 40,
        },
        maxZoom: 15,
        duration: 700,
      });
    };

    if (mapInstance.isStyleLoaded()) {
      addOrUpdateRoute();
    } else {
      mapInstance.once("load", addOrUpdateRoute);
    }

    return () => {
      cancelled = true;
      mapInstance.off("load", addOrUpdateRoute);
    };
  }, [route]);

  return (
    <div
      ref={mapContainer}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
      }}
    />
  );
}

export default RouteMap;
