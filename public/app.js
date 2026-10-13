/**
 * NOVA — orquestador del escenario.
 *
 * Junta las piezas: el guion, las letras que se materializan, la nube de
 * palabras, la voz y el nivel de audio. Maneja dos vistas de lo mismo —la
 * consola, para operar; el escenario, para proyectar— y conduce la función:
 * de quién es el turno, qué va quedando definido y qué dice NOVA cuando
 * escucha un pie del guion.
 *
 * NOVA no se conecta a ninguna inteligencia artificial: todo lo que dice
 * sale del guion que se le carga. Lo que pasa acá se cuenta por el enlace,
 * para que el panel de control lo vea y pueda mandar.
 */

import { gotear } from './js/goteo.js';
import { Materializer } from './js/materialize.js';
import { WordCloud } from './js/wordcloud.js';
import { Listener, Speaker, makeSentenceSplitter, voiceSupport } from './js/voice.js';
import { VoiceMeter } from './js/audio.js';
import { Show } from './js/show.js';
import { Guion, parsearGuion, GUION_EJEMPLO } from './js/guion.js';
import { Enlace } from './js/enlace.js';
import { Arbitro } from './js/arbitro.js';

const $ = (id) => document.getElementById(id);

const el = {
  body: document.body,
  status: $('status'),
  statusLabel: document.querySelector('.status__label'),
  stageBtn: $('stageBtn'),
  orb: $('orb'),
  sceneOrb: $('sceneOrb'),
  coreCaption: $('coreCaption'),
  micBtn: $('micBtn'),
  micHint: $('micHint'),
  log: $('log'),
  welcome: $('welcome'),
  welcomeGuion: $('welcomeGuion'),
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
  sceneHint: $('sceneHint'),
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

  // guion
  guionBtn: $('guionBtn'),
  guion: $('guion'),
  guionClose: $('guionClose'),
  guionTexto: $('guionTexto'),
  guionResumen: $('guionResumen'),
  guionArchivo: $('guionArchivo'),
  guionEjemplo: $('guionEjemplo'),
  guionQuitar: $('guionQuitar'),
  guionGuardar: $('guionGuardar'),
  guionActivo: $('guionActivo'),
  guionTolerancia: $('guionTolerancia'),
  guionLista: $('guionLista'),
  guionReiniciar: $('guionReiniciar'),
  guionTira: $('guionTira'),
  guionPie: $('guionPie'),
  guionDecir: $('guionDecir'),

  // asistente de ubicación
  asistenteEstado: $('asistenteEstado'),
  asistenteClave: $('asistenteClave'),
  asistenteModelo: $('asistenteModelo'),
  asistenteGuardar: $('asistenteGuardar'),
  asistenteOlvidar: $('asistenteOlvidar'),

  // panel de control
  panelBtn: $('panelBtn'),
  panel: $('panel'),
  panelClose: $('panelClose'),
  panelAbrir: $('panelAbrir'),
  panelRed: $('panelRed'),
};

/* --------------------------------------------------------------- estado */

const state = {
  busy: false,
  controller: null,      // para cortar un parlamento a mitad
  pendingSpeech: [],     // frases dictadas esperando envío
  silenceTimer: null,
  escena: 'charla',      // portada, charla o muro
  modo: 'idle',
  ultimo: null,          // el último mensaje, para arrancar el escenario con algo
  ultimaPregunta: '',    // para saber de qué trata el último acuerdo
  ultimaRespuesta: '',   // lo que se fija con la tecla A
  oido: '',              // lo que el micrófono captó por última vez
  evento: null,          // lo último que pasó, para el panel
  abriendoMic: false,
};

const SILENCE_MS = 1400;  // pausa que se toma como "terminó de hablar"

// Declarados acá arriba porque init() corre antes de que termine de
// evaluarse el archivo, y los usa.
let publicarTimer = null;
let toastTimer = null;

const cloud = new WordCloud($('cloud'));
const sceneWriter = new Materializer(el.sceneText, { charsPerSecond: 38 });
const speaker = new Speaker();
const meter = new VoiceMeter();
const show = new Show();
const guion = new Guion();
const arbitro = new Arbitro();
const sentences = makeSentenceSplitter((s) => speaker.say(s));

