# CUE PLAYER PAD

Reproductor de cues de 64 pads para **Node.js + Electron**, a partir del sampler original en Python/Tkinter.

La interfaz ocupa toda la ventana: cuadrícula 8×8 de pads, columna de escenas a la derecha, botones de pista sobre los faders, Shift junto al fader master y ocho faders de canal. El master es un riel vertical a la izquierda. El panel **Asignar funciones** está oculto por defecto y se abre como cajón lateral para elegir qué hace cada botón y cada fader, de modo que los pads aprovechan todo el ancho. Los 17 botones que no son pads empiezan **sin asignar**; los botones de pista y escena encienden su LED cuando tienen una función, mientras que Shift solo se resalta en la interfaz porque el APC mini no tiene LED en ese botón. Los botones de pista y escena se dibujan redondos; Shift mantiene forma rectangular.

También incluye **control remoto por web**: un teléfono, una tablet u otro ordenador de la misma red pueden abrir la página de control y manejar pads, master y las acciones principales. El audio siempre se reproduce en el equipo anfitrión, pero el **APC mini puede conectarse al anfitrión o al PC remoto**, indistintamente: en el segundo caso el navegador usa Web MIDI sobre HTTPS y sincroniza los LEDs por la red.

## Características

- 8×8 pads con estados vacío, cargando, cargado, sonando y detenido.
- Clic en un pad vacío para elegir un archivo de audio.
- Clic en un pad cargado para reproducir o detener la pista.
- Menú contextual por pad: cargar/reemplazar, reproducir/detener, silenciar, renombrar, editar volumen, asignar/quitar fader, mover y vaciar.
- Panel **Asignar funciones** para botones, faders de canal y fader master, oculto por defecto y abierto como cajón lateral.
- Botón **Asignar funciones** en la barra superior; el panel se cierra con la ✕, con `Esc` o tocando fuera.
- **Control remoto** desde el navegador de un teléfono, tablet u otro PC de la misma red: 64 pads, master, mute, detener todo y reiniciar LEDs, sin instalar nada ni introducir códigos.
- **APC mini en el anfitrión o en el equipo remoto**: la página HTTPS permite conectar un APC al PC remoto y enviar pads, botones y faders por la red, con LEDs sincronizados.
- Página remota adaptable, pensada para pantallas táctiles, con el estado actualizado en tiempo real.
- Silencio independiente por pista, con indicador visual en el pad.
- Volumen general con fader vertical, teclado y rueda del ratón.
- Ocho faders de canal interactivos, sincronizados con los faders físicos CC 48–55.
- Asignación de los faders del APC mini a pistas concretas y del fader master (CC 56 por defecto).
- Botones de pista (64–71) y de escena (82–89) con acciones configurables: lanzar/parar escena, parar o reproducir columna, silenciar columna, etc. Empiezan sin asignar.
- Shift (98) configurable, también sin asignar de inicio.
- Acciones **Reiniciar LEDs y estados**, **Detener todo** y **Parar última** disponibles en la barra superior y asignables a cualquier botón.
- **Nuevo proyecto** para vaciar pads, mutes, faders y asignaciones.
- **Abrir proyecto…** para cargar un archivo `.cuepad` y reemplazar la sesión actual.
- **Guardar proyecto…** para crear un `.cuepad` autocontenido: configuración, asignaciones y una copia de todos los audios en un solo archivo.
- Pantalla de carga con barra de porcentaje.
- **Ayuda** con el manual básico integrado.
- Retroalimentación de LEDs en los pads y en los botones de pista y escena asignados; los que están sin asignar permanecen apagados. Shift se resalta en la interfaz, pero el APC mini no tiene LED físico en ese botón.
- Espectro de frecuencias en tiempo real.
- **Arranque sin proyecto**: cada inicio deja los pads libres y las asignaciones sin definir; el show se carga desde su `.cuepad`.
- Persistencia automática durante la sesión en `pads.json` como copia de recuperación, sin restaurarse al arrancar.
- Migración automática del `pads.json` de versiones anteriores a la copia de recuperación.
- Copia de seguridad automática si la configuración está dañada.
- Modo demostración para probar la interfaz en un navegador normal.
- Créditos: **Creado por Enrique Bao 2026**.

## Requisitos

