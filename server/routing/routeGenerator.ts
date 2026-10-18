
import { getRoute, Location } from "./valhalla";

type Coordinate = [number, number]; // [longitude, latitude]

interface RouteResult {
  distance: number; // kilometers
  time: number; // seconds
  coordinates: Coordinate[];
}

interface Candidate {
  radiusKm: number;
  rotationDeg: number;
  shape: number;
  waypoints: Location[];
  distanceKm: number;
  timeSeconds: number;
  coordinates: Coordinate[];
  distanceErrorKm: number;
  overlapPenalty: number;
  score: number;
}

interface CandidateSpec {
  radiusKm: number;
  rotationDeg: number;
  shape: number;
}

const EARTH_RADIUS_KM = 6371;

const MAX_CONCURRENCY = 6;
const INITIAL_CANDIDATES = 16;
const MAX_ADAPTIVE_ROUNDS = 3;
const MAX_CANDIDATES_PER_ROUND = 6;
const TARGET_TOLERANCE = 0.03;

const MIN_RADIUS_KM = 0.25;
const MAX_RADIUS_KM = 15;
const MIN_TARGET_KM = 1;
const MAX_TARGET_KM = 100;

function clamp(
  value: number,
  min: number,
  max: number
): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

function destination(
  origin: Location,
  distanceKm: number,
  bearingDeg: number
): Location {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = (bearingDeg * Math.PI) / 180;

  const latitude1 =
    (origin.latitude * Math.PI) / 180;
  const longitude1 =
    (origin.longitude * Math.PI) / 180;

  const latitude2 = Math.asin(
    Math.sin(latitude1) * Math.cos(angularDistance) +
      Math.cos(latitude1) *
        Math.sin(angularDistance) *
        Math.cos(bearing)
  );

  const longitude2 =
    longitude1 +
    Math.atan2(
      Math.sin(bearing) *
        Math.sin(angularDistance) *
        Math.cos(latitude1),
      Math.cos(angularDistance) -
        Math.sin(latitude1) * Math.sin(latitude2)
    );

  return {
    latitude: (latitude2 * 180) / Math.PI,
    longitude:
      (((longitude2 * 180) / Math.PI + 540) % 360) -
      180,
  };
}

function makeWaypoints(
  start: Location,
  radiusKm: number,
  rotationDeg: number,
  shape: number
): Location[] {
  const bearingsByShape = [
    [0, 120, 240],
    [0, 90, 210],
    [0, 145, 235],
    [0, 105, 225],
  ];

  const bearings =
    bearingsByShape[shape % bearingsByShape.length];

  return bearings.map((bearing, index) => {
    const adjustedRadius =
      shape === 2 && index === 1
        ? radiusKm * 1.15
        : radiusKm;

    return destination(
      start,
      adjustedRadius,
      normalizeAngle(rotationDeg + bearing)
    );
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const index = nextIndex++;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => runWorker()
    )
  );

  return results;
}

function distanceBetween(
  a: Coordinate,
  b: Coordinate
): number {
  const toRadians = (degrees: number) =>
    (degrees * Math.PI) / 180;

  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const deltaLat = lat2 - lat1;
  const deltaLon = toRadians(b[0] - a[0]);

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLon / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_KM *
    Math.asin(Math.min(1, Math.sqrt(h)))
  );
}

/**
 * Estimates route self-overlap by checking whether points that are
 * far apart along the route pass very close to each other.
 * This is a lightweight heuristic, not a full road-segment matcher.
 */

