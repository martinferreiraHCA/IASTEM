/**
 * NOVA — orquestador de la interfaz.
 *
 * Junta las cuatro piezas: la API en streaming, las letras que se
 * materializan, la nube de palabras y la voz. Maneja dos vistas de lo
 * mismo: la consola (para operar) y el escenario (para proyectar).
 */

import { detectMode, streamChat, settings, DEFAULT_MODEL, DEFAULT_PROMPT } from './js/api.js';
import { Materializer } from './js/materialize.js';
import { WordCloud } from './js/wordcloud.js';
import { Listener, Speaker, makeSentenceSplitter, voiceSupport } from './js/voice.js';

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
};

/* --------------------------------------------------------------- estado */

const state = {
  messages: [],          // historial que se manda a la API
  busy: false,
  controller: null,      // para cortar una respuesta a mitad
  pendingSpeech: [],     // frases dictadas esperando envío
  silenceTimer: null,
  mode: 'demo',          // servidor, directo o demo
};

const SILENCE_MS = 1400;  // pausa que se toma como "terminó de hablar"

const cloud = new WordCloud($('cloud'));
const sceneWriter = new Materializer(el.sceneText, { charsPerSecond: 38 });
const speaker = new Speaker();
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
    const typing = event.target === el.input;

    if (event.code === 'Space' && !typing) {
      event.preventDefault();
      toggleMic();
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

/* -------------------------------------------------------------- micro */

function toggleMic() {
  if (!voiceSupport.listen) return toast('Este navegador no reconoce voz. Probá con Chrome o Edge.');
  const active = listener.toggle();
  setMicActive(active);
  if (active) {
    setMode('listening');
    el.micHint.textContent = 'Escuchando… tocá para cortar';
  } else {
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

  state.busy = true;
  el.stopBtn.hidden = false;
  el.sendBtn.disabled = true;
  showHeard('', false);

  addBubble('user', text, { animate: fromVoice });
  cloud.absorb(text, 'user');
  state.messages.push({ role: 'user', content: text });

  // En el escenario primero se ve lo que dijo la persona…
  if (isStage()) {
    el.scene.dataset.speaker = 'human';
    el.sceneLabel.textContent = fromVoice ? 'ESCUCHÉ' : 'VOS';
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
  avatar.textContent = who === 'user' ? 'VOS' : '';
  avatar.setAttribute('aria-hidden', 'true');

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
