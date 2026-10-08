/**
 * Voz: dictado y habla.
 *
 * Para escuchar hay dos caminos, con la misma interfaz:
 *
 *   Listener          La Web Speech API del navegador. Transcribe en vivo,
 *                     con resultados parciales. Anda bien en Google Chrome y
 *                     Edge; en Chromium, Brave u Opera existe pero falla con
 *                     "network", y en Firefox directamente no está.
 *   RecorderListener  Graba con el micrófono, corta cuando la persona hace
 *                     una pausa y manda el audio a transcribir por la API.
 *                     Anda en cualquier navegador, pero necesita una clave.
 *
 * Para hablar se usa la síntesis del navegador.
 */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupport = {
  listen: Boolean(Recognition),
  record: Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder),
  speak: 'speechSynthesis' in window,
};

/** Qué le decimos a la persona según lo que falló. */
const ERRORES_RECONOCIMIENTO = {
  'not-allowed': 'El navegador bloqueó el micrófono. Tocá el candado de la barra de direcciones, permití el micrófono y probá de nuevo.',
  'service-not-allowed': 'Este navegador no deja usar su reconocimiento de voz. Probá con Google Chrome o Edge, o cargá una clave en Conexión para transcribir por la API.',
  'audio-capture': 'No se encontró ningún micrófono. Revisá que esté conectado y elegido en el sistema.',
  network: 'El reconocimiento de voz de este navegador no responde. Pasa en Chromium, Brave u Opera, o sin internet. Con Google Chrome o Edge anda; también se puede transcribir por la API desde Conexión.',
  'language-not-supported': 'Este navegador no reconoce español. Probá con Google Chrome o Edge.',
  silent: 'El micrófono capta sonido, pero el reconocimiento de voz de este navegador no transcribe nada. Pasa en Chromium, Brave u Opera. Con Google Chrome o Edge anda; con una clave en Conexión se transcribe por la API.',
};

export class Listener {
  /**
   * @param {object} handlers
   * @param {(text:string) => void} handlers.onPartial   texto provisorio
   * @param {(text:string) => void} handlers.onFinal     frase cerrada
   * @param {(msg:string, code?:string) => void} [handlers.onError]
   * @param {() => void} [handlers.onStart]
   * @param {() => void} [handlers.onEnd]
   * @param {(msg:string) => void} [handlers.onStatus]  qué está pasando, para el cartelito
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.nombre = 'navegador';
    this.active = false;      // lo que el usuario pidió
    this.busy = false;        // el navegador transcribe en vivo: nunca hay nada pendiente
    this.silenceMs = 1400;    // pausa que la app toma como "terminó de hablar"
    this.lang = 'es-UY';
    this.recognition = null;
    this.stream = null;
    this.lastEvent = 0;
    this.watchdog = null;
    this.resultados = 0;      // cuántas veces devolvió texto, en toda su vida
    this.sonidoMs = 0;        // cuánto sonido captó el medidor sin que llegara texto
    this.ultimoSonido = 0;
    this.desde = 0;
  }

  get supported() {
    return voiceSupport.listen;
  }

  /**
   * El medidor de volumen le cuenta cuánto suena. Si hay voz durante varios
   * segundos y el reconocimiento no devuelve nada, es que no funciona: en
   * Chromium, Brave u Opera arranca sin quejarse y nunca transcribe.
   */
  noteSound(nivel) {
    if (!this.active || this.resultados) return;
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
    this.#spinUp();

    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => {
      if (!this.active || this.wasActive) return;

      // Sonó voz un buen rato y nunca llegó texto: el reconocimiento está muerto.
      if (!this.resultados && this.sonidoMs > 3000 && Date.now() - this.desde > 6000) {
        this.#fallar('silent');
        return;
      }
      // Chrome a veces se queda mudo sin avisar: si pasa un rato largo sin
      // ninguna señal, se reinicia la sesión.
      if (Date.now() - this.lastEvent > 60000) {
        try { this.recognition?.abort(); } catch { /* nada */ }
      }
    }, 2000);
    return true;
  }

  /** Se apaga y avisa qué pasó: insistir no serviría. */
  #fallar(codigo) {
    this.active = false;
    this.wasActive = false;
    clearInterval(this.watchdog);
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onend = null;
      try { rec.abort(); } catch { /* nada */ }
    }
    this.handlers.onError?.(ERRORES_RECONOCIMIENTO[codigo] || `Problema con el micrófono: ${codigo}`, codigo);
  }

  stop() {
    this.active = false;
    this.wasActive = false;
    clearInterval(this.watchdog);
    const rec = this.recognition;
    this.recognition = null;
    try {
      rec?.stop();
    } catch { /* ya estaba detenido */ }
  }

  /** Pausa mientras la IA habla, para que no se escuche a sí misma. */
  pauseForPlayback() {
    if (!this.active) return false;
    this.wasActive = true;
    try {
      this.recognition?.abort();
    } catch { /* nada */ }
    return true;
  }

  resumeAfterPlayback() {
    const retomar = this.wasActive && this.active;
    this.wasActive = false;
    if (retomar) this.#spinUp();
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
      this.handlers.onStart?.();
    };

    rec.onresult = (event) => {
      this.lastEvent = Date.now();
      this.resultados++;
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

      // Si no acepta el español rioplatense, se insiste con el genérico.
      if (event.error === 'language-not-supported' && this.lang !== 'es-ES') {
        this.lang = 'es-ES';
        return;
      }

      if (event.error in ERRORES_RECONOCIMIENTO) {
        this.#fallar(event.error);
        return;
      }
      this.handlers.onError?.(`Problema con el micrófono: ${event.error}`, event.error);
    };

    // El motor se corta solo cada tanto; si seguimos activos, lo levantamos.
    rec.onend = () => {
      if (this.recognition !== rec) return; // una sesión vieja: ya hay otra
      this.handlers.onEnd?.();
      if (this.active && !this.wasActive) setTimeout(() => this.#spinUp(), 260);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      // start() tira si ya había una sesión viva: se reintenta en onend.
    }
  }
}

