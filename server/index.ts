import "dotenv/config";
import http from "node:http";
import { generateLoop } from "./routing/routeGenerator";

const PORT = Number(process.env.PORT ?? 3000);

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";

interface Location {
  latitude: number;
  longitude: number;
}

interface RouteRequest {
  start: Location;
  distance: number;
}

const MAX_BODY_SIZE = 16_384;

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });

  res.end(JSON.stringify(data));
}

function isValidRouteRequest(
  value: unknown
): value is RouteRequest {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return false;
  }

  const data = value as Record<string, unknown>;

  if (
    typeof data.distance !== "number" ||
    !Number.isFinite(data.distance) ||
    data.distance < 1 ||
    data.distance > 100
  ) {
    return false;
  }

  if (
    typeof data.start !== "object" ||
    data.start === null
  ) {
    return false;
  }

  const start = data.start as Record<string, unknown>;

  return (
    typeof start.latitude === "number" &&
    Number.isFinite(start.latitude) &&
    start.latitude >= -90 &&
    start.latitude <= 90 &&
    typeof start.longitude === "number" &&
    Number.isFinite(start.longitude) &&
    start.longitude >= -180 &&
    start.longitude <= 180
  );
}

const server = http.createServer((req, res) => {
  // Handle CORS preflight requests.
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });

    res.end();
    return;
  }

  // Reject requests from unexpected browser origins.
  const origin = req.headers.origin;

  if (origin && origin !== ALLOWED_ORIGIN) {
    sendJson(res, 403, {
      error: "Origin not allowed.",
    });
    return;
  }

  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  );

  // Health check.
  if (
    req.method === "GET" &&
    url.pathname === "/api/health"
  ) {
    sendJson(res, 200, {
      status: "ok",
    });
    return;
  }

  // Route endpoint.
  if (
    req.method !== "POST" ||
    url.pathname !== "/api/route"
  ) {
    sendJson(res, 404, {
      error: "Not found.",
    });
    return;
  }

  let body = "";
  let bodyTooLarge = false;

  req.on("data", (chunk: Buffer) => {
    if (bodyTooLarge) {
      return;
    }

    body += chunk.toString("utf8");

    if (Buffer.byteLength(body, "utf8") > MAX_BODY_SIZE) {
      bodyTooLarge = true;
      body = "";
    }
  });

  req.on("end", async () => {
    if (bodyTooLarge) {
      sendJson(res, 413, {
        error: "Request body too large.",
      });
      return;
    }

    let data: unknown;

    try {
      data = JSON.parse(body);
    } catch {
      sendJson(res, 400, {
        error: "Request body must be valid JSON.",
      });
      return;
    }

    if (!isValidRouteRequest(data)) {
      sendJson(res, 400, {
        error:
          "Provide valid start coordinates and a distance between 1 and 100 km.",
      });
      return;
    }

    try {
      console.log(
        `Generating ${data.distance} km route from`,
        data.start
      );

      const route = await generateLoop(
        data.start,
        data.distance
      );

      console.log(
        `Route generated: ${route.distance.toFixed(2)} km`
      );

      sendJson(res, 200, route);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.";

      console.error("Route generation failed:", message);

      sendJson(res, 502, {
        error: message,
      });
    }
  });

  req.on("error", (error) => {
    console.error("Request error:", error);
  });
});

server.listen(PORT, () => {
  console.log(
    `Route server running at http://localhost:${PORT}`
  );
});
