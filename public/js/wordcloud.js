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
    this.clearZone = null;        // elipse central que las palabras esquivan
    this.running = false;
    this.lastFrame = 0;

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  /**
   * Deja un hueco en el centro para que el texto grande se lea limpio.
   * @param {{rx:number, ry:number}|null} zone  radios como fracción del ancho/alto
   */
  setClearZone(zone) {
    this.clearZone = zone;
  }

  /** Cuánto invade una partícula la zona despejada (0 = afuera, 1 = en el centro). */
  #intrusion(x, y) {
    if (!this.clearZone) return 0;
    const dx = (x - this.w / 2) / (this.w * this.clearZone.rx);
    const dy = (y - this.h / 2) / (this.h * this.clearZone.ry);
    const d = Math.hypot(dx, dy);
    return d >= 1 ? 0 : 1 - d;
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
        existing.targetSize = sizeFor(weight, this.h);
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
    const size = sizeFor(weight, this.h);
    const colors = PALETTE[tone] || PALETTE.ai;

    let x = this.w / 2 + Math.cos(angle) * radius;
    let y = this.h / 2 + Math.sin(angle) * radius * 0.72;
    if (this.clearZone) {
      const push = this.#intrusion(x, y);
      if (push > 0) {
        const escape = (1 + push) * Math.min(this.w, this.h) * 0.34;
        x = this.w / 2 + Math.cos(angle) * escape;
        y = this.h / 2 + Math.sin(angle) * escape * 0.8;
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
      decay: 0.019 + Math.random() * 0.013,
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

      p.x += (p.vx + Math.sin(p.phase) * 5) * dt;
      p.y += (p.vy + Math.cos(p.phase * 0.7) * 4) * dt;

      // Frenado suave: las palabras se van quedando quietas mientras se disuelven.
      p.vx *= 1 - 0.35 * dt;
      p.vy *= 1 - 0.35 * dt;

      // El texto central manda: las palabras se apartan si se le acercan.
      const push = this.#intrusion(p.x, p.y);
      if (push > 0) {
        const dx = p.x - this.w / 2;
        const dy = p.y - this.h / 2;
        const len = Math.hypot(dx, dy) || 1;
        p.vx += (dx / len) * push * 90 * dt;
        p.vy += (dy / len) * push * 90 * dt;
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
      const alpha = Math.min(fadeIn, p.life * 1.6) * 0.95;
      if (alpha <= 0.01) continue;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * (1 - p.life));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.font = `${600 + Math.min(200, p.weight * 60)} ${p.size * (1 + p.pulse * 0.12)}px "Inter", system-ui, sans-serif`;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 18 + p.weight * 5 + p.pulse * 22;
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  }
}

/* ---------------------------------------------------------------- utils */

function sizeFor(weight, viewportHeight) {
  const base = Math.max(15, viewportHeight * 0.022);
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
