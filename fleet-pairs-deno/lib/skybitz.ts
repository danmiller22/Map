// lib/skybitz.ts
type LatLon = { lat: number; lon: number };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };

const BASE = "https://xml.skybitz.com/QueryPositions";
const VERSION = "2.76"; // см. спецификацию

export async function fetchSkybitzPositions(): Promise<Trailer[]> {
  const customer = Deno.env.get("SKYBITZ_USERNAME");
  const password = Deno.env.get("SKYBITZ_PASSWORD");
  if (!customer || !password) return [];

  // Формируем URL строго по спецификации: assetid=ALL + getJson=1
  const url = new URL(BASE);
  url.searchParams.set("assetid", "ALL");
  url.searchParams.set("customer", customer);
  url.searchParams.set("password", password);
  url.searchParams.set("version", VERSION);
  url.searchParams.set("getJson", "1"); // JSON-ответ, как указано в доке

  // 3 попытки с бэкоффом
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url.toString(), {
        // Без Authorization. Для "Legacy" пути нужны именно query-параметры. 
        headers: { "Accept": "application/json" },
      });
      const j = await r.json();

      // Ожидаем структуру skybitz.gls (список последних позиций всех активов). 
      if (j?.skybitz?.error && Number(j.skybitz.error) !== 0) {
        console.error("[skybitz] error code:", j.skybitz.error);
        throw new Error("skybitz error");
      }

      const rows = Array.isArray(j?.skybitz?.gls) ? j.skybitz.gls : (j?.gls ?? []);
      const list: Trailer[] = (Array.isArray(rows) ? rows : [rows]).map((p: any) => {
        // Нормализация полей разных прошивок
        const lat = num(p?.lastlatitude ?? p?.latitude ?? p?.Latitude);
        const lon = num(p?.lastlongitude ?? p?.longitude ?? p?.Longitude);
        const id  = str(p?.asset?.assetid ?? p?.assetid ?? p?.AssetID ?? p?.asset ?? p?.id);
        const ts  = p?.lastreporttime ?? p?.time ?? p?.timestamp ?? p?.Time;

        return {
          id: id || crypto.randomUUID(),
          position: lat != null && lon != null ? { lat, lon } : undefined,
          lastSeen: ts ? new Date(ts).toISOString() : undefined,
        };
      }).filter((t) => !!t.position);

      if (list.length === 0) {
        // Логируем кусок ответа, чтобы видеть реальную схему, но не падаем
        console.warn("[skybitz] empty list; sample:", JSON.stringify(j?.skybitz ?? j)?.slice(0, 500));
      }
      return list;
    } catch (e) {
      console.error(`[skybitz] attempt ${i + 1} failed`, String(e));
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
  }
  return [];
}

function num(x: any): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function str(x: any): string {
  return x == null ? "" : String(x);
}
