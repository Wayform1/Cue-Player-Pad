// Botones físicos del controlador que no son pads.
// 64..71  = botones de pista (encima de los faders 48..55)
// 82..89  = botones de escena (columna derecha)
// 98      = Shift (encima del fader master)
export const TRACK_NOTES = Object.freeze([64, 65, 66, 67, 68, 69, 70, 71]);
export const SCENE_NOTES = Object.freeze([82, 83, 84, 85, 86, 87, 88, 89]);
export const SHIFT_NOTE = 98;
export const CONTROL_NOTES = Object.freeze([...TRACK_NOTES, ...SCENE_NOTES, SHIFT_NOTE]);

export const ACTION_GROUPS = Object.freeze([
  ['performance', 'Actuación'],
  ['scene', 'Escenas y pistas'],
  ['pads', 'Pad seleccionado'],
  ['master', 'Volumen general'],
  ['navigation', 'Navegación'],
  ['none', 'Sin asignar'],
]);

export const ACTIONS = Object.freeze([
  {
    id: 'none',
    label: 'Sin asignar',
    short: '—',
    group: 'none',
    hint: 'El botón no hace nada.',
  },
  {
    id: 'reset_state',
    label: 'Reiniciar LEDs y estados',
    short: 'RESET',
    group: 'performance',
    hint: 'Detiene todo y deja las pistas cargadas en amarillo, listas para empezar.',
  },
  {
    id: 'stop_all',
    label: 'Detener todo',
    short: 'TODO',
    group: 'performance',
    hint: 'Detiene todas las pistas que estén sonando.',
  },
  {
    id: 'stop_last',
    label: 'Detener la última pista',
    short: 'ÚLTIMA',
    group: 'performance',
    hint: 'Detiene la pista que empezó a sonar más recientemente.',
  },
  {
    id: 'scene_toggle',
    label: 'Lanzar o parar escena (fila)',
    short: 'ESCENA',
    group: 'scene',
    hint: 'En un botón de escena lanza o para la fila de pads correspondiente.',
  },
  {
    id: 'track_stop',
    label: 'Parar pistas de la columna',
    short: 'PARAR',
    group: 'scene',
    hint: 'En un botón de pista detiene las pistas de su columna.',
  },
  {
    id: 'track_play',
    label: 'Reproducir columna',
    short: 'PLAY',
    group: 'scene',
    hint: 'Reproduce o detiene todas las pistas cargadas de la columna.',
  },
  {
    id: 'track_mute',
    label: 'Silenciar columna',
    short: 'MUTE',
    group: 'scene',
    hint: 'Silencia o recupera todas las pistas cargadas de la columna.',
  },
  {
    id: 'toggle_selected',
    label: 'Reproducir o parar el pad seleccionado',
    short: 'PLAY PAD',
    group: 'pads',
    hint: 'Alterna la reproducción del pad marcado en el inspector.',
  },
  {
    id: 'stop_selected',
    label: 'Detener el pad seleccionado',
    short: 'STOP PAD',
    group: 'pads',
    hint: 'Detiene el pad marcado en el inspector.',
  },
  {
    id: 'mute_selected',
    label: 'Silenciar el pad seleccionado',
    short: 'MUTE PAD',
    group: 'pads',
    hint: 'Silencia o recupera el pad marcado en el inspector.',
  },
  {
    id: 'clear_selected',
    label: 'Vaciar el pad seleccionado',
    short: 'VACIAR',
    group: 'pads',
    hint: 'Quita la pista del pad marcado en el inspector.',
  },
  {
    id: 'load_selected',
    label: 'Cargar pista en el pad seleccionado',
    short: 'CARGAR',
    group: 'pads',
    hint: 'Abre el selector de archivos para el pad marcado en el inspector.',
  },
  {
    id: 'master_mute',
    label: 'Silenciar el volumen general',
    short: 'MUTE M',
    group: 'master',
    hint: 'Activa o desactiva el mute del volumen general.',
  },
  {
    id: 'master_up',
    label: 'Subir el volumen general',
    short: 'M +',
    group: 'master',
    hint: 'Sube el volumen general un 10 %.',
  },
  {
    id: 'master_down',
    label: 'Bajar el volumen general',
    short: 'M −',
    group: 'master',
    hint: 'Baja el volumen general un 10 %.',
  },
  {
    id: 'select_prev',
    label: 'Seleccionar el pad anterior',
    short: '◀ PAD',
    group: 'navigation',
    hint: 'Mueve la selección al pad anterior que tenga una pista.',
  },
  {
    id: 'select_next',
    label: 'Seleccionar el pad siguiente',
    short: 'PAD ▶',
    group: 'navigation',
    hint: 'Mueve la selección al pad siguiente que tenga una pista.',
  },
]);

const ACTION_MAP = new Map(ACTIONS.map((action) => [action.id, action]));

export function isKnownAction(id) {
  return typeof id === 'string' && ACTION_MAP.has(id);
}

export function actionInfo(id) {
  return ACTION_MAP.get(id) || ACTION_MAP.get('none');
}

export function controlKind(note) {
  if (TRACK_NOTES.includes(note)) return 'track';
  if (SCENE_NOTES.includes(note)) return 'scene';
  if (note === SHIFT_NOTE) return 'shift';
  return null;
}

export function controlSlot(note) {
  if (TRACK_NOTES.includes(note)) return note - TRACK_NOTES[0];
  if (SCENE_NOTES.includes(note)) return note - SCENE_NOTES[0];
  return null;
}

// Las escenas se numeran de abajo arriba: la fila 1 es la de los pads 0..7.
// El botón 82 está arriba del todo y lanza la fila 8; el 89 lanza la fila 1.
export function sceneRowFor(note) {
  if (!SCENE_NOTES.includes(note)) return null;
  return SCENE_NOTES[SCENE_NOTES.length - 1] - note;
}

export function controlTitle(note) {
  if (TRACK_NOTES.includes(note)) return `Pista ${note - TRACK_NOTES[0] + 1}`;
  if (SCENE_NOTES.includes(note)) return `Escena ${sceneRowFor(note) + 1}`;
  if (note === SHIFT_NOTE) return 'Shift';
  return `Botón ${note}`;
}

// Todos los botones del hardware empiezan sin función: el usuario decide qué
// hace cada uno desde el diálogo de asignación.
export function defaultControls() {
  const controls = {};
  for (const note of CONTROL_NOTES) controls[note] = 'none';
  return controls;
}

export function normalizeControls(input) {
  const controls = defaultControls();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return controls;

  for (const note of CONTROL_NOTES) {
    const value = input[note] ?? input[String(note)];
    if (isKnownAction(value)) controls[note] = value;
  }

  return controls;
}
