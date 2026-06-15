/* MilongIA · panel.js v0.3 · reproducción real desde Google Sheets */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw5NVX8ICStvL-jp4XvuA21SD0JOLYPoHWuDsalDGZh8bpmoMzuMcPquFxLrZihsdGj/exec';

// ── Estado global ─────────────────────────────────────────────────────────
let biblioteca   = [];   // todos los temas activos de Sheets
let indexActual  = 0;    // posición en la lista
let ytPlayer     = null; // instancia del player de YouTube
let estadoPanel  = 'idle'; // 'idle' | 'playing' | 'paused' | 'stopped'
let progressTimer = null;

// ── YouTube IFrame API ────────────────────────────────────────────────────
// La API llama a esta función cuando está lista
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('yt-player', {
    height: '1',
    width: '1',
    videoId: '',
    playerVars: { autoplay: 0, controls: 0 },
    events: {
      onStateChange: onPlayerStateChange,
      onError: onPlayerError,
    }
  });
};

function onPlayerStateChange(event) {
  // 0 = ended → avanzar al siguiente tema
  if (event.data === YT.PlayerState.ENDED) {
    avanzarTema();
  }
}

function onPlayerError(event) {
  console.warn('Error YouTube player:', event.data);
  // Intentar con el siguiente tema si el actual falla
  setTimeout(avanzarTema, 1500);
}

// ── Carga desde Google Sheets ─────────────────────────────────────────────
async function fetchBiblioteca() {
  mostrarEstadoCarga('Cargando temas desde la biblioteca…');
  try {
    const res  = await fetch(GAS_URL + '?action=getBiblioteca');
    const data = await res.json();
    biblioteca = data; // ya vienen filtrados por Activo=SI desde Apps Script
    console.log('MilongIA: biblioteca cargada,', biblioteca.length, 'temas');
    mostrarEstadoCarga(null);
    renderBibliotecaCargada();
  } catch (e) {
    console.warn('Error cargando biblioteca:', e);
    mostrarEstadoCarga('No se pudo conectar con la biblioteca. Verificá la conexión.');
  }
}

// ── Controles principales ─────────────────────────────────────────────────
function iniciarMilonga() {
  if (!biblioteca.length) return;
  if (estadoPanel === 'paused') {
    reanudar();
    return;
  }
  estadoPanel = 'playing';
  indexActual = 0;
  actualizarBotones();
  reproducirTema(indexActual);
}

function pausarMilonga() {
  if (estadoPanel !== 'playing') return;
  estadoPanel = 'paused';
  if (ytPlayer) ytPlayer.pauseVideo();
  if (progressTimer) clearInterval(progressTimer);
  actualizarBotones();
  setEl('ia-texto', 'Milonga en pausa.');
}

function reanudar() {
  estadoPanel = 'playing';
  if (ytPlayer) ytPlayer.playVideo();
  actualizarBotones();
  const tema = biblioteca[indexActual];
  if (tema) iniciarProgress(tema.Duracion);
}

function stopMilonga() {
  estadoPanel = 'stopped';
  if (ytPlayer) ytPlayer.stopVideo();
  if (progressTimer) clearInterval(progressTimer);
  actualizarBotones();
  resetProgressUI();
  setEl('now-name', '—');
  setEl('now-orq',  '—');
  setEl('ia-texto', 'Milonga detenida.');
  renderCola([]);
}

// ── Reproducción de temas ─────────────────────────────────────────────────
function reproducirTema(index) {
  if (index >= biblioteca.length) {
    finDeLaNoche();
    return;
  }

  const tema = biblioteca[index];
  const videoId = extraerVideoId(tema.URL);

  if (!videoId) {
    console.warn('URL inválida para:', tema.Titulo, tema.URL);
    avanzarTema();
    return;
  }

  // Cargar y reproducir en YouTube
  if (ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.loadVideoById(videoId);
  }

  renderTemaActual(tema, index);
  renderCola(biblioteca.slice(index + 1, index + 6));
  iniciarProgress(tema.Duracion);
}

function avanzarTema() {
  if (estadoPanel !== 'playing') return;
  indexActual++;
  reproducirTema(indexActual);
}

// ── Render de la UI ───────────────────────────────────────────────────────
function renderTemaActual(tema, index) {
  setEl('now-name',    tema.Titulo);
  setEl('now-orq',     `${tema.Orquesta} · ${tema.Anio}`);
  setEl('m-tanda-sub', `${tema.Estilo} · ${tema.Orquesta}`);
  setEl('time-total',  tema.Duracion);
  setEl('ia-texto',    mensajeEstado(tema));

  const chips = document.getElementById('now-chips');
  if (chips) {
    chips.innerHTML = `
      <span class="chip ch-${tema.Estilo.toLowerCase()}">${tema.Estilo}</span>
      <span class="chip ch-gold">${tema.BPM > 0 ? tema.BPM + ' BPM' : '—'}</span>
      <span class="chip ch-gold">Energía ${(tema.Energia || '').toLowerCase()}</span>
    `;
  }

  const footer = document.querySelector('.ia-inline span');
  if (footer) footer.textContent = `Tema ${index + 1} de ${biblioteca.length} · sin IA aún`;

  // Actualizar métrica de tanda
  setEl('m-tanda', `${index + 1} / ${biblioteca.length}`);
}

