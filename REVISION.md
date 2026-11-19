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

Las pruebas con hardware APC mini real dependen de que el controlador esté conectado al equipo. La detección y la entrada/salida MIDI se comprobaron con el controlador conectado; la revisión visual de todos los estados de LED sigue siendo recomendable antes de usar la aplicación en directo.
