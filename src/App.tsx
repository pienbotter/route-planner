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

  const handleGenerate = async () => {
    if (!startLocation) return;

    console.log("Generating route...");

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

    if (!response.ok) {
      console.error("Failed to generate route");
      return;
    }

    const data = await response.json();

    console.log("Route received:", data);

    setRoute(data);
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
      />
    </main>
  );
}

export default App;
