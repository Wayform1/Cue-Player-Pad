export class ContextMenu {
  constructor(element) {
    this.el = element;
    this.buttons = [];
    this.returnFocus = null;

    document.addEventListener('pointerdown', (event) => {
      if (!this.el.hidden && !this.el.contains(event.target)) {
        this.close({ restoreFocus: false });
      }
    }, true);

    document.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    window.addEventListener('blur', () => this.close({ restoreFocus: false }));
    window.addEventListener('resize', () => this.close({ restoreFocus: false }));
    window.addEventListener('scroll', () => this.close({ restoreFocus: false }), true);
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open({ x, y, items, returnFocus = null }) {
    this.el.replaceChildren();
    this.returnFocus = returnFocus;
    this.buttons = [];

    for (const item of items) {
      if (item.separator) {
        const separator = document.createElement('div');
        separator.className = 'menu-sep';
        separator.setAttribute('role', 'separator');
        this.el.append(separator);
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = item.label;
      button.disabled = Boolean(item.disabled);
      button.setAttribute('role', 'menuitem');
      button.addEventListener('click', () => {
        this.close({ restoreFocus: false });
        item.action();
      });
      this.el.append(button);
      if (!button.disabled) this.buttons.push(button);
    }

    this.el.hidden = false;
    this.el.style.left = '0px';
    this.el.style.top = '0px';

    const rect = this.el.getBoundingClientRect();
    const left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8));
    const top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;

    requestAnimationFrame(() => this.buttons[0]?.focus({ preventScroll: true }));
  }

  close({ restoreFocus = true } = {}) {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.el.replaceChildren();
    this.buttons = [];
    if (restoreFocus && this.returnFocus?.isConnected) {
      this.returnFocus.focus({ preventScroll: true });
    }
    this.returnFocus = null;
  }

  onKeyDown(event) {
    if (this.el.hidden) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
    if (this.buttons.length === 0) return;

    const current = this.buttons.indexOf(document.activeElement);
    let next;

    if (event.key === 'ArrowDown') {
      next = current >= this.buttons.length - 1 ? 0 : current + 1;
    } else if (event.key === 'ArrowUp') {
      next = current <= 0 ? this.buttons.length - 1 : current - 1;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = this.buttons.length - 1;
    } else if (event.shiftKey) {
      next = current <= 0 ? this.buttons.length - 1 : current - 1;
    } else {
      next = current >= this.buttons.length - 1 ? 0 : current + 1;
    }

    event.preventDefault();
    event.stopPropagation();
    this.buttons[next].focus({ preventScroll: true });
  }
}
