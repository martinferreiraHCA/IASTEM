/**
 * El relevo: un camino de respaldo para la sala, por internet común.
 *
 * Cuando el celular y la computadora no se pueden hablar directo (redes
 * cerradas, Wi-Fi de instituto, datos con NAT estricto), los mensajes van
 * por un servidor público de MQTT sobre WebSocket, que acepta cualquier
 * red que deje abrir una página segura. Es un cliente MQTT 3.1.1 mínimo:
 * conectar, suscribirse a un tema, publicar sin confirmación y latir.
 *
 * El tema es `nova/sala/<código>`: todos los de la sala publican y
 * escuchan ahí. Los mensajes propios se descartan por `de`, y los que
 * ya llegaron por otro camino, por `id` (eso lo hace el enlace).
 */

/**
 * Servidores públicos; si uno no anda, se prueba el siguiente. El primero
 * va por el puerto 443, que pasa por cualquier red; los otros usan puertos
 * raros que algunas redes cierran. Con `localStorage['nova:relevo']` se
 * puede poner uno propio (una dirección wss://, o varias separadas por
 * espacios) y se usa primero.
 */
export const RELEVOS = [
  'wss://mqtt.eclipseprojects.io/mqtt',
  'wss://public:public@public.cloud.shiftr.io',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];

/** Separa usuario y clave de la dirección, si los trae (wss://usuario:clave@servidor). */
export function leerDireccion(direccion) {
  const m = /^(wss?:\/\/)(?:([^:@/]*)(?::([^@/]*))?@)?(.*)$/.exec(direccion);
  if (!m) return { url: direccion, usuario: '', clave: '' };
  return { url: m[1] + m[4], usuario: decodeURIComponent(m[2] || ''), clave: decodeURIComponent(m[3] || '') };
}

function servidores() {
  let propios = [];
  try { propios = (localStorage.getItem('nova:relevo') || '').split(/\s+/).filter(Boolean); } catch { /* sin localStorage */ }
  return [...propios, ...RELEVOS];
}

const LATIDO_MS = 25000; // keepalive 60 s: se late antes de la mitad
const codificador = new TextEncoder();
const decodificador = new TextDecoder();

export class Relevo {
  /**
   * @param {string} tema
   * @param {{ onMensaje: (m: object) => void, onCambio?: (estado: string) => void }} opciones
   */
  constructor(tema, { onMensaje, onCambio, servidores: lista = null }) {
    this.tema = tema;
    this.lista = lista; // una lista propia de servidores (para probar uno solo)
    this.onMensaje = onMensaje;
    this.onCambio = onCambio;
    this.estado = 'cerrado'; // cerrado, conectando, conectado, caido
    this.servidor = ''; // a cuál se está conectando
    this.socket = null;
    this.cual = 0; // qué servidor de la lista
    this.intentos = 0;
    this.reintento = null;
    this.latido = null;
    this.paqueteId = 1;
    this.pendiente = new Uint8Array(0); // bytes que llegaron a medias
  }

  conectar() {
    if (this.socket) return;
    clearTimeout(this.reintento);
    this.#setEstado('conectando');
    let socket;
    const lista = this.lista || servidores();
    const direccion = leerDireccion(lista[this.cual % lista.length]);
    this.servidor = direccion.url;
    try {
      socket = new WebSocket(direccion.url, ['mqtt']);
    } catch {
      return this.#caida();
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    const abrirTimer = setTimeout(() => { if (this.socket === socket && this.estado !== 'conectado') socket.close(); }, 8000);

    socket.onopen = () => {
      socket.send(paqueteConectar(`nova-${Math.random().toString(36).slice(2, 10)}`, direccion.usuario, direccion.clave));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.#recibirBytes(new Uint8Array(event.data), socket);
    };
    socket.onerror = () => { /* onclose viene después */ };
    socket.onclose = () => {
      clearTimeout(abrirTimer);
      if (this.socket !== socket) return;
      this.socket = null;
      clearInterval(this.latido);
      if (this.estado !== 'cerrado') this.#caida();
    };
  }

  /** Publica un objeto en el tema, sin confirmación (QoS 0). */
  enviar(objeto) {
    if (this.estado !== 'conectado' || !this.socket) return false;
    try {
      this.socket.send(paquetePublicar(this.tema, JSON.stringify(objeto)));
      return true;
    } catch {
      return false;
    }
  }

  cerrar() {
    clearTimeout(this.reintento);
    clearInterval(this.latido);
    this.#setEstado('cerrado');
    const socket = this.socket;
    this.socket = null;
    try { socket?.close(); } catch { /* ya cerrado */ }
  }

  #caida() {
    // Si este servidor falló sin haber conectado, se pasa al siguiente.
    if (this.estado !== 'conectado') this.cual += 1;
    this.intentos += 1;
    this.#setEstado('caido');
    const espera = Math.min(1500 * this.intentos, 15000);
    this.reintento = setTimeout(() => { if (this.estado !== 'cerrado') this.conectar(); }, espera);
  }

