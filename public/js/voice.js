/**
 * Voz: dictado y habla.
 *
 * Para escuchar se usa la Web Speech API del navegador, que transcribe en
 * vivo con resultados parciales. Anda bien en Google Chrome y Edge; en
 * Chromium, Brave u Opera existe pero nunca devuelve nada, y en Firefox
 * directamente no está. Cuando falla, se avisa con claridad: en esos casos
 * la función se maneja desde el panel de control.
 *
 * Para hablar se usa la síntesis del navegador.
 */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupport = {
  listen: Boolean(Recognition),
  speak: 'speechSynthesis' in window,
};

/** Qué le decimos a la persona según lo que falló. */
const ERRORES_RECONOCIMIENTO = {
  'not-allowed': 'El navegador bloqueó el micrófono. Tocá el candado de la barra de direcciones, permití el micrófono y recargá la página.',
  'service-not-allowed': 'Este navegador no deja usar su reconocimiento de voz. Probá con Google Chrome o Edge, o manejá el guion desde el panel de control.',
  'audio-capture': 'No se encontró ningún micrófono. Revisá que esté conectado y elegido en el sistema.',
  network: 'El reconocimiento de voz no responde. Pasa en Chromium, Brave u Opera, o sin internet. Con Google Chrome o Edge y conexión anda; mientras tanto, manejá el guion desde el panel.',
  'language-not-supported': 'Este navegador no reconoce español. Probá con Google Chrome o Edge.',
  silent: 'El micrófono capta sonido, pero el reconocimiento no devuelve texto. Si es Google Chrome o Edge con internet, acercá el micrófono; si no, manejá el guion desde el panel.',
};

/** Estos no se arreglan insistiendo: el micrófono se apaga y se avisa. */
const ERRORES_FATALES = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

export class Listener {
  /**
   * @param {object} handlers
   * @param {(text:string) => void} handlers.onPartial   texto provisorio
   * @param {(text:string) => void} handlers.onFinal     frase cerrada
   * @param {(msg:string, code?:string) => void} [handlers.onError]   algo que la persona tiene que saber
   * @param {() => void} [handlers.onStart]
   * @param {() => void} [handlers.onEnd]
   * @param {(texto:string) => void} [handlers.onStatus]  el diagnóstico, cada vez que cambia
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.active = false;      // lo que el usuario pidió
    this.lang = 'es-ES';      // el genérico: es el que Chrome reconoce seguro
    this.recognition = null;
    this.stream = null;
    this.lastEvent = 0;
    this.lastResult = 0;
    this.watchdog = null;
    this.resultados = 0;      // cuántas veces devolvió texto, en toda su vida
    this.sonidoMs = 0;        // cuánto sonido captó el medidor sin que llegara texto
    this.ultimoSonido = 0;
    this.desde = 0;
    this.fallos = 0;          // errores seguidos de red, para espaciar los reintentos
    this.avisado = '';        // el último aviso dado, para no repetirlo
    this.diagnostico = 'apagado';
  }

  get supported() {
    return voiceSupport.listen;
  }

  /**
   * El medidor de volumen le cuenta cuánto suena. Si hay voz durante varios
   * segundos y el reconocimiento no devuelve nada, algo anda mal: en
   * Chromium, Brave u Opera arranca sin quejarse y nunca transcribe.
   */
  noteSound(nivel) {
    if (!this.active) return;
    const ahora = Date.now();
    if (nivel > 0.12) {
      if (this.ultimoSonido && ahora - this.ultimoSonido < 500) this.sonidoMs += ahora - this.ultimoSonido;
      this.ultimoSonido = ahora;
    }
  }

  /** @returns {Promise<boolean>} si quedó escuchando */
  async start() {
    if (!this.supported) {
      this.handlers.onError?.('Este navegador no reconoce voz. Probá con Chrome o Edge.', 'unsupported');
      return false;
    }
    if (this.active) return true;
    this.active = true;
    this.desde = Date.now();
    this.sonidoMs = 0;
    this.ultimoSonido = 0;
    this.fallos = 0;
    this.avisado = '';
    this.#estado('arrancando');
    this.#spinUp();

    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.active || this.wasActive) return;

