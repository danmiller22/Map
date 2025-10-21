const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-88.19651, 41.43063],
  zoom: 8,
  dragPan: true, scrollZoom: true, keyboard: true, doubleClickZoom: true
});

// SVG иконки
const triangleSVG = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><polygon points="12,3 21,21 3,21" /></svg>`);
const squareSVG   = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect x="3" y="3" width="18" height="18" /></svg>`);

map.on('load', async () => {
  map.loadImage(`data:image/svg+xml;utf8,${triangleSVG}`, (err, img) => { if (!err && !map.hasImage('truck')) map.addImage('truck', img); });
  map.loadImage(`data:image/svg+xml;utf8,${squareSVG}`,  (err, img) => { if (!err && !map.hasImage('trailer')) map.addImage('trailer', img); });
  await refresh();
});

document.getElementById('refresh').addEventListener('click', refresh);

async function refresh() {
  const res = await fetch('/api/pairs', { cache: 'no-store' });
  const data = await res.json();
  const pairs = data?.pairs ?? [];

  const trucks = [];
  const trailers = [];
  const lines = [];

  for (const p of pairs) {
    const tr = p.trailer;
    if (tr?.position) {
      trailers.push(fcPoint([tr.position.lon, tr.position.lat], { id: tr.id, label: `TR ${tr.id}` }));
    }
    if (p.truck?.position) {
      trucks.push(fcPoint([p.truck.position.lon, p.truck.position.lat], { id: p.truck.id, label: `TK ${p.truck.id}` }));
      if (tr?.position) {
        lines.push(fcLine([[p.truck.position.lon, p.truck.position.lat],[tr.position.lon, tr.position.lat]], { id: `${tr.id}-${p.truck.id}`, distance: p.distanceMiles }));
      }
    }
  }

  setOrUpdate('trucks', coll(trucks), 'truck');
  setOrUpdate('trailers', coll(trailers), 'trailer');
  setOrUpdateLine('pair-lines', coll(lines));

  renderList(pairs);

  // авто-фит если есть пары
  if (pairs.length && pairs[0].truck?.position && pairs[0].trailer?.position) {
    const b = new maplibregl.LngLatBounds();
    for (const p of pairs) {
      if (p.truck?.position) b.extend([p.truck.position.lon, p.truck.position.lat]);
      if (p.trailer?.position) b.extend([p.trailer.position.lon, p.trailer.position.lat]);
    }
    map.fitBounds(b, { padding: 60, maxZoom: 9 });
  }
}

function renderList(pairs) {
  const list = document.getElementById('pairs');
  list.innerHTML = '';
  if (!pairs.length) {
    const li = document.createElement('li');
    li.className = 'pair';
    li.innerHTML = `<div class="title">Нет данных для пар</div><div class="meta">Проверьте /api/health</div>`;
    list.appendChild(li);
    return;
  }
  for (const p of pairs) {
    const li = document.createElement('li');
    li.className = 'pair';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = p.truck ? `Trailer ${p.trailerId} ▸ Truck ${p.truckId}` : `Trailer ${p.trailerId} ▸ ${p.status || 'no_truck_available'}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = p.distanceMiles != null ? `${p.distanceMiles} mi` : '';
    li.appendChild(title); li.appendChild(meta);
    li.addEventListener('click', () => {
      if (p.truck?.position && p.trailer?.position) {
        const b = new maplibregl.LngLatBounds();
        b.extend([p.truck.position.lon, p.truck.position.lat]);
        b.extend([p.trailer.position.lon, p.trailer.position.lat]);
        map.fitBounds(b, { padding: 60, maxZoom: 12 });
      } else if (p.trailer?.position) {
        map.flyTo({ center: [p.trailer.position.lon, p.trailer.position.lat], zoom: 12 });
      }
    });
    list.appendChild(li);
  }
}

// GeoJSON helpers
function fcPoint(coords, props) { return { type: 'Feature', geometry: { type: 'Point', coordinates: coords }, properties: props || {} }; }
function fcLine(coords, props)  { return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props || {} }; }
function coll(features) { return { type: 'FeatureCollection', features }; }

// map layer helpers
function setOrUpdate(id, data, imageName) {
  if (map.getSource(id)) { map.getSource(id).setData(data); }
  else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({ id, type: 'symbol', source: id, layout: {
      'icon-image': imageName, 'icon-size': 1, 'icon-allow-overlap': true,
      'text-field': ['get', 'label'], 'text-offset': [0, 1.2], 'text-size': 10, 'text-anchor': 'top'
    }});
  }
}
function setOrUpdateLine(id, data) {
  if (map.getSource(id)) { map.getSource(id).setData(data); }
  else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({ id, type: 'line', source: id, paint: { 'line-width': 2 } });
  }
}

// авто-рефреш
setInterval(refresh, 90000);
