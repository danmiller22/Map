import { haversineMiles } from "./haversine.ts";

type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };

export function matchTrailersToNearestTruck(args: {
  trucks: Truck[];
  trailers: Trailer[];
  yard: { lat: number; lon: number; radiusMi: number };
}) {
  const { trucks, trailers, yard } = args;

  // Helper to check yard geofence
  const inYard = (p?: LatLon) => {
    if (!p) return false;
    return haversineMiles(p, yard) <= yard.radiusMi;
  };

  const pairs = trailers.map((tr) => {
    if (!tr.position) {
      return {
        trailerId: tr.id,
        truckId: null,
        distanceMiles: null,
        trailer: tr,
        truck: null,
        status: "unknown_trailer_position",
      };
    }

    // Yard solo exception
    if (inYard(tr.position)) {
      return {
        trailerId: tr.id,
        truckId: null,
        distanceMiles: 0,
        trailer: tr,
        truck: null,
        status: "yard_solo",
      };
    }

    // Find nearest truck
    let bestTruck: Truck | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const tk of trucks) {
      if (!tk.position) continue;
      const d = haversineMiles(tr.position, tk.position);
      if (d < bestDist) {
        bestDist = d;
        bestTruck = tk;
      }
    }

    if (!bestTruck) {
      return {
        trailerId: tr.id,
        truckId: null,
        distanceMiles: null,
        trailer: tr,
        truck: null,
        status: "no_truck_available",
      };
    }

    return {
      trailerId: tr.id,
      truckId: bestTruck.id,
      distanceMiles: Number(bestDist.toFixed(2)),
      trailer: tr,
      truck: bestTruck,
      status: "paired",
    };
  });

  return pairs;
}