function renderBibliotecaCargada() {
  // Muestra un resumen de lo que cargó antes de iniciar
  setEl('now-name', 'Listo para iniciar');
  setEl('now-orq',  `${biblioteca.length} temas cargados desde la biblioteca`);
  setEl('m-tanda',  `0 / ${biblioteca.length}`);
  setEl('ia-texto', 'IA aún sin datos de respuesta de pista. Reproduciendo en orden de biblioteca.');

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = '<span class="chip ch-cortina">Sin datos aún</span>';

  // Mostrar los primeros temas en la cola como preview
  renderCola(biblioteca.slice(0, 5));
}

function renderCola(temas) {
  const lista = document.getElementById('queue-list');
  if (!lista) return;

  if (!temas.length) {
    lista.innerHTML = '<div class="q-item"><div class="q-info"><div class="q-track">Cola vacía</div></div></div>';
    return;
  }

  lista.innerHTML = temas.map((t, i) => {
    const esNext = i === 0;
    return `
      <div class="q-item ${esNext ? 'q-next' : ''}">
        ${esNext
          ? '<i class="ti ti-arrow-right q-arrow" aria-hidden="true"></i>'
          : `<span class="q-num">${indexActual + i + 2}</span>`}
        <div class="q-info">
          <div class="q-track">${t.Titulo} · ${t.Orquesta}</div>
          <div class="q-orq">${t.Duracion} · ${(t.Energia || '').toLowerCase()}</div>
        </div>
        <span class="chip ch-${(t.Estilo || '').toLowerCase()}">${t.Estilo}</span>
      </div>`;
  }).join('');
}

// ── Botones ───────────────────────────────────────────────────────────────
function actualizarBotones() {
  const btnIniciar = document.getElementById('btn-iniciar');
  const btnPausar  = document.getElementById('btn-pausar');
  const btnStop    = document.getElementById('btn-stop');

  if (!btnIniciar) return;

  if (estadoPanel === 'idle' || estadoPanel === 'stopped') {
    btnIniciar.disabled = !biblioteca.length;
    btnIniciar.innerHTML = '<i class="ti ti-player-play"></i> Iniciar milonga';
    btnPausar.disabled  = true;
    btnStop.disabled    = true;
  } else if (estadoPanel === 'playing') {
    btnIniciar.disabled = true;
    btnPausar.disabled  = false;
    btnStop.disabled    = false;
    btnPausar.innerHTML = '<i class="ti ti-player-pause"></i> Pausar';
  } else if (estadoPanel === 'paused') {
    btnIniciar.disabled = false;
    btnIniciar.innerHTML = '<i class="ti ti-player-play"></i> Continuar';
    btnPausar.disabled  = true;
    btnStop.disabled    = false;
  }
}

// ── Progreso del tema ─────────────────────────────────────────────────────
function iniciarProgress(duracion) {
  if (progressTimer) clearInterval(progressTimer);
  const partes   = (duracion || '0:00').split(':');
  const totalSeg = (+partes[0]) * 60 + (+partes[1] || 0);
  let curSeg     = 0;

  progressTimer = setInterval(() => {
    curSeg++;
    const pct = Math.min((curSeg / totalSeg) * 100, 100);
    const pf  = document.getElementById('progress-fill');
    const tc  = document.getElementById('time-current');
    if (pf) pf.style.width = pct.toFixed(1) + '%';
    if (tc) tc.textContent = Math.floor(curSeg / 60) + ':' + (curSeg % 60).toString().padStart(2, '0');
    if (curSeg >= totalSeg) clearInterval(progressTimer);
  }, 1000);
}

function resetProgressUI() {
  const pf = document.getElementById('progress-fill');
  const tc = document.getElementById('time-current');
  const tt = document.getElementById('time-total');
  if (pf) pf.style.width = '0%';
  if (tc) tc.textContent = '0:00';
  if (tt) tt.textContent = '0:00';
}

// ── Estado de carga ───────────────────────────────────────────────────────
function mostrarEstadoCarga(msg) {
  const el = document.getElementById('carga-estado');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// ── Fin de la noche ───────────────────────────────────────────────────────
function finDeLaNoche() {
  estadoPanel = 'stopped';
  actualizarBotones();
  setEl('now-name', 'Fin de la milonga');
  setEl('now-orq',  'Todos los temas reproducidos');
  setEl('ia-texto', 'La noche terminó. ¡Hasta la próxima!');
  renderCola([]);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function extraerVideoId(url) {
  if (!url) return null;
  const match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function mensajeEstado(tema) {
  if (!tema) return 'Sin datos de IA aún.';
  const e = tema.Energia || '';
  if (e === 'Alta')  return 'Sin datos de pista aún · reproduciendo en orden de biblioteca.';
  if (e === 'Suave') return 'Sin datos de pista aún · reproduciendo en orden de biblioteca.';
  return 'Sin datos de pista aún · reproduciendo en orden de biblioteca.';
}

// ── Reloj ─────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  setEl('evento-hora',
    now.getHours().toString().padStart(2, '0') + ':' +
    now.getMinutes().toString().padStart(2, '0'));
}

// ── Sliders de audio ──────────────────────────────────────────────────────
function initSliders() {
  ['vol', 'bass', 'treble'].forEach(id => {
    const s = document.getElementById(id);
    const o = document.getElementById(id + '-out');
    if (s && o) s.addEventListener('input', () => o.textContent = Math.round(s.value));
  });
}

// ── Arranque ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateClock();
  setInterval(updateClock, 30000);
  initSliders();
  actualizarBotones();
  fetchBiblioteca();
});

console.log('MilongIA panel v0.3 · modo real activo');
