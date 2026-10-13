/**
 * El asistente: una IA que decide en qué pie del guion estamos y, si se
 * le pide, conversa cuando lo que se oye no está en el guion.
 *
 * Tiene dos usos, que se eligen en su panel:
 *
 *   ubicar     Solo contesta "alguien dijo esto, ¿a cuál de estos pies
 *              corresponde?". Lo que NOVA dice sale siempre del guion.
 *   conversar  Lo mismo, pero si no corresponde a ningún pie, improvisa
 *              como NOVA: breve, en el espíritu del guion, siguiendo la
 *              conversación. Una sola consulta decide las dos cosas, y la
 *              respuesta llega de a pedazos para que las letras arranquen
 *              enseguida.
 *
 * Entiende paráfrasis y errores del reconocimiento de voz mucho mejor que
 * el parecido de palabras, así que la función se traba menos.
 *
 * Es opcional. Funciona con la API de Claude (Anthropic) o con la de
 * OpenAI, y la clave puede vivir en dos lugares:
 *
 *   servidor  En el .env de la computadora que corre `npm start`. El
 *             navegador nunca la ve. Es lo más seguro.
 *   directo   En este navegador, cargada desde el panel del guion. Sirve
 *             para el sitio publicado, que no tiene servidor.
 */

const STORE_CLAVE = 'nova:asistente-clave';
const STORE_MODELO = 'nova:asistente-modelo';
const STORE_PROVEEDOR = 'nova:asistente-proveedor';
const STORE_USO = 'nova:asistente-uso';
const STORE_PERSONALIDAD = 'nova:personalidad';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ESPERA_MS = 4000; // más que esto y la función se nota trabada

/** Con quién se puede hablar, y qué modelo usa cada uno si no se dice otro. */
export const PROVEEDORES = {
  anthropic: { nombre: 'Claude (Anthropic)', modelo: 'claude-opus-5-5', pista: 'sk-ant-…' },
  openai: { nombre: 'OpenAI', modelo: 'gpt-4o-mini', pista: 'sk-…' },
};

/** Qué puede hacer el asistente. */
export const USOS = ['ubicar', 'conversar'];

/** Quién es NOVA cuando improvisa. Se puede cambiar desde su panel. */
export const PERSONALIDAD =
  'Sos NOVA, una inteligencia artificial de escenario en una muestra del instituto IASTEM, en Uruguay. ' +
  'Conversás con estudiantes frente a un público de familias, proyectada en una pantalla gigante. ' +
  'Hablás en español rioplatense, con calidez y claridad, para que lo entienda cualquiera. ' +
  'Sos breve: dos o tres frases, salvo que te pidan más. No inventás datos: si no sabés, lo decís.';

/** Lo que se le pide. Devuelve JSON, nada más. */
export const INSTRUCCION =
  'Sos el apuntador de una obra en la que una inteligencia artificial, NOVA, conversa con estudiantes siguiendo un guion. ' +
  'Te doy los pies del guion numerados (lo que dice un estudiante antes de cada parlamento de NOVA), ' +
  'cuál fue el último parlamento dicho, y lo que acaba de decir alguien, transcripto por reconocimiento de voz, que puede tener errores. ' +
  'Decidí a qué pie corresponde. El pie que sigue al último dicho es el más probable, pero pueden saltearse o repetir. ' +
  'Aceptá paráfrasis, sinónimos y errores de transcripción. Si no corresponde con claridad a ninguno, contestá null. ' +
  'Respondé únicamente con JSON así: {"indice": número o null, "confianza": número entre 0 y 1}.';

/**
 * Las reglas para conversar: primero fijarse si lo dicho es un pie del
 * guion, y recién si no, improvisar. La marca "#n" es lo que permite
 * decidir con una sola consulta y en streaming.
 */