- **Node.js 20 o superior** (probado con Node 26).
- **Electron** (se instala con `npm install`).
- **APC mini MK1** para la integración MIDI completa. El MK2 también funciona en lo básico, aunque este proyecto usa el mapa de LEDs del MK1.
- Windows, macOS o Linux con soporte de Web MIDI/Web Audio.

## Instalación y uso

```powershell
npm install
npm start
```

En Windows, si `npm` no está en el PATH:

```powershell
& "C:\Program Files\nodejs\npm.cmd" install
& "C:\Program Files\nodejs\npm.cmd" start
```

## Vista previa sin Electron

Para revisar la interfaz en un navegador:

```powershell
npm run preview
```

Abre `http://127.0.0.1:5173/`.

En este modo:

- Se generan pistas sintéticas para probar reproducción, volumen, espectro y menús.
- La configuración se guarda en `localStorage`.
- La selección de archivos del disco no está disponible; para eso hay que usar `npm start`.
- El control remoto no está disponible en este modo: solo funciona en la aplicación de escritorio.

Para cambiar el puerto:

```powershell
npm run preview -- 5174
```

## Crear ejecutables para otros ordenadores

La aplicación se puede empaquetar para abrirla con doble clic y copiarla a otro equipo. Los ejecutables se generan en la carpeta `dist/`.

### Windows

```powershell
& "C:\Program Files\nodejs\npm.cmd" run dist:win
```

Se generan dos archivos:

- **`CUE PLAYER PAD Setup 2.3.0.exe`** — instalador normal, con accesos directos en el escritorio y el menú Inicio.
- **`CUE-Player-Pad-2.3.0-portable.exe`** — un único archivo que no necesita instalación. Cópialo a otro ordenador Windows y ábrelo con doble clic.

El ejecutable portable guarda la copia de recuperación de la sesión en `%APPDATA%\CUE PLAYER PAD\pads.json`, así que no es portable al 100 %: los archivos de audio y la configuración no viajan dentro del `.exe`. Para llevar una sesión completa a otro equipo, usa **Guardar proyecto…** y el archivo `.cuepad`.

### Linux (AppImage)

El AppImage es un único archivo ejecutable que ya incluye Electron y todas las dependencias de la aplicación. No se instala nada en el sistema.

Para usarlo:

1. Copia `CUE-Player-Pad-2.3.0-x86_64.AppImage` al equipo Linux.
2. Dale permiso de ejecución y ábrelo:

```bash
chmod +x CUE-Player-Pad-2.3.0-x86_64.AppImage
./CUE-Player-Pad-2.3.0-x86_64.AppImage
```

También puedes hacer doble clic si el explorador de archivos permite ejecutarlo.

En Ubuntu 22.04 o superior, Debian 12 y derivados suele hacer falta FUSE 2:

```bash
sudo apt install libfuse2
```

En Ubuntu 24.04 el paquete se llama `libfuse2t64`. Si no quieres instalar FUSE, ejecuta el AppImage extrayéndolo en una carpeta temporal:

```bash
./CUE-Player-Pad-2.3.0-x86_64.AppImage --appimage-extract-and-run
```

Para audio y MIDI no hace falta configuración adicional en la mayoría de equipos: funciona con PipeWire o PulseAudio y con ALSA para el APC mini. Si el controlador no aparece, comprueba que tu usuario tenga acceso al audio y vuelve a iniciar sesión:

```bash
sudo usermod -aG audio "$USER"
```

#### Compilar el AppImage en Linux

Requisitos: Node.js 20 o superior, `npm` y FUSE 2 para ejecutar el resultado.

```bash
npm ci
npm run dist:appimage
```

El resultado queda en `dist/CUE-Player-Pad-2.3.0-x86_64.AppImage`.

`npm run dist:linux` sigue disponible y genera el mismo AppImage junto con el resto de objetivos de Linux configurados. En Windows y macOS no se puede generar directamente porque el AppImage necesita enlaces simbólicos; usa Docker o GitHub Actions.

#### Generar el AppImage desde Windows o macOS

Windows no puede crear los enlaces simbólicos que necesita el AppImage, así que se compila dentro de Docker:

1. Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) y arráncalo.
2. En la carpeta del proyecto ejecuta:

```powershell
npm run dist:appimage
```

