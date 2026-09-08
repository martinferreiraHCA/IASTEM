# NOVA · IASTEM

Interfaz conversacional para proyectar en pantalla gigante. El público le habla,
NOVA responde por la API de ChatGPT, y las letras **se materializan en el aire**
mientras una nube de palabras va dibujando los temas de la charla.

![modo escenario](docs/escenario.png)

---

## Probala ya

No hace falta configurar nada para verla funcionando:

```bash
npm start            # → http://localhost:3000
```

Sin clave configurada arranca en **modo demo**: NOVA contesta con un guion
guardado y todo lo demás —las letras, la nube, el micrófono, la voz— funciona
igual. Sirve para mostrar la página sin gastar un peso.

¿Ni siquiera querés instalar Node? Abrí **`demo/nova-demo.html`** con doble
clic. Es la misma página en un solo archivo, y anda sin internet.

## Qué hace

| | |
|---|---|
| **Letras estilo Jumanji** | Cada carácter entra como un glifo extraño que muta hasta encontrar su forma. |
| **Nube de palabras** | Las palabras importantes flotan de fondo, crecen si se repiten y se disuelven solas. |
| **Voz en vivo** | Micrófono continuo: el público habla, NOVA escucha, piensa y contesta en voz alta. |
| **Dos vistas** | *Consola* para operar y *Escenario* a pantalla completa para proyectar. |
| **Modo demo** | Funciona sin API key, para mostrarla o ensayar. |

## De dónde salen las respuestas

La página se adapta sola a dónde esté corriendo. Hay tres situaciones, y la
diferencia entre ellas es **dónde vive la API key**:

| Modo | Cuándo | Dónde queda la clave |
|---|---|---|
| **Servidor local** | Corrés `npm start` con un `.env` configurado | En el servidor. El navegador nunca la ve. **La más segura.** |
| **Directo** | Sitio estático (GitHub Pages) con una clave cargada desde *Conexión* | En el navegador de esa computadora |
| **Demo** | No hay ni servidor ni clave | No hay clave |

El botón **Conexión** de arriba a la derecha muestra en cuál está y permite
cambiar de uno a otro.

### Con servidor local (recomendado para la muestra)

```bash
cp .env.example .env      # pegá tu clave en OPENAI_API_KEY
npm start
```

