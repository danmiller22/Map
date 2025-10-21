const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-88.19651, 41.43063],
  zoom: 8
});
map.dragPan.enable(); map.scrollZoom.enable(); map.keyboard.enable(); map.doubleClickZoom.enable();

// SVG для маркеров
const SVG_TRUCK = `
<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 28 28">
  <polygon points="14,3 25,25 3,25" fill="#111" stroke="#fff" stroke-width="2"/>
</svg>`;
const SVG_TRAILER = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
  <rect x="3" y="3" width="18" height="18" fill="#111" stroke="#fff" stroke-width="2"/>
</svg>`;

// пул маркеров
let truckMarkers = [];
let trailerMarkers = [];

map.on('load', async () => { await refresh(); });
document.getElementById('refresh').addEventListener('click', refresh);

async function refresh() {
  const res = await fetch('/api/pairs', { cache: 'no-store' });
  const data = await res.json();
  const pairs = data?.pairs ?? [];

  // подготовим гео
  const lines = [], labelsTk = [], labelsTr = [], tPts = [], trPts = [];
  for (const p of pairs) {
    const tr = p.trailer, tk = p.truck;
    const trId = String(p.trailerId ?? tr?.id ?? '');
    const tkId = p.truckId != null ? String(p.truckId) : null;

    if (tr?.position) {
      const c = [tr.position.lon, tr.position.lat];
      trPts.push(c);
      labelsTr.push(point(c, { label: `TR ${trId}` }));
    }
    if (tk?.position) {
      const c = [tk.position.lon, tk.position.lat];
      tPts.push(c);
      labelsTk.push(point(c, { label: `TK ${tkId ?? ''}` }));
      if (tr?.position) lines.push(line([c, [tr.position.lon, tr.position.lat]]));
    }
  }

  // линии + подписи (оставляем слоями)
  setOrUpdateGeo('pair-lines', coll(lines));
  addOrUpdateLayer('pair-lines-layer', { type: 'line', source: 'pair-lines', paint: { 'line-width': 2 }});

  setOrUpdateGeo('trucks-labels', coll(labelsTk));
  setOrUpdateGeo('trailers-labels', coll(labelsTr));
  addOrUpdateLayer('trucks-labels-layer', { type: 'symbol', source: 'trucks-labels',
    layout: { 'text-field': ['get','label'], 'text-offset': [0, 1.2], 'text-size': 12, 'text-anchor': 'top',
              'text-allow-overlap': true, 'text-ignore-placement': true }});
  addOrUpdateLayer('trailers-labels-layer', { type: 'symbol', source: 'trailers-labels',
    layout: { 'text-field': ['get','label'], 'text-offset': [0, 1.2], 'text-size': 12, 'text-anchor': 'top',
              'text-allow-overlap': true, 'text-ignore-placement': true }});

  // иконки рисуем HTML-маркерами (железно видно)
  renderMarkers(truckMarkers, tPts, SVG_TRUCK);
  renderMarkers(trailerMarkers, trPts, SVG_TRAILER);

  renderList(pairs);
}

// ——— маркеры как DOM ———
function renderMarkers(pool, coordsList, svg) {
  // убрать старые
  for (const m of pool) m.remove();
  pool.length = 0;

  for (const c of coordsList) {
    const el = document.createElement('div');
    el.style.width = '30px';
    el.style.height = '30px';
    // ВАЖНО: НЕ делаем translate(-50%,-50%) — MapLibre уже центрирует маркер
    el.style.pointerEvents = 'none';
    el.style.zIndex = '2';
    el.innerHTML = svg;

    const mk = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(c)
      .addTo(map);
    pool.push(mk);
  }
}


// ——— список ———
function renderList(pairs) {
  const list = document.getElementById('pairs');
  list.innerHTML = '';
  if (!pairs.length) {
    list.innerHTML = `<li class="pair"><div class="title">Нет данных</div><div class="meta">Проверьте /api/health</div></li>`;
    return;
  }
  for (const p of pairs) {
    const li = document.createElement('li'); li.className = 'pair';
    const t = document.createElement('div'); t.className = 'title';
    t.textContent = p.truck ? `Trailer ${p.trailerId} ▸ Truck ${p.truckId}` : `Trailer ${p.trailerId} ▸ ${p.status || 'no_truck_available'}`;
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = p.distanceMiles != null ? `${p.distanceMiles} mi` : '';
    li.appendChild(t); li.appendChild(m); list.appendChild(li);
  }
}

// ——— geojson helpers/layers ———
function point(c, p){ return {type:'Feature',geometry:{type:'Point',coordinates:c},properties:p||{}} }
function line(c){ return {type:'Feature',geometry:{type:'LineString',coordinates:c},properties:{}} }
function coll(f){ return {type:'FeatureCollection',features:f} }
function setOrUpdateGeo(id, data){ if (map.getSource(id)) map.getSource(id).setData(data); else map.addSource(id, { type:'geojson', data }); }
function addOrUpdateLayer(id, def){
  if (map.getLayer(id)) { if (def.layout) for (const k in def.layout) map.setLayoutProperty(id, k, def.layout[k]);
                          if (def.paint)  for (const k in def.paint)  map.setPaintProperty(id, k, def.paint[k]); return; }
  map.addLayer(Object.assign({ id }, def));
}
