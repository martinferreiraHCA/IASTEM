/**
 * Las grabaciones de NOVA: los parlamentos ya dichos, en audio, para que la
 * función vaya sin IA ni sintetizador en vivo.
 *
 * Las genera `herramientas/grabar.mjs` y quedan en public/guiones/<nombre>/,
 * con un índice en public/guiones/indice.json. Cada grabación se encuentra
 * por la huella de su texto (ver huella.js): da lo mismo de qué guion vino
 * o en qué línea está. Al cargar un guion se bajan y decodifican todas las
 * que le corresponden, así suenan al instante cuando llega el momento.
 */

import { huella, textoParaHuella } from './huella.js';

export class Grabaciones {
  constructor() {
    this.paquetes = [];           // lo que dice indice.json
    this.porHuella = new Map();   // huella → { url, duracion, texto, paquete }
    this.buffers = new Map();     // huella → AudioBuffer ya decodificado
    this.fallidas = new Set();    // huellas cuyo audio no se pudo bajar
    this.ctx = null;
    this.actual = null;           // lo que está sonando
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
      const { url } = this.porHuella.get(h);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const bytes = await res.arrayBuffer();
        const buffer = await this.#contexto().decodeAudioData(bytes);
        this.buffers.set(h, buffer);
      } catch {
        this.fallidas.add(h);
      } finally {
        this.precargando -= 1;
        this.onCambio?.();
      }
    }));
  }

  /**
   * Toca la grabación de ese texto, si está lista. Devuelve la duración y
   * una promesa que se cumple al terminar; null si no hay grabación.
   */
  tocar(texto) {
    const h = huella(texto);
    const buffer = this.buffers.get(h);
    if (!buffer) return null;
    const ctx = this.#contexto();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    this.parar();
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(ctx.destination);
    const fin = new Promise((resolve) => { fuente.onended = () => { if (this.actual === fuente) this.actual = null; resolve(); }; });
    fuente.start();
    this.actual = fuente;
    return { duracion: buffer.duration, fin };
  }

  parar() {
    if (!this.actual) return;
    try { this.actual.stop(); } catch { /* ya paró */ }
    this.actual = null;
  }

  #contexto() {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }
}

export { huella, textoParaHuella };
