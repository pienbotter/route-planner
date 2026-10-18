
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
    "Vary": "Origin",
  });

  res.end(JSON.stringify(data));
}

function isValidRouteRequest(
  value: unknown
): value is RouteRequest {
  if (typeof value !== "object" || value === null) {
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

function readRequestBody(
  req: http.IncomingMessage
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bodySize = 0;
    let tooLarge = false;

    req.setEncoding("utf8");

    req.on("data", (chunk: string) => {
      bodySize += Buffer.byteLength(chunk);

      if (bodySize > MAX_BODY_SIZE) {
        tooLarge = true;
        return;
      }

      body += chunk;
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("Request body is too large."));
        return;
      }

      resolve(body);
    });

    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    });

    res.end();
    return;
  }

  const requestUrl = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`
  );

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/health"
  ) {
    sendJson(res, 200, { status: "ok" });
    return;
  }

  if (
    req.method !== "POST" ||
    requestUrl.pathname !== "/api/route"
  ) {
    sendJson(res, 404, {
      error: "Endpoint not found.",
    });
    return;
  }

  try {
    const body = await readRequestBody(req);

    let data: unknown;

    try {
      data = JSON.parse(body);
    } catch {
      sendJson(res, 400, {
        error: "Request body must contain valid JSON.",
      });
      return;
    }

    if (!isValidRouteRequest(data)) {
      sendJson(res, 400, {
        error:
          "Provide a valid starting location and a distance " +
          "between 1 and 100 km.",
      });
      return;
    }

    const result = await generateLoop(
      data.start,
      data.distance
    );

    console.log(
      `Generated ${result.routes.length} route option(s) ` +
        `for a ${data.distance.toFixed(2)} km target.`
    );

    sendJson(res, 200, result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An unexpected server error occurred.";

    console.error("Route request failed:", error);

    sendJson(res, 502, {
      error: message,
    });
  }
});

server.listen(PORT, () => {
  console.log(`Route server listening on http://localhost:${PORT}`);
});
