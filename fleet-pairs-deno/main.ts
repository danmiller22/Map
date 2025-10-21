import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { matchTrailersToNearestTruck } from "./lib/matching.ts";
import { fetchSamsaraVehicles } from "./lib/samsara.ts";
import { fetchSkybitzPositions } from "./lib/skybitz.ts";

type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };
type PairRecord = {
  pairs: Array<{
    trailerId: string;
    truckId: string | null;
    distanceMiles: number | null;
    trailer: Trailer;
    truck: Truck | null;
    status?: string;
  }>;
  updatedAt: string;
};

function extnameLocal(p: string): string { const i = p.lastIndexOf("."); return i >= 0 ? p.slice(i).toLowerCase() : ""; }
function nowISO() { return new Date().toISOString(); }
function minutesAgo(iso: string) { return (Date.now() - new Date(iso).getTime()) / 60000; }

const kv = await Deno.openKv();
const YARD_LAT = Number(Deno.env.get("YARD_LAT") ?? "41.43063");
const YARD_LON = Number(Deno.env.get("YARD_LON") ?? "-88.19651");
const YARD_RADIUS_MI = Number(Deno.env.get("YARD_RADIUS_MI") ?? "0.5");
const STALE_MIN = 15;

async function getLast<T>(key: Deno.KvKey): Promise<T | null> {
  const v = await kv.get<T>(key);
  return (v.value as T) ?? null;
}

async function computeAndPersistPairs(): Promise<PairRecord> {
  try {
    const [newTrucks, newTrailers] = await Promise.all([
      fetchSamsaraVehicles().catch(() => [] as Truck[]),
      fetchSkybitzPositions().catch(() => [] as Trailer[]),
    ]);

    const lastTrucks = await getLast<Truck[]>(["latest", "trucks"]) ?? [];
    const lastTrailers = await getLast<Trailer[]>(["latest", "trailers"]) ?? [];

    // Не затираем, если источник дал пусто
    const trucks = newTrucks.length ? newTrucks : lastTrucks;
    const trailers = newTrailers.length ? newTrailers : lastTrailers;

    // Обновляем KV только если есть смысл
    if (newTrucks.length) await kv.set(["latest", "trucks"], newTrucks);
    if (newTrailers.length) await kv.set(["latest", "trailers"], newTrailers);

    console.log("[pull] trucks:", trucks.length, "trailers:", trailers.length, "(newTks:", newTrucks.length, "newTrs:", newTrailers.length, ")");

    const pairs = matchTrailersToNearestTruck({
      trucks,
      trailers,
      yard: { lat: YARD_LAT, lon: YARD_LON, radiusMi: YARD_RADIUS_MI },
    });

    const rec: PairRecord = { pairs, updatedAt: nowISO() };
    await kv.set(["pairs", "current"], rec);
    console.log("[pairs] built:", pairs.length);
    return rec;
  } catch (e) {
    console.error("[compute] error", String(e));
    const existing = await getLast<PairRecord>(["pairs", "current"]);
    if (existing) return existing;
    const rec: PairRecord = { pairs: [], updatedAt: nowISO() };
    await kv.set(["pairs", "current"], rec);
    return rec;
  }
}

// первичный прогрев
try { await computeAndPersistPairs(); } catch {}

// cron каждые 10 минут
try {
  (Deno as any).cron?.("compute pairs", "*/10 * * * *", async () => { await computeAndPersistPairs(); });
} catch {}

// локальный таймер-страховка
setInterval(() => { computeAndPersistPairs(); }, STALE_MIN * 60 * 1000);

