/**
 * NOVA — orquestador de la interfaz.
 *
 * Junta las piezas: la API en streaming, las letras que se materializan, la
 * nube de palabras, la voz y el nivel de audio. Maneja dos vistas de lo
 * mismo —la consola, para operar; el escenario, para proyectar— y conduce
 * la función: de quién es el turno y qué va quedando definido.
 */

import { detectMode, streamChat, settings, DEFAULT_MODEL, DEFAULT_PROMPT } from './js/api.js';
import { Materializer } from './js/materialize.js';
import { WordCloud } from './js/wordcloud.js';
import { Listener, Speaker, makeSentenceSplitter, voiceSupport } from './js/voice.js';
import { VoiceMeter } from './js/audio.js';
import { Show } from './js/show.js';

const $ = (id) => document.getElementById(id);

const el = {
  body: document.body,
  status: $('status'),
  statusLabel: document.querySelector('.status__label'),
  stageBtn: $('stageBtn'),
  settingsBtn: $('settingsBtn'),
  settings: $('settings'),
  settingsForm: $('settingsForm'),
  settingsMode: $('settingsMode'),
  keyInput: $('keyInput'),
  modelInput: $('modelInput'),
  promptInput: $('promptInput'),
  orb: $('orb'),
  sceneOrb: $('sceneOrb'),
  coreCaption: $('coreCaption'),
  micBtn: $('micBtn'),
  micHint: $('micHint'),
  log: $('log'),
  welcome: $('welcome'),
  composer: $('composer'),
  input: $('input'),
  sendBtn: $('sendBtn'),
  voiceToggle: $('voiceToggle'),
  stopBtn: $('stopBtn'),
  clearBtn: $('clearBtn'),
  scene: $('scene'),
  sceneLabel: $('sceneLabel'),
  sceneText: $('sceneText'),
  sceneState: $('sceneState'),
  sceneHeard: $('sceneHeard'),
  toast: $('toast'),

  // función
  showBtn: $('showBtn'),
  show: $('show'),
  showClose: $('showClose'),
  altaForm: $('altaForm'),
  altaNombre: $('altaNombre'),
  plantel: $('plantel'),
  acuerdosLista: $('acuerdosLista'),
  muroBtn: $('muroBtn'),
  borrarAcuerdos: $('borrarAcuerdos'),
  turnos: $('turnos'),
  turnosLista: $('turnosLista'),
  pinBtn: $('pinBtn'),
  sceneQuien: $('sceneQuien'),
  sceneNombre: $('sceneNombre'),
  muroGrilla: $('muroGrilla'),
  muroSub: $('muroSub'),
};

/* --------------------------------------------------------------- estado */

const state = {
  messages: [],          // historial que se manda a la API
  busy: false,
  controller: null,      // para cortar una respuesta a mitad
  pendingSpeech: [],     // frases dictadas esperando envío
  silenceTimer: null,
  mode: 'demo',          // servidor, directo o demo
  escena: 'charla',      // portada, charla o muro
  ultimaPregunta: '',    // para saber de qué trata el último acuerdo
  ultimaRespuesta: '',   // lo que se fija con la tecla A
};

const SILENCE_MS = 1400;  // pausa que se toma como "terminó de hablar"

const cloud = new WordCloud($('cloud'));
const sceneWriter = new Materializer(el.sceneText, { charsPerSecond: 38 });
const speaker = new Speaker();
const meter = new VoiceMeter();
const show = new Show();
const sentences = makeSentenceSplitter((s) => speaker.say(s));

const listener = new Listener({
  onStart: () => setMode('listening'),
  onPartial: (text) => showHeard(text, false),
  onFinal: (text) => queueSpeech(text),
  onError: (msg) => {
    toast(msg);
    setMicActive(false);
    setMode('idle');
  },
  onEnd: () => {
    if (!listener.active && !state.busy) setMode('idle');
  },
});

/* ---------------------------------------------------------- arranque */

init();

