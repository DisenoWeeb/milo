/* MilongIA · camara.js v0.1
   Corre en el celular-soporte. Detecta personas en el frame con COCO-SSD
   y manda el conteo al Apps Script de Cámara cada INTERVALO_ENVIO_MS.
*/

// ⚠️ Reemplazar por la URL del GAS de Cámara una vez deployado
const CAMARA_GAS_URL = 'https://script.google.com/macros/s/AKfycbxvoJEdKQRpFxGyV_umkuJEV9zr3Tp4D4CM8s1ZDH4VHH-fyz_ukcJFtXHtwX3FDrf96Q/exec';

const INTERVALO_ENVIO_MS     = 30000; // mandar conteo cada 30s
const INTERVALO_DETECCION_MS = 1000;  // correr detección cada 1s (promedio antes de mandar)
const SCORE_MINIMO           = 0.5;   // confianza mínima para contar una detección como "persona"

let video        = null;
let canvas       = null;
let ctx          = null;
let modelo       = null;
let detectando   = false;
let detectionTimer = null;
let envioTimer     = null;
let buffer          = []; // conteos acumulados desde el último envío

// ── Inicio de cámara ────────────────────────────────────────────────────
async function initCamara() {
  video  = document.getElementById('video');
  canvas = document.getElementById('canvas');
  ctx    = canvas.getContext('2d');

  setStatus('Solicitando cámara…', false);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
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

// ── Cargar modelo COCO-SSD ──────────────────────────────────────────────
async function cargarModelo() {
  setStatus('Cargando modelo IA…', false);
  modelo = await cocoSsd.load();
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

    detectionTimer = setInterval(correrDeteccion, INTERVALO_DETECCION_MS);
    envioTimer     = setInterval(enviarConteoPromedio, INTERVALO_ENVIO_MS);

  } else {
    detectando = false;
    btn.textContent = 'Iniciar';
    btn.classList.remove('active');
    setStatus('Pausado', false);

    clearInterval(detectionTimer);
    clearInterval(envioTimer);
  }
}

// ── Correr una detección sobre el frame actual ──────────────────────────
async function correrDeteccion() {
  if (!modelo || !video.videoWidth) return;

  const predicciones = await modelo.detect(video);
  const personas = predicciones.filter(function (p) {
    return p.class === 'person' && p.score >= SCORE_MINIMO;
  });

  dibujarDetecciones(personas);
  buffer.push(personas.length);

  document.getElementById('count-val').textContent = personas.length;
}

// ── Dibujar cajas sobre las personas detectadas (feedback visual) ───────
function dibujarDetecciones(personas) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#E8B86D';
  ctx.lineWidth   = 2;
  ctx.font        = '14px Inter';
  ctx.fillStyle   = '#E8B86D';

  personas.forEach(function (p) {
    const [x, y, w, h] = p.bbox;
    ctx.strokeRect(x, y, w, h);
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
      setSyncInfo('Última sincronización: ' + new Date().toLocaleTimeString(), false);
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

console.log('MilongIA Cámara v0.1 · listo');
