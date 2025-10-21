type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };

export async function fetchSamsaraVehicles(): Promise<Truck[]> {
  const token = Deno.env.get("SAMSARA_TOKEN");
  if (!token) return [];

  const url = new URL("https://api.samsara.com/fleet/vehicles/locations");
  url.searchParams.set("limit", "500");

  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!resp.ok) return [];

    const data = await resp.json();
    const rows: any[] = Array.isArray(data?.data) ? data.data : [];

    const out: Truck[] = rows
      .map((v) => {
        const loc = v?.location ?? v?.lastKnownLocation ?? v?.gps ?? {};
        const lat = loc.latitude ?? loc.lat ?? loc.coord?.lat;
        const lon = loc.longitude ?? loc.lon ?? loc.coord?.lon;
        const t = loc.time ?? loc.timeMs ?? loc.timestamp;

        // кандидаты имени/номера
        const cands = [
          v?.name,
          v?.vehicleNumber,
          v?.externalIds?.vehicleNumber,
          v?.externalIds?.unitNumber,
          v?.externalIds?.fleetNumber,
          v?.vin,
          v?.id,
          v?.vehicleId,
        ].map((x) => (x == null ? "" : String(x)));

        const short = pickShortDigits(cands) ?? "UNK";

        return {
          id: short, // 3–4 цифры
          position:
            lat != null && lon != null
              ? { lat: Number(lat), lon: Number(lon) }
              : undefined,
          lastSeen: t ? new Date(Number.isFinite(t) ? Number(t) : t).toISOString() : undefined,
        };
      })
      .filter((x) => x.position);

    return out;
  } catch {
    return [];
  }
}

function pickShortDigits(arr: string[]): string | null {
  // приоритет: последние 4 цифры, иначе последние 3
  for (const s of arr) {
    const m4 = s.match(/(\d{4})(?!\d)/);
    if (m4) return m4[1];
  }
  for (const s of arr) {
    const m3 = s.match(/(\b\d{3}\b)(?!\d)/);
    if (m3) return m3[1];
  }
  return null;
}