async function init() {
  wireEvents();
  autoGrow(el.input);

  show.subscribe(() => pintarFuncion());
  conectarMedidor();
  verEscena('charla');

  await refreshMode({ announce: true });

  if (!voiceSupport.listen) {
    el.micBtn.disabled = true;
    el.micBtn.title = 'Este navegador no reconoce voz. Probá con Chrome o Edge.';
    el.micHint.textContent = 'Voz no disponible';
  }
  setupVoicePreference();

  speaker.onStart = () => {
    listener.pauseForPlayback();
    setMode('speaking');
  };
  speaker.onEnd = () => {
    listener.resumeAfterPlayback();
    if (!state.busy) setMode(listener.active ? 'listening' : 'idle');
  };
}

/**
 * Averigua de dónde van a salir las respuestas y lo refleja en pantalla.
 */
async function refreshMode({ announce = false } = {}) {
  const found = await detectMode();
  state.mode = found.mode;

  const shown = {
    server: ['online', 'En línea'],
    direct: ['online', 'En línea'],
    demo: ['demo', 'Modo demo'],
  }[found.mode];
  setStatus(shown[0], shown[1]);

  if (announce && found.mode === 'demo') {
    toast(
      globalThis.NOVA_SOLO_DEMO
        ? 'Esta es una demostración: NOVA responde con un guion guardado. La versión completa se conecta a ChatGPT.'
        : 'Modo demo: NOVA responde con un guion guardado. Para que piense de verdad, cargá tu clave de OpenAI en Conexión.',
    );
  }
  describeMode(found);
  return found;
}

/** El cartelito de arriba del panel de conexión, en castellano claro. */
function describeMode(found) {
  const texto = {
    server: '<strong>Servidor local.</strong> La clave vive en el servidor y el navegador nunca la ve. Es la forma más segura.',
    direct: '<strong>Clave en este navegador.</strong> Los mensajes van directo a OpenAI desde esta computadora.',
    demo: '<strong>Modo demo.</strong> NOVA contesta con respuestas guardadas. Sirve para mostrar la página sin gastar nada.',
  }[found.mode];
  el.settingsMode.innerHTML = texto;
}

/**
 * NOVA habla por defecto: es lo que se espera de ella en una muestra.
 * Si alguien la silencia, esa decisión se recuerda para la próxima.
 */
function setupVoicePreference() {
  if (!voiceSupport.speak) {
    el.voiceToggle.disabled = true;
    el.voiceToggle.title = 'Este navegador no puede sintetizar voz.';
    setVoice(false);
    return;
  }
  setVoice(readStored('nova:voz') !== 'off');
}

function setVoice(on) {
  speaker.enabled = on;
  el.voiceToggle.setAttribute('aria-pressed', String(on));
  if (!on) speaker.cancel();
  writeStored('nova:voz', on ? 'on' : 'off');
}

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // navegación privada o cookies bloqueadas
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch { /* no pasa nada si no se puede guardar */ }
}

/* ------------------------------------------------------ voz que se ve */

/**
 * Conecta el volumen real del micrófono a los visuales. Es lo que hace que
 * el público entienda, sin explicación, que la IA escucha a esa persona.
 */
function conectarMedidor() {
  meter.onLevel = (nivel) => {
    const valor = nivel.toFixed(3);
    el.orb.style.setProperty('--voz', valor);
    el.sceneOrb.style.setProperty('--voz', valor);
    cloud.setEnergy(nivel);
  };
}

/* ----------------------------------------------------------- eventos */

