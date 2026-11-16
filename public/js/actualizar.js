/*
 * La versión del sitio, y cómo ponerse al día.
 *
 * El navegador guarda los archivos del sitio unos minutos, y una pestaña
 * puede quedar abierta horas: así NOVA o el panel se quedan con una versión
 * vieja sin que se note. Acá se compara la versión con la que se abrió la
 * página con la publicada, y se puede traer la nueva pisando lo guardado.
 */
import { VERSION } from './version.js';

export { VERSION };

const INTENTO = 'nova:puesta-al-dia';
const RAIZ = new URL('../', import.meta.url);

/** La versión publicada ahora mismo: { version, archivos }. null si no se pudo mirar. */
export async function versionPublicada() {
  try {
    const r = await fetch(new URL('version.json', RAIZ), { cache: 'no-store' });
    if (!r.ok) return null;
    const datos = await r.json();
    return datos?.version ? datos : null;
  } catch {
    return null;
  }
}

/** Si esta pestaña ya intentó ponerse al día con esa versión (para no recargar en ronda). */
export function yaSeIntento(version) {
  try { return sessionStorage.getItem(INTENTO) === version; } catch { return false; }
}

/** Baja de nuevo los archivos del sitio, pisando los que el navegador tenía guardados, y recarga. */
export async function actualizarSitio(publicada) {
  const datos = publicada || await versionPublicada();
  if (Array.isArray(datos?.archivos)) {
    await Promise.allSettled(datos.archivos.map((archivo) => fetch(new URL(archivo, RAIZ), { cache: 'reload' })));
  }
  try { if (datos?.version) sessionStorage.setItem(INTENTO, datos.version); } catch { /* sin almacenamiento */ }
  location.reload();
}
