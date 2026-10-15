/**
 * IASTEM — servidor mínimo (sin dependencias).
 *
 * Hace tres cosas:
 *   1. Sirve los archivos estáticos de /public: el escenario y el panel.
 *   2. Releva mensajes entre las páginas conectadas, para que el panel de
 *      control se pueda abrir desde otra computadora o un celular de la
 *      misma red. No guarda nada ni entiende los mensajes: lo que llega por
 *      POST /api/control sale por GET /api/eventos a todos los demás.
 *   3. Si hay una clave en .env, atiende POST /api/ubicar (le pregunta a una
 *      IA a qué pie del guion corresponde lo que se oyó) y POST /api/conversar
 *      (lo mismo, pero si no es un pie, la IA improvisa como NOVA y la
 *      respuesta se reenvía en streaming). La clave vive acá y el navegador
 *      nunca la ve.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
// El asistente de ubicación habla con Claude si hay clave de Anthropic, y
// si no con OpenAI. Las claves viven acá y el navegador nunca las ve.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const ASISTENTE = ANTHROPIC_KEY ? 'anthropic' : OPENAI_KEY ? 'openai' : '';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 256 * 1024; // un estado completo con un guion largo pesa menos

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Las páginas que están escuchando ahora. */
const oyentes = new Set();

/** El último estado que contó el escenario, para dárselo a un panel que recién llega. */
let ultimoEstado = null;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health') {
      return sendJson(res, 200, { ok: true, control: true, asistente: ASISTENTE || false, voz: Boolean(OPENAI_KEY), direcciones: direcciones() });
    }

    if (url.pathname === '/api/eventos') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'Usá GET.' });
      return suscribir(req, res);
    }

    if (url.pathname === '/api/control') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usá POST.' });
      return await relevar(req, res);
    }

    if (url.pathname === '/api/ubicar') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usá POST.' });
      return await ubicar(req, res);
    }

    if (url.pathname === '/api/conversar') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usá POST.' });
      return await conversar(req, res);
    }

    if (url.pathname === '/api/voz') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usá POST.' });
      return await voz(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Método no permitido.' });
    }

    return await serveStatic(url.pathname, res);
  } catch (err) {
    console.error('Error no controlado:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Error interno del servidor.' });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\n  NOVA escuchando en http://localhost:${PORT}`);
  console.log('  Escenario:         http://localhost:%d/', PORT);
  for (const ip of direcciones()) {
    console.log('  Panel de control:  http://%s:%d/control.html', ip, PORT);
  }
  console.log('  (el panel se abre desde cualquier dispositivo de la misma red)');
  console.log({
    anthropic: `  Asistente de ubicación: activo con Claude (${ANTHROPIC_MODEL}).\n`,
    openai: `  Asistente de ubicación: activo con OpenAI (${OPENAI_MODEL}).\n`,
    '': '  Asistente de ubicación: apagado. Para prenderlo, poné ANTHROPIC_API_KEY u OPENAI_API_KEY en .env.\n',
  }[ASISTENTE]);
});

/* --------------------------------------------------------------- ubicar */

// El módulo del navegador arma la pregunta; se usa el mismo acá para que
// los dos caminos pregunten exactamente igual. Es ES, se carga una vez.
let arbitro = null;
const cargarArbitro = () => (arbitro ||= import('./public/js/arbitro.js'));

