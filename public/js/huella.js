/**
 * La huella de un parlamento: un código corto que sale del texto, el mismo
 * en el navegador y en la herramienta que graba. Con ella, una grabación se
 * encuentra por lo que dice, no por el número de línea: si el guion se
 * reordena o se le agrega una línea, las grabaciones siguen sirviendo. Si
 * se cambia una palabra, la huella cambia y hay que volver a grabar esa.
 */

/** El texto como se compara: espacios normalizados, sin marcas de formato. */
export function textoParaHuella(texto) {
  return String(texto || '').replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim();
}

/** FNV-1a de 32 bits, dos veces con semillas distintas: 16 caracteres hex. */
export function huella(texto) {
  const limpio = textoParaHuella(texto);
  return `${fnv(limpio, 0x811c9dc5)}${fnv(limpio, 0x01000193)}`;
}

function fnv(texto, semilla) {
  let h = semilla >>> 0;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
