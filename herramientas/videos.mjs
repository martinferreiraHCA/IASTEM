#!/usr/bin/env node
/**
 * Trae los videos de la muestra y los deja listos dentro del sitio.
 *
 *   node herramientas/videos.mjs                 de la carpeta de Drive de la muestra
 *   node herramientas/videos.mjs --local ruta/   de una carpeta de esta computadora
 *   node herramientas/videos.mjs --carpeta ID    de otra carpeta de Drive (pública)
 *
 * Los toma en orden alfabético, que es el orden en que aparecen en el guion:
 * "VIDEO: 1" es el primero, "VIDEO: 2" el segundo. Cada uno se pasa a mp4
 * (H.264 y AAC, 720p como mucho), sea cual sea su formato, y queda en
 * public/videos/, con un public/videos/indice.json que NOVA lee.
 *
 * Para dejar afuera un archivo que está en la carpeta pero no va en la obra
 * (una prueba), se anota su id de Drive en public/videos/excluir.json: no se
 * trae ni cuenta para el orden.
 *
 * Con --comprobar no baja nada: dice si la carpeta cambió respecto de lo que
 * ya está en el sitio (sale con código 3 si hay algo para traer o sacar).
 *
 * Es una caché: un video que ya se trajo y no cambió de nombre no se baja de
 * nuevo (--rehacer los trae todos). Lo que ya no está en la carpeta se borra.
 * La carpeta de Drive tiene que estar compartida como "Cualquier persona con
 * el enlace". Hacen falta curl y ffmpeg.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'public', 'videos');
const CARPETA_DE_LA_MUESTRA = '100VXG1CE7_o2c8x0HGFv30VWdoVJmtoI';
const MAXIMO_MB = 90; // GitHub no acepta archivos de más de 100 MB
const DE_VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpg|mpeg|3gp|flv|ogv)$/i;

const opciones = { carpeta: CARPETA_DE_LA_MUESTRA, local: '', rehacer: false, comprobar: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rehacer') opciones.rehacer = true;
  else if (args[i] === '--comprobar') opciones.comprobar = true;
  else if (args[i] === '--local') opciones.local = args[++i];
  else if (args[i] === '--carpeta') opciones.carpeta = args[++i];
  else if (args[i] === '--ayuda' || args[i] === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
    process.exit(0);
  }
}

fs.mkdirSync(DESTINO, { recursive: true });
const indiceViejo = leerJson(path.join(DESTINO, 'indice.json')) || [];
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-videos-'));

// Lo que está en la carpeta pero no va en la obra: [{ "id": "...", "nombre": "...", "motivo": "..." }]
const excluidos = new Set((leerJson(path.join(DESTINO, 'excluir.json')) || []).map((e) => e.id));

const origenes = (opciones.local ? listarLocal(opciones.local) : listarDrive(opciones.carpeta))
  .filter((o) => DE_VIDEO.test(o.nombre))
  .filter((o) => !excluidos.has(o.id))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' }));

const nombreDe = (origen, numero) => `${String(numero).padStart(2, '0')}-${slug(origen.nombre.replace(DE_VIDEO, '').trim())}.mp4`;
const yaEsta = (origen, numero) => {
  const archivo = nombreDe(origen, numero);
  const previo = indiceViejo.find((v) => v.origen === origen.clave && v.archivo === archivo);
  return previo && fs.existsSync(path.join(DESTINO, archivo)) ? previo : null;
};

if (opciones.comprobar) {
  // ¿La carpeta dice lo mismo que el sitio? Mismos videos, mismo orden.
  const nuevos = origenes.filter((o, i) => !yaEsta(o, i + 1)).length;
  const sobran = indiceViejo.length - (origenes.length - nuevos);
  const cambio = nuevos > 0 || sobran > 0;
  console.log(cambio ? `La carpeta cambió: ${nuevos} para traer, ${Math.max(0, sobran)} para sacar.` : `Sin cambios: ${origenes.length} ${origenes.length === 1 ? 'video' : 'videos'}.`);
  fs.rmSync(temporal, { recursive: true, force: true });
  process.exit(cambio ? 3 : 0);
}

console.log(origenes.length
  ? `${origenes.length} ${origenes.length === 1 ? 'video' : 'videos'}, en orden:`
  : 'La carpeta no tiene videos todavía.');

const indice = [];
let fallaron = 0;
for (const [i, origen] of origenes.entries()) {
  const numero = i + 1;
  const titulo = origen.nombre.replace(DE_VIDEO, '').trim();
  const archivo = nombreDe(origen, numero);
  const previo = opciones.rehacer ? null : yaEsta(origen, numero);
  if (previo) {
    console.log(`  ${numero}. ${origen.nombre}  (ya estaba)`);
    indice.push({ ...previo, numero });
    continue;
  }
  process.stdout.write(`  ${numero}. ${origen.nombre}  `);
  try {
    const crudo = origen.ruta || bajarDeDrive(origen.id, path.join(temporal, `crudo-${numero}`));
    const { mb, segundos } = pasarAMp4(crudo, path.join(DESTINO, archivo));
    console.log(`→ videos/${archivo} (${segundos.toFixed(0)} s, ${mb.toFixed(1)} MB)`);
    indice.push({ numero, archivo, titulo, origen: origen.clave, segundos: Number(segundos.toFixed(1)), mb: Number(mb.toFixed(1)) });
  } catch (error) {
    // Un video que falla no frena a los demás: su lugar queda vacío y el
    // guion lo pasa de largo. La próxima vez se intenta de nuevo.
    fallaron += 1;
    console.log(`NO SE PUDO: ${String(error.message).trim()}`);
    fs.rmSync(path.join(DESTINO, archivo), { force: true });
    indice.push(null);
  }
}

// Lo que ya no corresponde a ningún video de la carpeta se borra.
const vigentes = new Set(indice.filter(Boolean).map((v) => v.archivo));
for (const f of fs.readdirSync(DESTINO)) if (/\.mp4$/i.test(f) && !vigentes.has(f)) fs.unlinkSync(path.join(DESTINO, f));
fs.writeFileSync(path.join(DESTINO, 'indice.json'), `${JSON.stringify(indice, null, 2)}\n`);
fs.rmSync(temporal, { recursive: true, force: true });
console.log(`Listo: public/videos/indice.json con ${indice.filter(Boolean).length} de ${indice.length} ${indice.length === 1 ? 'video' : 'videos'}${fallaron ? `; ${fallaron} no se pudieron traer` : ''}.`);

/* ------------------------------------------------------------- listar */