      // Sonó voz un buen rato y no llegó texto: se avisa y se reinicia la
      // sesión, por si fue un tropiezo. El micrófono sigue encendido.
      const sinTexto = this.lastResult ? Date.now() - this.lastResult : Date.now() - this.desde;
      if (this.sonidoMs > 4000 && sinTexto > 8000) {
        this.sonidoMs = 0;
        this.#avisar('silent');
        this.#reiniciar();
        return;
      }
      // Chrome a veces se queda mudo sin avisar: si pasa un rato largo sin
      // ninguna señal, se reinicia la sesión.
      if (Date.now() - this.lastEvent > 45000) this.#reiniciar();
    }, 2000);
    return true;
  }

  stop() {
    this.active = false;
    this.wasActive = false;
    clearInterval(this.watchdog);
    clearTimeout(this.reintento);
    const rec = this.recognition;
    this.recognition = null;
    try {
      rec?.stop();
    } catch { /* ya estaba detenido */ }
    this.#estado('apagado');
  }

  /** Pausa mientras la IA habla, para que no se escuche a sí misma. */
  pauseForPlayback() {
    if (!this.active) return false;
    this.wasActive = true;
    try {
      this.recognition?.abort();
    } catch { /* nada */ }
    this.#estado('en pausa mientras NOVA habla');
    return true;
  }

  resumeAfterPlayback() {
    const retomar = this.wasActive && this.active;
    this.wasActive = false;
    if (retomar) this.#spinUp();
  }

  /* -------------------------------------------------------------- adentro */

  #estado(texto) {
    if (this.diagnostico === texto) return;
    this.diagnostico = texto;
    this.handlers.onStatus?.(texto);
  }

  /** Avisa una vez por tipo de problema; si se repite, no insiste. */
  #avisar(codigo) {
    if (this.avisado === codigo) return;
    this.avisado = codigo;
    this.handlers.onError?.(ERRORES_RECONOCIMIENTO[codigo] || `Problema con el micrófono: ${codigo}`, codigo);
  }

  /** Se apaga y avisa qué pasó: insistir no serviría. */
  #fallar(codigo) {
    this.active = false;
    this.wasActive = false;
    clearInterval(this.watchdog);
    clearTimeout(this.reintento);
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onend = null;
      try { rec.abort(); } catch { /* nada */ }
    }
    this.#estado(`apagado: ${codigo}`);
    this.handlers.onError?.(ERRORES_RECONOCIMIENTO[codigo] || `Problema con el micrófono: ${codigo}`, codigo);
  }

  /** Corta la sesión actual; onend la vuelve a levantar. */
  #reiniciar() {
    try {
      this.recognition?.abort();
    } catch { /* nada */ }
  }

  #spinUp() {
    if (!this.active) return;

    // Si había una sesión viva, se corta: si no, quedan dos escuchando.
    const previa = this.recognition;
    if (previa) {
      previa.onend = null;
      try { previa.abort(); } catch { /* nada */ }
    }

    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    this.lastEvent = Date.now();

    rec.onstart = () => {
      this.lastEvent = Date.now();
      this.#estado('escuchando');
      this.handlers.onStart?.();
    };

    rec.onaudiostart = () => this.#estado('escuchando, con audio');
    rec.onspeechstart = () => this.#estado('escuchando, detecta voz');

    rec.onresult = (event) => {
      this.lastEvent = this.lastResult = Date.now();
      this.resultados++;
      this.fallos = 0;
      this.sonidoMs = 0;
      this.avisado = '';
      this.#estado('transcribiendo');
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          const clean = text.trim();
          if (clean) this.handlers.onFinal?.(clean);
        } else {
          partial += text;
        }
      }
      if (partial.trim()) this.handlers.onPartial?.(partial.trim());
    };

    rec.onerror = (event) => {
      this.lastEvent = Date.now();
      if (event.error === 'no-speech' || event.error === 'aborted') return; // ruido normal

      if (ERRORES_FATALES.has(event.error)) {
        this.#fallar(event.error);
        return;
      }

      // Red y parecidos: a veces es un tropiezo, a veces el navegador no
      // puede. Se reintenta espaciando, y se avisa al segundo fallo seguido.
      this.fallos++;
      this.#estado(`sin respuesta (${event.error}), reintento ${this.fallos}`);
      if (this.fallos >= 2) this.#avisar(event.error in ERRORES_RECONOCIMIENTO ? event.error : 'network');
    };

    // El motor se corta solo cada tanto; si seguimos activos, lo levantamos.
    rec.onend = () => {
      if (this.recognition !== rec) return; // una sesión vieja: ya hay otra
      this.handlers.onEnd?.();
      if (!this.active || this.wasActive) return;
      const espera = Math.min(15000, 260 * 2 ** Math.min(this.fallos, 6));
      clearTimeout(this.reintento);
      this.reintento = setTimeout(() => this.#spinUp(), espera);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() tira si ya había una sesión viva: se reintenta en onend.
    }
  }
}