El script detecta que no está en Linux y usa la imagen `electronuserland/builder:latest`, monta el proyecto y deja el `.AppImage` en `dist/`. La primera vez descarga la imagen y las dependencias; las siguientes compilaciones reutilizan las cachés de npm y Electron.

Si prefieres forzar Docker también en Linux:

```bash
npm run dist:appimage -- --docker
```

Sin Docker, quedan dos alternativas: compilar en un equipo Linux o usar GitHub Actions.

### Compilar Windows y Linux automáticamente

El proyecto incluye `.github/workflows/build.yml`. Si subes el proyecto a GitHub:

1. Entra en la pestaña **Actions** del repositorio.
2. Abre **Build distributables**.
3. Pulsa **Run workflow**.
4. Al terminar, descarga los artefactos de Windows y Linux desde la misma ejecución.

El flujo también se ejecuta al publicar una etiqueta de versión, por ejemplo `v2.3.0`.

### Aviso de SmartScreen

Los ejecutables no están firmados digitalmente. Windows puede mostrar «Windows protegió su PC»; pulsa **Más información → Ejecutar de todas formas**. Para distribuirlo públicamente sin ese aviso hace falta un certificado de firma de código.

## Controles

### Ratón y teclado

| Acción | Resultado |
| --- | --- |
| Clic en pad vacío | Abre el diálogo para cargar una pista. |
| Clic en pad cargado | Selecciona el pad y reproduce o detiene la pista. |
| Clic derecho en un pad | Selecciona el pad y abre el menú contextual. |
| Clic en un botón de pista o escena | Ejecuta la acción asignada; si no tiene ninguna, lo indica en la barra de estado. |
| Clic derecho en un botón del hardware | Salta al selector de ese botón en el panel **Asignar funciones**. |
| Selector del panel **BOTONES** | Asigna la función de cualquiera de los 17 botones. |
| Selector del panel **FADERS DE CANAL** | Elige qué pad controla cada CC 48–55. |
| **Asignar** del panel **FADER MASTER** | Pone el master en modo aprendizaje: mueve el fader físico que quieras usar. |
| **Quitar todo** | Deja los 17 botones sin asignar. |
| **Nuevo proyecto** | Pide confirmación y vacía pads, mutes, faders y asignaciones. |
| **Abrir proyecto…** | Abre un `.cuepad` con sus audios y reemplaza la sesión actual. |
| **Guardar proyecto…** | Crea un `.cuepad` autocontenido con la sesión y una copia de los audios. |
| **Asignar funciones** | Abre o cierra el cajón lateral con los selectores de botones y faders. |
| **Remoto** | Muestra las direcciones de acceso desde otros dispositivos de la red. |
| **Ayuda** | Abre el manual básico. |
| Botón **Reiniciar LEDs y estados** | Detiene todo y deja las pistas cargadas en amarillo. |
| Clic en un fader de canal | Asigna el volumen de la pista asociada a ese CC. |
| Arrastrar un fader | Cambia el volumen general o el de la pista asociada. |
| Rueda sobre un fader | Ajusta el volumen en pasos pequeños. |
| Flechas, Page Up/Down, Home/End sobre un fader | Ajuste por teclado. |
| `Esc` | Cierra el cajón de asignación; también cancela el modo de asignación de fader o de mover pista. |

Los faders de canal sin ninguna pista asociada aparecen atenuados; al moverlos se indica en la barra de estado que ese CC no controla ningún pad.

### Flujo de asignación de fader

La forma rápida es usar el cajón **Asignar funciones**:

1. Pulsa **Asignar funciones** en la barra superior.
2. En **FADERS DE CANAL**, elige el pad que quieres controlar con cada CC. Al cambiar una asignación se libera el fader que tuviera ese pad.
3. Para el master, pulsa **Asignar** en el panel o en el riel MASTER y mueve el fader físico; **Quitar** lo libera.

También puedes hacerlo desde el pad:

1. Clic derecho en un pad cargado.
2. **Asignar fader…**
3. Mueve el fader físico que quieras usar.

Si un fader ya estaba asignado al master o a otra pista, se libera automáticamente para evitar duplicados.

### Flujo para mover una pista

1. Clic derecho en el pad de origen.
2. **Mover a otro pad…**
3. Pulsa el pad de destino, en la ventana o en el APC.

