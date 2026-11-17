export const PAD_COUNT = 64;
export const MASTER_CC_DEFAULT = 56;
export const DEFAULT_HINT = 'Clic derecho en un pad: opciones · Clic derecho en un botón: asignarlo';

export const LED = Object.freeze({
  empty: 0,
  loading: 0,
  loaded: 5,   // amarillo
  playing: 2,  // verde parpadeante (lo hace el propio APC)
  stopped: 3,  // rojo
});

export const STATUS_LABEL = {
  empty: 'vacío',
  loading: 'cargando',
  loaded: 'cargado',
  playing: 'sonando',
  stopped: 'parado',
};

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value) {
  return clamp(Number(value) || 0, 0, 1);
}

export function fmt(seconds) {
  const total = Math.max(0, Math.ceil(Number(seconds) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function ccLabel(cc) {
  if (cc === null || cc === undefined) return 'Sin fader';
  if (cc >= 48 && cc <= 55) return `Fader ${cc - 47}`;
  if (cc === 56) return 'Fader Master';
  return `CC ${cc}`;
}

export function ccShort(cc) {
  if (cc === null || cc === undefined) return '';
  if (cc >= 48 && cc <= 55) return `F${cc - 47}`;
  if (cc === 56) return 'FM';
  return `C${cc}`;
}

export function baseName(filePath) {
  if (!filePath) return '';
  const file = filePath.split(/[\\/]/).pop() || filePath;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

function rgb(hex) {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

export function blend(hexA, hexB, t) {
  const a = rgb(hexA);
  const b = rgb(hexB);
  const k = clamp(Number(t) || 0, 0, 1);
  const channels = a.map((value, index) => Math.round(value + (b[index] - value) * k));
  return `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function segColor(segment, count) {
  const f = segment / Math.max(1, count - 1);
  if (f < 0.65) return blend('#2ecc71', '#f5c518', f / 0.65);
  return blend('#f5c518', '#e5484d', (f - 0.65) / 0.35);
}
