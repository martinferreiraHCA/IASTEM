/**
 * El guion: parlamentos preparados que NOVA dice cuando escucha su pie.
 *
 * Se carga un texto plano con el formato de un guion de teatro:
 *
 *   ANA: Hola NOVA, ¿quién sos?
 *   NOVA: Soy NOVA, la inteligencia de esta muestra.
 *
 *   TOMÁS: ¿Y cómo aprendés?
 *   NOVA: Parecido a como aprendés vos a reconocer perros...
 *
 * Las líneas de NOVA son sus parlamentos. Lo que viene justo antes es el
 * pie: cuando alguien dice algo parecido —por voz o por teclado— NOVA
 * contesta con el parlamento. Si lo que escucha no se parece a ningún pie,
 * contesta con un comodín, si el guion los tiene:
 *
 *   NOVA?: No te escuché bien. ¿Me lo repetís?
 *
 * y si no, se queda callada y el panel de control avisa qué oyó.
 *
 * El guion también puede sugerir qué se ve en pantalla, con líneas antes
 * del parlamento de NOVA en el que pasan:
 *   IMAGEN: dirección | pie          una imagen a pantalla completa, que se queda
 *   IMAGEN: dirección | pie | 10s    la misma, pero se va sola a los 10 segundos
 *   FONDO: dirección | pie          una imagen de fondo que se queda (FONDO: ninguno la saca)
 *   PALABRA: CREATIVIDAD            una palabra flotando junto a NOVA (PALABRA: ninguna la saca)
 *   CÁMARA: encender | apagar       la cámara del público
 *
 * La comparación es tolerante a propósito: el reconocimiento de voz no es
 * perfecto y nadie dice una frase exactamente igual dos veces. Además el
 * guion tiene un orden, y el parlamento que sigue en ese orden corre con
 * ventaja: dos pies parecidos se resuelven por dónde está la función.
 *
 * Todo se guarda en el navegador, como el plantel y los acuerdos.
 */

const STORE_GUION = 'nova:guion';

/** Nombres con los que se puede rotular a NOVA en el guion. */
const ALIAS_NOVA = new Set(['nova', 'ia', 'ai', 'la ia', 'inteligencia artificial', 'maquina', 'la maquina']);

/** Rótulos que no son personajes sino indicaciones de pantalla. */
const ROTULO_IMAGEN = new Set(['imagen', 'foto', 'image']);
const ROTULO_CAMARA = new Set(['camara', 'cam']);
const ROTULO_FONDO = new Set(['fondo', 'background']);
const ROTULO_PALABRA = new Set(['palabra', 'word']);

/** Palabras chicas que pueden ir dentro de un nombre: "Ana de la Torre". */
const PARTICULAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y']);

/** Qué tan parecido tiene que ser lo que se escucha al pie, de 0 a 1. */
export const TOLERANCIAS = {
  estricta: 0.85,
  normal: 0.65,
  amplia: 0.5,
};

/** Un guion corto para ver el formato andando. */
export const GUION_EJEMPLO = `# Guion de ejemplo. Las líneas con numeral son comentarios.
# Las líneas de NOVA son lo que dice. La línea anterior es su pie.
# Las líneas "NOVA?:" son comodines: lo que dice si no reconoce nada.

NOVA?: No te escuché bien. ¿Me lo podés repetir?
NOVA?: Eso no lo tengo preparado. Preguntame otra cosa.

ANA: Hola NOVA, ¿nos escuchás?
NOVA: Los escucho. Soy NOVA, la inteligencia de esta muestra. Estoy formándome letra por letra en la pantalla mientras hablamos.

TOMÁS: ¿Y cómo aprendiste a hablar?
NOVA: Parecido a como aprendiste vos a reconocer perros: nadie te dio la definición, viste miles y encontraste el patrón. A mí me pasaron millones de textos y ajusté de a poco hasta poder adivinar qué palabra viene después.

ANA: ¿Te podés equivocar?
NOVA: Todo el tiempo. Adivino la palabra que mejor suena, no la que es verdad. Por eso conviene preguntarme de dónde saco lo que digo.

[Un parlamento sin pie se dice a mano, con la tecla S]
[CÁMARA: encender muestra al público en pantalla; IMAGEN: dirección | pie de foto muestra una imagen en grande, que se queda; con | 10s se va sola]
CÁMARA: encender
NOVA: Gracias por esta noche. Mírense: lo que definimos juntos queda en el muro.
`;

