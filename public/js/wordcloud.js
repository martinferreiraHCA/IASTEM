/**
 * Nube de palabras abstracta.
 *
 * Cada palabra relevante de la charla entra como una partícula que flota,
 * respira y se disuelve. Si una palabra se repite, crece y se reaviva:
 * los temas de la conversación quedan visibles como una nebulosa.
 */

const STOPWORDS = new Set(`
a al algo algunas algunos ante antes aca aquí aqui como con contra cual cuando de del desde donde dos el la
los las le les lo un una uno unos unas y o u e ni que qué quien quién porque por para pero pues si sí sin
sobre son ser soy es esta este esto estos estas eso esa ese esas esos su sus tu tus te me mi mis nos ya muy
mas más tan también tambien todo toda todos todas otro otra otros otras hay han has ha he hemos había habia
fue fui era eran ser sido estar están estan está esta hacer hace hago haces dice decir puede pueden pueda
entre hasta cada vez veces bien solo sólo aunque entonces así asi cuanto cuánto tiene tienen tengo tenes
mientras cuanto quiero quiere queres quieras contame decime dale claro bueno nada algo mismo misma
hola gracias favor sobre luego ahora despues después siempre nunca menos mucho mucha muchos muchas
the of and or to in is are was were for with that this these those you your they them their it its an be
i'm dont don't ok okay
`.trim().split(/\s+/));

const PALETTE = {
  user: ['#7af5ff', '#5fd0ff', '#8fe3ff'],
  ai: ['#a37bff', '#ff6ec7', '#c9a6ff', '#7af5ff'],
};

export class WordCloud {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.words = [];              // partículas activas
    this.weights = new Map();     // palabra -> cuántas veces apareció
    this.maxWords = 46;
    this.clearZone = null;        // la zona que las palabras esquivan: donde va el texto grande
    this.zonaCache = null;        // la última zona medida, en píxeles
    this.zonaMedida = 0;          // cuándo se midió
    this.energy = 0;              // volumen de la voz, de 0 a 1
    this.escenario = false;       // proyectada: palabras más grandes, más vivas y que duran más
    this.running = false;
    this.lastFrame = 0;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /**
   * Deja un hueco para que el texto grande se lea limpio.
   *
   * Puede ser una elipse fija en el centro, `{rx, ry}` como fracción del
   * ancho y el alto, o una función que devuelve dónde está lo que hay que
   * esquivar en este momento: una zona `{cx, cy, hw, hh}` en píxeles
   * (centro y medios lados) o una lista de zonas, la primera la principal.
   * Así el hueco sigue al texto cuando crece, se achica o se corre.
   *
   * @param {{rx:number, ry:number} | (() => object | object[] | null) | null} zone
   */
  setClearZone(zone) {
    this.clearZone = zone;
    this.zonaCache = null;
    this.zonaMedida = 0;
  }