async function ubicar(req, res) {
  if (!ASISTENTE) return sendJson(res, 503, { error: 'El servidor no tiene clave: el asistente está apagado.' });

  let datos;
  try {
    datos = JSON.parse((await readBody(req)).toString('utf8'));
    if (typeof datos.oido !== 'string' || !Array.isArray(datos.pies)) throw new Error('Faltan datos.');
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'JSON inválido.' });
  }

  const { INSTRUCCION, armarPregunta, cuerpoAnthropic, leerAnthropic, extraerJson, validar, pedirAnthropic } = await cargarArbitro();
  const pies = datos.pies.slice(0, 200).map((p) => ({
    indice: Number(p.indice),
    pie: String(p.pie || '').slice(0, 300),
    parlamento: String(p.parlamento || '').slice(0, 80),
  }));
  const pregunta = { oido: datos.oido.slice(0, 1000), cursor: Number(datos.cursor), pies };

  let crudo = {};
  try {
    if (ASISTENTE === 'anthropic') {
      const upstream = await pedirAnthropic(`${ANTHROPIC_URL}/v1/messages`, cuerpoAnthropic(pregunta, ANTHROPIC_MODEL), ANTHROPIC_KEY, { signal: AbortSignal.timeout(8000) });
      crudo = leerAnthropic(await upstream.json());
    } else {
      const upstream = await fetch(`${OPENAI_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          temperature: 0,
          max_tokens: 60,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: INSTRUCCION },
            { role: 'user', content: armarPregunta(pregunta) },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        throw new Error(upstream.status === 401 ? 'la API rechazó la clave (401): revisá la clave en .env' : `la API respondió ${upstream.status}: ${detail.slice(0, 200)}`);
      }
      crudo = extraerJson((await upstream.json()).choices?.[0]?.message?.content || '');
    }
  } catch (err) {
    console.error('Ubicar falló:', err.message);
    return sendJson(res, 502, { error: err.message });
  }
  return sendJson(res, 200, validar(crudo, Math.max(...pies.map((p) => p.indice), -1) + 1));
}

/**
 * Conversar: la misma consulta que en el navegador, pero con la clave de
 * acá. La respuesta de la API llega en streaming y se reenvía igual, un
 * evento por pedazo de texto, para que las letras arranquen enseguida.
 */
async function conversar(req, res) {
  if (!ASISTENTE) return sendJson(res, 503, { error: 'El servidor no tiene clave: el asistente está apagado.' });

  let datos;
  try {
    datos = JSON.parse((await readBody(req)).toString('utf8'));
    if (typeof datos.oido !== 'string' || !Array.isArray(datos.pies)) throw new Error('Faltan datos.');
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'JSON inválido.' });
  }

  const { cuerpoConversarAnthropic, cuerpoConversarOpenAI, consumirSSE, sacarAnthropic, sacarOpenAI, pedirAnthropic } = await cargarArbitro();
  const pregunta = {
    oido: datos.oido.slice(0, 1000),
    cursor: Number(datos.cursor),
    pies: datos.pies.slice(0, 200).map((p) => ({
      indice: Number(p.indice),
      pie: String(p.pie || '').slice(0, 300),
      parlamento: String(p.parlamento || '').slice(0, 600),
    })),
    historial: Array.isArray(datos.historial) ? datos.historial.slice(-16) : [],
    personalidad: String(datos.personalidad || '').slice(0, 2000),
  };

  const control = new AbortController();
  req.on('close', () => control.abort());

  let upstream;
  let sacar;
  try {
    if (ASISTENTE === 'anthropic') {
      upstream = await pedirAnthropic(`${ANTHROPIC_URL}/v1/messages`, cuerpoConversarAnthropic(pregunta, ANTHROPIC_MODEL), ANTHROPIC_KEY, { signal: control.signal });
      sacar = sacarAnthropic;
    } else {
      upstream = await fetch(`${OPENAI_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify(cuerpoConversarOpenAI(pregunta, OPENAI_MODEL)),
        signal: control.signal,
      });
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        throw new Error(upstream.status === 401 ? 'la API rechazó la clave (401): revisá la clave en .env' : `la API respondió ${upstream.status}: ${detail.slice(0, 200)}`);
      }
      sacar = sacarOpenAI;
    }
  } catch (err) {
    if (control.signal.aborted) return;
    console.error('Conversar falló:', err.message);
    return sendJson(res, 502, { error: err.message });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    await consumirSSE(upstream, sacar, (delta) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
    });
    if (!res.writableEnded) {
      res.write('event: done\ndata: {}\n\n');
      res.end();
    }
  } catch (err) {
    if (control.signal.aborted) return;
    console.error('Se cortó la respuesta:', err.message);
    if (!res.writableEnded) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Se interrumpió la respuesta.' })}\n\n`);
      res.end();
    }
  }
}

