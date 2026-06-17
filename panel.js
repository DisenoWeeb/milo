/* MilongIA · panel.js v0.5 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw5NVX8ICStvL-jp4XvuA21SD0JOLYPoHWuDsalDGZh8bpmoMzuMcPquFxLrZihsdGj/exec';

// ⚠️ Reemplazar por la URL del GAS de Cámara una vez deployado
const CAMARA_GAS_URL = 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID_CAMARA/exec';

const CORTINA_DURACION_SEG = 45;    // cortar cortina a los 45 s
const POLLING_INTERVAL_MS  = 30000; // chequear biblioteca cada 30 s
const PISTA_POLLING_MS     = 30000; // chequear conteo de pista cada 30 s
const ABANDONO_UMBRAL_PCT  = 25;    // % de caída en personas para marcar "abandono"
const ABANDONO_VENTANA_MIN = 5;     // comparar contra el conteo de hace N minutos

// ── Estado global ──────────────────────────────────────────────────────────
let biblioteca    = [];   // array de temas en orden
let indexActual   = 0;
let ytPlayer      = null;
let ytReady       = false;
let estadoPanel   = 'idle';
let progressTimer = null;
let cortinaTimer  = null; // timer exclusivo para cortar cortina
let pollingTimer  = null; // intervalo de polling de biblioteca

// ── Estado de pista (cámara) ─────────────────────────────────────────────
let historialPista   = []; // [{timestamp, personas}, ...]
let pistaPollingTimer = null;

// ── YouTube IFrame API ─────────────────────────────────────────────────────
function initYouTubePlayer(videoId) {
  if (ytPlayer) {
    // Player ya existe — solo cargar el video; el progress arranca en onStateChange
    ytPlayer.loadVideoById(videoId);
    return;
  }

  ytPlayer = new YT.Player('yt-player', {
    height: '150',
    width:  '200',
    videoId: videoId,
    playerVars: {
      autoplay:    1,
      controls:    0,
      origin:      location.origin,
      enablejsapi: 1,
    },
    events: {
      onReady:       onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError:       onPlayerError,
    }
  });
}

function onPlayerReady() {
  ytReady = true;
  // El video ya empezó a reproducirse (autoplay=1).
  // Arrancamos el progress usando el tema actual.
  const tema = biblioteca[indexActual];
  if (tema && estadoPanel === 'playing') iniciarProgress(tema);
}

function onPlayerStateChange(event) {
  // PLAYING (1): arrancamos progress solo si el player ya existía (no primera vez)
  if (event.data === YT.PlayerState.PLAYING && ytReady) {
    const tema = biblioteca[indexActual];
    if (tema && estadoPanel === 'playing') iniciarProgress(tema);
  }
  if (event.data === YT.PlayerState.ENDED) avanzarTema();
}

function onPlayerError(event) {
  console.warn('YouTube error código:', event.data);
  setTimeout(avanzarTema, 1500);
}

window.onYouTubeIframeAPIReady = function () {
  console.log('MilongIA: YouTube API lista');
};

// ── Polling de biblioteca ──────────────────────────────────────────────────
function iniciarPolling() {
  if (pollingTimer) return; // ya corriendo
  pollingTimer = setInterval(fetchBiblioteca, POLLING_INTERVAL_MS);
}

// ── Carga desde Google Sheets ──────────────────────────────────────────────
async function fetchBiblioteca() {
  // Primera carga: mostramos estado; en polling silencioso
  const esPrimeraCarga = biblioteca.length === 0;
  if (esPrimeraCarga) mostrarEstadoCarga('Cargando temas desde la biblioteca…');

  try {
    const res  = await fetch(GAS_URL + '?action=getBiblioteca');
    const data = await res.json();

    if (esPrimeraCarga) {
      // ── Primera carga: tomar todo tal cual ──────────────────────────────
      biblioteca = data;
      mostrarEstadoCarga(null);
      renderBibliotecaCargada();
      actualizarBotones();
      iniciarPolling();

    } else {
      // ── Polling: sincronizar sin interrumpir el tema actual ──────────────
      const idsSheet   = new Set(data.map(t => t.ID));
      const temaActual = biblioteca[indexActual]; // lo que suena ahora

      // Temas ya reproducidos (antes de indexActual): los dejamos intactos
      const yaReproducidos = biblioteca.slice(0, indexActual + 1);

      // Cola pendiente: solo los que siguen existiendo en el Sheet + los nuevos del Sheet
      const idsYaEnCola = new Set(yaReproducidos.map(t => t.ID));
      const colaNueva   = data.filter(t => !idsYaEnCola.has(t.ID));

      const longitudAntes = biblioteca.length;
      biblioteca = yaReproducidos.concat(colaNueva);

      // Recalcular indexActual por si el tema actual cambió de posición
      // (en teoría no cambia porque está en yaReproducidos, pero por seguridad)
      const nuevoIndex = biblioteca.findIndex(t => t.ID === temaActual.ID);
      if (nuevoIndex !== -1 && nuevoIndex !== indexActual) {
        indexActual = nuevoIndex;
      }

      const diff = biblioteca.length - longitudAntes;
      if (diff > 0) {
        mostrarToast('+' + diff + ' tema' + (diff > 1 ? 's' : '') + ' agregado' + (diff > 1 ? 's' : ''));
        console.log('MilongIA: +' + diff + ' temas. Total:', biblioteca.length);
      } else if (diff < 0) {
        mostrarToast(Math.abs(diff) + ' tema' + (Math.abs(diff) > 1 ? 's' : '') + ' eliminado' + (Math.abs(diff) > 1 ? 's' : '') + ' de la cola');
        console.log('MilongIA: ' + diff + ' temas eliminados. Total:', biblioteca.length);
      }

      if (diff !== 0 && estadoPanel === 'playing') {
        renderCola(biblioteca.slice(indexActual + 1, indexActual + 6));
        actualizarContadorTemas();
      }
    }

  } catch (e) {
    console.warn('Error cargando biblioteca:', e);
    if (esPrimeraCarga) mostrarEstadoCarga('Error al conectar con la biblioteca.');
  }
}

// ── Controles principales ──────────────────────────────────────────────────
function iniciarMilonga() {
  if (!biblioteca.length) return;
  if (estadoPanel === 'paused') { reanudar(); return; }

  estadoPanel = 'playing';
  indexActual = 0;
  actualizarBotones();
  actualizarLiveBadge();
  reproducirTema(indexActual);
}

function pausarMilonga() {
  if (estadoPanel !== 'playing') return;
  estadoPanel = 'paused';
  if (ytPlayer && ytReady) ytPlayer.pauseVideo();
  detenerTimers();
  actualizarBotones();
  actualizarLiveBadge();
  setEl('ia-texto', 'Milonga en pausa.');
}

function reanudar() {
  estadoPanel = 'playing';
  if (ytPlayer && ytReady) ytPlayer.playVideo();
  actualizarBotones();
  actualizarLiveBadge();
  // el progress retoma desde onPlayerStateChange → PLAYING
}

function stopMilonga() {
  estadoPanel = 'stopped';
  if (ytPlayer && ytReady) ytPlayer.stopVideo();
  detenerTimers();
  actualizarBotones();
  actualizarLiveBadge();
  resetProgressUI();
  setEl('now-name', '—');
  setEl('now-orq',  '—');
  setEl('ia-texto', 'Milonga detenida.');
  renderCola([]);
}

// ── Reproducción ───────────────────────────────────────────────────────────
function reproducirTema(index) {
  if (index >= biblioteca.length) { finDeLaNoche(); return; }

  const tema    = biblioteca[index];
  const videoId = extraerVideoId(tema.URL);

  if (!videoId) {
    console.warn('URL inválida:', tema.Titulo, tema.URL);
    avanzarTema();
    return;
  }

  detenerTimers(); // limpiar progress y cortina anteriores
  renderTemaActual(tema, index);
  renderCola(biblioteca.slice(index + 1, index + 6));

  // Si es cortina → programar corte a los 45 s
  if (esCortina(tema)) {
    cortinaTimer = setTimeout(function () {
      console.log('MilongIA: cortina cortada a los ' + CORTINA_DURACION_SEG + 's');
      avanzarTema();
    }, CORTINA_DURACION_SEG * 1000);
  }

  initYouTubePlayer(videoId);
  // El progress arranca desde onPlayerReady (primera vez) o onPlayerStateChange PLAYING (siguientes)
}

function avanzarTema() {
  if (estadoPanel !== 'playing') return;
  indexActual++;
  reproducirTema(indexActual);
}

function esCortina(tema) {
  return (tema.Estilo || '').toLowerCase() === 'cortina';
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderBibliotecaCargada() {
  setEl('now-name', 'Listo para iniciar');
  setEl('now-orq',  biblioteca.length + ' temas cargados desde la biblioteca');
  actualizarContadorTemas();
  setEl('ia-texto', 'Sin datos de pista aún. Reproducirá en orden de biblioteca.');

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = '<span class="chip ch-cortina">Sin datos aún</span>';

  renderCola(biblioteca.slice(0, 5));

  const badge = document.getElementById('live-badge');
  if (badge) badge.innerHTML = '<div class="live-dot" style="background:#c9a84c"></div> ' + biblioteca.length + ' temas listos';
}

function renderTemaActual(tema, index) {
  setEl('now-name',    tema.Titulo);
  setEl('now-orq',     tema.Orquesta + ' · ' + tema.Anio);
  setEl('m-tanda-sub', tema.Estilo + ' · ' + tema.Orquesta);
  setEl('m-tanda',     (index + 1) + ' / ' + biblioteca.length);
  setEl('ia-texto',    esCortina(tema)
    ? '🎵 Cortina · se cortará automáticamente a los ' + CORTINA_DURACION_SEG + 's.'
    : 'Sin datos de pista aún · reproduciendo en orden de biblioteca.');

  // Duración visual: cortina muestra 0:45 aunque el video sea más largo
  const duracionMostrar = esCortina(tema) ? '0:' + CORTINA_DURACION_SEG : tema.Duracion;
  setEl('time-total', duracionMostrar);

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML =
    '<span class="chip ch-' + (tema.Estilo || '').toLowerCase() + '">' + tema.Estilo + '</span>' +
    '<span class="chip ch-gold">' + (tema.BPM > 0 ? tema.BPM + ' BPM' : '—') + '</span>' +
    '<span class="chip ch-gold">Energía ' + (tema.Energia || '').toLowerCase() + '</span>';

  const footer = document.querySelector('.ia-inline span');
  if (footer) footer.textContent = 'Tema ' + (index + 1) + ' de ' + biblioteca.length + ' · sin IA aún';
}

function actualizarContadorTemas() {
  setEl('m-tanda', (estadoPanel === 'playing' ? (indexActual + 1) : '0') + ' / ' + biblioteca.length);
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
        '<div class="q-orq">' + (esCortina(t) ? '0:45' : t.Duracion) + ' · ' + (t.Energia || '').toLowerCase() + '</div>' +
      '</div>' +
      '<span class="chip ch-' + (t.Estilo || '').toLowerCase() + '">' + t.Estilo + '</span>' +
      '</div>';
  }).join('');
}

// ── Botones ────────────────────────────────────────────────────────────────
function actualizarBotones() {
  var btnIniciar = document.getElementById('btn-iniciar');
  var btnPausar  = document.getElementById('btn-pausar');
  var btnStop    = document.getElementById('btn-stop');
  if (!btnIniciar) return;

  if (estadoPanel === 'idle' || estadoPanel === 'stopped') {
    btnIniciar.disabled  = !biblioteca.length;
    btnIniciar.innerHTML = '<i class="ti ti-player-play"></i> Iniciar milonga';
    btnPausar.disabled   = true;
    btnStop.disabled     = true;
  } else if (estadoPanel === 'playing') {
    btnIniciar.disabled  = true;
    btnPausar.disabled   = false;
    btnStop.disabled     = false;
    btnPausar.innerHTML  = '<i class="ti ti-player-pause"></i> Pausar';
  } else if (estadoPanel === 'paused') {
    btnIniciar.disabled  = false;
    btnIniciar.innerHTML = '<i class="ti ti-player-play"></i> Continuar';
    btnPausar.disabled   = true;
    btnStop.disabled     = false;
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

// ── Progreso ───────────────────────────────────────────────────────────────
function iniciarProgress(tema) {
  if (progressTimer) clearInterval(progressTimer);

  // Para cortinas, el total visible es siempre 45 s
  var durStr   = esCortina(tema) ? '0:' + CORTINA_DURACION_SEG : (tema.Duracion || '0:00');
  var partes   = durStr.split(':');
  var totalSeg = (+partes[0]) * 60 + (+(partes[1] || 0));
  var curSeg   = 0;

  setEl('time-total', durStr);

  progressTimer = setInterval(function () {
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

// ── Timers helpers ─────────────────────────────────────────────────────────
function detenerTimers() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  if (cortinaTimer)  { clearTimeout(cortinaTimer);   cortinaTimer  = null; }
}

// ── Toast notificación temas nuevos ───────────────────────────────────────
function mostrarToast(msg) {
  var toast = document.getElementById('milongia-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'milongia-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px',
      'background:#1a1a1a', 'color:#c9a84c',
      'border:1px solid #c9a84c', 'border-radius:8px',
      'padding:10px 18px', 'font-size:13px',
      'z-index:9999', 'opacity:0',
      'transition:opacity .3s'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(function () { toast.style.opacity = '0'; }, 3000);
}

// ── Estado de carga ────────────────────────────────────────────────────────
function mostrarEstadoCarga(msg) {
  var el = document.getElementById('carga-estado');
  if (!el) return;
  el.textContent   = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// ── Fin de la noche ────────────────────────────────────────────────────────
function finDeLaNoche() {
  estadoPanel = 'stopped';
  actualizarBotones();
  actualizarLiveBadge();
  setEl('now-name', 'Fin de la milonga');
  setEl('now-orq',  'Todos los temas reproducidos');
  setEl('ia-texto', '¡La noche terminó!');
  renderCola([]);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function extraerVideoId(url) {
  if (!url) return null;
  var match = url.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

function setEl(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ── Reloj ──────────────────────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  setEl('evento-hora',
    now.getHours().toString().padStart(2, '0') + ':' +
    now.getMinutes().toString().padStart(2, '0'));
}

// ── Sliders ────────────────────────────────────────────────────────────────
function initSliders() {
  ['vol', 'bass', 'treble'].forEach(function (id) {
    var s = document.getElementById(id);
    var o = document.getElementById(id + '-out');
    if (s && o) s.addEventListener('input', function () { o.textContent = Math.round(s.value); });
  });
}

// ── Pista (cámara) ──────────────────────────────────────────────────────
async function fetchPista() {
  try {
    const res  = await fetch(CAMARA_GAS_URL + '?action=getPista');
    const data = await res.json();

    if (!Array.isArray(data)) return; // respuesta inesperada, ignorar

    historialPista = data;
    actualizarUIPista();

  } catch (e) {
    console.warn('MilongIA: error leyendo pista de cámara:', e);
  }
}

function iniciarPollingPista() {
  if (pistaPollingTimer) return;
  fetchPista(); // primera lectura inmediata
  pistaPollingTimer = setInterval(fetchPista, PISTA_POLLING_MS);
}

function actualizarUIPista() {
  if (!historialPista.length) return;

  const ultimo = historialPista[historialPista.length - 1];
  setEl('m-pista', ultimo.personas != null ? ultimo.personas : '—');

  const referencia = buscarConteoHaceMinutos(ABANDONO_VENTANA_MIN);
  if (referencia == null || !ultimo.personas) {
    setEl('m-pista-sub', 'sin referencia aún');
    return;
  }

  const caida = referencia > 0
    ? Math.round(((referencia - ultimo.personas) / referencia) * 100)
    : 0;

  if (caida >= ABANDONO_UMBRAL_PCT) {
    setEl('m-pista-sub', '↓ ' + caida + '% · posible abandono');
    marcarAbandono(true, caida);
  } else {
    setEl('m-pista-sub', referencia + ' hace ' + ABANDONO_VENTANA_MIN + 'min');
    marcarAbandono(false, caida);
  }
}

// ── Buscar el conteo registrado hace aproximadamente N minutos ──────────
function buscarConteoHaceMinutos(minutos) {
  if (historialPista.length < 2) return null;

  const ahora       = new Date(historialPista[historialPista.length - 1].timestamp);
  const objetivoMs  = ahora.getTime() - minutos * 60 * 1000;

  // Buscar el registro más cercano (hacia atrás) a ese momento
  let masCercano = null;
  let menorDiff  = Infinity;

  historialPista.forEach(function (registro) {
    const t    = new Date(registro.timestamp).getTime();
    const diff = Math.abs(t - objetivoMs);
    if (diff < menorDiff) {
      menorDiff  = diff;
      masCercano = registro;
    }
  });

  return masCercano ? masCercano.personas : null;
}

// ── Reflejar estado de abandono en la barra "Abandono" del panel ────────
function marcarAbandono(activo, pct) {
  const bar = document.getElementById('bar-abandono');
  if (!bar) return;
  bar.style.width = Math.min(Math.max(pct, 0), 100) + '%';

  const fila = bar.closest('.p-row');
  const val  = fila ? fila.querySelector('.p-val') : null;
  if (val) val.textContent = pct + '%';
}

// ── Arranque ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  updateClock();
  setInterval(updateClock, 30000);
  initSliders();
  actualizarBotones();
  fetchBiblioteca();   // carga inicial + arranca polling al completar
  iniciarPollingPista(); // arranca lectura de conteo de personas (cámara)
});

console.log('MilongIA panel v0.5 · polling activo · cortina 45s');