function calculateOverlapPenalty(
  coordinates: Coordinate[]
): number {
  if (coordinates.length < 12) return 0;

  // Resample by distance so dense sections of the polyline
  // do not receive more weight than sparse sections.
  const sampleSpacingKm = 0.04;
  const closeDistanceKm = 0.02;
  const minSeparationKm = 0.15;
  const startFinishIgnoreKm = 0.25;

  const cumulative: number[] = [0];

  for (let i = 1; i < coordinates.length; i++) {
    cumulative.push(
      cumulative[i - 1] +
        distanceBetween(coordinates[i - 1], coordinates[i])
    );
  }

  const totalKm = cumulative[cumulative.length - 1];
  if (totalKm <= 0) return 0;

  const samples: Array<{
    point: Coordinate;
    alongKm: number;
  }> = [];

  let segment = 1;

  for (
    let alongKm = 0;
    alongKm < totalKm;
    alongKm += sampleSpacingKm
  ) {
    while (
      segment < cumulative.length - 1 &&
      cumulative[segment] < alongKm
    ) {
      segment++;
    }

    const segmentStart = cumulative[segment - 1];
    const segmentEnd = cumulative[segment];
    const segmentLength = segmentEnd - segmentStart;

    const fraction =
      segmentLength > 0
        ? (alongKm - segmentStart) / segmentLength
        : 0;

    const a = coordinates[segment - 1];
    const b = coordinates[segment];

    samples.push({
      point: [
        a[0] + (b[0] - a[0]) * fraction,
        a[1] + (b[1] - a[1]) * fraction,
      ],
      alongKm,
    });
  }

  let retracedSamples = 0;
  let eligibleSamples = 0;

  for (let i = 0; i < samples.length; i++) {
    const current = samples[i];

    // The route naturally begins and ends at the same place.
    if (
      current.alongKm < startFinishIgnoreKm ||
      totalKm - current.alongKm < startFinishIgnoreKm
    ) {
      continue;
    }

    eligibleSamples++;

    for (let j = 0; j < i; j++) {
      const previous = samples[j];
      const separationKm =
        current.alongKm - previous.alongKm;

      // Ignore nearby points along the same continuous segment.
      if (separationKm < minSeparationKm) continue;

      // Ignore natural proximity between the start and finish.
      if (
        previous.alongKm < startFinishIgnoreKm &&
        totalKm - current.alongKm < startFinishIgnoreKm
      ) {
        continue;
      }

      if (
        distanceBetween(current.point, previous.point) <
        closeDistanceKm
      ) {
        retracedSamples++;
        break;
      }
    }
  }

  return eligibleSamples > 0
    ? retracedSamples / eligibleSamples
    : 0;
}


function makeCandidateKey(
  radiusKm: number,
  rotationDeg: number,
  shape: number
): string {
  return [
    radiusKm.toFixed(2),
    normalizeAngle(rotationDeg).toFixed(0),
    shape,
  ].join(":");
}

async function evaluateCandidate(
  start: Location,
  targetDistanceKm: number,
  radiusKm: number,
  rotationDeg: number,
  shape: number
): Promise<Candidate | null> {
  const waypoints = makeWaypoints(
    start,
    radiusKm,
    rotationDeg,
    shape
  );

  // One Valhalla request for the complete loop.
  const stops = [start, ...waypoints, start];

  try {
    const route = (await getRoute(
      stops
    )) as RouteResult;

    if (
      !Number.isFinite(route.distance) ||
      route.distance <= 0 ||
      !Array.isArray(route.coordinates) ||
      route.coordinates.length < 2
    ) {
      return null;
    }

    const distanceErrorKm = Math.abs(
      route.distance - targetDistanceKm
    );

    const overlapPenalty =
      calculateOverlapPenalty(route.coordinates);

    return {
      radiusKm,
      rotationDeg: normalizeAngle(rotationDeg),
      shape,
      waypoints,
      distanceKm: route.distance,
      timeSeconds: route.time || 0,
      coordinates: route.coordinates,
      distanceErrorKm,
      overlapPenalty,
      score:
        distanceErrorKm +
        overlapPenalty * targetDistanceKm * 0.25,
    };
  } catch (error) {
    console.warn("Route candidate failed:", error);
    return null;
  }
}