function wireEvents() {
  el.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = el.input.value.trim();
    if (!text) return;
    el.input.value = '';
    autoGrow(el.input);
    send(text);
  });

  el.input.addEventListener('input', () => autoGrow(el.input));
  el.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      el.composer.requestSubmit();
    }
  });

  el.settingsBtn.addEventListener('click', () => openSettings());
  el.settingsForm.addEventListener('submit', (event) => applySettings(event.submitter?.value));

  el.showBtn.addEventListener('click', () => el.show.showModal());
  el.showClose.addEventListener('click', () => el.show.close());
  el.muroBtn.addEventListener('click', () => verEscena(state.escena === 'muro' ? 'charla' : 'muro'));
  el.pinBtn.addEventListener('click', () => fijarAcuerdo());

  el.altaForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const persona = show.addSpeaker(el.altaNombre.value);
    el.altaNombre.value = '';
    el.altaNombre.focus();
    if (!persona) toast('Escribí un nombre para agregarlo.');
  });

  el.borrarAcuerdos.addEventListener('click', () => {
    if (!show.agreements.length) return;
    show.clearAgreements();
    toast('Muro vacío.');
  });

  el.micBtn.addEventListener('click', () => toggleMic());
  el.stageBtn.addEventListener('click', () => toggleStage());
  el.stopBtn.addEventListener('click', () => abort());
  el.clearBtn.addEventListener('click', () => reset());

  el.voiceToggle.addEventListener('click', () => {
    setVoice(!speaker.enabled);
  });

  for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => send(chip.dataset.prompt));
  }

  document.addEventListener('keydown', (event) => {
    // Mientras se escribe en un campo, las teclas son texto y nada más.
    const typing = event.target.matches('input, textarea');

    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      toggleMic();
    }

    // 1 a 9: de quién es el turno.
    if (!typing && /^[1-9]$/.test(event.key)) {
      const persona = show.speakers[Number(event.key) - 1];
      if (persona) {
        event.preventDefault();
        show.setCurrent(persona.id);
      }
    }

    if ((event.key === 'a' || event.key === 'A') && !typing) {
      event.preventDefault();
      fijarAcuerdo();
    }
    if ((event.key === 'm' || event.key === 'M') && !typing) {
      event.preventDefault();
      verEscena(state.escena === 'muro' ? 'charla' : 'muro');
    }
    if ((event.key === 'p' || event.key === 'P') && !typing) {
      event.preventDefault();
      verEscena(state.escena === 'portada' ? 'charla' : 'portada');
    }
    if (event.key === 'Tab' && !typing && show.speakers.length) {
      event.preventDefault();
      show.next();
    }
    if ((event.key === 'f' || event.key === 'F') && !typing) {
      event.preventDefault();
      toggleStage();
    }
    if (event.key === 'Escape') {
      if (state.busy) abort();
      else if (el.body.dataset.mode === 'stage') toggleStage();
    }
  });

  document.addEventListener('fullscreenchange', () => {
    // Si se sale de pantalla completa con F11 o Esc del navegador, volvemos a la consola.
    if (!document.fullscreenElement && el.body.dataset.mode === 'stage') setStageMode(false);
  });
}

/* ----------------------------------------------------------- conexión */

function openSettings() {
  el.keyInput.value = settings.key;
  el.modelInput.value = settings.model;
  el.modelInput.placeholder = DEFAULT_MODEL;
  el.promptInput.value = settings.prompt;
  el.promptInput.placeholder = DEFAULT_PROMPT;
  el.settings.showModal();
}

async function applySettings(action) {
  if (action === 'cancel') return;

  if (action === 'forget') {
    settings.key = '';
    el.keyInput.value = '';
    toast('Clave borrada de este navegador. NOVA vuelve al modo demo.');
  } else if (action === 'save') {
    settings.key = el.keyInput.value;
    settings.model = el.modelInput.value;
    settings.prompt = el.promptInput.value;
  }

  const found = await refreshMode();
  if (action === 'save' && found.mode === 'direct') toast('Listo: NOVA ya responde con tu clave de OpenAI.');
}

/* --------------------------------------------------------- la función */

