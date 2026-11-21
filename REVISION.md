# Revisión del código original y registro de la conversión

Este documento resume la revisión del sampler original en **Python/Tkinter** y las decisiones tomadas al reescribirlo en **Node.js + Electron**.

## Resumen

La versión original funcionaba, pero concentraba toda la lógica en el hilo de Tkinter y dependía de `pygame.mixer` para el audio y de `mido` para el MIDI. La conversión mantiene el comportamiento visible y corrige varios problemas que podían provocar pérdida de datos, bloqueos o un comportamiento distinto al esperado.

La aplicación nueva separa responsabilidades:

- **Proceso principal de Electron:** diálogos de archivo, lectura de audio, lectura/escritura de `pads.json` y protocolo de la interfaz.
- **Renderer:** interfaz, estado de los pads, menús, faders y persistencia lógica.
- **Web Audio API:** reproducción, ganancias por pista y análisis FFT.
- **Web MIDI API:** entrada de pads/faders y salida de LEDs.

## Problemas detectados en el código original

### 1. El guardado de configuración podía perder pistas

**Síntoma:** la rutina de guardado reconstruía el contenido de `pads.json` a partir del estado de los pads cargados o de las claves presentes en memoria. Una pista que no se hubiera cargado correctamente, o un guardado disparado en mitad de una operación, podía desaparecer del archivo. Además, la escritura se hacía directamente sobre `pads.json`, sin escritura atómica.

**Impacto:** pérdida silenciosa de la biblioteca de pistas, especialmente si el programa se cerraba durante el guardado.

**Solución en la versión Node.js:**

- `buildConfig()` recorre los 64 pads y guarda **todo pad que tenga ruta y buffer cargado**.
- Las entradas de `pads.json` cuyo archivo no se pudo cargar al arrancar se conservan y se vuelven a escribir en el siguiente guardado, en lugar de desaparecer.
- La escritura se hace en `pads.json.tmp` y después se renombra, de forma atómica.
- Si el JSON está dañado, se conserva una copia en `pads.json.bak` antes de continuar.
- El guardado periódico se aplaza mientras la configuración inicial todavía se está cargando.

### 2. Reemplazar una pista reiniciaba volumen y fader

**Síntoma:** al cargar un archivo nuevo sobre un pad que ya tenía pista, el código reinicializaba el volumen a `1` y el fader a `None`.

**Impacto:** el usuario perdía los ajustes de la pista al corregir o cambiar el archivo.

**Solución:** la carga acepta nombre, volumen y fader como opcionales. En un reemplazo solo se actualizan los campos indicados; el volumen y el fader existentes se conservan. La carga desde configuración sí aplica los valores guardados.

### 3. «Mover» intercambiaba en lugar de mover

**Síntoma:** la operación de mover siempre intercambiaba el contenido de origen y destino, incluso cuando el destino estaba vacío. El pad de origen quedaba ocupado con la pista del destino.

**Impacto:** el resultado no coincidía con lo que el usuario esperaba al elegir «Mover».

**Solución:** el comportamiento ahora es explícito:

- Destino vacío → la pista se mueve.
- Destino ocupado → se intercambian las pistas.
- `Esc` cancela el modo.
- Ambas pistas se detienen antes del traslado para evitar reproducciones huérfanas.
- Los LEDs y el estado visual se actualizan en los dos pads.

### 4. Un `pads.json` corrupto impedía arrancar

**Síntoma:** se llamaba a `json.load()` sin capturar errores. Cualquier edición manual defectuosa o una escritura truncada hacía que la aplicación fallara al iniciar.

**Impacto:** la aplicación quedaba inutilizable hasta borrar el archivo a mano.

**Solución:**

- La lectura y validación se hacen en el proceso principal.
- Si el JSON no es válido, se copia a `pads.json.bak`, se arranca con una configuración vacía y se muestra un aviso persistente en la barra de estado.
- Si el archivo no se puede leer por permisos, se muestra un error y **no se sobrescribe** la configuración existente.

### 5. Mapeo incorrecto de los botones de parada

**Síntoma:** el código original trataba todas las notas `82–89` como «detener todo».

**Impacto:** pulsar un botón de escena o de parada distinto de Stop All detenía todas las pistas, y no era posible distinguir entre «detener todo» y «detener la última».

**Solución inicial:**

- Nota **89** → detener todas las pistas.
- Nota **82** → detener la última pista iniciada.
- Notas **83–88** → sin acción.
- Las constantes están en `renderer/utils.js` (`STOP_ALL_NOTE` y `STOP_LAST_NOTE`) para poder cambiarlas si el controlador envía otro mapa.

**Evolución posterior:** al replicar la distribución física del APC mini, las notas 82–89 pasaron a ser botones de escena y las 64–71 botones de pista. El comportamiento fijo se sustituyó por un registro de acciones configurable (ver más abajo); «Detener todo» y «Detener la última» siguen disponibles como acciones asignables.

### 6. Carga de audio síncrona y sin estado de carga

**Síntoma:** la decodificación y carga de audio se hacían de forma bloqueante en el hilo de la interfaz. Mientras se cargaba un archivo, la ventana no respondía y no había indicador visual. Tampoco se protegía contra clics repetidos sobre el mismo pad.

**Impacto:** sensación de bloqueo y riesgo de cargas duplicadas o fuera de orden.

**Solución:**

- Lectura y decodificación asíncronas.
- Indicador de carga (spinner) en el pad.
- Token de carga por pad: si llega el resultado de una carga antigua, se descarta.
- Los pads conservan su estado anterior mientras se reemplaza una pista.
- Errores por pista con mensaje en la barra de estado.

