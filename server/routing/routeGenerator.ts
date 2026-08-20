import polyline from "@mapbox/polyline";

export type Location = {
  latitude: number;
  longitude: number;
};

export type GeneratedRoute = {
  distance: number;
  time: number;
  coordinates: [number, number][];
};

type Shape = {
  rotation: number;
  stretch: number;
};

const VALHALLA_URL =
  "https://valhalla1.openstreetmap.de/route";

const SHAPES: Shape[] = [
  {
    rotation: 0,
    stretch: 1,
  },
  {
    rotation: 45,
    stretch: 1,
  },
  {
    rotation: 0,
    stretch: 1.4,
  },
  {
    rotation: 45,
    stretch: 1.4,
  },
];

function generateWaypoints(
  start: Location,
  radiusKm: number,
  rotationDegrees: number = 0,
  stretch: number = 1
): Location[] {
  const numberOfPoints = 12;

  // Slightly irregular distances from the start.
  // This prevents us from creating a perfect geometric circle.
  const radiusFactors = [
    1.00,
    1.08,
    0.94,
    1.05,
    0.97,
    1.10,
    0.95,
    1.04,
    1.00,
    0.92,
    1.07,
    0.96,
  ];

  const latitudeRadians =
    (start.latitude * Math.PI) / 180;

  const latitudeDistance =
    radiusKm / 111;

  const longitudeDistance =
    (radiusKm * stretch) /
    (111 * Math.cos(latitudeRadians));

  const waypoints: Location[] = [];

  for (let i = 0; i < numberOfPoints; i++) {
    const angle =
      (360 / numberOfPoints) * i +
      rotationDegrees;

    const radians =
      (angle * Math.PI) / 180;

    const factor = radiusFactors[i];

    waypoints.push({
      latitude:
        start.latitude +
        Math.sin(radians) *
          latitudeDistance *
          factor,

      longitude:
        start.longitude +
        Math.cos(radians) *
          longitudeDistance *
          factor,
    });
  }

  return waypoints;
}

async function routeThroughPoints(
  start: Location,
  waypoints: Location[]
): Promise<GeneratedRoute> {
  const locations = [
    start,
    ...waypoints,
    start,
  ].map((location) => ({
    lat: location.latitude,
    lon: location.longitude,
  }));

  const response = await fetch(VALHALLA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locations,
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

  const coordinates =
    data.trip.legs.flatMap(
      (leg: { shape: string }) =>
        polyline
          .decode(leg.shape, 6)
          .map(
            ([latitude, longitude]) =>
              [longitude, latitude] as [
                number,
                number
              ]
          )
    );

  return {
    distance: data.trip.summary.length,
    time: data.trip.summary.time,
    coordinates,
  };
}

function calculateDistanceError(
  routeDistanceKm: number,
  targetDistanceKm: number
): number {
  return Math.abs(
    routeDistanceKm - targetDistanceKm
  );
}

export async function generateLoop(
  start: Location,
  targetDistanceKm: number
): Promise<GeneratedRoute> {
  let radiusKm = targetDistanceKm / 8;

  let bestRoute: GeneratedRoute | null = null;
  let bestError = Infinity;

  for (let attempt = 0; attempt < 5; attempt++) {
    const shape =
      SHAPES[attempt % SHAPES.length];

    const waypoints = generateWaypoints(
      start,
      radiusKm,
      shape.rotation,
      shape.stretch
    );

    const route = await routeThroughPoints(
      start,
      waypoints
    );

    const error = calculateDistanceError(
      route.distance,
      targetDistanceKm
    );

    console.log(
      `Attempt ${attempt + 1}: ` +
        `radius ${radiusKm.toFixed(2)} km → ` +
        `route ${route.distance.toFixed(2)} km`
    );

    console.log(
      `Attempt ${attempt + 1}: ` +
        `distance ${route.distance.toFixed(2)} km, ` +
        `distance error ${error.toFixed(2)} km`
    );

    console.log(
      `Route has ${route.coordinates.length} coordinate points`
    );

    if (error < bestError) {
      bestRoute = route;
      bestError = error;
    }

    // Adjust the radius for the next attempt.
    if (route.distance > targetDistanceKm) {
      radiusKm *= 0.8;
    } else {
      radiusKm *= 1.2;
    }
  }

  if (!bestRoute) {
    throw new Error(
      "Could not generate a route."
    );
  }

  return bestRoute;
}