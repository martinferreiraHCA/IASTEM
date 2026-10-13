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

export class Speaker {
  constructor() {
    this.enabled = false;
    this.voice = null;
    this.queue = [];
    this.speaking = false;
    this.onStart = null;
    this.onEnd = null;

    if (voiceSupport.speak) {
      const pick = () => (this.voice = pickSpanishVoice());
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  get supported() {
    return voiceSupport.speak;
  }

  /** Habla una frase. Se encola para respetar el orden de llegada. */
  say(text) {
    if (!this.enabled || !this.supported) return;
    const clean = (text || '').replace(/[*_#`]/g, '').trim();
    if (!clean) return;

    const utterance = new SpeechSynthesisUtterance(clean);
    if (this.voice) utterance.voice = this.voice;
    utterance.lang = this.voice?.lang || 'es-ES';
    utterance.rate = 1.02;
    utterance.pitch = 1.05;

    // Chrome a veces no avisa cuando termina de hablar, y el micrófono
    // quedaría pausado para siempre. Pasado un tiempo prudente, se da por
    // terminado igual.
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(limite);
      this.speaking = false;
      if (!speechSynthesis.pending && !speechSynthesis.speaking) this.onEnd?.();
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

  cancel() {
    if (!this.supported) return;
    speechSynthesis.cancel();
    this.speaking = false;
    this.onEnd?.();
  }
}

function pickSpanishVoice() {
  const voices = speechSynthesis.getVoices();
  if (!voices.length) return null;
  return (
    voices.find((v) => /^es-(AR|UY|MX|US)/i.test(v.lang)) ||
    voices.find((v) => /^es/i.test(v.lang)) ||
    null
  );
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
