/**
 * IASTEM — servidor mínimo (sin dependencias).
 *
 * Hace dos cosas:
 *   1. Sirve los archivos estáticos de /public
 *   2. Expone POST /api/chat, que reenvía la conversación a la API de
 *      ChatGPT y devuelve la respuesta en streaming (SSE).
 *
 * La API key vive solo acá, en el servidor. El navegador nunca la ve.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const API_KEY = process.env.OPENAI_API_KEY || '';
const BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SYSTEM_PROMPT =
  process.env.SYSTEM_PROMPT ||
  'Sos NOVA, una inteligencia artificial conversacional. Respondes en español rioplatense, ' +
    'con claridad y calidez. Sos concisa salvo que te pidan detalle.';

const DEMO = !API_KEY || process.env.DEMO === '1';
const DEMO_SCRIPT = require('./public/demo/replies.json');

// El motor vive en public/ para que el sitio estático también lo use.
// Es un módulo ES, así que se carga una sola vez, cuando hace falta.
let demoEngine = null;
const loadDemoEngine = () => (demoEngine ||= import('./public/demo/engine.js'));

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const MAX_MESSAGES = 40;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health') return sendJson(res, 200, {
      ok: true,
      configured: Boolean(API_KEY),
      demo: DEMO,
      model: DEMO ? 'demo' : MODEL,
    });

    if (url.pathname === '/api/chat') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Usá POST.' });
      return await handleChat(req, res);
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
  console.log(`\n  IASTEM escuchando en http://localhost:${PORT}`);
  if (DEMO) {
    console.log('  Modo demo: respuestas guionadas, sin API key.');
    console.log('  Para conectar ChatGPT de verdad: cp .env.example .env y completá OPENAI_API_KEY.\n');
  } else {
    console.log(`  Modelo: ${MODEL}`);
    console.log('  ✓ API key detectada.\n');
  }
});

/* ------------------------------------------------------------------ chat */

async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { error: err.message || 'JSON inválido.' });
  }

  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) return sendJson(res, 400, { error: 'Hace falta al menos un mensaje.' });

  if (DEMO) return await streamDemo(res, messages);

  const upstream = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      temperature: 0.8,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
    }),
  }).catch((err) => {
    console.error('No se pudo contactar la API:', err);
    return null;
  });

  if (!upstream) {
    return sendJson(res, 502, { error: 'No se pudo contactar la API. ¿Hay conexión a internet?' });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    console.error(`La API respondió ${upstream.status}:`, detail.slice(0, 500));
    return sendJson(res, upstream.status, { error: describeUpstreamError(upstream.status, detail) });
  }

  // A partir de acá respondemos en streaming: un evento SSE por fragmento.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const aborted = () => res.writableEnded || res.destroyed;
  req.on('close', () => upstream.body?.cancel?.().catch(() => {}));

  let buffer = '';
  try {
    for await (const chunk of upstream.body) {
      if (aborted()) return;
      buffer += Buffer.from(chunk).toString('utf8');

      // Los eventos SSE llegan separados por línea en blanco.
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === '[DONE]') {
            res.write('event: done\ndata: {}\n\n');
            return res.end();
          }
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          } catch {
            // Fragmento incompleto o keep-alive: lo ignoramos.
          }
        }
      }
    }
    res.write('event: done\ndata: {}\n\n');
    res.end();
  } catch (err) {
    console.error('Se cortó el stream:', err);
    if (!aborted()) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Se interrumpió la respuesta.' })}\n\n`);
      res.end();
    }
  }
}

/**
 * Responde con el guion de demo, imitando el goteo de la API real.
 * Así la página se puede mostrar sin configurar nada.
 */
async function streamDemo(res, messages) {
  const { pickDemoReply } = await loadDemoEngine();
  const reply = pickDemoReply(messages, DEMO_SCRIPT);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Se manda de a palabras, con una pausa parecida a la de un modelo real.
  const chunks = reply.match(/\S+\s*/g) || [reply];
  let i = 0;
  let closed = false;
  res.on('close', () => (closed = true));

  const tick = () => {
    if (closed || res.writableEnded) return;
    if (i >= chunks.length) {
      res.write('event: done\ndata: {}\n\n');
      return res.end();
    }
    res.write(`data: ${JSON.stringify({ delta: chunks[i++] })}\n\n`);
    setTimeout(tick, 26 + Math.random() * 34);
  };

  setTimeout(tick, 380); // el "pensando" inicial
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    .filter((m) => m.content.trim())
    .slice(-MAX_MESSAGES);
}

function describeUpstreamError(status, detail) {
  if (status === 401) return 'La API rechazó la clave (401). Revisá OPENAI_API_KEY en tu .env.';
  if (status === 429) return 'Límite de uso alcanzado o sin crédito (429). Probá de nuevo en unos segundos.';
  if (status === 404) return `El modelo "${MODEL}" no existe o tu cuenta no tiene acceso (404).`;
  try {
    const msg = JSON.parse(detail)?.error?.message;
    if (msg) return `La API respondió ${status}: ${msg}`;
  } catch { /* respuesta no-JSON */ }
  return `La API respondió con el estado ${status}.`;
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
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
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
