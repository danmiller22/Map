type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };

export async function fetchSamsaraVehicles(): Promise<Truck[]> {
  const token = Deno.env.get("SAMSARA_TOKEN");
  if (!token) return [];

  const url = new URL("https://api.samsara.com/fleet/vehicles/locations");
  url.searchParams.set("limit", "500");

  try {
    const resp = await fetch(url.toString(), {
      headers: { "Authorization": `Bearer ${token}`, "Accept": "application/json" },
    });
    if (!resp.ok) return [];

    const rows: any[] = Array.isArray((await resp.json())?.data) ? (await resp.json()).data : [];

    const out: Truck[] = rows.map((v) => {
      const loc = v?.location ?? v?.lastKnownLocation ?? v?.gps ?? {};
      const lat = loc.latitude ?? loc.lat ?? loc.coord?.lat;
      const lon = loc.longitude ?? loc.lon ?? loc.coord?.lon;
      const t   = loc.time ?? loc.timeMs ?? loc.timestamp;

      // источники имени/номера
      const name =
        v?.name ??
        v?.vehicleNumber ??
        v?.externalIds?.vehicleNumber ??
        v?.externalIds?.unitNumber ??
        v?.externalIds?.fleetNumber ??
        v?.vin ??
        String(v?.id ?? v?.vehicleId ?? "");

      const short = pickShortNumber(name) ?? pickShortNumber(v?.vin) ?? lastDigits(v?.id ?? v?.vehicleId, 4) ?? "UNK";

      return {
        id: short, // используем короткий номер как публичный id
        position: lat != null && lon != null ? { lat: Number(lat), lon: Number(lon) } : undefined,
        lastSeen: t ? new Date(Number.isFinite(t) ? Number(t) : t).toISOString() : undefined,
      };
    }).filter((x) => x.position);

    return out;
  } catch {
    return [];
  }
}

// берём 3–4 подряд идущих цифры из строки (например "TK-1234", "Truck 987")
function pickShortNumber(s: any): string | null {
  if (!s) return null;
  const m = String(s).match(/(\d{4}|\b\d{3}\b)(?!\d)/); // сначала 4, иначе 3
  return m ? m[1] : null;
}

function lastDigits(x: any, n: number): string | null {
  if (!x) return null;
  const m = String(x).match(new RegExp(`(\\d{${n}})(?!\\d)`));
  return m ? m[1] : null;
}
