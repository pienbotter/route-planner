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

interface Location {
  latitude: number;
  longitude: number;
}

interface Route {
  id: number;
  distance: number;
  time: number;
  coordinates: [number, number][];
}

interface RouteMapProps {
  startLocation: Location | null;
  onStartLocationChange: (location: Location) => void;
  routes: Route[];
}

const ROUTE_SOURCE_ID = "generated-routes";
const ROUTE_LAYER_ID = "generated-routes-line";

function RouteMap({
  startLocation,
  onStartLocationChange,
  routes,
}: RouteMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);

  // Initialize the map once.
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) {
      return;
    }

    setWorkerUrl(workerUrl);

    const map = new Map({
      container: mapContainer.current,
      center: [4.9, 52.37],
      zoom: 11,
      style: "https://tiles.openfreemap.org/styles/liberty",
    });

    mapRef.current = map;

    map.on("click", (event) => {
      onStartLocationChange({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;

      map.remove();
      mapRef.current = null;
    };
  }, [onStartLocationChange]);

  // Keep the start marker in sync with the selected location.
  useEffect(() => {
    const map = mapRef.current;

    if (!map || !startLocation) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      markerRef.current = new Marker({
        color: "#111827",
      })
        .setLngLat([startLocation.longitude, startLocation.latitude])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([
        startLocation.longitude,
        startLocation.latitude,
      ]);
    }
  }, [startLocation]);

  // Draw all available routes in different colors.
  useEffect(() => {
    const map = mapRef.current;

    if (!map) {
      return;
    }

    const updateRoutes = () => {
      if (mapRef.current !== map) {
        return;
      }

      const featureCollection = {
        type: "FeatureCollection" as const,
        features: routes.map((route, index) => ({
          type: "Feature" as const,
          properties: {
            routeId: index + 1,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: route.coordinates,
          },
        })),
      };

      const existingSource = map.getSource(ROUTE_SOURCE_ID) as
        | GeoJSONSource
        | undefined;

      if (existingSource) {
        existingSource.setData(featureCollection);
      } else {
        map.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data: featureCollection,
        });

        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": [
              "match",
              ["get", "routeId"],
              1,
              "#2563eb",
              2,
              "#f97316",
              3,
              "#16a34a",
              "#9333ea",
            ],
            "line-width": 5,
            "line-opacity": 0.9,
          },
        });
      }

      if (routes.length === 0) {
        return;
      }

      const bounds = new LngLatBounds();

      for (const route of routes) {
        for (const coordinate of route.coordinates) {
          bounds.extend(coordinate);
        }
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          padding: {
            top: 80,
            bottom: 60,
            left: 330,
            right: 40,
          },
          maxZoom: 15,
          duration: 700,
        });
      }
    };

    if (map.isStyleLoaded()) {
      updateRoutes();
    } else {
      map.once("load", updateRoutes);
    }

    return () => {
      map.off("load", updateRoutes);
    };
  }, [routes]);

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