  /** Las zonas de ahora, en píxeles. Se vuelven a medir cada tanto, no en cada cuadro. */
  #zonas() {
    if (!this.clearZone) return [];
    if (typeof this.clearZone !== 'function') {
      return [{ cx: this.w / 2, cy: this.h / 2, hw: this.w * this.clearZone.rx, hh: this.h * this.clearZone.ry, blanda: true }];
    }
    const ahora = performance.now();
    if (ahora - this.zonaMedida > 120) {
      this.zonaMedida = ahora;
      const medido = this.clearZone();
      this.zonaCache = (Array.isArray(medido) ? medido : [medido]).filter(Boolean);
    }
    return this.zonaCache || [];
  }

  /** La zona principal: donde va el texto grande. */
  #zona() {
    return this.#zonas()[0] || null;
  }

  /**
   * En el escenario la nube se ve a diez metros: las palabras salen más
   * grandes y más nítidas, y se quedan más tiempo.
   */
  setEscenario(on) {
    this.escenario = Boolean(on);
    for (const p of this.words) p.targetSize = sizeFor(p.weight, this.h, this.escenario);
  }

  /** El volumen de quien habla: las palabras brillan y se agitan con la voz. */
  setEnergy(nivel) {
    this.energy = Math.max(0, Math.min(1, nivel || 0));
  }

  /**
   * Cuánto invade una palabra la zona despejada (0 = afuera, 1 = en el
   * centro). Se cuenta el tamaño de la palabra: una palabra larga que roza
   * el borde ya está encima del texto.
   */
  #intrusion(x, y, ew = 0, eh = 0) {
    let peor = 0;
    for (const zona of this.#zonas()) {
      const dx = Math.abs(x - zona.cx) / (zona.hw + ew + 24);
      const dy = Math.abs(y - zona.cy) / (zona.hh + eh + 18);
      // Una elipse si la zona es la fija de siempre; un rectángulo redondeado
      // si sigue a un elemento de la pantalla, que es rectangular.
      const d = zona.blanda ? Math.hypot(dx, dy) : Math.max(dx, dy, Math.hypot(dx, dy) / 1.25);
      if (d < 1) peor = Math.max(peor, 1 - d);
    }
    return peor;
  }

  /** De qué zona hay que alejarse: la más invadida. */
  #zonaMasCercana(x, y, ew = 0, eh = 0) {
    let mejor = null;
    let peor = 0;
    for (const zona of this.#zonas()) {
      const dx = Math.abs(x - zona.cx) / (zona.hw + ew + 24);
      const dy = Math.abs(y - zona.cy) / (zona.hh + eh + 18);
      const d = zona.blanda ? Math.hypot(dx, dy) : Math.max(dx, dy, Math.hypot(dx, dy) / 1.25);
      if (d < 1 && 1 - d > peor) {
        peor = 1 - d;
        mejor = zona;
      }
    }
    return mejor;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.canvas.width = Math.max(1, w * dpr);
    this.canvas.height = Math.max(1, h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
  }

  /**
   * Absorbe un texto y agrega sus palabras significativas.
   * @param {string} text
   * @param {'user'|'ai'} tone
   */
  absorb(text, tone = 'ai') {
    for (const word of extractWords(text)) {
      const key = normalize(word);
      const weight = (this.weights.get(key) || 0) + 1;
      this.weights.set(key, weight);

      const existing = this.words.find((p) => p.key === key);
      if (existing) {
        // Ya está en pantalla: se reaviva y crece.
        existing.life = 1;
        existing.age = Math.max(existing.age, 0.8);
        existing.weight = weight;
        existing.targetSize = sizeFor(weight, this.h, this.escenario);
        existing.pulse = 1;
        continue;
      }
      this.#spawn(word, key, weight, tone);
    }
    this.start();
  }

  clear() {
    this.words.length = 0;
    this.weights.clear();
    this.ctx?.clearRect(0, 0, this.w, this.h);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
      this.lastFrame = now;
      this.#update(dt);
      this.#draw();
      if (this.words.length) requestAnimationFrame(loop);
      else {
        this.running = false;
        this.ctx.clearRect(0, 0, this.w, this.h);
      }
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  /* ------------------------------------------------------------ privado */

  #spawn(text, key, weight, tone) {
    // Distribución radial suave: densa en el centro, dispersa en los bordes.
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * Math.min(this.w, this.h) * 0.52;
    const size = sizeFor(weight, this.h, this.escenario);
    const colors = PALETTE[tone] || PALETTE.ai;

    let x = this.w / 2 + Math.cos(angle) * radius;
    let y = this.h / 2 + Math.sin(angle) * radius * 0.72;
    const zona = this.#zona();
    if (zona) {
      // Nace afuera de la zona del texto, en la misma dirección.
      const ew = text.length * size * 0.29;
      const eh = size * 0.62;
      for (let intento = 0; intento < 6 && this.#intrusion(x, y, ew, eh) > 0; intento++) {
        const escape = (1.15 + intento * 0.25);
        x = zona.cx + Math.cos(angle) * (zona.hw + ew + 30) * escape;
        y = zona.cy + Math.sin(angle) * (zona.hh + eh + 30) * escape;
      }
    }

    this.words.push({
      text,
      key,
      weight,
      x,
      y,
      vx: (Math.random() - 0.5) * 9,
      vy: -6 - Math.random() * 10,
      size: size * 0.3,
      targetSize: size,
      age: 0,                             // segundos desde que apareció
      life: 1,                            // 1 = recién nacida, 0 = disuelta
      decay: (0.019 + Math.random() * 0.013) * (this.escenario ? 0.55 : 1),
      color: colors[(Math.random() * colors.length) | 0],
      phase: Math.random() * Math.PI * 2,
      rot: (Math.random() - 0.5) * 0.1,
      pulse: 1,
    });

    // Si hay demasiadas, la más vieja se va antes.
    if (this.words.length > this.maxWords) {
      this.words.sort((a, b) => a.life - b.life);
      this.words.splice(0, this.words.length - this.maxWords);
    }
  }

  #update(dt) {
    for (const p of this.words) {
      p.age += dt;
      p.life -= p.decay * dt;
      p.phase += dt * 0.9;
      p.pulse += (0 - p.pulse) * dt * 2.2;
      p.size += (p.targetSize - p.size) * Math.min(1, dt * 4);

      const agita = 1 + this.energy * 1.6;
      p.x += (p.vx + Math.sin(p.phase) * 5 * agita) * dt;
      p.y += (p.vy + Math.cos(p.phase * 0.7) * 4 * agita) * dt;

      // Frenado suave: las palabras se van quedando quietas mientras se disuelven.
      p.vx *= 1 - 0.35 * dt;
      p.vy *= 1 - 0.35 * dt;

      // El texto manda: las palabras se apartan si se le acercan, y rápido
      // si ya están encima, que pasa cuando el texto crece de golpe.
      const ew = p.text.length * p.size * 0.29;
      const eh = p.size * 0.62;
      const push = this.#intrusion(p.x, p.y, ew, eh);
      const zona = push > 0 ? this.#zonaMasCercana(p.x, p.y, ew, eh) : null;
      if (push > 0 && zona) {
        const dx = p.x - zona.cx;
        const dy = (p.y - zona.cy) * (zona.hw / Math.max(1, zona.hh)); // salir por el lado más corto
        const len = Math.hypot(dx, dy) || 1;
        const fuerza = 160 + push * 260;
        p.vx += (dx / len) * fuerza * dt;
        p.vy += (dy / len) * fuerza * dt;
        if (push > 0.6) {
          // Muy adentro: se desvanece un poco mientras sale, para no tapar.
          p.life -= dt * 0.5;
        }
      }

      // Rebote blando contra los bordes para que nada se escape.
      const margin = 40;
      if (p.x < margin) p.vx += 14 * dt * 6;
      if (p.x > this.w - margin) p.vx -= 14 * dt * 6;
      if (p.y < margin) p.vy += 14 * dt * 6;
      if (p.y > this.h - margin) p.vy -= 14 * dt * 6;
    }
    this.#separate(dt);
    this.words = this.words.filter((p) => p.life > 0);
  }

  /** Empuje suave entre palabras para que no se monten unas sobre otras. */
  #separate(dt) {
    const list = this.words;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      const ah = a.size * 0.62;
      const aw = a.text.length * a.size * 0.29;

      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const overlapX = aw + b.text.length * b.size * 0.29 - Math.abs(dx);
        const overlapY = ah + b.size * 0.62 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;

        // Se separan por donde menos cuesta: el eje con menos superposición.
        const force = 34 * dt;
        if (overlapX < overlapY) {
          const dir = dx >= 0 ? 1 : -1;
          a.vx -= dir * force;
          b.vx += dir * force;
        } else {
          const dir = dy >= 0 ? 1 : -1;
          a.vy -= dir * force;
          b.vy += dir * force;
        }
      }
    }
  }

  #draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const p of this.words) {
      // Entra desvaneciéndose y se va igual: opacidad en forma de campana.
      const fadeIn = Math.min(1, p.age / 0.8);
      const alpha = Math.min(fadeIn, p.life * 1.6) * (this.escenario ? 1 : 0.95);
      if (alpha <= 0.01) continue;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * (1 - p.life));
      ctx.globalAlpha = Math.min(1, alpha * (1 + this.energy * 0.45));
      ctx.fillStyle = p.color;
      const respira = 1 + p.pulse * 0.12 + this.energy * 0.07;
      ctx.font = `${600 + Math.min(200, p.weight * 60)} ${p.size * respira}px "Inter", system-ui, sans-serif`;
      ctx.shadowColor = p.color;
      // Con poco brillo las letras quedan nítidas; el halo crece con la voz.
      ctx.shadowBlur = (this.escenario ? 8 : 18) + p.weight * 4 + p.pulse * 18 + this.energy * 26;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }
}

/* ---------------------------------------------------------------- utils */

function sizeFor(weight, viewportHeight, escenario = false) {
  const base = escenario ? Math.max(24, viewportHeight * 0.036) : Math.max(15, viewportHeight * 0.022);
  return base * (1 + Math.min(weight - 1, 5) * 0.32);
}

/** Quita acentos para comparar: "robótica" y "robotica" son la misma palabra. */
function normalize(word) {
  return word.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function extractWords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[-']+|[-']+$/g, ''))
    .filter((w) => w.length >= 4 && w.length <= 18 && !/^\d+$/.test(w))
    .filter((w) => !STOPWORDS.has(w) && !STOPWORDS.has(normalize(w)))
    .slice(0, 14);
}
