// Minimal Samsara fetcher: current vehicle locations
type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };

export async function fetchSamsaraVehicles(): Promise<Truck[]> {
  const token = Deno.env.get("SAMSARA_TOKEN");
  if (!token) return [];
  try {
    // Docs: https://developers.samsara.com/
    // Example endpoint: /fleet/vehicles/locations
    const resp = await fetch("https://api.samsara.com/fleet/vehicles/locations", {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    // Normalize to Truck[]
    const out: Truck[] = (data?.data ?? []).map((v: any) => ({
      id: String(v.id ?? v.vehicleId ?? v.externalIds?.vin ?? v.name ?? crypto.randomUUID()),
      position: v?.location
        ? { lat: Number(v.location.latitude), lon: Number(v.location.longitude) }
        : undefined,
      lastSeen: v?.location?.time ? new Date(v.location.time).toISOString() : undefined,
    }));
    return out;
  } catch (_) {
    return [];
  }
}
