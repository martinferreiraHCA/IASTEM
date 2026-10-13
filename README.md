# NOVA · IASTEM

Sistema para una performance en vivo: los estudiantes conversan con NOVA, una
inteligencia artificial de escenario, frente al público y en pantalla gigante.
Las letras **se materializan en el aire**, la voz de quien habla mueve los
visuales, y lo que el grupo va definiendo queda en un muro que se muestra al
final.

NOVA **no improvisa**: todo lo que dice sale de un guion en texto plano que se
le carga antes de la función. Cuando escucha el pie, contesta con su
parlamento; y desde un **panel de control**, en otra ventana o en el celular,
se ve por dónde va y se la maneja a mano. Como opción, un **asistente de
ubicación** con IA ayuda a reconocer el pie cuando lo dicen con otras palabras,
sin escribir nunca lo que NOVA responde.

![modo escenario](docs/escenario.png)

![el muro de acuerdos al cierre](docs/muro.png)

---

## Probala ya

```bash
npm start            # → http://localhost:3000
```

No hace falta configurar nada. Sin Node, la página publicada en GitHub Pages
hace lo mismo; la única diferencia es desde dónde se puede abrir el panel de
control (ver más abajo).

## Qué hace

| | |
|---|---|
| **Guion** | Se carga un guion en texto plano y NOVA dice sus parlamentos cuando escucha el pie. Nada más, nada menos. |
| **Panel de control** | En otra ventana o en el celular: muestra por dónde va NOVA, qué oyó y qué dijo, y permite manejarla. |
| **Asistente de ubicación** | Opcional. Una IA decide a qué pie corresponde lo que se oyó cuando el parecido de palabras no alcanza. Nunca escribe lo que dice NOVA. |
| **Letras estilo Jumanji** | Cada carácter entra como un glifo extraño que muta hasta encontrar su forma. |
| **Nube de palabras** | Las palabras importantes flotan de fondo, crecen si se repiten y se disuelven solas. |
| **Voz en vivo** | Micrófono continuo: el estudiante habla, NOVA reconoce el pie y contesta en voz alta. |
| **La voz que se ve** | El volumen real de quien habla mueve el orbe y la nube: se nota que NOVA lo está escuchando a él. |
| **Turnos** | Cada estudiante tiene nombre y color; la pantalla dice quién habla. |
| **Muro de acuerdos** | Lo que definen junto a NOVA queda fijado y se muestra todo junto al cierre. |
| **Dos vistas** | *Consola* para operar y *Escenario* a pantalla completa para proyectar. |

## El guion

En el botón **Guion** se pega un guion en texto plano, como el de una obra, o
se abre un archivo `.txt`:

```
# Las líneas con numeral son comentarios.
NOVA?: No te escuché bien. ¿Me lo repetís?

ANA: Hola NOVA, ¿nos escuchás?
NOVA: Los escucho. Soy NOVA, la inteligencia de esta muestra.

TOMÁS: ¿Y cómo aprendiste a hablar?
NOVA: Parecido a como aprendiste vos a reconocer perros...

[Un cierre sin pie: se dice a mano]
NOVA: Gracias por esta noche.
```

Las reglas son pocas:

- `NOMBRE: texto`, una línea por parlamento. Las líneas de **NOVA** (también
  vale `IA:`) son lo que ella dice; la línea anterior es su **pie**.
- Cuando alguien dice algo parecido al pie, por voz o por teclado, NOVA
  contesta con el parlamento tal cual, letra por letra y en voz alta.
- `NOVA?: texto` es un **comodín**: lo que dice cuando lo que oye no se parece
  a ningún pie. Puede haber varios; elige uno al azar. Sin comodines, se queda
  callada y el panel avisa qué oyó.
- La comparación es tolerante: ignora mayúsculas, acentos y signos, acepta
  palabras cambiadas y frases dichas con más o menos vueltas. En el panel se
  elige cuánto: *estricta*, *normal* o *amplia*. Pies de cuatro o cinco
  palabras funcionan mejor que un "sí" suelto.
