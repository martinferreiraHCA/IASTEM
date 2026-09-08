/**
 * Arma versiones de un solo archivo del sitio, para mostrarlo sin desplegarlo.
 *
 *   node tools/build-demo.js
 *
 * Genera dos cosas a partir de los mismos archivos que usa la app real, así
 * nunca se desincronizan:
 *
 *   demo/nova-demo.html      Documento completo. Anda con doble clic, sin
 *                            servidor y sin internet. Mantiene el panel de
 *                            conexión, así que también acepta una API key.
 *   demo/nova-pagina.html    Solo el contenido, para publicar como página web
 *                            embebida. Queda en modo demo a propósito.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

/** Saca los import/export para poder concatenar los módulos en un solo script. */
function flatten(source) {
  return source
    .replace(/^\s*import[^;]+;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

const html = read('public', 'index.html');
const replies = read('public', 'demo', 'replies.json');

const body = html
  .slice(html.indexOf('<body'), html.indexOf('</body>'))
  .replace(/^<body[^>]*>/, '')
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const modules = [
  ['public', 'demo', 'engine.js'],
  ['public', 'js', 'materialize.js'],
  ['public', 'js', 'wordcloud.js'],
  ['public', 'js', 'voice.js'],
  ['public', 'js', 'audio.js'],
  ['public', 'js', 'show.js'],
  ['public', 'js', 'api.js'],
  ['public', 'app.js'],
];

function script({ demoOnly }) {
  return `<script>
"use strict";
globalThis.NOVA_DEMO_SCRIPT = ${replies};
${demoOnly ? 'globalThis.NOVA_SOLO_DEMO = true;\n' : ''}(() => {
${modules.map((m) => flatten(read(...m))).join('\n')}
})();
</script>`;
}

const styles = `${read('public', 'styles.css')}\n${read('public', 'stage.css')}`;

const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n' +
  '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;600;800' +
  '&family=JetBrains+Mono:wght@300;500&display=swap" rel="stylesheet" />';

/* --------------------------------------------- archivo para doble clic */

const standalone = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>NOVA · IASTEM</title>
<meta name="description" content="NOVA: letras que se materializan y nube de palabras, en un solo archivo." />
<meta name="theme-color" content="#05060c" />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='38' fill='none' stroke='%237af5ff' stroke-width='7'/><circle cx='50' cy='50' r='13' fill='%23a37bff'/></svg>" />
${FONTS}
<style>
${styles}
</style>
</head>
<body data-mode="console">
${body}
${script({ demoOnly: false })}
</body>
</html>
`;

/* ------------------------------------------- fragmento para publicar */

const embedded = `<title>NOVA</title>
${FONTS}
<style>
${styles}

/* Publicada como página suelta, NOVA queda en modo demo:
   una página embebida no puede hablar con la API de OpenAI. */
#settingsBtn { display: none; }
</style>
${body}
${script({ demoOnly: true })}
`;

for (const [file, content] of [
  ['nova-demo.html', standalone],
  ['nova-pagina.html', embedded],
]) {
  const out = path.join(ROOT, 'demo', file);
  fs.writeFileSync(out, content);
  console.log(`  ${path.relative(ROOT, out).padEnd(24)} ${(content.length / 1024).toFixed(0)} KB`);
}