### 7. Sin reconexión MIDI

**Síntoma:** los puertos MIDI se abrían una sola vez al iniciar. Si el APC mini se desconectaba y volvía a conectarse, la aplicación no recuperaba la entrada ni la salida hasta reiniciarla.

**Impacto:** había que cerrar y abrir la aplicación tras una desconexión USB.

**Solución:**

- Web MIDI `statechange` con actualización con debounce.
- Reasignación de los puertos de entrada y salida.
- Resincronización de todos los LEDs al conectar.
- Aviso en la barra de estado si falta la entrada o la salida.

### 8. Falta de validación de la configuración

**Síntoma:** el JSON se aceptaba sin comprobar tipos ni rangos. Podían entrar notas fuera de `0–63`, volúmenes fuera de `0–1`, faders no numéricos o nombres arbitrariamente largos.

**Impacto:** estados imposibles, LEDs fuera de rango, errores en tiempo de ejecución y archivos difíciles de recuperar.

**Solución:** `sanitizeConfig()` en el proceso principal valida:

- Notas enteras entre 0 y 63.
- `path` como cadena no vacía, limitada a 4096 caracteres.
- `name` como cadena recortada, máximo 200 caracteres.
- `volume` numérico entre 0 y 1.
- `fader` numérico entre 0 y 127, o `null`.

Un fader inválido ahora se convierte en `null`, no en el CC 0 (que asignaría por error el primer fader).

### 9. Los LEDs no se restauraban al arrancar

**Síntoma:** las pistas cargadas desde la configuración no encendían su LED en el APC hasta que el usuario interactuaba con ellas.

**Impacto:** el estado del hardware no reflejaba el estado real de la aplicación.

**Solución:** se sincronizan todos los LEDs después de cargar la configuración y cada vez que el MIDI se conecta o reconecta.

### 10. Errores visibles solo en la consola

**Síntoma:** los fallos de carga, guardado o MIDI se imprimían en la consola y el usuario no recibía información.

**Impacto:** difícil diagnosticar por qué un pad no sonaba o por qué no se guardaba la configuración.

**Solución:**

- Barra de estado con mensajes de éxito, aviso y error.
- Resumen al cargar la configuración: pistas cargadas y pistas que no se pudieron cargar.
- Avisos persistentes para problemas de configuración.
- Modo silencioso durante la carga masiva para no parpadear 64 mensajes.

### 11. Falta de limpieza al cerrar

**Síntoma:** no se garantizaba apagar los LEDs, liberar el audio ni cancelar temporizadores al cerrar.

**Impacto:** LEDs encendidos tras cerrar, recursos retenidos y posibles errores durante el cierre.

**Solución:** en `beforeunload` se cancelan temporizadores, se guarda la configuración de forma síncrona, se apagan los LEDs, se destruye el visualizador y se cierra el `AudioContext`.

### 12. Asignaciones de fader duplicadas

**Síntoma:** nada impedía que el mismo CC quedara asignado al master y a una o varias pistas a la vez.

**Impacto:** un solo fader movía varios volúmenes, con resultados confusos.

**Solución:** antes de asignar un CC se libera de cualquier otro destino (master o pista). Las asignaciones se guardan de forma coherente.

## Rediseño de la interfaz y botones del hardware

La interfaz se reorganizó como una réplica del APC mini MK1 en lugar de una cuadrícula genérica de pads:

- Panel de dispositivo con rejilla de 9 columnas: 8 columnas de pads y una columna de escenas/control.
- Botones de pista sobre los ocho faders de canal, Shift sobre el fader master y master a la derecha.
- Los pads se ordenan como el hardware: la fila superior muestra los pads 56–63 y la inferior los 0–7.
- Inspector lateral con el pad seleccionado, acciones de actuación, reset y master.
- Barra superior con marca, pista en reproducción, espectro, reloj y progreso.
- Diseño responsive para ventanas de 980×660 o más; sin desbordamiento a 1056×856 ni al simular el panel a 980×660.

### Botones que antes no se usaban

El código original solo distinguía las notas 82 y 89; las notas 64–71, 83–88 y 98 no hacían nada. Ahora los 17 botones no-pad tienen una función asignable. Todos empiezan **sin asignar** y el usuario elige qué hace cada uno; estas son las acciones más habituales para cada grupo:

| Botón | Notas | Acción habitual |
| --- | --- | --- |
| Pista | 64–71 | `track_stop`: detener las pistas de su columna |
| Escena | 82–89 | `scene_toggle`: lanzar o parar la fila de pads |
| Shift | 98 | `reset_state`: reiniciar LEDs y estados |

- Las escenas se numeran de abajo arriba: el botón 89 lanza la fila 0 (pads 1–8) y el 82 la fila 7 (pads 57–64).
- El registro `renderer/actions.js` define 18 acciones agrupadas en actuación, escenas y pistas, pad seleccionado, master, navegación y «Sin asignar».
- Cada acción tiene identificador estable, etiqueta, texto corto para el botón e indicación de uso.
- Las asignaciones se editan en **Configurar botones**, se pueden abrir con clic derecho sobre cualquier botón y se restauran con **Restaurar valores**.
- Las acciones inválidas o desconocidas se normalizan a los valores por defecto al cargar la configuración.

### Reinicio de LEDs y estados

El botón **Reiniciar LEDs y estados** (acción `reset_state`, que el usuario puede asignar a cualquier botón del controlador) realiza un reinicio de actuación:

1. Cancela los modos de asignación o movimiento en curso.
2. Detiene todas las fuentes de audio activas y anula sus callbacks.
3. Quita el mute de todas las pistas y del master.
4. Deja cada pad con pista en estado `loaded` (LED 5, amarillo) y cada pad vacío apagado (LED 0).
5. Resincroniza los LEDs de pads y botones y reactiva el master manteniendo su volumen.

Los estados `playing` y `stopped` desaparecen, de modo que el equipo queda en el mismo punto que tras cargar la configuración, antes de empezar a actuar.

### Otras mejoras de interacción

- Pad seleccionado con inspector: reproducir/detener, silenciar, cargar/reemplazar y editar volumen.
- Mute por pista, visible con un patrón rayado y la etiqueta «M».
- Ocho faders de canal interactivos que reflejan y modifican el volumen de la pista asociada a cada CC.
- Los botones de pista y escena muestran un LED fijo cuando tienen una función asignada; los que están sin asignar permanecen apagados. Shift se resalta en la interfaz, pero el APC mini no tiene LED físico en ese botón.
- La configuración pasa a la versión 3 con el bloque `controls`; `sanitizeConfig()` valida notas de control y nombres de acción.

## Qué se conservó del original

- Cuadrícula de 8×8 pads.
- Clic en pad vacío para cargar; clic en pad cargado para reproducir/detener.
- Menú contextual con las operaciones principales.
- Fader master y volumen por pista.
- Asignación de faders físicos.
- Modo de movimiento de pistas y cancelación con `Esc`.
- Persistencia en `pads.json`.
- Mapa de LEDs del APC mini MK1: 0 vacío, 5 cargado, 2 sonando, 3 detenido.
- Uso de notas 0–63 para pads y CC 48–55 / 56 para faders.

## Equivalencias técnicas

| Original (Python) | Versión Node.js |
| --- | --- |
| Tkinter (`Canvas`, botones, diálogos) | HTML + CSS Grid + `<dialog>` + `context-menu.js` |
| `pygame.mixer` | Web Audio API (`AudioContext`, `GainNode`, `AudioBufferSourceNode`) |
| `mido` | Web MIDI API (`requestMIDIAccess`) |
| `json` + `open()` | `fs/promises` en el proceso principal, vía IPC |
| `tkinter.filedialog` | `dialog.showOpenDialog` de Electron |
| Canvas del espectro | Canvas 2D + `AnalyserNode.getFloatFrequencyData` |
| Hilo único de Tk | Renderer asíncrono + proceso principal separado |

## Cambios de comportamiento deliberados

Estos cambios no son solo correcciones: también ajustan el comportamiento para que sea más predecible.

1. **Mover vs. intercambiar:** ahora depende de si el destino está vacío.
2. **Botones de escena, pista y Shift:** empiezan **sin asignar**. El usuario elige su función desde el panel **Asignar funciones**; hay acciones de escena y columna, del pad seleccionado, del master, de navegación y de actuación (reiniciar LEDs, detener todo, parar la última).
3. **Reemplazo de archivo:** conserva volumen y fader de la pista.
4. **Configuración dañada:** se restaura una configuración vacía en lugar de fallar, pero se conserva una copia.
5. **Guardado:** no se escribe nada hasta que la configuración inicial se ha cargado correctamente.
6. **Rutas de audio:** se guardan rutas absolutas devueltas por el diálogo del sistema.
7. **MK2:** se avisa de que se está usando el mapa de LEDs del MK1.

## Mejoras añadidas

- Modo demostración en navegador con pistas sintéticas y configuración en `localStorage`.
- Barra de estado con avisos persistentes y mensajes por tono.
- Indicador de carga por pad y protección contra cargas obsoletas.
- Validación y migración de la configuración.
- Copia de seguridad automática ante JSON corrupto.
- Accesibilidad básica: roles, etiquetas ARIA, navegación por teclado en el menú y el fader.
- Soporte de reconexión MIDI.
- Aviso específico para APC mini MK2.
- Límite de 512 MB por archivo de audio.
- Instancia única: abrir la aplicación de nuevo enfoca la ventana existente.
- El servidor de vista previa rechaza rutas con codificación URI inválida.
- Empaquetado con `electron-builder`: instalador NSIS y ejecutable portable para Windows, y AppImage para Linux.
- Icono propio y flujo de GitHub Actions para compilar ambos sistemas.
- Interfaz rediseñada a pantalla completa: riel de master a la izquierda, pads en el área principal y panel **Asignar funciones** a la derecha.
- Asignación de los 17 botones y de los 8 faders de canal desde el panel derecho, con persistencia en la configuración.
- Pantalla de carga con barra de porcentaje y crédito «Creado por Enrique Bao 2026».
- Botones **Nuevo proyecto**, **Abrir proyecto…** y **Guardar proyecto…**; el guardado usa un contenedor `.cuepad` autocontenido con los audios y el hash de cada pista.
- Manual básico integrado en el diálogo **Ayuda**.
- Botón de reinicio de LEDs y estados, más **Detener todo** y **Parar última** en la barra superior.
- Mute por pista y menú contextual por pad.
- El panel de asignación pasó a ser un cajón lateral oculto por defecto, abierto con el botón **Asignar funciones**, con fondo oscurecido y cierre por ✕, `Esc` o clic fuera; los pads ocupan ahora todo el ancho de la ventana.
- Clic derecho en un botón del hardware abre el cajón y enfoca el selector correspondiente.
- Control remoto por web desde teléfono, tablet u otro PC de la misma red: servidor HTTP/SSE en el proceso principal, página táctil adaptable y órdenes limitadas a pads, mute, master, detener todo y reiniciar LEDs.
- Diálogo **Remoto** con puerto, dirección local y direcciones de cada interfaz de red, con botón de copiar.
- Los 16 botones de pista y escena encienden su LED cuando tienen una función asignada; los que están sin asignar permanecen apagados. Shift solo se resalta en la interfaz porque el controlador no tiene LED en ese botón.
- Botones de pista y escena redondos en la interfaz; Shift mantiene forma rectangular.
- El control remoto ya no usa una clave aleatoria: está pensado para una red cerrada o de confianza y las direcciones son directas.
- `npm run dist:appimage` genera el AppImage en Linux y, en Windows o macOS, lo compila dentro de Docker; `--help` explica las alternativas.

