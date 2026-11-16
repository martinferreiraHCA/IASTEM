/**
 * Panel de control: ve por dónde va NOVA y la maneja a distancia.
 *
 * No tiene lógica propia: todo lo que muestra se lo cuenta el escenario por
 * el enlace, y todo lo que hace es mandarle órdenes. Si se pierde la
 * conexión, lo dice; si el escenario se recarga, se vuelve a enganchar solo.
 */

import { Enlace, normalizarCodigo } from './js/enlace.js';
import { urlDeNube, guardarUrlDeNube } from './js/nube.js';
import { VERSION, versionPublicada, actualizarSitio, yaSeIntento } from './js/actualizar.js';

const $ = (id) => document.getElementById(id);

const el = {
  enlace: $('enlace'),
  enlaceTexto: $('enlaceTexto'),
  sala: $('sala'),
  formSala: $('formSala'),
  salaCodigo: $('salaCodigo'),
  salaDentro: $('salaDentro'),
  salaTexto: $('salaTexto'),
  salaSalir: $('salaSalir'),
  ahora: $('ahora'),
  modo: $('modo'),
  escena: $('escena'),
  oido: $('oido'),
  dicho: $('dicho'),
  siguiente: $('siguiente'),
  atras: $('atras'),
  tocar: $('tocar'),
  otroGuion: $('otroGuion'),
  videoAhora: $('videoAhora'),
  versionVieja: $('versionVieja'),
  actualizarNova: $('actualizarNova'),
  cargarMuestra: $('cargarMuestra'),
  limpiar: $('limpiar'),
  medios: $('medios'),
  entrega: $('entrega'),
  siguienteDetalle: $('siguienteDetalle'),
  detener: $('detener'),
  progreso: $('progreso'),
  activo: $('activo'),
  reiniciar: $('reiniciar'),
  lineas: $('lineas'),
  guionTexto: $('guionTexto'),
  guionArchivo: $('guionArchivo'),
  guionGuardar: $('guionGuardar'),
  mic: $('mic'),
  voz: $('voz'),
  escenario: $('escenario'),
  micNota: $('micNota'),
  camara: $('camara'),
  imagen: $('imagen'),
  imagenNota: $('imagenNota'),
  fondo: $('fondo'),
  palabra: $('palabra'),
  letrero: $('letrero'),
  video: $('video'),
  apagar: $('apagar'),
  turnoSiguiente: $('turnoSiguiente'),
  turnos: $('turnos'),
  fijar: $('fijar'),
  acuerdos: $('acuerdos'),
  formTexto: $('formTexto'),
  texto: $('texto'),
  formOido: $('formOido'),
  oidoTexto: $('oidoTexto'),
  eventos: $('eventos'),
  aviso: $('aviso'),
};

const MODOS = {
  idle: 'En espera',
  listening: 'Escuchando',
  thinking: 'Pensando',
  answering: 'Respondiendo',
  speaking: 'Hablando',
  error: 'Error',
};

const ESCENAS = { portada: 'Portada', charla: 'Charla', muro: 'Muro' };

let estado = null;
let ultimaSenal = 0;
let versionDelSitio = '';  // la publicada, cuando se pudo mirar
let videoReloj = null;     // { t, en }: por dónde iba el video cuando llegó el último estado
const eventos = []; // los últimos, por orden de llegada

// El guion entero llega aparte del estado, y solo cuando cambia: acá se guarda.
let guionGuardado = { version: '', entradas: [], medios: [] };
let mediosPintados = null; // qué versión de la botonera de pantalla está dibujada
let guionPedido = 0;       // cuándo se pidió por última vez
let listaPintada = null;   // qué versión del guion está dibujada en la lista
let plantelPintado = '';   // y qué plantel
let cursorPintado = null;

