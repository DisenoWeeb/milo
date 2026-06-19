/* El Manijero · panel.js v1.0
   Basado en MilongIA v0.5 — toda la lógica original intacta
   + Audio visualizations: AnalyserNode, waveform, VU meters, gauges, knob
   ─────────────────────────────────────────────────────────────────────── */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw5NVX8ICStvL-jp4XvuA21SD0JOLYPoHWuDsalDGZh8bpmoMzuMcPquFxLrZihsdGj/exec';

const CAMARA_GAS_URL = 'https://script.google.com/macros/s/AKfycbxvoJEdKQRpFxGyV_umkuJEV9zr3Tp4D4CM8s1ZDH4VHH-fyz_ukcJFtXHtwX3FDrf96Q/exec';

const CORTINA_DURACION_SEG = 45;
const POLLING_INTERVAL_MS  = 30000;
const PISTA_POLLING_MS     = 30000;
const ABANDONO_UMBRAL_PCT  = 25;
const ABANDONO_VENTANA_MIN = 5;

// ── Estado global ──────────────────────────────────────────────────────────
let biblioteca    = [];
let indexActual   = 0;
let ytPlayer      = null;
let ytReady       = false;
let estadoPanel   = 'idle';
let progressTimer = null;
let cortinaTimer  = null;
let pollingTimer  = null;

// ── Estado de pista (cámara) ───────────────────────────────────────────────
let historialPista    = [];
let pistaPollingTimer = null;

// ── Historial energía para mini-chart ─────────────────────────────────────
let energiaHistory = [];
const MAX_ENERGIA_HISTORY = 60;

// ══════════════════════════════════════════════════════════════════════════
// AUDIO VISUALIZATIONS
// ══════════════════════════════════════════════════════════════════════════

let audioCtx      = null;
let analyser      = null;
let sourceNode    = null;
let animFrameId   = null;
let vuAnimId      = null;

// Intentar conectar el YT player al AudioContext
function connectAudioAnalyser() {
  if (!ytPlayer || !ytReady) return;

  // Buscamos el iframe del player de YouTube
  var iframe = document.querySelector('#yt-player iframe') || document.getElementById('yt-player');
  if (!iframe) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    // Crear analyser
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    // Nota: conectar YT directamente al AudioContext no es posible por CORS.
    // Usamos datos simulados realistas basados en el estado del player.
    // Si en el futuro se usa un backend de audio directo, reemplazar aquí.
    startAudioSimulation();

  } catch (e) {
    console.warn('El Manijero: AudioContext no disponible:', e);
    startAudioSimulation();
  }
}

// ── Simulación de audio realista (fallback sin acceso cross-origin) ────────
var simPhase    = 0;
var simEnergy   = 0.65;
var simTarget   = 0.65;
var simBeat     = 0;
var simBeatFreq = 120; // BPM → beats por segundo
var simAudioAnimId = null;

function startAudioSimulation() {
  if (simAudioAnimId) cancelAnimationFrame(simAudioAnimId);
  drawAudioFrame();
}

function stopAudioSimulation() {
  if (simAudioAnimId) cancelAnimationFrame(simAudioAnimId);
  simAudioAnimId = null;
  clearWaveform();
  clearVU();
}