/** Redibuja todo lo que depende del plantel y de los acuerdos. */
function pintarFuncion() {
  const actual = show.current;

  // Tira de turnos en la consola.
  el.turnos.hidden = show.speakers.length === 0;
  el.turnosLista.innerHTML = '';
  show.speakers.forEach((persona, i) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'turno';
    boton.style.setProperty('--acento', persona.color);
    boton.setAttribute('aria-pressed', String(persona.id === show.currentId));
    boton.innerHTML = `${escapar(persona.name)}${i < 9 ? `<span class="turno__tecla">${i + 1}</span>` : ''}`;
    boton.addEventListener('click', () => show.setCurrent(persona.id));
    el.turnosLista.appendChild(boton);
  });

  // Quién habla, en el escenario.
  el.sceneQuien.classList.toggle('is-visible', Boolean(actual));
  el.sceneNombre.textContent = actual ? actual.name : '';
  el.scene.style.setProperty('--quien', show.currentColor);

  // Plantel dentro del panel.
  el.plantel.innerHTML = '';
  if (!show.speakers.length) {
    el.plantel.innerHTML = '<p class="vacio">Todavía no hay nadie. Agregá a los estudiantes que van a hablar.</p>';
  }
  show.speakers.forEach((persona, i) => {
    const fila = document.createElement('li');
    fila.style.setProperty('--acento', persona.color);
    fila.innerHTML = `
      <span class="plantel__nombre">${escapar(persona.name)}</span>
      <span class="plantel__turno">${persona.id === show.currentId ? 'en turno' : `tecla ${i + 1}`}</span>`;
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'quitar';
    quitar.textContent = '×';
    quitar.title = `Sacar a ${persona.name}`;
    quitar.addEventListener('click', () => show.removeSpeaker(persona.id));
    fila.appendChild(quitar);
    el.plantel.appendChild(fila);
  });

  // Acuerdos dentro del panel.
  el.acuerdosLista.innerHTML = '';
  if (!show.agreements.length) {
    el.acuerdosLista.innerHTML = '<p class="vacio">Nada fijado todavía. Durante la charla, la tecla A guarda la última respuesta.</p>';
  }
  show.agreements.forEach((acuerdo) => {
    const fila = document.createElement('li');
    fila.style.setProperty('--acento', acuerdo.color);
    fila.innerHTML = `
      <span class="acuerdo__tema">${escapar(acuerdo.tema || 'Acuerdo')}</span>
      <span class="acuerdo__texto">${escapar(acuerdo.texto)}</span>`;
    const pie = document.createElement('div');
    pie.className = 'acuerdo__fila';
    pie.innerHTML = `<span class="plantel__turno">${escapar(acuerdo.autor)}</span>`;
    const quitar = document.createElement('button');
    quitar.type = 'button';
    quitar.className = 'quitar';
    quitar.textContent = '×';
    quitar.title = 'Sacar del muro';
    quitar.addEventListener('click', () => show.unpin(acuerdo.id));
    pie.appendChild(quitar);
    fila.appendChild(pie);
    el.acuerdosLista.appendChild(fila);
  });

  pintarMuro();
}

/** El muro que se proyecta: todo lo definido, junto. */
function pintarMuro() {
  el.muroGrilla.innerHTML = '';

  if (!show.agreements.length) {
    el.muroGrilla.innerHTML = '<p class="muro__vacio">Todavía no definimos nada. La noche recién empieza.</p>';
    el.muroSub.textContent = '';
    return;
  }

  const cuantos = show.agreements.length;
  el.muroSub.textContent = `${cuantos} ${cuantos === 1 ? 'acuerdo' : 'acuerdos'} con NOVA`;

  show.agreements.forEach((acuerdo, i) => {
    const tarjeta = document.createElement('article');
    tarjeta.className = 'tarjeta';
    tarjeta.style.setProperty('--acento', acuerdo.color);
    tarjeta.style.setProperty('--i', String(i));
    tarjeta.innerHTML = `
      ${acuerdo.tema ? `<p class="tarjeta__tema">${escapar(acuerdo.tema)}</p>` : ''}
      <p class="tarjeta__texto">${escapar(acuerdo.texto)}</p>
      <p class="tarjeta__autor">con <strong>${escapar(acuerdo.autor)}</strong></p>`;
    el.muroGrilla.appendChild(tarjeta);
  });
}

