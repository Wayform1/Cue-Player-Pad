/*
 * Puente de demostración para abrir la interfaz en un navegador normal
 * (npm run preview). En Electron este archivo no hace nada porque
 * window.desktop ya lo proporciona preload.js.
 */
(() => {
  'use strict';

  if (window.desktop) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  const STORAGE_KEY = 'apcsampler.demo.config.v3';
  const SAMPLE_RATE = 24000;
  const TONE_PREFIX = 'demo://tone/';
  const cache = new Map();

  const DEMO_TRACKS = [
    { note: 0, step: 0, name: 'Demo · Do', volume: 0.9, fader: 48 },
    { note: 1, step: 2, name: 'Demo · Re', volume: 0.85, fader: 49 },
    { note: 2, step: 4, name: 'Demo · Mi', volume: 0.8, fader: 50 },
    { note: 3, step: 7, name: 'Demo · Sol', volume: 0.75, fader: 51 },
    { note: 8, step: 9, name: 'Demo · La', volume: 0.7, fader: 52 },
    { note: 9, step: 12, name: 'Demo · Do+', volume: 0.65, fader: 53 },
    { note: 10, step: 14, name: 'Demo · Re+', volume: 0.6, fader: 54 },
    { note: 16, step: 16, name: 'Demo · Mi+', volume: 0.55, fader: 55 },
    { note: 24, step: 19, name: 'Demo · Sol+', volume: 0.5, fader: null },
    { note: 32, step: 21, name: 'Demo · La+', volume: 0.45, fader: null },
    { note: 40, step: 24, name: 'Demo · Do++', volume: 0.4, fader: null },
    { note: 56, step: 26, name: 'Demo · Re++', volume: 0.35, fader: null },
  ];

  function defaultConfig() {
    const pads = {};
    for (const track of DEMO_TRACKS) {
      pads[track.note] = {
        path: `${TONE_PREFIX}${track.note}`,
        name: track.name,
        volume: track.volume,
        fader: track.fader,
      };
    }

    return { version: 3, master: 0.85, master_cc: 56, controls: {}, pads };
  }

  function writeString(view, offset, text) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }

  function encodeWav(samples) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    let offset = 44;
    for (let index = 0; index < samples.length; index += 1) {
      const value = Math.max(-1, Math.min(1, samples[index]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }

    return new Uint8Array(buffer);
  }

  function synthesize(note) {
    const track = DEMO_TRACKS.find((item) => item.note === note);
    const step = track ? track.step : note % 24;
    const frequency = 130.81 * 2 ** (step / 12);
    const duration = 1.2 + (note % 5) * 0.16;
    const total = Math.round(duration * SAMPLE_RATE);
    const samples = new Float32Array(total);

    let phase = 0;
    for (let index = 0; index < total; index += 1) {
      const time = index / SAMPLE_RATE;
      const attack = Math.min(1, time / 0.012);
      const decay = Math.exp(-2.4 * (time / duration));
      const release = Math.min(1, (duration - time) / 0.09);
      const vibrato = 1 + 0.0025 * Math.sin(2 * Math.PI * 5.2 * time);

      phase += (2 * Math.PI * frequency * vibrato) / SAMPLE_RATE;

      const wave = Math.sin(phase)
        + 0.36 * Math.sin(phase * 2)
        + 0.18 * Math.sin(phase * 3)
        + 0.07 * Math.sin(phase * 5);

      samples[index] = wave * attack * decay * Math.max(0, release) * 0.24;
    }

    return encodeWav(samples);
  }

  function readSavedConfig() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (
        parsed
        && typeof parsed === 'object'
        && parsed.pads
        && typeof parsed.pads === 'object'
        && !Array.isArray(parsed.pads)
      ) {
        return parsed;
      }
    } catch {
      // Configuración de demostración ilegible: se regenera.
    }

    return null;
  }

  function persist(config) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch {
      // localStorage puede estar bloqueado; la demo sigue funcionando en memoria.
    }
  }

  let memoryConfig = readSavedConfig() || defaultConfig();
  persist(memoryConfig);

  window.desktop = {
    isDemo: true,

    async loadConfig() {
      const config = readSavedConfig() || memoryConfig;
      memoryConfig = config;
      return { config, path: 'localStorage://pads.json', demo: true };
    },

    async saveConfig(data) {
      memoryConfig = data;
      persist(data);
      return true;
    },

    saveConfigSync(data) {
      memoryConfig = data;
      persist(data);
      return true;
    },

    async readAudioFile(filePath) {
      if (typeof filePath !== 'string' || !filePath.startsWith(TONE_PREFIX)) {
        throw new Error('Pista de demostración no disponible');
      }

      const note = Number(filePath.slice(TONE_PREFIX.length));
      if (!Number.isInteger(note) || note < 0 || note > 63) {
        throw new Error('Pista de demostración no válida');
      }

      if (!cache.has(filePath)) cache.set(filePath, synthesize(note));
      return cache.get(filePath);
    },

    async getConfigPath() {
      return 'localStorage://pads.json';
    },

    publishRemoteState() {},

    async getRemoteInfo() {
      return { enabled: false, error: 'El control remoto solo está disponible en la aplicación de escritorio' };
    },

    onRemoteCommand() {
      return () => {};
    },
  };

  const midiStatus = document.querySelector('.midi-status');
  if (midiStatus) {
    const badge = document.createElement('span');
    badge.className = 'demo-badge';
    badge.textContent = 'DEMO';
    badge.title = 'Vista previa: pistas sintéticas y configuración en localStorage';
    midiStatus.prepend(badge);
  }

  console.info(
    'CUE PLAYER PAD en modo demostración: pistas sintéticas y configuración en localStorage. '
    + 'Usa «npm start» para la aplicación Electron completa.',
  );
})();
