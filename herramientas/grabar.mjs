#!/usr/bin/env node
/**
 * Graba los parlamentos de NOVA de un guion, para que la función vaya con
 * audio listo: sin IA ni sintetizador en vivo.
 *
 *   node herramientas/grabar.mjs docs/guion-creatividad.txt --nombre creatividad
 *
 * Deja todo en public/guiones/<nombre>/:
 *   guion.txt          el guion, tal cual
 *   grabaciones.json   qué archivo le toca a cada parlamento (por su huella)
 *   audio/*.mp3        las grabaciones
 * y anota el guion en public/guiones/indice.json, que la página lee.
 *
 * Es una caché: solo graba los parlamentos que no tienen grabación o cuyo
 * texto cambió, y borra las grabaciones que ya no corresponden a nada.
 *
 * Motores:
 *   --motor piper   (por defecto) Piper, local y gratis. Hace falta el
 *                   ejecutable `piper` (pip install piper-tts) y una voz
 *                   .onnx; --voz ruta/al/modelo.onnx. Voces en español en
 *                   https://huggingface.co/rhasspy/piper-voices (es_AR,
 *                   es_ES, es_MX). Con --piper se indica el ejecutable.
 *   --motor openai  El sintetizador neuronal de OpenAI (gpt-4o-mini-tts),
 *                   con OPENAI_API_KEY en el entorno; --voz nova|coral|sage...
 *                   y --instrucciones "cómo tiene que sonar".
 *
 * Otras opciones: --velocidad 1.0 (0.7 lento, 1.3 rápido), --titulo "...",
 * --rehacer (vuelve a grabar todo).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parsearGuion } from '../public/js/guion.js';
import { huella, textoParaHuella } from '../public/js/huella.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIONES = path.join(RAIZ, 'public', 'guiones');

const opciones = leerOpciones(process.argv.slice(2));
if (!opciones.archivo || opciones.ayuda) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
  process.exit(opciones.ayuda ? 0 : 1);
}

const texto = fs.readFileSync(opciones.archivo, 'utf8');
const guion = parsearGuion(texto);
const nombre = opciones.nombre || path.basename(opciones.archivo).replace(/^guion-/, '').replace(/\.txt$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const titulo = opciones.titulo || tituloDelGuion(texto) || nombre;
const carpeta = path.join(GUIONES, nombre);
const audioDir = path.join(carpeta, 'audio');
fs.mkdirSync(audioDir, { recursive: true });

const parlamentos = [
  ...guion.entradas.filter((e) => !e.muda).map((e) => ({ indice: e.indice, texto: e.parlamento, tipo: 'parlamento' })),
  ...guion.comodines.map((c, i) => ({ indice: i, texto: c, tipo: 'comodin' })),
];
if (!parlamentos.length) {
  console.error('El guion no tiene líneas de NOVA.');
  process.exit(1);
}

const anterior = leerJson(path.join(carpeta, 'grabaciones.json')) || { parlamentos: [] };
const yaGrabados = new Map((opciones.rehacer ? [] : anterior.parlamentos).map((p) => [p.huella, p]));
const motor = opciones.motor;
const conFfmpeg = hay('ffmpeg');
console.log(`Guion «${titulo}» (${nombre}): ${guion.entradas.length} parlamentos y ${guion.comodines.length} comodines. Motor: ${motor}${conFfmpeg ? ', con ffmpeg (mp3)' : ', sin ffmpeg (wav)'}.`);

const resultado = [];
let grabados = 0;
for (const p of parlamentos) {
  const h = huella(p.texto);
  const previo = yaGrabados.get(h);
  if (previo && fs.existsSync(path.join(carpeta, previo.archivo))) {
    resultado.push({ ...previo, indice: p.indice, tipo: p.tipo });
    continue;
  }
  const base = `${String(p.tipo === 'comodin' ? 'c' : '')}${String(p.indice + 1).padStart(2, '0')}-${h.slice(0, 8)}`;
  process.stdout.write(`  ${p.tipo === 'comodin' ? 'comodín' : 'parlamento'} ${p.indice + 1}: «${p.texto.slice(0, 60)}${p.texto.length > 60 ? '…' : ''}» `);
  const { archivo, duracion } = grabar(textoParaHuella(p.texto), base);
  console.log(`→ ${archivo} (${duracion.toFixed(1)} s)`);
  resultado.push({ indice: p.indice, tipo: p.tipo, huella: h, texto: p.texto, archivo, duracion: Number(duracion.toFixed(2)) });
  grabados += 1;
}

// Lo que ya no corresponde a ningún parlamento se borra.
const vigentes = new Set(resultado.map((r) => path.basename(r.archivo)));
for (const f of fs.readdirSync(audioDir)) if (!vigentes.has(f)) fs.unlinkSync(path.join(audioDir, f));

fs.copyFileSync(opciones.archivo, path.join(carpeta, 'guion.txt'));
const manifiesto = {
  nombre,
  titulo,
  motor,
  voz: motor === 'piper' ? path.basename(opciones.voz) : opciones.voz,
  fecha: new Date().toISOString(),
  parlamentos: resultado,
};
fs.writeFileSync(path.join(carpeta, 'grabaciones.json'), `${JSON.stringify(manifiesto, null, 2)}\n`);

const indice = (leerJson(path.join(GUIONES, 'indice.json')) || []).filter((g) => g.nombre !== nombre);
indice.push({ nombre, titulo, parlamentos: guion.entradas.filter((e) => !e.muda).length, grabaciones: resultado.length, fecha: manifiesto.fecha });
indice.sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
fs.writeFileSync(path.join(GUIONES, 'indice.json'), `${JSON.stringify(indice, null, 2)}\n`);

const total = resultado.reduce((s, r) => s + r.duracion, 0);
console.log(`Listo: ${grabados} grabados ahora, ${resultado.length} en total (${(total / 60).toFixed(1)} min de audio) en public/guiones/${nombre}/.`);

/* ------------------------------------------------------------- grabar */