const enlace = new Enlace('panel', (mensaje) => {
  if (mensaje.tipo === 'guion') {
    guionGuardado = { version: mensaje.version, entradas: mensaje.entradas || [], medios: mensaje.medios || [] };
    if (estado) { completarGuion(); pintar(); }
    return;
  }
  if (mensaje.tipo !== 'estado' || !mensaje.estado) return;
  // La nube no guarda listas vacías ni valores nulos: lo que falta se completa.
  mensaje.estado.plantel ||= [];
  mensaje.estado.guion ||= { activo: true, cursor: -1, total: 0, comodines: 0, version: '' };
  mensaje.estado.sala ||= {};
  // Lo que la nube tenía guardado de antes se muestra, pero no cuenta como
  // señal: el escenario puede haberse ido. Se le pregunta si está.
  if (mensaje.deAntes) {
    if (estado) return;
    estado = mensaje.estado;
    pedir();
  } else {
    estado = mensaje.estado;
    ultimaSenal = Date.now();
    const video = estado.videoEstado;
    videoReloj = video?.fase === 'corre' ? { t: video.t || 0, en: Date.now() } : null;
  }
  completarGuion();
  pintar();
});
enlace.onCambio = () => pintarEnlace();
enlace.onEntrega = (entrega) => pintarEntrega(entrega);

/** Le pone al estado las líneas del guion guardado; si son de otra versión, las pide. */
function completarGuion() {
  const { guion } = estado;
  if (guion.version === guionGuardado.version) {
    guion.entradas = guionGuardado.entradas;
    guion.medios = guionGuardado.medios;
    return;
  }
  guion.entradas = [];
  guion.medios = [];
  guion.esperando = guion.total > 0;
  if (Date.now() - guionPedido > 1500) {
    guionPedido = Date.now();
    enlace.enviar({ tipo: 'comando', accion: 'guion' });
  }
}

/* Si la orden llegó: se dice abajo de los botones, y cuánto tardó. */
let ordenActual = null; // {id, texto}
let entregaTimer = null;
function pintarEntrega({ id, estado: como, ms, intento }) {
  if (!ordenActual || ordenActual.id !== id) return;
  clearTimeout(entregaTimer);
  el.entrega.dataset.estado = como;
  if (como === 'enviando') el.entrega.textContent = intento ? `${ordenActual.texto}: reintentando (${intento + 1})…` : `${ordenActual.texto}: enviando…`;
  else if (como === 'ok') {
    el.entrega.textContent = `${ordenActual.texto}: recibido · ${ms} ms${intento ? `, al intento ${intento + 1}` : ''}`;
    entregaTimer = setTimeout(() => { el.entrega.textContent = ''; el.entrega.dataset.estado = ''; }, 4000);
  } else {
    el.entrega.textContent = `${ordenActual.texto}: NO LLEGÓ. Fijate la conexión y tocá de nuevo.`;
    navigator.vibrate?.([60, 60, 60]);
  }
}

const SALA_CLAVE = 'nova:sala-panel';
const SALA_TEXTOS = {
  entrando: 'entrando…',
  esperando: 'el escenario todavía no la abrió',
  conectada: 'conectada',
  perdida: 'se cortó, reintentando…',
  'sin-internet': 'sin internet, reintentando…',
};

let despierto = null; // el pedido de pantalla encendida, si el navegador lo da

/* ----------------------------------------------------------- arranque */

wire();
entrarSalaGuardada();
pintarEnlace();
pedir();
// Mientras no haya señal, se insiste; y si se corta, se nota en seguida.
setInterval(() => {
  const sinSenal = !estado || Date.now() - ultimaSenal > 14000; // el escenario late cada 6 s
  if (sinSenal) {
    enlace.reanimar();
    pedir();
  }
  pintarEnlace();
}, 4000);
// Al volver al panel (el celular estaba bloqueado, o en otra app) o recuperar la red: revivir ya.
const revivir = () => { enlace.reanimar(); pedir(); };
for (const evento of ['online', 'pageshow', 'focus']) window.addEventListener(evento, revivir);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revivir(); });

// El reloj del video corre en el celular entre un estado y el siguiente.
setInterval(() => { if (videoReloj) pintarVideoAhora(); }, 1000);
// La versión del sitio: al abrir, cada tanto y al volver a la pestaña.
setTimeout(() => mirarVersion(), 2500);
setInterval(() => mirarVersion(), 180000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mirarVersion(); });

function pedir() {
  enlace.enviar({ tipo: 'comando', accion: 'hola' });
}

