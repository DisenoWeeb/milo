/* MilongIA · panel.js */
/* Lógica base del panel del organizador */

// ── Reloj ──────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = now.getHours().toString().padStart(2, '0');
  const m = now.getMinutes().toString().padStart(2, '0');
  const el = document.getElementById('evento-hora');
  if (el) el.textContent = h + ':' + m;
}
updateClock();
setInterval(updateClock, 30000);

// ── Sliders de audio ───────────────────────────────────────────────────────
['vol', 'bass', 'treble'].forEach(id => {
  const slider = document.getElementById(id);
  const out    = document.getElementById(id + '-out');
  if (slider && out) {
    slider.addEventListener('input', () => {
      out.textContent = Math.round(slider.value);
    });
  }
});

// ── Simulación de progreso de tema ─────────────────────────────────────────
// En producción esto viene del motor de Apps Script
let progressPct = 38;
const progressFill = document.getElementById('progress-fill');
const timeCurrent  = document.getElementById('time-current');

function tickProgress() {
  if (progressPct >= 100) {
    progressPct = 0;
  } else {
    progressPct += 0.5;
  }
  if (progressFill) {
    progressFill.style.width = Math.round(progressPct) + '%';
  }
  // Actualizar tiempo (simulado sobre 3:12 = 192 seg)
  const totalSeg = 192;
  const curSeg   = Math.round((progressPct / 100) * totalSeg);
  const mm = Math.floor(curSeg / 60);
  const ss = (curSeg % 60).toString().padStart(2, '0');
  if (timeCurrent) timeCurrent.textContent = mm + ':' + ss;
}
setInterval(tickProgress, 3000);

// ── Estado del panel ───────────────────────────────────────────────────────
// En producción estos datos vienen de Apps Script via fetch
const estadoDemo = {
  evento: {
    nombre: 'Milonga San Telmo',
    fecha: 'Sábado 14 jun',
  },
  metricas: {
    personas: 84,
    enPista: 61,
    bailando: 52,
    tandaActual: 4,
    tandaTotal: 18,
    tandaEstilo: "Tango · D'Arienzo",
    restante: '1h 45m',
  },
  ia: {
    mensaje: 'Pista responde bien. Mantengo energía alta en próxima tanda.',
  }
};

// Renderizar estado inicial
function renderEstado(estado) {
  const s = estado.metricas;

  const mPersonas = document.getElementById('m-personas');
  const mPista    = document.getElementById('m-pista');
  const mPistaSub = document.getElementById('m-pista-sub');
  const mTanda    = document.getElementById('m-tanda');
  const mTandaSub = document.getElementById('m-tanda-sub');
  const mTiempo   = document.getElementById('m-tiempo');
  const iaTxt     = document.getElementById('ia-texto');

  if (mPersonas) mPersonas.textContent = s.personas;
  if (mPista)    mPista.textContent    = s.enPista + '%';
  if (mPistaSub) mPistaSub.textContent = s.bailando + ' bailando';
  if (mTanda)    mTanda.textContent    = s.tandaActual + ' / ' + s.tandaTotal;
  if (mTandaSub) mTandaSub.textContent = s.tandaEstilo;
  if (mTiempo)   mTiempo.textContent   = s.restante;
  if (iaTxt)     iaTxt.textContent     = estado.ia.mensaje;
}

renderEstado(estadoDemo);

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw5NVX8ICStvL-jp4XvuA21SD0JOLYPoHWuDsalDGZh8bpmoMzuMcPquFxLrZihsdGj/exec';

async function fetchBiblioteca() {
  try {
    const res  = await fetch(GAS_URL + '?action=getBiblioteca');
    const data = await res.json();
    console.log('Biblioteca cargada:', data.length, 'temas');
    return data;
  } catch (e) {
    console.warn('Error cargando biblioteca:', e);
    return [];
  }
}

async function fetchTanda(estilo) {
  try {
    const url = GAS_URL + '?action=getTanda&estilo=' + estilo;
    console.log('Llamando:', url);
    const res  = await fetch(url);
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Tanda recibida:', data);
    renderTanda(data);
  } catch (e) {
    console.warn('Error cargando tanda:', e);
  }
}

function renderTanda(data) {
  const temas = data.temas;
  if (!temas || temas.length === 0) return;
  const primero = temas[0];
  document.getElementById('now-name').textContent = primero.Titulo;
  document.getElementById('now-orq').textContent  = primero.Orquesta + ' · ' + primero.Anio;
  document.getElementById('m-tanda-sub').textContent = primero.Estilo + ' · ' + primero.Orquesta;
  document.getElementById('time-total').textContent  = primero.Duracion;
}

// Arrancar
fetchTanda('Tango');
console.log('MilongIA panel v0.1 · motor listo');
