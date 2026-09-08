/**
 * Cliente del endpoint /api/chat.
 * Lee la respuesta en streaming (SSE) y entrega los fragmentos a medida que llegan.
 */

export async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return { ok: false, configured: false };
  }
}

/**
 * @param {Array<{role:string, content:string}>} messages
 * @param {(delta:string) => void} onDelta  se llama con cada fragmento de texto
 * @param {AbortSignal} [signal]
 * @returns {Promise<string>} el texto completo
 */
export async function streamChat(messages, onDelta, signal) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    const info = await res.json().catch(() => ({}));
    throw new Error(info.error || `El servidor respondió ${res.status}.`);
  }

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

      let eventName = 'message';
      let data = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      if (eventName === 'error') {
        throw new Error(JSON.parse(data).error || 'Se interrumpió la respuesta.');
      }
      if (eventName === 'done') return full;

      const delta = JSON.parse(data).delta;
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
  }

  return full;
}