/* --------------------------------------------------------------- parseo */

/**
 * Convierte el texto plano en entradas: cada parlamento de NOVA con los
 * pies que lo preceden.
 *
 * Reglas, pensadas para que cualquier guion pegado tal cual funcione:
 *   - `PERSONAJE: texto` es una línea de ese personaje.
 *   - Una línea sin personaje continúa la anterior, salvo que haya una
 *     línea en blanco en el medio: ahí es una línea nueva, de nadie.
 *   - `#`, `[acotación]` y `(acotación)` se ignoran.
 *   - Un parlamento de NOVA sin pie antes solo se dice a mano.
 *   - `NOVA?: texto` es un comodín: se dice cuando nada se parece.
 *
 * @param {string} texto
 * @returns {{entradas: Array<{indice:number, pies:string[], parlamento:string}>, comodines: string[], personajes: string[]}}
 */
export function parsearGuion(texto) {
  const lineas = [];
  const vistos = new Set(); // nombres que ya aparecieron rotulando una línea
  let abierta = null; // la última línea, por si la siguiente la continúa

  for (const cruda of String(texto || '').split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) {
      abierta = null;
      continue;
    }
    if (/^#/.test(linea) || /^\[.*\]$/.test(linea) || /^\(.*\)$/.test(linea)) continue;

    const rotulo = /^([^\s:¿¡][^:]{0,30}?)\s*:\s*(.*)$/.exec(linea);
    if (rotulo && esNombre(rotulo[1].trim(), vistos)) {
      abierta = { quien: rotulo[1].trim(), texto: rotulo[2].trim() };
      vistos.add(normalizar(abierta.quien));
      lineas.push(abierta);
    } else if (abierta) {
      abierta.texto = `${abierta.texto} ${linea}`.trim();
    } else {
      abierta = { quien: '', texto: linea };
      lineas.push(abierta);
    }
  }

  const entradas = [];
  const comodines = [];
  const personajes = new Set();
  let pies = [];
  let imagenes = []; // las indicaciones de pantalla esperando su parlamento
  let camara = null;
  let fondo = null;   // {src, pie} o 'ninguno'
  let palabra = null; // texto o 'ninguna'

  for (const { quien, texto: dicho } of lineas) {
    if (!dicho) continue;
    const rotulo = normalizar(quien);
    if (ROTULO_IMAGEN.has(rotulo)) {
      const imagen = leerImagen(dicho);
      if (imagen) imagenes.push(imagen);
    } else if (ROTULO_CAMARA.has(rotulo)) {
      camara = /^(apag|off|no|cerr|sac)/i.test(normalizar(dicho)) ? 'apagar' : 'encender';
    } else if (ROTULO_FONDO.has(rotulo)) {
      fondo = /^(ningun|no|sin|sac|quit|off)/i.test(normalizar(dicho)) ? 'ninguno' : leerImagen(dicho);
    } else if (ROTULO_PALABRA.has(rotulo)) {
      palabra = /^(ningun|no|sin|sac|quit|off)/i.test(normalizar(dicho)) ? 'ninguna' : dicho.trim();
    } else if (esComodin(quien)) {
      comodines.push(dicho);
    } else if (ALIAS_NOVA.has(normalizar(quien))) {
      entradas.push({ indice: entradas.length, pies, parlamento: dicho, imagenes, camara, fondo, palabra });
      pies = [];
      imagenes = [];
      camara = null;
      fondo = null;
      palabra = null;
    } else {
      if (quien) personajes.add(quien);
      pies.push(dicho);
    }
  }

  return { entradas, comodines, personajes: [...personajes] };
}

/** Sin tiempo, la imagen se queda hasta que otra la reemplace o la saquen. */
export const SEGUNDOS_IMAGEN = 0;

/**
 * `dirección | pie de foto | 10s`: el pie y el tiempo son opcionales, y
 * el tiempo puede ir en cualquiera de los dos lugares. Sin tiempo, la
 * imagen se queda en pantalla.
 */
export function leerImagen(texto) {
  const partes = String(texto || '').split('|').map((p) => p.trim());
  const src = partes.shift();
  if (!src) return null;
  let segundos = SEGUNDOS_IMAGEN;
  let pie = '';
  for (const parte of partes) {
    const tiempo = /^(\d+(?:[.,]\d+)?)\s*(?:s|seg|segundos?)?$/i.exec(parte);
    if (tiempo) segundos = Math.max(1, Math.min(600, Number(tiempo[1].replace(',', '.'))));
    else if (parte) pie = pie ? `${pie} | ${parte}` : parte;
  }
  return { src, pie, segundos };
}

