import { getRoute, Location } from "./valhalla";

type RouteQuality = {
  overlapKm: number;
  score: number;
};

export type GeneratedRoute = {
  distance: number;
  time: number;
  coordinates: [number, number][];
};

function createPoint(
  start: Location,
  distanceKm: number,
  bearingDegrees: number
): Location {
  const earthRadiusKm = 6371;

  const bearing =
    (bearingDegrees * Math.PI) / 180;

  const latitude =
    (start.latitude * Math.PI) / 180;

  const longitude =
    (start.longitude * Math.PI) / 180;

  const angularDistance =
    distanceKm / earthRadiusKm;

  const newLatitude = Math.asin(
    Math.sin(latitude) *
      Math.cos(angularDistance) +
      Math.cos(latitude) *
        Math.sin(angularDistance) *
        Math.cos(bearing)
  );

  const newLongitude =
    longitude +
    Math.atan2(
      Math.sin(bearing) *
        Math.sin(angularDistance) *
        Math.cos(latitude),
      Math.cos(angularDistance) -
        Math.sin(latitude) *
          Math.sin(newLatitude)
    );

  return {
    latitude:
      (newLatitude * 180) / Math.PI,

    longitude:
      (newLongitude * 180) / Math.PI,
  };
}

type Shape = {
  rotation: number;
  stretch: number;
};

const shapes: Shape[] = [
  {
    rotation: 0,
    stretch: 1,
  },
  {
    rotation: 45,
    stretch: 1,
  },
  {
    rotation: 90,
    stretch: 1,
  },
  {
    rotation: 135,
    stretch: 1,
  },
];

function distanceBetweenPoints(
  a: [number, number],
  b: [number, number]
): number {
  const earthRadiusKm = 6371;

  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;

  const deltaLat =
    ((b[1] - a[1]) * Math.PI) / 180;

  const deltaLon =
    ((b[0] - a[0]) * Math.PI) / 180;

  const sinLat = Math.sin(deltaLat / 2);
  const sinLon = Math.sin(deltaLon / 2);

  const h =
    sinLat * sinLat +
    Math.cos(lat1) *
      Math.cos(lat2) *
      sinLon *
      sinLon;

  return (
    2 *
    earthRadiusKm *
    Math.atan2(
      Math.sqrt(h),
      Math.sqrt(1 - h)
    )
  );
}

function calculateBearing(
  a: [number, number],
  b: [number, number]
): number {
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;

  const lon1 = (a[0] * Math.PI) / 180;
  const lon2 = (b[0] * Math.PI) / 180;

  const y =
    Math.sin(lon2 - lon1) *
    Math.cos(lat2);

  const x =
    Math.cos(lat1) *
      Math.sin(lat2) -
    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(lon2 - lon1);

  const bearing =
    (Math.atan2(y, x) * 180) / Math.PI;

  return (bearing + 360) % 360;
}

function angleDifference(
  a: number,
  b: number
): number {
  const difference =
    Math.abs(a - b) % 360;

  return Math.min(
    difference,
    360 - difference
  );
}

function calculateRouteQuality(
  coordinates: [number, number][]
): RouteQuality {
  if (coordinates.length < 2) {
    return {
      overlapKm: 0,
      score: 0,
    };
  }

  const WINDOW_LENGTH_KM = 0.2;
  const SAMPLE_DISTANCE_KM = 0.05;

  type Sample = {
    point: [number, number];
    bearing: number;
    distanceFromStart: number;
  };

  const samples: Sample[] = [];

  let distanceFromStart = 0;

  for (
    let i = 0;
    i < coordinates.length - 1;
    i++
  ) {
    const a = coordinates[i];
    const b = coordinates[i + 1];

    const segmentLength =
      distanceBetweenPoints(a, b);

    if (segmentLength === 0) {
      continue;
    }

    const bearing =
      calculateBearing(a, b);

    samples.push({
      point: a,
      bearing,
      distanceFromStart,
    });

    distanceFromStart += segmentLength;
  }

  let overlapKm = 0;

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const first = samples[i];

    for (
      let j = i + 1;
      j < samples.length;
      j++
    ) {
      const second = samples[j];

      const routeSeparation =
        second.distanceFromStart -
        first.distanceFromStart;

      // Don't compare nearby parts of the
      // route. They naturally follow each other.
      if (
        routeSeparation <
        WINDOW_LENGTH_KM * 2
      ) {
        continue;
      }

      // Don't compare sections that are
      // extremely far apart in the route.
      if (
        routeSeparation > 10
      ) {
        break;
      }

      const spatialDistance =
        distanceBetweenPoints(
          first.point,
          second.point
        );

      if (spatialDistance > 0.05) {
        continue;
      }

      const directionDifference =
        angleDifference(
          first.bearing,
          second.bearing
        );

      // Opposite direction.
      if (
        directionDifference < 135
      ) {
        continue;
      }

      overlapKm += SAMPLE_DISTANCE_KM;
    }
  }

  // Don't count the same overlap hundreds
  // of times because many points may fall
  // on the same road.
  overlapKm =
    Math.min(overlapKm, distanceFromStart);

  return {
    overlapKm,
    score: overlapKm * 2,
  };
}

export async function generateLoop(
  start: Location,
  targetDistanceKm: number
): Promise<GeneratedRoute> {
  console.log(
    `Generating route for ${targetDistanceKm} km`
  );

  const radii = [
    2.5,
    3,
    3.5,
    4,
    4.5,
    5,
  ];

  const rotations = [
    0,
    45,
    90,
    135,
  ];

  let bestRoute: GeneratedRoute | null = null;
  let bestScore = Infinity;

  for (const rotation of rotations) {
    console.log(
      `\n=== Rotation ${rotation}° ===`
    );

    for (const radiusKm of radii) {
      const pointB = createPoint(
        start,
        radiusKm,
        rotation
      );

      const pointC = createPoint(
        start,
        radiusKm,
        rotation + 120
      );

      try {
        const route = await getRoute([
          start,
          pointB,
          pointC,
          start,
        ]);

        const distanceError = Math.abs(
          route.distance -
            targetDistanceKm
        );

        const quality =
          calculateRouteQuality(
            route.coordinates
          );

        const score =
          distanceError +
          quality.score;

        console.log(
          `Rotation ${rotation}° | ` +
            `Radius ${radiusKm.toFixed(2)} → ` +
            `${route.distance.toFixed(2)} km | ` +
            `error ${distanceError.toFixed(2)} | ` +
            `overlap ${quality.overlapKm.toFixed(2)} | ` +
            `score ${score.toFixed(2)}`
        );

        if (score < bestScore) {
          bestScore = score;
          bestRoute = route;
        }
      } catch (error) {
        console.error(
          `Route failed for rotation ${rotation}° radius ${radiusKm}:`,
          error
        );
      }
    }
  }

  if (!bestRoute) {
    throw new Error(
      "Could not generate any route."
    );
  }

  console.log(
    `\nBest route: ${bestRoute.distance.toFixed(
      2
    )} km`
  );

  console.log(
    `Best score: ${bestScore.toFixed(2)}`
  );

  return bestRoute;
}