- El guion tiene orden y **el parlamento que sigue corre con ventaja**: si
  dos pies se parecen, gana el que toca. La consola y el panel muestran en todo
  momento qué pie se está esperando.
- Con la tecla **S**, o desde el panel, NOVA dice el parlamento que sigue sin
  esperar el pie. Un parlamento sin pie antes (una apertura, un cierre) solo
  se dice así, o tocándolo en la lista.
- Las líneas que empiezan con `#`, y las acotaciones entre `[corchetes]` o
  `(paréntesis)`, se ignoran. Una línea sin nombre continúa la anterior.
- El guion también sugiere qué se ve en pantalla. `IMAGEN: dirección | pie
  de foto | 10s`, justo antes de un parlamento de NOVA, hace que esa imagen
  **tome toda la pantalla** cuando NOVA lo dice, el tiempo indicado (8
  segundos si no se dice), y después vuelve la vista normal. `CÁMARA:
  encender` o `CÁMARA: apagar` prende o apaga la cámara del público en ese
  momento. Las imágenes van en `public/imagenes/` (ver el `LEEME.txt` de
  ahí) o se enlazan con su dirección completa.

En `docs/guion-german-martin.txt` hay un diálogo de ejemplo listo para cargar.

### El asistente

El parecido de palabras alcanza cuando los estudiantes dicen más o menos lo
escrito. Cuando lo dicen con otras palabras ("¿de dónde sacás lo que sabés?"
en vez de "¿cómo aprendiste?"), o el micrófono transcribe mal, conviene el
asistente: una IA a la que, cada vez que lo oído no coincide con claridad, se
le pregunta **a qué pie corresponde**.

El asistente tiene dos usos, que se eligen en su panel:

- **Solo ubicar el pie.** Contesta un número y nada más. Lo que NOVA dice
  sale del guion, siempre; si no hay pie, comodín o silencio.
- **Ubicar y conversar** (el que viene elegido). Si lo oído no corresponde a
  ningún pie, la IA **improvisa como NOVA**: breve, en el espíritu del guion,
  siguiendo el hilo de la conversación y, si viene al caso, encaminando hacia
  lo que sigue en el guion. Es una sola consulta que decide las dos cosas, y
  la respuesta llega de a pedazos para que las letras arranquen enseguida. En
  el panel se escribe quién es NOVA cuando improvisa: cómo habla y qué sabe de
  la función.

En los dos casos el guion manda: un pie reconocido siempre gana, y la IA solo
habla cuando el guion no tiene nada preparado. Para probar la clave y charlar
con NOVA sin tocar la función está `prueba-api.html`, enlazada desde el panel
Asistente: comprueba la clave, mide cuánto tarda, ubica pies sobre un guion
chico y conversa con memoria. Las respuestas improvisadas se
distinguen en la consola con un borde violeta, y el panel de control las
anota.

Es opcional y funciona con **Claude (Anthropic)** o con **OpenAI**. La
clave puede estar en dos lugares:

| Dónde | Cómo | Para qué |
|---|---|---|
| **En el servidor** | `ANTHROPIC_API_KEY` u `OPENAI_API_KEY` en el `.env` (ver `.env.example`) y `npm start`. Si están las dos, gana Claude. | Lo más seguro: el navegador nunca la ve. |
| **En el navegador** | Botón **Asistente**, arriba a la derecha: elegir con quién, pegar la clave, *Probar* y guardar. | Para el sitio publicado en Pages, que no tiene servidor. Queda en ese navegador y viaja solo a esa API. |

Con Claude usa `claude-opus-5-5` con esfuerzo bajo, que contesta en un segundo
o dos; `claude-haiku-5-5` es más rápido y más barato si se nota la espera. El
modelo se cambia en el mismo lugar que la clave. Cada consulta cuesta una
fracción de centavo y solo se hace cuando el parecido no alcanza.

