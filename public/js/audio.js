/**
 * Nivel de voz en tiempo real.
 *
 * Abre el micrófono con Web Audio y mide cuánto suena en cada instante.
 * Ese número mueve el orbe, las barras y la nube: es lo que hace que el
 * público entienda, sin que nadie se lo explique, que la IA está
 * escuchando a esa persona y no a cualquiera.
 *
 * Corre en paralelo al reconocimiento de voz, que usa el micrófono por su
 * cuenta. Si el navegador no deja abrirlo dos veces, esto se apaga solo y
 * la página sigue funcionando igual.
 */

export class VoiceMeter {
  constructor() {
    this.level = 0;        // 0 a 1, suavizado: lo que se anima
    this.peak = 0;         // pico reciente, para los golpes de voz
    this.active = false;
    this.stream = null;
    this.context = null;
    this.analyser = null;
    this.data = null;
    this.frame = null;
    this.onLevel = null;
  }

  get supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
  }

  /** @returns {Promise<boolean>} si quedó midiendo */
  async start() {
    if (this.active || !this.supported) return this.active;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      return false; // sin permiso, o el micrófono ya está tomado
    }

    const Context = window.AudioContext || window.webkitAudioContext;
    this.context = new Context();
    // Algunos navegadores lo abren suspendido hasta que hay un gesto.
    if (this.context.state === 'suspended') await this.context.resume().catch(() => {});

    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.75;
    source.connect(this.analyser);

    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.active = true;
    this.#loop();
    return true;
  }

  stop() {
    this.active = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.context?.close().catch(() => {});
    this.stream = this.context = this.analyser = this.data = null;
    this.level = this.peak = 0;
    this.onLevel?.(0);
  }

  #loop() {
    const tick = () => {
      if (!this.active) return;
      this.analyser.getByteFrequencyData(this.data);

      // Solo la banda donde vive la voz humana: así el zumbido del
      // proyector o el aire acondicionado no mueven nada.
      const desde = 2;
      const hasta = Math.min(this.data.length, 90);
      let suma = 0;
      for (let i = desde; i < hasta; i++) suma += this.data[i];
      const crudo = suma / (hasta - desde) / 255;

      // Curva para que hablar normal ya se note, sin saturar en un grito.
      const objetivo = Math.min(1, Math.pow(crudo * 2.6, 0.7));

      // Sube rápido y baja lento: los visuales acompañan la voz sin temblar.
      this.level += (objetivo - this.level) * (objetivo > this.level ? 0.45 : 0.09);
      this.peak = Math.max(this.peak * 0.94, this.level);

      this.onLevel?.(this.level, this.peak);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }
}