const NOMBRES_ORDEN = { siguiente: 'Adelante', atras: 'Atrás', detener: 'Detener', decir: 'Decir línea', pantalla: 'Solo pantalla', apagar: 'Apagar', reiniciar: 'Al principio', 'cargar-muestra': 'Guion de la muestra', poner: 'Pantalla', limpiar: 'Pantalla limpia' };

/** Manda una orden al escenario y espera su acuse; lo que pasa se ve abajo de los botones. */
function mandar(accion, extra = {}) {
  const texto = accion === 'decir' ? `Línea ${Number(extra.indice) + 1}` : NOMBRES_ORDEN[accion] || 'Orden';
  navigator.vibrate?.(12);
  ordenActual = { id: null, texto };
  const id = enlace.enviar({ tipo: 'comando', accion, ...extra }, { confirmar: true });
  ordenActual.id = id;
  pintarEntrega({ id, estado: 'enviando', intento: 0 });
}

/* --------------------------------------------------------------- sala */

/** Entra a la sala del QR (?sala=CODIGO) o a la última que se usó. */
async function entrarSalaGuardada() {
  const url = new URL(location.href);
  const delQR = normalizarCodigo(url.searchParams.get('sala'));
  const nubeDelQR = url.searchParams.get('nube');
  if (nubeDelQR) guardarUrlDeNube(nubeDelQR); // la dirección de la nube viene en el QR
  if (delQR || nubeDelQR) {
    url.searchParams.delete('sala');
    url.searchParams.delete('nube');
    history.replaceState(null, '', url); // queda guardado, no en la barra
  }
  enlace.configurarNube(await urlDeNube());
  const codigo = delQR || normalizarCodigo(localStorage.getItem(SALA_CLAVE));
  if (codigo) entrarSala(codigo);
}

function entrarSala(codigo) {
  codigo = normalizarCodigo(codigo);
  if (!codigo) return;
  localStorage.setItem(SALA_CLAVE, codigo);
  el.salaCodigo.value = codigo;
  enlace.entrarSala(codigo);
  pintarEnlace();
}

function salirSala() {
  localStorage.removeItem(SALA_CLAVE);
  enlace.cerrarSala();
  estado = null;
  pintarEnlace();
  el.salaCodigo.focus();
}

