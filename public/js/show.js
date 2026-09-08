/**
 * La función: quiénes participan y qué van definiendo con NOVA.
 *
 * Dos cosas que convierten una demo en una performance:
 *
 *   turnos    Cada estudiante tiene nombre y color. Cuando le toca, la
 *             pantalla lo dice. Los padres siguen a su hijo, no a un cursor.
 *   acuerdos  Lo que el grupo define junto a NOVA queda fijado en un muro.
 *             Al final se muestran todos juntos: es lo que se llevan.
 *
 * Todo se guarda en el navegador, así que si la máquina se reinicia a mitad
 * de la función no se pierde nada.
 */

const STORE = 'nova:funcion';

// Colores pensados para leerse proyectados sobre fondo oscuro.
const COLORES = [
  '#7af5ff', '#ff6ec7', '#8affc4', '#ffc76b',
  '#a37bff', '#ff9d7a', '#6ec7ff', '#e5ff7a',
];

export class Show {
  constructor() {
    this.speakers = [];
    this.agreements = [];
    this.currentId = null;
    this.listeners = new Set();
    this.#load();
  }

  /* ------------------------------------------------------------ turnos */

  addSpeaker(name) {
    const limpio = (name || '').trim().slice(0, 24);
    if (!limpio) return null;

    const ya = this.speakers.find((s) => s.name.toLowerCase() === limpio.toLowerCase());
    if (ya) return ya;

    const speaker = {
      id: `p${Date.now().toString(36)}${this.speakers.length}`,
      name: limpio,
      color: COLORES[this.speakers.length % COLORES.length],
    };
    this.speakers.push(speaker);
    if (!this.currentId) this.currentId = speaker.id;
    this.#save();
    return speaker;
  }

  removeSpeaker(id) {
    this.speakers = this.speakers.filter((s) => s.id !== id);
    if (this.currentId === id) this.currentId = this.speakers[0]?.id || null;
    this.#save();
  }

  setCurrent(id) {
    this.currentId = this.speakers.some((s) => s.id === id) ? id : null;
    this.#save();
  }

  /** Pasa al siguiente de la lista. Vuelve al principio al terminar. */
  next() {
    if (!this.speakers.length) return null;
    const i = this.speakers.findIndex((s) => s.id === this.currentId);
    this.currentId = this.speakers[(i + 1) % this.speakers.length].id;
    this.#save();
    return this.current;
  }

  get current() {
    return this.speakers.find((s) => s.id === this.currentId) || null;
  }

  /** El nombre a mostrar cuando habla alguien, con o sin plantel cargado. */
  get currentName() {
    return this.current?.name || 'EL PÚBLICO';
  }

  get currentColor() {
    return this.current?.color || '#8affc4';
  }

  /* ---------------------------------------------------------- acuerdos */

  /**
   * Fija algo que quedó definido.
   * @param {{tema:string, texto:string}} acuerdo
   */
  pin({ tema, texto }) {
    const limpio = (texto || '').trim();
    if (!limpio) return null;

    const acuerdo = {
      id: `a${Date.now().toString(36)}`,
      tema: (tema || '').trim().slice(0, 80),
      texto: limpio.slice(0, 600),
      autor: this.currentName,
      color: this.currentColor,
      at: Date.now(),
    };
    this.agreements.push(acuerdo);
    this.#save();
    return acuerdo;
  }

  unpin(id) {
    this.agreements = this.agreements.filter((a) => a.id !== id);
    this.#save();
  }

  clearAgreements() {
    this.agreements = [];
    this.#save();
  }

  get lastAgreement() {
    return this.agreements.at(-1) || null;
  }

  /* ------------------------------------------------------------ avisos */

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this);
    return () => this.listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.listeners) fn(this);
  }

  /* --------------------------------------------------------- guardado */

  #save() {
    try {
      localStorage.setItem(
        STORE,
        JSON.stringify({
          speakers: this.speakers,
          agreements: this.agreements,
          currentId: this.currentId,
        }),
      );
    } catch { /* navegación privada: se usa solo en esta sesión */ }
    this.#notify();
  }

  #load() {
    let guardado;
    try {
      guardado = JSON.parse(localStorage.getItem(STORE) || 'null');
    } catch {
      guardado = null;
    }
    if (!guardado) return;
    this.speakers = Array.isArray(guardado.speakers) ? guardado.speakers : [];
    this.agreements = Array.isArray(guardado.agreements) ? guardado.agreements : [];
    this.currentId = guardado.currentId || this.speakers[0]?.id || null;
  }
}