/* ------------------------------------------------------------------ hablar */

const STORE_VOZ = 'nova:voz-ajustes';

/** Las voces del sintetizador neuronal de OpenAI, con cómo suenan. */
export const VOCES_OPENAI = [
  ['nova', 'Nova: cálida y clara'],
  ['coral', 'Coral: cercana y expresiva'],
  ['sage', 'Sage: serena y pausada'],
  ['shimmer', 'Shimmer: suave y luminosa'],
  ['alloy', 'Alloy: neutra'],
  ['ash', 'Ash: grave y firme'],
  ['ballad', 'Ballad: tranquila'],
  ['echo', 'Echo: grave y cálida'],
  ['fable', 'Fable: narradora'],
  ['onyx', 'Onyx: profunda'],
];

export const INSTRUCCIONES_VOZ =
  'Hablás en español rioplatense, con acento uruguayo, cálida y clara, como una presencia serena en un escenario frente a familias. ' +
  'Ritmo pausado pero vivo, sin sonar robótica ni exagerada. Pronunciá los nombres propios con naturalidad.';

/**
 * Los ajustes de la voz, guardados en este navegador.
 *   motor         navegador u openai
 *   nombre        la voz del navegador elegida a mano (vacío: la mejor que haya)
 *   velocidad     0.8 a 1.5
 *   claveOpenAI   clave para la voz por API (si está vacía se usa la del asistente)
 *   vozOpenAI     nova, coral, sage...
 *   instrucciones cómo tiene que sonar
 */
export function leerAjustesVoz() {
  let guardado = {};
  try {
    guardado = JSON.parse(localStorage.getItem(STORE_VOZ) || '{}') || {};
  } catch { /* nada guardado */ }
  return {
    motor: guardado.motor === 'openai' ? 'openai' : 'navegador',
    nombre: typeof guardado.nombre === 'string' ? guardado.nombre : '',
    velocidad: Math.min(1.5, Math.max(0.8, Number(guardado.velocidad) || 1)),
    claveOpenAI: typeof guardado.claveOpenAI === 'string' ? guardado.claveOpenAI : '',
    vozOpenAI: VOCES_OPENAI.some(([v]) => v === guardado.vozOpenAI) ? guardado.vozOpenAI : 'nova',
    instrucciones: typeof guardado.instrucciones === 'string' && guardado.instrucciones.trim() ? guardado.instrucciones : INSTRUCCIONES_VOZ,
  };
}

export function guardarAjustesVoz(ajustes) {
  try {
    localStorage.setItem(STORE_VOZ, JSON.stringify(ajustes));
  } catch { /* navegación privada */ }
}

/**
 * Qué tan buena suena una voz del navegador, a ojo: las neuronales de
 * Edge ("Natural"), las de Google en Chrome y las mejoradas de macOS
 * suenan a persona; las locales viejas, a robot. Y mejor rioplatense.
 */
export function puntuarVoz(voz) {
  if (!/^es/i.test(voz.lang)) return -1;
  let puntos = 0;
  const nombre = voz.name || '';
  if (/natural|neural/i.test(nombre)) puntos += 5;
  if (/online/i.test(nombre)) puntos += 1;
  if (/google/i.test(nombre)) puntos += 2.5;
  if (/premium|enhanced|mejorada|siri/i.test(nombre)) puntos += 2.5;
  if (!voz.localService) puntos += 0.5;
  if (/^es[-_]UY/i.test(voz.lang)) puntos += 3;
  else if (/^es[-_]AR/i.test(voz.lang)) puntos += 2.5;
  else if (/^es[-_](MX|US|CL|CO)/i.test(voz.lang)) puntos += 1.5;
  else if (/^es[-_]ES/i.test(voz.lang)) puntos += 1;
  else puntos += 0.5;
  if (/espeak/i.test(nombre)) puntos -= 4;
  return puntos;
}

