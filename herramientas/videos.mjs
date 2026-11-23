#!/usr/bin/env node
/**
 * Trae los videos de la muestra y los deja listos dentro del sitio.
 *
 *   node herramientas/videos.mjs                        todas las muestras, cada una de su carpeta de Drive
 *   node herramientas/videos.mjs --muestra 7-1y2        solo esa
 *   node herramientas/videos.mjs --muestra 7-1y2 --local ruta/    de una carpeta de esta computadora
 *   node herramientas/videos.mjs --muestra 7-1y2 --carpeta ID     de otra carpeta de Drive (pública)
 *
 * Las muestras (qué grupos hay y de qué carpeta de Drive sale cada una) están
 * en public/videos/muestras.json. Cada muestra tiene su carpeta en el sitio:
 * public/videos/<id>/, con sus mp4 y un indice.json que NOVA lee.
 *
 * Los videos se toman en orden alfabético, que es el orden en que aparecen en
 * el guion: "VIDEO: 1" es el primero, "VIDEO: 2" el segundo. Cada uno se pasa
 * a mp4 (H.264 y AAC, 720p como mucho), sea cual sea su formato.
 *
 * Para dejar afuera un archivo que está en la carpeta pero no va en la obra
 * (una prueba), se anota su id de Drive en public/videos/excluir.json: no se
 * trae ni cuenta para el orden.
 *
 * Con --comprobar no baja nada: dice si alguna carpeta cambió respecto de lo
 * que ya está en el sitio (sale con código 3 si hay algo para traer o sacar).
 *
 * Es una caché: un video que ya se trajo y no cambió no se baja de nuevo
 * (--rehacer los trae todos). Lo que ya no está en la carpeta se borra.
 * Las carpetas de Drive tienen que estar compartidas como "Cualquier persona
 * con el enlace". Hacen falta curl y ffmpeg.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(RAIZ, 'public', 'videos');
const MAXIMO_MB = 90; // GitHub no acepta archivos de más de 100 MB
const DE_VIDEO = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|mpg|mpeg|3gp|flv|ogv)$/i;

const opciones = { muestra: '', carpeta: '', local: '', rehacer: false, comprobar: false };
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rehacer') opciones.rehacer = true;
  else if (args[i] === '--comprobar') opciones.comprobar = true;
  else if (args[i] === '--local') opciones.local = args[++i];
  else if (args[i] === '--carpeta') opciones.carpeta = args[++i];
  else if (args[i] === '--muestra') opciones.muestra = args[++i];
  else if (args[i] === '--ayuda' || args[i] === '-h') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
    process.exit(0);
  }
}

// Las muestras: [{ "id": "7-1y2", "nombre": "7°1 y 7°2", "carpeta": "<id de la carpeta de Drive>" }]
const todas = leerJson(path.join(DESTINO, 'muestras.json')) || [];
if (!todas.length) fallar('Falta public/videos/muestras.json con las muestras y sus carpetas de Drive.');
const muestras = opciones.muestra ? todas.filter((m) => m.id === opciones.muestra) : todas;
if (!muestras.length) fallar(`No hay ninguna muestra "${opciones.muestra}". Están: ${todas.map((m) => m.id).join(', ')}.`);
if ((opciones.local || opciones.carpeta) && muestras.length !== 1) fallar('Con --local o --carpeta hay que decir para cuál: --muestra <id>.');

// Lo que está en una carpeta pero no va en la obra: [{ "id": "...", "nombre": "...", "motivo": "..." }]
const excluidos = new Set((leerJson(path.join(DESTINO, 'excluir.json')) || []).map((e) => e.id));
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-videos-'));

let huboCambio = false;
let huboError = false;
for (const muestra of muestras) {
  try {
    if (sincronizar(muestra)) huboCambio = true;
  } catch (error) {
    // Una carpeta que no se pudo leer no toca lo que ya está en el sitio, ni frena a la otra.
    huboError = true;
    console.log(`«${muestra.nombre}»: ${String(error.message).trim()} Se deja como estaba.`);
  }
}
fs.rmSync(temporal, { recursive: true, force: true });
if (opciones.comprobar) process.exit(huboCambio ? 3 : 0);
process.exit(huboError && !huboCambio ? 1 : 0);

/** Pone al día una muestra con su carpeta. Devuelve si había algo distinto. */
function sincronizar(muestra) {
  const destino = path.join(DESTINO, muestra.id);
  const indiceViejo = leerJson(path.join(destino, 'indice.json')) || [];
  const origenes = (opciones.local ? listarLocal(opciones.local) : listarDrive(opciones.carpeta || muestra.carpeta))
    .filter((o) => DE_VIDEO.test(o.nombre))
    .filter((o) => !excluidos.has(o.id))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' }));
  // Cuánto pesa y cuándo se modificó cada uno: así una versión nueva del mismo archivo se vuelve a traer.
  for (const origen of origenes) if (origen.id) origen.clave = claveDeDrive(origen.id);

  const nombreDe = (origen, numero) => `${String(numero).padStart(2, '0')}-${slug(origen.nombre.replace(DE_VIDEO, '').trim())}.mp4`;
  const yaEsta = (origen, numero) => {
    const archivo = nombreDe(origen, numero);
    // Si Drive no dijo el peso ni la fecha (clave terminada en "?"), alcanza con que sea el mismo archivo.
    const mismo = (v) => v.origen === origen.clave || (origen.clave.endsWith(':?') && String(v.origen).startsWith(origen.clave.slice(0, -1)));
    const previo = indiceViejo.find((v) => v && v.archivo === archivo && mismo(v));
    return previo && fs.existsSync(path.join(destino, archivo)) ? previo : null;
  };

  if (opciones.comprobar) {
    const nuevos = origenes.filter((o, i) => !yaEsta(o, i + 1)).length;
    const sobran = indiceViejo.filter(Boolean).length - (origenes.length - nuevos);
    const cambio = nuevos > 0 || sobran > 0;
    console.log(`«${muestra.nombre}»: ${cambio ? `la carpeta cambió: ${nuevos} para traer, ${Math.max(0, sobran)} para sacar.` : `sin cambios: ${origenes.length} ${origenes.length === 1 ? 'video' : 'videos'}.`}`);
    return cambio;
  }

  console.log(`«${muestra.nombre}»: ${origenes.length ? `${origenes.length} ${origenes.length === 1 ? 'video' : 'videos'}, en orden:` : 'la carpeta no tiene videos todavía.'}`);
  fs.mkdirSync(destino, { recursive: true });
  const indice = [];
  let fallaron = 0;
  let trajo = 0;
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
      const crudo = origen.ruta || bajarDeDrive(origen.id, path.join(temporal, `crudo-${muestra.id}-${numero}`));
      const { mb, segundos } = pasarAMp4(crudo, path.join(destino, archivo));
      if (!origen.ruta) fs.rmSync(crudo, { force: true });
      console.log(`→ videos/${muestra.id}/${archivo} (${segundos.toFixed(0)} s, ${mb.toFixed(1)} MB)`);
      indice.push({ numero, archivo, titulo, origen: origen.clave, segundos: Number(segundos.toFixed(1)), mb: Number(mb.toFixed(1)) });
      trajo += 1;
    } catch (error) {
      // Un video que falla no frena a los demás: su lugar queda vacío y el
      // guion lo pasa de largo. La próxima vez se intenta de nuevo.
      fallaron += 1;
      console.log(`NO SE PUDO: ${String(error.message).trim()}`);
      fs.rmSync(path.join(destino, archivo), { force: true });
      indice.push(null);
    }
  }

  // Lo que ya no corresponde a ningún video de la carpeta se borra.
  const vigentes = new Set(indice.filter(Boolean).map((v) => v.archivo));
  let saco = 0;
  for (const f of fs.readdirSync(destino)) if (/\.mp4$/i.test(f) && !vigentes.has(f)) { fs.unlinkSync(path.join(destino, f)); saco += 1; }
  fs.writeFileSync(path.join(destino, 'indice.json'), `${JSON.stringify(indice, null, 2)}\n`);
  console.log(`  Listo: ${indice.filter(Boolean).length} de ${indice.length} ${indice.length === 1 ? 'video' : 'videos'}${fallaron ? `; ${fallaron} no se pudieron traer` : ''}.`);
  return trajo > 0 || saco > 0;
}

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
  if (r.status !== 0) throw new Error(`no se pudo leer la carpeta de Drive (${String(r.stderr).trim().slice(0, 120)}).`);
  const html = r.stdout;
  if (!/flip-entries|flip-contents/.test(html)) throw new Error('Drive no mostró la carpeta: ¿está compartida como "Cualquier persona con el enlace"?');
  const archivos = [];
  // Cada archivo es un bloque: su id y su nombre.
  for (const bloque of html.split('id="entry-').slice(1)) {
    const id = /^([\w-]+)"/.exec(bloque)?.[1];
    const nombre = /class="flip-entry-title">([\s\S]*?)<\/div>/.exec(bloque)?.[1];
    if (!id || nombre == null) continue;
    archivos.push({ id, nombre: sinEntidades(nombre.trim()), clave: `drive:${id}:?` });
  }
  return archivos;
}

/**
 * La seña de un archivo de Drive: su id, cuánto pesa y cuándo se modificó.
 * (La fecha que muestra la lista de la carpeta no sirve: hoy dice la hora y
 * mañana el día, y parecería un archivo nuevo.)
 */
function claveDeDrive(id) {
  const r = spawnSync('curl', ['-sS', '-L', '-I', '-m', '60', `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const cabeceras = String(r.stdout || '').split(/\r?\n\r?\n/).filter((b) => b.trim()).at(-1) || '';
  const peso = /^content-length:\s*(\d+)/im.exec(cabeceras)?.[1];
  const fecha = Date.parse(/^last-modified:\s*(.+)$/im.exec(cabeceras)?.[1] || '');
  if (r.status !== 0 || !peso || !/^content-type:\s*video\//im.test(cabeceras)) return `drive:${id}:?`;
  return `drive:${id}:${peso}:${Number.isFinite(fecha) ? new Date(fecha).toISOString() : ''}`;
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