Si el destino está vacío, la pista se mueve. Si ya tiene una pista, se intercambian. `Esc` cancela.

### Botones del hardware

La distribución sigue al APC mini MK1:

| Elemento | Notas | Acción por defecto |
| --- | --- | --- |
| Botones de pista, sobre los faders | 64–71 | Sin asignar |
| Botones de escena, columna derecha | 82–89 | Sin asignar |
| Shift, sobre el fader master | 98 | Sin asignar |

- La escena 1 es la fila inferior de pads (pads 1–8). El botón 82 está arriba y lanza la escena 8; el 89 está abajo y lanza la escena 1.
- Los botones de pista 64–71 corresponden a las columnas 1–8, de izquierda a derecha.
- Cada botón se puede asignar desde el panel **Asignar funciones** o con clic derecho sobre él. Hay acciones de escena y columna, del pad seleccionado, del master y de navegación, además de **Sin asignar**.
- Al empezar, todos los botones están en **Sin asignar**: elige tú qué hace cada uno, por ejemplo reiniciar LEDs y estados o detener todo.
- **Quitar todo** deja de nuevo los 17 botones sin asignar.
- Los botones de pista y escena **encienden su LED** cuando tienen una función asignada; al volver a **Sin asignar** se apagan. Shift se resalta en la pantalla, pero el APC mini no tiene LED en ese botón.
- Los botones de pista y escena se dibujan redondos en la interfaz; Shift mantiene forma rectangular.

### Mapa MIDI del APC mini MK1

| Elemento | Mensaje |
| --- | --- |
| Pads 1–64 | Note On 0–63 |
| Faders 1–8 | CC 48–55 |
| Fader master | CC 56 (configurable con **Asignar fader**) |
| Botones de pista | Note 64–71 |
| Botones de escena | Note 82–89 |
| Shift | Note 98 |

Estados de LED usados en los pads:

| Estado | Velocidad |
| --- | --- |
| Vacío | 0 (apagado) |
| Cargado | 5 (amarillo) |
| Sonando | 2 (verde, parpadeo del propio APC) |
| Detenido | 3 (rojo) |

Los botones de pista y escena encienden un LED fijo cuando tienen una función asignada; los que están en **Sin asignar** permanecen apagados. El LED no distingue la función concreta, solo indica que el botón está configurado.

El botón **Shift** del APC mini no tiene LED físico, así que la aplicación no puede encenderlo. Al asignarle una función, Shift se resalta en la interfaz con el mismo estilo que los botones asignados; el mensaje MIDI de la nota 98 sigue enviándose, pero el controlador no lo muestra.

El botón de reinicio deja los pads cargados en amarillo (5), los vacíos apagados (0) y vuelve a encender solo los LEDs de los botones asignados.

## Control remoto

El equipo anfitrión comparte una página de control con otros dispositivos de la misma red. El **APC mini puede estar conectado al anfitrión o al PC remoto**: las dos opciones funcionan y se eligen sin cambiar nada en la aplicación.

1. Pulsa **Remoto** en la barra superior.
2. El diálogo muestra el estado del servidor, los puertos y las direcciones disponibles (`Este equipo` y cada interfaz de red, normalmente la Wi-Fi), separadas en dos grupos: **HTTP** para el control táctil y **HTTPS** para usar un APC en el equipo remoto.
3. Copia una de las direcciones y ábrela en el navegador del teléfono, la tablet u otro PC. También puedes escribirla a mano si el otro dispositivo no puede copiarla.

Las direcciones son directas, sin contraseña ni código, por ejemplo:

```text
http://192.168.1.18:8787/
https://192.168.1.18:8788/
```

- El servidor HTTP escucha en el puerto **8787** y el HTTPS en el **8788**. Si alguno está ocupado, prueba los siguientes hasta diez puertos y muestra los reales en el diálogo.
- No hay clave de acceso: cualquier dispositivo de la red que abra la dirección puede controlar la reproducción. Está pensado para una **red cerrada o de confianza** (la Wi-Fi del local, una LAN aislada, etc.).
- Los dos dispositivos deben estar en la misma red (misma Wi-Fi o LAN). No se necesita instalar nada en el teléfono ni en la tablet.

### APC mini en el anfitrión o en el equipo remoto