/* Que el celular no se apague en la mano mientras maneja la función. */
async function mantenerDespierto() {
  if (!('wakeLock' in navigator) || despierto || document.visibilityState !== 'visible') return;
  try {
    despierto = await navigator.wakeLock.request('screen');
    despierto.addEventListener('release', () => { despierto = null; });
  } catch { /* no se pudo: no es grave */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') mantenerDespierto(); });
document.addEventListener('pointerdown', () => mantenerDespierto(), { passive: true });

/* ------------------------------------------------------------ eventos */

function wire() {
  el.formSala.addEventListener('submit', (event) => {
    event.preventDefault();
    entrarSala(el.salaCodigo.value);
  });
  el.salaCodigo.addEventListener('input', () => { el.salaCodigo.value = normalizarCodigo(el.salaCodigo.value); });
  el.salaSalir.addEventListener('click', () => salirSala());

  el.siguiente.addEventListener('click', () => mandar('siguiente'));
  el.atras.addEventListener('click', () => mandar('atras'));
  el.limpiar.addEventListener('click', () => mandar('limpiar'));
  // La botonera de pantalla: tocar pone, tocar lo que está puesto lo saca.
  el.medios.addEventListener('click', (event) => {
    const boton = event.target.closest('.medio');
    if (!boton) return;
    mandar('poner', { que: boton.dataset.tipo, valor: boton.dataset.valor, on: boton.getAttribute('aria-pressed') !== 'true' }); // `tipo` es del sobre: acá va `que`
  });
  // Con teclado (el panel abierto en la notebook, o un puntero de presentaciones).
  document.addEventListener('keydown', (event) => {
    if (event.repeat || (event.target instanceof Element && event.target.matches('input, textarea, select'))) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); if (!el.siguiente.disabled) mandar('siguiente'); }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); if (!el.atras.disabled) mandar('atras'); }
  });
  // Las líneas del guion: un solo oyente para toda la lista, que no se rehace con cada mensaje.
  el.lineas.addEventListener('click', (event) => {
    const fila = event.target.closest('.linea');
    if (!fila) return;
    const indice = Number(fila.dataset.indice);
    if (event.target.closest('.linea__pantalla')) mandar('pantalla', { indice });
    else mandar('decir', { indice });
  });
  el.detener.addEventListener('click', () => mandar('detener'));
  el.activo.addEventListener('click', () => mandar('activo', { on: !(estado?.guion.activo ?? true) }));
  el.reiniciar.addEventListener('click', () => mandar('reiniciar'));
  el.cargarMuestra.addEventListener('click', () => mandar('cargar-muestra'));

  el.guionGuardar.addEventListener('click', () => {
    mandar('cargar', { texto: el.guionTexto.value });
  });
  el.guionArchivo.addEventListener('change', async () => {
    const archivo = el.guionArchivo.files?.[0];
    el.guionArchivo.value = '';
    if (!archivo) return;
    el.guionTexto.value = await archivo.text();
    mandar('cargar', { texto: el.guionTexto.value });
  });

  for (const boton of document.querySelectorAll('[data-escena]')) {
    boton.addEventListener('click', () => mandar('escena', { nombre: boton.dataset.escena }));
  }
  el.mic.addEventListener('click', () => mandar('mic', { on: estado?.mic !== 'escuchando' }));
  el.voz.addEventListener('click', () => mandar('voz', { on: !estado?.voz }));
  el.escenario.addEventListener('click', () => mandar('escenario', { on: !estado?.escenario }));
  el.camara.addEventListener('click', () => mandar('camara', { on: !estado?.camara }));
  el.imagen.addEventListener('click', () => mandar('imagen', { on: !estado?.imagenVisible }));
  el.fondo.addEventListener('click', () => mandar('fondo', { on: false }));
  el.palabra.addEventListener('click', () => mandar('palabra', { on: false }));
  el.letrero.addEventListener('click', () => mandar('letrero', { on: false }));
  el.video.addEventListener('click', () => mandar('video', { on: !estado?.videoEn }));
  el.actualizarNova.addEventListener('click', () => {
    if (!confirm('NOVA se va a recargar en la computadora: el guion vuelve al principio y sale de pantalla completa. ¿Seguimos?')) return;
    mandar('recargar');
  });
  el.apagar.addEventListener('click', () => mandar('apagar', { on: !estado?.apagada }));

  el.turnoSiguiente.addEventListener('click', () => mandar('turno-siguiente'));
  el.fijar.addEventListener('click', () => mandar('fijar'));

  el.formTexto.addEventListener('submit', (event) => {
    event.preventDefault();
    const texto = el.texto.value.trim();
    if (!texto) return;
    mandar('texto', { texto });
    el.texto.value = '';
  });
  el.formOido.addEventListener('submit', (event) => {
    event.preventDefault();
    const texto = el.oidoTexto.value.trim();
    if (!texto) return;
    mandar('oido', { texto });
    el.oidoTexto.value = '';
  });
}

/* ------------------------------------------------------------- pintar */

