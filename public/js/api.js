/**
 * Capa de conexión: de dónde salen las respuestas de NOVA.
 *
 * La página funciona en tres situaciones distintas y elige sola cuál le toca:
 *
 *   servidor  Hay un servidor Node adelante (npm start). La clave vive allá
 *             y el navegador nunca la ve. Es la opción más segura.
 *   directo   Sitio estático (GitHub Pages) con una clave guardada en este
 *             navegador. Se le habla a OpenAI sin intermediarios.
 *   demo      No hay ni servidor ni clave: contesta el guion local. Es lo que
 *             ve cualquiera que abra el sitio publicado.
 */

import { pickDemoReply } from '../demo/engine.js';

const STORE_KEY = 'nova:openai-key';
const STORE_MODEL = 'nova:modelo';
const STORE_PROMPT = 'nova:personalidad';

export const DEFAULT_MODEL = 'gpt-4o-mini';
export const DEFAULT_PROMPT =
  'Sos NOVA, una inteligencia artificial conversacional que está siendo proyectada ' +
  'en una pantalla gigante frente a un grupo. Respondes en español rioplatense, con ' +
  'claridad y calidez. Sos breve: dos o tres frases, salvo que te pidan más detalle.';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// El build standalone deja el guion acá, para no depender de un fetch.
let demoScript = globalThis.NOVA_DEMO_SCRIPT || null;

/* ------------------------------------------------- lo que se guarda acá */

export const settings = {
  get key() {
    return read(STORE_KEY) || '';
  },
  set key(value) {
    value ? write(STORE_KEY, value.trim()) : remove(STORE_KEY);
  },
  get model() {
    return read(STORE_MODEL) || DEFAULT_MODEL;
  },
  set model(value) {
    write(STORE_MODEL, (value || '').trim() || DEFAULT_MODEL);
  },
  get prompt() {
    return read(STORE_PROMPT) || DEFAULT_PROMPT;
  },
  set prompt(value) {
    write(STORE_PROMPT, (value || '').trim() || DEFAULT_PROMPT);
  },
};

function read(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null; // navegación privada, o cookies bloqueadas
  }
}
function write(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch { /* si no se puede guardar, se usa solo en esta sesión */ }
}
function remove(k) {
  try {
    localStorage.removeItem(k);
  } catch { /* nada que hacer */ }
}

/* ------------------------------------------------------- qué modo corre */

/**
 * Averigua con qué se está trabajando. Se vuelve a llamar cada vez que
 * alguien cambia la configuración.
 * @returns {Promise<{mode:'server'|'direct'|'demo', model:string, detail:string}>}
 */
export async function detectMode() {
  // La versión publicada como página suelta no puede llamar a OpenAI: queda en demo.
  if (globalThis.NOVA_SOLO_DEMO) {
    return { mode: 'demo', model: 'demo', detail: 'Página de demostración.' };
  }

  const server = await pingServer();
  if (server && server.configured) {
    return { mode: 'server', model: server.model, detail: 'La clave está en el servidor.' };
  }
  if (settings.key) {
    return { mode: 'direct', model: settings.model, detail: 'Usando la clave guardada en este navegador.' };
  }
  return {
    mode: 'demo',
    model: 'demo',
    detail: server
      ? 'El servidor está corriendo sin clave.'
      : 'Sitio estático sin clave configurada.',
  };
}

async function pingServer() {
  // Abierto como archivo suelto no hay servidor que preguntar, y el intento
  // ensucia la consola con un error que no significa nada.
  if (location.protocol === 'file:') return null;

  try {
    const res = await fetch('api/health', { cache: 'no-store' });
    if (!res.ok) return null;
    const info = await res.json();
    return info && info.ok ? info : null;
  } catch {
    return null; // en GitHub Pages no hay servidor: es lo esperado
  }
}

