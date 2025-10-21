const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  center: [-88.19651, 41.43063],
  zoom: 8
});

// SVG icons as data URLs
const triangleSVG = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
  <polygon points="12,3 21,21 3,21" fill="black"/></svg>`);
const squareSVG = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">
  <rect x="3" y="3" width="18" height="18" fill="black"/></svg>`);

map.on('load', async () => {
  map.loadImage(`data:image/svg+xml;utf8,${triangleSVG}`, (err, img) => {
    if (!err && !map.hasImage('truck')) map.addImage('truck', img);
  });
  map.loadImage(`data:image/svg+xml;utf8,${squareSVG}`, (err, img) => {
    if (!err && !map.hasImage('trailer')) map.addImage('trailer', img);
  });
  await refresh();
});

document.getElementById('refresh').addEventListener('click', refresh);

async function refresh() {
  const res = await fetch('/api/pairs');
  const data = await res.json();
  const pairs = data?.pairs ?? [];

  // Build GeoJSON for trucks and trailers
  const truckMap = {};
  const truckFeatures = [];
  const trailerFeatures = [];
  const lines = [];

  for (const p of pairs) {
    const tr = p.trailer;
    if (p.truck) truckMap[p.truck.id] = p.truck;

    if (tr?.position) {
      trailerFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [tr.position.lon, tr.position.lat] },
        properties: { id: tr.id, status: p.status, label: `TR ${tr.id}` }
      });
    }

    if (p.truck?.position) {
      truckFeatures.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.truck.position.lon, p.truck.position.lat] },
        properties: { id: p.truck.id, label: `TK ${p.truck.id}` }
      });
    }

    if (p.truck?.position && tr?.position) {
      lines.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [
          [p.truck.position.lon, p.truck.position.lat],
          [tr.position.lon, tr.position.lat]
        ]},
        properties: { id: `${tr.id}-${p.truck.id}`, distance: p.distanceMiles }
      });
    }
  }

  const trucks = { type: 'FeatureCollection', features: truckFeatures };
  const trailers = { type: 'FeatureCollection', features: trailerFeatures };
  const pairsLines = { type: 'FeatureCollection', features: lines };

  // Update or add layers
  setOrUpdate('trucks', trucks, 'truck');
  setOrUpdate('trailers', trailers, 'trailer');
  setOrUpdateLine('pair-lines', pairsLines);

  // Sidebar list
  const list = document.getElementById('pairs');
  list.innerHTML = '';
  for (const p of pairs) {
    const li = document.createElement('li');
    li.className = 'pair';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = p.truck
      ? `Trailer ${p.trailerId} ▸ Truck ${p.truckId}`
      : `Trailer ${p.trailerId} ▸ ${p.status}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = p.distanceMiles != null ? `${p.distanceMiles} mi` : '';
    li.appendChild(title);
    li.appendChild(meta);
    li.addEventListener('click', () => {
      if (p.truck?.position && p.trailer?.position) {
        const bounds = new maplibregl.LngLatBounds();
        bounds.extend([p.truck.position.lon, p.truck.position.lat]);
        bounds.extend([p.trailer.position.lon, p.trailer.position.lat]);
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
      } else if (p.trailer?.position) {
        map.flyTo({ center: [p.trailer.position.lon, p.trailer.position.lat], zoom: 12 });
      }
    });
    list.appendChild(li);
  }
}

function setOrUpdate(id, data, imageName) {
  if (map.getSource(id)) {
    map.getSource(id).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id: id,
      type: 'symbol',
      source: id,
      layout: {
        'icon-image': imageName,
        'icon-size': 1,
        'icon-allow-overlap': true,
        'text-field': ['get', 'label'],
        'text-offset': [0, 1.2],
        'text-size': 10,
        'text-anchor': 'top'
      }
    });
  }
}

function setOrUpdateLine(id, data) {
  if (map.getSource(id)) {
    map.getSource(id).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id: id,
      type: 'line',
      source: id,
      paint: { 'line-width': 2 }
    });
  }
}

// Auto-refresh every 90s
setInterval(refresh, 90000);
