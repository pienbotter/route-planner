import http from "node:http";
import polyline from "@mapbox/polyline";

const PORT = 3000;
const VALHALLA_URL = "https://valhalla1.openstreetmap.de/route";

interface Location {
  latitude: number;
  longitude: number;
}

interface RouteRequest {
  start: Location;
  destination: Location;
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown
) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  res.end(JSON.stringify(data));
}


async function getRoute(request: RouteRequest) {
  const valhallaRequest = {
    locations: [
      {
        lat: request.start.latitude,
        lon: request.start.longitude,
      },
      {
        lat: request.destination.latitude,
        lon: request.destination.longitude,
      },
    ],
    costing: "pedestrian",
    units: "kilometers",
  };

  const response = await fetch(VALHALLA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(valhallaRequest),
  });

  if (!response.ok) {
    throw new Error(
      `Valhalla returned HTTP ${response.status}`
    );
  }

  const data = await response.json();

  const shape = data.trip.legs[0].shape;

  const coordinates = polyline
    .decode(shape, 6)
    .map(([latitude, longitude]) => [
      longitude,
      latitude,
    ]);

  return {
    distance: data.trip.summary.length,
    time: data.trip.summary.time,
    coordinates,
  };
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });

    res.end();

    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      status: "ok",
    });

    return;
  }

  if (req.method === "POST" && req.url === "/api/route") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const data = JSON.parse(body) as RouteRequest;

        console.log("Route request received:", data);

        const route = await getRoute(data);

        sendJson(res, 200, route);
      } catch (error) {
        console.error(error);

        sendJson(res, 500, {
          error: "Failed to generate route",
        });
      }
    });

    return;
  }

  sendJson(res, 404, {
    error: "Not found",
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});