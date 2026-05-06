// Mapa nacional Ecuador — misma estética que globe.js
import { geoMercator, geoPath, geoGraticule } from 'd3-geo';
import { feature } from 'topojson-client';

// ── Constantes ──────────────────────────────────────────────────────────────
const GOLD      = '#E6C878';
const GOLD_A    = (a) => `rgba(230,200,120,${a})`;
const NAVY_0    = '#070B14';
const NAVY_2    = '#111A2C';
const ORIGIN    = { lat: -0.2295, lon: -78.5243 }; // Quito
const PLANE_SPD = 0.22;

// ── Canvas setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('globe-canvas');
const ctx    = canvas.getContext('2d');
const stage  = canvas.parentElement;
let W, H;

// ── Proyección principal (continente) ────────────────────────────────────────
let proj, pathGen;
// Centro y escala de la vista por defecto
const DEF_CENTER = [-78.3, -2.0];
let   currentCenter = [...DEF_CENTER];
let   currentScale;
let   defScale;

// Inset Galápagos — dimensiones fijas; y se calcula por frame a la altura de Quito
const GAL_CENTER = [-90.5, -0.5];
const GAL_INSET  = { x: 18, w: 140, h: 90 };

// ── Datos mapa ───────────────────────────────────────────────────────────────
let mainlandFeature  = null;
let galapagosFeature = null;
let provincesFC      = null; // FeatureCollection con las 24 provincias
let graticule        = null;

// ── Rutas ────────────────────────────────────────────────────────────────────
const routes = []; // { data, o, d, cp, progress, offset }

// ── Estado avión ─────────────────────────────────────────────────────────────
let planeAnim       = null;
let planeHideTimeout = null;
let planeVisible    = false;

// ── Estado cámara ────────────────────────────────────────────────────────────
let cameraPhase      = null; // 'to-origin' | 'to-dest' | null
let cameraDestCenter = null;
let cameraDestScale  = null;
let zoomStart        = null;
let zoomTarget       = null;
let zoomT            = 0;
const ZOOM_ECUAD_SCALE_FACTOR = 1.15; // zoom-in ligero al ir a destino

// ── Highlight ────────────────────────────────────────────────────────────────
let highlightedCode = null;

// ── Animación ────────────────────────────────────────────────────────────────
let animT    = 0;
let lastTime = null;

// ════════════════════════════════════════════════════════════════════════════
// RESIZE
// ════════════════════════════════════════════════════════════════════════════
function resize() {
  W = canvas.width  = stage.clientWidth;
  H = canvas.height = stage.clientHeight;
  defScale = Math.min(W, H) * 5.2;
  currentScale = defScale;
  rebuildProjections();
  rebuildRoutePx();
}

function rebuildProjections() {
  proj = geoMercator()
    .center(currentCenter)
    .scale(currentScale)
    .translate([W / 2, H / 2]);
  pathGen = geoPath().projection(proj).context(ctx);
  // projGal se recalcula en drawGalapagosInset() cada frame porque su Y
  // depende de la posición proyectada de Quito, que cambia con el zoom.
}

// Devuelve los límites del inset alineados verticalmente con Quito
function galInsetBounds() {
  const qPx = px(ORIGIN.lon, ORIGIN.lat);
  const cy   = qPx ? qPx[1] : H / 2;
  const y    = Math.max(10, Math.min(H - GAL_INSET.h - 10, cy - GAL_INSET.h / 2));
  return { x: GAL_INSET.x, y, w: GAL_INSET.w, h: GAL_INSET.h };
}

function px(lon, lat) { return proj([lon, lat]); }

// ════════════════════════════════════════════════════════════════════════════
// RUTAS — Bezier en píxeles
// ════════════════════════════════════════════════════════════════════════════
function buildRoutes() {
  routes.length = 0;
  window.VISITS.forEach((v, i) => {
    const o = px(ORIGIN.lon, ORIGIN.lat);
    const d = px(v.lon, v.lat);
    const cp = arcCP(o, d);
    routes.push({ data: v, o, d, cp, progress: 0, offset: i * 0.7 });
  });
}

function rebuildRoutePx() {
  routes.forEach(r => {
    r.o  = px(ORIGIN.lon, ORIGIN.lat);
    r.d  = px(r.data.lon, r.data.lat);
    r.cp = arcCP(r.o, r.d);
  });
}

