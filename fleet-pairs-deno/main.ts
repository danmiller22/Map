import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { matchTrailersToNearestTruck } from "./lib/matching.ts";
import { fetchSamsaraVehicles } from "./lib/samsara.ts";
import { fetchSkybitzPositions } from "./lib/skybitz.ts";

type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };
type Pair = {
  trailerId: string;
  truckId: string | null;
  distanceMiles: number | null;
  trailer: Trailer;
  truck: Truck | null;
};

function extnameLocal(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

const kv = await Deno.openKv();

const YARD_LAT = Number(Deno.env.get("YARD_LAT") ?? "41.43063");
const YARD_LON = Number(Deno.env.get("YARD_LON") ?? "-88.19651");
const YARD_RADIUS_MI = Number(Deno.env.get("YARD_RADIUS_MI") ?? "0.5");

async function computeAndPersistPairs() {
  const [trucks, trailers] = await Promise.all([
    fetchSamsaraVehicles(),
    fetchSkybitzPositions(),
  ]);

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

  return pairs as Pair[];
}

// Deno Deploy Cron (every 10 minutes)
try {
  (Deno as any).cron?.("compute pairs", "*/10 * * * *", async () => {
    await computeAndPersistPairs();
  });
} catch {}

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
    if (!val.value) await computeAndPersistPairs();
    const latest = await kv.get(["pairs", "current"]);
    return new Response(JSON.stringify(latest.value ?? {}), {
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname.startsWith("/static/")) {
    const filePath = "." + pathname;
    try {
      const file = await Deno.readFile(filePath);
      const ext = extnameLocal(filePath);
      const type = ext === ".js"
        ? "application/javascript"
        : ext === ".css"
        ? "text/css"
        : ext === ".html"
        ? "text/html; charset=utf-8"
        : "application/octet-stream";
      return new Response(file, { headers: { "content-type": type } });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  try {
    const file = await Deno.readFile("./static/index.html");
    return new Response(file, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch {
    return new Response("Missing index.html", { status: 500 });
  }
});