const listener = voiceSupport.listen
  ? new Listener({
    onStart: () => setMode('listening'),
    onPartial: (text) => showHeard(text, false),
    onFinal: (text) => queueSpeech(text),
    onError: (msg) => {
      toast(msg);
      micApagado();
    },
    onEnd: () => {
      if (!listener.active && !state.busy) setMode('idle');
    },
  })
  : null;

const enlace = new Enlace('escenario', (mensaje) => recibirComando(mensaje));

/* ---------------------------------------------------------- arranque */

init();

async function init() {
  wireEvents();
  autoGrow(el.input);

  show.subscribe(() => pintarFuncion());
  guion.subscribe(() => pintarGuion());
  conectarMedidor();
  verEscena('charla');

  enlace.onCambio = () => pintarEnlace();
  pintarEnlace();
  arbitro.detectar().then(() => pintarAsistente());

  if (!listener) {
    el.micBtn.disabled = true;
    el.micBtn.title = 'Este navegador no reconoce voz. Probá con Google Chrome o Edge, o manejá el guion desde el panel.';
    el.micHint.textContent = 'Voz no disponible';
  }
  setupVoicePreference();

  speaker.onStart = () => {
    listener?.pauseForPlayback();
    setMode('speaking');
  };
  speaker.onEnd = () => {
    listener?.resumeAfterPlayback();
    if (!state.busy) setMode(listener?.active ? 'listening' : 'idle');
  };

  if (!guion.tiene) {
    toast('NOVA responde con un guion. Cargalo en el botón Guion, arriba a la derecha.');
  }
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
  publicar();
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
 * el público entienda, sin explicación, que NOVA escucha a esa persona.
 */
function conectarMedidor() {
  meter.onLevel = (nivel) => {
    const valor = nivel.toFixed(3);
    el.orb.style.setProperty('--voz', valor);
    el.sceneOrb.style.setProperty('--voz', valor);
    cloud.setEnergy(nivel);
    listener?.noteSound(nivel);
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

  el.showBtn.addEventListener('click', () => el.show.showModal());
  el.showClose.addEventListener('click', () => el.show.close());
  wireGuion();
  wirePanel();
  el.muroBtn.addEventListener('click', () => verEscena(state.escena === 'muro' ? 'charla' : 'muro'));
  el.pinBtn.addEventListener('click', () => fijarAcuerdo());
  el.welcomeGuion?.addEventListener('click', () => abrirGuion());

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

  document.addEventListener('keydown', (event) => {
    // Mientras se escribe en un campo, las teclas son texto y nada más.
    const typing = event.target.matches('input, textarea, select');

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
    if ((event.key === 's' || event.key === 'S') && !typing) {
      event.preventDefault();
      decirSiguiente();
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

/* ---------------------------------------------------- panel de control */

function wirePanel() {
  el.panelBtn.addEventListener('click', () => abrirPanelInfo());
  el.panelClose.addEventListener('click', () => el.panel.close());
  el.panelAbrir.addEventListener('click', () => {
    window.open('control.html', 'nova-panel', 'width=480,height=820');
  });
}

async function abrirPanelInfo() {
  el.panelRed.innerHTML = '<p class="vacio">Buscando el servidor…</p>';
  el.panel.showModal();

  let info = null;
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (res.ok) info = await res.json();
  } catch { /* sin servidor */ }

  if (!info?.control) {
    el.panelRed.innerHTML =
      '<p class="vacio">Esta página está servida sin el servidor de NOVA, así que el panel ' +
      'solo se puede abrir en otra ventana de esta misma computadora. Para manejarla desde ' +
      'el celular, corré <code>npm start</code> y abrí la página desde ahí.</p>';
    return;
  }

  const puerto = location.port ? `:${location.port}` : '';
  const direcciones = (info.direcciones || []).map((ip) => `http://${ip}${puerto}/control.html`);
  if (!direcciones.length) {
    el.panelRed.innerHTML = '<p class="vacio">El servidor está corriendo, pero esta máquina no tiene una dirección de red visible.</p>';
    return;
  }
  el.panelRed.innerHTML =
    '<p class="sheet__note">Desde un celular o una computadora <strong>en la misma red Wi-Fi</strong>, abrí una de estas direcciones:</p>' +
    direcciones.map((d) => `<p class="panel__direccion"><a href="${escapar(d)}" target="_blank" rel="noopener">${escapar(d)}</a></p>`).join('');
}

/**
 * Cuenta por el enlace todo lo que el panel necesita para ver por dónde
 * va la función. Se manda entero y seguido: es chico y así nunca queda
 * desactualizado.
 */
function publicar() {
  clearTimeout(publicarTimer);
  publicarTimer = setTimeout(() => {
    enlace.enviar({
      tipo: 'estado',
      estado: {
        escena: state.escena,
        modo: state.modo,
        escenario: isStage(),
        mic: !listener ? 'no disponible' : listener.active ? 'escuchando' : 'apagado',
        voz: speaker.enabled,
        oido: state.oido,
        ultimaRespuesta: state.ultimaRespuesta,
        evento: state.evento,
        guion: guion.resumen(),
        asistente: arbitro.modo,
        turno: show.current,
        plantel: show.speakers,
        acuerdos: show.agreements.length,
        enlace: enlace.servidor,
      },
    });
  }, 80);
}

/** Algo que al panel le sirve saber: queda como último evento y se cuenta. */
function anotar(texto) {
  state.evento = { t: Date.now(), texto };
  publicar();
}

/** Lo que manda el panel. */
function recibirComando(mensaje) {
  if (mensaje.tipo !== 'comando') return;
  const { accion } = mensaje;

  switch (accion) {
    case 'hola': publicar(); break;
    case 'decir': decirDelGuion(Number(mensaje.indice)); break;
    case 'siguiente': decirSiguiente(); break;
    case 'reiniciar': guion.reiniciar(); anotar('El guion vuelve al principio.'); break;
    case 'activo': guion.setActivo(Boolean(mensaje.on)); break;
    case 'tolerancia': guion.setTolerancia(String(mensaje.nombre)); break;
    case 'cargar': {
      const cuantos = guion.cargar(String(mensaje.texto || ''));
      anotar(cuantos ? `Guion cargado desde el panel: ${cuantos} parlamentos.` : 'Guion quitado desde el panel.');
      toast(cuantos ? `Guion cargado desde el panel: ${cuantos} parlamentos.` : 'Guion quitado desde el panel.');
      break;
    }
    case 'escena': verEscena(['portada', 'charla', 'muro'].includes(mensaje.nombre) ? mensaje.nombre : 'charla'); break;
    case 'escenario': setStageMode(Boolean(mensaje.on)); break;
    case 'mic': {
      if (!listener) return anotar('Este navegador no reconoce voz: el micrófono no se puede encender.');
      if (Boolean(mensaje.on) !== listener.active) toggleMic();
      break;
    }
    case 'voz': setVoice(Boolean(mensaje.on)); break;
    case 'turno': show.setCurrent(String(mensaje.id)); break;
    case 'turno-siguiente': show.next(); break;
    case 'fijar': fijarAcuerdo(); break;
    case 'detener': abort(); break;
    case 'texto': decirTexto(String(mensaje.texto || '')); break;
    case 'oido': send(String(mensaje.texto || '').trim()); break;
    default: break;
  }
}

function pintarEnlace() {
  const servidor = enlace.servidor === 'conectado';
  setStatus(servidor ? 'online' : 'local', servidor ? 'Panel por red' : 'Panel solo acá');
  el.status.title = servidor
    ? 'Hay servidor: el panel de control se puede abrir desde otro dispositivo de la red.'
    : 'Sin servidor: el panel de control solo se abre en otra ventana de esta computadora.';
  publicar();
}

/* ------------------------------------------------------------- el guion */

function wireGuion() {
  el.guionBtn.addEventListener('click', () => abrirGuion());
  el.guionClose.addEventListener('click', () => el.guion.close());

  el.guionGuardar.addEventListener('click', () => guardarGuion());
  el.guionQuitar.addEventListener('click', () => {
    guion.quitar();
    el.guionTexto.value = '';
    toast('Guion quitado. NOVA no tiene nada que decir hasta que cargues otro.');
  });
  el.guionEjemplo.addEventListener('click', () => {
    el.guionTexto.value = GUION_EJEMPLO;
    el.guionTexto.focus();
    describirGuion(el.guionTexto.value, { borrador: true });
  });
  el.guionTexto.addEventListener('input', () => describirGuion(el.guionTexto.value, { borrador: true }));

  el.guionArchivo.addEventListener('change', async () => {
    const archivo = el.guionArchivo.files?.[0];
    el.guionArchivo.value = '';
    if (!archivo) return;
    try {
      el.guionTexto.value = await archivo.text();
      guardarGuion();
    } catch {
      toast('No se pudo leer ese archivo.');
    }
  });

  el.guionActivo.addEventListener('click', () => guion.setActivo(!guion.activo));
  el.guionTolerancia.addEventListener('change', () => guion.setTolerancia(el.guionTolerancia.value));
  el.guionReiniciar.addEventListener('click', () => {
    guion.reiniciar();
    toast('El guion vuelve al principio.');
  });
  el.guionDecir.addEventListener('click', () => decirSiguiente());

  // Asistente de ubicación: la clave vive solo en este navegador.
  el.asistenteGuardar.addEventListener('click', async () => {
    arbitro.clave = el.asistenteClave.value;
    arbitro.modelo = el.asistenteModelo.value;
    await arbitro.detectar();
    pintarAsistente();
    toast(arbitro.disponible ? 'Asistente de ubicación listo.' : 'Sin clave: NOVA ubica los pies por parecido, como siempre.');
  });
  el.asistenteOlvidar.addEventListener('click', async () => {
    arbitro.clave = '';
    el.asistenteClave.value = '';
    await arbitro.detectar();
    pintarAsistente();
    toast('Clave borrada de este navegador.');
  });
}

/** Qué asistente hay, en el panel del guion y para el panel de control. */
function pintarAsistente() {
  el.asistenteClave.value = arbitro.clave;
  el.asistenteModelo.value = arbitro.modelo;
  el.asistenteEstado.innerHTML = {
    servidor: '<strong>Asistente activo por el servidor.</strong> La clave está en el <code>.env</code> de la computadora que corre NOVA.',
    directo: '<strong>Asistente activo con la clave de este navegador.</strong> Cuando lo que se oye no coincide con un pie, se le pregunta a qué pie corresponde.',
    ninguno: '<strong>Sin asistente.</strong> NOVA ubica los pies por parecido de palabras, que alcanza si los estudiantes dicen más o menos lo escrito.',
  }[arbitro.modo];
  publicar();
}

function abrirGuion() {
  el.guionTexto.value = guion.texto;
  describirGuion(guion.texto);
  el.guion.showModal();
}

function guardarGuion() {
  const cuantos = guion.cargar(el.guionTexto.value);
  if (!cuantos && el.guionTexto.value.trim()) {
    return toast('No encontré parlamentos de NOVA. Las líneas tienen que empezar con "NOVA:".');
  }
  toast(cuantos ? `Guion cargado: ${cuantos} ${cuantos === 1 ? 'parlamento' : 'parlamentos'}.` : 'Guion vacío.');
  anotar(cuantos ? `Guion cargado: ${cuantos} parlamentos.` : 'Guion vacío.');
}

/** El renglón bajo el texto: cuántos parlamentos y de quiénes son los pies. */
function describirGuion(texto, { borrador = false } = {}) {
  if (!texto.trim()) {
    el.guionResumen.textContent = 'Sin guion. Podés pegarlo acá o abrir un archivo de texto.';
    return;
  }
  const { entradas, comodines, personajes } = parsearGuion(texto);
  const sinPie = entradas.filter((e) => !e.pies.length).length;
  const partes = [`${entradas.length} ${entradas.length === 1 ? 'parlamento' : 'parlamentos'} de NOVA`];
  if (personajes.length) partes.push(`pies de ${personajes.join(', ')}`);
  if (sinPie) partes.push(`${sinPie} sin pie (se ${sinPie === 1 ? 'dice' : 'dicen'} con la tecla S)`);
  if (comodines.length) partes.push(`${comodines.length} ${comodines.length === 1 ? 'comodín' : 'comodines'}`);
  el.guionResumen.textContent = `${partes.join(' · ')}${borrador ? ' — sin guardar' : ''}.`;
  if (!entradas.length) {
    el.guionResumen.textContent = 'No hay líneas de NOVA. Cada parlamento tiene que empezar con "NOVA:".';
  }
}

/** Redibuja todo lo que depende del guion: el panel, la tira y la ayuda del escenario. */
function pintarGuion() {
  const siguiente = guion.siguiente;
  const enUso = guion.tiene && guion.activo;

  el.guionActivo.setAttribute('aria-pressed', String(guion.activo));
  el.guionTolerancia.value = guion.tolerancia;

  // La lista de parlamentos, con el que sigue resaltado.
  el.guionLista.innerHTML = '';
  if (!guion.tiene) {
    el.guionLista.innerHTML = '<p class="vacio">Todavía no hay guion cargado.</p>';
  }
  guion.entradas.forEach((entrada) => {
    const fila = document.createElement('li');
    fila.classList.toggle('is-dicho', entrada.indice <= guion.cursor);
    fila.classList.toggle('is-siguiente', entrada.indice === guion.cursor + 1);
    fila.title = 'NOVA lo dice ya mismo';
    const pie = entrada.pies.length ? escapar(entrada.pies.at(-1)) : 'sin pie: se dice con la tecla S';
    fila.innerHTML = `
      <span class="guion__numero">${entrada.indice + 1}</span>
      <span class="guion__pie${entrada.pies.length ? '' : ' is-vacio'}">${pie}</span>
      <span class="guion__parlamento">${escapar(entrada.parlamento)}</span>`;
    fila.addEventListener('click', () => {
      el.guion.close();
      decirDelGuion(entrada.indice);
    });
    el.guionLista.appendChild(fila);
  });

  // La tira en la consola: qué pie se espera ahora.
  el.guionTira.hidden = !enUso;
  el.guionDecir.disabled = !siguiente;
  if (enUso) {
    if (!siguiente) {
      el.guionPie.innerHTML = '<em>Fin del guion.</em> Solo quedan los comodines.';
    } else if (siguiente.pies.length) {
      el.guionPie.innerHTML = `${siguiente.indice + 1}/${guion.entradas.length} · se espera: <strong>${escapar(siguiente.pies.at(-1))}</strong>`;
    } else {
      el.guionPie.innerHTML = `${siguiente.indice + 1}/${guion.entradas.length} · <em>sin pie</em>: <strong>${escapar(siguiente.parlamento)}</strong>`;
    }
  }

  el.sceneHint.textContent = enUso
    ? 'Espacio: micrófono · S: guion · A: fijar acuerdo · M: muro · F: salir'
    : 'Espacio: micrófono · A: fijar acuerdo · M: muro · F: salir';

  publicar();
}

/** Tecla S: NOVA dice el parlamento que sigue, sin esperar el pie. */
function decirSiguiente() {
  if (!guion.tiene) return toast('No hay guion cargado. Está en el botón Guion, arriba.');
  const siguiente = guion.siguiente;
  if (!siguiente) return toast('El guion ya terminó. En el panel podés volver al principio.');
  decirDelGuion(siguiente.indice);
}

/** NOVA dice un parlamento del guion por decisión del operador, sin pregunta previa. */
async function decirDelGuion(indice) {
  const entrada = guion.entradas[indice];
  if (!entrada || state.busy) return;

  prepararRespuesta();
  guion.marcar(indice);
  // Si después se fija como acuerdo, el pie sirve de título.
  state.ultimaPregunta = entrada.pies.at(-1) || '';
  anotar(`Dice el parlamento ${indice + 1} a pedido.`);
  await responder(entrada.parlamento, { origen: 'guion' });
}

/** NOVA dice un texto que el operador escribió en el momento. */
async function decirTexto(texto) {
  if (!texto.trim() || state.busy) return;
  prepararRespuesta();
  anotar('Dice un texto escrito desde el panel.');
  await responder(texto.trim(), { origen: 'libre' });
}

function prepararRespuesta() {
  speaker.cancel();
  sentences.reset();
  el.welcome?.remove();
  if (state.escena !== 'charla') verEscena('charla');
  showHeard('', false);
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
  publicar();
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
  anotar('Acuerdo fijado en el muro.');
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
  publicar();
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

async function toggleMic() {
  if (!listener) return toast('Este navegador no reconoce voz. Probá con Google Chrome o Edge, o manejá el guion desde el panel.');
  if (state.abriendoMic) return;

  if (listener.active) {
    listener.stop();
    micApagado();
    anotar('Micrófono apagado.');
    return;
  }

  state.abriendoMic = true;
  setMicActive(true);
  setMode('listening');
  el.micHint.textContent = 'Abriendo el micrófono…';
  const ok = await listener.start();
  state.abriendoMic = false;

  if (!ok || !listener.active) {
    micApagado();
    return;
  }
  el.micHint.textContent = 'Escuchando… tocá para cortar';
  anotar('Micrófono encendido.');

  // El nivel de voz es lo que mueve los visuales. Si el navegador no deja
  // abrir el micrófono dos veces, la página sigue andando sin reaccionar.
  meter.start().then((bien) => {
    if (!bien) console.info('NOVA: sin medidor de voz; los visuales no reaccionan al volumen.');
  });
}

/** Deja todo como cuando el micrófono está cerrado. */
function micApagado() {
  meter.stop();
  clearTimeout(state.silenceTimer);
  state.pendingSpeech.length = 0;
  showHeard('', false);
  setMicActive(false);
  el.micHint.textContent = 'Tocá para hablar';
  if (!state.busy) setMode('idle');
  publicar();
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
  if (text) state.oido = text;
  publicar();
}

/* ---------------------------------------------------------- conversar */

/**
 * Alguien dijo algo, por voz o por teclado. Si se parece a un pie del
 * guion, NOVA contesta con ese parlamento. Si no, con un comodín; y si el
 * guion no tiene comodines, se queda callada y el panel avisa qué oyó.
 */
async function send(text, { fromVoice = false } = {}) {
  if (!text || state.busy) return;

  prepararRespuesta();
  state.oido = text;

  addBubble('user', text, { animate: fromVoice });
  cloud.absorb(text, 'user');
  state.ultimo = { role: 'user', content: text };
  state.ultimaPregunta = text;

  // En el escenario primero se ve lo que dijo la persona…
  if (isStage()) {
    el.scene.dataset.speaker = 'human';
    el.sceneLabel.textContent = show.current ? show.current.name.toUpperCase() : 'EL PÚBLICO';
    sceneWriter.clear();
    sceneWriter.push(text);
  }

  let hallado = guion.buscar(text);

  // Si el parecido no alcanza, o es flojo, el asistente decide a qué pie
  // corresponde. Mientras tanto NOVA "piensa", que es exactamente lo que pasa.
  if (arbitro.disponible && guion.activo && guion.tiene && (!hallado || hallado.puntaje < 0.9)) {
    setMode('thinking');
    const veredicto = await arbitro.ubicar({ oido: text, cursor: guion.cursor, entradas: guion.entradas });
    if (veredicto?.indice != null && veredicto.confianza >= 0.6 && guion.entradas[veredicto.indice]?.pies.length) {
      hallado = { entrada: guion.entradas[veredicto.indice], puntaje: veredicto.confianza, porAsistente: true };
    } else if (veredicto?.error) {
      anotar(`El asistente no respondió: ${veredicto.error}`);
    }
  }

  if (hallado) {
    guion.marcar(hallado.entrada.indice);
    anotar(`${hallado.porAsistente ? 'El asistente ubicó' : 'Reconoció'} el pie ${hallado.entrada.indice + 1}: «${text}».`);
    await responder(hallado.entrada.parlamento, { origen: 'guion' });
    return;
  }

  const comodin = guion.tiene ? guion.comodin : null;
  if (comodin) {
    anotar(`No reconoció «${text}»: contesta con un comodín.`);
    await responder(comodin, { origen: 'comodin' });
    return;
  }

  anotar(guion.tiene ? `No reconoció «${text}» y no hay comodines.` : `Oyó «${text}», pero no hay guion cargado.`);
  addNota(guion.tiene
    ? 'No se parece a ningún pie del guion. Con la tecla S, NOVA dice lo que sigue.'
    : 'No hay guion cargado: NOVA no tiene nada que decir.');
  if (!listener?.active) setMode('idle');
}

/**
 * NOVA dice un texto: lo deja caer letra por letra, lo lee en voz alta y
 * lo recuerda por si se fija en el muro.
 *
 * @param {string} texto
 * @param {{origen: 'guion'|'comodin'|'libre'}} opts
 */
async function responder(texto, { origen }) {
  state.busy = true;
  el.stopBtn.hidden = false;
  el.sendBtn.disabled = true;
  state.ultimaRespuesta = '';
  el.pinBtn.disabled = true;

  setMode('thinking');

  const bubble = addBubble('ai', '', { pending: true });
  bubble.closest('.msg')?.classList.add(`msg--${origen}`);
  bubble.title = { guion: 'Dicho según el guion', comodin: 'Comodín: no reconoció el pie', libre: 'Escrito desde el panel' }[origen];
  const bubbleWriter = new Materializer(bubble, { charsPerSecond: 46 });
  let firstChunk = true;
  let answer = '';

  state.controller = new AbortController();

  try {
    answer = await gotear(
      texto,
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
      state.controller.signal,
    );

    sentences.flush();
    bubbleWriter.flush();
    bubble.classList.remove('is-streaming');

    state.ultimo = { role: 'assistant', content: answer };
    cloud.absorb(answer, 'ai');
    state.ultimaRespuesta = answer.trim();
    el.pinBtn.disabled = false;
  } catch (err) {
    bubbleWriter.flush();
    bubble.classList.remove('is-streaming', 'is-pending');
    if (err.name === 'AbortError') {
      // Corte pedido por la persona: dejamos lo que alcanzó a decir.
      bubble.textContent = bubble.textContent || '(interrumpido)';
      anotar('Parlamento interrumpido.');
    } else {
      bubble.closest('.msg')?.classList.add('msg--error');
      bubble.textContent = err.message;
      setMode('error');
      toast(err.message);
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
      else setMode(listener?.active ? 'listening' : 'idle');
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
    publicar();
  }
}

function abort() {
  state.controller?.abort();
  speaker.cancel();
  sceneWriter.flush();
}

function reset() {
  abort();
  state.pendingSpeech.length = 0;
  clearTimeout(state.silenceTimer);
  state.ultimo = null;
  state.oido = '';
  el.log.innerHTML = '';
  sceneWriter.clear();
  showHeard('', false);
  cloud.clear();
  setMode(listener?.active ? 'listening' : 'idle');
  anotar('Charla limpia.');
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

/** Una nota de la consola, para el operador: no es algo que NOVA diga. */
function addNota(texto) {
  const nota = document.createElement('p');
  nota.className = 'nota';
  nota.textContent = texto;
  el.log.appendChild(nota);
  scrollLog();
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
  state.modo = mode;
  el.orb.dataset.state = mode === 'answering' ? 'thinking' : mode;
  el.sceneOrb.dataset.state = mode === 'answering' ? 'thinking' : mode;
  el.coreCaption.textContent = CAPTIONS[mode] || '';
  el.sceneState.textContent = CAPTIONS[mode] || '';
  publicar();
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
    const last = state.ultimo;
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
  publicar();
}

/* ---------------------------------------------------------------- varios */

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