- **APC en el anfitrión (opción de siempre):** abre la dirección HTTP. El navegador solo envía órdenes; el controlador sigue conectado al equipo que reproduce el audio.
- **APC en el equipo remoto:** abre la dirección **HTTPS**, acepta el aviso de certificado del navegador y pulsa **Conectar APC**. El navegador pide permiso MIDI una vez y desde entonces los pads, los botones de pista/escena, Shift y los faders del APC controlan al anfitrión por la red. Los LEDs del APC remoto se sincronizan con el estado real (con un pequeño retardo).
- Elige una u otra: en Windows **solo un programa puede usar el APC a la vez**, así que no lo tengas conectado simultáneamente a las dos máquinas. Sí puedes moverlo de una a otra cuando quieras.
- El navegador remoto necesita **Web MIDI sobre un contexto seguro**. Funciona en Chrome y Edge de escritorio y en Chrome de Android; Firefox, Safari y los navegadores de iOS no lo admiten. La página HTTP muestra un enlace directo **Usar HTTPS** cuando hace falta.
- El certificado HTTPS es **propio y autofirmado**. Se genera en el primer arranque y se guarda en `%APPDATA%\CUE PLAYER PAD\remote-cert\` (Windows) con una validez de un año; se renueva solo si caduca o si cambia la IP de la red local. El navegador mostrará un aviso de seguridad la primera vez: es normal, continúa y, si quieres, instala el certificado como de confianza en ese equipo.
- Si abres la página HTTPS y el navegador no ofrece Web MIDI, prueba con Chrome o Edge actualizados; algunos navegadores exigen que la conexión sea de confianza para conceder el permiso.

### Qué se puede hacer desde la página remota

- Ver los 64 pads con su nombre y estado (libre, cargado, sonando, detenido o silenciado).
- Tocar un pad para reproducirlo o detenerlo. Los pads vacíos aparecen desactivados.
- Mover el **master**, activar el mute general, **Detener todo** y **Reiniciar LEDs**.
- Con un APC conectado al equipo remoto por HTTPS: pulsar los pads, los 16 botones de pista y escena, Shift y los faders, igual que si estuvieran conectados al anfitrión.
- Ver el cambio en el equipo anfitrión al instante: el estado se envía por SSE y el escritorio aplica la orden.

La página remota **no** carga archivos, no renombra pads, no asigna funciones ni guarda proyectos: esas tareas siguen haciéndose en la ventana de Electron. El audio siempre se reproduce en el equipo anfitrión; solo el APC puede estar en cualquiera de los dos equipos.

### Firewall y redes

- La primera vez, Windows puede preguntar si permites a Electron comunicarse en la red. Marca **Redes privadas**; la regla vale para los puertos 8787 y 8788.
- Si el dispositivo no conecta, comprueba que está en la misma red, que la red está marcada como privada en Windows y que el router no aísla a los clientes entre sí (aislamiento de AP).
- La página HTTP va sin cifrar y sin autenticación dentro de la red local. La página HTTPS usa un certificado autofirmado: cifra el tráfico, pero no sustituye a una autenticación. No publiques ninguna de las dos fuera de tu red ni abras los puertos en el router; si necesitas control desde fuera, usa una VPN.

## Configuración

La aplicación **arranca siempre sin proyecto**: los 64 pads aparecen libres, el master al 100 % y los 17 botones sin asignar. El show se carga a mano desde el archivo `.cuepad` guardado con **Abrir proyecto…**.

Durante la sesión, la configuración se guarda automáticamente en la carpeta de datos de usuario de Electron:

- **Windows:** `%APPDATA%\CUE PLAYER PAD\pads.json`
- **macOS:** `~/Library/Application Support/CUE PLAYER PAD/pads.json`
- **Linux:** `~/.config/CUE PLAYER PAD/pads.json`

Ese `pads.json` es una **copia de recuperación** de la última sesión, no el proyecto que se restaura al arrancar. Al iniciar se conserva como `pads.recuperacion.json` si la sesión anterior tenía pistas o botones asignados; una sesión vacía no sobrescribe esa copia. Para recuperar un show, ábrelo con **Abrir proyecto…** desde su `.cuepad`.

El archivo contiene:

```json
{
  "version": 3,
  "master": 0.85,
  "master_cc": 56,
  "controls": {
    "64": "stop_all",
    "82": "scene_toggle",
    "98": "reset_state"
  },
  "pads": {
    "0": {
      "path": "C:\\Musica\\pista.wav",
      "name": "Mi pista",
      "volume": 0.8,
      "fader": 48
    }
  }
}
```

Los archivos de configuración de versiones anteriores se migran a `pads.json`, que queda como copia de recuperación. Los botones que no tengan una acción válida en `controls` quedan **sin asignar**, sin perder el resto de la configuración.

### Proyectos `.cuepad`

- **Nuevo proyecto** pide confirmación, vacía todos los pads y mutes, deja el master al 100 %, quita los faders y deja los 17 botones sin asignar. Después guarda la sesión vacía en `pads.json`.
- **Guardar proyecto…** abre un diálogo nativo y crea un archivo `.cuepad` autocontenido. Incluye pads, nombres, volúmenes, mutes, faders, master, asignaciones de botones y una copia de cada archivo de audio. Es un formato binario propio, no un JSON legible.
- **Abrir proyecto…** pide confirmación si ya hay pistas cargadas, extrae los audios en la carpeta de datos de la aplicación y reemplaza la sesión actual. La configuración automática (`pads.json`) pasa a apuntar a esos audios extraídos.
- **El `.cuepad` es la fuente de verdad del show.** `pads.json` solo sirve para recuperar la última sesión si algo falla; no se restaura al iniciar.

El contenedor `.cuepad` tiene una firma y un número de versión propios. Cada audio se guarda con su tamaño y su hash SHA-256; al abrir se comprueba el hash y, si un archivo está dañado, el proyecto se rechaza con un aviso en lugar de cargar audio corrupto.

Límites: 512 MB por archivo de audio y 4 GB por proyecto. Si una pista no se puede leer al guardar (archivo movido, borrado o demasiado grande), se omite del `.cuepad` y la barra de estado indica qué pads no se incluyeron. La entrada sigue conservada en `pads.json`.

Los audios extraídos se guardan en:

- **Windows:** `%APPDATA%\CUE PLAYER PAD\proyectos\<id>\`
- **macOS:** `~/Library/Application Support/CUE PLAYER PAD/proyectos/<id>/`
- **Linux:** `~/.config/CUE PLAYER PAD/proyectos/<id>/`

No borres esa carpeta mientras uses el proyecto abierto. Los `.cuepad` originales pueden archivarse o compartirse; el proyecto abierto funciona con la copia extraída.

### Migración desde versiones anteriores

La aplicación ya no restaura `pads.json` al arrancar, pero sigue buscando una copia antigua para conservarla como recuperación en el primer arranque, si todavía no existe `pads.json`:

1. `%APPDATA%\APC mini Sampler\pads.json` (nombre anterior de la aplicación).
2. El `pads.json` junto a `main.js` (versión Python).

La copia encontrada se guarda en `pads.json` y, al iniciar, se conserva como `pads.recuperacion.json`. Para usar ese contenido hay que volver a guardarlo como proyecto `.cuepad` o cargar las pistas de nuevo; no se abre solo.

### Configuración dañada

El arranque no lee `pads.json`, así que un archivo dañado no impide iniciar: la aplicación empieza vacía y conserva el archivo como `pads.recuperacion.json`. Si el archivo te importa, ábrelo y revísalo antes de que la sesión lo reemplace.

### Pistas que no se pueden cargar

Si un archivo de audio se ha movido o eliminado, el pad aparece vacío y la barra de estado indica cuántas pistas no se pudieron cargar. La entrada se conserva en la sesión mientras siga abierta y en `pads.json` como recuperación, pero al reiniciar la aplicación no se restaura: vuelve a abrir el `.cuepad` o carga la pista de nuevo.

## Formatos de audio

Se aceptan los formatos que Chromium puede decodificar con `decodeAudioData`, normalmente:

- WAV
- MP3
- OGG / OGA
- FLAC
- M4A / AAC
- OPUS
- WEBM

El límite de lectura por archivo es de **512 MB**. La decodificación se hace en memoria; archivos muy largos consumen RAM proporcionalmente.

## Estructura del proyecto

```text
main.js                     Proceso principal de Electron, IPC, configuración y protocolo
preload.js                  Puente seguro entre el renderer y Electron
project-format.js           Contenedor .cuepad: cabecera, audios, hash y extracción
remote-server.js            Servidor HTTP y HTTPS con SSE, certificado propio y validación de órdenes
remote/
  index.html                Página de control remoto
  remote.css                Estilos adaptados a teléfono, tablet y escritorio
  remote.js                 Cliente SSE, pads remotos y envío de órdenes
  midi-remote.js            Puente Web MIDI del APC mini conectado al equipo remoto