/** Fija la última respuesta de NOVA en el muro. */
function fijarAcuerdo() {
  if (!state.ultimaRespuesta.trim()) {
    return toast('Todavía no hay ninguna respuesta para fijar.');
  }
  show.pin({
    tema: recortarTema(state.ultimaPregunta),
    texto: comoDefinicion(state.ultimaRespuesta),
  });

  // Un destello en el escenario, para que el público note que algo quedó.
  el.scene.classList.add('acuerdo-fijado');
  setTimeout(() => el.scene.classList.remove('acuerdo-fijado'), 900);
  toast('Acuerdo fijado en el muro.');
}

/**
 * Del texto completo saca lo que entra en una tarjeta proyectada.
 * Corta en el final de una frase, no a mitad de palabra: en el muro tiene
 * que leerse una definición, no un párrafo cortado.
 */
function comoDefinicion(texto) {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= 240) return limpio;

  let corte = 0;
  for (const fin of limpio.matchAll(/[.!?…](\s|$)/g)) {
    if (fin.index + 1 > 240) break;
    corte = fin.index + 1;
  }
  if (corte >= 80) return limpio.slice(0, corte);

  // Sin un punto a mano, se corta en el último espacio antes del límite.
  const espacio = limpio.lastIndexOf(' ', 236);
  return `${limpio.slice(0, espacio > 80 ? espacio : 236)}…`;
}

/** De la pregunta sale el título de la tarjeta. */
function recortarTema(pregunta) {
  const limpio = (pregunta || '').replace(/\s+/g, ' ').trim().replace(/[¿?¡!.]+$/g, '');
  if (!limpio) return '';
  return limpio.length > 52 ? `${limpio.slice(0, 52).trimEnd()}…` : limpio;
}

/** Portada, charla o muro: lo que se ve proyectado. */
function verEscena(nombre) {
  state.escena = nombre;
  el.body.dataset.escena = nombre;
  if (nombre === 'muro') pintarMuro();
  el.muroBtn.textContent = nombre === 'muro' ? 'Volver a la charla' : 'Mostrar el muro';
}

/**
 * Escapa texto antes de meterlo en HTML. Declarada como función y no como
 * const: pintarFuncion() corre al arrancar, antes de que este punto del
 * archivo se haya ejecutado.
 */
function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* -------------------------------------------------------------- micro */

function toggleMic() {
  if (!voiceSupport.listen) return toast('Este navegador no reconoce voz. Probá con Chrome o Edge.');
  const active = listener.toggle();
  setMicActive(active);
  if (active) {
    setMode('listening');
    el.micHint.textContent = 'Escuchando… tocá para cortar';
    // El nivel de voz es lo que mueve los visuales. Si el navegador no deja
    // abrir el micrófono dos veces, la página sigue andando sin reaccionar.
    meter.start().then((ok) => {
      if (!ok) console.info('NOVA: sin medidor de voz; los visuales no reaccionan al volumen.');
    });
  } else {
    meter.stop();
    clearTimeout(state.silenceTimer);
    state.pendingSpeech.length = 0;
    showHeard('', false);
    el.micHint.textContent = 'Tocá para hablar';
    if (!state.busy) setMode('idle');
  }
}

function setMicActive(active) {
  el.micBtn.setAttribute('aria-pressed', String(active));
}

/**
 * Junta lo dictado y espera un silencio antes de mandarlo.
 * Así un grupo puede hablar en varias frases sin que se corte cada vez.
 */
function queueSpeech(text) {
  state.pendingSpeech.push(text);
  showHeard(state.pendingSpeech.join(' '), true);

  clearTimeout(state.silenceTimer);
  state.silenceTimer = setTimeout(() => {
    const full = state.pendingSpeech.join(' ').trim();
    state.pendingSpeech.length = 0;
    if (full) send(full, { fromVoice: true });
  }, SILENCE_MS);
}

function showHeard(text, isFinal) {
  el.sceneHeard.textContent = text;
  el.sceneHeard.classList.toggle('is-live', Boolean(text));
  el.sceneHeard.style.opacity = text ? (isFinal ? '1' : '0.72') : '0';
}

/* ---------------------------------------------------------- conversar */