export function instruccionConversar(personalidad) {
  return (
    `${personalidad.trim()}\n\n` +
    'La función sigue un guion, que tenés abajo: pies numerados (lo que dice un estudiante) y lo que NOVA responde a cada uno. ' +
    'Cada vez que alguien habla, decidí primero si corresponde con claridad a uno de los pies: aceptá paráfrasis, sinónimos y errores de transcripción, ' +
    'y tené en cuenta que el pie que sigue al último dicho es el más probable, aunque pueden saltearse o repetir. ' +
    'Si corresponde a un pie, respondé ÚNICAMENTE con el numeral y su número, por ejemplo #3, sin ninguna palabra más: NOVA va a decir el parlamento del guion. ' +
    'Si no corresponde a ninguno, respondé vos como NOVA, en el espíritu del guion y sin contradecirlo, siguiendo el hilo de la conversación, ' +
    'y si viene al caso encaminá hacia lo que sigue en el guion. Nunca uses el numeral al empezar una respuesta improvisada.'
  );
}

/** El guion, como texto para el sistema. Va aparte para que se pueda cachear. */
export function guionComoTexto(pies) {
  return `Guion de la función:\n${pies
    .map((p) => `${p.indice}. PIE: «${p.pie}»  →  NOVA: «${p.parlamento}»`)
    .join('\n')}`;
}

export class Arbitro {
  constructor() {
    this.modo = 'ninguno'; // ninguno, servidor o directo
    this.conQuien = '';    // con qué API habla el servidor, cuando es el servidor
  }

  get clave() {
    return leer(STORE_CLAVE) || '';
  }

  set clave(valor) {
    const limpio = (valor || '').trim();
    limpio ? guardar(STORE_CLAVE, limpio) : borrar(STORE_CLAVE);
  }

  get proveedor() {
    const guardado = leer(STORE_PROVEEDOR);
    return guardado in PROVEEDORES ? guardado : 'anthropic';
  }

  set proveedor(valor) {
    valor in PROVEEDORES ? guardar(STORE_PROVEEDOR, valor) : borrar(STORE_PROVEEDOR);
  }

  get uso() {
    const guardado = leer(STORE_USO);
    return USOS.includes(guardado) ? guardado : 'conversar';
  }

  set uso(valor) {
    USOS.includes(valor) ? guardar(STORE_USO, valor) : borrar(STORE_USO);
  }

  get personalidad() {
    return leer(STORE_PERSONALIDAD) || PERSONALIDAD;
  }

  set personalidad(valor) {
    const limpio = (valor || '').trim();
    limpio && limpio !== PERSONALIDAD ? guardar(STORE_PERSONALIDAD, limpio) : borrar(STORE_PERSONALIDAD);
  }

  /** Conversa, además de ubicar. */
  get conversa() {
    return this.disponible && this.uso === 'conversar';
  }

  get modelo() {
    return leer(STORE_MODELO) || PROVEEDORES[this.proveedor].modelo;
  }