function rankCandidates(
  candidates: Candidate[]
): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aWithinTolerance =
      a.distanceErrorKm <=
      a.distanceKm * TARGET_TOLERANCE;

    const bWithinTolerance =
      b.distanceErrorKm <=
      b.distanceKm * TARGET_TOLERANCE;

    // Prefer an acceptable-distance route over one outside tolerance.
    if (aWithinTolerance !== bWithinTolerance) {
      return aWithinTolerance ? -1 : 1;
    }

    // For similarly accurate routes, prefer less overlap.
    if (
      Math.abs(a.distanceErrorKm - b.distanceErrorKm) >
      0.15
    ) {
      return a.distanceErrorKm - b.distanceErrorKm;
    }

    return a.score - b.score;
  });
}

function buildInitialCandidates(
  targetDistanceKm: number
): CandidateSpec[] {
  // This estimates a starting radius; actual road distances are
  // measured and corrected during the adaptive search.
  const baseRadius = clamp(
    targetDistanceKm / 5,
    MIN_RADIUS_KM,
    MAX_RADIUS_KM
  );

  const radiusFactors = [
    0.65,
    0.9,
    1.15,
    1.45,
    1.8,
    2.2,
  ];

  const rotations = [0, 45, 90, 135];

  return radiusFactors
    .flatMap((factor, radiusIndex) =>
      rotations.map((rotationDeg, rotationIndex) => ({
        radiusKm: clamp(
          baseRadius * factor,
          MIN_RADIUS_KM,
          MAX_RADIUS_KM
        ),
        rotationDeg,
        shape: (radiusIndex + rotationIndex) % 4,
      }))
    )
    .slice(0, INITIAL_CANDIDATES);
}

function buildAdaptiveCandidates(
  targetDistanceKm: number,
  ranked: Candidate[],
  attempted: Set<string>
): CandidateSpec[] {
  const best = ranked[0];

  if (!best) {
    return [];
  }

  const candidates: CandidateSpec[] = [];

  function add(
    radiusKm: number,
    rotationDeg: number,
    shape: number
  ): void {
    const radius = clamp(
      radiusKm,
      MIN_RADIUS_KM,
      MAX_RADIUS_KM
    );

    const rotation = normalizeAngle(rotationDeg);
    const key = makeCandidateKey(
      radius,
      rotation,
      shape
    );

    if (
      attempted.has(key) ||
      candidates.some(
        (candidate) =>
          makeCandidateKey(
            candidate.radiusKm,
            candidate.rotationDeg,
            candidate.shape
          ) === key
      )
    ) {
      return;
    }

    candidates.push({
      radiusKm: radius,
      rotationDeg: rotation,
      shape,
    });
  }

  // Damp the correction because radius and road distance are
  // not linearly related.
  const ratio = targetDistanceKm / best.distanceKm;
  const correction = clamp(
    Math.sqrt(ratio),
    0.7,
    1.4
  );

  // Try the corrected radius, then probe both sides of it.
  add(
    best.radiusKm * correction,
    best.rotationDeg,
    best.shape
  );

  const allTooLong = ranked.every(
    (candidate) =>
      candidate.distanceKm > targetDistanceKm
  );

  const allTooShort = ranked.every(
    (candidate) =>
      candidate.distanceKm < targetDistanceKm
  );

  if (allTooLong) {
    add(
      best.radiusKm * 0.7,
      best.rotationDeg,
      (best.shape + 1) % 4
    );
  } else if (allTooShort) {
    add(
      best.radiusKm * 1.3,
      best.rotationDeg,
      (best.shape + 1) % 4
    );
  } else {
    add(
      best.radiusKm * 0.85,
      best.rotationDeg,
      (best.shape + 1) % 4
    );
  }

  add(
    best.radiusKm * 1.15,
    best.rotationDeg,
    (best.shape + 2) % 4
  );

  // Explore a different orientation from another strong candidate.
  const alternative = ranked.find(
    (candidate) =>
      candidate.rotationDeg !== best.rotationDeg
  );

  if (alternative) {
    add(
      alternative.radiusKm,
      alternative.rotationDeg + 30,
      (alternative.shape + 1) % 4
    );
  } else {
    add(
      best.radiusKm * correction,
      best.rotationDeg + 45,
      (best.shape + 1) % 4
    );
  }

  return candidates.slice(
    0,
    MAX_CANDIDATES_PER_ROUND
  );
}

