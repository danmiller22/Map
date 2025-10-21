// SkyBitz / XtraLease legacy XML API with JSON output via getJson=1
type LatLon = { lat: number; lon: number };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };

export async function fetchSkybitzPositions(): Promise<Trailer[]> {
  const username = Deno.env.get("SKYBITZ_USERNAME");
  const password = Deno.env.get("SKYBITZ_PASSWORD");
  if (!username || !password) return [];

  const base = "https://xml.skybitz.com/QueryPositions";
  const params = new URLSearchParams({
    version: "2.76",
    assetid: "ALL",
    getJson: "1"
  });

  const url = `${base}?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      headers: {
        "Authorization": "Basic " + btoa(`${username}:${password}`),
        "Accept": "application/json"
      }
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    // Expected shape: positions array. Adjust mapping as needed per tenant.
    const positions = data?.positions ?? data?.PositionList ?? data ?? [];
    const out: Trailer[] = positions.map((p: any) => ({
      id: String(p?.assetid ?? p?.AssetID ?? p?.id ?? crypto.randomUUID()),
      position: p?.lastlatitude && p?.lastlongitude
        ? { lat: Number(p.lastlatitude), lon: Number(p.lastlongitude) }
        : p?.latitude && p?.longitude
        ? { lat: Number(p.latitude), lon: Number(p.longitude) }
        : undefined,
      lastSeen: p?.lastreporttime
        ? new Date(p.lastreporttime).toISOString()
        : p?.timestamp
        ? new Date(p.timestamp).toISOString()
        : undefined,
    }));
    return out;
  } catch (_) {
    return [];
  }
}
