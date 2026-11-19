import { AudioEngine } from './audio-engine.js';
import { ContextMenu } from './context-menu.js';
import { MasterFader } from './master-fader.js';
import { MidiController } from './midi.js';
import { Spectrum } from './spectrum.js';
import {
  ACTION_GROUPS,
  ACTIONS,
  CONTROL_NOTES,
  SCENE_NOTES,
  SHIFT_NOTE,
  TRACK_NOTES,
  actionInfo,
  controlKind,
  controlTitle,
  defaultControls,
  normalizeControls,
  sceneRowFor,
} from './actions.js';
import {
  CONTROL_LED,
  DEFAULT_HINT,
  LED,
  MASTER_CC_DEFAULT,
  PAD_COUNT,
  STATUS_LABEL,
  baseName,
  ccLabel,
  ccShort,
  clamp01,
  fmt,
} from './utils.js';

const $ = (id) => document.getElementById(id);

/* ---------- Pantalla de carga ---------- */

const bootStartedAt = performance.now();
let bootValue = 0;

function setBootProgress(value, label = null) {
  bootValue = Math.max(bootValue, Math.min(100, Math.round(Number(value) || 0)));
  if (ui.bootFill) ui.bootFill.style.width = `${bootValue}%`;
  if (ui.bootPercent) ui.bootPercent.textContent = `${bootValue} %`;
  if (label && ui.bootLabel) ui.bootLabel.textContent = label;
}

async function hideBootScreen() {
  setBootProgress(100, 'Listo');
  const elapsed = performance.now() - bootStartedAt;
  const wait = Math.max(0, 1200 - elapsed);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  ui.bootScreen?.classList.add('is-hidden');
  setTimeout(() => {
    if (ui.bootScreen) ui.bootScreen.hidden = true;
  }, 420);
}

const ui = {
  nowState: $('nowState'),
  nowName: $('nowName'),
  clock: $('clock'),
  progress: $('progress'),
  spectrum: $('spectrum'),
  masterValue: $('masterValue'),
  masterRail: $('masterRail'),
  masterFader: $('masterFader'),
  masterAssigned: $('masterAssigned'),
  masterAssignLabel: $('masterAssignLabel'),
  masterMuteButton: $('masterMuteButton'),
  assignMaster: $('assignMaster'),
  assignMasterPanel: $('assignMasterPanel'),
  clearMaster: $('clearMaster'),
  clearMasterPanel: $('clearMasterPanel'),
  statusMsg: $('statusMsg'),
  midiStatus: $('midiStatus'),
  midiText: $('midiText'),
  padGrid: $('padGrid'),
  contextMenu: $('contextMenu'),
  mappingList: $('mappingList'),
  mappingClear: $('mappingClear'),
  faderList: $('faderList'),
  resetButton: $('resetButton'),
  stopAllButton: $('stopAllButton'),
  stopLastButton: $('stopLastButton'),
  newProjectButton: $('newProjectButton'),
  openProjectButton: $('openProjectButton'),
  saveProjectButton: $('saveProjectButton'),
  assignButton: $('assignButton'),
  assignPanel: $('assignPanel'),
  assignBackdrop: $('assignBackdrop'),
  assignClose: $('assignClose'),
  remoteButton: $('remoteButton'),
  remoteDialog: $('remoteDialog'),
  remoteStatus: $('remoteStatus'),
  remoteList: $('remoteList'),
  remoteClose: $('remoteClose'),
  helpButton: $('helpButton'),
  helpDialog: $('helpDialog'),
  helpClose: $('helpClose'),
  newProjectDialog: $('newProjectDialog'),
  newProjectCancel: $('newProjectCancel'),
  newProjectAccept: $('newProjectAccept'),
  renameDialog: $('renameDialog'),
  renameForm: $('renameForm'),
  renameTitle: $('renameTitle'),
  renameInput: $('renameInput'),
  renameCancel: $('renameCancel'),
  editDialog: $('editDialog'),
  editTitle: $('editTitle'),
  editPercent: $('editPercent'),
  editRange: $('editRange'),
  editCancel: $('editCancel'),
  editAccept: $('editAccept'),
  bootScreen: $('bootScreen'),
  bootFill: $('bootFill'),
  bootPercent: $('bootPercent'),
  bootLabel: $('bootLabel'),
  pads: [],
  controlButtons: new Map(),
  channelViews: [],
  mappingSelects: new Map(),
  faderSelects: new Map(),
};

const state = {
  master: 1,
  masterCC: MASTER_CC_DEFAULT,
  learn: null,
  moving: null,
  selected: 0,
  masterMuted: false,
  controls: defaultControls(),
};

const pads = Array.from({ length: PAD_COUNT }, (_, note) => ({
  note,
  path: null,
  name: null,
  volume: 1,
  fader: null,
  muted: false,
  buffer: null,
  source: null,
  status: 'empty',
  startedAt: 0,
  duration: 0,
  loading: false,
  pendingPath: null,
  loadToken: 0,
}));

// Entradas de pads.json que no se pudieron cargar (archivo movido, disco
// desconectado, etc.). Se conservan para no perder la configuración.
const savedPadEntries = new Map();

let engine = null;
let spectrum = null;
let midi = null;
let masterFader = null;
let contextMenu = null;

let statusTimer = null;
let idleMessage = DEFAULT_HINT;
let idleTone = 'muted';
let saveTimer = null;
let saveBusy = false;
let saveAgain = false;
let configReady = false;
let savePending = false;
let uiLoopTimer = null;
let mappingFlashTimer = null;

let renameNote = null;
let editNote = null;
let editOriginal = 1;
let editAccepted = false;

/* ---------- Estado visual ---------- */

function applyStatus(message, tone) {
  ui.statusMsg.textContent = message;
  ui.statusMsg.className = `status-msg tone-${tone}`;
}

function setStatus(message, tone = 'muted', timeout = 4500) {
  clearTimeout(statusTimer);
  applyStatus(message, tone);
  if (timeout > 0) {
    statusTimer = setTimeout(() => applyStatus(idleMessage, idleTone), timeout);
  }
}

function setIdleStatus(message, tone = 'muted') {
  idleMessage = message;
  idleTone = tone;
  applyStatus(message, tone);
}

function resetStatus() {
  clearTimeout(statusTimer);
  applyStatus(idleMessage, idleTone);
}

function displayName(pad) {
  if (pad.name) return pad.name;
  if (pad.path) return baseName(pad.path);
  return '';
}

function statusLabel(pad) {
  return STATUS_LABEL[pad.status] || pad.status;
}

function padsInRow(row) {
  const start = row * 8;
  return pads.slice(start, start + 8);
}

function padsInColumn(column) {
  const group = [];
  for (let row = 0; row < 8; row += 1) group.push(pads[row * 8 + column]);
  return group;
}

/* ---------- Construcción del hardware ---------- */

function buildHardware() {
  ui.padGrid.replaceChildren();
  ui.pads = [];
  ui.controlButtons.clear();
  ui.channelViews = [];

  // Cada fila visual contiene 8 pads y su botón de escena a la derecha.
  // La fila superior es la de los pads 56..63; el botón 82 lanza esa fila.
  for (let visualRow = 0; visualRow < 8; visualRow += 1) {
    const row = 7 - visualRow;
    for (let column = 0; column < 8; column += 1) {
      const note = row * 8 + column;
      ui.pads[note] = createPadView(note);
      ui.padGrid.append(ui.pads[note].el);
    }
    ui.padGrid.append(createControlView(SCENE_NOTES[visualRow]));
  }

  for (const note of TRACK_NOTES) ui.padGrid.append(createControlView(note));
  ui.padGrid.append(createControlView(SHIFT_NOTE));

  for (let index = 0; index < 8; index += 1) {
    ui.padGrid.append(createChannelView(index));
  }

  for (let note = 0; note < PAD_COUNT; note += 1) renderPad(note);
  renderControls();
}

function createPadView(note) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'pad is-empty';
  el.dataset.note = String(note);
  el.innerHTML = [
    '<span class="pad-num"></span>',
    '<span class="pad-cc"></span>',
    '<span class="pad-plus">+</span>',
    '<span class="pad-name"></span>',
    '<span class="pad-mute" hidden>M</span>',
    '<span class="pad-vol"><span class="pad-vol-fill"></span></span>',
  ].join('');

  el.addEventListener('click', () => onPad(note, { gui: true }));
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    selectPad(note);
    openContextMenu(note, event.clientX, event.clientY);
  });

  return {
    el,
    num: el.querySelector('.pad-num'),
    cc: el.querySelector('.pad-cc'),
    plus: el.querySelector('.pad-plus'),
    name: el.querySelector('.pad-name'),
    mute: el.querySelector('.pad-mute'),
    vol: el.querySelector('.pad-vol'),
    volFill: el.querySelector('.pad-vol-fill'),
  };
}

