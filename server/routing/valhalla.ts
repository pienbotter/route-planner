import polyline from "@mapbox/polyline";

export type Location = {
  latitude: number;
  longitude: number;
};

export type RouteResult = {
  distance: number;
  time: number;
  coordinates: [number, number][];
};

type ValhallaResponse = {
  trip?: {
    status?: number;
    status_message?: string;
    summary?: {
      length?: number;
      time?: number;
    };
    legs?: Array<{
      shape?: string;
    }>;
  };
};

const VALHALLA_URL =
  "https://valhalla1.openstreetmap.de/route";

const REQUEST_TIMEOUT_MS = 15_000;

export async function getRoute(
  locations: Location[]
): Promise<RouteResult> {
  if (locations.length < 2) {
    throw new Error(
      "At least two locations are required."
    );
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

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(VALHALLA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        locations: locations.map((location) => ({
          lat: location.latitude,
          lon: location.longitude,
        })),
        costing: "pedestrian",
        units: "kilometers",
        shape_format: "polyline6",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Valhalla returned HTTP ${response.status}.`
      );
    }

    const data =
      (await response.json()) as ValhallaResponse;

    const trip = data.trip;

    if (!trip) {
      throw new Error("Valhalla did not return a trip.");
    }

    if (trip.status && trip.status !== 0) {
      throw new Error(
        trip.status_message ??
          `Valhalla routing failed with status ${trip.status}.`
      );
    }

    const distance = trip.summary?.length;
    const time = trip.summary?.time;

    if (
      typeof distance !== "number" ||
      !Number.isFinite(distance) ||
      distance <= 0
    ) {
      throw new Error(
        "Valhalla returned an invalid route distance."
      );
    }

    if (
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      time < 0
    ) {
      throw new Error(
        "Valhalla returned an invalid route duration."
      );
    }

    if (!trip.legs || trip.legs.length === 0) {
      throw new Error(
        "Valhalla returned no route legs."
      );
    }

    const coordinates: [number, number][] = [];

    for (const leg of trip.legs) {
      if (!leg.shape) {
        throw new Error(
          "Valhalla returned a leg without geometry."
        );
      }

      const decoded = polyline.decode(leg.shape, 6);

      for (const [latitude, longitude] of decoded) {
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude)
        ) {
          throw new Error(
            "Valhalla returned invalid route coordinates."
          );
        }

        const point: [number, number] = [
          longitude,
          latitude,
        ];

        const previous =
          coordinates[coordinates.length - 1];

        // Avoid duplicating shared endpoints between legs.
        if (
          !previous ||
          previous[0] !== point[0] ||
          previous[1] !== point[1]
        ) {
          coordinates.push(point);
        }
      }
    }

    if (coordinates.length < 2) {
      throw new Error(
        "Valhalla returned insufficient route geometry."
      );
    }

    return {
      distance,
      time,
      coordinates,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        "Valhalla routing request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}