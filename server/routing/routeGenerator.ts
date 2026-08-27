import { getRoute, Location } from "./valhalla";

type RouteQuality = {
  sameDirectionOverlapKm: number;
  oppositeDirectionOverlapKm: number;
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

type Sample = {
  point: [number, number];
  bearing: number;
  distanceFromStart: number;
};

/**
 * Create evenly spaced samples along the route.
 *
 * Using evenly spaced samples is important because
 * Valhalla's geometry can contain very short or very
 * long segments. Comparing raw geometry points would
 * therefore make the overlap calculation inconsistent.
 */
function createSamples(
  coordinates: [number, number][]
): Sample[] {
  if (coordinates.length < 2) {
    return [];
  }

  const SAMPLE_DISTANCE_KM = 0.05;

  const samples: Sample[] = [];

  let distanceFromStart = 0;
  let nextSampleDistance = 0;

  for (
    let i = 0;
    i < coordinates.length - 1;
    i++
  ) {
    const a = coordinates[i];
    const b = coordinates[i + 1];

    const segmentLength =
      distanceBetweenPoints(a, b);

    if (segmentLength <= 0) {
      continue;
    }

    const bearing =
      calculateBearing(a, b);

    /*
     * Add samples along the segment whenever
     * we cross the next sampling distance.
     */
    while (
      nextSampleDistance <=
      distanceFromStart + segmentLength
    ) {
      const distanceIntoSegment =
        nextSampleDistance -
        distanceFromStart;

      if (
        distanceIntoSegment < -0.000001
      ) {
        break;
      }

      const fraction =
        segmentLength === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                distanceIntoSegment /
                  segmentLength
              )
            );

      const point: [number, number] = [
        a[0] +
          (b[0] - a[0]) *
            fraction,
        a[1] +
          (b[1] - a[1]) *
            fraction,
      ];

      samples.push({
        point,
        bearing,
        distanceFromStart:
          nextSampleDistance,
      });

      nextSampleDistance +=
        SAMPLE_DISTANCE_KM;
    }

    distanceFromStart += segmentLength;
  }

  /*
   * Make sure we have at least one sample near
   * the end of the route.
   */
  if (
    coordinates.length >= 2 &&
    samples.length > 0
  ) {
    const last =
      coordinates[
        coordinates.length - 1
      ];

    const previous =
      coordinates[
        coordinates.length - 2
      ];

    const lastDistance =
      distanceBetweenPoints(
        previous,
        last
      );

    const lastBearing =
      calculateBearing(
        previous,
        last
      );

    const totalDistance =
      distanceFromStart;

    const lastSample =
      samples[samples.length - 1];

    if (
      totalDistance -
        lastSample.distanceFromStart >
      SAMPLE_DISTANCE_KM * 0.5
    ) {
      samples.push({
        point: last,
        bearing: lastBearing,
        distanceFromStart:
          totalDistance,
      });
    }
  }

  return samples;
}

/**
 * Find the closest route sample to a given sample
 * inside a range of route indices.
 */
function findBestMatchingSample(
  samples: Sample[],
  sourceIndex: number,
  searchStart: number,
  searchEnd: number,
  requireOppositeDirection: boolean
): number | null {
  const source =
    samples[sourceIndex];

  const MAX_DISTANCE_KM = 0.02;

  let bestIndex: number | null = null;
  let bestDistance =
    Infinity;

  for (
    let j = searchStart;
    j <= searchEnd;
    j++
  ) {
    if (j < 0 || j >= samples.length) {
      continue;
    }

    const candidate =
      samples[j];

    const spatialDistance =
      distanceBetweenPoints(
        source.point,
        candidate.point
      );

    if (
      spatialDistance >
      MAX_DISTANCE_KM
    ) {
      continue;
    }

    const directionDifference =
      angleDifference(
        source.bearing,
        candidate.bearing
      );

    if (requireOppositeDirection) {
      if (
        directionDifference < 150
      ) {
        continue;
      }
    }

    if (
      spatialDistance <
      bestDistance
    ) {
      bestDistance =
        spatialDistance;
      bestIndex = j;
    }
  }

  return bestIndex;
}

/**
 * Detect continuous sections of the route that
 * appear to be driven twice in opposite directions.
 *
 * This is deliberately much stricter than comparing
 * every pair of route points.
 *
 * A backtracking section should have this structure:
 *
 *   route A:  -------------------->
 *
 *   route B:  <--------------------
 *
 * and the matching points should progress through
 * both sections of the route continuously.
 */