function createControlView(note) {
  const kind = controlKind(note);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `hw-btn hw-${kind}`;
  el.dataset.note = String(note);
  el.innerHTML = [
    '<i class="hw-led" aria-hidden="true"></i>',
    '<span class="hw-note"></span>',
    '<span class="hw-action"></span>',
  ].join('');

  el.addEventListener('click', () => executeControl(note, { source: 'ui' }));
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    focusAssignment(note);
  });

  ui.controlButtons.set(note, {
    el,
    noteEl: el.querySelector('.hw-note'),
    actionEl: el.querySelector('.hw-action'),
  });

  return el;
}

function createChannelView(index) {
  const cc = 48 + index;
  const cell = document.createElement('div');
  cell.className = 'channel-cell is-unassigned';
  cell.title = `Fader ${index + 1} · CC ${cc}`;

  const faderEl = document.createElement('div');
  faderEl.className = 'fader';
  faderEl.id = `channelFader${index}`;
  faderEl.setAttribute('role', 'slider');
  faderEl.setAttribute('tabindex', '0');
  faderEl.setAttribute('aria-label', `Volumen del fader ${index + 1}`);
  faderEl.setAttribute('aria-valuemin', '0');
  faderEl.setAttribute('aria-valuemax', '100');
  faderEl.setAttribute('aria-valuenow', '100');
  faderEl.innerHTML = [
    '<div class="fader-track"></div>',
    '<div class="fader-fill"></div>',
    '<div class="fader-thumb"></div>',
  ].join('');

  const caption = document.createElement('div');
  caption.className = 'channel-caption';
  const label = document.createElement('b');
  label.textContent = `F${index + 1}`;
  const target = document.createElement('span');
  target.className = 'channel-target';
  target.textContent = '—';
  caption.append(label, target);

  cell.append(faderEl, caption);
  ui.channelViews[index] = {
    el: cell,
    faderEl,
    fader: null,
    targetEl: target,
    cc,
  };

  return cell;
}

function setupChannelFaders() {
  for (let index = 0; index < ui.channelViews.length; index += 1) {
    const view = ui.channelViews[index];
    view.fader = new MasterFader(view.faderEl, {
      onChange: (value) => onChannelFader(index, value),
    });
  }
}

/* ---------- Render de pads y controles ---------- */

function renderPad(note) {
  const pad = pads[note];
  const view = ui.pads[note];
  if (!view) return;

  const highlighted = state.moving === note
    || (state.learn?.kind === 'track' && state.learn.note === note);

  const classes = ['pad', `is-${pad.status}`];
  if (pad.loading) classes.push('is-busy');
  if (pad.muted) classes.push('is-muted');
  if (state.selected === note) classes.push('is-selected');
  if (highlighted) classes.push('is-highlight');
  view.el.className = classes.join(' ');

  const name = pad.loading && !pad.buffer
    ? baseName(pad.pendingPath)
    : displayName(pad);
  const hasTrack = pad.status !== 'empty' || pad.loading || Boolean(pad.path);

  view.num.textContent = String(note + 1);
  view.cc.textContent = pad.fader === null ? '' : ccShort(pad.fader);
  view.plus.hidden = hasTrack;
  view.name.textContent = name;
  view.name.title = name;
  view.mute.hidden = !pad.muted;
  view.vol.hidden = !pad.buffer;
  view.volFill.style.width = `${Math.round(pad.volume * 100)}%`;

  const extras = [];
  if (pad.muted) extras.push('silenciado');
  if (pad.fader !== null) extras.push(ccLabel(pad.fader));
  view.el.setAttribute(
    'aria-label',
    `Pad ${note + 1}${name ? `: ${name}` : ''}, ${statusLabel(pad)}${extras.length ? `, ${extras.join(', ')}` : ''}`,
  );
  view.el.title = name
    ? `Pad ${note + 1} · ${name}\n${statusLabel(pad)} · ${Math.round(pad.volume * 100)} %${pad.fader !== null ? ` · ${ccLabel(pad.fader)}` : ''}${pad.muted ? ' · silenciado' : ''}`
    : `Pad ${note + 1} · vacío`;
}

function setPadStatus(note, status) {
  pads[note].status = status;
  midi?.led(note, LED[status] ?? 0);
  renderPad(note);
  if (state.selected === note) renderSelected();
  updateControlLeds();
}

function syncAllLeds() {
  for (let note = 0; note < PAD_COUNT; note += 1) {
    midi?.led(note, LED[pads[note].status] ?? 0);
  }
  updateControlLeds();
}

// Los pads muestran su estado; los botones de pista y escena encienden su LED
// cuando tienen una función asignada. Shift se marca en la interfaz, pero el
// APC mini no tiene LED físico en ese botón.
function renderControl(note) {
  const view = ui.controlButtons.get(note);
  if (!view) return;

  const action = state.controls[note];
  const info = actionInfo(action);
  const assigned = Boolean(action) && action !== 'none';
  const lit = assigned;
  const velocity = lit ? CONTROL_LED.assigned : CONTROL_LED.off;

  view.noteEl.textContent = note === SHIFT_NOTE ? 'SHIFT' : String(note);
  view.actionEl.textContent = info.short;
  view.el.title = `${controlTitle(note)} · nota ${note}\n${info.label}`;
  view.el.dataset.led = String(velocity);
  view.el.classList.remove('is-playing', 'is-alert');
  view.el.classList.toggle('is-assigned', lit);
  view.el.classList.toggle('is-unassigned', !assigned);
  view.el.setAttribute('aria-label', `${controlTitle(note)}, ${info.label}`);
}

function renderControls() {
  for (const note of CONTROL_NOTES) renderControl(note);
}

function updateControlLeds() {
  for (const note of CONTROL_NOTES) {
    renderControl(note);
    const velocity = Number(ui.controlButtons.get(note)?.el.dataset.led || CONTROL_LED.off);
    midi?.led(note, velocity);
  }
}

/* ---------- Selección e inspector ---------- */

function selectPad(note, { render = true } = {}) {
  if (!Number.isInteger(note) || note < 0 || note >= PAD_COUNT) return;
  const previous = state.selected;
  state.selected = note;
  if (render) {
    if (previous !== note) renderPad(previous);
    renderPad(note);
  }
  renderSelected();
}

function selectRelative(delta) {
  const loaded = [];
  for (let note = 0; note < PAD_COUNT; note += 1) {
    if (pads[note].buffer) loaded.push(note);
  }

  const pool = loaded.length > 0 ? loaded : pads.map((pad) => pad.note);
  let index = pool.indexOf(state.selected);
  if (index === -1) index = delta > 0 ? -1 : 0;
  const next = pool[(index + delta + pool.length) % pool.length];
  selectPad(next);
  setStatus(
    `Pad ${next + 1} seleccionado${displayName(pads[next]) ? `: «${displayName(pads[next])}»` : ''}`,
    'muted',
    2000,
  );
}

function renderSelected() {
  // El inspector se sustituyó por el panel de asignación. La selección solo
  // afecta a las acciones «pad seleccionado» y al menú contextual.
}

/* ---------- Master ---------- */

function setupMaster() {
  masterFader = new MasterFader(ui.masterFader, {
    onChange: (value) => setMaster(value),
  });
  masterFader.setValue(state.master);

  for (const button of [ui.assignMaster, ui.assignMasterPanel]) {
    button?.addEventListener('click', () => {
      if (state.learn?.kind === 'master') cancelModes();
      else startLearn('master');
    });
  }
  for (const button of [ui.clearMaster, ui.clearMasterPanel]) {
    button?.addEventListener('click', clearMasterFader);
  }
  ui.masterMuteButton.addEventListener('click', toggleMasterMute);
  renderMaster();
}

function renderMaster() {
  masterFader?.setValue(state.master);
  ui.masterValue.textContent = state.masterMuted
    ? 'MUTE'
    : `${Math.round(state.master * 100)}%`;
  ui.masterMuteButton.textContent = state.masterMuted ? 'Quitar mute' : 'Mute';
  ui.masterMuteButton.classList.toggle('is-on', state.masterMuted);
  ui.masterMuteButton.setAttribute('aria-pressed', String(state.masterMuted));
  ui.masterRail.classList.toggle('is-muted', state.masterMuted);
}

function setMaster(value, { save = true } = {}) {
  state.master = clamp01(value);
  engine?.setMaster(state.masterMuted ? 0 : state.master);
  renderMaster();
  if (save) scheduleSave();
}

function toggleMasterMute() {
  state.masterMuted = !state.masterMuted;
  engine?.setMaster(state.masterMuted ? 0 : state.master);
  renderMaster();
  updateControlLeds();
  setStatus(
    state.masterMuted ? 'Volumen general silenciado' : 'Volumen general recuperado',
    'ok',
    2200,
  );
}

function updateMasterAssignment() {
  const label = state.masterCC === null ? 'Sin fader' : ccLabel(state.masterCC);
  ui.masterAssigned.textContent = label;
  if (ui.masterAssignLabel) ui.masterAssignLabel.textContent = label;
  for (const button of [ui.clearMaster, ui.clearMasterPanel]) {
    if (button) button.disabled = state.masterCC === null;
  }
}

