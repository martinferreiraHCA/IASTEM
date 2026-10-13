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
 */

const CANAL = 'nova:enlace';

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

    this.canal = 'BroadcastChannel' in window ? new BroadcastChannel(CANAL) : null;
    this.canal?.addEventListener('message', (event) => this.#recibir(event.data));

    if (location.protocol !== 'file:') this.#conectarServidor();
    else this.#setServidor('ausente');
  }

  /** Manda un mensaje a todas las otras páginas, por los dos caminos. */
  enviar(mensaje) {
    const sobre = { ...mensaje, de: this.rol, t: Date.now() };
    this.canal?.postMessage(sobre);
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
}