function detectContinuousOppositeOverlap(
  samples: Sample[]
): number {
  if (samples.length < 2) {
    return 0;
  }

  const SAMPLE_DISTANCE_KM = 0.05;

  /*
   * A genuine backtracking section must be at least
   * this long before we penalize it.
   *
   * This prevents crossings and tiny switchbacks
   * from becoming "overlap".
   */
  const MIN_BACKTRACK_LENGTH_KM = 0.30;

  /*
   * How much the matching position is allowed to
   * deviate from the expected progression.
   */
  const MAX_MATCH_GAP_SAMPLES = 3;

  /*
   * We don't compare nearby route sections.
   */
  const MIN_ROUTE_SEPARATION_KM = 0.50;

  /*
   * We don't need to search the entire route for
   * every sample.
   */
  const MAX_ROUTE_SEPARATION_KM = 15;

  const match: Array<
    number | null
  > = new Array(samples.length).fill(
    null
  );

  /*
   * First find possible opposite-direction matches.
   */
  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const source =
      samples[i];

    let lowerIndex = i + 1;
    let upperIndex =
      samples.length - 1;

    /*
     * Restrict the search by route distance.
     */
    while (
      lowerIndex <
        samples.length &&
      samples[lowerIndex]
        .distanceFromStart -
        source.distanceFromStart <
        MIN_ROUTE_SEPARATION_KM
    ) {
      lowerIndex++;
    }

    while (
      upperIndex >= lowerIndex &&
      samples[upperIndex]
        .distanceFromStart -
        source.distanceFromStart >
        MAX_ROUTE_SEPARATION_KM
    ) {
      upperIndex--;
    }

    if (lowerIndex > upperIndex) {
      continue;
    }

    match[i] =
      findBestMatchingSample(
        samples,
        i,
        lowerIndex,
        upperIndex,
        true
      );
  }

  /*
   * Now identify continuous runs.
   *
   * For actual backtracking, if route sample i
   * matches route sample j, the next samples should
   * approximately match:
   *
   *   i + 1 -> j - 1
   *   i + 2 -> j - 2
   *
   * because the second occurrence is being travelled
   * in the opposite direction.
   */
  const visited = new Set<number>();

  let totalBacktrackingKm = 0;

  for (
    let startIndex = 0;
    startIndex < samples.length;
    startIndex++
  ) {
    if (
      match[startIndex] === null
    ) {
      continue;
    }

    if (
      visited.has(startIndex)
    ) {
      continue;
    }

    const startMatch =
      match[startIndex];

    if (
      startMatch === null
    ) {
      continue;
    }

    /*
     * The two occurrences need to be separated
     * along the route.
     */
    if (
      Math.abs(
        samples[startMatch]
          .distanceFromStart -
          samples[startIndex]
            .distanceFromStart
      ) <
      MIN_ROUTE_SEPARATION_KM
    ) {
      continue;
    }

    let runLength = 1;

    let previousSource =
      startIndex;

    let previousMatch =
      startMatch;

    const runIndices: number[] = [
      startIndex,
    ];

    while (true) {
      const nextSource =
        previousSource + 1;

      if (
        nextSource >=
        samples.length
      ) {
        break;
      }

      const expectedMatch =
        previousMatch - 1;

      if (
        expectedMatch < 0
      ) {
        break;
      }

      const actualMatch =
        match[nextSource];

      if (
        actualMatch === null
      ) {
        break;
      }

      /*
       * Because the second section is traversed
       * backwards, its sample index should decrease.
       */
      const matchDeviation =
        Math.abs(
          actualMatch -
            expectedMatch
        );

      if (
        matchDeviation >
        MAX_MATCH_GAP_SAMPLES
      ) {
        break;
      }

      /*
       * Verify that the actual matched points are
       * still spatially close.
       */
      const spatialDistance =
        distanceBetweenPoints(
          samples[nextSource].point,
          samples[actualMatch].point
        );

      if (
        spatialDistance >
        0.02
      ) {
        break;
      }

      runLength++;

      runIndices.push(
        nextSource
      );

      previousSource =
        nextSource;

      previousMatch =
        actualMatch;
    }

    const runDistance =
      runLength *
      SAMPLE_DISTANCE_KM;

    /*
     * Only count sufficiently long continuous runs.
     */
    if (
      runDistance >=
      MIN_BACKTRACK_LENGTH_KM
    ) {
      /*
       * Mark this run as processed.
       */
      for (
        const index of runIndices
      ) {
        visited.add(index);
      }

      totalBacktrackingKm +=
        runDistance;
    }
  }

  /*
   * The same physical overlap can sometimes be
   * discovered from both ends. Clamp the result
   * conservatively.
   */
  return Math.min(
    totalBacktrackingKm,
    samples.length *
      SAMPLE_DISTANCE_KM
  );
}

/**
 * Detect same-direction reuse separately.
 *
 * Same-direction reuse is much less problematic than
 * actual backtracking, so it receives a small penalty.
 */