/* --------------------------------------------------- grabar y transcribir */

/** Formatos de grabación que la API acepta, en orden de preferencia. */
const FORMATOS_GRABACION = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/**
 * Escucha grabando: detecta cuándo alguien habla, corta en la pausa y manda
 * ese tramo a transcribir. No hay texto parcial, pero funciona en cualquier
 * navegador y con el vocabulario de la función como ayuda.
 */
export class RecorderListener {
  /**
   * @param {object} handlers  los mismos que Listener
   * @param {(blob:Blob) => Promise<string>} transcribir  manda el audio y devuelve el texto
   */
  constructor(handlers = {}, transcribir) {
    this.handlers = handlers;
    this.transcribir = transcribir;
    this.nombre = 'API';
    this.active = false;
    this.silenceMs = 400;     // la pausa ya se esperó al grabar; esto es solo margen
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.recorder = null;
    this.timer = null;
    this.pendientes = 0;      // transcripciones en vuelo
    this.hablando = false;
    this.pausado = false;
    this.mime = FORMATOS_GRABACION.find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || '';
  }

  get supported() {
    return voiceSupport.record;
  }

  /** Hay una frase a medio grabar o a medio transcribir: todavía no conviene mandar. */
  get busy() {
    return this.active && (this.hablando || this.pendientes > 0);
  }

  /** @returns {Promise<boolean>} si quedó escuchando */
  async start() {
    if (this.active) return true;
    if (!this.supported) {
      this.handlers.onError?.('Este navegador no puede grabar audio.', 'unsupported');
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      const mensaje = err?.name === 'NotFoundError'
        ? ERRORES_RECONOCIMIENTO['audio-capture']
        : ERRORES_RECONOCIMIENTO['not-allowed'];
      this.handlers.onError?.(mensaje, 'not-allowed');
      return false;
    }

    const Context = window.AudioContext || window.webkitAudioContext;
    this.context = new Context();
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.stream).connect(this.analyser);