## Verificación

- `npm install` completado. En este equipo el binario de Electron no se descargó en la primera instalación; se resolvió con `node node_modules/electron/install.js`.
- Comprobación de sintaxis con `node --check` de `main.js`, `preload.js`, `renderer/app.js`, `renderer/actions.js`, `renderer/midi.js`, `renderer/master-fader.js`, `renderer/utils.js`, `renderer/demo-bridge.js` y `tools/preview-server.js`.
- Vista previa en navegador con 12 pistas sintéticas: carga inicial, reproducción y parada, fader master con ratón y teclado, menú contextual, renombrar, mover a un pad vacío, intercambiar con un pad ocupado, vaciar, asignar y quitar fader, edición de volumen con cancelar/aceptar, `Esc` para cancelar modos y persistencia en `localStorage`. Sin errores en la consola.
- Prueba de la nueva distribución: 64 pads, 17 botones de control, 8 faders de canal, 1 master y 90 elementos en la rejilla del hardware. Sin desbordamiento a 1056×856.
- Prueba del panel de asignación: 17 selectores de botón y 8 de fader; cambiar el botón 64 a «Detener todo» actualizó su etiqueta, lo marcó como asignado y encendió su LED. El selector de fader reasignó correctamente el CC 48 al pad 2, liberó el fader anterior del pad y actualizó las etiquetas `F1`/`F3`.
- Prueba de **Nuevo proyecto**: tras confirmar, quedaron 0 pistas cargadas, 17 botones sin asignar, los 8 faders vacíos y el master al 100 %.
- Prueba de **Ayuda**: el diálogo abrió con 5 secciones y se cerró con `Esc` sin afectar al estado.
- Prueba de **Guardar proyecto…** (versión anterior): usaba un diálogo nativo y escribía un JSON con el esquema de la configuración. La versión actual lo sustituye por el contenedor `.cuepad` descrito más abajo; el modo demo ya no descarga un JSON.
- Prueba de la pantalla de carga: mostró el avance por etapas y por pista (1/12 … 12/12), llegó al 100 % y se ocultó con el crédito visible; después, 12 pads cargados y 0 errores de consola.
- Prueba de escenas y pistas (versión anterior con botones asignados): el botón de escena 89 lanzó los 4 pads cargados de la fila 0; el botón de pista 64 detuvo solo el pad de su columna.
- Prueba del reinicio: con 3 pistas sonando y 1 parada, Shift (98) dejó 12 pads cargados en amarillo, 0 sonando, 0 parados y sin mutes.
- Prueba de faders: el fader de canal 1 (CC 48) por teclado cambió el volumen del pad 1 al 88 % y actualizó su título y la barra del pad; el fader master pasó del 85 % al 83 %.
- Prueba del menú contextual y renombrado: el menú mostró las 9 opciones esperadas y el nombre editado se guardó y se restauró correctamente.
- El clic derecho en un botón del hardware salta al selector de ese botón en el panel de asignación y resalta su fila.
- Prueba específica de conservación: se sembró una configuración con una pista de demostración válida y otra con una ruta inexistente. Al arrancar se cargó 1 pista y falló 1; después de cambiar el master y esperar al autoguardado, la entrada de la ruta inexistente seguía presente en la configuración guardada.
- Arranque de Electron con depuración remota: 64 pads, configuración leída desde `%APPDATA%\CUE PLAYER PAD\pads.json` y ninguna excepción en el renderer.
- Instancia única comprobada: un segundo proceso de Electron salió inmediatamente mientras la primera instancia seguía abierta.
- Empaquetado de Windows verificado con `electron-builder`: se generaron `CUE PLAYER PAD Setup 2.0.0.exe` (121 MB) y `CUE-Player-Pad-2.0.0-portable.exe` (110 MB) en `dist/` con la nueva interfaz, el panel de asignación, los proyectos, la pantalla de carga y la ayuda. Se eliminaron los artefactos antiguos con el nombre APC.
- El ejecutable portable se arrancó con depuración remota. Migró `%APPDATA%\APC mini Sampler\pads.json` a `%APPDATA%\CUE PLAYER PAD\pads.json` conservando el archivo byte a byte (mismo hash): 2 pistas cargadas, master al 100 %, 17 selectores de botón y 8 de fader. La ventana midió 1184×781 sin desbordamiento, los LEDs de control quedaron apagados porque no había asignaciones guardadas y el modo demo quedó desactivado. El título de la ventana y del documento es `CUE PLAYER PAD`.
- Prueba de tamaño mínimo: la ventana empaquetada se redimensionó a 980×660 (964×621 de área útil). No hubo desbordamiento horizontal ni vertical, los 64 pads quedaron dentro de la ventana con un mínimo de 65×34 px, el panel de asignación mantuvo sus 8 selectores de fader y el riel del master se redujo a 76 px.
- El modo demo quedó desactivado en Electron, la interfaz se sirvió con `apcsampler://` y no aparecieron excepciones en el renderer.
- El AppImage de Linux no se puede generar directamente desde Windows por una limitación de enlaces simbólicos (`EPERM`); se añadió `npm run dist:appimage` con soporte para Linux y Docker, además del flujo de GitHub Actions.
- Prueba funcional en Electron: lectura de un WAV real (38 444 bytes, RIFF), decodificación, reproducción, parada, guardado y recarga de la configuración. El APC mini conectado fue detectado por Web MIDI.