function updateAssignUi() {
  const learning = state.learn?.kind === 'master';
  for (const button of [ui.assignMaster, ui.assignMasterPanel]) {
    if (!button) continue;
    button.textContent = learning ? 'Mueve…' : 'Asignar';
    button.classList.toggle('is-learning', learning);
    button.setAttribute('aria-pressed', String(learning));
  }
}

function clearMasterFader() {
  if (state.masterCC === null) return;
  state.masterCC = null;
  updateMasterAssignment();
  scheduleSave();
  setStatus('Volumen general sin fader asignado', 'ok');
}

/* ---------- Volumen, mute y asignaciones ---------- */

function applyPadGain(note) {
  const pad = pads[note];
  engine?.setTrackVolume(note, pad.muted ? 0 : pad.volume);
}

function setTrackVolume(note, value, { save = true, render = true } = {}) {
  const pad = pads[note];
  pad.volume = clamp01(value);
  applyPadGain(note);
  if (render) renderPad(note);
  if (state.selected === note) renderSelected();
  if (save) scheduleSave();
  syncChannelFaders();
}

function syncChannelFaders() {
  for (let index = 0; index < ui.channelViews.length; index += 1) {
    const view = ui.channelViews[index];
    if (!view.fader) continue;
    const cc = view.cc;

    let found = null;
    for (let note = 0; note < PAD_COUNT; note += 1) {
      if (pads[note].fader === cc) {
        found = pads[note];
        break;
      }
    }

    view.fader.setValue(found ? found.volume : 1);
    view.el.classList.toggle('is-unassigned', !found);
    view.targetEl.textContent = found ? `P${found.note + 1}` : '—';
    view.el.title = found
      ? `Fader ${index + 1} · CC ${cc}\n${displayName(found) || `Pad ${found.note + 1}`}`
      : `Fader ${index + 1} · CC ${cc} sin asignar`;
  }
}

function onChannelFader(index, value) {
  const cc = 48 + index;
  let affected = 0;

  for (let note = 0; note < PAD_COUNT; note += 1) {
    if (pads[note].fader === cc && pads[note].buffer) {
      setTrackVolume(note, value, { save: true });
      affected += 1;
    }
  }

  if (affected === 0) {
    setStatus(
      `El ${ccLabel(cc)} no controla ningún pad. Asígnalo con clic derecho en un pad.`,
      'muted',
      2800,
    );
  }
}

function togglePadMute(note) {
  const pad = pads[note];
  if (!pad.buffer) return;

  pad.muted = !pad.muted;
  applyPadGain(note);
  renderPad(note);
  if (state.selected === note) renderSelected();
  updateControlLeds();
  setStatus(
    pad.muted
      ? `«${displayName(pad)}» silenciada`
      : `«${displayName(pad)}» recuperada`,
    'ok',
    2200,
  );
}

function startLearn(kind, note = null) {
  cancelModes({ announce: false });
  state.learn = { kind, note };
  updateAssignUi();

  if (kind === 'track') renderPad(note);

  if (kind === 'master') {
    setStatus(
      'Mueve el fader que quieras usar como volumen general   ·   Esc para cancelar',
      'info',
      0,
    );
  } else {
    setStatus(
      `Mueve el fader que controlará «${displayName(pads[note])}»   ·   Esc para cancelar`,
      'info',
      0,
    );
  }
}

function freeCC(cc) {
  if (state.masterCC === cc) {
    state.masterCC = null;
    updateMasterAssignment();
  }

  for (let note = 0; note < PAD_COUNT; note += 1) {
    if (pads[note].fader === cc) {
      pads[note].fader = null;
      renderPad(note);
    }
  }

  syncChannelFaders();
  refreshFaderAssignments();
}

function finishLearn(cc) {
  const learn = state.learn;
  if (!learn) return;

  state.learn = null;
  freeCC(cc);

  if (learn.kind === 'master') {
    state.masterCC = cc;
    updateMasterAssignment();
    setStatus(`${ccLabel(cc)} asignado al volumen general`, 'ok');
  } else {
    const pad = pads[learn.note];
    pad.fader = cc;
    renderPad(learn.note);
    if (state.selected === learn.note) renderSelected();
    setStatus(`${ccLabel(cc)} asignado a «${displayName(pad)}»`, 'ok');
  }

  updateAssignUi();
  syncChannelFaders();
  refreshFaderAssignments();
  scheduleSave();
}

function removeTrackFader(note) {
  if (pads[note].fader === null) return;
  pads[note].fader = null;
  renderPad(note);
  if (state.selected === note) renderSelected();
  syncChannelFaders();
  refreshFaderAssignments();
  scheduleSave();
  setStatus(`Pad ${note + 1} sin fader asignado`, 'ok');
}

function startMove(note) {
  const pad = pads[note];
  if (!pad.buffer) return;

  cancelModes({ announce: false });
  state.moving = note;
  renderPad(note);
  setStatus(
    `Pulsa el pad destino para «${displayName(pad)}» (en el controlador o en la ventana)   ·   Esc para cancelar`,
    'info',
    0,
  );
}

function cancelModes({ announce = true } = {}) {
  const affected = new Set();
  if (state.moving !== null) affected.add(state.moving);
  if (state.learn?.kind === 'track') affected.add(state.learn.note);

  state.moving = null;
  state.learn = null;

  for (const note of affected) renderPad(note);
  updateAssignUi();
  if (announce) resetStatus();
}

function doMove(source, destination) {
  if (state.moving === null || source !== state.moving) return;

  state.moving = null;

  if (source === destination) {
    renderPad(source);
    resetStatus();
    return;
  }

  const from = pads[source];
  const to = pads[destination];

  from.loadToken += 1;
  to.loadToken += 1;
  stopPad(source, false);
  stopPad(destination, false);

  const swapped = to.buffer !== null;
  const fields = [
    'path',
    'name',
    'volume',
    'fader',
    'muted',
    'buffer',
    'duration',
    'startedAt',
  ];

  for (const field of fields) {
    const value = from[field];
    from[field] = to[field];
    to[field] = value;
  }

  from.loading = false;
  to.loading = false;
  from.pendingPath = null;
  to.pendingPath = null;
  from.status = from.buffer ? 'loaded' : 'empty';
  to.status = to.buffer ? 'loaded' : 'empty';

  // El destino pasa a contener una pista real; su posible entrada guardada
  // pendiente queda reemplazada por la pista movida o intercambiada.
  savedPadEntries.delete(destination);

  applyPadGain(source);
  applyPadGain(destination);
  midi?.led(source, LED[from.status]);
  midi?.led(destination, LED[to.status]);
  renderPad(source);
  renderPad(destination);
  syncChannelFaders();
  refreshFaderAssignments();
  selectPad(destination);
  updateControlLeds();
  scheduleSave();

  setStatus(
    swapped
      ? `Pistas intercambiadas entre los pads ${source + 1} y ${destination + 1}`
      : `Pista movida al pad ${destination + 1}`,
    'ok',
  );
}

function clearPad(note) {
  const pad = pads[note];

  pad.loadToken += 1;
  stopPad(note, false);

  pad.path = null;
  pad.name = null;
  pad.volume = 1;
  pad.fader = null;
  pad.muted = false;
  pad.buffer = null;
  pad.source = null;
  pad.startedAt = 0;
  pad.duration = 0;
  pad.loading = false;
  pad.pendingPath = null;

  savedPadEntries.delete(note);

  applyPadGain(note);
  setPadStatus(note, 'empty');
  syncChannelFaders();
  refreshFaderAssignments();
  renderSelected();
  scheduleSave();
  setStatus(`Pad ${note + 1} vaciado`, 'ok');
}

/* ---------- Acciones de los botones ---------- */