Sin clave no pasa nada: NOVA ubica los pies por parecido, como siempre. Con
clave, el panel de control muestra "con asistente" junto al progreso, y en el
registro se ve cuándo fue el asistente el que ubicó el pie. Nunca escribas la
clave en el código del repositorio: si es público, queda expuesta apenas la
subas.

## El panel de control

El panel es otra página, `control.html`, que se habla con el escenario. Muestra
en qué está NOVA (escuchando, hablando, en espera), qué fue lo último que oyó y
dijo, el guion con la línea que sigue resaltada, y un registro de lo que fue
pasando. Desde ahí se puede:

- decir el parlamento que sigue, o saltar a cualquiera tocándolo;
- cargar otro guion, volver al principio, apagar el seguimiento;
- cambiar la pantalla: portada, charla, muro, modo escenario;
- prender y apagar el micrófono y la voz; cortar un parlamento;
- poner la cámara del público en pantalla, y esconder o mostrar la imagen
  de este momento;
- pasar el turno al siguiente estudiante y fijar acuerdos en el muro;
- escribir algo para que NOVA lo diga ya, o escribir lo que dijo una persona
  si el micrófono no lo captó.

Hay dos maneras de abrirlo, y el botón **Panel** del escenario las explica:

| Dónde | Cómo | Qué hace falta |
|---|---|---|
| **En la misma computadora** | *Panel → Abrir en otra ventana.* El escenario va al proyector y el panel queda en la pantalla de la notebook. | Nada: anda hasta en GitHub Pages. |
| **Desde el celular** | Correr `npm start` en la computadora que proyecta y abrir en el celular la dirección que muestra la consola, algo como `http://192.168.1.20:3000/control.html`. | Node, y que los dos estén en la misma red Wi-Fi. |

El servidor no guarda nada ni entiende los mensajes: solo releva lo que una
página dice a las demás. Si el panel pierde la señal, lo dice abajo en rojo y se
vuelve a enganchar solo cuando el escenario reaparece.

## Cómo se usa

| Acción | Cómo |
|---|---|
| Hablarle | El micrófono **queda encendido solo**. El botón, o la **barra espaciadora**, lo apagan y lo vuelven a prender |
| Escribirle | Campo de texto, **Enter** para enviar |
| Proyectar | Botón *Modo escenario*, o tecla **F** |
| Volver | **Esc** |
| Cortar un parlamento | Botón *Detener*, o **Esc** mientras habla |
| Silenciar a NOVA | Interruptor *Voz de NOVA* (viene encendida) |
| Empezar de cero | Botón *Limpiar* |

El micrófono se prende solo al abrir la página, si el navegador ya dio el
permiso, y si se cae por algo pasajero se vuelve a prender. Apagarlo es una
decisión: se recuerda hasta que lo vuelvas a prender. Mientras escucha, abajo
del botón se ve lo que va oyendo y un diagnóstico chiquito ("escuchando",
"detecta voz", "transcribiendo", "sin respuesta, reintento 2"), que también se
ve en el panel.

NOVA contesta rápido: si lo que la persona va diciendo ya coincide con
claridad con un pie, **contesta antes de que termine la frase**. Si la
coincidencia es a medias, espera a que termine y deja pasar **0,7 segundos de
silencio**, por si el grupo sigue con otra frase.

### Si el micrófono no transcribe

El reconocimiento de voz lo hace el navegador, y **solo Google Chrome y Edge
lo hacen bien**. En Chromium, Brave u Opera existe pero nunca devuelve nada;
en Firefox no está. También hace falta internet, porque el reconocimiento de
Chrome corre en servidores de Google, y HTTPS o `localhost`, porque por HTTP
desde otra máquina el navegador bloquea el micrófono sin preguntar.

