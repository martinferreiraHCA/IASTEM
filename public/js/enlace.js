/**
 * El enlace entre el escenario y el panel de control.
 *
 * Las dos páginas se hablan con mensajes chicos: el escenario cuenta su
 * estado (por dónde va el guion, si escucha, qué oyó) y el panel manda
 * órdenes (decir tal parlamento, mostrar el muro, prender el micrófono).
 *
 * Hay dos caminos, y se usan los dos a la vez:
 *
 *   BroadcastChannel  Entre ventanas del mismo navegador, en la misma
 *                     computadora. No necesita nada: anda hasta en GitHub
 *                     Pages. Sirve para tener el escenario en el proyector
 *                     y el panel en la pantalla de la notebook.
 *   Servidor          Con `npm start`, el servidor releva los mensajes
 *                     entre todas las páginas conectadas. Así el panel se
 *                     abre desde el celular, en la misma red.
 *   Sala              Por internet, sin servidor propio: el escenario abre
 *                     una sala con un código y el celular entra con ese
 *                     código. Anda desde GitHub Pages, con el celular en
 *                     cualquier red. Por dentro son dos caminos a la vez:
 *                     directo (WebRTC, con PeerJS para encontrarse) y por
 *                     relevo (un servidor público de MQTT, ver relevo.js),
 *                     para las redes que no dejan hablar directo.
 */

import { Relevo } from './relevo.js';

const CANAL = 'nova:enlace';
const LATIDO_MS = 10000; // cada cuánto el panel avisa que sigue ahí
const AUSENTE_MS = 26000; // sin latidos durante esto, el celular ya no está

const PEERJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js';
const PREFIJO_SALA = 'nova-'; // así se llama la sala en el servidor de PeerJS
const LETRAS_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L: se dictan sin confundir

/** Un código de sala nuevo, corto y fácil de dictar. */
export function codigoNuevo(largo = 6) {
  const azar = new Uint32Array(largo);
  crypto.getRandomValues(azar);
  return Array.from(azar, (n) => LETRAS_CODIGO[n % LETRAS_CODIGO.length]).join('');
}

/** Lo que escribió la persona, como código: mayúsculas, sin espacios ni guiones. */
export function normalizarCodigo(texto) {
  return String(texto || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

let cargaPeer = null;
function cargarPeer() {
  if (window.Peer) return Promise.resolve(window.Peer);
  cargaPeer ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PEERJS_URL;
    script.onload = () => resolve(window.Peer);
    script.onerror = () => {
      cargaPeer = null;
      script.remove();
      reject(new Error('No se pudo cargar PeerJS: ¿hay internet?'));
    };
    document.head.appendChild(script);
  });
  return cargaPeer;
}

