import { useState } from "react";
import RouteControls from "./components/RouteControls";
import RouteMap from "./components/RouteMap";

interface Location {
  latitude: number;
  longitude: number;
}

interface Route {
  distance: number;
  time: number;
  coordinates: [number, number][];
}

function App() {
  const [distance, setDistance] = useState(10);
  const [startLocation, setStartLocation] = useState<Location | null>(null);

  const [route, setRoute] = useState<Route | null>(null);
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

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : "Failed to generate route.",
        );
      }

      if (
        !Number.isFinite(data.distance) ||
        !Number.isFinite(data.time) ||
        !Array.isArray(data.coordinates) ||
        data.coordinates.length < 2
      ) {
        throw new Error("The server returned an invalid route.");
      }

      setRoute(data as Route);

      console.log("Route received:", {
        requestedDistanceKm: distance,
        actualDistanceKm: data.distance,
        differenceKm: Math.abs(data.distance - distance),
      });
    } catch (error) {
      console.error("Route generation failed:", error);

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
        route={route}
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
