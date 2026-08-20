export type Location = {
  latitude: number;
  longitude: number;
};

export type RouteResult = {
  distance: number;
  time: number;
  coordinates: [number, number][];
};

const VALHALLA_URL =
  "https://valhalla1.openstreetmap.de/route";

export async function getRoute(
  locations: Location[]
): Promise<RouteResult> {
  if (locations.length < 2) {
    throw new Error(
      "At least two locations are required."
    );
  }

  const response = await fetch(VALHALLA_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      locations: locations.map((location) => ({
        lat: location.latitude,
        lon: location.longitude,
      })),

      costing: "pedestrian",
      units: "kilometers",
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Valhalla returned HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (!data.trip) {
    throw new Error(
      "Valhalla did not return a trip."
    );
  }

  const coordinates: [number, number][] = [];

  for (const leg of data.trip.legs) {
    // We'll decode the Valhalla shape here.
    // This assumes your existing polyline dependency.
    const polyline = await import("@mapbox/polyline");

    const decoded =
      polyline.decode(leg.shape, 6);

    for (const [latitude, longitude] of decoded) {
      coordinates.push([
        longitude,
        latitude,
      ]);
    }
  }

  return {
    distance: data.trip.summary.length,
    time: data.trip.summary.time,
    coordinates,
  };
}