function pintarEnlace() {
  const conSenal = estado && Date.now() - ultimaSenal < 20000;
  const porRed = enlace.servidor === 'conectado';
  const sala = enlace.sala;
  const enSala = sala.estado !== 'cerrada';
  const porSala = sala.estado === 'conectada';

  let nombre;
  let texto;
  if (conSenal) {
    nombre = 'bien';
    texto = porSala ? 'Escenario conectado por la sala' : enSala ? 'La sala se cortó: reintentando…' : porRed ? 'Escenario conectado por red' : 'Escenario conectado en esta computadora';
  } else if (estado) {
    nombre = 'perdido';
    texto = 'Sin señal del escenario hace un rato';
  } else {
    nombre = 'buscando';
    texto = enSala ? `Sala ${sala.codigo}: ${SALA_TEXTOS[sala.estado] || sala.estado}` : porRed ? 'Esperando al escenario…' : 'Buscando el escenario en esta computadora…';
  }
  el.enlace.dataset.estado = nombre;
  el.enlaceTexto.textContent = texto;

  // La sala: el campo para entrar, o con qué código se está adentro.
  el.sala.dataset.estado = sala.estado;
  el.formSala.hidden = enSala;
  el.salaDentro.hidden = !enSala;
  if (enSala) {
    const via = sala.estado === 'conectada' && sala.via ? (sala.via === 'nube' ? ' por la nube' : sala.via === 'directo' ? ' directo' : ' por relevo') : '';
    el.salaTexto.innerHTML = `Sala <strong>${sala.codigo}</strong> · ${SALA_TEXTOS[sala.estado] || sala.estado}${via}`;
  }
  // Si ya hay escenario por otro camino (misma computadora o servidor), el campo sobra.
  el.sala.hidden = !enSala && Boolean(conSenal);

  el.aviso.hidden = Boolean(conSenal);
  if (enSala) {
    el.aviso.textContent = sala.estado === 'esperando'
      ? `El escenario no abrió la sala ${sala.codigo} todavía. En la computadora, abrí NOVA, tocá Panel y creá la sala; fijate que el código sea el mismo.`
      : sala.estado === 'sin-internet'
        ? 'El celular no llega al servidor de la sala. Revisá la conexión a internet (Wi-Fi o datos).'
        : sala.estado === 'conectada'
          ? 'Entré a la sala pero el escenario no responde. Fijate que la página de NOVA siga abierta en la computadora.'
          : `Entrando a la sala ${sala.codigo}…`;
  } else {
    el.aviso.textContent = porRed
      ? 'El escenario no responde. Fijate que la página de NOVA esté abierta en la computadora que proyecta.'
      : 'No encuentro el escenario. Si está en esta computadora, abrilo en otra ventana de este navegador. Desde el celular, poné arriba el código de la sala que muestra NOVA en Panel.';
  }
  if (conSenal) mantenerDespierto();
}