/** "NOVA?" rotula un comodín: lo que dice cuando no reconoce el pie. */
function esComodin(quien) {
  const limpio = normalizar(quien).replace(/\s*\?$/, '');
  return /\?$/.test(quien.trim()) && ALIAS_NOVA.has(limpio);
}

/**
 * ¿Lo que está antes de los dos puntos es un personaje?
 * "ANA", "Ana María", "Alumno 2" o "Sra. Directora" lo son; "Te pregunto"
 * no: un nombre va en mayúsculas o con mayúscula inicial, salvo partículas
 * como "de" o "la". Un nombre que ya rotuló una línea vale siempre.
 */
function esNombre(candidato, vistos) {
  if (!candidato || /^https?$/i.test(candidato)) return false;
  const limpio = normalizar(candidato);
  if (vistos.has(limpio) || ALIAS_NOVA.has(limpio) || ROTULO_IMAGEN.has(limpio) || ROTULO_CAMARA.has(limpio) || ROTULO_FONDO.has(limpio) || ROTULO_PALABRA.has(limpio) || esComodin(candidato)) return true;

  const partes = candidato.split(/\s+/);
  if (partes.length > 3) return false;
  return partes.every((parte) => /^[\p{Lu}\p{N}]/u.test(parte) || PARTICULAS.has(normalizar(parte)));
}

/* ---------------------------------------------------------- comparación */

/** Minúsculas y sin acentos: "¿Quién sos?" queda como "quien sos". */
export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Las palabras del texto, ya normalizadas. */
export function palabras(texto) {
  return normalizar(texto)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Cuánto del pie se escuchó, de 0 a 1.
 *
 * Cada palabra del pie pesa según su largo: "energía" dice más que "de".
 * Las palabras se aceptan con una letra cambiada si son largas, porque el
 * reconocimiento de voz confunde terminaciones. Y si lo escuchado es mucho
 * más largo que el pie, el puntaje baja: un pie de dos palabras no puede
 * ganar por aparecer dentro de un discurso.
 */
export function puntaje(oido, pie) {
  const a = palabras(oido);
  const b = palabras(pie);
  if (!a.length || !b.length) return 0;

  const usadas = new Array(a.length).fill(false);
  let total = 0;
  let hallado = 0;
  for (const palabra of b) {
    const peso = Math.min(palabra.length, 6);
    total += peso;
    const i = a.findIndex((otra, j) => !usadas[j] && parecidas(otra, palabra));
    if (i !== -1) {
      usadas[i] = true;
      hallado += peso;
    }
  }

  const largo = Math.min(1, (b.length * 2 + 3) / a.length);
  return (hallado / total) * largo;
}

function parecidas(a, b) {
  if (a === b) return true;
  const largo = Math.min(a.length, b.length);
  if (largo < 5) return false;
  const margen = largo >= 9 ? 2 : 1;
  if (Math.abs(a.length - b.length) > margen) return false;
  return distancia(a, b, margen) <= margen;
}

/** Distancia de Levenshtein, cortando apenas se pasa del margen. */
function distancia(a, b, margen) {
  let fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      nueva[j] = Math.min(nueva[j - 1] + 1, fila[j] + 1, fila[j - 1] + costo);
      if (nueva[j] < minimo) minimo = nueva[j];
    }
    if (minimo > margen) return margen + 1;
    fila = nueva;
  }
  return fila[b.length];
}

/* ---------------------------------------------------------------- guion */

export class Guion {
  constructor() {
    this.texto = '';
    this.entradas = [];
    this.comodines = [];
    this.personajes = [];
    this.activo = true;
    this.tolerancia = 'normal';
    this.cursor = -1; // índice del último parlamento dicho
    this.listeners = new Set();
    this.#load();
  }

  /** Carga un guion nuevo y vuelve al principio. Devuelve cuántos parlamentos tiene. */
  cargar(texto) {
    const { entradas, comodines, personajes } = parsearGuion(texto);
    this.texto = String(texto || '');
    this.entradas = entradas;
    this.comodines = comodines;
    this.personajes = personajes;
    this.cursor = -1;
    this.#save();
    return entradas.length;
  }

