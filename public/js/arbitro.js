/**
 * El asistente de ubicación: una IA que decide en qué pie del guion estamos.
 *
 * No escribe lo que dice NOVA, eso sale siempre del guion. Solo contesta
 * una pregunta: "alguien dijo esto, ¿a cuál de estos pies corresponde?".
 * Entiende paráfrasis y errores del reconocimiento de voz mucho mejor que
 * el parecido de palabras, así que la función se traba menos.
 *
 * Es opcional. Funciona con cualquier API compatible con la de OpenAI, y
 * la clave puede vivir en dos lugares:
 *
 *   servidor  En el .env de la computadora que corre `npm start`. El
 *             navegador nunca la ve. Es lo más seguro.
 *   directo   En este navegador, cargada desde el panel del guion. Sirve
 *             para el sitio publicado, que no tiene servidor.
 */

const STORE_CLAVE = 'nova:asistente-clave';
const STORE_MODELO = 'nova:asistente-modelo';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MODELO_POR_DEFECTO = 'gpt-4o-mini';
const ESPERA_MS = 4000; // más que esto y la función se nota trabada

/** Lo que se le pide. Devuelve JSON, nada más. */
export const INSTRUCCION =
  'Sos el apuntador de una obra en la que una inteligencia artificial, NOVA, conversa con estudiantes siguiendo un guion. ' +
  'Te doy los pies del guion numerados (lo que dice un estudiante antes de cada parlamento de NOVA), ' +
  'cuál fue el último parlamento dicho, y lo que acaba de decir alguien, transcripto por reconocimiento de voz, que puede tener errores. ' +
  'Decidí a qué pie corresponde. El pie que sigue al último dicho es el más probable, pero pueden saltearse o repetir. ' +
  'Aceptá paráfrasis, sinónimos y errores de transcripción. Si no corresponde con claridad a ninguno, contestá null. ' +
  'Respondé únicamente con JSON así: {"indice": número o null, "confianza": número entre 0 y 1}.';

export class Arbitro {
  constructor() {
    this.modo = 'ninguno'; // ninguno, servidor o directo
  }

  get clave() {
    return leer(STORE_CLAVE) || '';
  }

  set clave(valor) {
    const limpio = (valor || '').trim();
    limpio ? guardar(STORE_CLAVE, limpio) : borrar(STORE_CLAVE);
  }

  get modelo() {
    return leer(STORE_MODELO) || MODELO_POR_DEFECTO;
  }

  set modelo(valor) {
    const limpio = (valor || '').trim();
    limpio && limpio !== MODELO_POR_DEFECTO ? guardar(STORE_MODELO, limpio) : borrar(STORE_MODELO);
  }

  get disponible() {
    return this.modo !== 'ninguno';
  }

  /** Averigua si hay con qué: una clave acá, o un servidor que la tenga. */
  async detectar() {
    if (this.clave) {
      this.modo = 'directo';
      return this.modo;
    }
    this.modo = 'ninguno';
    if (location.protocol === 'file:') return this.modo;
    try {
      const res = await fetch('api/health', { cache: 'no-store' });
      if (res.ok && (await res.json()).asistente) this.modo = 'servidor';
    } catch { /* sin servidor */ }
    return this.modo;
  }

  /**
   * @param {{oido:string, cursor:number, entradas:Array<{indice:number, pies:string[], parlamento:string}>}} datos
   * @returns {Promise<{indice:number|null, confianza:number, error?:string}>}
   */
  async ubicar({ oido, cursor, entradas }) {
    const pies = entradas
      .filter((e) => e.pies.length)
      .map((e) => ({ indice: e.indice, pie: e.pies.at(-1), parlamento: e.parlamento.slice(0, 80) }));
    if (!pies.length) return { indice: null, confianza: 0 };

    const control = new AbortController();
    const limite = setTimeout(() => control.abort(), ESPERA_MS);
    try {
      const veredicto = this.modo === 'servidor'
        ? await porServidor({ oido, cursor, pies }, control.signal)
        : await porOpenAI({ oido, cursor, pies }, this.clave, this.modelo, control.signal);
      return validar(veredicto, entradas.length);
    } catch (err) {
      return { indice: null, confianza: 0, error: err.name === 'AbortError' ? 'tardó demasiado' : err.message };
    } finally {
      clearTimeout(limite);
    }
  }
}

/** Arma lo que se le cuenta. Lo usan el navegador y el servidor por igual. */
export function armarPregunta({ oido, cursor, pies }) {
  const lista = pies
    .map((p) => `${p.indice}. PIE: «${p.pie}»  →  NOVA: «${p.parlamento}…»`)
    .join('\n');
  return (
    `Pies del guion:\n${lista}\n\n` +
    `Último parlamento dicho: ${cursor >= 0 ? cursor : 'ninguno todavía'}.\n` +
    `Se oyó: «${oido}»`
  );
}

/** Deja el veredicto en algo que se pueda usar, venga como venga. */
export function validar(crudo, total) {
  const indice = Number.isInteger(crudo?.indice) && crudo.indice >= 0 && crudo.indice < total ? crudo.indice : null;
  const confianza = Math.max(0, Math.min(1, Number(crudo?.confianza) || 0));
  return { indice, confianza: indice === null ? 0 : confianza };
}

async function porServidor(datos, signal) {
  const res = await fetch('api/ubicar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
    signal,
  });
  const info = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(info.error || `el servidor respondió ${res.status}`);
  return info;
}

async function porOpenAI(datos, clave, modelo, signal) {
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        max_tokens: 60,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: INSTRUCCION },
          { role: 'user', content: armarPregunta(datos) },
        ],
      }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('no se pudo contactar a la API');
  }
  if (res.status === 401) throw new Error('la API rechazó la clave');
  if (!res.ok) throw new Error(`la API respondió ${res.status}`);
  const info = await res.json();
  return JSON.parse(info.choices?.[0]?.message?.content || '{}');
}

function leer(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function guardar(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch { /* navegación privada */ }
}
function borrar(k) {
  try {
    localStorage.removeItem(k);
  } catch { /* nada */ }
}
