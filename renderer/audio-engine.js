import { clamp01 } from './utils.js';

export class AudioEngine {
  constructor({ padCount = 64, fftSize = 4096 } = {}) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Web Audio no está disponible');

    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0;

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.trackGains = Array.from({ length: padCount }, () => {
      const gain = this.ctx.createGain();
      gain.gain.value = 1;
      gain.connect(this.masterGain);
      return gain;
    });

    this.freqData = new Float32Array(this.analyser.frequencyBinCount);
  }

  get sampleRate() {
    return this.ctx.sampleRate;
  }

  get frequencyBinCount() {
    return this.analyser.frequencyBinCount;
  }

  now() {
    return this.ctx.currentTime;
  }

  async resume() {
    if (this.ctx.state === 'running' || this.ctx.state === 'closed') return;
    try {
      await this.ctx.resume();
    } catch {
      // En Electron el autoplay está permitido; en un navegador
      // se reintenta con el siguiente gesto del usuario.
    }
  }

  setMaster(value) {
    this._ramp(this.masterGain.gain, value);
  }

  setTrackVolume(index, value) {
    const gain = this.trackGains[index];
    if (gain) this._ramp(gain.gain, value);
  }

  _ramp(param, value) {
    const target = clamp01(value);
    const now = this.ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(target, now + 0.02);
  }

  async decode(bytes) {
    let arrayBuffer;
    if (bytes instanceof ArrayBuffer) {
      arrayBuffer = bytes;
    } else if (ArrayBuffer.isView(bytes)) {
      arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    } else {
      throw new Error('Formato de audio no reconocido');
    }
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  play(index, buffer) {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.trackGains[index]);
    source.start();
    return source;
  }

  stop(source) {
    if (!source) return;
    try {
      source.stop();
    } catch {
      // Ya estaba detenido.
    }
    try {
      source.disconnect();
    } catch {
      // Ignorar.
    }
  }

  readSpectrum(target) {
    this.analyser.getFloatFrequencyData(target);
  }

  close() {
    try {
      this.ctx.close();
    } catch {
      // Ignorar.
    }
  }
}
