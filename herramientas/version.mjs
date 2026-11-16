#!/usr/bin/env node
/*
 * Marca una versión nueva del sitio. Correrlo antes de publicar un cambio en
 * el programa (public/*.html, *.js, *.css):
 *
 *     node herramientas/version.mjs
 *
 * Escribe public/js/version.js (la versión con la que se abre cada página) y
 * public/version.json (la publicada, con la lista de archivos del programa).
 * Con eso, una pestaña de NOVA o del panel que quedó con una versión vieja lo
 * nota y se pone al día. Los guiones, las grabaciones y los videos no cambian
 * la versión: esos ya se vuelven a mirar solos.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLICO = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const ES_PROGRAMA = /\.(html|js|css)$/;

const archivos = [
  ...readdirSync(PUBLICO).filter((nombre) => ES_PROGRAMA.test(nombre)),
  ...readdirSync(join(PUBLICO, 'js')).filter((nombre) => ES_PROGRAMA.test(nombre)).map((nombre) => `js/${nombre}`),
].sort();

// Año, mes, día, hora y minuto (UTC): crece siempre y se lee fácil.
const version = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

writeFileSync(join(PUBLICO, 'js', 'version.js'), `// Lo escribe herramientas/version.mjs: no editar a mano.\nexport const VERSION = '${version}';\n`);
writeFileSync(join(PUBLICO, 'version.json'), `${JSON.stringify({ version, archivos }, null, 2)}\n`);
console.log(`Versión ${version} · ${archivos.length} archivos del programa`);