  set modelo(valor) {
    const limpio = (valor || '').trim();
    limpio && limpio !== PROVEEDORES[this.proveedor].modelo ? guardar(STORE_MODELO, limpio) : borrar(STORE_MODELO);
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
      const info = res.ok ? await res.json() : null;
      if (info?.asistente) {
        this.modo = 'servidor';
        this.conQuien = PROVEEDORES[info.asistente]?.nombre || String(info.asistente);
      }
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
      const datos = { oido, cursor, pies };
      const veredicto = this.modo === 'servidor'
        ? await porServidor(datos, control.signal)
        : this.proveedor === 'anthropic'
          ? await porAnthropic(datos, this.clave, this.modelo, control.signal)
          : await porOpenAI(datos, this.clave, this.modelo, control.signal);
      return validar(veredicto, entradas.length);
    } catch (err) {
      return { indice: null, confianza: 0, error: err.name === 'AbortError' ? 'tardó demasiado' : err.message };
    } finally {
      clearTimeout(limite);
    }
  }

  /**
   * Una sola consulta: si lo oído es un pie, devuelve su índice; si no, la
   * respuesta improvisada llega de a pedazos por onDelta y se devuelve entera.
   *
   * @param {{oido:string, cursor:number, entradas:Array, historial:Array<{role:string, content:string}>}} datos
   * @param {(delta:string) => void} onDelta
   * @param {AbortSignal} [signal]
   * @returns {Promise<{indice:number|null, texto:string, error?:string}>}
   */
  async conversar({ oido, cursor, entradas, historial }, onDelta, signal) {
    const pies = entradas
      .filter((e) => e.pies.length)
      .map((e) => ({ indice: e.indice, pie: e.pies.at(-1), parlamento: e.parlamento }));
    const datos = { oido, cursor, pies, historial: historial.slice(-16), personalidad: this.personalidad };

    const control = new AbortController();
    const soltar = () => control.abort();
    signal?.addEventListener('abort', soltar);
    const limite = setTimeout(soltar, 25000);

    // Lo primero que llega decide: "#n" es un pie, cualquier otra cosa es
    // NOVA hablando. Hasta saberlo, se guarda; después, se deja pasar.
    let buffer = '';
    let decidido = null; // 'indice' o 'texto'
    let indice = null;
    const recibir = (delta) => {
      if (decidido === 'texto') return onDelta(delta);
      if (decidido === 'indice') return;
      buffer += delta;
      const marca = /^\s*#\s*(\d+)(?:\D|$)/.exec(buffer);
      if (marca && (/\D/.test(buffer.slice(marca[0].length - 1)) || buffer.trim().length > marca[0].length)) {
        decidido = 'indice';
        indice = Number(marca[1]);
        control.abort(); // el resto no hace falta
        return;
      }
      if (/^\s*#?\s*\d*$/.test(buffer)) return; // todavía puede ser un numeral
      decidido = 'texto';
      onDelta(buffer);
    };

    try {
      const texto = this.modo === 'servidor'
        ? await conversarPorServidor(datos, recibir, control.signal)
        : this.proveedor === 'anthropic'
          ? await conversarPorAnthropic(datos, this.clave, this.modelo, recibir, control.signal)
          : await conversarPorOpenAI(datos, this.clave, this.modelo, recibir, control.signal);
      if (decidido === 'indice') return { ...validar({ indice, confianza: 1 }, entradas.length), texto: '' };
      if (decidido === null && buffer.trim()) {
        // Terminó sin que se decidiera: o era solo el numeral, o texto cortito.
        const solo = /^\s*#\s*(\d+)\s*$/.exec(buffer);
        if (solo) return { ...validar({ indice: Number(solo[1]), confianza: 1 }, entradas.length), texto: '' };
        onDelta(buffer);
      }
      return { indice: null, texto: (decidido === 'texto' ? texto : buffer).trim() };
    } catch (err) {
      if (decidido === 'indice') return { ...validar({ indice, confianza: 1 }, entradas.length), texto: '' };
      if (signal?.aborted) throw err;
      const error = err.name === 'AbortError' ? 'tardó demasiado' : err.message;
      return { indice: null, texto: '', error };
    } finally {
      clearTimeout(limite);
      signal?.removeEventListener('abort', soltar);
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

/**
 * El veredicto llega como texto con JSON adentro, a veces entre comillas de
 * código. Se saca el primer objeto que haya; si no hay, es "ninguno".
 */
export function extraerJson(texto) {
  const match = /\{[\s\S]*?\}/.exec(String(texto || ''));
  if (!match) return {};
  try {
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
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

/**
 * Lo que se le manda a la API de Claude. Lo usan el navegador y el
 * servidor por igual, así los dos preguntan exactamente lo mismo.
 * Opus 5.5 piensa siempre; con esfuerzo bajo contesta rápido, que es lo
 * que importa en escena. `fallbacks` hace que, si un filtro de seguridad
 * rechazara el pedido, lo atienda otro modelo en la misma llamada.
 */
export function cuerpoAnthropic(datos, modelo) {
  return {
    model: modelo,
    max_tokens: 256,
    system: INSTRUCCION,
    messages: [{ role: 'user', content: armarPregunta(datos) }],
    output_config: { effort: 'low' },
    fallbacks: 'default',
  };
}

/**
 * El pedido de conversación a Claude, en streaming. El guion va en un
 * bloque aparte del sistema, con caché: es lo que más pesa y no cambia.
 */
export function cuerpoConversarAnthropic(datos, modelo) {
  return {
    model: modelo,
    max_tokens: 400,
    stream: true,
    system: [
      { type: 'text', text: instruccionConversar(datos.personalidad || PERSONALIDAD) },
      { type: 'text', text: guionComoTexto(datos.pies), cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      ...sanearHistorial(datos.historial),
      { role: 'user', content: `Último parlamento del guion dicho: ${datos.cursor >= 0 ? datos.cursor : 'ninguno todavía'}.\nSe oyó: «${datos.oido}»` },
    ],
    output_config: { effort: 'low' },
    fallbacks: 'default',
  };
}

/** El mismo pedido, para una API compatible con la de OpenAI. */
export function cuerpoConversarOpenAI(datos, modelo) {
  return {
    model: modelo,
    stream: true,
    temperature: 0.7,
    max_tokens: 400,
    messages: [
      { role: 'system', content: `${instruccionConversar(datos.personalidad || PERSONALIDAD)}\n\n${guionComoTexto(datos.pies)}` },
      ...sanearHistorial(datos.historial),
      { role: 'user', content: `Último parlamento del guion dicho: ${datos.cursor >= 0 ? datos.cursor : 'ninguno todavía'}.\nSe oyó: «${datos.oido}»` },
    ],
  };
}

/** Solo turnos de persona y de NOVA, con texto, y empezando por la persona. */
export function sanearHistorial(historial) {
  const limpio = (historial || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }))
    .slice(-16);
  while (limpio.length && limpio[0].role !== 'user') limpio.shift();
  return limpio;
}

/**
 * Recorre una respuesta en streaming (eventos SSE) y entrega el texto de
 * cada evento que lo traiga. `sacar` dice, para cada evento, qué texto hay.
 */
export async function consumirSSE(res, sacar, onDelta) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let todo = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let corte;
    while ((corte = buffer.indexOf('\n\n')) !== -1) {
      const crudo = buffer.slice(0, corte);
      buffer = buffer.slice(corte + 2);
      let nombre = 'message';
      let data = '';
      for (const linea of crudo.split('\n')) {
        if (linea.startsWith('event:')) nombre = linea.slice(6).trim();
        else if (linea.startsWith('data:')) data += linea.slice(5).trim();
      }
      if (!data) continue;
      const texto = sacar(nombre, data);
      if (texto === FIN) return todo;
      if (texto) {
        todo += texto;
        onDelta(texto);
      }
    }
  }
  return todo;
}

export const FIN = Symbol('fin');

/** Qué texto trae cada evento del streaming de Claude. */
export function sacarAnthropic(nombre, data) {
  if (nombre === 'message_stop') return FIN;
  if (nombre === 'error') {
    let detalle = '';
    try { detalle = JSON.parse(data).error?.message || ''; } catch { /* nada */ }
    throw new Error(detalle || 'la API de Claude cortó la respuesta');
  }
  if (nombre !== 'content_block_delta') return null;
  try {
    const delta = JSON.parse(data).delta;
    return delta?.type === 'text_delta' ? delta.text : null;
  } catch {
    return null;
  }
}

/** Qué texto trae cada evento del streaming de OpenAI. */
export function sacarOpenAI(nombre, data) {
  if (data === '[DONE]') return FIN;
  try {
    return JSON.parse(data).choices?.[0]?.delta?.content || null;
  } catch {
    return null;
  }
}

async function conversarPorServidor(datos, onDelta, signal) {
  const res = await fetch('api/conversar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
    signal,
  });
  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new Error(info.error || `el servidor respondió ${res.status}`);
  }
  return consumirSSE(res, (nombre, data) => {
    if (nombre === 'done') return FIN;
    if (nombre === 'error') throw new Error(JSON.parse(data).error || 'se cortó la respuesta');
    return JSON.parse(data).delta || null;
  }, onDelta);
}