Conseguí la clave en [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
El archivo `.env` está ignorado por git, así que no se sube al repo.

Para la muestra en sí, **esta es la opción que conviene**: la clave se queda en
la computadora de la presentación y nadie puede sacarla desde el navegador.

## Publicar en GitHub Pages

El repo ya trae el workflow que publica `public/` en cada push a `main`. El
sitio queda en `https://TU-USUARIO.github.io/IASTEM/`.

### Leé esto antes de publicar

GitHub Pages sirve **archivos estáticos**: no puede correr el servidor Node, así
que ahí no hay dónde esconder una clave. Esto tiene tres consecuencias:

1. **El sitio publicado arranca en modo demo.** Cualquiera que entre ve la
   página funcionando con el guion guardado, sin consumir tu cuenta. Está bien
   que sea así.

2. **Para que piense de verdad hay que cargar la clave desde el botón
   *Conexión*.** Queda guardada en ese navegador, en esa computadora, y viaja
   únicamente a OpenAI. Hacelo antes de la muestra, en la máquina que vas a
   proyectar; no en el momento y delante de todos.

3. **Nunca escribas la clave en el código.** Si el repositorio es público, la
   clave queda expuesta apenas la subas y cualquiera puede gastar tu crédito.
   OpenAI escanea GitHub y suele revocar las claves que encuentra, pero no
   cuentes con que llegue a tiempo. Ponele además un límite de gasto a la clave
   desde el panel de OpenAI.

> Si querés un sitio público que responda de verdad sin exponer la clave,
> hace falta un intermediario que la guarde: una función serverless en
> Cloudflare Workers, Vercel o similar. El `server.js` de este repo ya hace
> exactamente ese trabajo y se adapta con pocos cambios.

## Cómo se usa

| Acción | Cómo |
|---|---|
| Hablarle | Botón del micrófono, o **barra espaciadora** |
| Escribirle | Campo de texto, **Enter** para enviar |
| Proyectar | Botón *Modo escenario*, o tecla **F** |
| Volver | **Esc** |
| Cortar una respuesta | Botón *Detener*, o **Esc** mientras responde |
| Silenciar a NOVA | Interruptor *Voz de NOVA* (viene encendida) |
| Cambiar la conexión | Botón *Conexión* |
| Empezar de cero | Botón *Limpiar* |

Con el micrófono encendido, NOVA espera **1,4 segundos de silencio** antes de
contestar: así un grupo puede hablar en varias frases sin que la respuesta se
dispare a mitad de la idea.

## Para la muestra

- **Usá Chrome o Edge.** Son los que reconocen voz. En Firefox el micrófono
  aparece deshabilitado, pero el chat escrito anda igual.
- **El micrófono necesita HTTPS o `localhost`.** GitHub Pages es HTTPS, así que
  sirve. Si servís desde otra máquina de la red por HTTP, el navegador lo
  bloquea.
- **Dale permiso al micrófono con el público entrando**, no en el momento: el
  cartel del navegador arruina cualquier apertura.
- **Ensayá con los parlantes de la sala.** El micrófono se pausa solo mientras
  NOVA habla para no escucharse a sí misma, pero conviene probarlo.
- **Pedile respuestas cortas** desde *Conexión → Personalidad*. En pantalla
  gigante, un párrafo largo tarda en formarse y se pierde el efecto.
- **Un modelo rápido se siente mejor en vivo.** `gpt-4o-mini` responde casi al
  instante; los grandes se hacen esperar y en escenario se nota.
- **Ensayá en modo demo.** Podés probar toda la puesta en escena sin gastar
  nada, y recién conectar la clave el día de la muestra.

## Cómo está armado

```
public/                  El sitio. Esto es lo que se publica en Pages.
  index.html             Las dos vistas: consola y escenario
  styles.css             Estética base: orbe, aurora, chat, panel de conexión
  stage.css              Modo escenario y el efecto de letras
  app.js                 Orquestador: une todas las piezas
  js/
    api.js               Elige de dónde salen las respuestas y lee el streaming
    materialize.js       El efecto Jumanji, letra por letra
    wordcloud.js         La nube de palabras en canvas
    voice.js             Micrófono y voz (Web Speech API)
  demo/
    engine.js            Elige qué contesta NOVA en modo demo
    replies.json         El guion. Editalo, es texto plano.

server.js                Servidor local: archivos estáticos + proxy a la API
demo/nova-demo.html      La página entera en un archivo, para doble clic
tools/build-demo.js      Genera ese archivo desde los de arriba
```

Con servidor, el navegador nunca habla con OpenAI: le pide a `/api/chat`, y el
servidor —el único que conoce la clave— reenvía y devuelve la respuesta en
streaming. Sin servidor, el navegador llama a OpenAI por su cuenta con la clave
que tenga guardada. En los dos casos la respuesta llega **de a fragmentos**, y
por eso las letras pueden empezar a formarse antes de que la frase termine.

Después de tocar algo en `public/`, regenerá el archivo suelto:

```bash
node tools/build-demo.js
```

## Ajustes finos

- **Velocidad de las letras** — `charsPerSecond` en `app.js` (`sceneWriter`).
  Más bajo es más dramático; más alto acompaña mejor a la voz.
- **Cuántas mutaciones** hace cada letra antes de fijarse — `mutations` en
  `materialize.js`.
- **Densidad de la nube** — `maxWords` en `wordcloud.js`.
- **Cuánto duran las palabras** — `decay` en `wordcloud.js` (más chico, duran más).
- **Palabras a ignorar** — la lista `STOPWORDS` en `wordcloud.js`.
- **Respuestas del modo demo** — `public/demo/replies.json`.
- **Colores** — las variables `--cyan`, `--violet`, `--magenta` arriba de `styles.css`.

## Variables del servidor local

Solo aplican a `npm start`; en Pages se configura todo desde *Conexión*.

| Variable | Para qué | Por defecto |
|---|---|---|
| `OPENAI_API_KEY` | Tu clave. Sin ella, arranca en modo demo. | — |
| `OPENAI_MODEL` | Qué modelo usar | `gpt-4o-mini` |
| `OPENAI_BASE_URL` | Endpoint compatible con OpenAI | `https://api.openai.com/v1` |
| `SYSTEM_PROMPT` | La personalidad de NOVA | NOVA en español rioplatense |
| `PORT` | Puerto del servidor | `3000` |
| `DEMO` | Poné `1` para forzar el modo demo aun con clave | — |

Como `OPENAI_BASE_URL` es configurable, el servidor también sirve contra
cualquier API compatible: Azure OpenAI, OpenRouter, Groq, o un modelo local con
LM Studio u Ollama.