export class Enlace {
  /**
   * @param {'escenario'|'panel'} rol
   * @param {(mensaje: object) => void} onMensaje
   */
  constructor(rol, onMensaje) {
    this.rol = rol;
    this.onMensaje = onMensaje;
    this.servidor = 'buscando'; // buscando, conectado o ausente
    this.onCambio = null;
    this.fuente = null;
    this.reintento = null;
    this.vistos = new Map(); // ids de mensajes ya recibidos: por los dos caminos llega el mismo

    // La sala por internet. Estados del escenario: cerrada, abriendo,
    // abierta, ocupada (el código lo usa otro escenario), sin-internet.
    // Del panel: cerrada, entrando, esperando (el escenario no está),
    // conectada, perdida, sin-internet.
    // `via` dice por dónde llegan los mensajes: directo, relevo o nada.
    this.sala = { codigo: '', estado: 'cerrada', conectados: 0, detalle: '', via: '' };
    this.quien = `${rol}-${Math.random().toString(36).slice(2, 10)}`; // esta página, para contar celulares
    this.peer = null;
    this.conexiones = new Set();
    this.relevo = null;
    this.senalCaida = false; // el servidor de PeerJS no responde
    this.salaReintento = null;
    this.salaIntentos = 0;
    this.latidoTimer = null;
    this.ausenciaTimer = null;
    this.presentes = new Map(); // quien → último latido, para contar celulares en la sala

    this.canal = 'BroadcastChannel' in window ? new BroadcastChannel(CANAL) : null;
    this.canal?.addEventListener('message', (event) => this.#recibir(event.data));

    if (location.protocol !== 'file:') this.#conectarServidor();
    else this.#setServidor('ausente');
  }

  /** Manda un mensaje a todas las otras páginas, por los dos caminos. */
  enviar(mensaje) {
    const sobre = { ...mensaje, de: this.rol, quien: this.quien, t: Date.now(), id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}` };
    if (mensaje.tipo !== 'latido') this.canal?.postMessage(sobre);
    for (const conexion of this.conexiones) {
      if (conexion.open) {
        try { conexion.send(sobre); } catch { /* se cae sola y se reconecta */ }
      }
    }
    this.relevo?.enviar(sobre);
    if (this.servidor === 'conectado') {
      fetch('api/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sobre),
      }).catch(() => { /* el reintento de la conexión se ocupa */ });
    }
  }

  #recibir(mensaje) {
    if (!mensaje || mensaje.de === this.rol) return; // lo propio no interesa

    // En la misma computadora con servidor, el mismo mensaje llega por el
    // canal local y por el servidor: la segunda vez se ignora.
    if (mensaje.id) {
      const ahora = Date.now();
      if (this.vistos.has(mensaje.id)) return;
      this.vistos.set(mensaje.id, ahora);
      if (this.vistos.size > 200) {
        for (const [id, t] of this.vistos) if (ahora - t > 30000) this.vistos.delete(id);
      }
    }
    // Un celular en la sala late cada tanto: así el escenario sabe cuántos hay.
    if (this.rol === 'escenario' && mensaje.quien && mensaje.de === 'panel' && this.sala.estado !== 'cerrada') {
      this.presentes.set(mensaje.quien, Date.now());
      this.#revisarSala();
    }
    if (mensaje.tipo === 'latido') return;
    this.onMensaje?.(mensaje);
  }

  #setServidor(estado) {
    if (this.servidor === estado) return;
    this.servidor = estado;
    this.onCambio?.(estado);
  }

  async #conectarServidor() {
    if (!('EventSource' in window)) return this.#setServidor('ausente');

    // Primero se pregunta si hay servidor. En un sitio estático (GitHub
    // Pages) no lo hay ni lo va a haber: se deja de preguntar. Si el
    // servidor está caído, se vuelve a probar cada tanto.
    let info = null;
    try {
      const res = await fetch('api/health', { cache: 'no-store' });
      if (res.status === 404) return this.#setServidor('ausente');
      if (res.ok) info = await res.json();
    } catch { /* sin conexión: se reintenta abajo */ }

    if (!info?.control) {
      this.#setServidor('ausente');
      this.#reintentar();
      return;
    }

    const fuente = new EventSource('api/eventos');
    this.fuente = fuente;
    fuente.onopen = () => this.#setServidor('conectado');
    fuente.onmessage = (event) => {
      try {
        this.#recibir(JSON.parse(event.data));
      } catch { /* un mensaje roto no importa */ }
    };
    fuente.onerror = () => {
      fuente.close();
      this.#setServidor('ausente');
      this.#reintentar();
    };
  }

  #reintentar() {
    clearTimeout(this.reintento);
    this.reintento = setTimeout(() => this.#conectarServidor(), 5000);
  }

  /* ------------------------------------------------------------ la sala */

  /** El escenario abre la sala con ese código; el celular entra con él. */
  abrirSala(codigo) { return this.#sala(normalizarCodigo(codigo), 'escenario'); }

  /** El panel entra a la sala que abrió el escenario. */
  entrarSala(codigo) { return this.#sala(normalizarCodigo(codigo), 'panel'); }

  /** Cierra la sala y deja de intentar. */
  cerrarSala() {
    clearTimeout(this.salaReintento);
    clearInterval(this.latidoTimer);
    clearInterval(this.ausenciaTimer);
    this.salaIntentos = 0;
    this.senalCaida = false;
    this.presentes.clear();
    for (const conexion of this.conexiones) {
      try { conexion.close(); } catch { /* ya cerrada */ }
    }
    this.conexiones.clear();
    if (this.peer) {
      const peer = this.peer;
      this.peer = null;
      try { peer.destroy(); } catch { /* ya destruido */ }
    }
    if (this.relevo) {
      const relevo = this.relevo;
      this.relevo = null;
      relevo.cerrar();
    }
    this.#setSala({ codigo: '', estado: 'cerrada', conectados: 0, detalle: '', via: '' });
  }

  async #sala(codigo, rol) {
    if (!codigo) return;
    if ((this.peer || this.relevo) && this.sala.codigo === codigo && !['sin-internet', 'ocupada', 'perdida'].includes(this.sala.estado)) return;
    this.cerrarSala();
    this.#setSala({ codigo, estado: rol === 'escenario' ? 'abriendo' : 'entrando', conectados: 0, detalle: '', via: '' });

    // El relevo arranca ya: no necesita cargar nada y pasa por casi cualquier red.
    this.relevo = new Relevo(`nova/sala/${codigo}`, {
      onMensaje: (mensaje) => this.#recibir(mensaje),
      onCambio: () => this.#revisarSala(),
    });
    this.relevo.conectar();
    if (rol === 'panel') {
      this.latidoTimer = setInterval(() => this.enviar({ tipo: 'latido' }), LATIDO_MS);
    } else {
      this.ausenciaTimer = setInterval(() => this.#revisarSala(), 5000);
    }

    // Y el camino directo, que es más rápido cuando la red lo deja.
    let Peer;
    try {
      Peer = await cargarPeer();
    } catch (error) {
      this.senalCaida = true;
      this.#revisarSala(error.message);
      this.#reintentarSala(() => this.#directo(codigo, rol));
      return;
    }
    if (this.sala.codigo !== codigo || this.sala.estado === 'cerrada') return; // la cerraron mientras cargaba
    this.#directo(codigo, rol, Peer);
  }

  async #directo(codigo, rol, Peer = window.Peer) {
    if (!Peer) return this.#sala(codigo, rol);
    if (this.sala.codigo !== codigo || this.sala.estado === 'cerrada') return;
    if (this.peer) { const viejo = this.peer; this.peer = null; try { viejo.destroy(); } catch { /* nada */ } }

    const id = PREFIJO_SALA + codigo.toLowerCase();
    const peer = rol === 'escenario' ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    this.peer = peer;

    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.salaIntentos = 0;
      this.senalCaida = false;
      if (rol === 'escenario') this.#revisarSala();
      else this.#enlazarConEscenario(peer, id);
    });
    peer.on('connection', (conexion) => {
      if (this.peer !== peer || rol !== 'escenario') return conexion.close?.();
      this.#sumarConexion(conexion);
    });
    peer.on('disconnected', () => {
      // Se perdió el servidor de señal; las conexiones ya hechas siguen.
      if (this.peer !== peer || peer.destroyed) return;
      this.salaReintento = setTimeout(() => { if (this.peer === peer && !peer.destroyed) peer.reconnect(); }, 2000);
    });
    peer.on('error', (error) => {
      if (this.peer !== peer) return;
      const tipo = error?.type || '';
      if (tipo === 'unavailable-id') {
        this.#setSala({ estado: 'ocupada', detalle: 'Ese código ya lo usa otro escenario.' });
        this.#reintentarSala(() => this.#directo(codigo, rol));
      } else if (tipo === 'peer-unavailable') {
        if (this.sala.via === '') this.#setSala({ estado: 'esperando', detalle: 'El escenario todavía no abrió esta sala.' });
        this.#reintentarSala(() => this.#enlazarConEscenario(peer, id), 4000);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible', 'ssl-unavailable'].includes(tipo)) {
        this.senalCaida = true;
        this.#revisarSala('Sin conexión con el servidor de la sala.');
        this.#reintentarSala(() => this.#directo(codigo, rol));
      }
      // Lo demás (un mensaje roto, una conexión que se cae) lo arreglan las reconexiones.
    });
  }

  /** El panel pide la conexión directa con el escenario, y la vuelve a pedir si se corta. */
  #enlazarConEscenario(peer, id) {
    if (this.peer !== peer || peer.destroyed) return;
    for (const vieja of this.conexiones) { try { vieja.close(); } catch { /* nada */ } }
    this.conexiones.clear();
    const conexion = peer.connect(id, { reliable: true, serialization: 'json' });
    this.#sumarConexion(conexion);
    // Si en un rato no abre, la red no deja hablar directo: se corta y queda el relevo.
    setTimeout(() => { if (this.conexiones.has(conexion) && !conexion.open) { try { conexion.close(); } catch { /* nada */ } } }, 15000);
  }

  #sumarConexion(conexion) {
    this.conexiones.add(conexion);
    conexion.on('open', () => { this.salaIntentos = 0; this.#revisarSala(); });
    conexion.on('data', (dato) => this.#recibir(dato));
    const caida = () => {
      this.conexiones.delete(conexion);
      this.#revisarSala();
      if (this.rol === 'panel' && this.peer && !this.peer.destroyed && this.sala.estado !== 'cerrada') {
        this.#reintentarSala(() => this.#enlazarConEscenario(this.peer, PREFIJO_SALA + this.sala.codigo.toLowerCase()), 5000);
      }
    };
    conexion.on('close', caida);
    conexion.on('error', caida);
  }

  /** Mira los dos caminos y deja el estado de la sala como corresponde. */
  #revisarSala(detalleCaida = '') {
    if (this.sala.estado === 'cerrada') return;
    const directo = [...this.conexiones].some((c) => c.open);
    const relevo = this.relevo?.estado === 'conectado';
    const via = directo ? 'directo' : relevo ? 'relevo' : '';

    if (this.rol === 'escenario') {
      const ahora = Date.now();
      for (const [quien, t] of this.presentes) if (ahora - t > AUSENTE_MS) this.presentes.delete(quien);
      const abierta = relevo || (this.peer && this.peer.open);
      let estado = abierta ? 'abierta' : this.sala.estado === 'ocupada' ? 'ocupada' : 'abriendo';
      if (!abierta && this.senalCaida && this.relevo?.estado === 'caido') estado = 'sin-internet';
      this.#setSala({ estado, conectados: this.presentes.size, via, detalle: estado === 'sin-internet' ? (detalleCaida || 'Sin conexión.') : '' });
      return;
    }

    let estado;
    if (via) estado = 'conectada';
    else if (this.sala.estado === 'conectada') estado = 'perdida';
    else if (this.senalCaida && this.relevo?.estado === 'caido') estado = 'sin-internet';
    else estado = this.sala.estado === 'sin-internet' ? 'entrando' : this.sala.estado;
    this.#setSala({ estado, via, conectados: via ? 1 : 0, detalle: estado === 'sin-internet' ? (detalleCaida || 'Sin conexión.') : estado === 'perdida' ? 'Se cortó la conexión con el escenario.' : '' });
  }

  #reintentarSala(accion, base = 5000) {
    clearTimeout(this.salaReintento);
    this.salaIntentos += 1;
    const espera = Math.min(base * this.salaIntentos, 30000);
    this.salaReintento = setTimeout(accion, espera);
  }

  #setSala(cambios) {
    const nueva = { ...this.sala, ...cambios };
    if (JSON.stringify(nueva) === JSON.stringify(this.sala)) return;
    this.sala = nueva;
    this.onCambio?.(this.servidor);
  }
}