build/
  icon.png                  Icono de la aplicación
  icon.ico                  Icono para Windows
renderer/
  index.html                Estructura de la interfaz
  styles.css                Tema oscuro, panel hardware, pads, faders, cajón y diálogos
  app.js                    Controlador principal: estado, pads, reproducción, cajón y control remoto
  actions.js                Acciones de los botones del hardware (sin asignar al inicio)
  audio-engine.js           Web Audio, ganancias y decodificación
  midi.js                   Web MIDI y LEDs del APC mini
  spectrum.js               Visualizador FFT
  master-fader.js           Fader vertical accesible
  context-menu.js           Menú contextual accesible
  utils.js                  Constantes y utilidades
  demo-bridge.js            Modo demostración para navegador
tools/
  preview-server.js         Servidor estático para la vista previa
  build-appimage.js         Generación del AppImage en Linux o con Docker
  test-project-format.js    Prueba del contenedor .cuepad sin abrir Electron
.github/workflows/
  build.yml                 Compilación automática para Windows y Linux
```

## Solución de problemas

### Electron no arranca después de `npm install`

Si `npm start` falla con un mensaje como «Electron failed to install correctly» o «Electron binary not found», el binario no se descargó durante la instalación. Fuerza su descarga:

```powershell
node node_modules/electron/install.js
```

Después vuelve a ejecutar `npm start`. En Windows, si `node` no está en el PATH, usa `& "C:\Program Files\nodejs\node.exe" node_modules/electron/install.js`.

### El APC mini no aparece

- Comprueba que esté conectado por USB y que el sistema lo reconozca.
- Cierra otros programas que puedan estar usando el puerto MIDI (Ableton, MPC, etc.).
- Desconecta y vuelve a conectar el APC: la aplicación detecta el cambio mediante `statechange`.
- En macOS puede ser necesario conceder permiso de MIDI a Electron.

### El APC mini MK2 muestra LEDs distintos

Este proyecto usa el mapa de LEDs del MK1. En el MK2 los pads y faders suelen responder, pero algunos colores o modos de parpadeo pueden diferir. La barra de estado avisa cuando detecta un MK2.

### El botón Shift no enciende ningún LED

Es normal: el **APC mini no tiene LED en el botón Shift**, así que ningún programa puede encenderlo. En esta aplicación Shift se resalta en la pantalla cuando tiene una función asignada, igual que los botones de pista y escena, pero el LED físico no existe. Usa otro de los 16 botones redondos si necesitas confirmación luminosa en el controlador.

### El control remoto no abre en el teléfono

- Comprueba que el teléfono y el PC están en la misma red Wi-Fi o LAN.
- Abre exactamente la dirección que muestra **Remoto**, con el puerto correcto.
- Permite a Electron en el firewall de Windows y marca la red como privada.
- Si el puerto 8787 u 8788 estaba ocupado, el diálogo muestra los puertos reales; usa esa dirección.
- Para el APC en el equipo remoto, abre la dirección HTTPS y acepta el aviso del certificado la primera vez.
- Algunos routers aíslan a los clientes Wi-Fi entre sí o separan la red de invitados: en ese caso el teléfono no verá al PC.

### No suena nada

- Haz clic una vez en la ventana: algunos entornos requieren un gesto para habilitar el audio.
- Revisa el volumen general y el volumen de la pista (menú **Editar (volumen)…**).
- Verifica que el archivo no esté corrupto y que su formato sea compatible.

### La configuración no se guarda

- Comprueba permisos de escritura en la carpeta de usuario.
- Revisa `pads.json` y `pads.recuperacion.json` en esa carpeta; son copias de la sesión, no el proyecto del show.
- El proyecto bueno es el `.cuepad`: si algo se pierde, vuelve a abrirlo con **Abrir proyecto…**.

### Ver errores de la interfaz

En modo desarrollo, pulsa `F12` o `Ctrl+Shift+I` para abrir las herramientas de desarrollo.

## Seguridad

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- La interfaz se sirve con un protocolo propio (`apcsampler://`) restringido a la carpeta `renderer`.
- CSP sin scripts inline ni conexiones externas.
- El renderer solo puede usar las operaciones IPC expuestas por `preload.js`: elegir archivo, leer audio, cargar/guardar configuración, consultar la ruta y abrir/guardar proyectos `.cuepad` con diálogo nativo.
- El contenedor `.cuepad` se valida en el proceso principal: firma, versión, límites de tamaño, SHA-256 de cada audio, pads 0–63 e identificador seguro antes de extraer nada. Las rutas absolutas originales no se guardan dentro del proyecto.
- La lectura de audio está limitada a archivos de hasta 512 MB.
- El servidor remoto no pide contraseña y escucha en la red local; está pensado para redes cerradas o de confianza. No lo expongas directamente a Internet.
- Solo se aceptan las órdenes `toggle`, `mute`, `stop_all`, `reset`, `master_mute`, `master`, `control` (notas 64–71, 82–89 y 98) y `fader` (CC 0–127) con notas y volúmenes en rango; el resto se rechaza con `400`. El servidor también limita el tamaño de las órdenes y el número de clientes conectados.
- Las órdenes que abren diálogos nativos, como **Cargar pista**, se ignoran cuando llegan desde el control remoto. La página remota no puede leer, escribir ni borrar archivos del anfitrión.
- El certificado HTTPS se genera en el propio equipo con `selfsigned` y se guarda en la carpeta de datos de usuario. La clave privada no sale de ese equipo y no se incluye en los proyectos `.cuepad`.
- La página remota se sirve desde la carpeta `remote` con una CSP propia y sin acceso al sistema de archivos ni al puente de Electron.
- El servidor remoto no se inicia en el modo de vista previa del navegador.

