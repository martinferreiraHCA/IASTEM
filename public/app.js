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
import { Listener, Speaker, makeSentenceSplitter, voiceSupport, vocesDisponibles, VOCES_OPENAI } from './js/voice.js';
import { VoiceMeter } from './js/audio.js';
import { Show } from './js/show.js';
import { Guion, parsearGuion, puntaje, GUION_EJEMPLO } from './js/guion.js';
import { Enlace, codigoNuevo } from './js/enlace.js';
import { Arbitro, PROVEEDORES } from './js/arbitro.js';

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
  micDiag: $('micDiag'),
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

  // cámara e imágenes
  camara: $('camara'),
  camaraDispositivo: $('camaraDispositivo'),
  camaraProbar: $('camaraProbar'),
  camaraPrueba: $('camaraPrueba'),
  camaraNota: $('camaraNota'),
  sceneImagen: $('sceneImagen'),
  sceneImagenImg: $('sceneImagenImg'),
  sceneImagenPie: $('sceneImagenPie'),
  sceneFondo: $('sceneFondo'),
  palabraTexto: $('palabraTexto'),

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
  asistenteBtn: $('asistenteBtn'),
  asistente: $('asistente'),
  asistenteClose: $('asistenteClose'),
  asistenteProbar: $('asistenteProbar'),
  asistenteEstado: $('asistenteEstado'),
  asistenteUso: $('asistenteUso'),
  asistentePersonalidad: $('asistentePersonalidad'),
  asistenteProveedor: $('asistenteProveedor'),
  asistenteClave: $('asistenteClave'),
  asistenteModelo: $('asistenteModelo'),
  asistenteGuardar: $('asistenteGuardar'),
  asistenteOlvidar: $('asistenteOlvidar'),

  // la voz
  vozEstado: $('vozEstado'),
  vozMotor: $('vozMotor'),
  vozNavegadorCampos: $('vozNavegadorCampos'),
  vozNombre: $('vozNombre'),
  vozOpenAICampos: $('vozOpenAICampos'),
  vozClave: $('vozClave'),
  vozOpenAI: $('vozOpenAI'),
  vozInstrucciones: $('vozInstrucciones'),
  vozVelocidad: $('vozVelocidad'),
  vozVelocidadValor: $('vozVelocidadValor'),
  vozProbar: $('vozProbar'),
  vozGuardar: $('vozGuardar'),

  // panel de control
  panelBtn: $('panelBtn'),
  panel: $('panel'),
  panelClose: $('panelClose'),
  panelAbrir: $('panelAbrir'),
  panelSala: $('panelSala'),
  panelRed: $('panelRed'),
};

const SALA_CLAVE = 'nova:sala'; // el código de la sala del celular, para reabrirla sola
const QR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

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
  anticipado: null,      // {texto, t}: un pie reconocido antes de que terminara la frase
  historial: [],         // la charla, para que la IA la siga cuando improvisa
  camara: false,         // la cámara del público está en pantalla
  camaraStream: null,
  imagen: null,          // {src, pie, segundos}: la imagen que el guion sugirió para este momento
  imagenVisible: false,
  imagenTimer: null,
  fondo: null,           // {src, pie}: la imagen de fondo que se queda
  palabra: '',           // la palabra que NOVA se queda, flotando
  evento: null,          // lo último que pasó, para el panel
  abriendoMic: false,
  servidorVoz: false,    // el servidor tiene clave de OpenAI: la voz por API no necesita clave acá
  micQuerido: false,     // el micrófono tiene que estar encendido: se vuelve a prender solo
  micFatal: '',          // un error que no se arregla reintentando
  micDiag: '',           // diagnóstico del micrófono, para la consola y el panel
};

const SILENCE_MS = 700;   // pausa tras la última frase antes de contestar
const ANTICIPO_MS = 5000; // una frase anticipada tapa su versión final por este tiempo

// Declarados acá arriba porque init() corre antes de que termine de
// evaluarse el archivo, y los usa.
let publicarTimer = null;
let toastTimer = null;
let salaPintada = null; // qué código y estado de la sala está dibujado, para no rehacer el QR a cada rato
let cargaQR = null; // la carga de la librería del QR, una sola vez
let celularesAntes = 0; // cuántos celulares había, para avisar cuando entra o se va uno
const isStage = () => el.body.dataset.mode === 'stage';
const CAPTIONS = {
  idle: 'En espera',
  listening: 'Escuchando',
  thinking: 'Pensando',
  answering: 'Respondiendo',
  speaking: 'Hablando',
  error: 'Error',
};

const cloud = new WordCloud($('cloud'));
const sceneWriter = new Materializer(el.sceneText, { charsPerSecond: 56 });
const speaker = new Speaker((ajustes) => modoVozOpenAI(ajustes));
const meter = new VoiceMeter();
const show = new Show();
const guion = new Guion();
const arbitro = new Arbitro();
const sentences = makeSentenceSplitter((s) => speaker.say(s));

