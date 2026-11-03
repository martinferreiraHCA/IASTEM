/**
 * Entrega un texto ya escrito de a palabras, con el ritmo de alguien que
 * piensa mientras habla. Así los parlamentos del guion se ven formarse en
 * la pantalla igual que si NOVA los estuviera pensando.
 */

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {string} texto
 * @param {(delta:string) => void} onDelta   se llama con cada fragmento
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} el texto completo
 */
export async function gotear(texto, onDelta, signal, { duracion = 0 } = {}) {
  const trozos = texto.match(/\S+\s*/g) || [texto];
  let todo = '';

  // Si se sabe cuánto dura la voz (una grabación), las palabras caen a su
  // ritmo y el texto termina de formarse poco antes de que termine de sonar.
  const paso = duracion > 0
    ? Math.min(450, Math.max(12, (duracion * 1000 * 0.9 - 140) / trozos.length))
    : 0;

  await pausa(140); // un respiro, como quien toma aire

  for (const trozo of trozos) {
    if (signal?.aborted) throw interrumpido();
    todo += trozo;
    onDelta(trozo);
    await pausa(paso ? paso * (0.7 + Math.random() * 0.6) : 12 + Math.random() * 22);
  }
  return todo;
}

function interrumpido() {
  const error = new Error('Interrumpido');
  error.name = 'AbortError';
  return error;
}