/** Las voces en español del navegador, de mejor a peor. */
export function vocesDisponibles() {
  if (!voiceSupport.speak) return [];
  return speechSynthesis.getVoices()
    .filter((v) => puntuarVoz(v) >= 0)
    .sort((a, b) => puntuarVoz(b) - puntuarVoz(a));
}

/** La voz del navegador: la Web Speech API, con la mejor voz que haya. */
export class VozNavegador {
  constructor(ajustes) {
    this.ajustes = ajustes;
    this.voice = null;
    this.speaking = false;
    this.abierto = false; // la respuesta sigue llegando: no avisar el fin todavía
    this.onStart = null;
    this.onEnd = null;
    if (voiceSupport.speak) {
      this.elegir();
      speechSynthesis.addEventListener?.('voiceschanged', () => this.elegir());
    }
  }

  get supported() {
    return voiceSupport.speak;
  }

  elegir() {
    const voces = vocesDisponibles();
    this.voice = (this.ajustes.nombre && voces.find((v) => v.name === this.ajustes.nombre)) || voces[0] || null;
  }

  say(clean) {
    if (!this.supported) return;
    const utterance = new SpeechSynthesisUtterance(clean);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice?.lang || 'es-ES';
    utterance.rate = this.ajustes.velocidad;
    utterance.pitch = 1;

    // Chrome a veces no avisa cuando termina de hablar, y el micrófono
    // quedaría pausado para siempre. Pasado un tiempo prudente, se da por
    // terminado igual.
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(limite);
      this.speaking = false;
      // Mientras la respuesta sigue abierta puede venir otro trozo: el fin se
      // avisa recién cuando no queda nada y la respuesta se cerró.
      if (!speechSynthesis.pending && !speechSynthesis.speaking && !this.abierto) this.onEnd?.();
    };
    const limite = setTimeout(() => {
      if (terminado) return;
      if (speechSynthesis.speaking) speechSynthesis.cancel();
      terminar();
    }, clean.length * 120 + 4000);

    utterance.onstart = () => {
      this.speaking = true;
      this.onStart?.();
    };
    utterance.onend = utterance.onerror = terminar;
    speechSynthesis.speak(utterance);
  }

  /** La respuesta terminó de llegar: si ya no hay nada por decir, se avisa el fin. */
  cerrar() {
    if (!this.supported) return;
    if (!speechSynthesis.pending && !speechSynthesis.speaking && !this.speaking) this.onEnd?.();
  }

  cancel() {
    if (!this.supported) return;
    speechSynthesis.cancel();
    this.speaking = false;
  }
}

/**
 * La voz por API: el sintetizador neuronal de OpenAI, en chorro.
 *
 * Cada trozo de texto se pide apenas llega, en paralelo, como audio crudo
 * (PCM de 24 kHz) que va llegando de a pedazos. Los pedazos se encadenan en
 * la línea de tiempo de Web Audio, uno pegado al otro: la voz arranca con
 * el primer pedazo del primer trozo, y entre trozo y trozo no hay silencio.
 *
 * La clave puede estar en el servidor (`npm start`) o en este navegador.
 */
const MUESTRAS_POR_SEGUNDO = 24000;
const MUESTRAS_MINIMAS = 2400; // 100 ms de audio por pedazo programado
export class VozOpenAI {
  /**
   * @param {object} ajustes  los de leerAjustesVoz()
   * @param {() => ('servidor'|'directo'|'ninguno')} modo  de dónde sale la clave
   */
  constructor(ajustes, modo) {
    this.ajustes = ajustes;
    this.modo = modo;
    this.cola = [];          // {promesa, control}
    this.ctx = null;
    this.fuentes = new Set(); // los pedazos programados que todavía no sonaron
    this.siguiente = 0;      // cuándo empieza el próximo pedazo, en el reloj del contexto
    this.speaking = false;
    this.abierto = false;
    this.reproduciendo = false;
    this.finTimer = null;
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
  }