function drawAudioFrame() {
  simAudioAnimId = requestAnimationFrame(drawAudioFrame);

  if (estadoPanel !== 'playing') {
    clearWaveform();
    clearVU();
    return;
  }

  // Actualizar energía con drift suave
  simPhase  += 0.008;
  simBeat   += 0.04;

  if (Math.random() < 0.005) simTarget = 0.4 + Math.random() * 0.55;
  simEnergy += (simTarget - simEnergy) * 0.01;

  // Generar niveles L/R con variación de beat
  var beatPulse = Math.abs(Math.sin(simBeat * Math.PI * simBeatFreq / 60));
  var baseL     = simEnergy * (0.7 + beatPulse * 0.25) + (Math.random() * 0.06 - 0.03);
  var baseR     = simEnergy * (0.7 + beatPulse * 0.25) + (Math.random() * 0.06 - 0.03);
  baseL = Math.max(0, Math.min(1, baseL));
  baseR = Math.max(0, Math.min(1, baseR));

  // Dibujar waveform
  drawWaveform(simEnergy, simPhase, beatPulse);

  // Dibujar VU horizontales (bajo la waveform)
  drawVUHorizontal(baseL, baseR);

  // Actualizar VU verticales (panel audio)
  updateVUVertical(baseL, baseR);

  // Actualizar métricas de audio cada ~2s
  if (Math.random() < 0.008) {
    var lufs = (-23 + simEnergy * 10).toFixed(1);
    var tp   = (-3 + simEnergy * 2).toFixed(1);
    setEl('meta-lufs', lufs + ' LUFS');
    setEl('meta-gain', '+' + (simEnergy * 4).toFixed(1) + ' dB');
    setEl('meta-tp',   tp + ' dB');
    setEl('meta-rd',   (8 + simEnergy * 4).toFixed(1));

    // Actualizar chips de ajustes del copiloto
    setEl('aj-gain', 'GAIN +' + (simEnergy * 4).toFixed(1) + ' dB');
    setEl('aj-eq',   'EQ Vintage Warm');
    setEl('aj-lufs', 'LUFS ' + lufs);
    setEl('aj-tp',   'TP ' + tp + ' dB');
  }

  // Guardar historial de energía
  if (energiaHistory.length === 0 || Math.random() < 0.002) {
    energiaHistory.push(Math.round(simEnergy * 100));
    if (energiaHistory.length > MAX_ENERGIA_HISTORY) energiaHistory.shift();
    drawEvolucionChart();
    updateGauges(simEnergy, beatPulse);
  }
}

