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

// ── API Apps Script ────────────────────────────────────────────────────────
// Cuando el backend esté listo, reemplazar con:
//
// const GAS_URL = 'https://script.google.com/macros/s/TU_ID/exec';
//
// async function fetchEstado() {
//   try {
//     const res  = await fetch(GAS_URL + '?action=getEstado');
//     const data = await res.json();
//     renderEstado(data);
//   } catch (e) {
//     console.warn('Sin conexión con el motor:', e);
//   }
// }
// fetchEstado();
// setInterval(fetchEstado, 10000);

console.log('MilongIA panel v0.1 · motor listo');
