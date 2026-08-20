interface RouteControlsProps {
  distance: number;
  onDistanceChange: (distance: number) => void;
  onGenerate: () => void;
  hasStartLocation: boolean;
}

function RouteControls({
  distance,
  onDistanceChange,
  onGenerate,
  hasStartLocation,
}: RouteControlsProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        zIndex: 10,
        width: "280px",
        padding: "20px",
        background: "white",
        borderRadius: "12px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
      }}
    >
      <h1>Route Planner</h1>

      <label>
        Distance (km)
        <input
          type="number"
          min="1"
          max="100"
          step="0.5"
          value={distance}
          onChange={(event) => onDistanceChange(Number(event.target.value))}
        />
      </label>

      <button onClick={onGenerate} disabled={!hasStartLocation}>
        Generate route
      </button>

      {!hasStartLocation && <p>Click on the map to choose a starting point.</p>}
    </div>
  );
}

export default RouteControls;
