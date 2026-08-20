import polyline from "@mapbox/polyline";

export interface Location {
  latitude: number;
  longitude: number;
}

export interface GeneratedRoute {
  distance: number;
  time: number;
  coordinates: [number, number][];
}

function generateWaypoints(
  start: Location,
  radiusKm: number
): Location[] {
  const points = [
    { angle: 0 },
    { angle: 90 },
    { angle: 180 },
    { angle: 270 },
  ];

  const latitudeRadians =
    (start.latitude * Math.PI) / 180;

  const latitudeDistance = radiusKm / 111;

  const longitudeDistance =
    radiusKm /
    (111 * Math.cos(latitudeRadians));

  return points.map(({ angle }) => {
    const radians =
      (angle * Math.PI) / 180;

    return {
      latitude:
        start.latitude +
        Math.sin(radians) * latitudeDistance,

      longitude:
        start.longitude +
        Math.cos(radians) * longitudeDistance,
    };
  });
}

async function routeThroughPoints(
  start: Location,
  waypoints: Location[]
): Promise<GeneratedRoute> {
  const locations = [
    start,
    ...waypoints,
    start,
  ];

  const allCoordinates: [number, number][] = [];

  let totalDistance = 0;
  let totalTime = 0;

  for (let i = 0; i < locations.length - 1; i++) {
    const from = locations[i];
    const to = locations[i + 1];

    const response = await fetch(
      "https://valhalla1.openstreetmap.de/route",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locations: [
            {
              lat: from.latitude,
              lon: from.longitude,
            },
            {
              lat: to.latitude,
              lon: to.longitude,
            },
          ],
          costing: "pedestrian",
          units: "kilometers",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Valhalla returned HTTP ${response.status}`
      );
    }

    const data = await response.json();

    const legCoordinates =
      polyline
        .decode(data.trip.legs[0].shape, 6)
        .map(
          ([latitude, longitude]) =>
            [longitude, latitude] as [number, number]
        );

    allCoordinates.push(...legCoordinates);

    totalDistance += data.trip.summary.length;
    totalTime += data.trip.summary.time;

    console.log(
      `Leg ${i + 1}: ${data.trip.summary.length.toFixed(
        2
      )} km`
    );
  }

  return {
    distance: totalDistance,
    time: totalTime,
    coordinates: allCoordinates,
  };
}

function calculateBacktrackingPenalty(
  coordinates: [number, number][]
): number {
  let penalty = 0;

  for (let i = 2; i < coordinates.length; i++) {
    const previous = coordinates[i - 2];
    const current = coordinates[i - 1];
    const next = coordinates[i];

    const vector1 = {
      x: current[0] - previous[0],
      y: current[1] - previous[1],
    };

    const vector2 = {
      x: next[0] - current[0],
      y: next[1] - current[1],
    };

    const dot =
      vector1.x * vector2.x +
      vector1.y * vector2.y;

    const magnitude1 = Math.sqrt(
      vector1.x ** 2 +
        vector1.y ** 2
    );

    const magnitude2 = Math.sqrt(
      vector2.x ** 2 +
        vector2.y ** 2
    );

    if (magnitude1 === 0 || magnitude2 === 0) {
      continue;
    }

    const cosine =
      dot / (magnitude1 * magnitude2);

    if (cosine < -0.8) {
      penalty += 1;
    }
  }

  return penalty;
}

export async function generateLoop(
  start: Location,
  targetDistanceKm: number
): Promise<GeneratedRoute> {
  let radiusKm = targetDistanceKm / 8;

  let bestRoute: GeneratedRoute | null = null;
  let bestScore = Infinity;

  for (let attempt = 0; attempt < 5; attempt++) {
    const waypoints = generateWaypoints(
      start,
      radiusKm
    );

    const route = await routeThroughPoints(
      start,
      waypoints
    );

    const error = Math.abs(
      route.distance - targetDistanceKm
    );

    console.log(
      `Attempt ${attempt + 1}: radius ${radiusKm.toFixed(
        2
      )} km → route ${route.distance.toFixed(
        2
      )} km`
    );

    const backtrackingPenalty =
  calculateBacktrackingPenalty(
    route.coordinates
  );

console.log(
  `Attempt ${attempt + 1}: ` +
    `distance ${route.distance.toFixed(2)} km, ` +
    `distance error ${error.toFixed(2)} km, ` +
    `backtracking ${backtrackingPenalty}`
);

    const score =
  error + backtrackingPenalty * 0.5;

if (score < bestScore) {
  bestRoute = route;
  bestScore = score;
}

    if (route.distance > targetDistanceKm) {
      radiusKm *= 0.8;
    } else {
      radiusKm *= 1.2;
    }
  }

  if (!bestRoute) {
    throw new Error("Could not generate a route");
  }

  return bestRoute;
}