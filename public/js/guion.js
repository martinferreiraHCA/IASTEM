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
 * contesta con el parlamento en vez de pensar. Lo que no esté en el guion
 * sigue yendo a la API (o al modo demo), así que la charla no se traba.
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

ANA: Hola NOVA, ¿nos escuchás?
NOVA: Los escucho. Soy NOVA, la inteligencia de esta muestra. Estoy formándome letra por letra en la pantalla mientras hablamos.

TOMÁS: ¿Y cómo aprendiste a hablar?
NOVA: Parecido a como aprendiste vos a reconocer perros: nadie te dio la definición, viste miles y encontraste el patrón. A mí me pasaron millones de textos y ajusté de a poco hasta poder adivinar qué palabra viene después.

ANA: ¿Te podés equivocar?
NOVA: Todo el tiempo. Adivino la palabra que mejor suena, no la que es verdad. Por eso conviene preguntarme de dónde saco lo que digo.

[Un parlamento sin pie se dice a mano, con la tecla S]
NOVA: Gracias por esta noche. Lo que definimos juntos queda en el muro.
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
 *
 * @param {string} texto
 * @returns {{entradas: Array<{indice:number, pies:string[], parlamento:string}>, personajes: string[]}}
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
  const personajes = new Set();
  let pies = [];

  for (const { quien, texto: dicho } of lineas) {
    if (!dicho) continue;
    if (ALIAS_NOVA.has(normalizar(quien))) {
      entradas.push({ indice: entradas.length, pies, parlamento: dicho });
      pies = [];
    } else {
      if (quien) personajes.add(quien);
      pies.push(dicho);
    }
  }

  return { entradas, personajes: [...personajes] };
}

/**
 * ¿Lo que está antes de los dos puntos es un personaje?
 * "ANA", "Ana María", "Alumno 2" o "Sra. Directora" lo son; "Te pregunto"
 * no: un nombre va en mayúsculas o con mayúscula inicial, salvo partículas
 * como "de" o "la". Un nombre que ya rotuló una línea vale siempre.
 */
function esNombre(candidato, vistos) {
  if (!candidato || /^https?$/i.test(candidato)) return false;
  if (vistos.has(normalizar(candidato)) || ALIAS_NOVA.has(normalizar(candidato))) return true;

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
    this.personajes = [];
    this.activo = true;
    this.tolerancia = 'normal';
    this.cursor = -1; // índice del último parlamento dicho
    this.listeners = new Set();
    this.#load();
  }

  /** Carga un guion nuevo y vuelve al principio. Devuelve cuántos parlamentos tiene. */
  cargar(texto) {
    const { entradas, personajes } = parsearGuion(texto);
    this.texto = String(texto || '');
    this.entradas = entradas;
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

    const { entradas, personajes } = parsearGuion(guardado.texto);
    this.texto = typeof guardado.texto === 'string' ? guardado.texto : '';
    this.entradas = entradas;
    this.personajes = personajes;
    this.activo = guardado.activo !== false;
    this.tolerancia = guardado.tolerancia in TOLERANCIAS ? guardado.tolerancia : 'normal';
    const cursor = Number(guardado.cursor);
    this.cursor = Number.isInteger(cursor) && cursor < entradas.length ? Math.max(-1, cursor) : -1;
  }
}