Cuando algo falla, el aviso rojo dice qué fue: el permiso bloqueado, que no
hay micrófono, que el navegador no reconoce voz, o que capta sonido pero no
transcribe. Y en todos los casos la función sigue: **desde el panel de control
se dice cada parlamento a mano**, con el botón grande o tocando la línea, y se
puede escribir lo que dijo la persona para que NOVA lo reconozca igual.

## Conducir la función

### Los turnos

En **Función → Quiénes participan** cargás a los estudiantes. Cada uno recibe un
color. Cuando le toca hablar, la pantalla grande muestra su nombre en ese color:
los padres siguen a su hijo, no a un cursor.

### La cámara del público

Con la tecla **C**, o desde el panel, la gente que está mirando aparece en la
pantalla grande, como en un espejo, y NOVA les sigue hablando encima. Se usa
en los momentos que decidas: una bienvenida, el cierre, un "mírense". En
**Función → Cámara del público** se elige qué cámara usar y se prueba. El guion
también puede prenderla sola en un momento dado, con `CÁMARA: encender`.

### Las imágenes

Cuando el guion sugiere una imagen para un parlamento, al decirlo NOVA la
imagen toma toda la pantalla, con su pie de foto y una línea abajo que
muestra cuánto falta, durante el tiempo que el guion pide; después se
desvanece y vuelve la vista normal, con el texto que NOVA siguió diciendo
mientras tanto. Con la tecla **I** se saca antes de tiempo o se vuelve a
mostrar; en el panel, lo mismo con el botón Imagen, y las líneas que traen
imagen o cámara están marcadas con su tiempo.

### Los acuerdos

Lo que el grupo va definiendo junto a NOVA se fija como tarjeta, con el nombre de
quien lo definió. Al final se muestran todos juntos en el **muro**, y eso es lo
que la gente se lleva de la noche.

De respuestas largas se guarda la primera parte, cortada al final de una frase:
una tarjeta tiene que leerse de lejos, un párrafo entero no.

### Las teclas

Todo se maneja sin mouse, que en vivo es lo que importa:

| Tecla | Qué hace |
|---|---|
| **Espacio** | Apaga el micrófono, y lo vuelve a prender |
| **S** | NOVA dice el siguiente parlamento del guion |
| **C** | Pone y saca la cámara del público en pantalla |
| **I** | Esconde y vuelve a mostrar la imagen de este momento |
| **1** … **9** | De quién es el turno |
| **Tab** | Pasa al siguiente estudiante |
| **A** | Fija la última respuesta en el muro |
| **M** | Muestra el muro completo, y vuelve |
| **P** | Muestra la portada, y vuelve |
| **F** | Entra y sale de pantalla completa |
| **Esc** | Corta el parlamento, o sale del escenario |

Una pregunta nueva vuelve sola a la charla, así que podés dejar el muro puesto
sin miedo a quedarte trabado ahí.

### Todo se guarda

El plantel, los acuerdos, el guion y el punto en que va quedan en el navegador.
Si la máquina se reinicia a mitad de la función, se recupera todo al recargar.
Para empezar de cero, *Función → Borrar todos* y *Guion → Volver al principio*.

## Para la muestra

- **Usá Google Chrome o Edge** en la computadora que proyecta. Son los que
  reconocen voz. El panel, en cambio, anda en cualquier navegador y celular.
- **Dale permiso al micrófono con el público entrando**, no en el momento: el
  cartel del navegador arruina cualquier apertura. Desde ahí queda encendido
  solo, también si recargás la página.
- **Ensayá con los parlantes de la sala.** El micrófono se pausa solo mientras
  NOVA habla para no escucharse a sí misma, pero conviene probarlo.
- **Ensayá con el panel en la mano.** Mirá qué pies no reconoce y ajustá la
  tolerancia o la frase. Lo que no reconozca en vivo, lo decís desde ahí.
- **Poné comodines.** Dos o tres líneas para cuando NOVA no entiende hacen que
  nunca se quede muda.
- **Cargá el plantel antes de empezar**, con los nombres como los van a
  escuchar los padres. Escribirlos en vivo se nota.
