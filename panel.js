/* MilongIA · panel.js v0.4 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw5NVX8ICStvL-jp4XvuA21SD0JOLYPoHWuDsalDGZh8bpmoMzuMcPquFxLrZihsdGj/exec';

// ── Estado global ─────────────────────────────────────────────────────────
let biblioteca    = [];
let indexActual   = 0;
let ytPlayer      = null;
let ytReady       = false;
let estadoPanel   = 'idle';
let progressTimer = null;

// ── YouTube IFrame API ────────────────────────────────────────────────────
// Solo se llama cuando el usuario presiona Iniciar por primera vez
function initYouTubePlayer(videoId, onReady) {
  if (ytPlayer) {
    // Player ya existe, cargar video directamente
    ytPlayer.loadVideoById(videoId);
    return;
  }

  ytPlayer = new YT.Player('yt-player', {
    height: '150',
    width:  '200',
    videoId: videoId,
    playerVars: {
      autoplay:   1,
      controls:   0,
      origin:     'https://disenoweeb.github.io',
      enablejsapi: 1,
    },
    events: {
      onReady:       () => { ytReady = true; if (onReady) onReady(); },
      onStateChange: onPlayerStateChange,
      onError:       onPlayerError,
    }
  });
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.ENDED) avanzarTema();
}

function onPlayerError(event) {
  console.warn('YouTube error código:', event.data);
  setTimeout(avanzarTema, 1500);
}

// ── YouTube IFrame API ready (callback global requerido) ──────────────────
window.onYouTubeIframeAPIReady = function () {
  console.log('MilongIA: YouTube API lista');
  // No inicializamos el player aquí — esperamos que el usuario presione Iniciar
};

// ── Carga desde Google Sheets ─────────────────────────────────────────────
async function fetchBiblioteca() {
  mostrarEstadoCarga('Cargando temas desde la biblioteca…');
  try {
    const res  = await fetch(GAS_URL + '?action=getBiblioteca');
    const data = await res.json();
    biblioteca = data;
    console.log('MilongIA: biblioteca cargada,', biblioteca.length, 'temas');
    mostrarEstadoCarga(null);
    renderBibliotecaCargada();
    actualizarBotones();
  } catch (e) {
    console.warn('Error cargando biblioteca:', e);
    mostrarEstadoCarga('Error al conectar con la biblioteca.');
  }
}

// ── Controles principales ─────────────────────────────────────────────────
function iniciarMilonga() {
  if (!biblioteca.length) return;
  if (estadoPanel === 'paused') { reanudar(); return; }

  estadoPanel  = 'playing';
  indexActual  = 0;
  actualizarBotones();
  actualizarLiveBadge();
  reproducirTema(indexActual);
}

function pausarMilonga() {
  if (estadoPanel !== 'playing') return;
  estadoPanel = 'paused';
  if (ytPlayer && ytReady) ytPlayer.pauseVideo();
  if (progressTimer) clearInterval(progressTimer);
  actualizarBotones();
  actualizarLiveBadge();
  setEl('ia-texto', 'Milonga en pausa.');
}

function reanudar() {
  estadoPanel = 'playing';
  if (ytPlayer && ytReady) ytPlayer.playVideo();
  actualizarBotones();
  actualizarLiveBadge();
  const tema = biblioteca[indexActual];
  if (tema) iniciarProgress(tema.Duracion);
}

function stopMilonga() {
  estadoPanel = 'stopped';
  if (ytPlayer && ytReady) ytPlayer.stopVideo();
  if (progressTimer) clearInterval(progressTimer);
  actualizarBotones();
  actualizarLiveBadge();
  resetProgressUI();
  setEl('now-name', '—');
  setEl('now-orq',  '—');
  setEl('ia-texto', 'Milonga detenida.');
  renderCola([]);
}

// ── Reproducción ──────────────────────────────────────────────────────────
function reproducirTema(index) {
  if (index >= biblioteca.length) { finDeLaNoche(); return; }

  const tema    = biblioteca[index];
  const videoId = extraerVideoId(tema.URL);

  if (!videoId) {
    console.warn('URL inválida:', tema.Titulo, tema.URL);
    avanzarTema();
    return;
  }

  renderTemaActual(tema, index);
  renderCola(biblioteca.slice(index + 1, index + 6));

  // Primera vez: crear el player con el video ya cargado
  initYouTubePlayer(videoId, () => {
    // onReady solo se llama la primera vez; el autoplay=1 ya lo arranca
    iniciarProgress(tema.Duracion);
  });

  // Si el player ya existía, iniciar progress directamente
  if (ytReady) iniciarProgress(tema.Duracion);
}

function avanzarTema() {
  if (estadoPanel !== 'playing') return;
  indexActual++;
  reproducirTema(indexActual);
}

// ── Render ────────────────────────────────────────────────────────────────
function renderBibliotecaCargada() {
  setEl('now-name', 'Listo para iniciar');
  setEl('now-orq',  biblioteca.length + ' temas cargados desde la biblioteca');
  setEl('m-tanda',  '0 / ' + biblioteca.length);
  setEl('ia-texto', 'Sin datos de pista aún. Reproducirá en orden de biblioteca.');

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = '<span class="chip ch-cortina">Sin datos aún</span>';

  // Preview de los primeros temas en la cola
  renderCola(biblioteca.slice(0, 5));

  // Actualizar live badge
  const badge = document.getElementById('live-badge');
  if (badge) badge.innerHTML = '<div class="live-dot" style="background:#c9a84c"></div> ' + biblioteca.length + ' temas listos';
}

function renderTemaActual(tema, index) {
  setEl('now-name',    tema.Titulo);
  setEl('now-orq',     tema.Orquesta + ' · ' + tema.Anio);
  setEl('m-tanda-sub', tema.Estilo + ' · ' + tema.Orquesta);
  setEl('m-tanda',     (index + 1) + ' / ' + biblioteca.length);
  setEl('time-total',  tema.Duracion);
  setEl('ia-texto',    'Sin datos de pista aún · reproduciendo en orden de biblioteca.');

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML =
    '<span class="chip ch-' + tema.Estilo.toLowerCase() + '">' + tema.Estilo + '</span>' +
    '<span class="chip ch-gold">' + (tema.BPM > 0 ? tema.BPM + ' BPM' : '—') + '</span>' +
    '<span class="chip ch-gold">Energía ' + (tema.Energia || '').toLowerCase() + '</span>';

  const footer = document.querySelector('.ia-inline span');
  if (footer) footer.textContent = 'Tema ' + (index + 1) + ' de ' + biblioteca.length + ' · sin IA aún';
}

function renderCola(temas) {
  const lista = document.getElementById('queue-list');
  if (!lista) return;

  if (!temas.length) {
    lista.innerHTML = '<div class="q-item"><div class="q-info"><div class="q-track">Cola vacía</div></div></div>';
    return;
  }

  lista.innerHTML = temas.map(function(t, i) {
    var esNext = i === 0;
    var num    = indexActual + i + 2;
    return '<div class="q-item ' + (esNext ? 'q-next' : '') + '">' +
      (esNext
        ? '<i class="ti ti-arrow-right q-arrow" aria-hidden="true"></i>'
        : '<span class="q-num">' + num + '</span>') +
      '<div class="q-info">' +
        '<div class="q-track">' + t.Titulo + ' · ' + t.Orquesta + '</div>' +
        '<div class="q-orq">' + t.Duracion + ' · ' + (t.Energia || '').toLowerCase() + '</div>' +
      '</div>' +
      '<span class="chip ch-' + (t.Estilo || '').toLowerCase() + '">' + t.Estilo + '</span>' +
      '</div>';
  }).join('');
}

// ── Botones ───────────────────────────────────────────────────────────────
function actualizarBotones() {
  var btnIniciar = document.getElementById('btn-iniciar');
  var btnPausar  = document.getElementById('btn-pausar');
  var btnStop    = document.getElementById('btn-stop');
  if (!btnIniciar) return;

  if (estadoPanel === 'idle' || estadoPanel === 'stopped') {
    btnIniciar.disabled = !biblioteca.length;
    btnIniciar.innerHTML = '<i class="ti ti-player-play"></i> Iniciar milonga';
    btnPausar.disabled = true;
    btnStop.disabled   = true;
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

function actualizarLiveBadge() {
  var badge = document.getElementById('live-badge');
  if (!badge) return;
  if (estadoPanel === 'playing') {
    badge.innerHTML = '<div class="live-dot"></div> En vivo · reproduciendo';
  } else if (estadoPanel === 'paused') {
    badge.innerHTML = '<div class="live-dot" style="background:#c9a84c"></div> En pausa';
  } else {
    badge.innerHTML = '<div class="live-dot" style="background:#888"></div> Detenido';
  }
}

// ── Progreso ──────────────────────────────────────────────────────────────
function iniciarProgress(duracion) {
  if (progressTimer) clearInterval(progressTimer);
  var partes   = (duracion || '0:00').split(':');
  var totalSeg = (+partes[0]) * 60 + (+(partes[1] || 0));
  var curSeg   = 0;

  progressTimer = setInterval(function() {
    curSeg++;
    var pct = Math.min((curSeg / totalSeg) * 100, 100);
    var pf  = document.getElementById('progress-fill');
    var tc  = document.getElementById('time-current');
    if (pf) pf.style.width = pct.toFixed(1) + '%';
    if (tc) tc.textContent = Math.floor(curSeg / 60) + ':' + (curSeg % 60).toString().padStart(2, '0');
    if (curSeg >= totalSeg) clearInterval(progressTimer);
  }, 1000);
}

function resetProgressUI() {
  var pf = document.getElementById('progress-fill');
  var tc = document.getElementById('time-current');
  var tt = document.getElementById('time-total');
  if (pf) pf.style.width = '0%';
  if (tc) tc.textContent = '0:00';
  if (tt) tt.textContent = '0:00';
}

// ── Estado de carga ───────────────────────────────────────────────────────
function mostrarEstadoCarga(msg) {
  var el = document.getElementById('carga-estado');
  if (!el) return;
  el.textContent    = msg || '';
  el.style.display  = msg ? 'block' : 'none';
}

// ── Fin de la noche ───────────────────────────────────────────────────────
function finDeLaNoche() {
  estadoPanel = 'stopped';
  actualizarBotones();
  actualizarLiveBadge();
  setEl('now-name', 'Fin de la milonga');
  setEl('now-orq',  'Todos los temas reproducidos');
  setEl('ia-texto', '¡La noche terminó!');
  renderCola([]);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function extraerVideoId(url) {
  if (!url) return null;
  var match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function setEl(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Reloj ─────────────────────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  setEl('evento-hora',
    now.getHours().toString().padStart(2, '0') + ':' +
    now.getMinutes().toString().padStart(2, '0'));
}

// ── Sliders ───────────────────────────────────────────────────────────────
function initSliders() {
  ['vol', 'bass', 'treble'].forEach(function(id) {
    var s = document.getElementById(id);
    var o = document.getElementById(id + '-out');
    if (s && o) s.addEventListener('input', function() { o.textContent = Math.round(s.value); });
  });
}

// ── Arranque ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  updateClock();
  setInterval(updateClock, 30000);
  initSliders();
  actualizarBotones();
  fetchBiblioteca();
});

console.log('MilongIA panel v0.4 · modo real activo');