function grabar(texto, base) {
  const wav = path.join(audioDir, `${base}.wav`);
  if (motor === 'piper') grabarPiper(texto, wav);
  else if (motor === 'openai') return grabarOpenAI(texto, base);
  else { console.error(`Motor desconocido: ${motor}`); process.exit(1); }

  const duracion = duracionWav(wav);
  if (!conFfmpeg) return { archivo: `audio/${base}.wav`, duracion };
  const mp3 = path.join(audioDir, `${base}.mp3`);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '24000', '-b:a', '48k', mp3]);
  if (r.status !== 0) { console.error(String(r.stderr)); process.exit(1); }
  fs.unlinkSync(wav);
  return { archivo: `audio/${base}.mp3`, duracion };
}

function grabarPiper(texto, wav) {
  if (!opciones.voz) { console.error('Falta --voz ruta/al/modelo.onnx (una voz de Piper).'); process.exit(1); }
  const args = ['-m', opciones.voz, '-f', wav, '--sentence-silence', '0.3', '--length-scale', String(1 / opciones.velocidad)];
  const r = spawnSync(opciones.piper, args, { input: texto, encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error(`\nPiper falló: ${r.error?.message || r.stderr}`);
    console.error('¿Está instalado? pip install piper-tts, y --piper con la ruta al ejecutable si no está en el PATH.');
    process.exit(1);
  }
}

function grabarOpenAI(texto, base) {
  const clave = process.env.OPENAI_API_KEY;
  if (!clave) { console.error('Falta OPENAI_API_KEY en el entorno.'); process.exit(1); }
  const mp3 = path.join(audioDir, `${base}.mp3`);
  const cuerpo = JSON.stringify({
    model: 'gpt-4o-mini-tts',
    voice: opciones.voz || 'nova',
    input: texto,
    instructions: opciones.instrucciones,
    response_format: 'mp3',
    speed: opciones.velocidad,
  });
  // Sincrónico a propósito: una grabación por vez, con la salida ordenada.
  const r = spawnSync('curl', ['-sS', '-f', '-o', mp3, '-X', 'POST', `${(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/audio/speech`,
    '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${clave}`, '--data-binary', '@-'], { input: cuerpo });
  if (r.status !== 0) { console.error(`\nLa API de OpenAI falló: ${r.stderr}`); process.exit(1); }
  return { archivo: `audio/${base}.mp3`, duracion: duracionConFfprobe(mp3) ?? texto.length * 0.065 };
}

/* ------------------------------------------------------------ ayudas */

function duracionWav(archivo) {
  const b = fs.readFileSync(archivo);
  const porSegundo = b.readUInt32LE(28);
  let pos = 12;
  while (pos + 8 <= b.length) {
    const id = b.toString('ascii', pos, pos + 4);
    const largo = b.readUInt32LE(pos + 4);
    if (id === 'data') return largo / porSegundo;
    pos += 8 + largo + (largo % 2);
  }
  return 0;
}

function duracionConFfprobe(archivo) {
  if (!hay('ffprobe')) return null;
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', archivo], { encoding: 'utf8' });
  const n = Number(String(r.stdout).trim());
  return Number.isFinite(n) ? n : null;
}

function hay(programa) {
  return spawnSync(programa, ['-version'], { stdio: 'ignore' }).status === 0;
}

function leerJson(archivo) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { return null; }
}

function tituloDelGuion(texto) {
  const m = /^#\s*(.+)$/m.exec(texto);
  return m ? m[1].replace(/\s*·.*$/, '').replace(/[.:]\s*$/, '').trim() : '';
}

function leerOpciones(args) {
  const o = { motor: 'piper', piper: 'piper', voz: '', velocidad: 1, instrucciones: 'Hablás en español rioplatense, con acento uruguayo, cálida y clara, como una presencia serena en un escenario. Ritmo pausado pero vivo.', rehacer: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--ayuda' || a === '-h' || a === '--help') o.ayuda = true;
    else if (a === '--rehacer') o.rehacer = true;
    else if (a.startsWith('--')) { o[a.slice(2)] = args[++i]; }
    else o.archivo = a;
  }
  o.velocidad = Math.min(1.5, Math.max(0.6, Number(o.velocidad) || 1));
  return o;
}