/**
 * La voz por API: una frase entra como texto y sale como audio, con el
 * sintetizador neuronal de OpenAI y la clave del .env.
 */
async function voz(req, res) {
  if (!OPENAI_KEY) return sendJson(res, 503, { error: 'El servidor no tiene clave de OpenAI: la voz por API está apagada.' });

  let datos;
  try {
    datos = JSON.parse((await readBody(req)).toString('utf8'));
    if (typeof datos.input !== 'string' || !datos.input.trim()) throw new Error('Falta el texto.');
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'JSON inválido.' });
  }

  const upstream = await fetch(`${OPENAI_URL}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: typeof datos.model === 'string' && datos.model ? datos.model.slice(0, 60) : 'gpt-4o-mini-tts',
      voice: String(datos.voice || 'nova').slice(0, 30),
      input: datos.input.slice(0, 4000),
      instructions: String(datos.instructions || '').slice(0, 2000),
      response_format: 'mp3',
      speed: Math.min(1.5, Math.max(0.7, Number(datos.speed) || 1)),
    }),
    signal: AbortSignal.timeout(20000),
  }).catch((err) => {
    console.error('No se pudo contactar la API de voz:', err.message);
    return null;
  });

  if (!upstream) return sendJson(res, 502, { error: 'No se pudo contactar la API de voz. ¿Hay internet?' });
  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`La API de voz respondió ${upstream.status}:`, detail.slice(0, 300));
    return sendJson(res, upstream.status, {
      error: upstream.status === 401 ? 'La API rechazó la clave (401). Revisá OPENAI_API_KEY en .env.' : `La API de voz respondió ${upstream.status}.`,
    });
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
  res.end(audio);
}

/* ------------------------------------------------------------------ relevo */

function suscribir(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': hola\n\n');
  oyentes.add(res);

  // Un panel que recién se conecta recibe el último estado sin pedirlo.
  if (ultimoEstado) res.write(`data: ${ultimoEstado}\n\n`);

  // Algunos proxies cortan conexiones calladas: un latido cada tanto.
  const latido = setInterval(() => res.write(': latido\n\n'), 25000);
  req.on('close', () => {
    clearInterval(latido);
    oyentes.delete(res);
  });
}

async function relevar(req, res) {
  let cuerpo;
  try {
    cuerpo = (await readBody(req)).toString('utf8');
    const mensaje = JSON.parse(cuerpo);
    if (!mensaje || typeof mensaje !== 'object') throw new Error('No es un mensaje.');
    if (mensaje.tipo === 'estado') ultimoEstado = cuerpo;
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'JSON inválido.' });
  }

  for (const oyente of oyentes) {
    try {
      oyente.write(`data: ${cuerpo}\n\n`);
    } catch {
      oyentes.delete(oyente);
    }
  }
  sendJson(res, 200, { ok: true, oyentes: oyentes.size });
}

/** Las direcciones de esta máquina en la red, para abrir el panel desde el celular. */
function direcciones() {
  const lista = [];
  for (const redes of Object.values(os.networkInterfaces())) {
    for (const red of redes || []) {
      if (red.family === 'IPv4' && !red.internal) lista.push(red.address);
    }
  }
  return lista;
}

/* ---------------------------------------------------------------- static */

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);

  // Nada de salirse de /public con ../
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    return sendJson(res, 403, { error: 'Prohibido.' });
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return serveStatic(path.posix.join(pathname, 'index.html'), res);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    return fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('404 — no encontrado');
  }
}

/* --------------------------------------------------------------- helpers */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('El mensaje es demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Lector de .env mínimo, para no depender de dotenv. */
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    const key = match[1];
    let value = (match[2] || '').trim();
    if (/^(['"]).*\1$/s.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
