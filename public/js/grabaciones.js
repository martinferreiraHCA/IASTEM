/**
 * Las grabaciones de NOVA: los parlamentos ya dichos, en audio, para que la
 * función vaya sin IA ni sintetizador en vivo.
 *
 * Las genera `herramientas/grabar.mjs` y quedan en public/guiones/<nombre>/,
 * con un índice en public/guiones/indice.json. Cada grabación se encuentra
 * por la huella de su texto (ver huella.js): da lo mismo de qué guion vino
 * o en qué línea está. Al cargar un guion se bajan todas las que le
 * corresponden, así suenan al instante cuando llega el momento. Se tocan
 * con un elemento de audio, que permite cambiar la velocidad conservando
 * el tono: el control de velocidad de la voz también manda sobre ellas.
 */

import { huella, textoParaHuella } from './huella.js';

// Cuánto se espera antes de que empiece a sonar una grabación. La salida de
// audio (una tele por HDMI, un parlante Bluetooth) se duerme en los silencios
// y tarda en despertar: si el audio arranca de golpe, se come el principio.
// Las grabaciones ya traen además su propio silencio al principio.
const ENTRADA_MS = 80;       // con la salida ya despierta
const ENTRADA_FRIA_MS = 450; // la primera vez, o si estaba dormida

export class Grabaciones {
  constructor() {
    this.paquetes = [];           // lo que dice indice.json
    this.porHuella = new Map();   // huella → { url, duracion, texto, paquete }
    this.buffers = new Map();     // huella → { url (blob), duracion }, ya bajado
    this.fallidas = new Set();    // huellas cuyo audio no se pudo bajar
    this.actual = null;           // el <audio> que está sonando o por sonar
    this.soltarActual = null;     // lo que hay que llamar para darlo por terminado
    this.entradaTimer = null;
    this.ctx = null;              // el contexto de la "vela"
    this.vela = null;             // lo que mantiene abierta la salida, en silencio
    this.onCambio = null;         // algo cambió: índice cargado, precarga avanzó
    this.precargando = 0;
  }

  /** Lee el índice y las listas de grabaciones de todos los guiones. */
  async cargarIndice() {
    let indice = [];
    try {
      const res = await fetch('guiones/indice.json', { cache: 'no-cache' });
      if (res.ok) indice = await res.json();
    } catch { /* sin grabaciones: no pasa nada */ }
    this.paquetes = Array.isArray(indice) ? indice : [];
    await Promise.all(this.paquetes.map(async (paquete) => {
      try {
        const res = await fetch(`guiones/${encodeURIComponent(paquete.nombre)}/grabaciones.json`, { cache: 'no-cache' });
        if (!res.ok) return;
        const lista = await res.json();
        for (const p of lista.parlamentos || []) {
          this.porHuella.set(p.huella, { url: `guiones/${encodeURIComponent(paquete.nombre)}/${p.archivo}`, duracion: Number(p.duracion) || 0, texto: p.texto, paquete: paquete.nombre });
        }
      } catch { /* ese guion no tiene grabaciones legibles */ }
    }));
    this.onCambio?.();
  }

  /** El texto del guion de un paquete, para cargarlo con un toque. */
  async textoDelPaquete(nombre) {
    const res = await fetch(`guiones/${encodeURIComponent(nombre)}/guion.txt`, { cache: 'no-cache' });
    if (!res.ok) throw new Error('No se pudo leer ese guion.');
    return res.text();
  }

  tiene(texto) {
    return this.porHuella.has(huella(texto));
  }

  lista(texto) {
    return this.buffers.has(huella(texto));
  }

  /** Cuántas de estas líneas tienen grabación, y cuántas ya están en memoria. */
  estado(textos) {
    let grabadas = 0;
    let listas = 0;
    for (const t of textos) {
      const h = huella(t);
      if (this.porHuella.has(h)) grabadas += 1;
      if (this.buffers.has(h)) listas += 1;
    }
    return { total: textos.length, grabadas, listas, fallidas: textos.filter((t) => this.fallidas.has(huella(t))).length };
  }

  /** Baja y decodifica las grabaciones de estas líneas (las que faltan). */
  async precargar(textos) {
    const pendientes = [...new Set(textos.map((t) => huella(t)))].filter((h) => this.porHuella.has(h) && !this.buffers.has(h) && !this.fallidas.has(h));
    if (!pendientes.length) return;
    this.precargando += pendientes.length;
    this.onCambio?.();
    await Promise.all(pendientes.map(async (h) => {
      const { url, duracion } = this.porHuella.get(h);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        this.buffers.set(h, { url: URL.createObjectURL(blob), duracion });
      } catch {
        this.fallidas.add(h);
      } finally {
        this.precargando -= 1;
        this.onCambio?.();
      }
    }));
  }

  /**
   * Mantiene abierta la salida de audio, en silencio total. Con la salida
   * abierta, la tele o el parlante no tienen que "arrancar" con cada
   * parlamento, que es cuando se comen el principio. No suena nada: es un
   * tono con el volumen en cero. Se puede llamar muchas veces; el navegador
   * lo deja arrancar recién después de un toque en la página.
   */
  despertar() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        const fuente = this.ctx.createOscillator();
        const ganancia = this.ctx.createGain();
        ganancia.gain.value = 0; // silencio de verdad: no llega nada al parlante
        fuente.connect(ganancia).connect(this.ctx.destination);
        fuente.start();
        this.vela = fuente;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch { /* sin Web Audio: se sigue sin esto */ }
  }

  /** La salida lleva un rato despierta: alcanza con una entrada corta. */
  get despierta() {
    return this.ctx?.state === 'running' && this.ctx.currentTime > 1;
  }

  /**
   * Toca la grabación de ese texto, si está lista, a esa velocidad (1 es la
   * grabada; el tono se conserva). Arranca después de una entrada corta de
   * silencio, para que no se corte el principio. Devuelve cuánto va a durar
   * (con la entrada) y una promesa que se cumple al terminar; null si no hay
   * grabación.
   */
  tocar(texto, velocidad = 1) {
    const h = huella(texto);
    const grabacion = this.buffers.get(h);
    if (!grabacion) return null;
    this.parar();
    const entrada = this.despierta ? ENTRADA_MS : ENTRADA_FRIA_MS;
    this.despertar();
    const v = Math.min(2, Math.max(0.5, Number(velocidad) || 1));
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = grabacion.url;
    audio.preservesPitch = true;
    audio.playbackRate = v;
    const fin = new Promise((resolve) => {
      const listo = () => {
        if (this.actual === audio) { this.actual = null; this.soltarActual = null; }
        resolve();
      };
      this.soltarActual = listo;
      audio.onended = listo;
      audio.onerror = listo;
    });
    this.actual = audio;
    this.entradaTimer = setTimeout(() => {
      if (this.actual !== audio) return;
      audio.play().catch(() => { if (this.actual === audio) this.soltarActual?.(); });
    }, entrada);
    return { duracion: grabacion.duracion / v + entrada / 1000, fin };
  }

  parar() {
    clearTimeout(this.entradaTimer);
    const audio = this.actual;
    if (!audio) return;
    const soltar = this.soltarActual;
    this.actual = null;
    this.soltarActual = null;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute('src');
    soltar?.();
  }
}

export { huella, textoParaHuella };