function listarLocal(carpeta) {
  return fs.readdirSync(carpeta).filter((f) => fs.statSync(path.join(carpeta, f)).isFile()).map((f) => {
    const ruta = path.join(carpeta, f);
    const st = fs.statSync(ruta);
    return { nombre: f, ruta, clave: `local:${f}:${st.size}:${Math.round(st.mtimeMs)}` };
  });
}

/** La lista pública de una carpeta de Drive compartida: nombre e id de cada archivo. */
function listarDrive(id) {
  const r = spawnSync('curl', ['-sS', '-L', '-m', '60', `https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) fallar(`No se pudo leer la carpeta de Drive: ${r.stderr}`);
  const html = r.stdout;
  if (!/flip-entries|flip-contents/.test(html)) fallar('Drive no mostró la carpeta: ¿está compartida como "Cualquier persona con el enlace"?');
  const archivos = [];
  const entrada = /id="entry-([\w-]+)"[\s\S]*?class="flip-entry-title">([\s\S]*?)<\/div>/g;
  for (let m; (m = entrada.exec(html));) archivos.push({ id: m[1], nombre: sinEntidades(m[2].trim()), clave: `drive:${m[1]}` });
  return archivos;
}

function bajarDeDrive(id, destino) {
  const r = spawnSync('curl', ['-sS', '-L', '-f', '-m', '1800', '-o', destino,
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`no se pudo bajar de Drive (${String(r.stderr).trim().slice(0, 160)})`);
  // Si Drive devolvió una página en vez del archivo, no es un video.
  const cabeza = fs.readFileSync(destino).subarray(0, 64).toString('latin1');
  if (/^\s*<(!doctype|html)/i.test(cabeza)) throw new Error('Drive no entregó el archivo: revisá que esté compartido con el enlace');
  return destino;
}

/* ------------------------------------------------------------ convertir */

/** A mp4 que cualquier navegador reproduce; si queda muy pesado, se aprieta más. */
function pasarAMp4(origen, destino) {
  const intentos = [{ ancho: 1280, crf: 26 }, { ancho: 1280, crf: 30 }, { ancho: 960, crf: 31 }, { ancho: 854, crf: 34 }];
  for (const { ancho, crf } of intentos) {
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', origen,
      '-vf', `scale='min(${ancho},iw)':-2`, '-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '112k', '-ac', '2', '-movflags', '+faststart', destino], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`no se pudo convertir (${String(r.stderr).trim().slice(0, 200)})`);
    const mb = fs.statSync(destino).size / 1048576;
    if (mb <= MAXIMO_MB) return { mb, segundos: duracion(destino) };
  }
  throw new Error(`pesa más de ${MAXIMO_MB} MB aun comprimido: hay que partirlo o acortarlo`);
}

function duracion(archivo) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo], { encoding: 'utf8' });
  return Number(String(r.stdout).trim()) || 0;
}

/* --------------------------------------------------------------- ayudas */

function slug(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video';
}

function sinEntidades(texto) {
  return texto.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function leerJson(archivo) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return null; }
}

function fallar(mensaje) {
  console.error(mensaje);
  process.exit(1);
}
