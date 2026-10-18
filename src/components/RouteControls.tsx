interface RouteControlsProps {
  distance: number;
  onDistanceChange: (distance: number) => void;
  onGenerate: () => void;
  hasStartLocation: boolean;
  isGenerating: boolean;
  error: string | null;
}

function RouteControls({
  distance,
  onDistanceChange,
  onGenerate,
  hasStartLocation,
  isGenerating,
  error,
}: RouteControlsProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: "20px",
        left: "20px",
        zIndex: 10,
        width: "280px",
        boxSizing: "border-box",
        padding: "20px",
        background: "white",
        color: "#111827",
        borderRadius: "12px",
        boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
        fontFamily: "sans-serif",
      }}
    >
      <h1 style={{ marginTop: 0 }}>Route Planner</h1>

      <label
        htmlFor="distance"
        style={{
          display: "block",
          marginBottom: "16px",
        }}
      >
        Distance (km)
        <input
          id="distance"
          type="number"
          min="1"
          max="100"
          step="0.5"
          value={distance}
          disabled={isGenerating}
          onChange={(event) => {
            const value = event.target.valueAsNumber;

            if (Number.isFinite(value)) {
              onDistanceChange(value);
            }
          }}
          style={{
            display: "block",
            boxSizing: "border-box",
            width: "100%",
            marginTop: "8px",
            padding: "10px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            fontSize: "16px",
          }}
        />
      </label>

      <button
        onClick={onGenerate}
        disabled={
          !hasStartLocation ||
          isGenerating ||
          !Number.isFinite(distance) ||
          distance < 1 ||
          distance > 100
        }
        style={{
          width: "100%",
          padding: "12px",
          background: !hasStartLocation || isGenerating ? "#9ca3af" : "#2563eb",
          color: "white",
          border: "none",
          borderRadius: "6px",
          fontSize: "15px",
          fontWeight: 600,
          cursor: !hasStartLocation || isGenerating ? "not-allowed" : "pointer",
        }}
      >
        {isGenerating ? "Generating route..." : "Generate route"}
      </button>

      {!hasStartLocation && (
        <p style={{ fontSize: "14px", color: "#4b5563" }}>
          Click on the map to choose a starting point.
        </p>
      )}

      {isGenerating && (
        <p
          role="status"
          style={{
            fontSize: "14px",
            color: "#4b5563",
          }}
        >
          Searching for a route close to your target distance.
        </p>
      )}

      {error && (
        <p
          role="alert"
          style={{
            padding: "10px",
            background: "#fef2f2",
            color: "#b91c1c",
            borderRadius: "6px",
            fontSize: "14px",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}

export default RouteControls;
