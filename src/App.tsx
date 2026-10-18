import { useState } from "react";
import RouteControls from "./components/RouteControls";
import RouteMap from "./components/RouteMap";

interface Location {
  latitude: number;
  longitude: number;
}

interface Route {
  id: number;
  distance: number;
  time: number;
  coordinates: [number, number][];
  targetDistance?: number;
  distanceError?: number;
  withinTolerance?: boolean;
}

function isValidRoute(value: unknown): value is Route {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const route = value as Record<string, unknown>;

  return (
    typeof route.id === "number" &&
    Number.isFinite(route.id) &&
    typeof route.distance === "number" &&
    Number.isFinite(route.distance) &&
    route.distance > 0 &&
    typeof route.time === "number" &&
    Number.isFinite(route.time) &&
    Array.isArray(route.coordinates) &&
    route.coordinates.length >= 2 &&
    route.coordinates.every(
      (coordinate) =>
        Array.isArray(coordinate) &&
        coordinate.length >= 2 &&
        typeof coordinate[0] === "number" &&
        Number.isFinite(coordinate[0]) &&
        typeof coordinate[1] === "number" &&
        Number.isFinite(coordinate[1]) &&
        coordinate[0] >= -180 &&
        coordinate[0] <= 180 &&
        coordinate[1] >= -90 &&
        coordinate[1] <= 90,
    )
  );
}

function App() {
  const [distance, setDistance] = useState(10);
  const [startLocation, setStartLocation] = useState<Location | null>(null);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (
      !startLocation ||
      isGenerating ||
      !Number.isFinite(distance) ||
      distance < 1 ||
      distance > 100
    ) {
      return;
    }

    setIsGenerating(true);
    setError(null);
    setRoutes([]);

    try {
      const response = await fetch("http://localhost:3000/api/route", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          start: startLocation,
          distance,
        }),
      });

      const data: unknown = await response.json();

      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Failed to generate routes.";

        throw new Error(message);
      }

      if (
        typeof data !== "object" ||
        data === null ||
        !("routes" in data) ||
        !Array.isArray(data.routes)
      ) {
        throw new Error("The server returned an invalid routes response.");
      }

      const validRoutes = data.routes.filter(isValidRoute);

      if (validRoutes.length === 0) {
        throw new Error(
          "No valid routes were returned. Try another starting point.",
        );
      }

      setRoutes(validRoutes);

      console.log(
        "Routes received:",
        validRoutes.map((route, index) => ({
          option: index + 1,
          distanceKm: route.distance,
          differenceKm: Math.abs(route.distance - distance),
          timeMinutes: Math.round(route.time / 60),
        })),
      );

      if (validRoutes.length < 3) {
        console.warn(
          `Only ${validRoutes.length} valid route option(s) were returned.`,
        );
      }
    } catch (error) {
      console.error("Route generation failed:", error);

      setRoutes([]);

      setError(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main>
      <RouteMap
        startLocation={startLocation}
        onStartLocationChange={setStartLocation}
        routes={routes}
      />

      <RouteControls
        distance={distance}
        onDistanceChange={setDistance}
        onGenerate={handleGenerate}
        hasStartLocation={startLocation !== null}
        isGenerating={isGenerating}
        error={error}
      />
    </main>
  );
}

export default App;
