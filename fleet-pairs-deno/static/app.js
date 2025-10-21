const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-88.19651, 41.43063],
  zoom: 8
});
map.dragPan.enable(); map.scrollZoom.enable(); map.keyboard.enable(); map.doubleClickZoom.enable();

// чёрная заливка + белая обводка — хорошо видно на любой подложке
const triangleSVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">
  <polygon points="14,3 25,25 3,25" fill="#000000" stroke="#ffffff" stroke-width="2"/>
</svg>`);
const squareSVG = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <rect x="3" y="3" width="18" height="18" fill="#000000" stroke="#ffffff" stroke-width="2"/>
</svg>`);

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
    const tr = p.trailer, tk = p.truck;
    const trId = String(p.trailerId ?? tr?.id ?? '');
    const tkId = p.truckId != null ? String(p.truckId) : null;

    if (tr?.position) trailers.push(point([tr.position.lon, tr.position.lat], { label: `TR ${trId}` }));
    if (tk?.position) {
      trucks.push(point([tk.position.lon, tk.position.lat], { label: `TK ${tkId ?? ''}` }));
      if (tr?.position) lines.push(line([[tk.position.lon, tk.position.lat],[tr.position.lon, tr.position.lat]]));
    }
    p._trId = trId; p._tkId = tkId;
  }

  setOrUpdate('trucks', coll(trucks), 'truck');
  setOrUpdate('trailers', coll(trailers), 'trailer');
  setOrUpdateLine('pair-lines', coll(lines));

  renderList(pairs);
}

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
    t.textContent = p.truck ? `Trailer ${p._trId} ▸ Truck ${p._tkId}` : `Trailer ${p._trId} ▸ ${p.status || 'no_truck_available'}`;
    const m = document.createElement('div'); m.className = 'meta'; m.textContent = p.distanceMiles != null ? `${p.distanceMiles} mi` : '';
    li.appendChild(t); li.appendChild(m);
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

// helpers
function point(c, p){ return {type:'Feature',geometry:{type:'Point',coordinates:c},properties:p||{}} }
function line(c){ return {type:'Feature',geometry:{type:'LineString',coordinates:c},properties:{}} }
function coll(f){ return {type:'FeatureCollection',features:f} }

function setOrUpdate(id, data, icon){
  if (map.getSource(id)) map.getSource(id).setData(data);
  else {
    map.addSource(id, { type:'geojson', data });
    map.addLayer({
      id, type:'symbol', source:id,
      layout:{
        'icon-image': icon,
        'icon-size': 1,
        'icon-allow-overlap': true,
        'text-field': ['get','label'],
        'text-offset': [0, 1.2],
        'text-size': 11,
        'text-anchor': 'top'
      }
    });
  }
}
function setOrUpdateLine(id, data){
  if (map.getSource(id)) map.getSource(id).setData(data);
  else { map.addSource(id,{type:'geojson',data}); map.addLayer({id,type:'line',source:id,paint:{'line-width':2}}); }
}
