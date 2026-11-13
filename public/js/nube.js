/**
 * La nube: el camino firme entre el escenario y el celular.
 *
 * Los otros caminos de la sala (directo y relevo) dependen de servidores
 * públicos y anónimos, que andan o no según el día y la red. Este usa una
 * base de datos en tiempo real de Firebase (Google), que el colegio crea una
 * vez, gratis: pasa por cualquier red (es HTTPS común), guarda el último
 * estado aunque alguien se desconecte un rato, y no hay que instalar nada.
 *
 * Se habla con su interfaz REST, sin biblioteca: se escribe con `fetch` y se
 * escucha con `EventSource`, que el navegador reconecta solo.
 *
 * Lo que hay en la base, por sala:
 *   nova/<sala>/panel/estado       el último estado del escenario
 *   nova/<sala>/panel/guion        qué versión del guion hay ({version})
 *   nova/<sala>/panel/acuses/<id>  órdenes que el escenario ya recibió
 *   nova/<sala>/guion              el guion entero
 *   nova/<sala>/ordenes/<id>       órdenes del panel, hasta que el escenario las toma
 *
 * Seguridad: las reglas de la base dejan leer y escribir dentro de una sala
 * pero no listar las salas, así que entra solo quien tiene el código. Todo
 * viaja cifrado (HTTPS).
 */

const SIN_NOVEDAD_MS = 75000; // Firebase late cada 30 s: sin nada en este tiempo, la escucha está muerta

