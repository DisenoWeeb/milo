
/* MilongIA · tracking.js v0.1
   Tracker liviano de cuerpos entre frames + detección de parejas bailando
   por proximidad y movimiento correlacionado.

   No depende de ningún modelo de IA particular: solo necesita recibir,
   en cada frame, una lista de detecciones de personas con sus bounding
   boxes (formato coco-ssd: {bbox: [x, y, w, h], score, class}).
*/

// ── Parámetros ajustables ────────────────────────────────────────────────
const TRACK_HISTORIAL_FRAMES   = 10;   // cuántos frames de trayectoria guardar por cuerpo
const TRACK_DIST_MAX_ASOCIAR   = 80;   // px máx. para considerar "mismo cuerpo" entre frames
const TRACK_FRAMES_SIN_VER_MAX = 5;    // frames sin detectar antes de eliminar el track
const PAREJA_DIST_MAX          = 120;  // px máx. entre centros para considerar "cerca como pareja"
const PAREJA_MIN_FRAMES         = 6;   // frames mínimos de movimiento correlacionado para confirmar pareja
const MOVIMIENTO_MIN_PX         = 4;   // desplazamiento mínimo entre frames para considerar "se está moviendo"
const CORRELACION_MIN           = 0.6; // 0-1, qué tan parecido debe ser el desplazamiento de ambos cuerpos

let proximoId = 1;
let tracks    = []; // [{id, bbox, historial: [{x,y,t}], framesSinVer}]

// ── Punto de entrada: procesar un frame nuevo de detecciones ─────────────
// detecciones: array de {bbox: [x,y,w,h], score, class}
// Devuelve: { personasEnPista, parejas, sueltosConMovimiento, totalTracks }
function procesarFrame(detecciones) {
  const ahora = performance.now();
  const personas = detecciones.filter(d => d.class === 'person');
  const centros  = personas.map(p => centroDeBbox(p.bbox));

  asociarConTracksExistentes(centros, ahora);
  limpiarTracksViejos();

  const { parejas, sueltosConMovimiento } = detectarParejas();

  const personasEnPista = parejas.length * 2 + sueltosConMovimiento.length;

  return {
    personasEnPista,
    parejas: parejas.length,
    sueltosConMovimiento: sueltosConMovimiento.length,
    totalTracks: tracks.length
  };
}

// ── Asociar detecciones nuevas con tracks existentes por cercanía ────────
function asociarConTracksExistentes(centros, t) {
  const usados = new Set();

  // Para cada track existente, buscar la detección más cercana disponible
  tracks.forEach(function (track) {
    let mejorIdx  = -1;
    let mejorDist = Infinity;

    centros.forEach(function (c, idx) {
      if (usados.has(idx)) return;
      const d = distancia(track.bbox, c);
      if (d < mejorDist) { mejorDist = d; mejorIdx = idx; }
    });

    if (mejorIdx !== -1 && mejorDist <= TRACK_DIST_MAX_ASOCIAR) {
      usados.add(mejorIdx);
      const c = centros[mejorIdx];
      track.bbox = c;
      track.historial.push({ x: c.x, y: c.y, t: t });
      if (track.historial.length > TRACK_HISTORIAL_FRAMES) track.historial.shift();
      track.framesSinVer = 0;
    } else {
      track.framesSinVer++;
    }
  });

  // Detecciones sin track asociado → crear track nuevo
  centros.forEach(function (c, idx) {
    if (usados.has(idx)) return;
    tracks.push({
      id: proximoId++,
      bbox: c,
      historial: [{ x: c.x, y: c.y, t: t }],
      framesSinVer: 0
    });
  });
}

// ── Eliminar tracks que hace demasiados frames que no se ven ─────────────
function limpiarTracksViejos() {
  tracks = tracks.filter(t => t.framesSinVer <= TRACK_FRAMES_SIN_VER_MAX);
}

// ── Detectar parejas: cuerpos cercanos con movimiento correlacionado ─────
function detectarParejas() {
  const conMovimiento = tracks.filter(tieneMovimientoSostenido);
  const usados  = new Set();
  const parejas = [];

  for (let i = 0; i < conMovimiento.length; i++) {
    if (usados.has(conMovimiento[i].id)) continue;

    for (let j = i + 1; j < conMovimiento.length; j++) {
      if (usados.has(conMovimiento[j].id)) continue;

      const a = conMovimiento[i];
      const b = conMovimiento[j];
      const dist = distancia(a.bbox, b.bbox);

      if (dist <= PAREJA_DIST_MAX && correlacionMovimiento(a, b) >= CORRELACION_MIN) {
        parejas.push([a.id, b.id]);
        usados.add(a.id);
        usados.add(b.id);
        break;
      }
    }
  }

  const sueltosConMovimiento = conMovimiento.filter(t => !usados.has(t.id));

  return { parejas, sueltosConMovimiento };
}

// ── ¿Este track se mueve de forma sostenida (no está quieto)? ────────────
function tieneMovimientoSostenido(track) {
  if (track.historial.length < PAREJA_MIN_FRAMES) return false;

  const h = track.historial;
  let desplazamientoTotal = 0;

  for (let k = 1; k < h.length; k++) {
    desplazamientoTotal += Math.hypot(h[k].x - h[k - 1].x, h[k].y - h[k - 1].y);
  }

  const promedioPorFrame = desplazamientoTotal / (h.length - 1);
  return promedioPorFrame >= MOVIMIENTO_MIN_PX;
}

// ── ¿Qué tan correlacionado es el movimiento de dos tracks? ──────────────
// Compara el vector de desplazamiento frame a frame de ambos; si se mueven
// "juntos" (misma dirección aprox., manteniendo distancia), correlación alta.
function correlacionMovimiento(a, b) {
  const n = Math.min(a.historial.length, b.historial.length);
  if (n < PAREJA_MIN_FRAMES) return 0;

  const ha = a.historial.slice(-n);
  const hb = b.historial.slice(-n);

  let coincidencias = 0;
  for (let k = 1; k < n; k++) {
    const va = { x: ha[k].x - ha[k - 1].x, y: ha[k].y - ha[k - 1].y };
    const vb = { x: hb[k].x - hb[k - 1].x, y: hb[k].y - hb[k - 1].y };

    const magA = Math.hypot(va.x, va.y);
    const magB = Math.hypot(vb.x, vb.y);
    if (magA < 1 && magB < 1) { coincidencias++; continue; } // ambos quietos en ese instante, cuenta como coherente

    const dot = va.x * vb.x + va.y * vb.y;
    const cosSim = (magA > 0 && magB > 0) ? dot / (magA * magB) : 0;
    if (cosSim > 0.3) coincidencias++; // se movieron en dirección parecida
  }

  return coincidencias / (n - 1);
}

// ── Helpers geométricos ───────────────────────────────────────────────
function centroDeBbox(bbox) {
  const [x, y, w, h] = bbox;
  return { x: x + w / 2, y: y + h / 2 };
}

function distancia(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// ── Reset manual (ej. al iniciar/detener detección) ───────────────────
function resetTracking() {
  tracks = [];
  proximoId = 1;
}


OK
Listo