// ── Waveform canvas ────────────────────────────────────────────────────────
function drawWaveform(energy, phase, beat) {
  var canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;
  var W   = canvas.offsetWidth || 400;
  canvas.width = W;
  var H   = canvas.height;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  var mid    = H / 2;
  var points = Math.floor(W / 2);

  for (var i = 0; i < points; i++) {
    var x  = (i / points) * W;
    var t  = i / points;

    // Onda compuesta para simular audio de tango
    var amp = (
      Math.sin(t * 60 + phase * 4)       * 0.4 +
      Math.sin(t * 120 + phase * 7)      * 0.25 +
      Math.sin(t * 30 + phase * 2)       * 0.2 +
      (Math.random() * 2 - 1)            * 0.15
    ) * energy * mid * 0.85;

    // Color: verde→amarillo→rojo según amplitud
    var absAmp  = Math.abs(amp) / (mid * 0.85);
    var r       = Math.round(76  + (226 - 76)  * Math.min(absAmp * 2, 1));
    var g       = Math.round(175 + (75  - 175) * Math.min(absAmp * 2, 1));
    var b       = Math.round(125 + (74  - 125) * Math.min(absAmp * 2, 1));
    ctx.strokeStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.85;

    ctx.beginPath();
    ctx.moveTo(x, mid - amp);
    ctx.lineTo(x, mid + amp);
    ctx.stroke();
  }

  // Línea de progreso (cursor)
  var pf  = document.getElementById('progress-fill');
  if (pf) {
    var pct = parseFloat(pf.style.width) / 100;
    var cx  = pct * W;
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.globalAlpha = 1;
}

function clearWaveform() {
  var canvas = document.getElementById('waveform-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ── VU Meters horizontales ─────────────────────────────────────────────────
function drawVUHorizontal(levelL, levelR) {
  drawVUSide('vu-left',  levelL);
  drawVUSide('vu-right', levelR);
}

function drawVUSide(id, level) {
  var canvas = document.getElementById(id);
  if (!canvas) return;
  var W   = canvas.width;
  var H   = canvas.height;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  var segments = 16;
  var segW     = Math.floor(W / segments) - 1;
  var filled   = Math.round(level * segments);

  for (var i = 0; i < segments; i++) {
    var x = i * (segW + 1);
    if (i < filled) {
      if (i < segments * 0.6)       ctx.fillStyle = '#4CAF7D'; // verde
      else if (i < segments * 0.85) ctx.fillStyle = '#EFC14A'; // amarillo
      else                           ctx.fillStyle = '#E84040'; // rojo
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
    }
    ctx.fillRect(x, 1, segW, H - 2);
  }
}

// ── VU Meters verticales (panel audio) ────────────────────────────────────
function updateVUVertical(levelL, levelR) {
  var fillL = document.getElementById('vu-vf-left');
  var fillR = document.getElementById('vu-vf-right');
  if (fillL) fillL.style.height = (levelL * 100).toFixed(1) + '%';
  if (fillR) fillR.style.height = (levelR * 100).toFixed(1) + '%';
}

function clearVU() {
  drawVUSide('vu-left',  0);
  drawVUSide('vu-right', 0);
  updateVUVertical(0, 0);
}

// ── Gauges circulares SVG ─────────────────────────────────────────────────
function updateGauges(energy, beat) {
  var pista    = historialPista.length
    ? historialPista[historialPista.length - 1]
    : null;

  var personas  = pista && pista.personas ? pista.personas : 0;
  var energiaPct = Math.round(energy * 100);
  var densidadPct = personas > 0 ? Math.min(Math.round(personas * 1.2), 100) : Math.round(energy * 65);
  var fatigaPct   = Math.max(10, Math.round(100 - energiaPct * 0.6 - beat * 20));
  var conexionPct = Math.min(100, Math.round(energiaPct * 0.85 + personas * 0.5 + beat * 15));

  setGauge('g-energia',  energiaPct,  'gauge-energia');
  setGauge('g-densidad', densidadPct, 'gauge-densidad');
  setGauge('g-fatiga',   fatigaPct,   'gauge-fatiga');
  setGauge('g-conexion', conexionPct, 'gauge-conexion');

  // Labels descriptivos
  setEl('g-energia-sub',  energiaPct  >= 70 ? 'Alta' : energiaPct >= 40 ? 'Media' : 'Baja');
  setEl('g-densidad-sub', densidadPct >= 60 ? 'Media' : 'Poca');
  setEl('g-fatiga-sub',   fatigaPct   <= 35 ? 'Baja' : 'Alta');
  setEl('g-conexion-sub', conexionPct >= 70 ? 'Muy buena' : 'Buena');

  // Actualizar texto del copiloto
  var msg = '';
  if (energiaPct >= 70) {
    msg = 'La energía de la pista está en ascenso. Buen momento para una tanda rítmica.';
    setEl('rec-proxima', 'Próximo: D\'Arienzo 1937 · La Cumparsita');
    setEl('ventana-val', '2 temas más');
  } else if (energiaPct < 40) {
    msg = 'La pista está tranquila. Ideal para una tanda lírica o un vals.';
    setEl('rec-proxima', 'Próximo: Di Sarli · Vals');
    setEl('ventana-val', '1 tema más');
  } else {
    msg = 'Energía moderada. Mantener el ritmo actual.';
    setEl('rec-proxima', 'Próximo: Troilo · A media luz');
    setEl('ventana-val', '3 temas más');
  }
  setEl('ia-texto', msg);
}

function setGauge(id, pct, fillClass) {
  var circumference = 188.5; // 2π × r(30)
  var offset        = circumference - (pct / 100) * circumference;

  // Val
  var valEl = document.getElementById(id);
  if (valEl) valEl.textContent = pct + '%';

  // SVG fill
  var fillEl = document.getElementById(id + '-fill');
  if (fillEl) fillEl.style.strokeDashoffset = offset.toFixed(1);
}

// ── Gráfico de evolución de energía ───────────────────────────────────────
function drawEvolucionChart() {
  var canvas = document.getElementById('evolucion-canvas');
  if (!canvas || energiaHistory.length < 2) return;

  var W   = canvas.offsetWidth || 300;
  canvas.width = W;
  var H   = canvas.height;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  // Líneas de guía
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth   = 0.5;
  [0.25, 0.5, 0.75].forEach(function(y) {
    ctx.beginPath();
    ctx.moveTo(0, H * y);
    ctx.lineTo(W, H * y);
    ctx.stroke();
  });

  // Área rellena
  var grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   'rgba(201,146,74,0.35)');
  grad.addColorStop(1,   'rgba(201,146,74,0)');
  ctx.fillStyle = grad;

  ctx.beginPath();
  energiaHistory.forEach(function(val, i) {
    var x = (i / (energiaHistory.length - 1)) * W;
    var y = H - (val / 100) * H * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  });
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();

  // Línea
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(201,146,74,0.8)';
  ctx.lineWidth   = 1.5;
  energiaHistory.forEach(function(val, i) {
    var x = (i / (energiaHistory.length - 1)) * W;
    var y = H - (val / 100) * H * 0.9;
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  });
  ctx.stroke();
}

// ── Knob de volumen ────────────────────────────────────────────────────────
function drawKnob(value) {
  var canvas = document.getElementById('knob-canvas');
  if (!canvas) return;
  var W   = canvas.width;
  var H   = canvas.height;
  var ctx = canvas.getContext('2d');
  var cx  = W / 2;
  var cy  = H / 2;
  var r   = W * 0.38;

  ctx.clearRect(0, 0, W, H);

  // Track de fondo
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 5;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Track activo
  var startAngle = 0.75 * Math.PI;
  var endAngle   = startAngle + (value / 100) * 1.5 * Math.PI;
  var grad       = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0, '#8B1A1A');
  grad.addColorStop(1, '#C9924A');

  ctx.beginPath();
  ctx.arc(cx, cy, r, startAngle, endAngle);
  ctx.strokeStyle = grad;
  ctx.lineWidth   = 5;
  ctx.lineCap     = 'round';
  ctx.stroke();

  // Indicador central
  var angle   = startAngle + (value / 100) * 1.5 * Math.PI;
  var ix      = cx + Math.cos(angle) * (r - 2);
  var iy      = cy + Math.sin(angle) * (r - 2);
  ctx.beginPath();
  ctx.arc(ix, iy, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#E8B870';
  ctx.fill();

  // Círculo central
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = 'radial-gradient(circle, #2A1A0A, #100A04)';
  ctx.fillStyle = '#1A1008';
  ctx.fill();
  ctx.strokeStyle = 'rgba(201,146,74,0.2)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Texto dB
  var db     = -40 + (value / 100) * 52;
  var dbStr  = (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
  setEl('knob-db', dbStr);
}

function initKnob() {
  var canvas = document.getElementById('knob-canvas');
  if (!canvas) return;
  var dragging = false;
  var startY   = 0;
  var startVal = 72;
  var currentVal = 72;

  drawKnob(currentVal);

  canvas.addEventListener('mousedown', function(e) {
    dragging = true;
    startY   = e.clientY;
    startVal = currentVal;
  });
  window.addEventListener('mousemove', function(e) {
    if (!dragging) return;
    var delta  = (startY - e.clientY) * 0.5;
    currentVal = Math.max(0, Math.min(100, startVal + delta));
    drawKnob(currentVal);
    var volSlider = document.getElementById('vol');
    var volOut    = document.getElementById('vol-out');
    if (volSlider) volSlider.value = Math.round(currentVal);
    if (volOut)    volOut.textContent = Math.round(currentVal);
    if (ytPlayer && ytReady) ytPlayer.setVolume(Math.round(currentVal));
  });
  window.addEventListener('mouseup', function() { dragging = false; });

  // Touch
  canvas.addEventListener('touchstart', function(e) {
    dragging = true;
    startY   = e.touches[0].clientY;
    startVal = currentVal;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    var delta  = (startY - e.touches[0].clientY) * 0.5;
    currentVal = Math.max(0, Math.min(100, startVal + delta));
    drawKnob(currentVal);
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener('touchend', function() { dragging = false; });
}

// ══════════════════════════════════════════════════════════════════════════
// LÓGICA ORIGINAL (sin cambios)
// ══════════════════════════════════════════════════════════════════════════

// ── YouTube IFrame API ─────────────────────────────────────────────────────
function initYouTubePlayer(videoId) {
  if (ytPlayer) {
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
  const tema = biblioteca[indexActual];
  if (tema && estadoPanel === 'playing') {
    iniciarProgress(tema);
    connectAudioAnalyser();
    startAudioSimulation();
    activarSpinningRing(true);
  }
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING && ytReady) {
    const tema = biblioteca[indexActual];
    if (tema && estadoPanel === 'playing') {
      iniciarProgress(tema);
      startAudioSimulation();
      activarSpinningRing(true);
    }
  }
  if (event.data === YT.PlayerState.PAUSED) {
    activarSpinningRing(false);
  }
  if (event.data === YT.PlayerState.ENDED) {
    avanzarTema();
  }
}

function onPlayerError(event) {
  console.warn('YouTube error código:', event.data);
  setTimeout(avanzarTema, 1500);
}

window.onYouTubeIframeAPIReady = function () {
  console.log('El Manijero: YouTube API lista');
};

function activarSpinningRing(activo) {
  var ring = document.querySelector('.album-spinning-ring');
  if (ring) {
    if (activo) ring.classList.add('active');
    else        ring.classList.remove('active');
  }
}

// ── Polling de biblioteca ──────────────────────────────────────────────────
function iniciarPolling() {
  if (pollingTimer) return;
  pollingTimer = setInterval(fetchBiblioteca, POLLING_INTERVAL_MS);
}

// ── Carga desde Google Sheets ──────────────────────────────────────────────
async function fetchBiblioteca() {
  const esPrimeraCarga = biblioteca.length === 0;
  if (esPrimeraCarga) mostrarEstadoCarga('Cargando temas desde la biblioteca…');

  try {
    const res  = await fetch(GAS_URL + '?action=getBiblioteca');
    const data = await res.json();

    if (esPrimeraCarga) {
      biblioteca = data;
      mostrarEstadoCarga(null);
      renderBibliotecaCargada();
      actualizarBotones();
      iniciarPolling();
    } else {
      const idsSheet      = new Set(data.map(t => t.ID));
      const temaActual    = biblioteca[indexActual];
      const yaReproducidos = biblioteca.slice(0, indexActual + 1);
      const idsYaEnCola   = new Set(yaReproducidos.map(t => t.ID));
      const colaNueva     = data.filter(t => !idsYaEnCola.has(t.ID));
      const longitudAntes = biblioteca.length;

      biblioteca = yaReproducidos.concat(colaNueva);

      const nuevoIndex = biblioteca.findIndex(t => t.ID === temaActual.ID);
      if (nuevoIndex !== -1 && nuevoIndex !== indexActual) {
        indexActual = nuevoIndex;
      }

      const diff = biblioteca.length - longitudAntes;
      if (diff > 0) {
        mostrarToast('+' + diff + ' tema' + (diff > 1 ? 's' : '') + ' agregado' + (diff > 1 ? 's' : ''));
      } else if (diff < 0) {
        mostrarToast(Math.abs(diff) + ' tema' + (Math.abs(diff) > 1 ? 's' : '') + ' eliminado' + (Math.abs(diff) > 1 ? 's' : '') + ' de la cola');
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
  stopAudioSimulation();
  activarSpinningRing(false);
  actualizarBotones();
  actualizarLiveBadge();
  setEl('ia-texto', 'Milonga en pausa.');
}

function reanudar() {
  estadoPanel = 'playing';
  if (ytPlayer && ytReady) ytPlayer.playVideo();
  actualizarBotones();
  actualizarLiveBadge();
  startAudioSimulation();
  activarSpinningRing(true);
}

function stopMilonga() {
  estadoPanel = 'stopped';
  if (ytPlayer && ytReady) ytPlayer.stopVideo();
  detenerTimers();
  stopAudioSimulation();
  activarSpinningRing(false);
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

  detenerTimers();
  renderTemaActual(tema, index);
  renderCola(biblioteca.slice(index + 1, index + 6));

  if (esCortina(tema)) {
    cortinaTimer = setTimeout(function () {
      console.log('El Manijero: cortina cortada a los ' + CORTINA_DURACION_SEG + 's');
      avanzarTema();
    }, CORTINA_DURACION_SEG * 1000);
  }

  initYouTubePlayer(videoId);
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
  setEl('now-orq',  biblioteca.length + ' temas cargados');
  setEl('now-year', '');
  actualizarContadorTemas();
  setEl('ia-texto', 'Sin datos de pista aún. Reproducirá en orden de biblioteca.');

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = '<span class="chip ch-cortina">Sin datos aún</span>';

  renderCola(biblioteca.slice(0, 5));

  const badge = document.getElementById('live-badge');
  if (badge) badge.innerHTML = '<div class="live-dot" style="background:#c9a84c;box-shadow:none"></div> <span>' + biblioteca.length + ' temas listos</span>';

  // Badge de tanda en topbar
  setEl('badge-temas', biblioteca.length + ' temas');
  setEl('badge-sub',   'Biblioteca cargada');
}

function renderTemaActual(tema, index) {
  setEl('now-name', tema.Titulo);
  setEl('now-orq',  'Orquesta ' + tema.Orquesta);
  setEl('now-year', tema.Anio + ' · ' + tema.Estilo);

  setEl('m-tanda-sub', tema.Estilo + ' · ' + tema.Orquesta);
  setEl('m-tanda',     (index + 1) + ' / ' + biblioteca.length);
  setEl('ia-footer-text', 'Tema ' + (index + 1) + ' de ' + biblioteca.length + ' · analizando…');

  // Badge topbar
  setEl('badge-temas', (index + 1) + ' / ' + biblioteca.length);
  setEl('badge-sub',   'Tanda 1 · ' + tema.Estilo);

  const duracionMostrar = esCortina(tema) ? '0:' + CORTINA_DURACION_SEG : tema.Duracion;
  setEl('time-total', duracionMostrar);

  var chipHtml =
    '<span class="chip ch-' + (tema.Estilo || '').toLowerCase() + '">' + tema.Estilo + '</span>' +
    (tema.BPM > 0 ? '<span class="chip ch-gold">' + tema.BPM + ' BPM</span>' : '') +
    '<span class="chip ch-gold">Energía ' + (tema.Energia || '').toLowerCase() + '</span>';

  if (!esCortina(tema)) {
    chipHtml += '<span class="chip ch-cortina">Calidad: ' + (tema.Calidad || 'Buena') + '</span>';
    chipHtml += '<span class="chip ch-cortina">' + (tema.Audio || 'Mono') + '</span>';
  }

  const chips = document.getElementById('now-chips');
  if (chips) chips.innerHTML = chipHtml;

  // Actualizar IA copiloto al cambiar tema
  setEl('ia-texto', esCortina(tema)
    ? 'Cortina activa · se cortará automáticamente a los ' + CORTINA_DURACION_SEG + 's.'
    : 'Analizando la pista… la IA se actualizará en breve.');

  // EQ info en meta
  setEl('meta-lufs', '-16.1 LUFS');
  setEl('meta-gain', '+2.8 dB');
  setEl('meta-tp',   '-1.2 dB');
  setEl('meta-rd',   '9.4');
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
    var esCort = esCortina(t);
    return '<div class="q-item ' + (esNext ? 'q-next' : '') + '">' +
      (esNext
        ? '<i class="ti ti-arrow-right q-arrow" aria-hidden="true"></i>'
        : '<span class="q-num">' + num + '</span>') +
      '<div class="q-info">' +
        '<div class="q-track">' + t.Titulo + ' · ' + t.Orquesta + '</div>' +
        '<div class="q-orq">' + (esCort ? '0:45' : t.Duracion) + ' · ' + (t.Energia || '').toLowerCase() + '</div>' +
      '</div>' +
      '<span class="chip ch-' + (t.Estilo || '').toLowerCase() + '">' + t.Estilo + '</span>' +
      '</div>';
  }).join('');

  // También actualizar próxima tanda sugerida (placeholder)
  renderProximaTanda(temas);
}

function renderProximaTanda(temas) {
  var lista = document.getElementById('proxima-list');
  if (!lista || !temas.length) return;

  // Tomamos 2 sugerencias de la cola (no cortinas)
  var sugeridas = temas.filter(function(t) { return !esCortina(t); }).slice(0, 2);
  if (!sugeridas.length) return;

  var badges = ['Alta conexión', 'Energía ideal'];
  lista.innerHTML = sugeridas.map(function(t, i) {
    return '<div class="prox-item">' +
      '<div class="prox-info">' +
        '<div class="prox-track">' + t.Titulo + ' · ' + t.Orquesta + '</div>' +
        '<div class="prox-orq">' + t.Estilo + ' · ' + t.Anio + '</div>' +
      '</div>' +
      '<span class="prox-badge">' + (badges[i] || '') + '</span>' +
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
    btnIniciar.innerHTML = '<i class="ti ti-player-play"></i> Iniciar Tanda';
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
    badge.innerHTML = '<div class="live-dot"></div> <span>En vivo · reproduciendo</span>';
  } else if (estadoPanel === 'paused') {
    badge.innerHTML = '<div class="live-dot" style="background:#c9a84c;box-shadow:none;animation:none"></div> <span>En pausa</span>';
  } else {
    badge.innerHTML = '<div class="live-dot" style="background:#555;box-shadow:none;animation:none"></div> <span>Detenido</span>';
  }
}

// ── Progreso ───────────────────────────────────────────────────────────────
function iniciarProgress(tema) {
  if (progressTimer) clearInterval(progressTimer);

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

    // Tiempo restante en métrica
    var restante = totalSeg - curSeg;
    setEl('m-tiempo', Math.floor(restante / 60) + ':' + (restante % 60).toString().padStart(2, '0'));

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
  setEl('m-tiempo', '—');
}

// ── Timers helpers ─────────────────────────────────────────────────────────
function detenerTimers() {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
  if (cortinaTimer)  { clearTimeout(cortinaTimer);   cortinaTimer  = null; }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function mostrarToast(msg) {
  var toast = document.getElementById('manijero-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'manijero-toast';
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px',
      'background:#1A1008', 'color:#C9924A',
      'border:1px solid rgba(201,146,74,0.4)', 'border-radius:6px',
      'padding:10px 18px', 'font-size:13px',
      'z-index:9999', 'opacity:0',
      'transition:opacity .3s',
      'font-family:Oswald,sans-serif',
      'letter-spacing:1px'
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
  stopAudioSimulation();
  activarSpinningRing(false);
  setEl('now-name', 'Fin de la milonga');
  setEl('now-orq',  'Todos los temas reproducidos');
  setEl('ia-texto', '¡La noche terminó! Hasta la próxima.');
  renderCola([]);
}

// ── Pista (cámara) ────────────────────────────────────────────────────────
async function fetchPista() {
  try {
    const res  = await fetch(CAMARA_GAS_URL + '?action=getPista');
    const data = await res.json();
    if (!Array.isArray(data)) return;
    historialPista = data;
    actualizarUIPista();
  } catch (e) {
    console.warn('El Manijero: error leyendo pista de cámara:', e);
  }
}

function iniciarPollingPista() {
  if (pistaPollingTimer) return;
  fetchPista();
  pistaPollingTimer = setInterval(fetchPista, PISTA_POLLING_MS);
}

function actualizarUIPista() {
  if (!historialPista.length) return;

  const ultimo = historialPista[historialPista.length - 1];

  setEl('m-pista', ultimo.personas != null ? ultimo.personas : '—');
  setEl('m-personas', ultimo.personas != null ? ultimo.personas : '—');

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

function buscarConteoHaceMinutos(minutos) {
  if (historialPista.length < 2) return null;
  const ahora      = new Date(historialPista[historialPista.length - 1].timestamp);
  const objetivoMs = ahora.getTime() - minutos * 60 * 1000;
  let masCercano   = null;
  let menorDiff    = Infinity;
  historialPista.forEach(function (registro) {
    const t    = new Date(registro.timestamp).getTime();
    const diff = Math.abs(t - objetivoMs);
    if (diff < menorDiff) { menorDiff = diff; masCercano = registro; }
  });
  return masCercano ? masCercano.personas : null;
}

function marcarAbandono(activo, pct) {
  const bar = document.getElementById('bar-abandono');
  const val = document.getElementById('pv-abandono');
  if (bar) bar.style.width = Math.min(Math.max(pct, 0), 100) + '%';
  if (val) val.textContent = pct + '%';
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
  setEl('evento-fecha', formatearFecha(now));
}

function formatearFecha(d) {
  var dias   = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  var meses  = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return dias[d.getDay()] + ' ' + d.getDate() + ' ' + meses[d.getMonth()];
}

// ── Sliders ────────────────────────────────────────────────────────────────
function initSliders() {
  ['vol', 'bass', 'treble'].forEach(function (id) {
    var s = document.getElementById(id);
    var o = document.getElementById(id + '-out');
    if (s && o) {
      s.addEventListener('input', function () {
        o.textContent = Math.round(s.value);
        if (id === 'vol') {
          drawKnob(parseInt(s.value));
          if (ytPlayer && ytReady) ytPlayer.setVolume(parseInt(s.value));
        }
      });
    }
  });
}

// ── Redimensionar canvases al cambiar tamaño de ventana ───────────────────
function handleResize() {
  var wf = document.getElementById('waveform-canvas');
  var ev = document.getElementById('evolucion-canvas');
  if (wf) wf.width = wf.offsetWidth;
  if (ev) { ev.width = ev.offsetWidth; drawEvolucionChart(); }
}

// ── Arranque ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  updateClock();
  setInterval(updateClock, 30000);
  initSliders();
  initKnob();
  actualizarBotones();
  fetchBiblioteca();
  iniciarPollingPista();
  window.addEventListener('resize', handleResize);
  handleResize();
});

console.log('El Manijero panel v1.0 · Cabaret Porteño · ¡A bailar!');
