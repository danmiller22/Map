const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-88.19651, 41.43063],
  zoom: 8
});
map.dragPan.enable(); map.scrollZoom.enable(); map.keyboard.enable(); map.doubleClickZoom.enable();

// ===== CANVAS-иконки (крупные, контрастные) =====
function makeTriangle(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#111111';
  ctx.beginPath();
  ctx.moveTo(size/2, 4);
  ctx.lineTo(size - 4, size - 4);
  ctx.lineTo(4, size - 4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  return c;
}
function makeSquare(size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.lineWidth = 4; ctx.strokeStyle = '#ffffff'; ctx.fillStyle = '#111111';
  ctx.beginPath(); ctx.rect(4, 4, size - 8, size - 8); ctx.fill(); ctx.stroke();
  return c;
}
async function ensureImages() {
  if (!map.hasImage('truck'))   map.addImage('truck',   makeTriangle(), { pixelRatio: 1 });
  if (!map.hasImage('trailer')) map.addImage('trailer', makeSquare(),   { pixelRatio: 1 });
}

map.on('load', async () => { await ensureImages(); await refresh(); });
document.getElementById('refresh').addEventListener('click', refresh);

async function refresh() {
  const r = await fetch('/api/pairs', { cache: 'no-store' });
  const d = await r.json();
  const pairs = d?.pairs ?? [];

  const trucksPts = [], trailersPts = [], lines = [], labelsTk = [], labelsTr = [];

  for (const p of pairs) {
    const tr = p.trailer, tk = p.truck;
    const trId = String(p.trailerId ?? tr?.id ?? '');
    const tkId = p.truckId != null ? String(p.truckId) : null;

    if (tr?.position) {
      const c = [tr.position.lon, tr.position.lat];
      trailersPts.push(pt(c)); labelsTr.push(pt(c, { label: `TR ${trId}` }));
    }
    if (tk?.position) {
      const c = [tk.position.lon, tk.position.lat];
      trucksPts.push(pt(c)); labelsTk.push(pt(c, { label: `TK ${tkId ?? ''}` }));
      if (tr?.position) lines.push(ln([c, [tr.position.lon, tr.position.lat]]));
    }
  }

  setSrc('pair-lines', fc(lines));
  setSrc('trucks-pts', fc(trucksPts));
  setSrc('trailers-pts', fc(trailersPts));
  setSrc('trucks-labels', fc(labelsTk));
  setSrc('trailers-labels', fc(labelsTr));

  addLayer('pair-lines-layer', {
    type: 'line', source: 'pair-lines',
    paint: { 'line-width': 2 }
  });

  addLayer('trucks-pts-layer', {
    type: 'symbol', source: 'trucks-pts',
    layout: {
      'icon-image': 'truck', 'icon-size': 1.0, 'icon-anchor': 'center',
      'icon-allow-overlap': true, 'icon-ignore-placement': true
    }
  });
  addLayer('trailers-pts-layer', {
    type: 'symbol', source: 'trailers-pts',
    layout: {
      'icon-image': 'trailer', 'icon-size': 1.0, 'icon-anchor': 'center',
      'icon-allow-overlap': true, 'icon-ignore-placement': true
    }
  });

  addLayer('trucks-labels-layer', {
    type: 'symbol', source: 'trucks-labels',
    layout: {
      'text-field': ['get','label'], 'text-offset': [0, 1.2], 'text-size': 12, 'text-anchor': 'top',
      'text-allow-overlap': true, 'text-ignore-placement': true
    }
  });
  addLayer('trailers-labels-layer', {
    type: 'symbol', source: 'trailers-labels',
    layout: {
      'text-field': ['get','label'], 'text-offset': [0, 1.2], 'text-size': 12, 'text-anchor': 'top',
      'text-allow-overlap': true, 'text-ignore-placement': true
    }
  });

  renderList(pairs);
}

// ===== список =====
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
    const m = document.createElement('div'); m.className = 'meta';
    m.textContent = p.distanceMiles != null ? `${p.distanceMiles} mi` : '';
    li.appendChild(t); li.appendChild(m); list.appendChild(li);
  }
}

// ===== geojson helpers / layers =====
function pt(c, p){ return { type:'Feature', geometry:{ type:'Point', coordinates:c }, properties:p||{} } }
function ln(c){ return { type:'Feature', geometry:{ type:'LineString', coordinates:c }, properties:{} } }
function fc(f){ return { type:'FeatureCollection', features:f } }
function setSrc(id, data){ if (map.getSource(id)) map.getSource(id).setData(data); else map.addSource(id, { type:'geojson', data }); }
function addLayer(id, def){
  if (map.getLayer(id)) {
    if (def.layout) for (const k in def.layout) map.setLayoutProperty(id, k, def.layout[k]);
    if (def.paint)  for (const k in def.paint)  map.setPaintProperty(id, k, def.paint[k]);
  } else {
    map.addLayer(Object.assign({ id }, def));
  }
}