function detectContinuousSameDirectionOverlap(
  samples: Sample[]
): number {
  if (samples.length < 2) {
    return 0;
  }

  const SAMPLE_DISTANCE_KM = 0.05;

  const MIN_REUSE_LENGTH_KM = 0.30;
  const MIN_ROUTE_SEPARATION_KM = 0.50;
  const MAX_ROUTE_SEPARATION_KM = 15;

  const matches: Array<
    number | null
  > = new Array(samples.length).fill(
    null
  );

  for (
    let i = 0;
    i < samples.length;
    i++
  ) {
    const source =
      samples[i];

    let searchStart = i + 1;
    let searchEnd =
      samples.length - 1;

    while (
      searchStart <
        samples.length &&
      samples[searchStart]
        .distanceFromStart -
        source.distanceFromStart <
        MIN_ROUTE_SEPARATION_KM
    ) {
      searchStart++;
    }

    while (
      searchEnd >= searchStart &&
      samples[searchEnd]
        .distanceFromStart -
        source.distanceFromStart >
        MAX_ROUTE_SEPARATION_KM
    ) {
      searchEnd--;
    }

    if (
      searchStart > searchEnd
    ) {
      continue;
    }

    let bestIndex:
      | number
      | null = null;

    let bestDistance =
      Infinity;

    for (
      let j = searchStart;
      j <= searchEnd;
      j++
    ) {
      const candidate =
        samples[j];

      const spatialDistance =
        distanceBetweenPoints(
          source.point,
          candidate.point
        );

      if (
        spatialDistance >
        0.02
      ) {
        continue;
      }

      const directionDifference =
        angleDifference(
          source.bearing,
          candidate.bearing
        );

      if (
        directionDifference >
        30
      ) {
        continue;
      }

      if (
        spatialDistance <
        bestDistance
      ) {
        bestDistance =
          spatialDistance;
        bestIndex = j;
      }
    }

    matches[i] = bestIndex;
  }

  let totalReuseKm = 0;

  const visited = new Set<number>();

  for (
    let startIndex = 0;
    startIndex < samples.length;
    startIndex++
  ) {
    if (
      matches[startIndex] ===
      null
    ) {
      continue;
    }

    if (
      visited.has(startIndex)
    ) {
      continue;
    }

    const startMatch =
      matches[startIndex];

    if (
      startMatch === null
    ) {
      continue;
    }

    let runLength = 1;

    let previousSource =
      startIndex;

    let previousMatch =
      startMatch;

    const runIndices: number[] = [
      startIndex,
    ];

    while (true) {
      const nextSource =
        previousSource + 1;

      if (
        nextSource >=
        samples.length
      ) {
        break;
      }

      const actualMatch =
        matches[nextSource];

      if (
        actualMatch === null
      ) {
        break;
      }

      /*
       * Same-direction reuse should progress forward
       * through the matching route section.
       */
      if (
        actualMatch <
        previousMatch
      ) {
        break;
      }

      if (
        Math.abs(
          actualMatch -
            previousMatch
        ) > 3
      ) {
        break;
      }

      const spatialDistance =
        distanceBetweenPoints(
          samples[nextSource].point,
          samples[actualMatch].point
        );

      if (
        spatialDistance >
        0.02
      ) {
        break;
      }

      runLength++;

      runIndices.push(
        nextSource
      );

      previousSource =
        nextSource;

      previousMatch =
        actualMatch;
    }

    const runDistance =
      runLength *
      SAMPLE_DISTANCE_KM;

    if (
      runDistance >=
      MIN_REUSE_LENGTH_KM
    ) {
      for (
        const index of runIndices
      ) {
        visited.add(index);
      }

      totalReuseKm +=
        runDistance;
    }
  }

  return Math.min(
    totalReuseKm,
    samples.length *
      SAMPLE_DISTANCE_KM
  );
}

function calculateRouteQuality(
  coordinates: [number, number][]
): RouteQuality {
  const samples =
    createSamples(coordinates);

  if (samples.length < 2) {
    return {
      sameDirectionOverlapKm: 0,
      oppositeDirectionOverlapKm: 0,
      overlapKm: 0,
      score: 0,
    };
  }

  const oppositeDirectionOverlapKm =
    detectContinuousOppositeOverlap(
      samples
    );

  const sameDirectionOverlapKm =
    detectContinuousSameDirectionOverlap(
      samples
    );

  const overlapKm =
    sameDirectionOverlapKm +
    oppositeDirectionOverlapKm;

  /*
   * Opposite-direction reuse is the thing we really
   * want to avoid.
   *
   * Same-direction reuse gets a much smaller penalty
   * because it can occur naturally in real road
   * networks.
   */
  const score =
    sameDirectionOverlapKm * 1.5 +
    oppositeDirectionOverlapKm * 8;

  return {
    sameDirectionOverlapKm,
    oppositeDirectionOverlapKm,
    overlapKm,
    score,
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

  let bestRoute:
    | GeneratedRoute
    | null = null;

  let bestScore = Infinity;

  for (
    const rotation of rotations
  ) {
    console.log(
      `\n=== Rotation ${rotation}° ===`
    );

    for (
      const radiusKm of radii
    ) {
      const pointB =
        createPoint(
          start,
          radiusKm,
          rotation
        );

      const pointC =
        createPoint(
          start,
          radiusKm,
          rotation + 120
        );

      try {
        const route =
          await getRoute([
            start,
            pointB,
            pointC,
            start,
          ]);

        const distanceError =
          Math.abs(
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
            `overlap ${quality.overlapKm.toFixed(2)} ` +
            `(same ${quality.sameDirectionOverlapKm.toFixed(2)}, ` +
            `opposite ${quality.oppositeDirectionOverlapKm.toFixed(2)}) | ` +
            `score ${score.toFixed(2)}`
        );

        if (
          score < bestScore
        ) {
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