function arcCP(p0, p1) {
  // Punto de control: mid desplazado hacia arriba (Y negativo en canvas)
  const mx = (p0[0] + p1[0]) / 2;
  const my = (p0[1] + p1[1]) / 2;
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  return [mx, my - len * 0.32];
}

function bezierPt(t, p0, cp, p1) {
  const mt = 1 - t;
  return [
    mt*mt*p0[0] + 2*mt*t*cp[0] + t*t*p1[0],
    mt*mt*p0[1] + 2*mt*t*cp[1] + t*t*p1[1]
  ];
}
function bezierTan(t, p0, cp, p1) {
  const mt = 1 - t;
  return [
    2*(mt*(cp[0]-p0[0]) + t*(p1[0]-cp[0])),
    2*(mt*(cp[1]-p0[1]) + t*(p1[1]-cp[1]))
  ];
}
function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ════════════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════════════
function draw(dt) {
  animT += dt;

  // Fondo
  ctx.fillStyle = NAVY_0;
  ctx.fillRect(0, 0, W, H);

  // Gradiente radial
  const grd = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.65);
  grd.addColorStop(0, 'rgba(30,45,75,0.28)');
  grd.addColorStop(1, 'rgba(7,11,20,0)');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);

  // Graticule
  if (graticule) {
    ctx.save();
    ctx.strokeStyle = GOLD_A(0.07);
    ctx.lineWidth   = 0.5;
    ctx.beginPath(); pathGen(graticule); ctx.stroke();
    ctx.restore();
  }

  // Ecuador continente
  if (mainlandFeature) drawEcuadorLand(mainlandFeature, pathGen);

  // Límites provinciales (encima del relleno, debajo del borde nítido)
  if (provincesFC) drawProvinces(provincesFC, pathGen);

  // Inset Galápagos
  if (galapagosFeature) drawGalapagosInset();

  // Arcos animados
  routes.forEach((r, i) => {
    const spd   = 0.22;
    const cycle = (animT * spd + r.offset) % 1.6;
    r.progress  = Math.min(1, cycle);
    drawArc(r);
  });

  // Marcadores de destino
  routes.forEach(r => drawCityMarker(r.d, r.data, r.data.code === highlightedCode));

  // Origen (Quito)
  drawOriginMarker();

  // Avión
  if (planeVisible && planeAnim) {
    planeAnim.t = Math.min(1, planeAnim.t + dt * PLANE_SPD);
    const pos = bezierPt(planeAnim.t, planeAnim.r.o, planeAnim.r.cp, planeAnim.r.d);
    const tan = bezierTan(planeAnim.t, planeAnim.r.o, planeAnim.r.cp, planeAnim.r.d);
    drawPlane(pos, tan);
    if (planeAnim.t >= 1) {
      planeAnim = null;
      planeHideTimeout = setTimeout(() => {
        planeHideTimeout = null;
        if (!planeAnim) planeVisible = false;
      }, 700);
    }
  }

  // Zoom cámara
  if (zoomTarget && zoomStart) {
    const spd  = cameraPhase === 'to-origin' ? 3.0 : 0.9;
    zoomT      = Math.min(1, zoomT + dt * spd);
    const ease = 1 - Math.pow(1 - zoomT, 3);
    currentCenter[0] = lerp(zoomStart.center[0], zoomTarget.center[0], ease);
    currentCenter[1] = lerp(zoomStart.center[1], zoomTarget.center[1], ease);
    currentScale     = lerp(zoomStart.scale,      zoomTarget.scale,      ease);
    rebuildProjections();
    rebuildRoutePx();
    if (zoomT >= 1) {
      if (cameraPhase === 'to-origin' && cameraDestCenter) {
        // Fase 2: ir al destino
        zoomStart = { center: [...currentCenter], scale: currentScale };
        zoomTarget = { center: cameraDestCenter, scale: cameraDestScale };
        cameraDestCenter = null; cameraDestScale = null;
        cameraPhase = 'to-dest';
        zoomT = 0;
      } else {
        zoomStart = null; zoomTarget = null; cameraPhase = null;
      }
    }
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }

// ── Límites provinciales ─────────────────────────────────────────────────────
function drawProvinces(fc, pg) {
  ctx.save();
  ctx.strokeStyle = GOLD_A(0.28);
  ctx.lineWidth   = 0.7;
  ctx.setLineDash([4, 5]);
  fc.features.forEach(f => {
    ctx.beginPath(); pg(f); ctx.stroke();
  });
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Contorno Ecuador ─────────────────────────────────────────────────────────
function drawEcuadorLand(feat, pg) {
  // Relleno
  ctx.save();
  ctx.fillStyle = NAVY_2;
  ctx.beginPath(); pg(feat); ctx.fill();
  ctx.restore();

  // Glow (borde exterior difuso)
  ctx.save();
  ctx.shadowColor = GOLD_A(0.55);
  ctx.shadowBlur  = 14;
  ctx.strokeStyle = GOLD_A(0.25);
  ctx.lineWidth   = 2.5;
  ctx.beginPath(); pg(feat); ctx.stroke();
  ctx.restore();

  // Borde nítido dorado
  ctx.save();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth   = 1;
  ctx.beginPath(); pg(feat); ctx.stroke();
  ctx.restore();
}

// ── Inset Galápagos — posición dinámica a la altura de Quito ─────────────────
function drawGalapagosInset() {
  const { x, y, w, h } = galInsetBounds();

  // Proyección local recalculada cada frame con la y correcta
  const gScale    = (w / 3.2) * 48;
  const localProj = geoMercator()
    .center(GAL_CENTER)
    .scale(gScale)
    .translate([x + w / 2, y + h / 2]);
  const localPath = geoPath().projection(localProj).context(ctx);

  // Fondo inset
  ctx.save();
  ctx.fillStyle   = 'rgba(7,11,20,0.88)';
  ctx.strokeStyle = GOLD_A(0.35);
  ctx.lineWidth   = 1;
  ctx.beginPath(); ctx.rect(x, y, w, h);
  ctx.fill(); ctx.stroke();
  ctx.restore();

  // Mapa islas dentro del clip
  ctx.save();
  ctx.beginPath(); ctx.rect(x + 1, y + 1, w - 2, h - 2); ctx.clip();
  drawEcuadorLand(galapagosFeature, localPath);
  ctx.restore();

  // Etiqueta superior
  ctx.save();
  ctx.fillStyle = GOLD_A(0.9);
  ctx.font      = "8px 'JetBrains Mono', monospace";
  ctx.fillText('ISLAS GALÁPAGOS', x + 6, y + 12);
  ctx.restore();
}

// ── Arco animado ─────────────────────────────────────────────────────────────
function drawArc(r) {
  const { o, d, cp, progress, data } = r;
  const hl  = data.code === highlightedCode;
  const segs = 64;

  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    if (t0 > progress) break;
    const t1  = Math.min((i + 1) / segs, progress);
    const p0  = bezierPt(t0, o, cp, d);
    const p1  = bezierPt(t1, o, cp, d);

    const headF = smoothstep(progress - 0.13, progress, t0);
    const tailF = smoothstep(0, 0.35, t0);
    const base  = tailF * (0.35 + 0.65 * headF);
    const hlMul = hl ? 1.4 : 0;
    const alpha = Math.min(1, base * (0.55 + 0.45 * hlMul));

    ctx.save();
    if (headF > 0.6) { ctx.shadowColor = GOLD; ctx.shadowBlur = 8; }
    ctx.strokeStyle = GOLD_A(alpha * (hl ? 1.2 : 1));
    ctx.lineWidth   = hl ? 2.2 : 1.4;
    ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
    ctx.restore();
  }
}

// ── Marcador ciudad destino ───────────────────────────────────────────────────
function drawCityMarker([x, y], data, hl) {
  const r = hl ? 5.5 : 3.5;

  // Dot con glow
  ctx.save();
  ctx.shadowColor = GOLD; ctx.shadowBlur = hl ? 16 : 8;
  ctx.fillStyle   = GOLD;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Anillo
  ctx.save();
  ctx.strokeStyle  = GOLD;
  ctx.lineWidth    = 0.9;
  ctx.globalAlpha  = hl ? 1 : 0.55;
  ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Nombre siempre visible; mayor énfasis cuando está activo
  ctx.save();
  if (hl) {
    ctx.shadowColor = GOLD_A(0.45); ctx.shadowBlur = 7;
    ctx.fillStyle   = GOLD;
    ctx.font        = "bold 11px 'JetBrains Mono', monospace";
  } else {
    ctx.fillStyle   = GOLD_A(0.72);
    ctx.font        = "9.5px 'JetBrains Mono', monospace";
  }
  ctx.fillText(data.capital.toUpperCase(), x + 12, y + 4);
  ctx.restore();
}