function executeControl(note, { source = 'ui' } = {}) {
  const action = state.controls[note];

  if (!action || action === 'none') {
    setStatus(`${controlTitle(note)} sin asignar. Clic derecho para configurarlo.`, 'muted', 2400);
    return;
  }

  switch (action) {
    case 'reset_state':
      resetPerformance();
      break;
    case 'stop_all':
      stopAll();
      break;
    case 'stop_last':
      stopLast();
      break;
    case 'scene_toggle': {
      const row = sceneRowFor(note);
      if (row === null) {
        setStatus('«Lanzar escena» solo funciona en un botón de escena (82–89)', 'muted', 2600);
      } else {
        toggleScene(row);
      }
      break;
    }
    case 'track_stop': {
      const column = TRACK_NOTES.includes(note) ? note - TRACK_NOTES[0] : null;
      if (column === null) {
        setStatus('«Parar columna» solo funciona en un botón de pista (64–71)', 'muted', 2600);
      } else {
        stopColumn(column);
      }
      break;
    }
    case 'track_play': {
      const column = TRACK_NOTES.includes(note) ? note - TRACK_NOTES[0] : null;
      if (column === null) {
        setStatus('«Reproducir columna» solo funciona en un botón de pista (64–71)', 'muted', 2600);
      } else {
        playColumn(column);
      }
      break;
    }
    case 'track_mute': {
      const column = TRACK_NOTES.includes(note) ? note - TRACK_NOTES[0] : null;
      if (column === null) {
        setStatus('«Silenciar columna» solo funciona en un botón de pista (64–71)', 'muted', 2600);
      } else {
        toggleColumnMute(column);
      }
      break;
    }
    case 'toggle_selected':
      togglePad(state.selected);
      break;
    case 'stop_selected':
      if (pads[state.selected].status === 'playing') {
        stopPad(state.selected, true);
        setStatus(`«${displayName(pads[state.selected])}» detenida`, 'ok', 2200);
      } else {
        setStatus('El pad seleccionado no está sonando', 'muted', 2000);
      }
      break;
    case 'mute_selected':
      togglePadMute(state.selected);
      break;
    case 'clear_selected':
      if (pads[state.selected].buffer || pads[state.selected].loading) clearPad(state.selected);
      else setStatus('El pad seleccionado ya está vacío', 'muted', 2000);
      break;
    case 'load_selected':
      void loadDialog(state.selected);
      break;
    case 'master_mute':
      toggleMasterMute();
      break;
    case 'master_up':
      setMaster(state.master + 0.1);
      setStatus(`Volumen general: ${Math.round(state.master * 100)} %`, 'ok', 1800);
      break;
    case 'master_down':
      setMaster(state.master - 0.1);
      setStatus(`Volumen general: ${Math.round(state.master * 100)} %`, 'ok', 1800);
      break;
    case 'select_prev':
      selectRelative(-1);
      break;
    case 'select_next':
      selectRelative(1);
      break;
    default:
      setStatus(`${controlTitle(note)} tiene una acción desconocida`, 'error', 3000);
  }

  updateControlLeds();
}

function toggleScene(row) {
  const group = padsInRow(row);
  const playing = group.filter((pad) => pad.status === 'playing');

  if (playing.length > 0) {
    for (const pad of playing) stopPad(pad.note, true);
    setStatus(
      `Escena ${row + 1} detenida${playing.length > 1 ? ` (${playing.length} pistas)` : ''}`,
      'ok',
      2400,
    );
    return;
  }

  const loaded = group.filter((pad) => pad.buffer);
  if (loaded.length === 0) {
    setStatus(`La escena ${row + 1} no tiene pistas cargadas`, 'muted', 2200);
    return;
  }

  for (const pad of loaded) startPad(pad.note);
  setStatus(
    `Escena ${row + 1}: ${loaded.length} pista${loaded.length === 1 ? '' : 's'} en marcha`,
    'ok',
    2600,
  );
}

function stopColumn(column) {
  const group = padsInColumn(column);
  const playing = group.filter((pad) => pad.status === 'playing');

  if (playing.length === 0) {
    setStatus(`La pista ${column + 1} no tiene pads sonando`, 'muted', 2200);
    return;
  }

  for (const pad of playing) stopPad(pad.note, true);
  setStatus(
    `Pista ${column + 1}: ${playing.length} pad${playing.length === 1 ? '' : 's'} detenido${playing.length === 1 ? '' : 's'}`,
    'ok',
    2400,
  );
}

function playColumn(column) {
  const group = padsInColumn(column);
  const playing = group.filter((pad) => pad.status === 'playing');

  if (playing.length > 0) {
    for (const pad of playing) stopPad(pad.note, true);
    setStatus(`Pista ${column + 1} detenida`, 'ok', 2200);
    return;
  }

  const loaded = group.filter((pad) => pad.buffer);
  if (loaded.length === 0) {
    setStatus(`La pista ${column + 1} no tiene pads cargados`, 'muted', 2200);
    return;
  }

  for (const pad of loaded) startPad(pad.note);
  setStatus(
    `Pista ${column + 1}: ${loaded.length} pad${loaded.length === 1 ? '' : 's'} en marcha`,
    'ok',
    2400,
  );
}

function toggleColumnMute(column) {
  const group = padsInColumn(column).filter((pad) => pad.buffer);
  if (group.length === 0) {
    setStatus(`La pista ${column + 1} no tiene pads cargados`, 'muted', 2200);
    return;
  }

  const mute = !group.every((pad) => pad.muted);
  for (const pad of group) {
    pad.muted = mute;
    applyPadGain(pad.note);
    renderPad(pad.note);
  }

  renderSelected();
  updateControlLeds();
  setStatus(
    mute ? `Pista ${column + 1} silenciada` : `Pista ${column + 1} recuperada`,
    'ok',
    2200,
  );
}

function resetPerformance() {
  cancelModes({ announce: false });

  let stopped = 0;
  for (let note = 0; note < PAD_COUNT; note += 1) {
    const pad = pads[note];

    if (pad.source) {
      pad.source.onended = null;
      engine?.stop(pad.source);
      pad.source = null;
      stopped += 1;
    }

    pad.muted = false;
    pad.startedAt = 0;
    applyPadGain(note);

    if (pad.loading) {
      pad.status = pad.buffer ? 'loaded' : 'loading';
    } else {
      pad.status = pad.buffer ? 'loaded' : 'empty';
    }
    renderPad(note);
  }

  state.masterMuted = false;
  engine?.setMaster(state.master);
  renderMaster();
  syncChannelFaders();
  syncAllLeds();
  renderSelected();

  setStatus(
    stopped > 0
      ? `Reset listo: ${stopped} pista${stopped === 1 ? '' : 's'} detenida${stopped === 1 ? '' : 's'} y LEDs en estado cargado`
      : 'Reset listo: pistas cargadas en amarillo, sin estados de reproducción',
    'ok',
    4200,
  );
}

/* ---------- Proyectos ---------- */

function resetProject({ announce = true, save = true } = {}) {
  cancelModes({ announce: false });

  for (let note = 0; note < PAD_COUNT; note += 1) {
    const pad = pads[note];
    pad.loadToken += 1;

    if (pad.source) {
      pad.source.onended = null;
      engine?.stop(pad.source);
    }

    pad.path = null;
    pad.name = null;
    pad.volume = 1;
    pad.fader = null;
    pad.muted = false;
    pad.buffer = null;
    pad.source = null;
    pad.startedAt = 0;
    pad.duration = 0;
    pad.loading = false;
    pad.pendingPath = null;

    applyPadGain(note);
    setPadStatus(note, 'empty');
  }

  savedPadEntries.clear();
  state.selected = 0;
  state.master = 1;
  state.masterMuted = false;
  state.masterCC = MASTER_CC_DEFAULT;
  state.controls = defaultControls();

  engine?.setMaster(1);
  renderMaster();
  updateMasterAssignment();
  updateAssignUi();
  renderControls();
  refreshMappingValues();
  syncChannelFaders();
  refreshFaderAssignments();
  syncAllLeds();
  selectPad(0);
  if (save) scheduleSave();

  if (announce) {
    setStatus('Proyecto nuevo: pads vacíos, master al 100 % y botones sin asignar', 'ok', 5000);
  }
}

function setupProjectActions() {
  ui.newProjectButton.addEventListener('click', () => ui.newProjectDialog.showModal());
  ui.newProjectCancel.addEventListener('click', () => ui.newProjectDialog.close());
  ui.newProjectAccept.addEventListener('click', () => {
    ui.newProjectDialog.close();
    resetProject();
  });
  ui.openProjectButton.addEventListener('click', () => { void openProject(); });
  ui.saveProjectButton.addEventListener('click', () => { void saveProject(); });
  ui.helpButton.addEventListener('click', () => ui.helpDialog.showModal());
  ui.helpClose.addEventListener('click', () => ui.helpDialog.close());
}

function formatProjectSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  const mb = value / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

async function saveProject() {
  if (!window.desktop?.saveProject) {
    setStatus('Guardar proyecto solo está disponible en la aplicación de escritorio', 'error', 6000);
    return;
  }

  setStatus('Guardando proyecto con los audios…', 'muted', 0);

  try {
    const result = await window.desktop.saveProject(buildConfig());
    if (!result || result.canceled) {
      resetStatus();
      return;
    }

    const missingPads = Array.isArray(result.missingPads) ? result.missingPads : [];
    const count = Number(result.embedded) || 0;
    let message = `Proyecto guardado con ${count} pista${count === 1 ? '' : 's'} · ${formatProjectSize(result.bytes)}`;
    if (missingPads.length > 0) {
      message += ` · ${missingPads.length} no se pudo incluir (pads ${missingPads.map((note) => note + 1).join(', ')})`;
    }

    setStatus(message, missingPads.length > 0 ? 'info' : 'ok', 9000);
  } catch (error) {
    setStatus(
      `No se pudo guardar el proyecto: ${error instanceof Error ? error.message : error}`,
      'error',
      9000,
    );
  }
}

async function openProject() {
  if (!window.desktop?.openProject) {
    setStatus('Abrir proyecto solo está disponible en la aplicación de escritorio', 'error', 6000);
    return;
  }

  try {
    const hasContent = pads.some((pad) => Boolean(pad.buffer || pad.path));
    const result = await window.desktop.openProject({ hasContent });
    if (!result || result.canceled) return;
    await applyOpenedProject(result);
  } catch (error) {
    setStatus(
      `No se pudo abrir el proyecto: ${error instanceof Error ? error.message : error}`,
      'error',
      9000,
    );
  }
}

