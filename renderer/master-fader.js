import { clamp01 } from './utils.js';

const THUMB_HEIGHT = 42;
const THUMB_RADIUS = THUMB_HEIGHT / 2;

export class MasterFader {
  constructor(element, { onChange }) {
    this.el = element;
    this.thumb = element.querySelector('.fader-thumb');
    this.fill = element.querySelector('.fader-fill');
    this.onChange = onChange;
    this.value = 1;
    this.dragging = false;

    this.el.setAttribute('aria-orientation', 'vertical');
    this.el.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.el.addEventListener('pointermove', (event) => this.onPointerMove(event));
    this.el.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.el.addEventListener('pointercancel', (event) => this.onPointerUp(event));
    this.el.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.el.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });

    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.el);
    this.render();
  }

  setValue(value, { emit = false } = {}) {
    this.value = clamp01(value);
    this.render();
    if (emit) this.onChange(this.value);
  }

  render() {
    const height = this.el.clientHeight;
    const travel = Math.max(0, height - THUMB_HEIGHT);
    const bottom = this.value * travel;

    this.thumb.style.bottom = `${bottom}px`;
    this.fill.style.height = `${THUMB_RADIUS + bottom}px`;

    const percent = Math.round(this.value * 100);
    this.el.setAttribute('aria-valuenow', String(percent));
    this.el.setAttribute('aria-valuetext', `${percent}%`);
  }

  valueFromPointer(event) {
    const rect = this.el.getBoundingClientRect();
    const travel = Math.max(1, rect.height - THUMB_HEIGHT);
    const center = event.clientY - rect.top - THUMB_RADIUS;
    return clamp01(1 - center / travel);
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.el.focus({ preventScroll: true });
    this.dragging = true;
    try {
      this.el.setPointerCapture(event.pointerId);
    } catch {
      // Algunos entornos no permiten capturar el puntero.
    }
    this.setValue(this.valueFromPointer(event), { emit: true });
  }

  onPointerMove(event) {
    if (!this.dragging) return;
    this.setValue(this.valueFromPointer(event), { emit: true });
  }

  onPointerUp(event) {
    if (!this.dragging) return;
    this.dragging = false;
    try {
      this.el.releasePointerCapture(event.pointerId);
    } catch {
      // Ignorar.
    }
  }

  onKeyDown(event) {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next = null;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = this.value + step;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = this.value - step;
        break;
      case 'PageUp':
        next = this.value + 0.1;
        break;
      case 'PageDown':
        next = this.value - 0.1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.setValue(next, { emit: true });
  }

  onWheel(event) {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.02 : -0.02;
    this.setValue(this.value + delta, { emit: true });
  }
}
