
export type Location = {
  latitude: number;
  longitude: number;
};

export type RouteResult = {
  distance: number;
  time: number;
  coordinates: [number, number][];
};

type GraphHopperResponse = {
  message?: string;
  paths?: Array<{
    distance?: number;
    time?: number;
    points?: {
      type?: string;
      coordinates?: number[][];
    };
  }>;
};

const GRAPHHOPPER_URL =
  "https://graphhopper.com/api/1/route";

const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_INTERVAL_MS = 1_100;

// Space out requests from this Node.js process.
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

async function waitForRequestSlot(): Promise<void> {
  let release!: () => void;
  const previous = requestQueue;

  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    const delay = Math.max(0, nextRequestAt - Date.now());

    if (delay > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay);
      });
    }

    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
  } finally {
    release();
  }
}

function validateLocations(locations: Location[]): void {
  if (locations.length < 2) {
    throw new Error("At least two locations are required.");
  }

  for (const location of locations) {
    if (
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      location.latitude < -90 ||
      location.latitude > 90 ||
      location.longitude < -180 ||
      location.longitude > 180
    ) {
      throw new Error("Invalid waypoint coordinates.");
    }
  }
}

export async function getRoute(
  locations: Location[]
): Promise<RouteResult> {
  validateLocations(locations);

  const apiKey = process.env.GRAPHHOPPER_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GRAPHHOPPER_API_KEY is missing. Check your .env file."
    );
  }

  await waitForRequestSlot();

  const url = new URL(GRAPHHOPPER_URL);

  for (const location of locations) {
    // GraphHopper GET points use latitude,longitude.
    url.searchParams.append(
      "point",
      `${location.latitude},${location.longitude}`
    );
  }

  url.searchParams.set("profile", "foot");
  url.searchParams.set("points_encoded", "false");
  url.searchParams.set("key", apiKey);

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      let message = responseText.slice(0, 500);

      try {
        const errorData = JSON.parse(responseText) as {
          message?: string;
        };

        if (errorData.message) {
          message = errorData.message;
        }
      } catch {
        // Keep the original response text.
      }

      throw new Error(
        `GraphHopper returned HTTP ${response.status}: ${message}`
      );
    }

    const data = JSON.parse(
      responseText
    ) as GraphHopperResponse;

    const path = data.paths?.[0];

    if (!path) {
      throw new Error(
        "GraphHopper returned no route."
      );
    }

    if (
      typeof path.distance !== "number" ||
      !Number.isFinite(path.distance) ||
      path.distance <= 0
    ) {
      throw new Error(
        "GraphHopper returned an invalid route distance."
      );
    }

    if (
      typeof path.time !== "number" ||
      !Number.isFinite(path.time) ||
      path.time < 0
    ) {
      throw new Error(
        "GraphHopper returned an invalid route duration."
      );
    }

    const rawCoordinates = path.points?.coordinates;

    if (
      !Array.isArray(rawCoordinates) ||
      rawCoordinates.length < 2
    ) {
      throw new Error(
        "GraphHopper returned insufficient route geometry."
      );
    }

    const coordinates: [number, number][] = [];

    for (const point of rawCoordinates) {
      const [longitude, latitude] = point;

      if (
        !Number.isFinite(longitude) ||
        !Number.isFinite(latitude) ||
        longitude < -180 ||
        longitude > 180 ||
        latitude < -90 ||
        latitude > 90
      ) {
        throw new Error(
          "GraphHopper returned invalid route coordinates."
        );
      }

      // GraphHopper already provides [longitude, latitude],
      // which is also the format MapLibre expects.
      coordinates.push([longitude, latitude]);
    }

    return {
      // GraphHopper distance is in meters; our app uses km.
      distance: path.distance / 1000,

      // GraphHopper time is in milliseconds; our app uses seconds.
      time: path.time / 1000,

      coordinates,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "GraphHopper routing request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
