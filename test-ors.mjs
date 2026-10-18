
import "dotenv/config";

const apiKey = process.env.GRAPHHOPPER_API_KEY;

if (!apiKey) {
  console.error("GRAPHHOPPER_API_KEY is missing. Check your .env file.");
  process.exit(1);
}

const url = new URL("https://graphhopper.com/api/1/route");

url.searchParams.append("point", "52.27473,5.17294");
url.searchParams.append("point", "52.28,5.18");
url.searchParams.set("profile", "foot");
url.searchParams.set("key", apiKey);

try {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
  });

  const text = await response.text();

  console.log("HTTP status:", response.status);

  if (!response.ok) {
    console.error("GraphHopper returned an error:", text.slice(0, 500));
    process.exit(1);
  }

  const data = JSON.parse(text);

  console.log(
    "Route distance (km):",
    (data.paths[0].distance / 1000).toFixed(2)
  );
  console.log("GraphHopper connection and API key look good!");
} catch (error) {
  console.error("Request failed:", error.message);
}