/** La dirección de la base, limpia: sin barra final ni `.json`. */
export function limpiarUrlDeNube(texto) {
  let url = String(texto || '').trim().replace(/\/+$/, '').replace(/\/?\.json$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

const NUBE_CLAVE = 'nova:nube'; // la dirección de la base, si se puso a mano en este navegador

/**
 * La dirección de la base: la que se puso a mano en este navegador o, si
 * no, la del sitio (nube.json, que viaja con la página). Vacío: no hay nube.
 */
export async function urlDeNube() {
  try {
    const local = limpiarUrlDeNube(localStorage.getItem(NUBE_CLAVE));
    if (local) return local;
  } catch { /* sin localStorage */ }
  try {
    const res = await fetch('nube.json', { cache: 'no-cache' });
    if (res.ok) return limpiarUrlDeNube((await res.json())?.url);
  } catch { /* sin archivo: no hay nube */ }
  return '';
}

/** Guarda (o quita, con vacío) la dirección puesta a mano en este navegador. */
export function guardarUrlDeNube(url) {
  const limpia = limpiarUrlDeNube(url);
  try {
    if (limpia) localStorage.setItem(NUBE_CLAVE, limpia);
    else localStorage.removeItem(NUBE_CLAVE);
  } catch { /* sin lugar */ }
  return limpia;
}

export class Nube {
  /**
   * @param {{url: string, sala: string, rol: 'escenario'|'panel', onMensaje: (m: object) => void, onCambio?: () => void}} opciones
   */
  constructor({ url, sala, rol, onMensaje, onCambio }) {
    this.base = `${limpiarUrlDeNube(url)}/nova/${encodeURIComponent(sala)}`;
    this.rol = rol;
    this.onMensaje = onMensaje;
    this.onCambio = onCambio;
    this.estado = 'cerrada'; // cerrada, conectando, conectada, caida
    this.detalle = '';
    this.fuente = null;
    this.ultimaNovedad = 0;
    this.vigia = null;
    this.colas = new Map();   // ruta → {volando, pendiente}: una escritura por ruta a la vez
    this.guionVisto = '';
    this.conReemplazo = true; // escribir con POST y el método en la dirección: sin consulta previa (preflight)
  }

  conectar() {
    this.cerrada = false;
    this.#escuchar();
    clearInterval(this.vigia);
    this.vigia = setInterval(() => {
      if (this.fuente && performance.now() - this.ultimaNovedad > SIN_NOVEDAD_MS) this.#escuchar();
    }, 15000);
  }

  cerrar() {
    this.cerrada = true;
    clearInterval(this.vigia);
    this.fuente?.close();
    this.fuente = null;
    this.#setEstado('cerrada');
  }

  /** Si la escucha no está abierta, o hace rato que no dice nada, se rehace ya. */
  reanimar() {
    if (this.cerrada) return;
    const muda = performance.now() - this.ultimaNovedad > 40000;
    if (!this.fuente || this.fuente.readyState !== 1 || muda) this.#escuchar();
  }

  /** Manda un mensaje del enlace por la nube. */
  enviar(sobre) {
    if (this.cerrada) return;
    if (this.rol === 'panel') {
      // Todo lo del panel es una orden (o un latido) para el escenario.
      this.#escribir(`ordenes/${sobre.id}`, sobre);
      return;
    }
    if (sobre.tipo === 'estado') {
      this.#escribir('panel/estado', sobre);
    } else if (sobre.tipo === 'guion') {
      this.#escribir('guion', sobre).then(() => this.#escribir('panel/guion', { version: sobre.version, t: sobre.t }));
    } else if (sobre.tipo === 'acuse') {
      this.#escribir(`panel/acuses/${sobre.para}`, sobre.t || Date.now());
      setTimeout(() => this.#borrar(`panel/acuses/${sobre.para}`), 30000); // no se acumulan
    }
  }

  /* ---------------------------------------------------------- escuchar */

  #escuchar() {
    this.fuente?.close();
    if (!('EventSource' in window)) return this.#setEstado('caida', 'Este navegador no puede escuchar la nube.');
    if (this.estado !== 'conectada') this.#setEstado('conectando');
    const rama = this.rol === 'escenario' ? 'ordenes' : 'panel';
    const fuente = new EventSource(`${this.base}/${rama}.json`);
    this.fuente = fuente;
    this.ultimaNovedad = performance.now();
    let primera = true; // lo primero que llega es lo que ya había

    fuente.onopen = () => {
      if (this.fuente !== fuente) return;
      this.ultimaNovedad = performance.now();
      this.#setEstado('conectada');
    };
    fuente.onerror = () => {
      if (this.fuente !== fuente) return;
      // El navegador reintenta solo; mientras tanto, está caída. Si la cerró
      // del todo (un 401 o 404: la base o sus reglas), se reintenta a mano.
      this.#setEstado('caida', fuente.readyState === 2 ? 'La base no responde: fijate la dirección y las reglas.' : '');
      if (fuente.readyState === 2) setTimeout(() => { if (this.fuente === fuente && !this.cerrada) this.#escuchar(); }, 5000);
      primera = true;
    };
    const novedad = (event) => {
      if (this.fuente !== fuente) return;
      this.ultimaNovedad = performance.now();
      if (this.estado !== 'conectada') this.#setEstado('conectada');
      let cambio;
      try { cambio = JSON.parse(event.data); } catch { return; }
      if (!cambio) return;
      if (this.rol === 'escenario') this.#ordenes(cambio, primera);
      else this.#paraElPanel(cambio, primera);
      primera = false;
    };
    fuente.addEventListener('put', novedad);
    fuente.addEventListener('patch', novedad);
    fuente.addEventListener('keep-alive', () => { if (this.fuente === fuente) this.ultimaNovedad = performance.now(); });
    fuente.addEventListener('cancel', () => { if (this.fuente === fuente) this.#setEstado('caida', 'La base no deja leer: revisá las reglas.'); });
    fuente.addEventListener('auth_revoked', () => { if (this.fuente === fuente) this.#setEstado('caida', 'La base no deja leer: revisá las reglas.'); });
  }

  /** El escenario: llegan órdenes. Cada una se toma, se pasa, y se borra. */
  #ordenes({ path, data }, primera) {
    if (path === '/') {
      // Lo que ya había al conectar quedó de antes: se limpia sin ejecutarlo.
      // Si alguna era de recién, el panel la manda de nuevo sola.
      for (const [id, sobre] of Object.entries(data || {})) {
        this.#borrar(`ordenes/${id}`);
        if (!primera && sobre) this.onMensaje?.(sobre);
      }
      return;
    }
    const id = path.split('/')[1];
    if (!id || data == null || path.split('/').length > 2) return; // un borrado, o un pedazo
    this.#borrar(`ordenes/${id}`);
    this.onMensaje?.(data);
  }

  /** El panel: llega el estado, el aviso de guion nuevo, o un acuse. */
  #paraElPanel({ path, data }, primera) {
    if (path === '/') {
      if (data?.estado) this.onMensaje?.(primera ? { ...data.estado, deAntes: true } : data.estado);
      if (data?.guion) this.#traerGuion(data.guion.version);
      for (const id of Object.keys(data?.acuses || {})) this.onMensaje?.({ tipo: 'acuse', para: id, de: 'escenario' });
      return;
    }
    if (path === '/estado') { if (data) this.onMensaje?.(data); return; }
    if (path === '/guion') { if (data) this.#traerGuion(data.version); return; }
    if (path === '/acuses') { for (const id of Object.keys(data || {})) this.onMensaje?.({ tipo: 'acuse', para: id, de: 'escenario' }); return; }
    if (path.startsWith('/acuses/') && data != null) this.onMensaje?.({ tipo: 'acuse', para: path.slice('/acuses/'.length), de: 'escenario' });
  }

  async #traerGuion(version) {
    if (!version || version === this.guionVisto) return;
    this.guionVisto = version;
    try {
      const res = await fetch(`${this.base}/guion.json`, { cache: 'no-store' });
      const guion = res.ok ? await res.json() : null;
      if (guion?.entradas) this.onMensaje?.(guion);
      else this.guionVisto = '';
    } catch {
      this.guionVisto = ''; // se pide de nuevo con el próximo aviso
    }
  }

  /* ---------------------------------------------------------- escribir */

  /**
   * Escribe un valor en una ruta. Una escritura por ruta a la vez: si llega
   * otra mientras la anterior viaja, queda solo la última (lo que importa
   * es el valor más nuevo, y así dos escrituras no se cruzan en el camino).
   */
  #escribir(ruta, valor) {
    let cola = this.colas.get(ruta);
    if (!cola) { cola = { volando: null, pendiente: undefined, hay: false }; this.colas.set(ruta, cola); }
    if (cola.volando) {
      cola.pendiente = valor;
      cola.hay = true;
      return cola.volando;
    }
    const mandar = async (v) => {
      await this.#pedir('PUT', ruta, v);
      if (cola.hay) {
        const siguiente = cola.pendiente;
        cola.hay = false;
        cola.pendiente = undefined;
        return mandar(siguiente);
      }
      cola.volando = null;
      if (ruta.startsWith('ordenes/') || ruta.startsWith('panel/acuses/')) this.colas.delete(ruta);
      return undefined;
    };
    cola.volando = mandar(valor);
    return cola.volando;
  }

  #borrar(ruta) {
    return this.#pedir('DELETE', ruta);
  }

  async #pedir(metodo, ruta, valor) {
    const cuerpo = metodo === 'DELETE' ? undefined : JSON.stringify(valor);
    const directa = `${this.base}/${ruta}.json?print=silent`;
    const intento = (conReemplazo) => (conReemplazo
      ? fetch(`${directa}&x-http-method-override=${metodo}`, { method: 'POST', body: cuerpo ?? 'null' })
      : fetch(directa, { method: metodo, body: cuerpo }));
    try {
      let res = await intento(this.conReemplazo);
      if (!res.ok && this.conReemplazo && res.status !== 401 && res.status !== 403) {
        // Por las dudas la base no acepte el método en la dirección: a la manera común.
        res = await intento(false);
        if (res.ok) this.conReemplazo = false;
      }
      if (res.status === 401 || res.status === 403) this.#setEstado('caida', 'La base no deja escribir: revisá las reglas.');
      return res.ok;
    } catch {
      return false; // sin red: lo que importa se manda de nuevo
    }
  }

  #setEstado(estado, detalle = '') {
    if (this.estado === estado && this.detalle === detalle) return;
    this.estado = estado;
    this.detalle = detalle;
    this.onCambio?.();
  }
}

/**
 * Prueba una base: escribe, lee y borra un dato de prueba. Dice si anda y
 * cuánto tarda, o qué falló, en palabras.
 */
export async function probarNube(url) {
  const base = limpiarUrlDeNube(url);
  if (!base) return { ok: false, texto: 'La dirección no parece la de una base de Firebase.' };
  const ruta = `${base}/nova/prueba-${Math.random().toString(36).slice(2, 10)}/dato.json`;
  const valor = Date.now();
  const t0 = performance.now();
  try {
    const escribir = await fetch(ruta, { method: 'PUT', body: JSON.stringify(valor) });
    if (escribir.status === 401 || escribir.status === 403) return { ok: false, texto: 'La base existe pero no deja escribir: faltan las reglas de NOVA.' };
    if (escribir.status === 404) return { ok: false, texto: 'No hay una base en esa dirección (404). Copiala de nuevo desde Firebase.' };
    if (!escribir.ok) return { ok: false, texto: `La base respondió ${escribir.status} al escribir.` };
    const leer = await fetch(ruta, { cache: 'no-store' });
    if (leer.status === 401 || leer.status === 403) return { ok: false, texto: 'La base deja escribir pero no leer: revisá las reglas.' };
    const leido = leer.ok ? await leer.json() : null;
    await fetch(ruta, { method: 'DELETE' }).catch(() => {});
    if (leido !== valor) return { ok: false, texto: 'La base no devolvió lo que se escribió.' };
    return { ok: true, texto: `La nube anda: ida y vuelta en ${Math.round(performance.now() - t0)} ms.` };
  } catch {
    return { ok: false, texto: 'No se pudo llegar a esa dirección: ¿está bien escrita?, ¿hay internet?' };
  }
}