### Verificación del cajón de asignación y del control remoto

- `node --check` de `main.js`, `preload.js`, `remote-server.js`, `renderer/app.js`, `renderer/utils.js`, `renderer/demo-bridge.js`, `remote/remote.js` y `tools/build-appimage.js` sin errores.
- Cajón cerrado al arrancar: `hidden`, `aria-hidden="true"` y `aria-expanded="false"`. La rejilla de pads midió 922 px sobre una ventana de 1056 px (antes 608 px), sin desbordamiento horizontal ni vertical.
- Apertura con **Asignar funciones**: el cajón se deslizó hasta 360 px, el fondo oscurecido apareció, `aria-expanded` pasó a `true` y el foco se colocó en la ✕. `Esc` lo cerró y devolvió el foco al botón.
- Clic derecho en el botón hardware 65: abrió el cajón, resaltó su fila y enfocó su selector.
- En la vista previa del navegador, **Remoto** mostró el aviso de que solo está disponible en la aplicación de escritorio, sin errores de consola.
- Servidor remoto sin clave: la página, `remote.css` y `remote.js` se sirvieron con `200`; `/api/events` y `/api/command` funcionaron sin `?k=` y las peticiones sin código dejaron de recibir `403`.
- Estado inicial por SSE: 64 pads y las pistas de la configuración cargada. Las órdenes `master` cambiaron el master del escritorio de 100 % a 60 % y de vuelta a 100 %; `stop_all` detuvo las pistas reproducidas y el nuevo estado llegó por SSE.
- Las órdenes desconocidas o con parámetros fuera de rango se rechazan con `400` en el servidor y también se validan en el renderer.
- Página remota con viewport emulado de 390×844: `innerWidth` y `scrollWidth` de 390 px, 4 columnas, el botón más ancho termina en 376 px, conexión «Conectado» y solo desplazamiento vertical.
- Diálogo **Remoto** en Electron: puerto 8787 y dos direcciones (equipo local y Wi-Fi `192.168.1.18`), sin código de acceso.
- Botones de pista y escena redondos (56×56 y 44×44 px, `border-radius: 50%`) y Shift rectangular (82×56, 12 px). Al asignar «Detener todo» al botón 64 y «Lanzar o parar escena» al 82, ambos pasaron a `is-assigned`, con `data-led="1"`. Shift también pasó a `is-assigned` con `data-led="1"` al asignarle «Reiniciar LEDs y estados», y volvió a `data-led="0"` al ponerlo en «Sin asignar»; los botones sin asignar mantuvieron `data-led="0"`. Ese `data-led="1"` de Shift es solo un indicador de la interfaz: la nota 98 con velocidad 1 se envía al controlador, pero el LED físico no existe.
- Empaquetado de Windows reconstruido con los LEDs, los botones redondos, el remoto sin clave y el script de AppImage: `CUE PLAYER PAD Setup 2.0.0.exe` (115,7 MB) y `CUE-Player-Pad-2.0.0-portable.exe` (105,3 MB).
- Prueba del paquete `win-unpacked`: 64 pads, 36 pistas cargadas, pantalla de carga terminada en «Listo», cajón oculto, LEDs de los botones de pista y escena asignados (`82:1`, `89:1`) con el resto en `0`, Shift rectangular y resaltado como asignado en la interfaz, sin desbordamiento horizontal ni vertical.
- Cajón dentro del paquete: abrió a 360 px con 25 selectores y el foco en la ✕; al cerrarlo, el foco volvió a **Asignar funciones**, `hidden` y `aria-expanded="false"`.
- Contra el paquete, el servidor remoto respondió `200` a `index.html`, `remote.css`, `remote.js` y `/api/events` sin clave; `master` cambió el volumen a 50 % y de vuelta a 100 % con los estados llegando por SSE; `shutdown`, la nota 99 y el volumen 4 se rechazaron con `400`.
- `npm run dist:appimage -- --help` mostró las instrucciones y, sin Docker en este equipo, el script terminó con un mensaje claro y código 1 en lugar de fallar con `EPERM`.

### Comprobación del LED de Shift

- El controlador conectado en este equipo es un **APC MINI MK1** (`APC MINI`, `mk2=false`), con entrada y salida MIDI conectadas.
- Se envió la nota 98 con velocidad 1 al asignar una función a Shift y no se produjo ningún cambio visible en el botón físico.
- El protocolo de Akai para el APC mini mk2 lista el botón Shift con LED `None`; el APC Key 25 mk2 hace lo mismo con su Shift. La documentación de la comunidad y las fotos del panel MK1 coinciden: los 16 botones redondos tienen ventana de LED y el botón Shift es opaco.
- **Conclusión:** el APC mini no tiene LED direccionable en Shift. La aplicación mantiene el resaltado `is-assigned`/`data-led="1"` en pantalla como indicador y sigue enviando la nota 98 por compatibilidad, pero el hardware no puede encenderlo. El texto de ayuda, el README y los comentarios del código se ajustaron para no prometer un LED que no existe.

