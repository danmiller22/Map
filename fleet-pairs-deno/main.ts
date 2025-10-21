import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { parse } from "https://deno.land/std@0.224.0/path/posix.ts";
import { matchTrailersToNearestTruck } from "./lib/matching.ts";
import { fetchSamsaraVehicles } from "./lib/samsara.ts";
import { fetchSkybitzPositions } from "./lib/skybitz.ts";

type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };
type Pair = {
  trailerId: string;
  truckId: string | null; // null means yard-solo or no truck available
  distanceMiles: number | null;
  trailer: Trailer;
  truck: Truck | null;
};

const kv = await Deno.openKv();

const YARD_LAT = Number(Deno.env.get("YARD_LAT") ?? "41.43063");
const YARD_LON = Number(Deno.env.get("YARD_LON") ?? "-88.19651");
const YARD_RADIUS_MI = Number(Deno.env.get("YARD_RADIUS_MI") ?? "0.5");

async function computeAndPersistPairs() {
  // Fetch latest positions
  const [trucks, trailers] = await Promise.all([
    fetchSamsaraVehicles(),
    fetchSkybitzPositions(),
  ]);

  // Simple persistence for debugging
  await kv.set(["latest", "trucks"], trucks);
  await kv.set(["latest", "trailers"], trailers);

  const pairs = matchTrailersToNearestTruck({
    trucks,
    trailers,
    yard: { lat: YARD_LAT, lon: YARD_LON, radiusMi: YARD_RADIUS_MI },
  });

  await kv.set(["pairs", "current"], {
    pairs,
    updatedAt: new Date().toISOString(),
  });
  return pairs;
}

// Scheduled handler for Deno Deploy cron
self.addEventListener("scheduled", (event: any) => {
  event.waitUntil(computeAndPersistPairs());
});

// HTTP server
serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    const val = await kv.get(["pairs", "current"]);
    return new Response(JSON.stringify({ ok: true, havePairs: !!val.value }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/pairs") {
    const val = await kv.get(["pairs", "current"]);
    if (!val.value) {
      // Attempt on-demand compute if empty
      await computeAndPersistPairs();
    }
    const latest = await kv.get(["pairs", "current"]);
    return new Response(JSON.stringify(latest.value ?? {}), {
      headers: { "content-type": "application/json" },
    });
  }

  // Static files
  if (pathname.startsWith("/static/")) {
    const filePath = "." + pathname;
    try {
      const file = await Deno.readFile(filePath);
      const ext = parse(filePath).ext.toLowerCase();
      const type = ext === ".js"
        ? "application/javascript"
        : ext === ".css"
        ? "text/css"
        : "application/octet-stream";
      return new Response(file, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  // Root -> index.html
  try {
    const file = await Deno.readFile("./static/index.html");
    return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    return new Response("Missing index.html", { status: 500 });
  }
});