// ── Marcador Quito (origen) ───────────────────────────────────────────────────
function drawOriginMarker() {
  const [x, y] = px(ORIGIN.lon, ORIGIN.lat) || [0, 0];

  // Dot
  ctx.save();
  ctx.shadowColor = GOLD; ctx.shadowBlur = 18;
  ctx.fillStyle   = GOLD;
  ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Anillo estático
  ctx.save();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 1; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Anillo pulsante
  const s = 1 + 0.5 * Math.sin(animT * 2.4);
  ctx.save();
  ctx.strokeStyle  = GOLD;
  ctx.lineWidth    = 1;
  ctx.globalAlpha  = 0.45 * (1 - (s - 1));
  ctx.shadowColor  = GOLD; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(x, y, 10 * s, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // Label
  ctx.save();
  ctx.fillStyle = GOLD_A(0.9);
  ctx.font      = "9px 'JetBrains Mono', monospace";
  ctx.fillText('QUITO', x + 14, y + 4);
  ctx.restore();
}

// ── Avión 2D ─────────────────────────────────────────────────────────────────
function drawPlane([x, y], [tx, ty]) {
  const angle = Math.atan2(ty, tx);
  const sz    = 13;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.shadowColor = GOLD; ctx.shadowBlur = 14;
  ctx.strokeStyle = GOLD; ctx.lineCap = 'round';

  // Fuselaje
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(-sz * 0.5, 0); ctx.lineTo(sz * 0.5, 0); ctx.stroke();

  // Alas
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -sz * 0.38); ctx.lineTo(0, sz * 0.38); ctx.stroke();

  // Estabilizador horizontal
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-sz * 0.38, -sz * 0.2); ctx.lineTo(-sz * 0.38, sz * 0.2); ctx.stroke();

  ctx.restore();
}

// ════════════════════════════════════════════════════════════════════════════
// CÁMARA — posición óptima para Ecuador (análogo a routeCamPos del globe)
// ════════════════════════════════════════════════════════════════════════════
function routeCamParams(visit) {
  // Punto medio geográfico entre Quito y el destino (más bias al destino)
  const dLon = visit.lon - ORIGIN.lon;
  const dLat = visit.lat - ORIGIN.lat;
  const dist  = Math.hypot(dLon, dLat);
  // Peso 70% hacia destino, 30% hacia Quito (rutas cortas en Ecuador)
  const midLon = ORIGIN.lon + dLon * 0.65;
  const midLat = ORIGIN.lat + dLat * 0.65;
  // Ligero zoom-in para rutas cortas
  const scale  = defScale * (1 + Math.max(0, (4 - dist) / 6) * 0.45);
  return { center: [midLon, midLat], scale: Math.min(defScale * 1.6, scale) };
}

// ════════════════════════════════════════════════════════════════════════════
// EVENTOS
// ════════════════════════════════════════════════════════════════════════════
window.addEventListener('visit:focus', (e) => {
  const visit = window.VISITS.find(v => v.code === e.detail);
  if (!visit) return;
  highlightedCode = e.detail;
  if (cameraPhase) return; // plane:launch maneja la cámara
  const cam = routeCamParams(visit);
  zoomStart  = { center: [...currentCenter], scale: currentScale };
  zoomTarget = cam;
  zoomT = 0;
});

