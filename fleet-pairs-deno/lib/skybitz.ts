type LatLon = { lat: number; lon: number };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };

export async function fetchSkybitzPositions(): Promise<Trailer[]> {
  const customer = Deno.env.get("SKYBITZ_USERNAME");
  const password = Deno.env.get("SKYBITZ_PASSWORD");
  if (!customer || !password) return [];

  // Most recent position of ALL assets, JSON, v2.76 (Legacy auth via query)
  // Spec: QueryPositions?assetid=ALL&customer=...&password=...&version=2.76&getJson=1
  // If from/to опущены — вернётся самый свежий позиционный отчёт. :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
  const url = new URL("https://xml.skybitz.com/QueryPositions");
  url.searchParams.set("assetid", "ALL");
  url.searchParams.set("customer", customer);
  url.searchParams.set("password", password);
  url.searchParams.set("version", "2.76");
  url.searchParams.set("getJson", "1");

  try {
    const resp = await fetch(url.toString(), {
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) {
      console.error("[skybitz] http", resp.status, await safeText(resp));
      return [];
    }
    const data = await resp.json();

    // Возможные формы: {skybitz:{error:0, gls:[...]}} или плоские списки. :contentReference[oaicite:4]{index=4}
    const error = data?.skybitz?.error ?? 0;
    if (error && Number(error) !== 0) {
      console.error("[skybitz] api error:", error);
      return [];
    }

    const rows =
      data?.skybitz?.gls ?? // частый вариант
      data?.positions ??
      data?.PositionList ??
      data?.gls ??
      [];

    const out: Trailer[] = (Array.isArray(rows) ? rows : [rows])
      .map((p: any) => {
        const lat =
          p?.lastlatitude ?? p?.latitude ?? p?.Latitude ?? p?.["latitude-iso6709"];
        const lon =
          p?.lastlongitude ?? p?.longitude ?? p?.Longitude ?? p?.["longitude-iso6709"];
        const ts = p?.lastreporttime ?? p?.time ?? p?.timestamp;
        const id = p?.assetid ?? p?.AssetID ?? p?.asset ?? p?.id;
        return {
          id: String(id ?? crypto.randomUUID()),
          position: lat != null && lon != null
            ? { lat: Number(lat), lon: Number(lon) }
            : undefined,
          lastSeen: ts ? new Date(ts).toISOString() : undefined,
        };
      })
      .filter((t: Trailer) => !!t.position);

    console.log("[skybitz] parsed trailers:", out.length);
    return out;
  } catch (e) {
    console.error("[skybitz] fetch failed", String(e));
    return [];
  }
}

async function safeText(r: Response) {
  try { return await r.text(); } catch { return "<no-body>"; }
}
