

/* MilongIA · camara.js v0.2
   Corre en el celular-soporte. Detecta personas en el frame con COCO-SSD
   (modelo liviano) y manda el conteo al Apps Script de Cámara cada
   INTERVALO_ENVIO_MS. La detección se autoencadena (nunca se pisa).
*/

// ⚠️ Reemplazar por la URL del GAS de Cámara una vez deployado
const CAMARA_GAS_URL = 'https://script.google.com/macros/s/AKfycbxvoJEdKQRpFxGyV_umkuJEV9zr3Tp4D4CM8s1ZDH4VHH-fyz_ukcJFtXHtwX3FDrf96Q/exec';

const INTERVALO_ENVIO_MS = 30000; // mandar conteo promedio cada 30s
const SCORE_MINIMO       = 0.5;   // confianza mínima para contar como "persona"
const RES_ANCHO          = 640;   // resolución reducida → inferencia más rápida
const RES_ALTO           = 480;

let video          = null;
let canvas         = null;
let ctx            = null;
let modelo         = null;
let detectando     = false;
let envioTimer     = null;
let buffer         = [];  // conteos acumulados desde el último envío
let ultimaDuracionMs = 0; // para mostrar feedback de performance

// ── Inicio de cámara ────────────────────────────────────────────────────
async function initCamara() {
  video  = document.getElementById('video');
  canvas = document.getElementById('canvas');
  ctx    = canvas.getContext('2d');

  setStatus('Solicitando cámara…', false);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width:  { ideal: RES_ANCHO },
        height: { ideal: RES_ALTO }
      },
      audio: false
    });
    video.srcObject = stream;

    await new Promise(resolve => { video.onloadedmetadata = resolve; });
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;

    setStatus('Cámara lista', false);
  } catch (err) {
    console.error('Error accediendo a la cámara:', err);
    setStatus('Error: sin acceso a cámara', false);
  }
}

// ── Cargar modelo COCO-SSD (versión liviana para celulares) ─────────────
async function cargarModelo() {
  setStatus('Cargando modelo IA…', false);
  // 'lite_mobilenet_v2' es notablemente más rápido que el default
  // en hardware modesto, a costa de algo de precisión — aceptable
  // para conteo aproximado de personas.
  modelo = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  setStatus('Modelo listo', false);
}

// ── Toggle iniciar/detener detección ────────────────────────────────────
function toggleDeteccion() {
  const btn = document.getElementById('btn-toggle');

  if (!detectando) {
    detectando = true;
    btn.textContent = 'Detener';
    btn.classList.add('active');
    setStatus('Detectando…', true);

    loopDeteccion();           // arranca el loop autoencadenado
    envioTimer = setInterval(enviarConteoPromedio, INTERVALO_ENVIO_MS);

  } else {
    detectando = false;
    btn.textContent = 'Iniciar';
    btn.classList.remove('active');
    setStatus('Pausado', false);
    clearInterval(envioTimer);
  }
}

// ── Loop de detección autoencadenado ────────────────────────────────────
// En vez de setInterval fijo, cada detección se dispara recién cuando
// la anterior terminó. Así nunca se solapan, sin importar qué tan
// lento sea el celular — el "framerate" de detección se autoajusta.
async function loopDeteccion() {
  while (detectando) {
    await correrDeteccion();
    // pequeño respiro para no saturar el hilo principal entre frames
    await esperar(50);
  }
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Correr una detección sobre el frame actual ──────────────────────────
async function correrDeteccion() {
  if (!modelo || !video.videoWidth) return;

  const t0 = performance.now();
  const predicciones = await modelo.detect(video);
  ultimaDuracionMs = performance.now() - t0;

  const personas = predicciones.filter(function (p) {
    return p.class === 'person' && p.score >= SCORE_MINIMO;
  });

  dibujarDetecciones(personas);
  buffer.push(personas.length);

  document.getElementById('count-val').textContent = personas.length;
  actualizarPerf();
}

// ── Dibujar cajas sobre las personas detectadas (feedback visual) ───────
function dibujarDetecciones(personas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#E8B86D';
  ctx.lineWidth   = 2;
  ctx.font        = '13px Inter';
  ctx.fillStyle   = '#E8B86D';

  personas.forEach(function (p) {
    const [x, y, w, h] = p.bbox;
    ctx.strokeRect(x, y, w, h);
    ctx.fillText(Math.round(p.score * 100) + '%', x + 4, y + 14);
  });
}

// ── Promediar el buffer y enviar al GAS ─────────────────────────────────
async function enviarConteoPromedio() {
  if (!buffer.length) return;

  const promedio = Math.round(buffer.reduce((a, b) => a + b, 0) / buffer.length);
  buffer = []; // reset para el próximo intervalo

  try {
    const res = await fetch(CAMARA_GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS en GAS
      body: JSON.stringify({ personas: promedio })
    });
    const data = await res.json();

    if (data.ok) {
      setSyncInfo('Última sincronización: ' + new Date().toLocaleTimeString() + ' · ' + promedio + ' personas', false);
    } else {
      setSyncInfo('Error al sincronizar: ' + (data.error || 'desconocido'), true);
    }
  } catch (err) {
    console.error('Error enviando conteo:', err);
    setSyncInfo('Sin conexión con el servidor', true);
  }
}

// ── Helpers UI ────────────────────────────────────────────────────────
function setStatus(texto, activo) {
  document.getElementById('status-text').textContent = texto;
  const dot = document.getElementById('status-dot');
  dot.classList.toggle('live', activo);
}

function setSyncInfo(texto, esError) {
  const el = document.getElementById('sync-info');
  el.textContent = texto;
  el.classList.toggle('error', !!esError);
}

function actualizarPerf() {
  const el = document.getElementById('perf-info');
  if (el) el.textContent = Math.round(ultimaDuracionMs) + ' ms/frame';
}

// ── Arranque ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  await initCamara();
  await cargarModelo();
});

// ── Evitar que la pantalla se apague (si el navegador lo soporta) ──────
async function mantenerPantallaActiva() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch (err) {
    console.warn('Wake Lock no disponible:', err);
  }
}
document.addEventListener('DOMContentLoaded', mantenerPantallaActiva);

console.log('MilongIA Cámara v0.2 · loop autoencadenado · modelo liviano');