/** minutos:segundos */
function reloj(segundos) {
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Qué pasa con el video, dicho en el celular: si está en pantalla y por dónde
 * va, si todavía está cargando, o por qué no se pudo pasar. Así no hace falta
 * mirar la tele para saberlo.
 */
function pintarVideoAhora() {
  if (!estado) return;
  const video = estado.videoEstado;
  const videos = estado.videos;
  let fase = '';
  let texto = '';
  if (video?.fase === 'falló') {
    fase = 'falló';
    texto = `⚠ El video no se pudo pasar: ${video.motivo || 'no se pudo cargar'}.`;
  } else if (video?.fase === 'corre') {
    fase = 'corre';
    const va = videoReloj ? Math.min(video.dura || Infinity, videoReloj.t + (Date.now() - videoReloj.en) / 1000) : video.t || 0;
    texto = `▶ Video en pantalla · ${reloj(va)}${video.dura ? ` de ${reloj(video.dura)}` : ''}${video.mudo ? ' · SIN SONIDO (tocá la pantalla de NOVA)' : ''}`;
  } else if (video) {
    fase = 'cargando';
    texto = video.lento ? '⏳ El video está bajando despacio: la conexión de la computadora está lenta.' : '⏳ El video está cargando en la computadora…';
  } else if (videos?.bajando) {
    fase = 'bajando';
    texto = `Videos: NOVA los está bajando (${videos.listos} de ${videos.total} listos). Se pueden pasar igual.`;
  } else if (videos?.fallaron) {
    fase = 'bajando';
    texto = `Videos: ${videos.fallaron} no se pudo bajar por adelantado. Se va a pedir en el momento de pasarlo.`;
  } else if (videos?.total || videos?.faltan) {
    texto = `Videos listos en la computadora: ${videos.listos || 0} de ${videos.total || 0}.`;
    if (videos.faltan) texto += ` El guion nombra ${videos.faltan} más que todavía no ${videos.faltan === 1 ? 'está' : 'están'} en la carpeta.`;
  }
  el.videoAhora.hidden = !texto;
  el.videoAhora.dataset.fase = fase;
  if (el.videoAhora.textContent !== texto) el.videoAhora.textContent = texto;
}

/** El panel se pone al día solo: no tiene nada que perder al recargarse. */
async function mirarVersion() {
  const publicada = await versionPublicada();
  if (!publicada) return;
  versionDelSitio = publicada.version;
  const escribiendo = ['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName);
  if (publicada.version !== VERSION && !yaSeIntento(publicada.version) && !escribiendo) return actualizarSitio(publicada);
  pintar();
}

function pintar() {
  if (!estado) return;
  const { guion } = estado;

  // Ahora.
  el.ahora.dataset.modo = estado.modo;
  el.modo.textContent = MODOS[estado.modo] || estado.modo;
  el.escena.textContent = `${ESCENAS[estado.escena] || estado.escena}${estado.escenario ? ' · proyectando' : ''}`;
  // Lo que oyó solo importa si el micrófono está prendido: la puesta en escena va sin él.
  el.oido.textContent = estado.oido ? `Oyó: «${estado.oido}»` : estado.mic === 'escuchando' ? 'Todavía no oyó nada.' : '';
  el.dicho.textContent = estado.ultimaRespuesta ? `Dijo: «${recortar(estado.ultimaRespuesta, 140)}»` : '';

  el.tocar.hidden = estado.tocada !== false; // solo si el escenario dice que nadie lo tocó todavía
  pintarVideoAhora();
  // NOVA con una versión que no es la publicada: se avisa, y se puede corregir desde acá.
  el.versionVieja.hidden = !versionDelSitio || estado.version === versionDelSitio || Date.now() - ultimaSenal > 20000;
  el.otroGuion.hidden = estado.guionDeLaMuestra !== false; // solo si el escenario dice que tiene otro guion

  // El siguiente parlamento, en el botón grande.
  const siguiente = guion.entradas[guion.cursor + 1] || null;
  el.siguiente.disabled = guion.cursor + 1 >= guion.total;
  el.atras.disabled = guion.cursor < 0;
  el.siguienteDetalle.textContent = !guion.total
    ? 'No hay guion cargado'
    : guion.esperando && !guion.entradas.length
      ? `${Math.min(guion.cursor + 2, guion.total)}/${guion.total} · bajando el guion…`
    : siguiente
      ? `${siguiente.indice + 1}/${guion.total} · ${siguiente.muda ? `Pantalla: ${recortar(siguiente.pantallaTexto || 'cambia', 80)}${siguiente.sola ? ' (va sola)' : ''}` : recortar(siguiente.parlamento, 90)}`
      : 'Fin del guion';

  // Guion.
  const conAsistente = estado.asistente && estado.asistente !== 'ninguno';
  el.progreso.textContent = `${guion.total ? `${Math.max(0, guion.cursor + 1)}/${guion.total}` : ''}${conAsistente ? (estado.asistenteConversa ? ' · con IA que conversa' : ' · con asistente') : ''}`;
  el.activo.setAttribute('aria-pressed', String(guion.activo));
  // La lista se dibuja una vez por versión del guion; después solo se mueve la marca.
  // Rehacerla con cada mensaje hacía perder toques y saltar el desplazamiento.
  const clave = `${guion.version}:${guion.entradas.length}`;
  if (listaPintada !== clave) {
    listaPintada = clave;
    cursorPintado = null;
    el.lineas.innerHTML = '';
    if (!guion.total) {
      el.lineas.innerHTML = '<li class="lineas__vacio">No hay guion cargado. Cargalo en el escenario o desde acá abajo.</li>';
    } else if (!guion.entradas.length) {
      el.lineas.innerHTML = '<li class="lineas__vacio">Bajando el guion…</li>';
    }
    let escenaVista = null;
    const partes = document.createDocumentFragment();
    for (const entrada of guion.entradas) {
      if (entrada.escena !== escenaVista && entrada.escena) {
        const titulo = document.createElement('li');
        titulo.className = 'lineas__escena';
        titulo.textContent = entrada.escena;
        partes.appendChild(titulo);
      }
      escenaVista = entrada.escena;
      const fila = document.createElement('li');
      fila.className = 'linea';
      fila.dataset.indice = String(entrada.indice);
      const marcas = [
        entrada.imagen ? `<span class="linea__marca">${entrada.imagen === 'ninguna' ? 'sin imagen' : `imagen${entrada.segundos ? ` ${entrada.segundos}s` : ''}`}</span>` : '',
        entrada.fondo ? `<span class="linea__marca">fondo: ${escapar(entrada.fondo)}</span>` : '',
        entrada.palabra ? `<span class="linea__marca">palabra: ${escapar(entrada.palabra)}</span>` : '',
        entrada.letrero ? `<span class="linea__marca">letrero: ${escapar(entrada.letrero)}</span>` : '',
        entrada.video ? `<span class="linea__marca linea__marca--video">▶ video: ${escapar(entrada.video)}</span>` : '',
        entrada.camara ? `<span class="linea__marca">cámara: ${entrada.camara}</span>` : '',
        entrada.grabada === false ? '<span class="linea__marca linea__marca--ojo">sin grabación</span>' : '',
      ].join('');
      fila.innerHTML = `
        <span class="linea__numero">${entrada.indice + 1}</span>
        <span class="linea__pie">${entrada.pie ? escapar(entrada.pie) : '<em>sin pie</em>'}${marcas}</span>
        <span class="linea__parlamento">${entrada.muda ? `<em>Solo pantalla${entrada.sola ? ', va sola al terminar la anterior' : ''}: ${escapar(entrada.pantallaTexto || '')}.</em>` : escapar(entrada.parlamento)}</span>${entrada.pantalla && !entrada.muda ? '<button type="button" class="linea__pantalla" title="Aplicar la imagen, el fondo, la palabra o la cámara de esta línea sin que NOVA hable">Solo pantalla</button>' : ''}`;
      partes.appendChild(fila);
    }
    el.lineas.appendChild(partes);
  }
  if (cursorPintado !== guion.cursor) {
    cursorPintado = guion.cursor;
    for (const fila of el.lineas.querySelectorAll('.linea')) {
      const indice = Number(fila.dataset.indice);
      fila.classList.toggle('is-dicho', indice <= guion.cursor);
      fila.classList.toggle('is-siguiente', indice === guion.cursor + 1);
    }
    el.lineas.querySelector('.is-siguiente')?.scrollIntoView({ block: 'nearest' });
  }

  // Lo que el guion tiene para poner en pantalla: un botón por cosa, dibujados una vez.
  const TIPOS = { fondo: 'Fondo', imagen: 'Imagen', video: 'Video', letrero: 'Letrero', palabra: 'Palabra' };
  const claveMedios = `${guion.version}:${(guion.medios || []).length}`; // el guion puede llegar después que el estado
  if (mediosPintados !== claveMedios) {
    mediosPintados = claveMedios;
    el.medios.innerHTML = '';
    for (const medio of guion.medios || []) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'medio';
      boton.dataset.tipo = medio.tipo;
      boton.dataset.valor = medio.valor;
      boton.innerHTML = `<span class="medio__tipo">${TIPOS[medio.tipo] || medio.tipo}</span><span class="medio__rotulo">${escapar(recortar(medio.rotulo, 60))}</span>`;
      el.medios.appendChild(boton);
    }
  }
  const puesto = {
    fondo: estado.fondo?.src,
    imagen: estado.imagenVisible ? estado.imagen?.src : '',
    video: estado.videoEn ? estado.video?.src : '',
    letrero: estado.letrero,
    palabra: estado.palabra,
  };
  for (const boton of el.medios.querySelectorAll('.medio')) {
    boton.setAttribute('aria-pressed', String(Boolean(puesto[boton.dataset.tipo]) && puesto[boton.dataset.tipo] === boton.dataset.valor));
  }

  // Pantalla.
  for (const boton of document.querySelectorAll('[data-escena]')) {
    boton.setAttribute('aria-pressed', String(boton.dataset.escena === estado.escena));
  }
  el.mic.setAttribute('aria-pressed', String(estado.mic === 'escuchando' || estado.micQuerido));
  el.mic.disabled = estado.mic === 'no disponible';
  el.mic.textContent = estado.mic === 'escuchando'
    ? 'Micrófono: escuchando'
    : estado.micQuerido ? 'Micrófono: caído, reintentando' : 'Micrófono: apagado';
  el.micNota.textContent = estado.mic === 'no disponible'
    ? 'El navegador del escenario no reconoce voz. Manejá el guion desde acá: con "Decir el siguiente" o tocando una línea.'
    : estado.micDiag ? `Micrófono: ${estado.micDiag}.` : '';
  el.voz.setAttribute('aria-pressed', String(estado.voz));
  el.voz.textContent = estado.voz ? 'Voz de NOVA: encendida' : 'Voz de NOVA: apagada';
  el.escenario.setAttribute('aria-pressed', String(estado.escenario));
  el.escenario.textContent = estado.escenario ? 'Escenario: proyectando' : 'Escenario: consola';
  el.camara.setAttribute('aria-pressed', String(estado.camara));
  el.camara.textContent = estado.camara ? 'Cámara: en pantalla' : 'Cámara del público';
  el.imagen.disabled = !estado.imagen;
  el.imagen.setAttribute('aria-pressed', String(Boolean(estado.imagen && estado.imagenVisible)));
  el.imagen.textContent = !estado.imagen ? 'Imagen: no hay' : estado.imagenVisible ? 'Imagen: sacar ya' : 'Imagen: mostrar de nuevo';
  el.imagenNota.textContent = estado.imagen ? `Imagen de este momento: ${estado.imagen.pie || estado.imagen.src}` : '';
  el.fondo.disabled = !estado.fondo;
  el.fondo.textContent = estado.fondo ? `Quitar fondo: ${recortar(estado.fondo.pie || estado.fondo.src, 24)}` : 'Fondo: no hay';
  el.palabra.disabled = !estado.palabra;
  el.palabra.textContent = estado.palabra ? `Quitar palabra: ${estado.palabra}` : 'Palabra: no hay';
  el.video.disabled = !estado.video;
  el.video.setAttribute('aria-pressed', String(Boolean(estado.videoEn)));
  el.video.textContent = !estado.video ? 'Video: no hay' : estado.videoEn ? 'Video: parar' : `Video: pasar de nuevo (${recortar(estado.video.pie || estado.video.src, 18)})`;
  el.letrero.disabled = !estado.letrero;
  el.letrero.textContent = estado.letrero ? `Quitar letrero: ${recortar(estado.letrero, 20)}` : 'Letrero: no hay';
  el.apagar.setAttribute('aria-pressed', String(Boolean(estado.apagada)));
  el.apagar.textContent = estado.apagada ? 'Encender NOVA' : 'Apagar NOVA';

  // Turnos.
  const plantel = JSON.stringify(estado.plantel);
  if (plantel !== plantelPintado) {
    plantelPintado = plantel;
    el.turnos.innerHTML = '';
    if (!estado.plantel.length) {
      el.turnos.innerHTML = '<p class="nota">Sin plantel. Se carga en el escenario, en Función.</p>';
    }
    for (const persona of estado.plantel) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'turno';
      boton.dataset.id = persona.id;
      boton.style.setProperty('--acento', persona.color);
      boton.textContent = persona.name;
      boton.addEventListener('click', () => mandar('turno', { id: persona.id }));
      el.turnos.appendChild(boton);
    }
  }
  for (const boton of el.turnos.querySelectorAll('.turno')) boton.setAttribute('aria-pressed', String(String(estado.turno?.id) === boton.dataset.id));
  el.fijar.disabled = !estado.ultimaRespuesta;
  el.acuerdos.textContent = estado.acuerdos ? `${estado.acuerdos} en el muro` : '';

  // Eventos: se guardan los distintos, por hora.
  if (estado.evento && !eventos.some((e) => e.t === estado.evento.t)) {
    eventos.unshift(estado.evento);
    eventos.length = Math.min(eventos.length, 10);
    el.eventos.innerHTML = eventos
      .map((e) => `<li><time>${hora(e.t)}</time>${escapar(e.texto)}</li>`)
      .join('');
  }

  pintarEnlace();
}

function hora(t) {
  return new Date(t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function recortar(texto, largo) {
  const limpio = String(texto).replace(/\s+/g, ' ').trim();
  return limpio.length > largo ? `${limpio.slice(0, largo).trimEnd()}…` : limpio;
}

function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
