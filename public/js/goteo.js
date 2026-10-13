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
export async function gotear(texto, onDelta, signal) {
  const trozos = texto.match(/\S+\s*/g) || [texto];
  let todo = '';

  await pausa(140); // un respiro, como quien toma aire

  for (const trozo of trozos) {
    if (signal?.aborted) throw interrumpido();
    todo += trozo;
    onDelta(trozo);
    await pausa(12 + Math.random() * 22);
  }
  return todo;
}

function interrumpido() {
  const error = new Error('Interrumpido');
  error.name = 'AbortError';
  return error;
}
