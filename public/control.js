/**
 * Panel de control: ve por dónde va NOVA y la maneja a distancia.
 *
 * No tiene lógica propia: todo lo que muestra se lo cuenta el escenario por
 * el enlace, y todo lo que hace es mandarle órdenes. Si se pierde la
 * conexión, lo dice; si el escenario se recarga, se vuelve a enganchar solo.
 */

import { Enlace } from './js/enlace.js';

const $ = (id) => document.getElementById(id);

const el = {
  enlace: $('enlace'),
  enlaceTexto: $('enlaceTexto'),
  ahora: $('ahora'),
  modo: $('modo'),
  escena: $('escena'),
  oido: $('oido'),
  dicho: $('dicho'),
  siguiente: $('siguiente'),
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
const eventos = []; // los últimos, por orden de llegada

const enlace = new Enlace('panel', (mensaje) => {
  if (mensaje.tipo !== 'estado') return;
  estado = mensaje.estado;
  ultimaSenal = Date.now();
  pintar();
});
enlace.onCambio = () => pintarEnlace();

/* ----------------------------------------------------------- arranque */

wire();
pintarEnlace();
pedir();
// Mientras no haya señal, se insiste; y si se corta, se nota en seguida.
setInterval(() => {
  if (!estado || Date.now() - ultimaSenal > 20000) pedir();
  pintarEnlace();
}, 5000);

function pedir() {
  enlace.enviar({ tipo: 'comando', accion: 'hola' });
}

function mandar(accion, extra = {}) {
  enlace.enviar({ tipo: 'comando', accion, ...extra });
}

/* ------------------------------------------------------------ eventos */

function wire() {
  el.siguiente.addEventListener('click', () => mandar('siguiente'));
  el.detener.addEventListener('click', () => mandar('detener'));
  el.activo.addEventListener('click', () => mandar('activo', { on: !(estado?.guion.activo ?? true) }));
  el.reiniciar.addEventListener('click', () => mandar('reiniciar'));

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

  let nombre;
  let texto;
  if (conSenal) {
    nombre = 'bien';
    texto = porRed ? 'Escenario conectado por red' : 'Escenario conectado en esta computadora';
  } else if (estado) {
    nombre = 'perdido';
    texto = 'Sin señal del escenario hace un rato';
  } else {
    nombre = 'buscando';
    texto = porRed ? 'Esperando al escenario…' : 'Buscando el escenario en esta computadora…';
  }
  el.enlace.dataset.estado = nombre;
  el.enlaceTexto.textContent = texto;

  el.aviso.hidden = Boolean(conSenal);
  el.aviso.textContent = porRed
    ? 'El escenario no responde. Fijate que la página de NOVA esté abierta en la computadora que proyecta.'
    : 'No encuentro el escenario. Abrí la página de NOVA en otra ventana de este mismo navegador. Para manejarla desde el celular hace falta correr el servidor (npm start).';
}

function pintar() {
  if (!estado) return;
  const { guion } = estado;

  // Ahora.
  el.ahora.dataset.modo = estado.modo;
  el.modo.textContent = MODOS[estado.modo] || estado.modo;
  el.escena.textContent = `${ESCENAS[estado.escena] || estado.escena}${estado.escenario ? ' · proyectando' : ''}`;
  el.oido.textContent = estado.oido ? `Oyó: «${estado.oido}»` : 'Todavía no oyó nada.';
  el.dicho.textContent = estado.ultimaRespuesta ? `Dijo: «${recortar(estado.ultimaRespuesta, 140)}»` : '';

  // El siguiente parlamento, en el botón grande.
  const siguiente = guion.entradas[guion.cursor + 1] || null;
  el.siguiente.disabled = !siguiente;
  el.siguienteDetalle.textContent = !guion.total
    ? 'No hay guion cargado'
    : siguiente
      ? `${siguiente.indice + 1}/${guion.total} · ${recortar(siguiente.parlamento, 90)}`
      : 'Fin del guion';

  // Guion.
  const conAsistente = estado.asistente && estado.asistente !== 'ninguno';
  el.progreso.textContent = `${guion.total ? `${Math.max(0, guion.cursor + 1)}/${guion.total}` : ''}${conAsistente ? (estado.asistenteConversa ? ' · con IA que conversa' : ' · con asistente') : ''}`;
  el.activo.setAttribute('aria-pressed', String(guion.activo));
  el.lineas.innerHTML = '';
  if (!guion.total) {
    el.lineas.innerHTML = '<li class="lineas__vacio">No hay guion cargado. Cargalo en el escenario o desde acá abajo.</li>';
  }
  for (const entrada of guion.entradas) {
    const fila = document.createElement('li');
    fila.className = 'linea';
    fila.classList.toggle('is-dicho', entrada.indice <= guion.cursor);
    fila.classList.toggle('is-siguiente', entrada.indice === guion.cursor + 1);
    const marcas = [
      entrada.imagen ? `<span class="linea__marca">imagen${entrada.segundos ? ` ${entrada.segundos}s` : ''}</span>` : '',
      entrada.fondo ? `<span class="linea__marca">fondo: ${escapar(entrada.fondo)}</span>` : '',
      entrada.palabra ? `<span class="linea__marca">palabra: ${escapar(entrada.palabra)}</span>` : '',
      entrada.camara ? `<span class="linea__marca">cámara: ${entrada.camara}</span>` : '',
    ].join('');
    fila.innerHTML = `
      <span class="linea__numero">${entrada.indice + 1}</span>
      <span class="linea__pie">${entrada.pie ? escapar(entrada.pie) : '<em>sin pie</em>'}${marcas}</span>
      <span class="linea__parlamento">${escapar(entrada.parlamento)}</span>`;
    fila.addEventListener('click', () => mandar('decir', { indice: entrada.indice }));
    if (entrada.pantalla) {
      // Solo lo de pantalla, sin que NOVA hable: para cuando los estudiantes van solos.
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'linea__pantalla';
      boton.textContent = 'Solo pantalla';
      boton.title = 'Aplicar la imagen, el fondo, la palabra o la cámara de esta línea sin que NOVA hable';
      boton.addEventListener('click', (event) => {
        event.stopPropagation();
        mandar('pantalla', { indice: entrada.indice });
      });
      fila.appendChild(boton);
    }
    el.lineas.appendChild(fila);
  }
  const siguienteFila = el.lineas.querySelector('.is-siguiente');
  siguienteFila?.scrollIntoView({ block: 'nearest' });

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

  // Turnos.
  el.turnos.innerHTML = '';
  if (!estado.plantel.length) {
    el.turnos.innerHTML = '<p class="nota">Sin plantel. Se carga en el escenario, en Función.</p>';
  }
  for (const persona of estado.plantel) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'turno';
    boton.style.setProperty('--acento', persona.color);
    boton.setAttribute('aria-pressed', String(estado.turno?.id === persona.id));
    boton.textContent = persona.name;
    boton.addEventListener('click', () => mandar('turno', { id: persona.id }));
    el.turnos.appendChild(boton);
  }
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