// ---------- HTTP ----------
serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    const pairs = (await kv.get<PairRecord>(["pairs", "current"])).value;
    const trucks = (await kv.get<Truck[]>(["latest", "trucks"])).value ?? [];
    const trailers = (await kv.get<Trailer[]>(["latest", "trailers"])).value ?? [];
    return new Response(JSON.stringify({
      ok: true,
      havePairs: !!pairs,
      updatedAt: pairs?.updatedAt ?? null,
      counts: { trucks: trucks.length, trailers: trailers.length, pairs: pairs?.pairs?.length ?? 0 }
    }), { headers: { "content-type": "application/json" } });
  }

  if (pathname === "/api/pairs") {
    let rec = (await kv.get<PairRecord>(["pairs", "current"])).value;
    if (!rec || minutesAgo(rec.updatedAt) > STALE_MIN) {
      computeAndPersistPairs(); // в фоне
      if (!rec) rec = { pairs: [], updatedAt: nowISO() };
    }
    return new Response(JSON.stringify(rec), { headers: { "content-type": "application/json" } });
  }

  if (pathname.startsWith("/static/")) {
    const fp = "." + pathname;
    try {
      const file = await Deno.readFile(fp);
      const ext = extnameLocal(fp);
      const type = ext === ".js" ? "application/javascript"
        : ext === ".css" ? "text/css"
        : ext === ".html" ? "text/html; charset=utf-8"
        : "application/octet-stream";
      return new Response(file, { headers: { "content-type": type } });
    } catch { return new Response("Not found", { status: 404 }); }
  }

  try {
    const file = await Deno.readFile("./static/index.html");
    return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    // инлайн fallback UI
    const FALLBACK_HTML = `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fleet Pairs</title>
<link href="https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif}
.app{display:grid;grid-template-columns:360px 1fr;height:100vh}
.sidebar{border-right:1px solid #1b1f27;padding:16px;display:flex;gap:12px;flex-direction:column;background:#0f1114;color:#fff;overflow:auto}
#pairs{list-style:none;margin:0;padding:0;flex:1}.pair{padding:10px 8px;border-radius:14px;border:1px solid #232833;margin-bottom:8px;background:#151a22;display:grid;grid-template-columns:1fr auto;gap:6px}
.pair .title{font-weight:600}.pair .meta{font-size:12px;opacity:.7}#map{width:100%;height:100%}
</style></head><body>
<div class="app"><aside class="sidebar"><div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Pairs</h2><button id="refresh">Refresh</button></div><ul id="pairs"></ul></aside><main id="map"></main></div>
<script src="https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js"></script>
<script>
const map=new maplibregl.Map({container:'map',style:'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',center:[-88.19651,41.43063],zoom:8});
const triangleSVG=encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26"><polygon points="13,3 23,23 3,23"/></svg>');
const squareSVG=encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><rect x="3" y="3" width="16" height="16"/></svg>');
map.on('load',()=>{map.loadImage('data:image/svg+xml;utf8,'+triangleSVG,(e,i)=>{if(!e&&!map.hasImage('truck'))map.addImage('truck',i)});map.loadImage('data:image/svg+xml;utf8,'+squareSVG,(e,i)=>{if(!e&&!map.hasImage('trailer'))map.addImage('trailer',i)}); refresh();});
document.getElementById('refresh').addEventListener('click',refresh);
async function refresh(){const r=await fetch('/api/pairs');const d=await r.json();const pairs=d?.pairs??[];const trucks=[],trailers=[],lines=[];
for(const p of pairs){const tr=p.trailer,tk=p.truck;const trId=String(p.trailerId??tr?.id??'');const tkId=p.truckId!=null?String(p.truckId):null;
if(tr?.position){trailers.push(fcPoint([tr.position.lon,tr.position.lat],{id:trId,label:'TR '+trId}));}
if(tk?.position){trucks.push(fcPoint([tk.position.lon,tk.position.lat],{id:tkId??'',label:'TK '+(tkId??'')}));if(tr?.position){lines.push(fcLine([[tk.position.lon,tk.position.lat],[tr.position.lon,tr.position.lat]],{id:trId+'-'+(tkId??''),distance:p.distanceMiles}));}}
p._trId=trId;p._tkId=tkId;}
setOrUpdate('trucks',coll(trucks),'truck');setOrUpdate('trailers',coll(trailers),'trailer');setOrUpdateLine('pair-lines',coll(lines));
const list=document.getElementById('pairs');list.innerHTML='';if(!pairs.length){const li=document.createElement('li');li.className='pair';li.innerHTML='<div class="title">Нет данных</div><div class="meta">Проверьте /api/health</div>';list.appendChild(li);return;}
for(const p of pairs){const li=document.createElement('li');li.className='pair';const t=document.createElement('div');t.className='title';
t.textContent=p.truck?('Trailer '+p._trId+'  ▸  Truck '+p._tkId):('Trailer '+p._trId+'  ▸  '+(p.status||'no_truck_available'));
const m=document.createElement('div');m.className='meta';m.textContent=p.distanceMiles!=null?(p.distanceMiles+' mi'):'';li.appendChild(t);li.appendChild(m);
li.addEventListener('click',()=>{if(p.truck?.position&&p.trailer?.position){const b=new maplibregl.LngLatBounds();b.extend([p.truck.position.lon,p.truck.position.lat]);b.extend([p.trailer.position.lon,p.trailer.position.lat]);map.fitBounds(b,{padding:60,maxZoom:12});}
else if(p.trailer?.position){map.flyTo({center:[p.trailer.position.lon,p.trailer.position.lat],zoom:12});}});list.appendChild(li);} }
function fcPoint(c,p){return{type:'Feature',geometry:{type:'Point',coordinates:c},properties:p||{}}}function fcLine(c,p){return{type:'Feature',geometry:{type:'LineString',coordinates:c},properties:p||{}}}function coll(f){return{type:'FeatureCollection',features:f}}
function setOrUpdate(id,data,img){if(map.getSource(id)){map.getSource(id).setData(data);}else{map.addSource(id,{type:'geojson',data});map.addLayer({id,type:'symbol',source:id,layout:{'icon-image':img,'icon-size':1.1,'icon-allow-overlap':true,'text-field':['get','label'],'text-offset':[0,1.2],'text-size':11,'text-anchor':'top'}});}}
function setOrUpdateLine(id,data){if(map.getSource(id)){map.getSource(id).setData(data);}else{map.addSource(id,{type:'geojson',data});map.addLayer({id,type:'line',source:id,paint:{'line-width':2}});}}
setInterval(refresh,90000);
</script></body></html>`;
    return new Response(FALLBACK_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
});