async function send(text, { fromVoice = false } = {}) {
  if (!text || state.busy) return;

  // Si NOVA estaba hablando, se calla para escuchar lo nuevo.
  speaker.cancel();
  sentences.reset();
  el.welcome?.remove();
  if (state.escena !== 'charla') verEscena('charla');

  state.busy = true;
  el.stopBtn.hidden = false;
  el.sendBtn.disabled = true;
  showHeard('', false);

  addBubble('user', text, { animate: fromVoice });
  cloud.absorb(text, 'user');
  state.messages.push({ role: 'user', content: text });
  state.ultimaPregunta = text;
  state.ultimaRespuesta = '';
  el.pinBtn.disabled = true;

  // En el escenario primero se ve lo que dijo la persona…
  if (isStage()) {
    el.scene.dataset.speaker = 'human';
    el.sceneLabel.textContent = show.current ? show.current.name.toUpperCase() : 'EL PÚBLICO';
    sceneWriter.clear();
    sceneWriter.push(text);
  }

  setMode('thinking');

  const bubble = addBubble('ai', '', { pending: true });
  const bubbleWriter = new Materializer(bubble, { charsPerSecond: 46 });
  let firstChunk = true;
  let answer = '';

  state.controller = new AbortController();

  try {
    answer = await streamChat(
      state.messages,
      (delta) => {
        if (firstChunk) {
          firstChunk = false;
          bubble.classList.remove('is-pending');
          bubble.textContent = '';
          bubble.classList.add('is-streaming');
          if (isStage()) {
            el.scene.dataset.speaker = 'ai';
            el.sceneLabel.textContent = 'NOVA';
            sceneWriter.clear();
          }
          setMode('answering');
        }
        bubbleWriter.push(delta);
        if (isStage()) sceneWriter.push(delta);
        sentences.push(delta);
        scrollLog();
      },
      { mode: state.mode, signal: state.controller.signal },
    );

    sentences.flush();
    bubbleWriter.flush();
    bubble.classList.remove('is-streaming');

    if (answer.trim()) {
      state.messages.push({ role: 'assistant', content: answer });
      cloud.absorb(answer, 'ai');
      state.ultimaRespuesta = answer.trim();
      el.pinBtn.disabled = false;
    } else {
      bubble.textContent = '(sin respuesta)';
    }
  } catch (err) {
    bubbleWriter.flush();
    bubble.classList.remove('is-streaming', 'is-pending');

    if (err.name === 'AbortError') {
      // Corte pedido por la persona: dejamos lo que alcanzó a decir.
      bubble.textContent = bubble.textContent || '(interrumpido)';
      if (bubble.textContent.trim() && bubble.textContent !== '(interrumpido)') {
        state.messages.push({ role: 'assistant', content: bubble.textContent });
      }
    } else {
      bubble.closest('.msg')?.classList.add('msg--error');
      bubble.textContent = err.message;
      setMode('error');
      toast(err.message);
      // No dejamos el turno colgado en el historial.
      state.messages.pop();
    }
  } finally {
    state.busy = false;
    state.controller = null;
    el.stopBtn.hidden = true;
    el.sendBtn.disabled = false;
    scrollLog();

    // El estado vuelve a reposo recién cuando la última letra terminó de formarse.
    const rest = () => {
      if (el.orb.dataset.state === 'error') return;
      if (speaker.enabled && speaker.speaking) setMode('speaking');
      else setMode(listener.active ? 'listening' : 'idle');
    };

    const writer = sceneWriter.isBusy ? sceneWriter : bubbleWriter.isBusy ? bubbleWriter : null;
    if (writer) {
      setMode('answering');
      writer.onSettle = () => {
        writer.onSettle = null;
        rest();
      };
    } else {
      rest();
    }
  }
}

function abort() {
  state.controller?.abort();
  speaker.cancel();
  sceneWriter.flush();
}

function reset() {
  abort();
  state.messages.length = 0;
  state.pendingSpeech.length = 0;
  clearTimeout(state.silenceTimer);
  el.log.innerHTML = '';
  sceneWriter.clear();
  showHeard('', false);
  cloud.clear();
  setMode(listener.active ? 'listening' : 'idle');
}

