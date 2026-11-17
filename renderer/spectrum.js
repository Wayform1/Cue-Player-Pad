import { blend, clamp01, segColor } from './utils.js';

const SPEC_BANDS = 32;
const SPEC_SEGS = 16;
const SPEC_FMIN = 40;
const SPEC_FMAX = 16000;
const SPEC_FLOOR_DB = -70;
const SPEC_RANGE_DB = 60;
const SPEC_TILT_DB = 18;
const SPEC_FALL = 0.07;      // por fotograma de 50 ms
const PEAK_FALL = 0.012;
const FRAME_MS = 33;
const SPEC_BG = '#12151a';

export class Spectrum {
  constructor(canvas, engine) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;

    this.levels = new Float32Array(SPEC_BANDS);
    this.peaks = new Float32Array(SPEC_BANDS);
    this.target = new Float32Array(SPEC_BANDS);

    this.segOn = Array.from({ length: SPEC_SEGS }, (_, index) => segColor(index, SPEC_SEGS));
    this.segDim = this.segOn.map((color) => blend(color, SPEC_BG, 0.88));
    this.tilt = Array.from(
      { length: SPEC_BANDS },
      (_, index) => (index / (SPEC_BANDS - 1)) * SPEC_TILT_DB,
    );

    this.bg = document.createElement('canvas');
    this.width = 0;
    this.height = 0;
    this.dpr = 0;
    this.geometry = null;
    this.lastFrame = 0;
    this.raf = null;

    this._buildBands();
    this._resize = this.resize.bind(this);
    this._loop = this.loop.bind(this);
    this.resizeObserver = new ResizeObserver(this._resize);
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  _buildBands() {
    const binHz = this.engine.sampleRate / this.engine.analyser.fftSize;
    const maxBin = Math.max(
      2,
      Math.min(this.engine.frequencyBinCount, Math.floor(SPEC_FMAX / binHz)),
    );

    const edges = new Int32Array(SPEC_BANDS + 1);
    let previous = 0;
    for (let band = 0; band < SPEC_BANDS; band += 1) {
      const frequency = SPEC_FMIN * (SPEC_FMAX / SPEC_FMIN) ** (band / SPEC_BANDS);
      let start = Math.max(Math.round(frequency / binHz), previous + 1);
      start = Math.min(start, Math.max(1, maxBin - (SPEC_BANDS - band)));
      edges[band] = Math.max(1, start);
      previous = edges[band];
    }
    edges[SPEC_BANDS] = maxBin;

    for (let index = 1; index <= SPEC_BANDS; index += 1) {
      if (edges[index] <= edges[index - 1]) edges[index] = edges[index - 1] + 1;
    }

    this.edges = edges;
  }

  start() {
    if (this.raf === null) this.raf = requestAnimationFrame(this._loop);
  }

  stop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    if (width === this.width && height === this.height && dpr === this.dpr) return;

    this.width = width;
    this.height = height;
    this.dpr = dpr;

    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.bg.width = Math.round(width * dpr);
    this.bg.height = Math.round(height * dpr);
    const bgCtx = this.bg.getContext('2d');
    bgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this._layout();
    this._paintBackground(bgCtx);
  }

  _layout() {
    const width = this.width;
    const height = this.height;
    let gapX = 2;
    let gapY = 2;

    if ((width - gapX * (SPEC_BANDS - 1)) / SPEC_BANDS < 2) gapX = 0;
    if ((height - gapY * (SPEC_SEGS - 1)) / SPEC_SEGS < 2) gapY = 0;

    const barWidth = (width - gapX * (SPEC_BANDS - 1)) / SPEC_BANDS;
    const segmentHeight = (height - gapY * (SPEC_SEGS - 1)) / SPEC_SEGS;

    this.geometry = {
      gapX,
      gapY,
      barWidth: Math.max(1, barWidth),
      segmentHeight: Math.max(1, segmentHeight),
    };
  }

  _paintBackground(ctx) {
    const { gapX, gapY, barWidth, segmentHeight } = this.geometry;
    ctx.clearRect(0, 0, this.width, this.height);
    for (let band = 0; band < SPEC_BANDS; band += 1) {
      const x = band * (barWidth + gapX);
      for (let segment = 0; segment < SPEC_SEGS; segment += 1) {
        const y2 = this.height - segment * (segmentHeight + gapY);
        ctx.fillStyle = this.segDim[segment];
        ctx.fillRect(x, y2 - segmentHeight, barWidth, segmentHeight);
      }
    }
  }

  loop(timestamp) {
    this.raf = requestAnimationFrame(this._loop);
    if (!this.lastFrame) {
      this.lastFrame = timestamp;
      return;
    }
    const elapsed = timestamp - this.lastFrame;
    if (elapsed < FRAME_MS) return;

    this.lastFrame = timestamp;
    this.update(Math.min(0.2, elapsed / 1000));
  }

  update(deltaSeconds) {
    const data = this.engine.freqData;
    try {
      this.engine.readSpectrum(data);
    } catch {
      data.fill(-Infinity);
    }

    const binCount = this.engine.frequencyBinCount;
    const frameScale = deltaSeconds / 0.05;

    for (let band = 0; band < SPEC_BANDS; band += 1) {
      const start = Math.min(this.edges[band], binCount);
      const end = Math.min(this.edges[band + 1], binCount);
      let db = -Infinity;

      for (let index = start; index < end; index += 1) {
        const value = data[index];
        if (value > db) db = value;
      }

      if (!Number.isFinite(db)) db = SPEC_FLOOR_DB - SPEC_RANGE_DB;
      this.target[band] = clamp01((db - SPEC_FLOOR_DB + this.tilt[band]) / SPEC_RANGE_DB);

      this.levels[band] = Math.max(
        this.target[band],
        this.levels[band] - SPEC_FALL * frameScale,
      );
      this.peaks[band] = Math.max(
        this.levels[band],
        this.peaks[band] - PEAK_FALL * frameScale,
      );
    }

    this.draw();
  }

  draw() {
    if (!this.geometry || this.width < 8 || this.height < 8) return;

    const ctx = this.ctx;
    const { gapX, gapY, barWidth, segmentHeight } = this.geometry;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.drawImage(this.bg, 0, 0, this.width, this.height);

    for (let band = 0; band < SPEC_BANDS; band += 1) {
      const x = band * (barWidth + gapX);
      const lit = Math.round(this.levels[band] * SPEC_SEGS);

      for (let segment = 0; segment < lit; segment += 1) {
        const y2 = this.height - segment * (segmentHeight + gapY);
        ctx.fillStyle = this.segOn[segment];
        ctx.fillRect(x, y2 - segmentHeight, barWidth, segmentHeight);
      }

      let peakSegment = Math.round(this.peaks[band] * SPEC_SEGS) - 1;
      if (peakSegment < lit) peakSegment = -1;

      if (peakSegment >= 0) {
        const y2 = this.height - peakSegment * (segmentHeight + gapY);
        ctx.fillStyle = '#e8eaed';
        ctx.fillRect(x, y2 - segmentHeight, barWidth, Math.min(3, segmentHeight));
      }
    }
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
  }
}
