/**
 * Efecto "Jumanji": el texto no aparece, se materializa.
 *
 * Cada letra entra como un glifo extraño que muta unas cuantas veces
 * hasta encontrar su forma final. El texto puede llegar de a fragmentos
 * (streaming) y se va encolando solo.
 */

const GLYPHS = 'ΛΨΩΔΞΣΦΓΘΠ¤§∆◊✦✧※▓▒░#@%&*+=<>/\\|~^';

const randomGlyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

export class Materializer {
  /**
   * @param {HTMLElement} el  contenedor donde se escribe
   * @param {object} [opts]
   * @param {number} [opts.charsPerSecond]  velocidad de revelado
   * @param {number} [opts.mutations]       cuántas mutaciones antes de fijarse
   */
  constructor(el, opts = {}) {
    this.el = el;
    this.charsPerSecond = opts.charsPerSecond ?? 34;
    this.mutations = opts.mutations ?? 3;
    this.onSettle = opts.onSettle || null;

    this.queue = [];        // caracteres pendientes de revelar
    this.pending = new Set(); // spans todavía mutando
    this.word = null;         // envoltorio de la palabra en curso
    this.running = false;
    this.lastTick = 0;
    this.accumulator = 0;
    this.frame = null;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Vacía el contenedor y corta cualquier animación en curso. */
  clear() {
    this.stop();
    this.queue.length = 0;
    this.pending.clear();
    this.word = null;
    this.el.textContent = '';
  }

  /** Agrega texto a la cola; se revela solo. */
  push(text) {
    if (!text) return;
    for (const ch of text) this.queue.push(ch);
    this.start();
  }

  /** Escribe todo de una, sin animar (útil al recargar el historial). */
  writeInstantly(text) {
    this.clear();
    this.el.textContent = text;
  }

  /** Devuelve el contenedor donde va la próxima letra, creando palabra si hace falta. */
  #slot(startsWord) {
    if (startsWord || !this.word) {
      this.word = document.createElement('span');
      this.word.className = 'word';
      this.el.appendChild(this.word);
    }
    return this.word;
  }

  /** Revela de golpe lo que quede pendiente. */
  flush() {
    for (const ch of this.queue.splice(0)) this.#reveal(ch, true);
    for (const span of this.pending) this.#settle(span);
    this.pending.clear();
    this.stop();
  }

  get isBusy() {
    return this.queue.length > 0 || this.pending.size > 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    this.accumulator = 0;
    const tick = (now) => {
      if (!this.running) return;
      const dt = (now - this.lastTick) / 1000;
      this.lastTick = now;
      // Si la cola creció mucho, acelera: nunca conviene quedar atrás del audio.
      const rush = 1 + Math.min(this.queue.length / 90, 2.5);
      this.accumulator += dt * this.charsPerSecond * rush;

      let budget = 24; // techo por frame, para no trabar la pantalla grande
      while (this.accumulator >= 1 && this.queue.length && budget-- > 0) {
        this.accumulator -= 1;
        this.#reveal(this.queue.shift());
      }

      if (this.queue.length || this.pending.size) this.frame = requestAnimationFrame(tick);
      else {
        this.running = false;
        this.onSettle?.();
      }
    };
    this.frame = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  /* ------------------------------------------------------------ privado */

  #reveal(ch, instant = false) {
    // Los saltos de línea no necesitan ceremonia.
    if (ch === '\n') {
      this.el.appendChild(document.createElement('br'));
      this.word = null;
      return;
    }

    if (ch === ' ') {
      const space = document.createElement('span');
      space.className = 'ch ch--space is-set';
      space.textContent = ' ';
      this.el.appendChild(space);
      this.word = null;   // la próxima letra abre palabra nueva
      return;
    }

    const span = document.createElement('span');
    span.className = 'ch';
    const slot = this.#slot(false);

    if (instant || this.reduced) {
      span.textContent = ch;
      span.classList.add('is-set');
      slot.appendChild(span);
      return;
    }

    span.dataset.final = ch;
    span.textContent = randomGlyph();
    span.classList.add('is-forming');
    slot.appendChild(span);
    this.pending.add(span);

    let left = this.mutations;
    const mutate = () => {
      if (!this.pending.has(span)) return;
      if (left-- > 0) {
        span.textContent = randomGlyph();
        setTimeout(mutate, 45 + Math.random() * 55);
      } else {
        this.#settle(span);
        this.pending.delete(span);
      }
    };
    setTimeout(mutate, 40 + Math.random() * 60);
  }

  #settle(span) {
    span.textContent = span.dataset.final ?? span.textContent;
    span.classList.remove('is-forming');
    span.classList.add('is-set');
    // El destello de llegada se limpia solo para no dejar clases colgando.
    span.classList.add('just-set');
    setTimeout(() => span.classList.remove('just-set'), 600);
  }
}
