// Робастный маппинг Samsara /fleet/vehicles/locations
type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };

export async function fetchSamsaraVehicles(): Promise<Truck[]> {
  const token = Deno.env.get("SAMSARA_TOKEN");
  if (!token) return [];

  const url = new URL("https://api.samsara.com/fleet/vehicles/locations");
  // повысим шанс полного списка
  url.searchParams.set("limit", "500");

  try {
    const resp = await fetch(url.toString(), {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json",
      },
    });
    if (!resp.ok) {
      console.error("[samsara] http", resp.status);
      return [];
    }
    const j = await resp.json();
    const rows = Array.isArray(j?.data) ? j.data : [];

    const out: Truck[] = rows.map((v: any) => {
      const loc = v?.location ?? v?.lastKnownLocation ?? v?.gps ?? {};
      // поддержка разных схем времени
      const t = loc.time ?? loc.timeMs ?? loc.timestamp ?? null;
      // разные поля ID
      const id =
        v?.id ??
        v?.vehicleId ??
        v?.externalIds?.vin ??
        v?.vin ??
        v?.name ??
        crypto.randomUUID();

      const lat = loc.latitude ?? loc.lat ?? loc.coord?.lat;
      const lon = loc.longitude ?? loc.lon ?? loc.coord?.lon;

      return {
        id: String(id),
        position:
          lat != null && lon != null
            ? { lat: Number(lat), lon: Number(lon) }
            : undefined,
        lastSeen: t ? new Date(Number.isFinite(t) ? Number(t) : t).toISOString() : undefined,
      };
    });

    // Отфильтруем без координат
    const havePos = out.filter((x) => x.position);
    if (havePos.length === 0) {
      console.warn("[samsara] no positions parsed; sample:", JSON.stringify(rows[0] ?? {}));
    }
    return havePos;
  } catch (e) {
    console.error("[samsara] fetch failed", String(e));
    return [];
  }
}
