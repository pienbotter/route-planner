import http from "node:http";
import {
  generateLoop,
} from "./routing/routeGenerator";

const PORT = 3000;

interface Location {
  latitude: number;
  longitude: number;
}

interface RouteRequest {
  start: Location;
  distance: number;
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

        const route = await generateLoop(
        data.start,
        data.distance
        );

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