async function applyOpenedProject(result) {
  const config = result?.config;
  if (!config) throw new Error('El proyecto no contiene una configuración válida');

  setStatus('Abriendo proyecto y cargando pistas…', 'muted', 0);
  resetProject({ announce: false, save: false });

  state.master = clamp01(config.master ?? 1);
  state.masterCC = config.master_cc === null
    ? null
    : (Number.isInteger(config.master_cc) ? config.master_cc : MASTER_CC_DEFAULT);
  state.controls = normalizeControls(config.controls);

  engine.setMaster(state.master);
  renderMaster();
  renderControls();
  refreshMappingValues();
  updateMasterAssignment();
  updateAssignUi();

  await loadSavedPads(config.pads, {
    onProgress: ({ done, total, name }) => {
      setStatus(
        `Cargando pistas ${done}/${total}${name ? ` · ${name}` : ''}`,
        'muted',
        0,
      );
    },
  });

  const loaded = pads.filter((pad) => pad.buffer).length;
  const firstLoaded = pads.findIndex((pad) => pad.buffer);
  selectPad(firstLoaded === -1 ? 0 : firstLoaded);

  syncChannelFaders();
  refreshFaderAssignments();
  syncAllLeds();
  renderSelected();
  scheduleSave();

  const missingPads = Array.isArray(result.missingPads) ? result.missingPads : [];
  let message = `Proyecto abierto: ${loaded} pista${loaded === 1 ? '' : 's'}`;
  if (missingPads.length > 0) {
    message += ` · ${missingPads.length} no se incluyó${missingPads.length === 1 ? '' : 'n'} al guardar (pads ${missingPads.map((note) => note + 1).join(', ')})`;
  }

  setStatus(message, missingPads.length > 0 ? 'info' : 'ok', 9000);
}

/* ---------- Menú contextual ---------- */

function openContextMenu(note, x, y) {
  if (state.moving !== null || state.learn !== null) cancelModes();

  const pad = pads[note];
  const hasTrack = Boolean(pad.buffer);
  const busy = pad.loading;

  contextMenu.open({
    x,
    y,
    returnFocus: ui.pads[note]?.el || null,
    items: [
      {
        label: hasTrack ? 'Reemplazar pista…' : 'Cargar pista…',
        disabled: busy,
        action: () => { void loadDialog(note); },
      },
      {
        label: pad.status === 'playing' ? 'Detener' : 'Reproducir',
        disabled: !hasTrack,
        action: () => togglePad(note),
      },
      {
        label: pad.muted ? 'Quitar mute' : 'Silenciar',
        disabled: !hasTrack,
        action: () => togglePadMute(note),
      },
      { separator: true },
      {
        label: 'Renombrar…',
        disabled: !hasTrack,
        action: () => openRename(note),
      },
      {
        label: 'Editar (volumen)…',
        disabled: !hasTrack,
        action: () => openEdit(note),
      },
      { separator: true },
      {
        label: pad.fader === null
          ? 'Asignar fader…'
          : `Asignar fader…  (actual: ${ccLabel(pad.fader)})`,
        disabled: !hasTrack || busy,
        action: () => startLearn('track', note),
      },
      {
        label: 'Quitar fader',
        disabled: pad.fader === null,
        action: () => removeTrackFader(note),
      },
      {
        label: 'Mover a otro pad…',
        disabled: !hasTrack || busy,
        action: () => startMove(note),
      },
      { separator: true },
      {
        label: 'Vaciar pad',
        disabled: !hasTrack && !busy,
        action: () => clearPad(note),
      },
    ],
  });
}

/* ---------- Diálogos ---------- */

function openRename(note) {
  const pad = pads[note];
  if (!pad.buffer) return;

  renameNote = note;
  ui.renameTitle.textContent = `Pad ${note + 1}`;
  ui.renameInput.value = displayName(pad);
  ui.renameDialog.showModal();

  requestAnimationFrame(() => {
    ui.renameInput.focus();
    ui.renameInput.select();
  });
}

function acceptRename() {
  if (renameNote === null) return;

  const note = renameNote;
  const value = ui.renameInput.value.trim();

  pads[note].name = value || null;
  renderPad(note);
  if (state.selected === note) renderSelected();
  scheduleSave();
  ui.renameDialog.close();
  setStatus(
    value
      ? `Pad ${note + 1} renombrado a «${value}»`
      : `Pad ${note + 1} usa el nombre del archivo`,
    'ok',
  );
}

function openEdit(note) {
  const pad = pads[note];
  if (!pad.buffer) return;

  editNote = note;
  editOriginal = pad.volume;
  editAccepted = false;

  ui.editTitle.textContent = displayName(pad);
  ui.editRange.value = String(Math.round(pad.volume * 100));
  ui.editPercent.textContent = `${Math.round(pad.volume * 100)}%`;
  ui.editDialog.showModal();
}

function acceptEdit() {
  if (editNote === null) return;

  const note = editNote;
  editAccepted = true;
  scheduleSave();
  ui.editDialog.close();
  setStatus(
    `Volumen de «${displayName(pads[note])}» al ${Math.round(pads[note].volume * 100)}%`,
    'ok',
  );
}

function cancelEdit() {
  if (ui.editDialog.open) ui.editDialog.close();
}

function setupDialogs() {
  ui.renameForm.addEventListener('submit', (event) => {
    event.preventDefault();
    acceptRename();
  });
  ui.renameCancel.addEventListener('click', () => ui.renameDialog.close());
  ui.renameDialog.addEventListener('close', () => {
    renameNote = null;
  });

  ui.editRange.addEventListener('input', () => {
    if (editNote === null) return;
    const value = Number(ui.editRange.value) / 100;
    ui.editPercent.textContent = `${Math.round(value * 100)}%`;
    setTrackVolume(editNote, value, { save: false });
  });

  ui.editCancel.addEventListener('click', cancelEdit);
  ui.editAccept.addEventListener('click', acceptEdit);
  ui.editDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelEdit();
  });
  ui.editDialog.addEventListener('close', () => {
    if (!editAccepted && editNote !== null) {
      setTrackVolume(editNote, editOriginal, { save: false });
    }
    editAccepted = false;
    editNote = null;
  });
}

/* ---------- Diálogo de asignación de botones ---------- */

function createActionSelect(note) {
  const select = document.createElement('select');
  select.className = 'select-input';
  select.dataset.note = String(note);

  for (const [groupKey, groupLabel] of ACTION_GROUPS) {
    const groupActions = ACTIONS.filter((action) => action.group === groupKey);
    if (groupActions.length === 0) continue;

    const optgroup = document.createElement('optgroup');
    optgroup.label = groupLabel;

    for (const action of groupActions) {
      const option = document.createElement('option');
      option.value = action.id;
      option.textContent = action.label;
      option.title = action.hint;
      optgroup.append(option);
    }

    select.append(optgroup);
  }

  select.addEventListener('change', () => {
    onControlMappingChange(note, select.value);
  });

  return select;
}

function buildMappingList() {
  ui.mappingList.replaceChildren();
  ui.mappingSelects.clear();

  const sections = [
    ['Botones de pista · columnas', TRACK_NOTES],
    ['Botones de escena · filas', SCENE_NOTES],
    ['Shift', [SHIFT_NOTE]],
  ];

  for (const [title, notes] of sections) {
    const section = document.createElement('section');
    section.className = 'mapping-group';

    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading);

    for (const note of notes) {
      const row = document.createElement('label');
      row.className = 'mapping-row';
      row.dataset.note = String(note);

      const name = document.createElement('span');
      name.className = 'mapping-name';
      const strong = document.createElement('b');
      strong.textContent = controlTitle(note);
      const small = document.createElement('small');
      small.textContent = `nota ${note}`;
      name.append(strong, small);

      const select = createActionSelect(note);
      row.append(name, select);
      section.append(row);

      ui.mappingSelects.set(note, { row, select });
    }

    ui.mappingList.append(section);
  }

  refreshMappingValues();
}

function refreshMappingValues() {
  for (const [note, view] of ui.mappingSelects) {
    view.select.value = state.controls[note];
  }
}

function onControlMappingChange(note, actionId) {
  const info = actionInfo(actionId);
  state.controls[note] = info.id;
  renderControl(note);
  updateControlLeds();
  scheduleSave();
  setStatus(`${controlTitle(note)}: ${info.label}`, 'ok', 2600);
}

/* ---------- Cajón de asignación ---------- */

let assignmentCloseTimer = null;

function isAssignmentOpen() {
  return Boolean(ui.assignPanel && !ui.assignPanel.hidden);
}

function flashAssignmentRow(note) {
  const view = ui.mappingSelects.get(note);
  if (!view) return;

  view.row.scrollIntoView({ block: 'nearest' });
  view.row.classList.add('is-active');
  clearTimeout(mappingFlashTimer);
  mappingFlashTimer = setTimeout(() => {
    view.row.classList.remove('is-active');
  }, 900);
  view.select.focus({ preventScroll: true });
}