/* ------------------------------------------------------------ burbujas */

function addBubble(who, text, { pending = false, animate = false } = {}) {
  const row = document.createElement('div');
  row.className = `msg msg--${who === 'user' ? 'user' : 'ai'}`;

  const avatar = document.createElement('div');
  avatar.className = 'msg__avatar';
  avatar.setAttribute('aria-hidden', 'true');
  if (who === 'user') {
    // Con plantel cargado, la burbuja lleva las iniciales de quien habló.
    const persona = show.current;
    avatar.textContent = persona ? iniciales(persona.name) : 'VOS';
    if (persona) {
      avatar.style.color = persona.color;
      avatar.style.borderColor = persona.color;
    }
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg__bubble';

  if (pending) {
    bubble.classList.add('is-pending');
    bubble.innerHTML = '<span class="dots"><i></i><i></i><i></i></span>';
  } else if (animate) {
    new Materializer(bubble, { charsPerSecond: 60 }).push(text);
  } else {
    bubble.textContent = text;
  }

  row.append(avatar, bubble);
  el.log.appendChild(row);
  scrollLog();
  return bubble;
}

/** "Ana María" queda en AM; "Tomás", en TO. */
function iniciales(nombre) {
  const partes = nombre.trim().split(/\s+/);
  if (partes.length > 1) return (partes[0][0] + partes[1][0]).toUpperCase();
  return nombre.trim().slice(0, 2).toUpperCase();
}

function scrollLog() {
  el.log.scrollTop = el.log.scrollHeight;
  el.sceneText.scrollTop = el.sceneText.scrollHeight;
}

/* -------------------------------------------------------------- estados */

const CAPTIONS = {
  idle: 'En espera',
  listening: 'Escuchando',
  thinking: 'Pensando',
  answering: 'Respondiendo',
  speaking: 'Hablando',
  error: 'Error',
};

function setMode(mode) {
  el.orb.dataset.state = mode === 'answering' ? 'thinking' : mode;
  el.sceneOrb.dataset.state = mode === 'answering' ? 'thinking' : mode;
  el.coreCaption.textContent = CAPTIONS[mode] || '';
  el.sceneState.textContent = CAPTIONS[mode] || '';
}

function setStatus(stateName, label) {
  el.status.dataset.state = stateName;
  el.statusLabel.textContent = label;
}

/* ------------------------------------------------------------ escenario */

const isStage = () => el.body.dataset.mode === 'stage';

function toggleStage() {
  setStageMode(!isStage());
}

function setStageMode(on) {
  el.body.dataset.mode = on ? 'stage' : 'console';
  el.scene.setAttribute('aria-hidden', String(!on));
  el.stageBtn.textContent = on ? 'Salir del escenario' : 'Modo escenario';

  if (on) {
    document.documentElement.requestFullscreen?.().catch(() => {
      // Algunos navegadores lo rechazan sin gesto directo: el modo igual funciona.
    });
    // Arrancamos el escenario con el último mensaje que haya, para no dejarlo vacío.
    const last = state.messages.at(-1);
    if (last && !sceneWriter.isBusy && !el.sceneText.textContent) {
      el.scene.dataset.speaker = last.role === 'user' ? 'human' : 'ai';
      el.sceneLabel.textContent = last.role === 'user' ? 'VOS' : 'NOVA';
      sceneWriter.writeInstantly(last.content);
    }
  } else if (document.fullscreenElement) {
    document.exitFullscreen?.().catch(() => {});
  }

  // En el escenario, las palabras dejan libre el centro donde va el texto grande.
  cloud.setClearZone(on ? { rx: 0.24, ry: 0.3 } : null);
  cloud.resize();
}

/* ---------------------------------------------------------------- varios */

let toastTimer = null;
function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  requestAnimationFrame(() => el.toast.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('is-visible');
    setTimeout(() => (el.toast.hidden = true), 300);
  }, 6000);
}

function autoGrow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}