    this.active = true;
    this.pausado = false;
    this.#grabar();
    this.#vigilar();
    this.handlers.onStart?.();
    return true;
  }

  stop() {
    this.active = false;
    this.pausado = false;
    this.#cortar({ descartar: true });
    clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close().catch(() => {});
    this.stream = this.context = this.analyser = null;
    this.handlers.onEnd?.();
  }

  pauseForPlayback() {
    if (!this.active) return false;
    this.pausado = true;
    this.#cortar({ descartar: true });
    return true;
  }

  resumeAfterPlayback() {
    if (!this.active || !this.pausado) return;
    this.pausado = false;
    this.#grabar();
  }

  /* -------------------------------------------------------------- adentro */

  #grabar() {
    if (!this.active || this.pausado || !this.stream) return;
    this.hablando = false;
    this.desde = Date.now();
    this.ultimaVoz = 0;
    this.primeraVoz = 0;

    // Cada grabación junta sus propios fragmentos: el último llega después
    // de stop(), cuando la siguiente grabación ya puede haber arrancado.
    const chunks = [];
    const recorder = new MediaRecorder(this.stream, this.mime ? { mimeType: this.mime } : undefined);
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      if (recorder.enviar && chunks.length) this.#enviar(new Blob(chunks, { type: recorder.mimeType || this.mime }));
    };
    recorder.enviar = false;
    this.recorder = recorder;
    recorder.start(250);
  }

  /** Cierra el tramo que se está grabando: lo manda o lo tira. */
  #cortar({ descartar }) {
    const recorder = this.recorder;
    this.recorder = null;
    this.hablando = false;
    if (!recorder) return;
    recorder.enviar = !descartar;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch { /* ya estaba parado */ }
  }

  /**
   * Mide el volumen cada pocos milisegundos y decide cuándo empieza y
   * termina una frase. El piso de ruido se aprende solo, así el zumbido de
   * la sala no cuenta como voz.
   */
  #vigilar() {
    const muestras = new Float32Array(this.analyser.fftSize);
    let piso = 0.004;
    const PAUSA_MS = 1000;   // silencio que cierra la frase
    const MINIMO_MS = 350;   // menos que esto es un ruido, no una frase
    const MAXIMO_MS = 25000; // una frase más larga se corta y se sigue
    const OCIOSO_MS = 12000; // sin voz tanto tiempo, se tira lo grabado

    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (!this.active || this.pausado || !this.analyser) return;

      this.analyser.getFloatTimeDomainData(muestras);
      let suma = 0;
      for (let i = 0; i < muestras.length; i++) suma += muestras[i] * muestras[i];
      const rms = Math.sqrt(suma / muestras.length);

      const ahora = Date.now();
      const umbral = Math.max(0.012, piso * 3);
      if (rms > umbral) {
        if (!this.hablando) {
          this.hablando = true;
          this.primeraVoz = ahora;
          this.handlers.onStatus?.('Escuchando…');
        }
        this.ultimaVoz = ahora;
      } else {
        piso = piso * 0.98 + rms * 0.02; // el piso se adapta solo en los silencios
      }

      if (!this.recorder) return;

      if (this.hablando) {
        const callado = ahora - this.ultimaVoz;
        const largo = ahora - this.primeraVoz;
        if (callado >= PAUSA_MS || largo >= MAXIMO_MS) {
          const vale = largo - Math.min(callado, PAUSA_MS) >= MINIMO_MS;
          this.#cortar({ descartar: !vale });
          this.#grabar();
        }
      } else if (ahora - this.desde >= OCIOSO_MS) {
        // Sin que nadie hable, se renueva la grabación para no mandar minutos de silencio.
        this.#cortar({ descartar: true });
        this.#grabar();
      }
    }, 60);
  }

  async #enviar(blob) {
    this.pendientes++;
    this.handlers.onStatus?.('Transcribiendo…');
    try {
      const texto = (await this.transcribir(blob)).trim();
      if (texto && this.active) this.handlers.onFinal?.(texto);
    } catch (err) {
      this.handlers.onError?.(err.message || 'No se pudo transcribir el audio.', 'transcribe');
    } finally {
      this.pendientes--;
      if (this.active) this.handlers.onStatus?.('');
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
