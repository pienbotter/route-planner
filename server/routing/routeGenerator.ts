
import { getRoute, Location } from "./valhalla";

type Coordinate = [number, number];

interface Candidate {
  radiusKm: number;
  rotationDeg: number;
  shape: number;
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

const MAX_CONCURRENCY = 2;
const INITIAL_CANDIDATES = 6;
const MAX_ADAPTIVE_ROUNDS = 2;
const MAX_CANDIDATES_PER_ROUND = 3;
const TARGET_TOLERANCE = 0.03;

const MIN_RADIUS_KM = 0.25;
const MAX_RADIUS_KM = 15;
const MIN_TARGET_KM = 1;
const MAX_TARGET_KM = 100;

const MAX_RETURNED_ROUTES = 3;

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

function angleDifference(a: number, b: number): number {
  const difference = Math.abs(
    normalizeAngle(a) - normalizeAngle(b)
  );

  return Math.min(difference, 360 - difference);
}

function destination(
  origin: Location,
  distanceKm: number,
  bearingDeg: number
): Location {
  const angularDistance =
    distanceKm / EARTH_RADIUS_KM;

  const bearing =
    (bearingDeg * Math.PI) / 180;

  const latitude1 =
    (origin.latitude * Math.PI) / 180;

  const longitude1 =
    (origin.longitude * Math.PI) / 180;

  const latitude2 = Math.asin(
    Math.sin(latitude1) *
      Math.cos(angularDistance) +
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
        Math.sin(latitude1) *
          Math.sin(latitude2)
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
  const shapes = [
    [0, 120, 240],
    [0, 90, 210],
    [0, 145, 235],
    [0, 105, 225],
  ];

  const bearings = shapes[shape % shapes.length];

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
      {
        length: Math.min(concurrency, items.length),
      },
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
 * Estimates how much a route overlaps itself.
 * This is a heuristic, not a comparison of actual road segments.
 */
function calculateOverlapPenalty(
  coordinates: Coordinate[]
): number {
  if (coordinates.length < 12) {
    return 0;
  }

  const cumulative: number[] = [0];

  for (let i = 1; i < coordinates.length; i++) {
    cumulative.push(
      cumulative[i - 1] +
        distanceBetween(
          coordinates[i - 1],
          coordinates[i]
        )
    );
  }

  const totalKm =
    cumulative[cumulative.length - 1];

  if (totalKm <= 0) {
    return 0;
  }

  const spacingKm = Math.max(
    0.05,
    totalKm / 300
  );

  const samples: Array<{
    point: Coordinate;
    alongKm: number;
  }> = [];

  let segment = 1;

  for (
    let alongKm = 0;
    alongKm < totalKm;
    alongKm += spacingKm
  ) {
    while (
      segment < cumulative.length - 1 &&
      cumulative[segment] < alongKm
    ) {
      segment++;
    }

    const segmentStart = cumulative[segment - 1];
    const segmentEnd = cumulative[segment];

    const segmentLength =
      segmentEnd - segmentStart;

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

  let overlappingSamples = 0;
  let eligibleSamples = 0;

  for (let i = 0; i < samples.length; i++) {
    const current = samples[i];

    // Ignore the natural proximity of the start and finish.
    if (
      current.alongKm < 0.25 ||
      totalKm - current.alongKm < 0.25
    ) {
      continue;
    }

    eligibleSamples++;

    for (let j = 0; j < i; j++) {
      const previous = samples[j];

      const separationKm =
        current.alongKm - previous.alongKm;

      if (separationKm < 0.15) {
        continue;
      }

      if (
        previous.alongKm < 0.25 &&
        totalKm - current.alongKm < 0.25
      ) {
        continue;
      }

      if (
        distanceBetween(
          current.point,
          previous.point
        ) < 0.02
      ) {
        overlappingSamples++;
        break;
      }
    }
  }

  return eligibleSamples > 0
    ? overlappingSamples / eligibleSamples
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
  spec: CandidateSpec
): Promise<Candidate | null> {
  const {
    radiusKm,
    rotationDeg,
    shape,
  } = spec;

  const waypoints = makeWaypoints(
    start,
    radiusKm,
    rotationDeg,
    shape
  );

  // Visit all three waypoints and return to the start.
  const stops = [start, ...waypoints, start];

  try {
    const route = await getRoute(stops);

    if (
      !Number.isFinite(route.distance) ||
      route.distance <= 0 ||
      !Number.isFinite(route.time) ||
      !Array.isArray(route.coordinates) ||
      route.coordinates.length < 2
    ) {
      throw new Error(
        "The routing service returned an invalid route."
      );
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
      distanceKm: route.distance,
      timeSeconds: route.time,
      coordinates: route.coordinates,
      distanceErrorKm,
      overlapPenalty,
      score:
        distanceErrorKm +
        overlapPenalty * targetDistanceKm * 0.2,
    };
  } catch (error) {
    console.warn(
      `[Route candidate failed] ` +
        `radius=${radiusKm.toFixed(2)} km, ` +
        `rotation=${rotationDeg}, shape=${shape}:`,
      error instanceof Error
        ? error.message
        : error
    );

    return null;
  }
}

function rankCandidates(
  candidates: Candidate[],
  targetDistanceKm: number
): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aWithinTolerance =
      a.distanceErrorKm <=
      targetDistanceKm * TARGET_TOLERANCE;

    const bWithinTolerance =
      b.distanceErrorKm <=
      targetDistanceKm * TARGET_TOLERANCE;

    if (aWithinTolerance !== bWithinTolerance) {
      return aWithinTolerance ? -1 : 1;
    }

    if (
      Math.abs(
        a.distanceErrorKm - b.distanceErrorKm
      ) > 0.05
    ) {
      return a.distanceErrorKm - b.distanceErrorKm;
    }

    return a.score - b.score;
  });
}

/**
 * Selects up to three highly ranked candidates while avoiding
 * candidates with almost identical generation parameters.
 *
 * This improves variety, but cannot guarantee that every route
 * uses different roads.
 */
function selectDistinctCandidates(
  ranked: Candidate[]
): Candidate[] {
  const selected: Candidate[] = [];

  for (const candidate of ranked) {
    const tooSimilar = selected.some((existing) => {
      const sameShape =
        existing.shape === candidate.shape;

      const similarRadius =
        Math.abs(existing.radiusKm - candidate.radiusKm) <
        Math.max(
          0.2,
          Math.min(existing.radiusKm, candidate.radiusKm) *
            0.1
        );

      const similarRotation =
        angleDifference(
          existing.rotationDeg,
          candidate.rotationDeg
        ) < 25;

      return sameShape && similarRadius && similarRotation;
    });

    if (!tooSimilar) {
      selected.push(candidate);
    }

    if (selected.length >= MAX_RETURNED_ROUTES) {
      break;
    }
  }

  return selected;
}

function buildInitialCandidates(
  targetDistanceKm: number
): CandidateSpec[] {
  const baseRadius = clamp(
    targetDistanceKm / 7,
    MIN_RADIUS_KM,
    MAX_RADIUS_KM
  );

  const radiusFactors = [
    0.65,
    0.85,
    1.05,
    1.25,
    1.5,
    1.8,
  ];

  const rotations = [
    0,
    45,
    90,
    135,
    180,
    225,
  ];

  return radiusFactors
    .slice(0, INITIAL_CANDIDATES)
    .map((factor, index) => ({
      radiusKm: clamp(
        baseRadius * factor,
        MIN_RADIUS_KM,
        MAX_RADIUS_KM
      ),
      rotationDeg: rotations[index],
      shape: index % 4,
    }));
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
    const spec: CandidateSpec = {
      radiusKm: clamp(
        radiusKm,
        MIN_RADIUS_KM,
        MAX_RADIUS_KM
      ),
      rotationDeg: normalizeAngle(rotationDeg),
      shape: ((shape % 4) + 4) % 4,
    };

    const key = makeCandidateKey(
      spec.radiusKm,
      spec.rotationDeg,
      spec.shape
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

    candidates.push(spec);
  }

  const ratio =
    targetDistanceKm / best.distanceKm;

  const correction = clamp(
    Math.sqrt(ratio),
    0.7,
    1.4
  );

  add(
    best.radiusKm * correction,
    best.rotationDeg,
    best.shape
  );

  add(
    best.radiusKm * correction * 0.85,
    best.rotationDeg + 30,
    (best.shape + 1) % 4
  );

  add(
    best.radiusKm * correction * 1.15,
    best.rotationDeg + 60,
    (best.shape + 2) % 4
  );

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
      `Distance must be between ${MIN_TARGET_KM} ` +
        `and ${MAX_TARGET_KM} km.`
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
          spec
        )
    );

    return results.filter(
      (candidate): candidate is Candidate =>
        candidate !== null
    );
  }

  const initialSpecs =
    buildInitialCandidates(targetDistanceKm);

  evaluated = await evaluateBatch(initialSpecs);

  if (evaluated.length === 0) {
    throw new Error(
      "All route candidates failed. Check the backend " +
        "logs for the GraphHopper error, then try again."
    );
  }

  let ranked = rankCandidates(
    evaluated,
    targetDistanceKm
  );

  let best = ranked[0];

  for (
    let round = 0;
    round < MAX_ADAPTIVE_ROUNDS;
    round++
  ) {
    if (
      best.distanceErrorKm <=
      targetDistanceKm * TARGET_TOLERANCE
    ) {
      break;
    }

    const nextSpecs = buildAdaptiveCandidates(
      targetDistanceKm,
      ranked,
      attempted
    );

    if (nextSpecs.length === 0) {
      break;
    }

    const nextResults =
      await evaluateBatch(nextSpecs);

    if (nextResults.length === 0) {
      console.warn(
        "Adaptive search produced no valid new candidates."
      );
      break;
    }

    evaluated = [...evaluated, ...nextResults];

    ranked = rankCandidates(
      evaluated,
      targetDistanceKm
    );

    best = ranked[0];
  }

  ranked = rankCandidates(evaluated, targetDistanceKm);

  const selected = selectDistinctCandidates(ranked);

  const routes = selected.map((candidate, index) => ({
    id: index + 1,
    distance: candidate.distanceKm,
    time: candidate.timeSeconds,
    coordinates: candidate.coordinates,
    targetDistance: targetDistanceKm,
    distanceError: candidate.distanceErrorKm,
    withinTolerance:
      candidate.distanceErrorKm <=
      targetDistanceKm * TARGET_TOLERANCE,
  }));

  console.log(
    `Route target: ${targetDistanceKm.toFixed(2)} km; ` +
      `best actual: ${best.distanceKm.toFixed(2)} km; ` +
      `candidates evaluated: ${evaluated.length}; ` +
      `routes returned: ${routes.length}; ` +
      `best route within 3%: ` +
      `${best.distanceErrorKm <= targetDistanceKm * TARGET_TOLERANCE}`
  );

  return { routes };
}
