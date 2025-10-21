import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { matchTrailersToNearestTruck } from "./lib/matching.ts";
import { fetchSamsaraVehicles } from "./lib/samsara.ts";
import { fetchSkybitzPositions } from "./lib/skybitz.ts";

type LatLon = { lat: number; lon: number };
type Truck = { id: string; position?: LatLon; lastSeen?: string };
type Trailer = { id: string; position?: LatLon; lastSeen?: string };

function extnameLocal(p: string): string {
  const i = p.lastIndexOf(".");
  return i >= 0 ? p.slice(i).toLowerCase() : "";
}

const kv = await Deno.openKv();

const YARD_LAT = Number(Deno.env.get("YARD_LAT") ?? "41.43063");
const YARD_LON = Number(Deno.env.get("YARD_LON") ?? "-88.19651");
const YARD_RADIUS_MI = Number(Deno.env.get("YARD_RADIUS_MI") ?? "0.5");

async function computeAndPersistPairs() {
  const [trucks, trailers] = await Promise.all([
    fetchSamsaraVehicles(),
    fetchSkybitzPositions(),
  ]);
  await kv.set(["latest", "trucks"], trucks);
  await kv.set(["latest", "trailers"], trailers);
  const pairs = matchTrailersToNearestTruck({
    trucks,
    trailers,
    yard: { lat: YARD_LAT, lon: YARD_LON, radiusMi: YARD_RADIUS_MI },
  });
  await kv.set(["pairs", "current"], { pairs, updatedAt: new Date().toISOString() });
  return pairs;
}

// Deploy cron
try {
  (Deno as any).cron?.("compute pairs", "*/10 * * * *", async () => {
    await computeAndPersistPairs();
  });
} catch {}

const FALLBACK_HTML = `<!doctype html><html><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fleet Pairs</title>
<link href="https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css" rel="stylesheet"/>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Inter,Arial,sans-serif}
.app{display:grid;grid-template-columns:360px 1fr;height:100vh}
.sidebar{border-right:1px solid #eee;padding:16px;display:flex;gap:12px;flex-direction:column}
.sidebar header{display:flex;justify-content:space-between;align-items:center}
.sidebar h1{margin:0;font-size:18px;font-weight:600}
.sidebar button{background:#111;color:#fff;border:0;padding:8px 12px;border-radius:12px;font-weight:600;cursor:pointer}
#pairs{list-style:none;margin:0;padding:0;overflow:auto;flex:1}
.pair{padding:10px 8px;border-radius:14px;border:1px solid #f0f0f0;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:6px}
.pair .title{font-weight:600}.pair .meta{font-size:12px;color:#555}#map{width:100%;height:100%}
</style></head><body>
<div class="app"><aside class="sidebar"><header><h1>Pairs</h1><button id="refresh">Refresh</button></header><ul id="pairs"></ul></aside><main id="map"></main></div>
<script src="https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js"></script>
<script>
const map=new maplibregl.Map({container:"map",style:"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",center:[-88.19651,41.43063],zoom:8});
const triangleSVG=encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><polygon points="12,3 21,21 3,21"/></svg>');
const squareSVG=encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="3" y="3" width="18" height="18"/></svg>');
map.on("load",async()=>{map.loadImage("data:image/svg+xml;utf8,"+triangleSVG,(e,i)=>{if(!e&&!map.hasImage("truck"))map.addImage("truck",i)});map.loadImage("data:image/svg+xml;utf8,"+squareSVG,(e,i)=>{if(!e&&!map.hasImage("trailer"))map.addImage("trailer",i)});await refresh();});
document.getElementById("refresh").addEventListener("click",refresh);
async function refresh(){const r=await fetch("/api/pairs");const d=await r.json();const pairs=d?.pairs??[];
const trucks=[],trailers=[],lines=[];for(const p of pairs){const tr=p.trailer;if(tr?.position){trailers.push({type:"Feature",geometry:{type:"Point",coordinates:[tr.position.lon,tr.position.lat]},properties:{id:tr.id,label:"TR "+tr.id}})}
if(p.truck?.position){trucks.push({type:"Feature",geometry:{type:"Point",coordinates:[p.truck.position.lon,p.truck.position.lat]},properties:{id:p.truck.id,label:"TK "+p.truck.id}});
if(tr?.position){lines.push({type:"Feature",geometry:{type:"LineString",coordinates:[[p.truck.position.lon,p.truck.position.lat],[tr.position.lon,tr.position.lat]]},properties:{id:tr.id+"-"+p.truck.id,distance:p.distanceMiles}})}}
}
setOrUpdate("trucks",{type:"FeatureCollection",features:trucks},"truck");
setOrUpdate("trailers",{type:"FeatureCollection",features:trailers},"trailer");
setOrUpdateLine("pair-lines",{type:"FeatureCollection",features:lines});
const list=document.getElementById("pairs");list.innerHTML="";for(const p of pairs){const li=document.createElement("li");li.className="pair";
const t=document.createElement("div");t.className="title";t.textContent=p.truck?`Trailer ${p.trailerId} ▸ Truck ${p.truckId}`:`Trailer ${p.trailerId} ▸ ${p.status||"no_truck_available"}`;
const m=document.createElement("div");m.className="meta";m.textContent=p.distanceMiles!=null?`${p.distanceMiles} mi`:"";li.appendChild(t);li.appendChild(m);
li.addEventListener("click",()=>{if(p.truck?.position&&p.trailer?.position){const b=new maplibregl.LngLatBounds();b.extend([p.truck.position.lon,p.truck.position.lat]);b.extend([p.trailer.position.lon,p.trailer.position.lat]);map.fitBounds(b,{padding:60,maxZoom:12});}
else if(p.trailer?.position){map.flyTo({center:[p.trailer.position.lon,p.trailer.position.lat],zoom:12});}});list.appendChild(li);} }
function setOrUpdate(id,data,img){if(map.getSource(id)){map.getSource(id).setData(data)}else{map.addSource(id,{type:"geojson",data});map.addLayer({id,type:"symbol",source:id,layout:{"icon-image":img,"icon-size":1,"icon-allow-overlap":true,"text-field":["get","label"],"text-offset":[0,1.2],"text-size":10,"text-anchor":"top"}})}}
function setOrUpdateLine(id,data){if(map.getSource(id)){map.getSource(id).setData(data)}else{map.addSource(id,{type:"geojson",data});map.addLayer({id,type:"line",source:id,paint:{"line-width":2}})}}
setInterval(refresh,90000);
</script></body></html>`;

serve(async (req) => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname === "/api/health") {
    const val = await kv.get(["pairs", "current"]);
    return new Response(JSON.stringify({ ok: true, havePairs: !!val.value }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (pathname === "/api/pairs") {
    const val = await kv.get(["pairs", "current"]);
    if (!val.value) await computeAndPersistPairs();
    const latest = await kv.get(["pairs", "current"]);
    return new Response(JSON.stringify(latest.value ?? {}), {
      headers: { "content-type": "application/json" },
    });
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
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  if (pathname === "/debug/ls") {
    const cwd = Deno.cwd();
    const list = async (p: string) => {
      try { const arr: string[] = []; for await (const e of Deno.readDir(p)) arr.push((e.isDirectory?"[D] ":"[F] ")+e.name); return arr; }
      catch { return ["<unreadable>"]; }
    };
    const root = await list(".");
    const staticDir = await list("./static");
    return new Response(JSON.stringify({ cwd, root, staticDir }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // root: try file, else inline fallback
  try {
    const file = await Deno.readFile("./static/index.html");
    return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch {
    return new Response(FALLBACK_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
});