function openAssignmentPanel({ note = null } = {}) {
  if (!ui.assignPanel) return;
  clearTimeout(assignmentCloseTimer);

  refreshMappingValues();
  refreshFaderAssignments();
  updateMasterAssignment();
  updateAssignUi();

  ui.assignPanel.hidden = false;
  ui.assignBackdrop.hidden = false;
  ui.assignPanel.setAttribute('aria-hidden', 'false');
  ui.assignButton?.setAttribute('aria-expanded', 'true');

  requestAnimationFrame(() => {
    ui.assignPanel.classList.add('is-open');
    ui.assignBackdrop.classList.add('is-open');
  });

  ui.assignClose?.focus({ preventScroll: true });
  if (note !== null) flashAssignmentRow(note);
}

function closeAssignmentPanel({ restoreFocus = true } = {}) {
  if (!ui.assignPanel || ui.assignPanel.hidden) return;

  ui.assignPanel.classList.remove('is-open');
  ui.assignBackdrop.classList.remove('is-open');
  ui.assignPanel.setAttribute('aria-hidden', 'true');
  ui.assignButton?.setAttribute('aria-expanded', 'false');

  clearTimeout(assignmentCloseTimer);
  assignmentCloseTimer = setTimeout(() => {
    ui.assignPanel.hidden = true;
    ui.assignBackdrop.hidden = true;
  }, 260);

  if (restoreFocus) ui.assignButton?.focus({ preventScroll: true });
}

function focusAssignment(note = null) {
  openAssignmentPanel({ note });
}

/* ---------- Asignación de faders ---------- */

function buildFaderAssignmentList() {
  ui.faderList.replaceChildren();
  ui.faderSelects.clear();

  for (let index = 0; index < 8; index += 1) {
    const cc = 48 + index;
    const row = document.createElement('label');
    row.className = 'mapping-row';

    const name = document.createElement('span');
    name.className = 'mapping-name';
    const strong = document.createElement('b');
    strong.textContent = `Fader ${index + 1}`;
    const small = document.createElement('small');
    small.textContent = `CC ${cc}`;
    name.append(strong, small);

    const select = document.createElement('select');
    select.className = 'select-input';
    select.dataset.cc = String(cc);
    select.addEventListener('change', () => onFaderAssignmentChange(cc, select.value));

    row.append(name, select);
    ui.faderList.append(row);
    ui.faderSelects.set(cc, { row, select });
  }

  refreshFaderAssignments();
}

function refreshFaderAssignments() {
  for (const [cc, view] of ui.faderSelects) {
    let assigned = null;
    for (let note = 0; note < PAD_COUNT; note += 1) {
      if (pads[note].fader === cc) {
        assigned = pads[note];
        break;
      }
    }

    const options = [new Option('Sin asignar', '')];
    for (let note = 0; note < PAD_COUNT; note += 1) {
      const pad = pads[note];
      if (!pad.buffer) continue;
      const label = displayName(pad) ? `P${note + 1} · ${displayName(pad)}` : `Pad ${note + 1}`;
      options.push(new Option(label, String(note)));
    }

    view.select.replaceChildren(...options);
    view.select.value = assigned ? String(assigned.note) : '';
    view.row.title = assigned
      ? `CC ${cc} controla «${displayName(assigned) || `Pad ${assigned.note + 1}`}»`
      : `CC ${cc} sin asignar`;
  }
}

function onFaderAssignmentChange(cc, rawNote) {
  if (rawNote === '') {
    freeCC(cc);
    scheduleSave();
    setStatus(`${ccLabel(cc)} sin asignar`, 'ok', 2400);
    return;
  }

  const note = Number(rawNote);
  const pad = pads[note];
  if (!Number.isInteger(note) || !pad) return;

  if (pad.fader === cc) return;

  // Un pad solo puede tener un fader: libera el anterior.
  if (pad.fader !== null) {
    const previous = pad.fader;
    pad.fader = null;
    const view = ui.faderSelects.get(previous);
    if (view) view.select.value = '';
  }

  freeCC(cc);
  pad.fader = cc;
  renderPad(note);
  syncChannelFaders();
  refreshFaderAssignments();
  scheduleSave();
  setStatus(`${ccLabel(cc)} asignado a «${displayName(pad) || `Pad ${note + 1}`}»`, 'ok');
}

function setupAssignmentPanel() {
  buildMappingList();
  buildFaderAssignmentList();

  ui.assignButton?.addEventListener('click', () => {
    if (isAssignmentOpen()) closeAssignmentPanel();
    else openAssignmentPanel();
  });
  ui.assignClose?.addEventListener('click', () => closeAssignmentPanel());
  ui.assignBackdrop?.addEventListener('click', () => closeAssignmentPanel());

  ui.mappingClear?.addEventListener('click', () => {
    state.controls = defaultControls();
    refreshMappingValues();
    renderControls();
    updateControlLeds();
    scheduleSave();
    setStatus('Todas las asignaciones de botones quitadas', 'ok');
  });
}

/* ---------- Acciones de actuación ---------- */

function setupInspector() {
  ui.resetButton.addEventListener('click', resetPerformance);
  ui.stopAllButton.addEventListener('click', stopAll);
  ui.stopLastButton.addEventListener('click', stopLast);
}

/* ---------- Reproducción ---------- */

function startPad(note) {
  const pad = pads[note];
  if (!pad.buffer || !engine) return;

  if (pad.source) stopPad(note, false);
  void engine.resume();

  let source;
  try {
    source = engine.play(note, pad.buffer);
  } catch (error) {
    setStatus(
      `No se pudo reproducir «${displayName(pad)}»: ${error instanceof Error ? error.message : error}`,
      'error',
      8000,
    );
    return;
  }

  pad.source = source;
  pad.startedAt = engine.now();
  pad.duration = pad.buffer.duration;
  setPadStatus(note, 'playing');

  source.onended = () => {
    if (pad.source !== source) return;
    pad.source = null;
    setPadStatus(note, 'stopped');
  };
}

function stopPad(note, markStopped = true) {
  const pad = pads[note];
  const source = pad.source;
  pad.source = null;

  if (source) {
    source.onended = null;
    engine?.stop(source);
  }

  if (markStopped && pad.status === 'playing') {
    setPadStatus(note, 'stopped');
  }
}

function togglePad(note) {
  const pad = pads[note];
  if (!pad.buffer) return;
  if (pad.status === 'playing') stopPad(note, true);
  else startPad(note);
}

function onPad(note, { gui = false } = {}) {
  selectPad(note, { render: false });

  if (state.moving !== null) {
    doMove(state.moving, note);
    return;
  }

  if (state.learn !== null) {
    if (state.learn.kind === 'master') {
      setStatus('Mueve un fader para asignar el volumen general   ·   Esc para cancelar', 'info', 0);
    }
    renderPad(note);
    renderSelected();
    return;
  }

  const pad = pads[note];
  if (!pad.buffer) {
    renderPad(note);
    renderSelected();
    if (gui && !pad.loading) void loadDialog(note);
    return;
  }

  togglePad(note);
  renderSelected();
}

function stopAll() {
  let stopped = 0;
  for (let note = 0; note < PAD_COUNT; note += 1) {
    if (pads[note].status === 'playing') {
      stopPad(note, true);
      stopped += 1;
    }
  }

  if (stopped === 0) {
    setStatus('No hay pistas sonando', 'muted', 2200);
  } else {
    setStatus(stopped === 1 ? '1 pista detenida' : `${stopped} pistas detenidas`, 'ok', 2400);
  }
}

function stopLast() {
  let target = -1;
  for (let note = 0; note < PAD_COUNT; note += 1) {
    if (pads[note].status !== 'playing') continue;
    if (target === -1 || pads[note].startedAt > pads[target].startedAt) target = note;
  }

  if (target === -1) {
    setStatus('No hay pistas sonando', 'muted', 2200);
    return;
  }

  const name = displayName(pads[target]);
  stopPad(target, true);
  setStatus(`«${name}» detenida`, 'ok', 2400);
}

function onMidiAction(note) {
  if (CONTROL_NOTES.includes(note)) {
    executeControl(note, { source: 'midi' });
  }
}

function handleCC(cc, value) {
  if (state.learn !== null) {
    finishLearn(cc);
    return;
  }

  const normalized = Math.max(0, Math.min(127, value)) / 127;
  if (state.masterCC === cc) setMaster(normalized);

  for (let note = 0; note < PAD_COUNT; note += 1) {
    if (pads[note].fader === cc && pads[note].buffer) {
      setTrackVolume(note, normalized);
    }
  }
}

/* ---------- Carga de pistas ---------- */

async function loadDialog(note) {
  if (!window.desktop?.pickAudioFile) {
    setStatus('La selección de archivos solo está disponible en Electron', 'error', 6000);
    return;
  }

  const path = await window.desktop.pickAudioFile(`Pista para el pad ${note + 1}`);
  if (!path) return;

  const ok = await loadPadFromPath(note, path, { name: null });
  if (ok) {
    setStatus(`«${displayName(pads[note])}» cargada en el pad ${note + 1}`, 'ok');
  }
}

