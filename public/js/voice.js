/**
 * Voz: dictado y habla, sobre la Web Speech API del navegador.
 *
 * El reconocimiento corre en modo continuo con resultados parciales, así el
 * público ve las palabras formándose mientras alguien habla. Chrome y Edge
 * lo soportan bien; Firefox todavía no.
 */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const voiceSupport = {
  listen: Boolean(Recognition),
  speak: 'speechSynthesis' in window,
};

export class Listener {
  /**
   * @param {object} handlers
   * @param {(text:string) => void} handlers.onPartial   texto provisorio
   * @param {(text:string) => void} handlers.onFinal     frase cerrada
   * @param {(msg:string) => void} [handlers.onError]
   * @param {() => void} [handlers.onStart]
   * @param {() => void} [handlers.onEnd]
   */
  constructor(handlers = {}) {
    this.handlers = handlers;
    this.active = false;      // lo que el usuario pidió
    this.lang = 'es-ES';
    this.recognition = null;
  }

  get supported() {
    return voiceSupport.listen;
  }

  start() {
    if (!this.supported || this.active) return;
    this.active = true;
    this.#spinUp();
  }

  stop() {
    this.active = false;
    try {
      this.recognition?.stop();
    } catch { /* ya estaba detenido */ }
  }

  toggle() {
    this.active ? this.stop() : this.start();
    return this.active;
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
    if (this.wasActive && this.active) this.#spinUp();
    this.wasActive = false;
  }

  #spinUp() {
    if (!this.active) return;

    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => this.handlers.onStart?.();

    rec.onresult = (event) => {
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
      if (event.error === 'no-speech' || event.error === 'aborted') return; // ruido normal
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.active = false;
        this.handlers.onError?.('El navegador bloqueó el micrófono. Habilitá el permiso y probá de nuevo.');
        return;
      }
      this.handlers.onError?.(`Problema con el micrófono: ${event.error}`);
    };

    // El motor se corta solo cada tanto; si seguimos activos, lo levantamos.
    rec.onend = () => {
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

    utterance.onstart = () => {
      this.speaking = true;
      this.onStart?.();
    };
    utterance.onend = utterance.onerror = () => {
      this.speaking = false;
      if (!speechSynthesis.pending && !speechSynthesis.speaking) this.onEnd?.();
    };

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