export async function generateLoop(
  start: Location,
  targetDistanceKm: number
) {
  if (
    !Number.isFinite(start.latitude) ||
    !Number.isFinite(start.longitude) ||
    start.latitude < -90 ||
    start.latitude > 90 ||
    start.longitude < -180 ||
    start.longitude > 180
  ) {
    throw new Error("Invalid starting location.");
  }

  if (
    !Number.isFinite(targetDistanceKm) ||
    targetDistanceKm < MIN_TARGET_KM ||
    targetDistanceKm > MAX_TARGET_KM
  ) {
    throw new Error(
      `Distance must be between ${MIN_TARGET_KM} and ${MAX_TARGET_KM} km.`
    );
  }

  const attempted = new Set<string>();
  let evaluated: Candidate[] = [];

  async function evaluateBatch(
    specs: CandidateSpec[]
  ): Promise<Candidate[]> {
    const fresh = specs.filter((spec) => {
      const key = makeCandidateKey(
        spec.radiusKm,
        spec.rotationDeg,
        spec.shape
      );

      if (attempted.has(key)) {
        return false;
      }

      // Mark attempted here, not when constructing adaptive specs.
      attempted.add(key);
      return true;
    });

    const results = await mapWithConcurrency(
      fresh,
      MAX_CONCURRENCY,
      (spec) =>
        evaluateCandidate(
          start,
          targetDistanceKm,
          spec.radiusKm,
          spec.rotationDeg,
          spec.shape
        )
    );

    return results.filter(
      (candidate): candidate is Candidate =>
        candidate !== null
    );
  }

  evaluated = await evaluateBatch(
    buildInitialCandidates(targetDistanceKm)
  );

  if (evaluated.length === 0) {
    throw new Error(
      "Could not generate a valid route. Try another starting location."
    );
  }

  let best = rankCandidates(evaluated)[0];

  for (
    let round = 0;
    round < MAX_ADAPTIVE_ROUNDS;
    round++
  ) {
    // Stop early when the best distance is within 3%.
    if (
      best.distanceErrorKm <=
      targetDistanceKm * TARGET_TOLERANCE
    ) {
      break;
    }

    const nextSpecs = buildAdaptiveCandidates(
      targetDistanceKm,
      rankCandidates(evaluated),
      attempted
    );

    if (nextSpecs.length === 0) {
      break;
    }

    const nextResults = await evaluateBatch(nextSpecs);

    if (nextResults.length === 0) {
      break;
    }

    evaluated = [...evaluated, ...nextResults];
    best = rankCandidates(evaluated)[0];
  }

  const withinTolerance =
    best.distanceErrorKm <=
    targetDistanceKm * TARGET_TOLERANCE;

  const errorPercent =
    ((best.distanceKm - targetDistanceKm) /
      targetDistanceKm) *
    100;

  console.log(
    `Route target: ${targetDistanceKm.toFixed(2)} km; ` +
      `actual: ${best.distanceKm.toFixed(2)} km; ` +
      `difference: ${errorPercent.toFixed(1)}%; ` +
      `candidates evaluated: ${evaluated.length}; ` +
      `within 3%: ${withinTolerance}`
  );

  return {
    distance: best.distanceKm,
    time: best.timeSeconds,
    coordinates: best.coordinates,
    targetDistance: targetDistanceKm,
    distanceError: best.distanceErrorKm,
    withinTolerance,
  };
}
