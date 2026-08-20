import { useEffect, useRef } from "react";
import { Map, setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new Map({
      container: mapContainer.current,
      center: [4.9, 52.37],
      zoom: 11,
      style: "https://demotiles.maplibre.org/style.json",
    });

    return () => map.remove();
  }, []);

  return (
    <main>
      <div
        ref={mapContainer}
        style={{
          width: "100vw",
          height: "100vh",
        }}
      />
    </main>
  );
}

export default App;
