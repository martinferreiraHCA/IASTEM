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

export class Grabaciones {
  constructor() {
    this.paquetes = [];           // lo que dice indice.json
    this.porHuella = new Map();   // huella → { url, duracion, texto, paquete }
    this.buffers = new Map();     // huella → { url (blob), duracion }, ya bajado
    this.fallidas = new Set();    // huellas cuyo audio no se pudo bajar
    this.actual = null;           // el <audio> que está sonando
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
   * Toca la grabación de ese texto, si está lista, a esa velocidad (1 es la
   * grabada; el tono se conserva). Devuelve cuánto va a durar y una promesa
   * que se cumple al terminar; null si no hay grabación.
   */
  tocar(texto, velocidad = 1) {
    const h = huella(texto);
    const grabacion = this.buffers.get(h);
    if (!grabacion) return null;
    this.parar();
    const v = Math.min(2, Math.max(0.5, Number(velocidad) || 1));
    const audio = new Audio(grabacion.url);
    audio.preservesPitch = true;
    audio.playbackRate = v;
    const fin = new Promise((resolve) => {
      const listo = () => { if (this.actual === audio) this.actual = null; resolve(); };
      audio.onended = listo;
      audio.onerror = listo;
      audio.onpause = () => { if (audio.ended || this.actual !== audio) listo(); };
    });
    this.actual = audio;
    audio.play().catch(() => { if (this.actual === audio) this.actual = null; });
    return { duracion: grabacion.duracion / v, fin };
  }

  parar() {
    const audio = this.actual;
    if (!audio) return;
    this.actual = null;
    audio.pause();
    audio.removeAttribute('src');
  }
}

export { huella, textoParaHuella };