  #recibirBytes(bytes, socket) {
    // Puede venir más de un paquete por trama, o uno partido.
    const todo = new Uint8Array(this.pendiente.length + bytes.length);
    todo.set(this.pendiente);
    todo.set(bytes, this.pendiente.length);
    let desde = 0;
    while (desde < todo.length) {
      const leido = leerPaquete(todo, desde);
      if (!leido) break; // incompleto: se espera el resto
      this.#paquete(leido, socket);
      desde = leido.fin;
    }
    this.pendiente = todo.slice(desde);
  }

  #paquete({ tipo, cuerpo }, socket) {
    if (tipo === 2) { // CONNACK
      if (cuerpo[1] !== 0) return socket.close();
      socket.send(paqueteSuscribir(this.tema, this.paqueteId++));
      return;
    }
    if (tipo === 9) { // SUBACK
      this.intentos = 0;
      this.#setEstado('conectado');
      clearInterval(this.latido);
      this.latido = setInterval(() => { try { socket.send(new Uint8Array([0xC0, 0x00])); } catch { /* se cae sola */ } }, LATIDO_MS);
      return;
    }
    if (tipo === 3) { // PUBLISH
      const largoTema = (cuerpo[0] << 8) | cuerpo[1];
      const carga = cuerpo.subarray(2 + largoTema);
      try {
        this.onMensaje?.(JSON.parse(decodificador.decode(carga)));
      } catch { /* un mensaje que no es nuestro */ }
    }
    // PINGRESP (13) y lo demás: nada que hacer.
  }

  #setEstado(estado) {
    if (this.estado === estado) return;
    this.estado = estado;
    this.onCambio?.(estado);
  }
}

/* ------------------------------------------------ armar y leer paquetes */

function texto(cadena) {
  const bytes = codificador.encode(cadena);
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes];
}

function largoVariable(n) {
  const bytes = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    bytes.push(byte);
  } while (n > 0);
  return bytes;
}

function paquete(primerByte, cuerpo) {
  return new Uint8Array([primerByte, ...largoVariable(cuerpo.length), ...cuerpo]);
}

function paqueteConectar(clienteId, usuario = '', clave = '') {
  let banderas = 0x02; // sesión limpia
  if (usuario) banderas |= 0x80;
  if (usuario && clave) banderas |= 0x40;
  const cuerpo = [...texto('MQTT'), 4, banderas, 0, 60, ...texto(clienteId)]; // nivel 4, keepalive 60 s
  if (usuario) cuerpo.push(...texto(usuario));
  if (usuario && clave) cuerpo.push(...texto(clave));
  return paquete(0x10, cuerpo);
}

function paqueteSuscribir(tema, id) {
  return paquete(0x82, [id >> 8, id & 0xff, ...texto(tema), 0]);
}

function paquetePublicar(tema, carga) {
  return paquete(0x30, [...texto(tema), ...codificador.encode(carga)]);
}

/** Lee un paquete MQTT desde `desde`; null si todavía no llegó entero. */
function leerPaquete(bytes, desde) {
  if (bytes.length - desde < 2) return null;
  const tipo = bytes[desde] >> 4;
  let largo = 0;
  let mult = 1;
  let i = desde + 1;
  for (;;) {
    if (i >= bytes.length) return null;
    const byte = bytes[i++];
    largo += (byte & 0x7f) * mult;
    if ((byte & 0x80) === 0) break;
    mult *= 128;
    if (mult > 128 ** 3) throw new Error('largo inválido');
  }
  if (bytes.length < i + largo) return null;
  return { tipo, cuerpo: bytes.subarray(i, i + largo), fin: i + largo };
}