async function loadPadFromPath(note, path, options = {}) {
  const pad = pads[note];
  const {
    name = undefined,
    volume = undefined,
    fader = undefined,
    quiet = false,
  } = options;

  const token = (pad.loadToken += 1);
  const hadTrack = Boolean(pad.buffer);

  pad.loading = true;
  pad.pendingPath = path;
  if (!hadTrack) pad.status = 'loading';
  renderPad(note);

  try {
    if (!window.desktop?.readAudioFile) throw new Error('No hay acceso al sistema de archivos');
    const bytes = await window.desktop.readAudioFile(path);
    if (token !== pad.loadToken) return false;

    const buffer = await engine.decode(bytes);
    if (token !== pad.loadToken) return false;

    stopPad(note, false);

    pad.buffer = buffer;
    pad.source = null;
    pad.path = path;
    pad.duration = buffer.duration;
    pad.startedAt = 0;
    pad.loading = false;
    pad.pendingPath = null;

    if (name !== undefined) pad.name = name || null;
    if (volume !== undefined) pad.volume = clamp01(volume);
    if (fader !== undefined) pad.fader = fader === null ? null : Number(fader);

    pad.status = 'loaded';
    savedPadEntries.delete(note);
    applyPadGain(note);
    setPadStatus(note, 'loaded');
    syncChannelFaders();
    refreshFaderAssignments();
    scheduleSave();
    return true;
  } catch (error) {
    if (token !== pad.loadToken) return false;

    pad.loading = false;
    pad.pendingPath = null;
    if (!pad.buffer) pad.status = 'empty';
    renderPad(note);
    updateControlLeds();

    if (!quiet) {
      setStatus(
        `No se pudo cargar «${baseName(path)}»: ${error instanceof Error ? error.message : error}`,
        'error',
        8000,
      );
    }
    return false;
  }
}

/* ---------- Guardado y carga de configuración ---------- */

function buildConfig() {
  const savedPads = {};

  for (let note = 0; note < PAD_COUNT; note += 1) {
    const pad = pads[note];
    if (!pad.path || !pad.buffer) continue;
    savedPads[note] = {
      path: pad.path,
      name: pad.name,
      volume: Math.round(pad.volume * 1000) / 1000,
      fader: pad.fader,
    };
  }

  // Entradas cuyo archivo no se pudo cargar al arrancar: se conservan tal cual
  // para que un guardado posterior no las elimine de pads.json.
  for (const [note, entry] of savedPadEntries) {
    if (savedPads[note]) continue;
    savedPads[note] = {
      path: entry.path,
      name: entry.name,
      volume: Math.round(entry.volume * 1000) / 1000,
      fader: entry.fader,
    };
  }

  return {
    version: 3,
    master: Math.round(state.master * 1000) / 1000,
    master_cc: state.masterCC,
    controls: { ...state.controls },
    pads: savedPads,
  };
}

function scheduleSave() {
  if (!configReady) {
    savePending = true;
    return;
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void saveNow();
  }, 600);
}

async function saveNow() {
  if (!configReady || !window.desktop?.saveConfig) return;

  if (saveBusy) {
    saveAgain = true;
    return;
  }

  saveBusy = true;
  try {
    await window.desktop.saveConfig(buildConfig());
  } catch (error) {
    console.error(error);
    setStatus(
      `No se pudo guardar pads.json: ${error instanceof Error ? error.message : error}`,
      'error',
      8000,
    );
  } finally {
    saveBusy = false;
    if (saveAgain) {
      saveAgain = false;
      void saveNow();
    }
  }
}

function savedEntryFrom(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.path !== 'string' || value.path.trim() === '') return null;

  const volume = Number(value.volume);
  const rawFader = value.fader;
  const fader = rawFader === null || rawFader === undefined
    ? null
    : Number(rawFader);

  return {
    path: value.path,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : null,
    volume: Number.isFinite(volume) ? clamp01(volume) : 1,
    fader: fader === null || !Number.isFinite(fader)
      ? null
      : Math.max(0, Math.min(127, Math.round(fader))),
  };
}

async function loadSavedPads(savedPads, { onProgress = null } = {}) {
  savedPadEntries.clear();

  const entries = Object.entries(savedPads || {})
    .map(([key, value]) => [Number(key), value])
    .filter(([note, value]) => (
      Number.isInteger(note)
      && note >= 0
      && note < PAD_COUNT
      && value
      && typeof value.path === 'string'
    ))
    .sort((a, b) => a[0] - b[0]);

  for (const [note, value] of entries) {
    const entry = savedEntryFrom(value);
    if (entry) savedPadEntries.set(note, entry);
  }

  if (entries.length === 0) {
    resetStatus();
    return;
  }

  setStatus(
    `Cargando ${entries.length} pista${entries.length === 1 ? '' : 's'}…`,
    'muted',
    0,
  );

  let loaded = 0;
  let failed = 0;

  for (const [index, [note, value]] of entries.entries()) {
    const ok = await loadPadFromPath(note, value.path, {
      name: value.name ?? null,
      volume: value.volume ?? 1,
      fader: value.fader ?? null,
      quiet: true,
    });
    if (ok) loaded += 1;
    else failed += 1;

    if (onProgress) {
      onProgress({
        done: index + 1,
        total: entries.length,
        loaded,
        failed,
        name: value.name || baseName(value.path),
      });
    }
  }

  syncAllLeds();
  syncChannelFaders();
  refreshFaderAssignments();

  if (failed > 0) {
    setStatus(
      `${loaded} pista${loaded === 1 ? '' : 's'} cargada${loaded === 1 ? '' : 's'}; ${failed} no se pudo${failed === 1 ? '' : 'n'} cargar`,
      'error',
      8000,
    );
  } else {
    setStatus(
      `${loaded} pista${loaded === 1 ? '' : 's'} lista${loaded === 1 ? '' : 's'}`,
      'ok',
      3000,
    );
  }
}

/* ---------- MIDI ---------- */

function handleMidiStatus(info) {
  ui.midiStatus.classList.remove('is-on', 'is-warn');

  if (info.connected) {
    ui.midiStatus.classList.add(info.mk2 ? 'is-warn' : 'is-on');
    ui.midiText.textContent = info.mk2
      ? 'Controlador MK2 (LEDs MK1)'
      : 'Controlador conectado';
    if (info.mk2) {
      setStatus(
        'Controlador MK2 detectado: este sampler usa los LEDs del MK1. Los pads y faders deberían funcionar.',
        'info',
        0,
      );
    }
    syncAllLeds();
  } else if (info.hasInput) {
    ui.midiStatus.classList.add('is-warn');
    ui.midiText.textContent = 'Controlador sin salida MIDI';
  } else if (info.hasOutput) {
    ui.midiStatus.classList.add('is-warn');
    ui.midiText.textContent = 'Controlador sin entrada MIDI';
  } else {
    ui.midiText.textContent = 'Controlador no detectado';
    if (info.error) setStatus(`MIDI: ${info.error}`, 'error', 8000);
  }
}

/* ---------- Reloj y progreso ---------- */

function updateNowPlaying() {
  let newest = -1;
  let count = 0;

  for (let note = 0; note < PAD_COUNT; note += 1) {
    const pad = pads[note];
    if (pad.status !== 'playing' || !pad.source) continue;
    count += 1;
    if (newest === -1 || pad.startedAt > pads[newest].startedAt) newest = note;
  }

  if (newest === -1) {
    ui.nowState.textContent = 'SIN REPRODUCCIÓN';
    ui.nowName.textContent = '—';
    ui.nowName.title = '';
    ui.clock.textContent = '00:00';
    ui.clock.classList.remove('is-running', 'is-low');
    ui.progress.style.transform = 'scaleX(0)';
    ui.progress.classList.remove('is-low');
    return;
  }

  const pad = pads[newest];
  const length = Math.max(0.001, pad.duration || pad.buffer?.duration || 0.001);
  const elapsed = Math.max(0, (engine?.now() || 0) - pad.startedAt);
  const remaining = Math.max(0, length - elapsed);
  const name = displayName(pad);

  ui.nowState.textContent = `REPRODUCIENDO${count > 1 ? `   ·   +${count - 1} más` : ''}`;
  ui.nowName.textContent = name;
  ui.nowName.title = name;
  ui.clock.textContent = fmt(remaining);
  ui.clock.classList.add('is-running');
  ui.clock.classList.toggle('is-low', remaining <= 5);
  ui.progress.style.transform = `scaleX(${Math.min(1, elapsed / length)})`;
  ui.progress.classList.toggle('is-low', remaining <= 5);
}

function startUiLoop() {
  if (uiLoopTimer === null) uiLoopTimer = setInterval(updateNowPlaying, 50);
}

function finishBoot() {
  configReady = true;
  if (savePending) {
    savePending = false;
    scheduleSave();
  }
  startUiLoop();
  startRemotePublishing();
}