const listener = voiceSupport.listen
  ? new Listener({
    onStart: () => setMode('listening'),
    onPartial: (text) => {
      showHeard(text, false);
      anticipar(text);
    },
    onFinal: (text) => queueSpeech(text),
    onStatus: (texto) => pintarMic(texto),
    onError: (msg, code) => {
      toast(msg);
      anotar(`Micrófono: ${msg}`);
      if (!listener.active) {
        // Se apagó por algo que no se arregla insistiendo: se deja de reintentar.
        state.micFatal = code;
        micApagado();
      }
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
  // Si había una sala para el celular, se reabre sola con el mismo código.
  const sala = localStorage.getItem(SALA_CLAVE);
  if (sala) enlace.abrirSala(sala);

  if (!listener) {
    el.micBtn.disabled = true;
    el.micBtn.title = 'Este navegador no reconoce voz. Probá con Google Chrome o Edge, o manejá el guion desde el panel.';
    el.micHint.textContent = 'Voz no disponible';
    pintarMic('este navegador no reconoce voz');
  }
  setupVoicePreference();
  setupMicPreference();

  speaker.onStart = () => {
    listener?.pauseForPlayback();
    setMode('speaking');
  };
  speaker.onEnd = () => {
    listener?.resumeAfterPlayback();
    if (!state.busy) setMode(listener?.active ? 'listening' : 'idle');
  };
  speaker.onError = (mensaje) => {
    toast(`La voz por API falló (${mensaje}). NOVA sigue con la voz del navegador.`);
    anotar(`Voz por API: ${mensaje}. Se sigue con la del navegador.`);
    pintarVoz();
  };
  wireVoz();

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

/**
 * El micrófono queda encendido todo el tiempo: es lo que se espera en una
 * función. Se prende solo al abrir la página (si el navegador ya dio el
 * permiso) y, si se cae por algo pasajero, se vuelve a prender. Apagarlo
 * es una decisión, y se recuerda.
 */
function setupMicPreference() {
  state.micQuerido = Boolean(listener) && readStored('nova:mic') !== 'off';
  if (state.micQuerido) encenderMic({ automatico: true });

  setInterval(() => {
    if (state.micQuerido && listener && !listener.active && !state.abriendoMic && !state.micFatal) {
      encenderMic({ automatico: true });
    }
  }, 8000);
}

/** Qué está pasando con el micrófono, abajo del botón y en el panel. */
function pintarMic(texto) {
  state.micDiag = texto;
  el.micDiag.textContent = texto;
  publicar();
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
  wireCamara();
  el.stageBtn.addEventListener('click', () => toggleStage());
  el.stopBtn.addEventListener('click', () => abort());
  el.clearBtn.addEventListener('click', () => reset());

  el.voiceToggle.addEventListener('click', () => {
    setVoice(!speaker.enabled);
  });

  document.addEventListener('keydown', (event) => {
    // Mientras se escribe en un campo, las teclas son texto y nada más.
    const typing = event.target instanceof Element && event.target.matches('input, textarea, select');

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
    if ((event.key === 'c' || event.key === 'C') && !typing) {
      event.preventDefault();
      verCamara(!state.camara);
    }
    if ((event.key === 'i' || event.key === 'I') && !typing) {
      event.preventDefault();
      alternarImagen();
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

/* --------------------------------------------------- cámara e imágenes */

function wireCamara() {
  el.camaraDispositivo.addEventListener('change', () => {
    writeStored('nova:camara', el.camaraDispositivo.value);
    if (state.camara) {
      verCamara(false).then(() => verCamara(true));
    }
  });
  el.camaraProbar.addEventListener('click', () => probarCamara());
  el.show.addEventListener('close', () => {
    // La prueba del panel no deja la cámara abierta por su cuenta.
    el.camaraPrueba.srcObject?.getTracks().forEach((t) => t.stop());
    el.camaraPrueba.srcObject = null;
    el.camaraPrueba.hidden = true;
  });
  listarCamaras();
  navigator.mediaDevices?.addEventListener?.('devicechange', () => listarCamaras());
}

/** Las cámaras conectadas, para elegir una. Los nombres aparecen recién con permiso. */
async function listarCamaras() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  let dispositivos = [];
  try {
    dispositivos = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  } catch { /* nada */ }
  const elegida = readStored('nova:camara') || '';
  el.camaraDispositivo.innerHTML = '<option value="">La cámara de siempre</option>';
  dispositivos.forEach((d, i) => {
    const opcion = document.createElement('option');
    opcion.value = d.deviceId;
    opcion.textContent = d.label || `Cámara ${i + 1}`;
    el.camaraDispositivo.appendChild(opcion);
  });
  el.camaraDispositivo.value = dispositivos.some((d) => d.deviceId === elegida) ? elegida : '';
  if (!dispositivos.length) {
    el.camaraNota.textContent = 'No se encontró ninguna cámara, o el navegador todavía no dio permiso. Tocá Probar.';
  }
}

async function abrirCamara() {
  const id = readStored('nova:camara') || '';
  const video = id ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

function describirErrorCamara(err) {
  if (err?.name === 'NotAllowedError') return 'El navegador bloqueó la cámara. Tocá el candado de la barra de direcciones y permitila.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'No se encontró esa cámara. Revisá que esté conectada, o elegí otra en Función.';
  if (err?.name === 'NotReadableError') return 'La cámara está en uso por otro programa.';
  return `No se pudo abrir la cámara: ${err?.message || err?.name || 'error'}.`;
}

/** Una vista chica dentro del panel Función, para saber que la cámara anda. */
async function probarCamara() {
  if (!navigator.mediaDevices?.getUserMedia) return toast('Este navegador no puede abrir la cámara.');
  try {
    const stream = await abrirCamara();
    el.camaraPrueba.srcObject = stream;
    el.camaraPrueba.hidden = false;
    await el.camaraPrueba.play().catch(() => {});
    el.camaraNota.textContent = 'La cámara anda. En el escenario se prende con la tecla C o desde el panel.';
    listarCamaras(); // ahora sí con los nombres
  } catch (err) {
    el.camaraNota.textContent = describirErrorCamara(err);
  }
}

/** La gente en la pantalla grande, o no. */
async function verCamara(on) {
  if (Boolean(on) === state.camara) return;
  if (on) {
    if (!navigator.mediaDevices?.getUserMedia) return toast('Este navegador no puede abrir la cámara.');
    try {
      state.camaraStream = await abrirCamara();
    } catch (err) {
      toast(describirErrorCamara(err));
      anotar(`Cámara: ${describirErrorCamara(err)}`);
      return;
    }
    el.camara.srcObject = state.camaraStream;
    await el.camara.play().catch(() => {});
    state.camara = true;
    el.body.dataset.camara = 'on';
    anotar('Cámara del público en pantalla.');
  } else {
    state.camaraStream?.getTracks().forEach((t) => t.stop());
    state.camaraStream = null;
    el.camara.srcObject = null;
    state.camara = false;
    delete el.body.dataset.camara;
    anotar('Cámara del público apagada.');
  }
  cloud.resize();
  publicar();
}

/**
 * Muestra una imagen que el guion sugirió: toma toda la pantalla el tiempo
 * pedido y después se va sola, y vuelve lo que había.
 */
function mostrarImagen(imagen) {
  if (!imagen?.src) return;
  clearTimeout(state.imagenTimer);
  state.imagenTimer = null;
  const segundos = Number(imagen.segundos) > 0 ? Number(imagen.segundos) : 0; // 0: se queda
  state.imagen = { src: imagen.src, pie: imagen.pie || '', segundos };
  state.imagenVisible = true;
  el.sceneImagen.classList.remove('se-va');
  el.sceneImagen.classList.toggle('con-tiempo', segundos > 0);
  el.sceneImagenImg.src = imagen.src;
  el.sceneImagenImg.alt = imagen.pie || '';
  el.sceneImagenPie.textContent = imagen.pie || '';
  el.sceneImagen.style.setProperty('--segundos', `${segundos || 1}s`);
  el.scene.dataset.imagen = 'on';
  if (segundos > 0) state.imagenTimer = setTimeout(() => ocultarImagen(), segundos * 1000);
  anotar(segundos > 0 ? `Imagen en pantalla ${segundos} s: ${imagen.pie || imagen.src}.` : `Imagen en pantalla: ${imagen.pie || imagen.src}. Queda hasta que la saques.`);
  publicar();
}

function ocultarImagen({ olvidar = false } = {}) {
  clearTimeout(state.imagenTimer);
  state.imagenTimer = null;
  if (!state.imagenVisible && !olvidar) return;
  state.imagenVisible = false;
  if (olvidar) state.imagen = null;
  if (el.scene.dataset.imagen === 'on') {
    // Se desvanece y recién ahí se saca, para que no corte de golpe.
    el.sceneImagen.classList.add('se-va');
    setTimeout(() => {
      if (!state.imagenVisible) {
        delete el.scene.dataset.imagen;
        el.sceneImagen.classList.remove('se-va');
      }
    }, 500);
  }
  publicar();
}

/** Tecla I: saca la imagen antes de tiempo, o la vuelve a mostrar. */
function alternarImagen() {
  if (!state.imagen) return toast('No hay ninguna imagen para este momento. Se sugieren desde el guion, con IMAGEN: dirección | pie.');
  if (state.imagenVisible) ocultarImagen();
  else mostrarImagen(state.imagen);
}

/** Una imagen de fondo que se queda hasta que el guion o el panel la saquen. */
function ponerFondo(fondo) {
  if (!fondo || fondo === 'ninguno' || !fondo.src) {
    if (!state.fondo) return;
    state.fondo = null;
    el.sceneFondo.removeAttribute('src');
    delete el.body.dataset.fondo;
    anotar('Fondo quitado.');
  } else {
    state.fondo = { src: fondo.src, pie: fondo.pie || '' };
    el.sceneFondo.src = fondo.src;
    el.body.dataset.fondo = 'on';
    anotar(`Fondo: ${fondo.pie || fondo.src}.`);
  }
  cloud.resize();
  publicar();
}

/** La palabra que NOVA se queda: sola en pantalla, flotando junto al orbe. */
function ponerPalabra(palabra) {
  if (!palabra || palabra === 'ninguna') {
    if (!state.palabra) return;
    state.palabra = '';
    delete el.body.dataset.palabra;
    anotar('Palabra quitada.');
  } else {
    state.palabra = String(palabra).trim();
    el.palabraTexto.textContent = state.palabra;
    el.body.dataset.palabra = 'on';
    anotar(`Palabra en pantalla: ${state.palabra}.`);
  }
  publicar();
}

/**
 * Lo que el guion pide para la pantalla cuando NOVA dice un parlamento:
 * imagen a pantalla completa, fondo, palabra, cámara. También deja lista
 * la imagen del parlamento que sigue. Desde el panel se puede aplicar sin
 * que NOVA diga nada, para los momentos en que hablan solo los estudiantes.
 */
function aplicarPantalla(entrada) {
  if (entrada.fondo) ponerFondo(entrada.fondo);
  if (entrada.palabra) ponerPalabra(entrada.palabra);
  if (entrada.imagenes?.length) mostrarImagen(entrada.imagenes[0]);
  if (entrada.camara === 'encender') verCamara(true);
  if (entrada.camara === 'apagar') verCamara(false);

  const proxima = guion.entradas[entrada.indice + 1]?.imagenes?.[0];
  if (proxima?.src) new Image().src = proxima.src;
}

/* ---------------------------------------------------- panel de control */

function wirePanel() {
  el.panelBtn.addEventListener('click', () => abrirPanelInfo());
  el.panelClose.addEventListener('click', () => el.panel.close());
  el.panelAbrir.addEventListener('click', () => {
    window.open('control.html', 'nova-panel', 'width=480,height=820');
  });
  el.panelSala.addEventListener('click', (event) => {
    const boton = event.target.closest('[data-sala]');
    if (!boton) return;
    if (boton.dataset.sala === 'abrir' || boton.dataset.sala === 'cambiar') abrirSala();
    else if (boton.dataset.sala === 'cerrar') cerrarSala();
  });
}

async function abrirPanelInfo() {
  salaPintada = null;
  pintarSala();
  el.panel.showModal();
  pintarRed();
}


function cargarQR() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  cargaQR ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = QR_URL;
    script.onload = () => resolve(window.QRCode);
    script.onerror = () => { cargaQR = null; script.remove(); reject(new Error('sin QR')); };
    document.head.appendChild(script);
  });
  return cargaQR;
}

/** La dirección que abre el panel en el celular, ya con el código puesto. */
function direccionSala(codigo) {
  return new URL(`control.html?sala=${encodeURIComponent(codigo)}`, location.href).href;
}

const SALA_TEXTOS = {
  abriendo: ['buscando', 'Abriendo la sala…'],
  abierta: ['esperando', 'Esperando al celular…'],
  ocupada: ['mal', 'Ese código ya lo usa otro escenario: probá con otro.'],
  'sin-internet': ['mal', 'Sin internet: la sala se abre sola cuando vuelva.'],
};

/** La sección "Desde el celular" del diálogo Panel. */
function pintarSala() {
  const sala = enlace.sala;
  const abierta = sala.estado !== 'cerrada';
  const clave = `${abierta}:${sala.codigo}`;

  if (salaPintada !== clave) {
    salaPintada = clave;
    if (!abierta) {
      el.panelSala.innerHTML =
        '<p class="sheet__note">NOVA abre una <strong>sala</strong> con un código. En el celular abrís el panel, ' +
        'ponés el código, y lo que toques ahí pasa en esta pantalla y en la tele. Va por internet, sin instalar nada: ' +
        'el celular puede estar en cualquier red, hasta con sus datos.</p>' +
        '<div class="sheet__foot"><button class="primary" type="button" data-sala="abrir">Crear la sala para el celular</button></div>';
      return;
    }
    const direccion = direccionSala(sala.codigo);
    el.panelSala.innerHTML =
      '<div class="sala">' +
        '<div class="sala__qr" id="salaQR" aria-label="Código QR para abrir el panel en el celular"></div>' +
        '<div class="sala__datos">' +
          '<p class="sala__rotulo">Código de la sala</p>' +
          `<p class="sala__codigo">${escapar(sala.codigo)}</p>` +
          '<p class="sala__estado" id="salaEstado"></p>' +
          `<p class="panel__direccion"><a href="${escapar(direccion)}" target="_blank" rel="noopener">${escapar(direccion)}</a></p>` +
          '<p class="sheet__note">Escaneá el QR con el celular, o abrí esa dirección y poné el código. La sala queda abierta aunque recargues esta página.</p>' +
          `<p class="sheet__note">¿El celular no entra? Abrí en él <a href="${escapar(new URL(`prueba-sala.html?sala=${encodeURIComponent(sala.codigo)}`, location.href).href)}" target="_blank" rel="noopener">la prueba de la sala</a>: dice qué deja pasar esa red.</p>` +
          '<div class="sheet__foot">' +
            '<button class="ghost" type="button" data-sala="cambiar">Otro código</button>' +
            '<button class="ghost" type="button" data-sala="cerrar">Cerrar la sala</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    cargarQR().then((QRCode) => {
      const caja = document.getElementById('salaQR');
      if (!caja || salaPintada !== clave) return;
      caja.innerHTML = '';
      new QRCode(caja, { text: direccion, width: 168, height: 168, colorDark: '#05060c', colorLight: '#eef1ff', correctLevel: QRCode.CorrectLevel.M });
    }).catch(() => {
      const caja = document.getElementById('salaQR');
      if (caja) caja.innerHTML = '<p class="vacio">Sin QR (no se pudo cargar). Usá la dirección.</p>';
    });
  }
  if (!abierta) return;

  const estado = document.getElementById('salaEstado');
  if (!estado) return;
  let [clase, texto] = SALA_TEXTOS[sala.estado] || ['buscando', sala.detalle || sala.estado];
  if (sala.estado === 'abierta' && sala.conectados) {
    clase = 'bien';
    const via = sala.via === 'directo' ? ' (directo)' : sala.via === 'relevo' ? ' (por relevo)' : '';
    texto = sala.conectados === 1 ? `Celular conectado${via}: lo que toques ahí pasa acá.` : `${sala.conectados} celulares conectados${via}.`;
  }
  estado.dataset.estado = clase;
  estado.textContent = texto;
}

function abrirSala(codigo = codigoNuevo()) {
  localStorage.setItem(SALA_CLAVE, codigo);
  enlace.abrirSala(codigo);
  anotar(`Sala ${codigo} abierta para el celular.`);
  pintarSala();
}

function cerrarSala() {
  localStorage.removeItem(SALA_CLAVE);
  enlace.cerrarSala();
  anotar('Sala del celular cerrada.');
  pintarSala();
}

/** La otra manera: el servidor propio, en la misma red. */
async function pintarRed() {
  el.panelRed.innerHTML = '<p class="vacio">Buscando el servidor…</p>';
  let info = null;
  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (res.ok) info = await res.json();
  } catch { /* sin servidor */ }

  if (!info?.control) {
    el.panelRed.innerHTML =
      '<p class="vacio">Esta página está servida sin el servidor de NOVA. Si preferís no depender de internet, ' +
      'corré <code>npm start</code> en esta computadora y abrí la página desde ahí: el celular entra por la ' +
      'dirección de la red Wi-Fi, sin sala.</p>';
    return;
  }

  const puerto = location.port ? `:${location.port}` : '';
  const direcciones = (info.direcciones || []).map((ip) => `http://${ip}${puerto}/control.html`);
  if (!direcciones.length) {
    el.panelRed.innerHTML = '<p class="vacio">El servidor está corriendo, pero esta máquina no tiene una dirección de red visible.</p>';
    return;
  }
  el.panelRed.innerHTML =
    '<p class="sheet__note">Hay servidor: desde un celular <strong>en la misma red Wi-Fi</strong> también se puede abrir una de estas direcciones, sin sala:</p>' +
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
        micDiag: state.micDiag,
        micQuerido: state.micQuerido,
        voz: speaker.enabled,
        vozMotor: speaker.motorActual,
        camara: state.camara,
        imagen: state.imagen,
        imagenVisible: state.imagenVisible,
        fondo: state.fondo,
        palabra: state.palabra,
        oido: state.oido,
        ultimaRespuesta: state.ultimaRespuesta,
        evento: state.evento,
        guion: guion.resumen(),
        asistente: arbitro.modo,
        asistenteConversa: arbitro.conversa,
        turno: show.current,
        plantel: show.speakers,
        acuerdos: show.agreements.length,
        enlace: enlace.servidor,
        sala: enlace.sala,
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
      if (Boolean(mensaje.on) !== (listener.active || state.micQuerido)) toggleMic();
      break;
    }
    case 'voz': setVoice(Boolean(mensaje.on)); break;
    case 'camara': verCamara(Boolean(mensaje.on)); break;
    case 'fondo': ponerFondo(mensaje.on === false ? 'ninguno' : guion.entradas[mensaje.indice]?.fondo); break;
    case 'palabra': ponerPalabra(mensaje.on === false ? 'ninguna' : String(mensaje.texto || guion.entradas[mensaje.indice]?.palabra || '')); break;
    case 'pantalla': {
      // Lo que el guion pide para la pantalla en ese parlamento, sin decirlo.
      const entrada = guion.entradas[Number(mensaje.indice)];
      if (entrada) {
        aplicarPantalla(entrada);
        anotar(`Pantalla del parlamento ${entrada.indice + 1} aplicada desde el panel.`);
      }
      break;
    }
    case 'imagen': {
      if (Number.isInteger(mensaje.indice)) {
        const imagen = guion.entradas[mensaje.indice]?.imagenes?.[0];
        if (imagen) mostrarImagen(imagen);
      } else if (mensaje.on === false) {
        ocultarImagen();
      } else {
        alternarImagen();
      }
      break;
    }
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
  const sala = enlace.sala;
  const porSala = sala.estado === 'abierta';

  let rotulo = servidor ? 'Panel por red' : 'Panel solo acá';
  if (porSala) rotulo = sala.conectados ? `Celular · sala ${sala.codigo}` : `Sala ${sala.codigo}`;
  else if (sala.estado !== 'cerrada') rotulo = `Sala ${sala.codigo}…`;
  setStatus(servidor || porSala ? 'online' : 'local', rotulo);
  el.status.title = porSala
    ? `Sala ${sala.codigo} abierta: el panel se maneja desde el celular, por internet.`
    : servidor
      ? 'Hay servidor: el panel de control se puede abrir desde otro dispositivo de la red.'
      : 'Sin servidor: el panel de control se abre en otra ventana de esta computadora, o desde el celular creando una sala (botón Panel).';

  if (sala.conectados !== celularesAntes) {
    if (sala.conectados > celularesAntes) toast('Celular conectado al panel.');
    else if (sala.estado !== 'cerrada') toast('El celular se desconectó del panel.');
    celularesAntes = sala.conectados;
  }
  if (el.panel.open) pintarSala();
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
  el.asistenteBtn.addEventListener('click', () => {
    pintarAsistente();
    pintarVoz({ formulario: true });
    el.asistente.showModal();
  });
  el.asistenteClose.addEventListener('click', () => el.asistente.close());
  el.asistenteProbar.addEventListener('click', () => probarAsistente());
  el.asistenteProveedor.addEventListener('change', () => {
    const quien = PROVEEDORES[el.asistenteProveedor.value];
    el.asistenteClave.placeholder = quien.pista;
    el.asistenteModelo.placeholder = quien.modelo;
    if (el.asistenteModelo.value in Object.fromEntries(Object.values(PROVEEDORES).map((p) => [p.modelo, 1]))) el.asistenteModelo.value = '';
  });
  el.asistenteGuardar.addEventListener('click', async () => {
    arbitro.proveedor = el.asistenteProveedor.value;
    arbitro.clave = el.asistenteClave.value;
    arbitro.modelo = el.asistenteModelo.value;
    arbitro.uso = el.asistenteUso.value;
    arbitro.personalidad = el.asistentePersonalidad.value;
    await arbitro.detectar();
    pintarAsistente();
    speaker.configurar({});
    pintarVoz();
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

/**
 * Una consulta de verdad, con un guion mínimo, para saber si la clave anda
 * antes de la función. Cuesta una fracción de centavo.
 */
async function probarAsistente() {
  arbitro.proveedor = el.asistenteProveedor.value;
  arbitro.clave = el.asistenteClave.value;
  arbitro.modelo = el.asistenteModelo.value;
  arbitro.uso = el.asistenteUso.value;
  arbitro.personalidad = el.asistentePersonalidad.value;
  await arbitro.detectar();
  pintarAsistente();
  if (!arbitro.disponible) return toast('No hay clave guardada ni servidor con clave: no hay qué probar.');

  el.asistenteProbar.disabled = true;
  el.asistenteProbar.textContent = 'Probando…';
  const desde = Date.now();
  const veredicto = await arbitro.ubicar({
    oido: 'hola nova, ¿nos estás escuchando?',
    cursor: -1,
    entradas: [
      { indice: 0, pies: ['Hola NOVA, ¿nos escuchás bien?'], parlamento: 'Los escucho perfecto.' },
      { indice: 1, pies: ['¿Te podés equivocar?'], parlamento: 'Todo el tiempo.' },
    ],
  });
  el.asistenteProbar.disabled = false;
  el.asistenteProbar.textContent = 'Probar';

  const tardo = ((Date.now() - desde) / 1000).toFixed(1);
  if (veredicto.error) toast(`El asistente no respondió: ${veredicto.error}.`);
  else if (veredicto.indice === 0) toast(`Funciona: ubicó el pie correcto en ${tardo} s.`);
  else toast(`Respondió en ${tardo} s, pero no ubicó el pie esperado (dijo ${veredicto.indice === null ? 'ninguno' : veredicto.indice + 1}).`);
}

/* ---------------------------------------------------------------- la voz */

/**
 * De dónde saldría la clave de OpenAI para la voz: la propia de la voz, la
 * del asistente si usa OpenAI, o el servidor si la tiene en su .env.
 */
function modoVozOpenAI(ajustes) {
  // Ojo: se llama mientras se construye el hablante, así que no se puede
  // mirar `speaker`; los ajustes llegan por parámetro.
  if (ajustes?.claveOpenAI) return 'directo';
  if (arbitro.proveedor === 'openai' && arbitro.clave) return 'directo';
  if (state.servidorVoz) return 'servidor';
  return 'ninguno';
}

function wireVoz() {
  VOCES_OPENAI.forEach(([valor, nombre]) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = nombre;
    el.vozOpenAI.appendChild(opcion);
  });
  el.vozMotor.addEventListener('change', () => mostrarCamposVoz());
  el.vozVelocidad.addEventListener('input', () => (el.vozVelocidadValor.textContent = Number(el.vozVelocidad.value).toFixed(2).replace(/0$/, '')));
  el.vozGuardar.addEventListener('click', () => {
    guardarVoz();
    toast(speaker.motorActual === 'openai' ? 'Voz por API guardada.' : 'Voz del navegador guardada.');
  });
  el.vozProbar.addEventListener('click', () => {
    guardarVoz();
    if (!speaker.supported) return toast('Este navegador no puede hablar, y no hay clave para la voz por API.');
    const enabled = speaker.enabled;
    speaker.enabled = true;
    speaker.cancel();
    speaker.say('Hola. Soy NOVA, la inteligencia de esta muestra. Así voy a sonar en la función.');
    speaker.say('¿Les parece bien, o probamos otra voz?');
    setTimeout(() => (speaker.enabled = enabled), 50);
  });
  if (voiceSupport.speak) speechSynthesis.addEventListener?.('voiceschanged', () => pintarVoz());
  // Si hay servidor con clave de OpenAI, la voz por API no necesita clave acá.
  fetch('api/health', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((info) => {
    state.servidorVoz = Boolean(info?.voz);
    speaker.configurar({});
    pintarVoz();
  }).catch(() => pintarVoz());
}

function mostrarCamposVoz() {
  const api = el.vozMotor.value === 'openai';
  el.vozNavegadorCampos.hidden = api;
  el.vozOpenAICampos.hidden = !api;
}

function guardarVoz() {
  speaker.configurar({
    motor: el.vozMotor.value,
    nombre: el.vozNombre.value,
    velocidad: Number(el.vozVelocidad.value) || 1,
    claveOpenAI: el.vozClave.value.trim(),
    vozOpenAI: el.vozOpenAI.value,
    instrucciones: el.vozInstrucciones.value.trim(),
  });
  pintarVoz({ formulario: true });
  publicar();
}

/**
 * Lo que hay y lo que está elegido, en el panel. Los campos del formulario
 * se cargan solo cuando se pide (al abrir el panel o después de guardar):
 * si no, una lista de voces que llega tarde pisaría lo que la persona
 * está escribiendo.
 */
function pintarVoz({ formulario = false } = {}) {
  const a = speaker.ajustes;
  if (formulario) {
    el.vozMotor.value = a.motor;
    el.vozVelocidad.value = String(a.velocidad);
    el.vozVelocidadValor.textContent = a.velocidad.toFixed(2).replace(/0$/, '');
    el.vozClave.value = a.claveOpenAI;
    el.vozOpenAI.value = a.vozOpenAI;
    el.vozInstrucciones.value = a.instrucciones;
    mostrarCamposVoz();
  }

  // Las voces del navegador, de mejor a peor, sin perder la elegida.
  const voces = vocesDisponibles();
  const elegida = formulario ? a.nombre : el.vozNombre.value;
  el.vozNombre.innerHTML = '<option value="">La mejor que haya</option>';
  for (const voz of voces) {
    const opcion = document.createElement('option');
    opcion.value = voz.name;
    opcion.textContent = `${voz.name} (${voz.lang})`;
    el.vozNombre.appendChild(opcion);
  }
  el.vozNombre.value = voces.some((v) => v.name === elegida) ? elegida : '';

  const mejor = voces[0];
  const buena = mejor && /natural|neural|google|premium|enhanced|siri/i.test(mejor.name);
  const sinClave = a.motor === 'openai' && speaker.modoApi === 'ninguno';
  el.vozEstado.innerHTML = speaker.motorActual === 'openai'
    ? `<strong>Habla con la voz neuronal de OpenAI</strong> (${escapar(a.vozOpenAI)}), ${speaker.modoApi === 'servidor' ? 'con la clave del servidor' : 'con la clave de este navegador'}.`
    : sinClave
      ? '<strong>Pediste la voz por API, pero no hay clave de OpenAI.</strong> Pegala abajo, o en el asistente, o en el .env del servidor. Mientras tanto habla con el navegador.'
      : !voces.length
        ? '<strong>Este navegador no tiene voces en español.</strong> La voz por API resuelve eso.'
        : `<strong>Habla con la voz del navegador:</strong> ${escapar((speaker.motor?.voice || mejor)?.name || '')}. ${buena ? 'Es de las buenas.' : 'Suena a robot: en Edge hay voces "Natural" y en Chrome las de Google, o probá la voz por API.'}`;
}

/** Qué asistente hay, en su panel y para el panel de control. */
function pintarAsistente() {
  const quien = PROVEEDORES[arbitro.proveedor];
  el.asistenteProveedor.value = arbitro.proveedor;
  el.asistenteClave.value = arbitro.clave;
  el.asistenteClave.placeholder = quien.pista;
  el.asistenteModelo.value = arbitro.modelo;
  el.asistenteModelo.placeholder = quien.modelo;
  el.asistenteUso.value = arbitro.uso;
  el.asistentePersonalidad.value = arbitro.personalidad;
  const hace = arbitro.uso === 'conversar' ? 'Ubica el pie y, si no hay, conversa como NOVA.' : 'Solo ubica el pie: NOVA dice únicamente el guion.';
  el.asistenteEstado.innerHTML = {
    servidor: `<strong>Asistente activo por el servidor, con ${escapar(arbitro.conQuien)}.</strong> ${hace} La clave está en el <code>.env</code> de la computadora que corre NOVA.`,
    directo: `<strong>Asistente activo con ${escapar(quien.nombre)}, con la clave de este navegador.</strong> ${hace}`,
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
    ? 'Espacio: micrófono · S: guion · C: cámara · I: imagen · A: fijar acuerdo · M: muro · F: salir'
    : 'Espacio: micrófono · C: cámara · A: fijar acuerdo · M: muro · F: salir';

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
  aplicarPantalla(entrada);
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
  if (state.palabra) ponerPalabra('ninguna');
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

  // Solo se apaga si está escuchando de verdad. Si quería estar prendido
  // pero no pudo (sin permiso todavía), el toque es para prenderlo.
  if (listener.active) {
    state.micQuerido = false;
    writeStored('nova:mic', 'off');
    listener.stop();
    micApagado();
    anotar('Micrófono apagado a mano. Queda apagado hasta que lo vuelvas a prender.');
    return;
  }

  state.micQuerido = true;
  state.micFatal = '';
  writeStored('nova:mic', 'on');
  await encenderMic({ automatico: false });
}

/**
 * Abre el micrófono. Si es automático (al cargar la página, o al
 * recuperarse de un corte) y el navegador no lo deja, se queda esperando
 * a que la persona toque el botón, que es el gesto que el navegador pide.
 */
async function encenderMic({ automatico }) {
  if (!listener || listener.active || state.abriendoMic) return;

  state.abriendoMic = true;
  setMicActive(true);
  setMode('listening');
  el.micHint.textContent = 'Abriendo el micrófono…';
  const ok = await listener.start();
  state.abriendoMic = false;

  if (!ok || !listener.active) {
    micApagado();
    if (automatico) el.micHint.textContent = 'Tocá el micrófono para darle permiso';
    return;
  }
  el.micHint.textContent = 'Escuchando. Queda encendido; Espacio lo apaga';
  anotar(automatico ? 'Micrófono encendido solo.' : 'Micrófono encendido.');

  // El nivel de voz es lo que mueve los visuales. Si el navegador no deja
  // abrir el micrófono dos veces, la página sigue andando sin reaccionar.
  meter.start().then((bien) => {
    if (!bien) {
      console.info('NOVA: sin medidor de voz; los visuales no reaccionan al volumen.');
      pintarMic(`${listener.diagnostico} · sin medidor de volumen`);
    }
  });
}

/** Deja todo como cuando el micrófono está cerrado. */
function micApagado() {
  meter.stop();
  clearTimeout(state.silenceTimer);
  state.pendingSpeech.length = 0;
  showHeard('', false);
  setMicActive(false);
  el.micHint.textContent = state.micQuerido ? 'Micrófono caído: se vuelve a prender solo' : 'Tocá para encender el micrófono';
  if (!state.busy) setMode('idle');
  publicar();
}

function setMicActive(active) {
  el.micBtn.setAttribute('aria-pressed', String(active));
}

/**
 * Mientras la persona todavía habla, si lo que va diciendo ya coincide con
 * claridad con un pie, NOVA contesta sin esperar a que termine ni al
 * silencio. Es lo que más tiempo ahorra. Solo con coincidencias fuertes:
 * un pie que se parece a medias espera la frase completa.
 */
function anticipar(parcial) {
  if (state.busy || !guion.activo || !guion.tiene) return;
  const texto = [...state.pendingSpeech, parcial].join(' ').trim();
  if (texto.split(/\s+/).length < 3) return;
  const hallado = guion.buscar(texto);
  if (!hallado || hallado.puntaje < 0.9) return;

  clearTimeout(state.silenceTimer);
  state.pendingSpeech.length = 0;
  state.anticipado = { texto, t: Date.now() };
  send(texto, { fromVoice: true });
}

/**
 * Junta lo dictado y espera un silencio corto antes de mandarlo.
 * Así un grupo puede hablar en varias frases sin que se corte cada vez.
 */
function queueSpeech(text) {
  // La versión final de una frase que ya se contestó anticipada no se manda de nuevo.
  const previo = state.anticipado;
  if (previo && Date.now() - previo.t < ANTICIPO_MS && puntaje(text, previo.texto) >= 0.6) {
    state.anticipado = null;
    return;
  }

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
  // En la consola también se ve lo que va oyendo, para saber que anda.
  if (text && listener?.active) el.micHint.textContent = `Oigo: «${text.length > 60 ? `…${text.slice(-60)}` : text}»`;
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
  recordar('user', text);

  // En el escenario primero se ve lo que dijo la persona…
  if (isStage()) {
    el.scene.dataset.speaker = 'human';
    el.sceneLabel.textContent = show.current ? show.current.name.toUpperCase() : 'EL PÚBLICO';
    sceneWriter.clear();
    sceneWriter.push(text);
  }

  let hallado = guion.buscar(text);

  // Sin pie por parecido y con una IA que conversa: una sola consulta decide
  // si era un pie (y NOVA dice el guion) o si NOVA improvisa, en streaming.
  if (!hallado && arbitro.conversa && guion.tiene) {
    anotar(`No reconoció «${text}» por parecido: consulta a la IA.`);
    await responder(conversarConIA(text), { origen: 'ia' });
    return;
  }

  // Solo si el parecido no alcanza, el asistente decide a qué pie
  // corresponde. Mientras tanto NOVA "piensa", que es exactamente lo que pasa.
  if (!hallado && arbitro.disponible && guion.activo && guion.tiene) {
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
    aplicarPantalla(hallado.entrada);
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
 * Lo que produce la IA cuando conversa: si resulta ser un pie, NOVA dice
 * el parlamento del guion por el mismo canal; si no, deja pasar lo que la IA
 * va diciendo. Devuelve la función que responder() ejecuta.
 */
function conversarConIA(text) {
  return async (onDelta, signal, marcar) => {
    const veredicto = await arbitro.conversar(
      { oido: text, cursor: guion.cursor, entradas: guion.entradas, historial: state.historial },
      onDelta,
      signal,
    );

    if (veredicto.indice != null && guion.entradas[veredicto.indice]?.pies.length) {
      const entrada = guion.entradas[veredicto.indice];
      guion.marcar(entrada.indice);
      aplicarPantalla(entrada);
      marcar('guion');
      anotar(`La IA ubicó el pie ${entrada.indice + 1}: «${text}».`);
      return gotear(entrada.parlamento, onDelta, signal);
    }

    if (veredicto.texto) {
      anotar('NOVA improvisa con la IA.');
      return veredicto.texto;
    }

    // La IA no pudo: comodín si hay, y si no, se dice qué pasó.
    anotar(veredicto.error ? `La IA no respondió: ${veredicto.error}.` : 'La IA no dijo nada.');
    const comodin = guion.comodin;
    if (comodin) {
      marcar('comodin');
      return gotear(comodin, onDelta, signal);
    }
    throw new Error(veredicto.error ? `La IA no respondió: ${veredicto.error}.` : 'La IA no dijo nada.');
  };
}

/**
 * NOVA dice un texto: lo deja caer letra por letra, lo lee en voz alta y
 * lo recuerda por si se fija en el muro.
 *
 * @param {string | ((onDelta:(d:string)=>void, signal:AbortSignal, marcar:(o:string)=>void) => Promise<string>)} fuente
 *   el texto, o quien lo va entregando de a pedazos
 * @param {{origen: 'guion'|'comodin'|'libre'|'ia'}} opts
 */
async function responder(fuente, { origen }) {
  state.busy = true;
  el.stopBtn.hidden = false;
  el.sendBtn.disabled = true;
  state.ultimaRespuesta = '';
  el.pinBtn.disabled = true;

  setMode('thinking');

  const bubble = addBubble('ai', '', { pending: true });
  const TITULOS = { guion: 'Dicho según el guion', comodin: 'Comodín: no reconoció el pie', libre: 'Escrito desde el panel', ia: 'Improvisado con la IA' };
  const marcar = (nuevo) => {
    bubble.closest('.msg')?.classList.remove(`msg--${origen}`);
    origen = nuevo;
    bubble.closest('.msg')?.classList.add(`msg--${origen}`);
    bubble.title = TITULOS[origen];
  };
  marcar(origen);
  const bubbleWriter = new Materializer(bubble, { charsPerSecond: 70 });
  let firstChunk = true;
  let answer = '';

  state.controller = new AbortController();

  try {
    const entregar = typeof fuente === 'function' ? fuente : (onDelta, signal) => gotear(fuente, onDelta, signal);
    answer = await entregar(
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
      marcar,
    );

    sentences.flush();
    bubbleWriter.flush();
    bubble.classList.remove('is-streaming');

    state.ultimo = { role: 'assistant', content: answer };
    recordar('assistant', answer);
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

/** La charla que la IA tiene en cuenta cuando improvisa. */
function recordar(role, content) {
  const limpio = (content || '').trim();
  if (!limpio) return;
  state.historial.push({ role, content: limpio });
  if (state.historial.length > 24) state.historial.splice(0, state.historial.length - 24);
}

function reset() {
  abort();
  state.historial.length = 0;
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

  // En el escenario, las palabras dejan libre el lugar donde está el texto
  // grande, midiéndolo de verdad: así el hueco sigue al texto cuando crece.
  cloud.setClearZone(on ? zonaDelTexto : null);
  cloud.setEscenario(on);
  cloud.resize();
  publicar();
}

/**
 * Dónde está el texto grande ahora, para que la nube lo esquive. Abarca el
 * rótulo y el texto (y lo que se oye, abajo). Cuando no hay texto, el
 * hueco es chico y la nube ocupa el centro.
 */
function zonaDelTexto() {
  const caja = (elementos) => {
    const cajas = elementos
      .filter((e) => e && e.textContent.trim() && e.offsetParent !== null)
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    if (!cajas.length) return null;
    const left = Math.min(...cajas.map((r) => r.left));
    const right = Math.max(...cajas.map((r) => r.right));
    const top = Math.min(...cajas.map((r) => r.top));
    const bottom = Math.max(...cajas.map((r) => r.bottom));
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, hw: (right - left) / 2, hh: (bottom - top) / 2 };
  };
  const texto = caja([el.sceneLabel, el.sceneText, el.sceneQuien, el.sceneHeard])
    || { cx: innerWidth / 2, cy: innerHeight / 2, hw: innerWidth * 0.12, hh: innerHeight * 0.08 };
  // También el orbe de arriba y la ayuda de abajo, que tienen que leerse.
  return [texto, caja([el.sceneOrb, el.sceneState]), caja([el.sceneHint])];
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
