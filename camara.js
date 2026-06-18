/* MilongIA · camara.js v0.3
   Corre en el celular-soporte. Detecta personas con COCO-SSD (modelo liviano),
   pasa las detecciones al tracker (tracking.js) y manda el conteo al GAS cada
   INTERVALO_ENVIO_MS. La detección se autoencadena (nunca se pisa).
*/

// ⚠️ Reemplazar por la URL del GAS de Cámara una vez deployado
const CAMARA_GAS_URL = 'https://script.google.com/macros/s/AKfycbxvoJEdKQRpFxGyV_umkuJEV9zr3Tp4D4CM8s1ZDH4VHH-fyz_ukcJFtXHtwX3FDrf96Q/exec';

const INTERVALO_ENVIO_MS = 30000; // mandar conteo promedio cada 30s
const SCORE_MINIMO       = 0.5;   // confianza mínima para contar como "persona"
const RES_ANCHO          = 640;   // resolución reducida → inferencia más rápida
const RES_ALTO           = 480;

let video            = null;
let canvas           = null;
let ctx              = null;
let modelo           = null;
let detectando       = false;
let envioTimer       = null;
let buffer           = [];   // conteos acumulados desde el último envío
let ultimaDuracionMs = 0;    // para mostrar feedback de performance

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

// ── Cargar modelo COCO-SSD liviano ──────────────────────────────────────
async function cargarModelo() {
  setStatus('Cargando modelo IA…', false);
  modelo = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
  setStatus('Modelo listo', false);
}

// ── Toggle iniciar/detener detección ────────────────────────────────────
function toggleDeteccion() {
  const btn = document.getElementById('btn-toggle');

  if (!detectando) {
    resetTracking();          // limpiar tracks del run anterior
    detectando = true;
    btn.textContent = 'Detener';
    btn.classList.add('active');
    setStatus('Detectando…', true);

    loopDeteccion();
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
async function loopDeteccion() {
  while (detectando) {
    await correrDeteccion();
    await esperar(50); // respiro entre frames
  }
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Correr una detección sobre el frame actual ──────────────────────────
async function correrDeteccion() {
  if (!modelo || !video.videoWidth) return;

  const t0           = performance.now();
  const predicciones = await modelo.detect(video);
  ultimaDuracionMs   = performance.now() - t0;

  // Pasar detecciones al tracker → obtener conteo de parejas bailando
  const resultado = procesarFrame(predicciones);

  dibujarDetecciones(predicciones, resultado);
  buffer.push(resultado.personasEnPista);

  document.getElementById('count-val').textContent = resultado.personasEnPista;
  actualizarPerf(resultado);
}

// ── Dibujar cajas + resumen en el canvas ────────────────────────────────
function dibujarDetecciones(predicciones, resultado) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Cajas doradas sobre cada persona detectada
  ctx.strokeStyle = '#E8B86D';
  ctx.lineWidth   = 2;
  predicciones
    .filter(p => p.class === 'person' && p.score >= SCORE_MINIMO)
    .forEach(p => {
      const [x, y, w, h] = p.bbox;
      ctx.strokeRect(x, y, w, h);
    });

  // Resumen de parejas — centrado en la parte inferior del canvas
  const texto  = resultado.parejas + ' parejas · ' + resultado.sueltosConMovimiento + ' solos';
  ctx.font     = '13px Inter';
  const ancho  = ctx.measureText(texto).width + 24;
  const xRect  = (canvas.width - ancho) / 2;
  const yRect  = canvas.height - 44;
  ctx.fillStyle = 'rgba(13,9,4,0.8)';
  ctx.beginPath();
  ctx.roundRect(xRect, yRect, ancho, 28, 8);
  ctx.fill();
  ctx.fillStyle = '#E8B86D';
  ctx.fillText(texto, xRect + 12, yRect + 19);
}

// ── Actualizar indicador de performance ─────────────────────────────────
function actualizarPerf(resultado) {
  // ms/frame va al overlay superior que siempre es visible
  const statusEl = document.getElementById('status-text');
  if (statusEl) statusEl.textContent =
    'Detectando · ' + Math.round(ultimaDuracionMs) + 'ms · ' +
    resultado.totalTracks + ' tracks';

  // perf-info abajo como fallback si existe
  const perfEl = document.getElementById('perf-info');
  if (perfEl) perfEl.textContent =
    Math.round(ultimaDuracionMs) + ' ms/frame · ' +
    resultado.totalTracks + ' tracks activos';
}

// ── Promediar el buffer y enviar al GAS ─────────────────────────────────
async function enviarConteoPromedio() {
  if (!buffer.length) return;

  const promedio = Math.round(buffer.reduce((a, b) => a + b, 0) / buffer.length);
  buffer = [];

  try {
    const res = await fetch(CAMARA_GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body:    JSON.stringify({ personas: promedio })
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
  document.getElementById('status-dot').classList.toggle('live', activo);
}

function setSyncInfo(texto, esError) {
  const el = document.getElementById('sync-info');
  el.textContent = texto;
  el.classList.toggle('error', !!esError);
}

// ── Arranque ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  await initCamara();
  await cargarModelo();
});

// ── Evitar que la pantalla se apague ─────────────────────────────────
async function mantenerPantallaActiva() {
  try {
    if ('wakeLock' in navigator) await navigator.wakeLock.request('screen');
  } catch (err) {
    console.warn('Wake Lock no disponible:', err);
  }
}
document.addEventListener('DOMContentLoaded', mantenerPantallaActiva);

console.log('MilongIA Cámara v0.3 · tracking activo · modelo liviano');