/* -------------------------------------------------------------- enviar */

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {(delta:string) => void} onDelta   se llama con cada fragmento
 * @param {object} opts
 * @param {'server'|'direct'|'demo'} opts.mode
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} el texto completo
 */
export function streamChat(messages, onDelta, { mode, signal } = {}) {
  if (mode === 'server') return streamFromServer(messages, onDelta, signal);
  if (mode === 'direct') return streamFromOpenAI(messages, onDelta, signal);
  return streamFromDemo(messages, onDelta, signal);
}

async function streamFromServer(messages, onDelta, signal) {
  const res = await fetch('api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new Error(info.error || `El servidor respondió ${res.status}.`);
  }
  return consume(res, onDelta, unwrapServerEvent);
}

async function streamFromOpenAI(messages, onDelta, signal) {
  let res;
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.key}`,
      },
      body: JSON.stringify({
        model: settings.model,
        stream: true,
        temperature: 0.8,
        messages: [{ role: 'system', content: settings.prompt }, ...messages],
      }),
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('No se pudo contactar a OpenAI. Revisá la conexión a internet.');
  }

  if (!res.ok) throw new Error(await describeOpenAIError(res));
  return consume(res, onDelta, unwrapOpenAIEvent);
}

async function describeOpenAIError(res) {
  const detail = await res.text().catch(() => '');
  let message = '';
  try {
    message = JSON.parse(detail)?.error?.message || '';
  } catch { /* la respuesta no era JSON */ }

  if (res.status === 401) return 'OpenAI rechazó la clave. Revisala en Conexión.';
  if (res.status === 429) {
    return message.includes('quota')
      ? 'La cuenta de OpenAI no tiene crédito disponible.'
      : 'Demasiados pedidos seguidos. Esperá unos segundos.';
  }
  if (res.status === 404) return `El modelo "${settings.model}" no existe o tu cuenta no tiene acceso.`;
  return message ? `OpenAI respondió ${res.status}: ${message}` : `OpenAI respondió ${res.status}.`;
}

/** El guion local, con el mismo goteo que tendría una respuesta real. */
async function streamFromDemo(messages, onDelta, signal) {
  if (!demoScript) {
    demoScript = await fetch('demo/replies.json').then((r) => r.json());
  }

  const reply = pickDemoReply(messages, demoScript);
  const chunks = reply.match(/\S+\s*/g) || [reply];
  let full = '';

  await pause(380); // el "pensando" inicial

  for (const chunk of chunks) {
    if (signal?.aborted) throw abortError();
    full += chunk;
    onDelta(chunk);
    await pause(26 + Math.random() * 34);
  }
  return full;
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function abortError() {
  const error = new Error('Interrumpido');
  error.name = 'AbortError';
  return error;
}

/* ------------------------------------------- lectura del stream (SSE) */

/**
 * Recorre una respuesta en streaming y entrega los fragmentos.
 * Las dos fuentes hablan SSE; solo cambia la forma de cada evento.
 */
async function consume(res, onDelta, unwrap) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const parsed = unwrap(rawEvent);
      if (parsed === DONE) return full;
      if (parsed) {
        full += parsed;
        onDelta(parsed);
      }
    }
  }
  return full;
}

const DONE = Symbol('done');

function splitEvent(rawEvent) {
  let name = 'message';
  let data = '';
  for (const line of rawEvent.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  return { name, data };
}

function unwrapServerEvent(rawEvent) {
  const { name, data } = splitEvent(rawEvent);
  if (!data) return null;
  if (name === 'error') throw new Error(JSON.parse(data).error || 'Se interrumpió la respuesta.');
  if (name === 'done') return DONE;
  return JSON.parse(data).delta || null;
}

function unwrapOpenAIEvent(rawEvent) {
  const { data } = splitEvent(rawEvent);
  if (!data) return null;
  if (data === '[DONE]') return DONE;
  try {
    return JSON.parse(data).choices?.[0]?.delta?.content || null;
  } catch {
    return null; // fragmento partido o keep-alive
  }
}