## Limitaciones conocidas

- Reproducción de una sola vez; no hay bucles, sincronización por BPM ni time-stretching.
- No hay grabación, recorte ni edición de audio.
- Los faders son de 7 bits (CC 0–127); no se usa MIDI de 14 bits.
- Las escenas y los botones de pista trabajan sobre filas y columnas completas; no hay escenas guardadas con nombre ni cambios de tempo.
- Las rutas de audio son absolutas: si mueves o borras el archivo, el pad aparecerá vacío y se avisará en la barra de estado; la entrada se conserva en `pads.json` hasta que cargues otra pista en ese pad.
- Los proyectos `.cuepad` incluyen una copia de los audios y se extraen en la carpeta de datos de la aplicación. Los antiguos proyectos exportados como `.json` no se abren desde **Abrir proyecto…**; solo se aceptan archivos `.cuepad`.
- El modo demostración no permite elegir archivos del disco.
- El control remoto funciona dentro de la red local, sin contraseña y sin acceso desde Internet. Hay dos puertos: HTTP 8787 (control táctil) y HTTPS 8788 (APC en el equipo remoto, con certificado autofirmado).
- En Windows, el APC mini solo puede estar conectado a un programa a la vez: úsalo en el anfitrión o en el PC remoto, no en los dos simultáneamente.
- El APC en el equipo remoto requiere Web MIDI y un contexto seguro: Chrome o Edge de escritorio y Chrome de Android. Firefox, Safari e iOS no lo admiten.
- Los LEDs del APC remoto llegan por SSE con un pequeño retardo; los faders se agrupan cada 60 ms para no saturar la red. El audio sigue sonando siempre en el anfitrión.
- Desde la página remota solo se reproducen pads, se ajusta el master y se usan mute, detener todo y reiniciar LEDs; la carga de archivos, el renombrado, las asignaciones y los proyectos siguen en la ventana de Electron.
- El AppImage no se puede compilar directamente en Windows: usa Docker, un equipo Linux o GitHub Actions.

## Créditos

**CUE PLAYER PAD — Creado por Enrique Bao 2026.**

Proyecto derivado del sampler original en Python/Tkinter. La revisión del código y el detalle de los cambios están en [REVISION.md](REVISION.md).

