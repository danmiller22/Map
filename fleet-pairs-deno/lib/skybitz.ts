// lib/skybitz.ts
type LatLon = { lat: number; lon: number };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };

const BASE = "https://xml.skybitz.com/QueryPositions";
const VERSION = "2.76";

export async function fetchSkybitzPositions(): Promise<Trailer[]> {
  const customer = Deno.env.get("SKYBITZ_USERNAME");
  const password = Deno.env.get("SKYBITZ_PASSWORD");
  if (!customer || !password) return [];

  // 3 попытки: JSON(getJson), JSON(GetJSON), XML
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt === 0) {
        const u = new URL(BASE);
        u.searchParams.set("assetid", "ALL");
        u.searchParams.set("customer", customer);
        u.searchParams.set("password", password);
        u.searchParams.set("version", VERSION);
        u.searchParams.set("getJson", "1");
        const r = await fetch(u.toString(), {
          headers: {
            "Accept": "application/json",
            "Authorization": "Basic " + btoa(`${customer}:${password}`),
          },
        });
        const arr = await parseJson(await expectOkJson(r));
        if (arr.length) return arr;
      } else if (attempt === 1) {
        const u = new URL(BASE);
        u.searchParams.set("assetid", "ALL");
        u.searchParams.set("customer", customer);
        u.searchParams.set("password", password);
        u.searchParams.set("version", VERSION);
        u.searchParams.set("GetJSON", "1");
        const r = await fetch(u.toString(), {
          headers: {
            "Accept": "application/json",
            "Authorization": "Basic " + btoa(`${customer}:${password}`),
          },
        });
        const arr = await parseJson(await expectOkJson(r));
        if (arr.length) return arr;
      } else {
        const u = new URL(BASE);
        u.searchParams.set("assetid", "ALL");
        u.searchParams.set("customer", customer);
        u.searchParams.set("password", password);
        u.searchParams.set("version", VERSION);
        const r = await fetch(u.toString(), {
          headers: {
            "Accept": "application/xml,text/xml",
            "Authorization": "Basic " + btoa(`${customer}:${password}`),
          },
        });
        const xml = await expectOkText(r);
        const arr = parseXml(xml);
        if (arr.length) return arr;
      }
    } catch (_) {
      // noop
    }
    await delay(300 * (attempt + 1)); // backoff
  }
  return [];
}

// ---------- helpers ----------
async function expectOkJson(r: Response) {
  if (!r.ok) throw new Error(String(r.status));
  return await r.json();
}
async function expectOkText(r: Response) {
  if (!r.ok) throw new Error(String(r.status));
  return await r.text();
}
function delay(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function parseJson(data: any): Trailer[] {
  const rows =
    data?.skybitz?.gls ??
    data?.positions ??
    data?.PositionList ??
    data?.gls ??
    (Array.isArray(data) ? data : []);

  const toNum = (x: any) => (x == null ? null : Number(x));
  const out: Trailer[] = (Array.isArray(rows) ? rows : [rows]).map((p: any) => {
    const lat = toNum(p?.lastlatitude ?? p?.latitude ?? p?.Latitude ?? p?.["latitude-iso6709"]);
    const lon = toNum(p?.lastlongitude ?? p?.longitude ?? p?.Longitude ?? p?.["longitude-iso6709"]);
    const ts  = p?.lastreporttime ?? p?.time ?? p?.timestamp ?? p?.Time;
    const id  = p?.assetid ?? p?.AssetID ?? p?.asset ?? p?.id ?? p?.Name;
    return {
      id: String(id ?? crypto.randomUUID()),
      position: lat != null && lon != null ? { lat, lon } : undefined,
      lastSeen: ts ? new Date(ts).toISOString() : undefined,
    };
  }).filter((t: Trailer) => !!t.position);

  return out;
}

// очень простой XML-парсер без зависимостей
function parseXml(xml: string): Trailer[] {
  const items: Trailer[] = [];
  const re = /<(?:gl|position)\b[^>]*>([\s\S]*?)<\/(?:gl|position)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const pick = (names: string[]) => {
      for (const n of names) {
        const rx = new RegExp(`<${n}[^>]*>([\\s\\S]*?)<\\/${n}>`, "i");
        const mm = rx.exec(block);
        if (mm) return mm[1].trim();
      }
      return null;
    };
    const lat = Number(pick(["lastlatitude","latitude","Latitude"]) ?? NaN);
    const lon = Number(pick(["lastlongitude","longitude","Longitude"]) ?? NaN);
    const id  = pick(["assetid","AssetID","asset","id","Name"]) ?? crypto.randomUUID();
    const ts  = pick(["lastreporttime","time","timestamp","Time"]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      items.push({
        id: String(id),
        position: { lat, lon },
        lastSeen: ts ? new Date(ts).toISOString() : undefined,
      });
    }
  }
  return items;
}