  quitar() {
    this.cargar('');
  }

  get tiene() {
    return this.entradas.length > 0;
  }

  get umbral() {
    return TOLERANCIAS[this.tolerancia] ?? TOLERANCIAS.normal;
  }

  /** El parlamento que viene según el orden del guion. */
  get siguiente() {
    return this.entradas[this.cursor + 1] || null;
  }

  /** Un comodín al azar, para cuando nada se parece. */
  get comodin() {
    if (!this.comodines.length) return null;
    return this.comodines[(Math.random() * this.comodines.length) | 0];
  }

  /** Todo lo que el panel de control necesita saber, listo para mandar. */
  resumen() {
    return {
      activo: this.activo,
      tolerancia: this.tolerancia,
      cursor: this.cursor,
      total: this.entradas.length,
      comodines: this.comodines.length,
      personajes: this.personajes,
      entradas: this.entradas.map((e) => ({
        indice: e.indice,
        pie: e.pies.at(-1) || '',
        parlamento: e.parlamento,
        imagen: e.imagenes?.[0]?.src || '',
        segundos: e.imagenes?.[0]?.segundos || 0,
        camara: e.camara || null,
        fondo: e.fondo ? (e.fondo === 'ninguno' ? 'ninguno' : e.fondo.pie || e.fondo.src) : null,
        palabra: e.palabra || null,
        pantalla: Boolean(e.imagenes?.length || e.camara || e.fondo || e.palabra),
      })),
    };
  }

  setActivo(on) {
    this.activo = Boolean(on);
    this.#save();
  }

  setTolerancia(nombre) {
    this.tolerancia = nombre in TOLERANCIAS ? nombre : 'normal';
    this.#save();
  }

  /** Marca un parlamento como dicho: desde ahí sigue el guion. */
  marcar(indice) {
    if (!this.entradas[indice]) return;
    this.cursor = indice;
    this.#save();
  }

  reiniciar() {
    this.cursor = -1;
    this.#save();
  }

  /**
   * Busca el parlamento cuyo pie se parece a lo que se escuchó.
   * El que sigue en el orden del guion corre con ventaja.
   *
   * @param {string} oido
   * @returns {{entrada: object, puntaje: number} | null}
   */
  buscar(oido) {
    if (!this.activo || !this.tiene || !String(oido || '').trim()) return null;

    let mejor = null;
    let mejorValor = 0;
    for (const entrada of this.entradas) {
      if (!entrada.pies.length) continue;
      const esSiguiente = entrada.indice === this.cursor + 1;
      const crudo = Math.max(...entrada.pies.map((pie) => puntaje(oido, pie)));
      if (crudo < this.umbral - (esSiguiente ? 0.1 : 0)) continue;

      const valor = crudo + (esSiguiente ? 0.1 : 0);
      if (valor > mejorValor) {
        mejor = { entrada, puntaje: crudo };
        mejorValor = valor;
      }
    }
    return mejor;
  }

  /* ------------------------------------------------------------ avisos */

  subscribe(fn) {
    this.listeners.add(fn);
    fn(this);
    return () => this.listeners.delete(fn);
  }

  #notify() {
    for (const fn of this.listeners) fn(this);
  }

  /* --------------------------------------------------------- guardado */

  #save() {
    try {
      localStorage.setItem(
        STORE_GUION,
        JSON.stringify({
          texto: this.texto,
          activo: this.activo,
          tolerancia: this.tolerancia,
          cursor: this.cursor,
        }),
      );
    } catch { /* navegación privada: se usa solo en esta sesión */ }
    this.#notify();
  }

  #load() {
    let guardado;
    try {
      guardado = JSON.parse(localStorage.getItem(STORE_GUION) || 'null');
    } catch {
      guardado = null;
    }
    if (!guardado) return;

    const { entradas, comodines, personajes } = parsearGuion(guardado.texto);
    this.texto = typeof guardado.texto === 'string' ? guardado.texto : '';
    this.entradas = entradas;
    this.comodines = comodines;
    this.personajes = personajes;
    this.activo = guardado.activo !== false;
    this.tolerancia = guardado.tolerancia in TOLERANCIAS ? guardado.tolerancia : 'normal';
    const cursor = Number(guardado.cursor);
    this.cursor = Number.isInteger(cursor) && cursor < entradas.length ? Math.max(-1, cursor) : -1;
  }
}