### Formato de proyecto `.cuepad`

- Se añadió `project-format.js`, un contenedor binario propio con firma `CUEPAD01`, versión de formato y cabecera JSON.
- La cabecera guarda la configuración completa (pads, nombres, volúmenes, mutes, faders, master y asignaciones) y una lista de audios con tamaño, tipo MIME y SHA-256. Los audios se escriben a continuación, en el mismo orden.
- Las rutas absolutas originales no se incluyen en el proyecto: cada pad apunta a una marca `@audio:<nota>` que se resuelve al extraer.
- **Guardar proyecto…** crea el `.cuepad` con escritura temporal y renombrado atómico. Si un audio no se puede leer, se omite y se devuelve la lista de pads afectados; el proyecto sigue siendo válido.
- **Abrir proyecto…** valida firma, versión, límites (512 MB por audio, 4 GB total), pads 0–63, identificador seguro y SHA-256 de cada audio. Después extrae a `<userData>/proyectos/<id>/` y devuelve la configuración con las rutas extraídas.
- El renderer reemplaza la sesión actual, carga las pistas extraídas y vuelve a programar el autoguardado. Si ya había contenido, el proceso principal pide confirmación antes de abrir el diálogo.
- La UI incorpora **Abrir proyecto…**, la ayuda y el README explican el formato, y el modo demo ya no genera un JSON de descarga.
- Prueba `node tools/test-project-format.js`: 2 audios incrustados, 1 pista inexistente omitida, cabecera sin rutas absolutas, extracción byte a byte idéntica, configuración y controles conservados, y rechazo de un proyecto con un byte alterado o con firma incorrecta.
- Verificación de sintaxis de `project-format.js`, `main.js`, `preload.js` y `renderer/app.js` sin errores.
- Flujo real en Electron con diálogos nativos: **Guardar proyecto…** escribió un `.cuepad` de 75 439 741 bytes y **Abrir proyecto…** lo volvió a cargar con 36 pistas, master al 32 % y las asignaciones `82 stop_last`, `85 master_mute`, `89 stop_all` y `98 reset_state`.
- La lectura de `pads.json` tolera ahora el BOM UTF-8 (`\uFEFF`) heredado de algunas herramientas de edición, en lugar de rechazar la configuración como archivo dañado.
- Empaquetado de Windows 2.1.0: `CUE PLAYER PAD Setup 2.1.0.exe` (115,7 MB) y `CUE-Player-Pad-2.1.0-portable.exe` (105,3 MB); `project-format.js` está incluido en `app.asar`.
- Prueba del paquete 2.1.0 con un perfil nuevo: 64 pads sin desbordamiento, botones **Abrir proyecto…** y **Guardar proyecto…** visibles y ayuda con el formato `.cuepad`. Al abrir el proyecto de prueba se cargaron 36 pistas desde `proyectos\<id>\` del perfil, con master al 32 % y controles conservados; al volver a guardar se generó un `.cuepad` válido de 75 439 747 bytes con firma `CUEPAD01`, versión de aplicación 2.1.0, 36 audios y ningún audio omitido.

### APC mini en el anfitrión o en el equipo remoto (2.2.0)

El APC mini puede conectarse al servidor del rack o al PC remoto, indistintamente. El audio se reproduce siempre en el anfitrión; el navegador remoto solo envía órdenes y, si el APC está en el PC remoto, también recibe el estado para sus LEDs.

- **Doble escucha en `remote-server.js`:** HTTP en 8787 (control táctil) y HTTPS en 8788 (Web MIDI) al mismo tiempo. Cada uno busca un puerto libre entre el suyo y los nueve siguientes; `/api/info` indica `httpPort`, `httpsPort` y si la petición llegó cifrada.
- **Certificado autofirmado:** se genera con `selfsigned@^5.5.0` (RSA 2048, SHA-256) en `<userData>/remote-cert/{key.pem,cert.pem,meta.json}`. Los nombres alternativos cubren `localhost`, `127.0.0.1` y las IP de la red local; se reutiliza mientras no caduque (margen de 30 días) y la lista de IP siga siendo válida, y se regenera si cambia la red. Validez de 365 días.
- **Puente Web MIDI (`remote/midi-remote.js`):** botón **Conectar APC** con permiso explícito del navegador, selección del puerto `APC MINI`, reacción a `statechange`, y desconexión limpia. Las notas 0–63 envían `toggle`; las notas 64–71, 82–89 y 98 envían `control`; los CC envían `fader`. Los note-off se ignoran y los faders se agrupan cada 60 ms.
- **LEDs remotos:** el estado SSE incluye `pads[].led` y el mapa `controls` (0/1). El puente compara con lo último enviado y solo emite los cambios por la salida MIDI, de modo que los LEDs siguen reproducción, parada, mute y asignaciones.
- **Órdenes nuevas:** `control` (solo notas válidas del APC) y `fader` (CC entero 0–127 y valor 0–1), validadas en el servidor y aplicadas en `renderer/app.js` mediante `executeControl(..., { source: 'remote' })` y `applyCC`. `load_selected` se bloquea desde remoto para no abrir un diálogo nativo en el rack. `handleCC` se dividió en `applyCC` para compartir la lógica MIDI local y remota.
- **Interfaz:** el diálogo **Remoto** agrupa las direcciones HTTP y HTTPS con explicaciones; la página remota muestra una tarjeta APC con enlace **Usar HTTPS** cuando se abre por HTTP, y el estado del puerto cuando ya es segura. La ayuda del programa y el README documentan la doble topología, la advertencia del certificado y los navegadores compatibles.
- **Prueba automática `tools/test-remote-server.js`:** HTTP y HTTPS activos, `/api/info` con `secure` correcto en cada protocolo, página y `midi-remote.js` servidos, 10 órdenes válidas aceptadas, 8 inválidas rechazadas con 400 y certificado reutilizado tras reiniciar el servidor. Resultado: `ok: true`.
- **Prueba real con Chrome 155 y Electron:** la página HTTPS carga con `isSecureContext: true`, el puente expone el botón y un APC simulado recibe 81 mensajes de LED al conectar (64 pads y 17 controles). Al inyectar MIDI: nota 0 reproduce el pad en el anfitrión, CC 56 cambia el master al 50 % y el botón 82 detiene la pista; los LEDs del pad pasan a 2 (sonando) y 3 (parado). La misma prueba por HTTP confirma que la página sirve la tarjeta APC y el enlace a HTTPS.
- **Comprobación de seguridad:** el POST desde la página HTTPS falla con `ERR_CERT_AUTHORITY_INVALID` hasta aceptar el certificado, justo el aviso que verá el usuario la primera vez; con la excepción aceptada, todas las órdenes llegan al anfitrión.
- **Limitación real:** en Windows solo un programa puede poseer el APC a la vez. Con Electron abierto, Chrome no enumera el dispositivo en el mismo equipo; la topología prevista usa dos PCs distintos o el APC en uno solo de ellos.
- Verificación de sintaxis de `main.js`, `preload.js`, `project-format.js`, `remote-server.js`, `remote/remote.js`, `remote/midi-remote.js` y `renderer/app.js` sin errores.
- **Empaquetado de Windows 2.2.0:** `CUE PLAYER PAD Setup 2.2.0.exe` (116,1 MB) y `CUE-Player-Pad-2.2.0-portable.exe` (105,6 MB). El `app.asar` contiene `remote-server.js`, `remote/midi-remote.js` y `node_modules/selfsigned` con sus dependencias de `@peculiar`.
- **Paquete 2.2.0 verificado en ejecución:** HTTP 8787 y HTTPS 8788 activos; `/api/info` devuelve `secure: false` por HTTP y `secure: true` por HTTPS. El certificado tiene `CN=CUE PLAYER PAD`, validez hasta noviembre de 2027 y SAN `localhost`, `127.0.0.1` y la IP `192.168.1.18`. La página y `midi-remote.js` (7791 bytes) se sirven por HTTPS, la tarjeta APC aparece y el diálogo **Remoto** muestra los grupos HTTP y HTTPS con las cuatro direcciones. Los botones **Nuevo proyecto**, **Abrir proyecto…** y **Guardar proyecto…** siguen presentes, la pantalla de carga termina y el MIDI local detecta el APC.
- El servidor acepta las seis órdenes válidas probadas (`master`, `control`, `fader`, `toggle`, `mute`, `stop_all`) y rechaza con `400` un CC fuera de rango, una nota negativa y `load_selected`; una orden de más de 4 KB corta la conexión como protección. En `control`, las notas 64–71, 82–89 y 98 son válidas (la 70 es un botón de pista correcto) y el resto se rechaza.

### Arranque sin proyecto (2.3.0)

- El arranque ya no restaura `pads.json`. `config:load` devuelve siempre `DEFAULT_CONFIG`: 64 pads libres, master al 100 %, `master_cc` 56 y los 17 botones sin asignar. El show se carga a mano con **Abrir proyecto…** desde un `.cuepad`.
- Antes de empezar de cero, el proceso principal lee `pads.json` y, si tiene pistas o controles asignados, lo copia a `pads.recuperacion.json`. Una sesión vacía no reemplaza esa copia, de modo que el último show real sigue disponible aunque se abra y cierre la aplicación sin cargar nada. Un archivo dañado también se conserva sin bloquear el arranque.
- La sesión de trabajo se sigue guardando en `pads.json` (autoguardado cada 600 ms y al cerrar) como copia de recuperación, pero no se lee al iniciar.
- La pantalla de carga muestra «Preparando una sesión vacía…» y, al terminar, la barra de estado queda con «Sesión vacía · Abre un proyecto .cuepad para cargar el show». La ayuda integrada y el README explican que el `.cuepad` es la fuente de verdad.
- Verificación en Electron: con un perfil que tenía 36 pistas, master 50,4 % y 17 controles asignados, el arranque mostró 64 pads, **0 cargados**, master 100 %, 17 botones sin asignar y el aviso de sesión vacía. `pads.json` y `pads.recuperacion.json` conservaron las 36 pistas; al cerrar, `pads.json` guardó la sesión vacía y la copia de recuperación siguió intacta.
- Segunda verificación: con `pads.json` vacío y una copia de recuperación con contenido, el arranque no modificó `pads.recuperacion.json` (misma marca de tiempo).
- La apertura de proyectos `.cuepad` no cambia: `tools/test-project-format.js` sigue pasando (2 audios incrustados, 1 omitido, extracción idéntica y rechazo de proyectos alterados).
- **Empaquetado de Windows 2.3.0:** `CUE PLAYER PAD Setup 2.3.0.exe` (116,1 MB) y `CUE-Player-Pad-2.3.0-portable.exe` (105,6 MB).
- **Paquete 2.3.0 verificado en ejecución:** con un perfil de 36 pistas, la ventana arrancó con 64 pads, 0 cargados, master 100 %, 17 botones sin asignar y el aviso de sesión vacía; `pads.recuperacion.json` conservó las 36 pistas. HTTP 8787 y HTTPS 8788 siguen activos, `/api/info` responde, la página y `midi-remote.js` se sirven por HTTPS, el certificado se genera en el perfil y las órdenes válidas responden `200` mientras una nota de control inválida responde `400`. El diálogo **Remoto** mostró los grupos HTTP y HTTPS con las cuatro direcciones. Al cerrar la ventana, `pads.json` guardó la sesión vacía y la copia de recuperación siguió intacta con 36 pistas.

### Carga remota de proyectos y orden de pads (2.4.0)

- El servidor remoto incorpora `POST /api/project`: recibe el `.cuepad` por streaming en un archivo temporal, sin cargarlo entero en memoria. Acepta hasta **4 GB**, exige la extensión `.cuepad`, admite una sola carga simultánea y borra el temporal tanto si la carga termina como si falla. Si la conexión deja de enviar datos durante dos minutos, libera el bloqueo; el límite global de petición se amplió a 30 minutos para proyectos grandes.
- El proceso principal valida y extrae el proyecto con `readProjectFile` **antes** de tocar la ventana. Después envía la configuración al renderer por IPC con un token y espera su confirmación (máximo 10 minutos). El navegador solo recibe un resumen: nombre, tamaño, pistas cargadas, audios y pads ausentes; nunca rutas del servidor.
- El renderer prepara el proyecto en dos fases: primero lee y decodifica **todas** las pistas nuevas mientras la sesión actual sigue sonando; solo cuando no hay fallos detiene el show actual y cambia los pads. Si un audio no se puede decodificar o falta, el proyecto no se aplica y la sesión anterior queda intacta.
- La página remota incluye una tarjeta **Proyecto en el servidor** con selección de archivo, arrastrar y soltar, barra de progreso, confirmación de reemplazo y mensajes de error reintentables. El envío usa `XMLHttpRequest` con un margen de 20 minutos.
- Se corrigió el orden visual de los pads en el navegador: la fila superior es ahora **56–63**, seguida de 48–55, hasta 0–7 abajo, igual que la ventana principal y el APC. Antes el navegador los mostraba de 0–63 y el orden quedaba invertido.
- La sesión actual tampoco se toca durante la validación ni la preparación de un proyecto abierto desde el diálogo nativo: ambos flujos comparten la misma carga previa.
- Pruebas del servidor (`tools/test-remote-server.js`): subida válida `200`, archivo inválido `400`, archivo vacío `400`, tamaño excedido `413`, dos cargas simultáneas `200`/`409`, tres llamadas al manejador y carpeta temporal vacía al terminar.
- Prueba real de extremo a extremo con un `.cuepad` de **75.439.741 bytes y 36 pistas**: la subida HTTP terminó en 21,4 s con `200`, `loaded: 36` y sin pads ausentes. La ventana mostró 36 pads cargados y master 32 %; la página remota mostró el orden `56,57,58,59,60,61,62,63,48,49…`, 36 pads cargados y el nombre `prueba-integracion.cuepad`.
- Pruebas de error en la página remota: un `.cuepad` con audio no decodificable devolvió `400` con «La sesión actual sigue activa» y dejó intactas las 36 pistas; un archivo con formato inválido devolvió `400` sin cambios. Después se subió desde la propia interfaz web un proyecto de 1 pista (812 KB): progreso al 100 %, proyecto activo en el servidor y 1 pad cargado. Un segundo intento con audio roto mostró el error en la tarjeta y mantuvo ese pad.
- **Empaquetado de Windows 2.4.0:** `CUE PLAYER PAD Setup 2.4.0.exe` (116,1 MB) y `CUE-Player-Pad-2.4.0-portable.exe` (105,6 MB); se eliminaron los artefactos 2.3.0 de `dist/`.
- **Paquete 2.4.0 verificado en ejecución:** con un perfil de recuperación de 1 pista, la ventana arrancó con 64 pads, 0 cargados, master 100 %, 17 botones sin asignar, fila superior 56–63 y el aviso de sesión vacía. Se subió por HTTP el proyecto de 75.439.741 bytes: `200` en 21,0 s, 36 pads cargados, master 32 %, orden `56,57,58,59,60,61,62,63,48,49…`, carpeta `remote-uploads` vacía y `pads.json` con 36 pistas mientras `pads.recuperacion.json` conservó la sesión anterior. La página servida por el paquete mostró el mismo orden y el proyecto activo.
- **Cierre de esperas y mensajes de red:** si la ventana se cierra o el renderer se cae durante una carga remota, la espera IPC termina inmediatamente en lugar de agotar los 10 minutos. Si el navegador se desconecta antes de que el servidor empiece a aplicar, la carga se descarta y el temporal se borra; si el archivo ya estaba completo, el servidor termina de aplicarlo de forma transaccional y la página lo refleja al reconectar. Los avisos de error o tiempo de espera ya no afirman que la sesión sigue intacta cuando el servidor pudo haber terminado de aplicarla: piden comprobar el estado al reconectar.

Las pruebas con hardware APC mini real dependen de que el controlador esté conectado al equipo. La detección y la entrada/salida MIDI se comprobaron con el controlador conectado; la revisión visual de todos los estados de LED sigue siendo recomendable antes de usar la aplicación en directo.