  get supported() {
    return typeof AudioContext !== 'undefined' && this.modo() !== 'ninguno';
  }

  say(clean) {
    if (!this.supported) return;
    const control = new AbortController();
    const promesa = this.#pedir(clean, control.signal);
    promesa.catch(() => {}); // el error se atiende al reproducir; si se cancela antes, no es de nadie
    this.cola.push({ promesa, control });
    this.#reproducir();
  }

  cerrar() {
    this.#revisarFin();
  }

  cancel() {
    for (const item of this.cola) item.control.abort();
    this.cola = [];
    for (const fuente of this.fuentes) {
      try { fuente.stop(); } catch { /* ya paró */ }
    }
    this.fuentes.clear();
    clearTimeout(this.finTimer);
    this.siguiente = 0;
    this.speaking = false;
    this.reproduciendo = false;
  }

  #contexto() {
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async #pedir(texto, signal) {
    const cuerpo = {
      model: 'gpt-4o-mini-tts',
      voice: this.ajustes.vozOpenAI,
      input: texto,
      instructions: this.ajustes.instrucciones,
      response_format: 'pcm',
      speed: this.ajustes.velocidad,
    };
    const modo = this.modo();
    const res = modo === 'servidor'
      ? await fetch('api/voz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal })
      : await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.ajustes.claveOpenAI}` },
        body: JSON.stringify(cuerpo),
        signal,
      });
    if (!res.ok) {
      let detalle = '';
      try { detalle = (await res.json())?.error?.message || (await res.text()); } catch { /* nada */ }
      if (res.status === 401) throw new Error('la API de OpenAI rechazó la clave de la voz');
      throw new Error(`la voz por API respondió ${res.status}${detalle ? `: ${String(detalle).slice(0, 120)}` : ''}`);
    }
    if (!res.body) throw new Error('la voz por API no devolvió audio');
    return res;
  }

  async #reproducir() {
    if (this.reproduciendo) return;
    this.reproduciendo = true;
    while (this.cola.length) {
      const item = this.cola[0];
      let res;
      try {
        res = await item.promesa;
      } catch (err) {
        if (this.cola[0] === item) this.cola.shift();
        if (err.name !== 'AbortError') {
          this.onError?.(err.message);
          this.cancel();
        }
        break;
      }
      if (this.cola[0] !== item) break; // cancelaron mientras llegaba
      this.cola.shift();
      try {
        await this.#tocar(res, item.control.signal);
      } catch (err) {
        if (err.name !== 'AbortError' && !item.control.signal.aborted) {
          this.onError?.(err.message);
          this.cancel();
          break;
        }
      }
    }
    this.reproduciendo = false;
    this.#revisarFin();
  }

  /** Lee el audio crudo a medida que llega y lo va programando, pegado al anterior. */
  async #tocar(res, signal) {
    const lector = res.body.getReader();
    let resto = new Uint8Array(0);
    let juntadas = [];
    let cuantas = 0;
    const soltar = () => {
      if (!cuantas) return;
      const muestras = new Float32Array(cuantas);
      let i = 0;
      for (const parte of juntadas) { muestras.set(parte, i); i += parte.length; }
      juntadas = [];
      cuantas = 0;
      this.#programar(muestras);
    };
    for (;;) {
      const { done, value } = await lector.read();
      if (signal.aborted) { lector.cancel().catch(() => {}); return; }
      if (done) break;
      const bytes = new Uint8Array(resto.length + value.length);
      bytes.set(resto);
      bytes.set(value, resto.length);
      const pares = bytes.length - (bytes.length % 2);
      const vista = new DataView(bytes.buffer, bytes.byteOffset, pares);
      const parte = new Float32Array(pares / 2);
      for (let j = 0; j < parte.length; j++) parte[j] = vista.getInt16(j * 2, true) / 32768;
      resto = bytes.slice(pares);
      juntadas.push(parte);
      cuantas += parte.length;
      if (cuantas >= MUESTRAS_MINIMAS) soltar();
    }
    soltar();
  }

  #programar(muestras) {
    const ctx = this.#contexto();
    const buffer = ctx.createBuffer(1, muestras.length, MUESTRAS_POR_SEGUNDO);
    buffer.copyToChannel(muestras, 0);
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(ctx.destination);
    const ahora = ctx.currentTime;
    // Si el reloj ya pasó el punto de empalme (llegó tarde), se arranca ya,
    // con un margen chico para que el próximo pedazo llegue a tiempo.
    if (this.siguiente < ahora + 0.02) this.siguiente = ahora + (this.speaking ? 0.03 : 0.12);
    fuente.start(this.siguiente);
    this.siguiente += buffer.duration;
    this.fuentes.add(fuente);
    fuente.onended = () => {
      this.fuentes.delete(fuente);
      this.#revisarFin();
    };
    if (!this.speaking) {
      this.speaking = true;
      this.onStart?.();
    }
  }

  /** Avisa el fin cuando no queda nada por pedir, ni por programar, ni por sonar. */
  #revisarFin() {
    clearTimeout(this.finTimer);
    if (!this.speaking || this.reproduciendo || this.cola.length || this.abierto) return;
    const falta = this.ctx ? this.siguiente - this.ctx.currentTime : 0;
    if (falta > 0.03) {
      this.finTimer = setTimeout(() => this.#revisarFin(), falta * 1000 + 40);
      return;
    }
    this.speaking = false;
    this.siguiente = 0;
    this.onEnd?.();
  }
}

/**
 * La voz de NOVA: elige el motor según los ajustes y le pasa las frases.
 * La app habla con esto y no con los motores.
 */
export class Speaker {
  /** @param {(ajustes:object) => ('servidor'|'directo'|'ninguno')} modoOpenAI  de dónde saldría la clave de OpenAI */
  constructor(modoOpenAI = () => 'ninguno') {
    this.enabled = false;
    this.ajustes = leerAjustesVoz();
    this.modoOpenAI = modoOpenAI;
    this.abierto = false;  // una respuesta está llegando de a frases
    this.primera = true;   // todavía no salió el primer trozo de esta respuesta
    this.pendiente = '';   // frases juntadas que esperan formar un trozo
    this.onStart = null;
    this.onEnd = null;
    this.onError = null;
    this.#armar();
  }

  get supported() {
    return this.motor?.supported ?? false;
  }

  get speaking() {
    return this.motor?.speaking ?? false;
  }

  /** Qué motor está hablando de verdad ahora. */
  get motorActual() {
    return this.motor instanceof VozOpenAI ? 'openai' : 'navegador';
  }

  /** De dónde sale la clave ahora, con estos ajustes. */
  get modoApi() {
    return this.modoOpenAI(this.ajustes);
  }

  #armar() {
    this.motor?.cancel?.();
    const modo = () => this.modoOpenAI(this.ajustes);
    const quiereApi = this.ajustes.motor === 'openai' && modo() !== 'ninguno';
    this.motor = quiereApi ? new VozOpenAI(this.ajustes, modo) : new VozNavegador(this.ajustes);
    this.motor.onStart = () => this.onStart?.();
    this.motor.onEnd = () => this.onEnd?.();
    this.motor.onError = (mensaje) => {
      // La API falló: se sigue con la voz del navegador, para que la función
      // no se quede muda, y recién después se avisa.
      this.motor = new VozNavegador(this.ajustes);
      this.motor.onStart = () => this.onStart?.();
      this.motor.onEnd = () => this.onEnd?.();
      this.onError?.(mensaje);
    };
  }

  /** Aplica ajustes nuevos y los guarda. */
  configurar(ajustes) {
    this.ajustes = { ...this.ajustes, ...ajustes };
    guardarAjustesVoz(this.ajustes);
    this.#armar();
  }

  /**
   * Empieza una respuesta que va a llegar de a frases (say). Hasta cerrar()
   * no se avisa el fin, así el micrófono no se prende entre frase y frase.
   */
  abrir() {
    this.abierto = true;
    this.primera = true;
    this.pendiente = '';
    this.motor.abierto = true;
  }

  /**
   * Una frase más de la respuesta. La primera sale enseguida, para que la
   * voz arranque; las siguientes se juntan en trozos más largos, porque cada
   * trozo le cuesta al sintetizador un arranque, y ahí se notan los cortes.
   */
  say(text) {
    if (!this.enabled || !this.supported) return;
    const clean = limpiar(text);
    if (!clean) return;
    if (!this.abierto) return this.decir(clean);
    this.pendiente = this.pendiente ? `${this.pendiente} ${clean}` : clean;
    if (this.primera || this.pendiente.length >= TROZO_LARGO) this.#soltar();
  }

  /** La respuesta terminó de llegar. */
  cerrar() {
    if (!this.abierto) return;
    this.#soltar();
    this.abierto = false;
    this.motor.abierto = false;
    this.motor.cerrar?.();
  }

  /** Dice un texto que ya se conoce entero: se pide todo junto, de una vez. */
  decir(text) {
    if (!this.enabled || !this.supported) return;
    const clean = limpiar(text);
    if (!clean) return;
    this.abrir();
    this.pendiente = clean;
    this.#soltar();
    this.cerrar();
  }

  #soltar() {
    const texto = this.pendiente;
    this.pendiente = '';
    if (!texto) return;
    for (const trozo of trocear(texto, { primeroCorto: this.primera })) this.motor.say(trozo);
    this.primera = false;
  }

  cancel() {
    this.abierto = false;
    this.pendiente = '';
    if (this.motor) this.motor.abierto = false;
    this.motor?.cancel();
    this.onEnd?.();
  }
}

function limpiar(text) {
  return (text || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------- trozos */

const TROZO_LARGO = 170;  // por trozo: menos arranques, y Chrome corta las voces de Google pasados ~15 s
const PRIMERO_LARGO = 90; // el primero, más corto: así la voz arranca antes

/**
 * Corta un texto en trozos para el sintetizador: frases enteras, juntas
 * hasta el largo máximo; una frase muy larga se parte en una coma. Con
 * `primeroCorto`, el primer trozo se acorta para que arranque enseguida.
 */
export function trocear(texto, { primeroCorto = false } = {}) {
  const frases = texto.match(/[^.!?…]+[.!?…]+["»)]?|[^.!?…]+$/g)?.map((f) => f.trim()).filter(Boolean) || [];
  const trozos = [];
  let actual = '';
  const cerrarTrozo = () => { if (actual) trozos.push(actual); actual = ''; };
  for (const frase of frases) {
    const max = primeroCorto && !trozos.length ? PRIMERO_LARGO : TROZO_LARGO;
    for (const parte of partir(frase, max)) {
      if (actual && actual.length + 1 + parte.length > max) cerrarTrozo();
      actual = actual ? `${actual} ${parte}` : parte;
      if (actual.length >= max * 0.8) cerrarTrozo();
    }
  }
  cerrarTrozo();
  return trozos;
}

/** Parte una frase más larga que `max` en comas (o espacios si no hay). */
function partir(frase, max) {
  if (frase.length <= max) return [frase];
  const partes = [];
  let resto = frase;
  while (resto.length > max) {
    const ventana = resto.slice(0, max);
    let corte = Math.max(ventana.lastIndexOf(', '), ventana.lastIndexOf('; '), ventana.lastIndexOf(': '));
    if (corte < max * 0.4) corte = ventana.lastIndexOf(' ');
    if (corte < 1) corte = max;
    partes.push(resto.slice(0, corte + 1).trim());
    resto = resto.slice(corte + 1).trim();
  }
  if (resto) partes.push(resto);
  return partes;
}

/**
 * Corta el texto en frases para que la voz arranque antes de que
 * termine de llegar toda la respuesta.
 */
export function makeSentenceSplitter(onSentence) {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      let match;
      while ((match = /[^.!?…\n]*[.!?…\n]+/.exec(buffer))) {
        const sentence = match[0].trim();
        buffer = buffer.slice(match[0].length);
        if (sentence.length > 1) onSentence(sentence);
      }
    },
    flush() {
      const rest = buffer.trim();
      buffer = '';
      if (rest) onSentence(rest);
    },
    reset() {
      buffer = '';
    },
  };
}