window.addEventListener('plane:launch', (e) => {
  const route = routes.find(r => r.data.code === e.detail);
  if (!route) return;
  if (planeHideTimeout !== null) { clearTimeout(planeHideTimeout); planeHideTimeout = null; }

  // Cámara fase 1: volver al Ecuador overview (Quito)
  const cam = routeCamParams(route.data);
  zoomStart        = { center: [...currentCenter], scale: currentScale };
  zoomTarget       = { center: [...DEF_CENTER], scale: defScale }; // Fase 1 → Ecuador completo
  cameraDestCenter = cam.center;
  cameraDestScale  = cam.scale;
  cameraPhase      = 'to-origin';
  zoomT = 0;

  // Avión
  planeAnim   = { r: route, t: 0 };
  planeVisible = true;
});

window.addEventListener('visit:resetview', () => {
  highlightedCode  = null;
  cameraPhase      = null;
  cameraDestCenter = null;
  cameraDestScale  = null;
  zoomStart  = { center: [...currentCenter], scale: currentScale };
  zoomTarget = { center: [...DEF_CENTER], scale: defScale };
  zoomT = 0;
  if (planeHideTimeout !== null) { clearTimeout(planeHideTimeout); planeHideTimeout = null; }
  planeAnim    = null;
  planeVisible = false;
});

// Tooltip sobre marcadores (hover en canvas)
canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;
  const tooltip = document.getElementById('tooltip');

  let hit = null;
  routes.forEach(r => {
    const [dx, dy] = r.d;
    if (Math.hypot(mx - dx, my - dy) < 12) hit = r.data;
  });

  if (hit) {
    canvas.style.cursor = 'pointer';
    tooltip.style.display = 'block';
    tooltip.style.left = `${mx}px`;
    tooltip.style.top  = `${my}px`;
    tooltip.querySelector('.tt-name').textContent = `${hit.capital} · ${hit.province}`;
    tooltip.querySelector('.tt-date').textContent = `${hit.dateLong} · ${hit.type.toUpperCase()}`;
  } else {
    canvas.style.cursor = 'default';
    tooltip.style.display = 'none';
  }
});

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;
  routes.forEach(r => {
    const [dx, dy] = r.d;
    if (Math.hypot(mx - dx, my - dy) < 12) {
      window.dispatchEvent(new CustomEvent('visit:selected', { detail: r.data.code }));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// LOOP
// ════════════════════════════════════════════════════════════════════════════
function animate(ts) {
  const dt = lastTime ? Math.min((ts - lastTime) / 1000, 0.05) : 0;
  lastTime = ts;
  draw(dt);
  requestAnimationFrame(animate);
}

// ════════════════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════════════════
async function init() {
  resize();
  window.addEventListener('resize', () => { resize(); buildRoutes(); });

  graticule = geoGraticule().step([5, 5])();

  try {
    // 50m para mayor detalle y Galápagos visible
    const resWorld = await fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-50m.json');
    const world    = await resWorld.json();
    const all      = feature(world, world.objects.countries);
    const ecuador  = all.features.find(f => String(f.id) === '218');

    if (ecuador) {
      const geom = ecuador.geometry;
      const polys = geom.type === 'MultiPolygon'
        ? geom.coordinates
        : [geom.coordinates];

      const mlCoords  = [];
      const galCoords = [];

      polys.forEach(poly => {
        const lons   = poly[0].map(c => c[0]);
        const avgLon = lons.reduce((a, b) => a + b, 0) / lons.length;
        (avgLon < -82 ? galCoords : mlCoords).push(poly);
      });

      mainlandFeature = {
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: mlCoords.length ? mlCoords : polys }
      };
      if (galCoords.length) {
        galapagosFeature = {
          type: 'Feature',
          geometry: { type: 'MultiPolygon', coordinates: galCoords }
        };
      }
    }
  } catch (err) {
    console.warn('No se pudo cargar el mapa base:', err);
  }

  // Provincias Ecuador — Click That Hood (GeoJSON dedicado, sin filtrar)
  const provUrls = [
    'https://cdn.jsdelivr.net/gh/codeforamerica/click_that_hood@master/public/data/ecuador-provinces.geojson',
    'https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/ecuador-provinces.geojson'
  ];
  for (const url of provUrls) {
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      provincesFC = await r.json();
      break;
    } catch (_) { /* intenta la siguiente URL */ }
  }
  if (!provincesFC) console.warn('No se pudieron cargar las provincias.');

  buildRoutes();
  requestAnimationFrame(animate);

  window.__mapReady = true;
  window.dispatchEvent(new Event('globe:ready'));
}

init();
