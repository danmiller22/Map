const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-88.19651, 41.43063],
  zoom: 8
});
map.dragPan.enable(); map.scrollZoom.enable(); map.keyboard.enable(); map.doubleClickZoom.enable();

// контрастные SVG
const triangleSVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 28 28">
  <polygon points="14,3 25,25 3,25" fill="#111" stroke="#fff" stroke-width="2"/>
</svg>`);
const squareSVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">
  <rect x="3" y="3" width="18" height="18" fill="#111" stroke="#fff" stroke-width="2"/>
</svg>`);

// ——— helpers: Promise-загрузка иконок ———
function loadImageP(name, dataUrl){
  return new Promise((resolve, reject)=>{
    if (map.hasImage(name)) return resolve(true);
    map.loadImage(dataUrl, (err, img)=>{
      if (err) return reject(err);
      if (!map.hasImage(name)) map.addImage(name, img);
      resolve(true);
    });
  });
}
async function ensureIcons(){
  await loadImageP('truck',   `data:image/svg+xml;utf8,${triangleSVG}`);
  await loadImageP('trailer', `data:image/svg+xml;utf8,${squareSVG}`);
}

map.on('load', async () => {
  await ensureIcons();        // критично: ждём иконки
  await refresh();
});

document.getElementById('refresh').addEventListener('click', refresh);

async function refresh() {
  const res = await fetch('/api/pairs', { cache: 'no-store' });
  const data = await res.json();
  const pairs = data?.pairs ?? [];

  const trucksPts = [], trailersPts = [], lines = [], labelsTk = [], labelsTr = [];

  for (const p of pairs) {
    const tr = p.trailer, tk = p.truck;
    const trId = String(p.trailerId ?? tr?.id ?? '');
    const tkId = p.truckId != null ? String(p.truckId) : null;

    if (tr?.position) {
      const c = [tr.position.lon, tr.position.lat];
      trailersPts.push(point(c)); labelsTr.push(point(c, { label: `TR ${trId}` }));
    }
    if (tk?.position) {
      const c = [tk.position.lon, tk.position.lat];
      trucksPts.push(point(c)); labelsTk.push(point(c, { label: `TK ${tkId ?? ''}` }));
      if (tr?.position) lines.push(line([c, [tr.position.lon, tr.position.lat]]));
    }
  }

  setOrUpdateGeo('trucks-pts', coll(trucksPts));
  setOrUpdateGeo('trailers-pts', coll(trailersPts));
  setOrUpdateGeo('trucks-labels', coll(labelsTk));
  setOrUpdateGeo('trailers-labels', coll(labelsTr));
  setOrUpdateGeo('pair-lines', coll(lines));

  addOrUpdateLayer('pair-lines-layer', { type: 'line', source: 'pair-lines', paint: { 'line-width': 2 }});

  addOrUpdateLayer('trucks-pts-layer', {
    type: 'symbol', source: 'trucks-pts',
    layout: { 'icon-image': 'truck', 'icon-size': 1.6, 'icon-allow-overlap': true, 'icon-ignore-placement': true }
  });
  addOrUpdateLayer('trailers-pts-layer', {
    type: 'symbol', source: 'trailers-pts',
    layout: { 'icon-image': 'trailer', 'icon-size': 1.6, 'icon-allow-overlap': true, 'icon-ignore-placement': true }
  });

  addOrUpdateLayer('trucks-labels-layer', {
    type: 'symbol', source: 'trucks-labels',
    layout: { 'text-field': ['get','label'], 'text-offset': [0, 1.2], 'text-size': 12, 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true }
  });
  addOrUpdateLayer('trailers-labels-layer', {
    type: 'symbol', source: 'trailers-labels',
    layout: { 'text-field': ['get','label'], 'text-offset': [0, 1.2], 'text-size': 12, 'text-anchor': 'top', 'text-allow-overlap': true, 'text-ignore-placement': true }
  });

  renderList(pairs);
}

// ——— list UI ———
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

// ——— geojson + layers ———
function point(c, p){ return {type:'Feature',geometry:{type:'Point',coordinates:c},properties:p||{}} }
function line(c){ return {type:'Feature',geometry:{type:'LineString',coordinates:c},properties:{}} }
function coll(f){ return {type:'FeatureCollection',features:f} }

function setOrUpdateGeo(id, data){
  if (map.getSource(id)) map.getSource(id).setData(data);
  else map.addSource(id, { type:'geojson', data });
}
function addOrUpdateLayer(id, def){
  if (map.getLayer(id)) {
    // обновим важные layout-свойства, чтобы не пересоздавать слой
    if (def.layout) for (const k of Object.keys(def.layout)) map.setLayoutProperty(id, k, def.layout[k]);
    if (def.paint)  for (const k of Object.keys(def.paint))  map.setPaintProperty(id,  k, def.paint[k]);
    return;
  }
  map.addLayer(Object.assign({ id }, def));
}