- **Arrancá en la portada** (tecla **P**) con la gente entrando, y cerrá con el
  muro (tecla **M**). Entre esas dos placas pasa la función.
- **Fijá pocos acuerdos y buenos.** Ocho tarjetas se leen; treinta no se lee
  ninguna.

## Publicar en GitHub Pages

Ya está publicado y se actualiza solo: **cada push a la rama por defecto vuelve
a publicar el sitio**.

```
https://TU-USUARIO.github.io/IASTEM/
```

Pages sirve la raíz del repositorio, y la página vive en `public/`. Por eso hay
un `index.html` en la raíz que lleva ahí. El panel queda en
`https://TU-USUARIO.github.io/IASTEM/public/control.html`.

GitHub Pages sirve archivos estáticos, así que ahí no corre el servidor: el
panel se abre en otra ventana de la misma computadora, no desde el celular.
Para el celular, `npm start`.

## Cómo está armado

```
public/                  El sitio. Esto es lo que se publica en Pages.
  index.html             El escenario: las dos vistas, consola y proyección
  styles.css             Estética base: orbe, aurora, chat, paneles
  stage.css              Modo escenario y el efecto de letras
  app.js                 Orquestador: une todas las piezas y atiende al panel
  control.html           El panel de control
  control.js             Lo que el panel muestra y manda
  control.css            Su estética, pensada para un celular a oscuras
  js/
    guion.js             El guion: pies, parlamentos, comodines y la comparación tolerante
    enlace.js            El enlace entre escenario y panel: ventana a ventana, o por el servidor
    arbitro.js           El asistente de ubicación: le pregunta a una IA en qué pie estamos
    goteo.js             Entrega un texto de a palabras, como si se pensara
    materialize.js       El efecto Jumanji, letra por letra
    wordcloud.js         La nube de palabras en canvas
    voice.js             Micrófono y voz (Web Speech API)
    audio.js             Mide el volumen real: la voz que mueve los visuales
    show.js              La función: turnos de estudiantes y acuerdos

docs/guion-german-martin.txt   Un guion de ejemplo
index.html               Redirección a public/, para que Pages sirva la app
server.js                Servidor local: archivos estáticos, relevo para el panel y asistente
```

El escenario y el panel se mandan mensajes chicos. Entre ventanas del mismo
navegador van por `BroadcastChannel`, sin servidor. Con `npm start`, además
pasan por el servidor: lo que llega a `POST /api/control` sale por
`GET /api/eventos` a todas las páginas conectadas, y así el panel se abre desde
cualquier dispositivo de la red.

## Ajustes finos

- **Velocidad de las letras** — `charsPerSecond` en `app.js` (`sceneWriter`).
  Más bajo es más dramático; más alto acompaña mejor a la voz.
- **Cuánto silencio espera** antes de contestar — `SILENCE_MS` en `app.js`.
  La anticipación, cuando el pie ya coincide a mitad de frase, está en
  `anticipar()`: el umbral de 0,9 es lo que la hace segura.
- **El ritmo del goteo** de las palabras — las pausas en `goteo.js`.
- **Cuántas mutaciones** hace cada letra antes de fijarse — `mutations` en
  `materialize.js`.
- **Densidad de la nube** — `maxWords` en `wordcloud.js`.
- **Cuánto duran las palabras** — `decay` en `wordcloud.js` (más chico, duran más).
- **Palabras a ignorar** — la lista `STOPWORDS` en `wordcloud.js`.
- **Qué tan parecido tiene que ser el pie** — `TOLERANCIAS` en `guion.js`.
- **Colores** — las variables `--cyan`, `--violet`, `--magenta` arriba de `styles.css`.
- **Puerto del servidor y claves del asistente** — en un archivo `.env` (ver `.env.example`).
- **Qué se le pide al asistente** — `INSTRUCCION`, `instruccionConversar` y
  `PERSONALIDAD` en `arbitro.js`.