/**
 * Los parámetros opcionales del pedido a Claude: el respaldo automático y
 * el esfuerzo. Si la cuenta no los acepta (un 400 que los nombra), se
 * vuelve a pedir sin ellos y se recuerda para la próxima.
 */
let anthropicSinExtras = false;

export function cuerpoMinimoAnthropic(cuerpo) {
  const { fallbacks, output_config: _config, ...resto } = cuerpo;
  return resto;
}

export function cabecerasAnthropic(clave, { navegador = false, extras = true } = {}) {
  const h = { 'Content-Type': 'application/json', 'x-api-key': clave, 'anthropic-version': '2023-06-01' };
  if (extras) h['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  if (navegador) h['anthropic-dangerous-direct-browser-access'] = 'true'; // sin esto la API no acepta pedidos desde un navegador
  return h;
}

/** Qué le decimos a la persona cuando la API de Claude contesta con error. */
export async function describirErrorAnthropic(res) {
  let detalle = '';
  try {
    detalle = (await res.json())?.error?.message || '';
  } catch { /* sin cuerpo */ }
  if (res.status === 401) return 'la API de Claude rechazó la clave';
  if (res.status === 404) return `la API de Claude no encuentra el modelo${detalle ? ` (${detalle})` : ''}`;
  if (res.status === 429) return 'la API de Claude está limitando los pedidos: esperá un momento';
  if (res.status === 400) return `la API de Claude rechazó el pedido${detalle ? `: ${detalle}` : ''}`;
  return `la API de Claude respondió ${res.status}${detalle ? `: ${detalle}` : ''}`;
}

/** ¿El 400 se queja de algo que podemos sacar? */
function culpaDeLosExtras(mensaje) {
  return /fallback|output_config|effort|beta|unexpected|unknown|not (?:a )?(?:valid|supported)|extra/i.test(mensaje || '');
}

/**
 * Manda un pedido a Claude. Primero con todo; si un 400 culpa a los
 * extras, de nuevo sin ellos. Devuelve la respuesta ya aceptada.
 */
export async function pedirAnthropic(url, cuerpo, clave, { navegador = false, signal } = {}) {
  const intento = async (extras) => {
    try {
      return await fetch(url, {
        method: 'POST',
        headers: cabecerasAnthropic(clave, { navegador, extras }),
        body: JSON.stringify(extras ? cuerpo : cuerpoMinimoAnthropic(cuerpo)),
        signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      throw new Error('no se pudo contactar a la API de Claude');
    }
  };

  let res = await intento(!anthropicSinExtras);
  if (res.status === 400 && !anthropicSinExtras) {
    const mensaje = await res.clone().json().then((j) => j?.error?.message || '').catch(() => '');
    if (culpaDeLosExtras(mensaje) || !mensaje) {
      anthropicSinExtras = true;
      res = await intento(false);
    }
  }
  if (!res.ok) throw new Error(await describirErrorAnthropic(res));
  return res;
}

async function conversarPorAnthropic(datos, clave, modelo, onDelta, signal) {
  const res = await pedirAnthropic(ANTHROPIC_URL, cuerpoConversarAnthropic(datos, modelo), clave, { navegador: true, signal });
  return consumirSSE(res, sacarAnthropic, onDelta);
}

async function conversarPorOpenAI(datos, clave, modelo, onDelta, signal) {
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${clave}` },
      body: JSON.stringify(cuerpoConversarOpenAI(datos, modelo)),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('no se pudo contactar a la API');
  }
  if (res.status === 401) throw new Error('la API rechazó la clave');
  if (!res.ok) throw new Error(`la API respondió ${res.status}`);
  return consumirSSE(res, sacarOpenAI, onDelta);
}

/** Saca el texto de una respuesta de la API de Claude; sin texto, no hay veredicto. */
export function leerAnthropic(info) {
  if (info?.stop_reason === 'refusal') return {};
  const texto = (info?.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return extraerJson(texto);
}

async function porAnthropic(datos, clave, modelo, signal) {
  const res = await pedirAnthropic(ANTHROPIC_URL, cuerpoAnthropic(datos, modelo), clave, { navegador: true, signal });
  return leerAnthropic(await res.json());
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
  return extraerJson(info.choices?.[0]?.message?.content || '');
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
