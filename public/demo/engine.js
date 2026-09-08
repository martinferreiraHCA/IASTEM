/**
 * Motor del modo demo: elige qué contesta NOVA cuando no hay API key.
 *
 * Lo usan las tres versiones: el navegador lo importa, el servidor local lo
 * carga con import(), y el build de la demo lo pega dentro del HTML.
 *
 * El package.json de esta carpeta existe solo para que Node lo lea como
 * módulo ES: el del proyecto declara commonjs. Al navegador le da igual.
 */

/** Compara ignorando acentos y mayúsculas: "energía" y "energia" son iguales. */
export function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * ¿El texto menciona esta palabra o frase?
 * Compara por palabra entera: así "ia" no matchea dentro de "energia".
 */
export function mentions(haystack, needle) {
  const escaped = normalize(needle)
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+');
  if (!escaped) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'u').test(haystack);
}

/**
 * @param {Array<{role:string, content:string}>} messages  la conversación
 * @param {object} script  el contenido de replies.json
 * @returns {string} lo que NOVA contesta
 */
export function pickDemoReply(messages, script) {
  const question = normalize(messages.at(-1)?.content);
  const isFirst = messages.filter((m) => m.role === 'user').length === 1;

  // Gana la coincidencia más específica, no la primera de la lista: si alguien
  // pregunta "cómo funciona un robot", pesa más "robot" que "funciona".
  let best = null;
  let bestScore = 0;
  for (const entry of script.scripted) {
    for (const needle of entry.match) {
      if (needle.length > bestScore && mentions(question, needle)) {
        best = entry;
        bestScore = needle.length;
      }
    }
  }
  if (best) return best.reply;

  // Al arrancar la charla, NOVA se presenta antes que nada.
  if (isFirst) return script.greeting;

  const options = script.fallback;
  return options[(Math.random() * options.length) | 0];
}