/* ---------- Control remoto ---------- */

let remotePublishTimer = null;
let remoteLastPayload = '';
let remoteUnsubscribe = null;

function buildRemoteState() {
  return {
    app: 'CUE PLAYER PAD',
    master: Math.round(state.master * 1000) / 1000,
    masterMuted: state.masterMuted,
    selected: state.selected,
    pads: pads.map((pad, note) => ({
      note,
      name: displayName(pad).slice(0, 80),
      status: pad.status,
      muted: pad.muted,
      volume: Math.round(pad.volume * 100) / 100,
      loaded: Boolean(pad.buffer),
    })),
  };
}

function publishRemoteState(force = false) {
  if (typeof window.desktop?.publishRemoteState !== 'function') return;

  let serialized;
  try {
    serialized = JSON.stringify(buildRemoteState());
  } catch {
    return;
  }

  if (!force && serialized === remoteLastPayload) return;
  remoteLastPayload = serialized;
  window.desktop.publishRemoteState(JSON.parse(serialized));
}

function startRemotePublishing() {
  if (remotePublishTimer !== null) return;
  remotePublishTimer = setInterval(() => publishRemoteState(), 400);
  publishRemoteState(true);
}

function applyRemoteCommand(command) {
  if (!command || typeof command !== 'object') return;

  const note = Number(command.note);
  const hasNote = Number.isInteger(note) && note >= 0 && note < PAD_COUNT;

  switch (command.kind) {
    case 'toggle':
      if (hasNote) togglePad(note);
      break;
    case 'mute':
      if (hasNote) togglePadMute(note);
      break;
    case 'stop_all':
      stopAll();
      break;
    case 'reset':
      resetPerformance();
      break;
    case 'master_mute':
      toggleMasterMute();
      break;
    case 'master': {
      const value = Number(command.value);
      if (Number.isFinite(value)) setMaster(value);
      break;
    }
    default:
      return;
  }

  publishRemoteState(true);
}

function remoteRow(label, url) {
  const row = document.createElement('div');
  row.className = 'remote-item';

  const copy = document.createElement('div');
  copy.className = 'remote-copy';

  const heading = document.createElement('span');
  heading.className = 'remote-label';
  heading.textContent = label;

  const input = document.createElement('input');
  input.className = 'remote-url';
  input.type = 'text';
  input.readOnly = true;
  input.value = url;
  input.title = url;
  input.setAttribute('aria-label', `Dirección de ${label}`);

  copy.append(heading, input);

  const button = document.createElement('button');
  button.className = 'btn btn-mini';
  button.type = 'button';
  button.textContent = 'Copiar';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = 'Copiado';
    } catch {
      input.focus();
      input.select();
      button.textContent = 'Seleccionado';
    }
    setTimeout(() => { button.textContent = 'Copiar'; }, 1400);
  });

  row.append(copy, button);
  return row;
}

async function openRemoteDialog() {
  ui.remoteDialog.showModal();
  ui.remoteStatus.className = 'remote-status';
  ui.remoteStatus.textContent = 'Comprobando el servidor…';
  ui.remoteList.replaceChildren();

  let info = null;
  try {
    info = await window.desktop?.getRemoteInfo?.();
  } catch (error) {
    ui.remoteStatus.classList.add('is-error');
    ui.remoteStatus.textContent = `No se pudo consultar el servidor: ${error instanceof Error ? error.message : error}`;
    return;
  }

  if (!info || !info.enabled) {
    ui.remoteStatus.classList.add('is-error');
    ui.remoteStatus.textContent = info?.error
      ? `Control remoto no disponible: ${info.error}`
      : 'Control remoto no disponible en este modo. Abre la aplicación de escritorio para usarlo.';
    return;
  }

  ui.remoteStatus.classList.add('is-on');
  ui.remoteStatus.textContent = `Servidor activo en el puerto ${info.port}`;

  for (const item of info.urls || []) {
    ui.remoteList.append(remoteRow(item.label, item.url));
  }
}

function setupRemote() {
  ui.remoteButton.addEventListener('click', () => { void openRemoteDialog(); });
  ui.remoteClose.addEventListener('click', () => ui.remoteDialog.close());

  try {
    const off = window.desktop?.onRemoteCommand?.(applyRemoteCommand);
    if (typeof off === 'function') remoteUnsubscribe = off;
  } catch {
    remoteUnsubscribe = null;
  }
}

/* ---------- Arranque ---------- */

function setupKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (
      ui.renameDialog.open
      || ui.editDialog.open
      || ui.newProjectDialog.open
      || ui.remoteDialog.open
      || ui.helpDialog.open
    ) return;
    if (contextMenu?.isOpen) return;
    if (state.moving !== null || state.learn !== null) {
      event.preventDefault();
      cancelModes();
      return;
    }
    if (isAssignmentOpen()) {
      event.preventDefault();
      closeAssignmentPanel();
    }
  });
}

async function boot() {
  setBootProgress(6, 'Preparando la interfaz…');

  contextMenu = new ContextMenu(ui.contextMenu);
  buildHardware();
  setupMaster();
  setupChannelFaders();
  setupInspector();
  setupDialogs();
  setupAssignmentPanel();
  setupProjectActions();
  setupRemote();
  updateMasterAssignment();
  updateAssignUi();
  setupKeyboard();
  setIdleStatus(DEFAULT_HINT, 'muted');
  syncChannelFaders();
  renderSelected();

  setBootProgress(20, 'Iniciando el motor de audio…');

  try {
    engine = new AudioEngine();
  } catch (error) {
    setStatus(
      `No se pudo iniciar el audio: ${error instanceof Error ? error.message : error}   ·   La configuración no se guardará.`,
      'error',
      0,
    );
    startUiLoop();
    return;
  }

  spectrum = new Spectrum(ui.spectrum, engine);
  spectrum.start();

  const unlockAudio = () => { void engine.resume(); };
  document.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
  document.addEventListener('keydown', unlockAudio, { capture: true });

  setBootProgress(32, 'Buscando el controlador MIDI…');

  midi = new MidiController({
    onPad: (note) => onPad(note, { gui: false }),
    onAction: onMidiAction,
    onCC: handleCC,
    onStatus: handleMidiStatus,
  });

  try {
    await midi.init();
  } catch (error) {
    console.error(error);
  }

  if (!window.desktop) {
    setStatus(
      'Abre la aplicación con «npm start» para cargar archivos y guardar la configuración.',
      'error',
      0,
    );
    startUiLoop();
    return;
  }

  setBootProgress(45, 'Leyendo el proyecto guardado…');
  setStatus('Cargando configuración…', 'muted', 0);

  let loaded;
  try {
    loaded = await window.desktop.loadConfig();
  } catch (error) {
    setStatus(
      `No se pudo leer la configuración: ${error instanceof Error ? error.message : error}   ·   La configuración no se guardará.`,
      'error',
      0,
    );
    startUiLoop();
    return;
  }

  if (!loaded?.config) {
    setStatus(
      `No se pudo leer la configuración: ${loaded?.error || 'error desconocido'}   ·   La configuración no se guardará.`,
      'error',
      0,
    );
    startUiLoop();
    return;
  }

  if (loaded.error) {
    setIdleStatus(`Configuración restaurada: ${loaded.error}`, 'error');
  }

  const config = loaded.config;
  state.master = clamp01(config.master ?? 1);
  state.masterCC = config.master_cc === null
    ? null
    : (Number.isInteger(config.master_cc) ? config.master_cc : MASTER_CC_DEFAULT);
  state.controls = normalizeControls(config.controls);

  engine.setMaster(state.master);
  renderMaster();
  renderControls();
  refreshMappingValues();
  updateMasterAssignment();
  updateAssignUi();

  setBootProgress(58, 'Cargando pistas…');

  await loadSavedPads(config.pads, {
    onProgress: ({ done, total, name }) => {
      const ratio = total > 0 ? done / total : 1;
      setBootProgress(
        58 + ratio * 36,
        `Cargando pistas ${done}/${total}${name ? ` · ${name}` : ''}`,
      );
    },
  });

  setBootProgress(96, 'Terminando de preparar la sesión…');

  const firstLoaded = pads.findIndex((pad) => pad.buffer);
  if (firstLoaded !== -1) selectPad(firstLoaded);
  else selectPad(0);

  syncChannelFaders();
  refreshFaderAssignments();
  syncAllLeds();
  renderSelected();

  if (loaded.error) resetStatus();
  finishBoot();
}

window.addEventListener('beforeunload', () => {
  clearTimeout(saveTimer);
  saveTimer = null;

  clearInterval(remotePublishTimer);
  remotePublishTimer = null;

  try {
    remoteUnsubscribe?.();
  } catch {
    // El canal ya puede estar cerrado.
  }

  if (configReady) {
    try {
      window.desktop?.saveConfigSync?.(buildConfig());
    } catch {
      // La ventana se está cerrando.
    }
  }

  midi?.allLedsOff();
  spectrum?.destroy();
  engine?.close();
});

void boot().finally(() => {
  hideBootScreen();
});
