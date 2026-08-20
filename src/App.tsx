import { useCallback, useState } from "react";
import RouteControls from "./components/RouteControls";
import RouteMap from "./components/RouteMap";

interface Location {
  latitude: number;
  longitude: number;
}

function App() {
  const [distance, setDistance] = useState(10);
  const [startLocation, setStartLocation] = useState<Location | null>(null);

  const handleStartLocationChange = useCallback((location: Location) => {
    setStartLocation(location);
  }, []);

  const handleGenerate = () => {
    console.log("Generate route:", {
      distance,
      startLocation,
    });
  };

  return (
    <main>
      <RouteMap
        startLocation={startLocation}
        onStartLocationChange={handleStartLocationChange}
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
