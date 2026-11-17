const APC_RE = /apc[\s_-]*mini/i;

export class MidiController {
  constructor({ onPad, onAction, onCC, onStatus }) {
    this.onPad = onPad;
    this.onAction = onAction;
    this.onCC = onCC;
    this.onStatus = onStatus;

    this.access = null;
    this.input = null;
    this.output = null;
    this.refreshTimer = null;
    this.lastSignature = '';
  }

  async init() {
    if (!navigator.requestMIDIAccess) {
      this.onStatus({
        connected: false,
        hasInput: false,
        hasOutput: false,
        name: null,
        mk2: false,
        error: 'Web MIDI no está disponible en este equipo',
      });
      return;
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (error) {
      this.onStatus({
        connected: false,
        hasInput: false,
        hasOutput: false,
        name: null,
        mk2: false,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    this.access.onstatechange = () => this.scheduleRefresh();
    this.refresh();
  }

  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), 150);
  }

  refresh() {
    if (!this.access) return;

    const pickPort = (map) => {
      const ports = [...map.values()].filter((port) => APC_RE.test(port.name || ''));
      return ports.find((port) => port.state === 'connected') || ports[0] || null;
    };

    const input = pickPort(this.access.inputs);
    const output = pickPort(this.access.outputs);

    if (input !== this.input) {
      if (this.input) this.input.onmidimessage = null;
      this.input = input;
      if (input) {
        input.onmidimessage = (event) => this.handleMessage(event);
        try {
          input.open();
        } catch {
          // Algunos backends abren el puerto al asignar onmidimessage.
        }
      }
    }

    this.output = output;

    const signature = [
      input?.id || '',
      output?.id || '',
      input?.name || '',
      output?.name || '',
      input?.state || '',
      output?.state || '',
    ].join('|');

    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      const name = input?.name || output?.name || null;
      this.onStatus({
        connected: Boolean(input && output),
        hasInput: Boolean(input),
        hasOutput: Boolean(output),
        name,
        mk2: Boolean(name && /mk\s*2|mk2/i.test(name)),
        error: null,
      });
    }
  }

  handleMessage(event) {
    const data = event.data;
    if (!data || data.length < 2) return;

    const command = data[0] & 0xf0;
    const first = data[1];
    const second = data.length > 2 ? data[2] : 0;

    if (command === 0x90 && second > 0) {
      if (first < 64) this.onPad(first);
      else this.onAction(first);
    } else if (command === 0xb0) {
      this.onCC(first, second);
    }
  }

  led(note, velocity) {
    if (!this.output || this.output.state !== 'connected') return;
    try {
      this.output.send([
        0x90,
        Math.max(0, Math.min(127, note)),
        Math.max(0, Math.min(127, velocity)),
      ]);
    } catch {
      // El controlador puede haberse desconectado entre comprobaciones.
    }
  }

  allLedsOff() {
    for (let note = 0; note < 64; note += 1) this.led(note, 0);
    for (let note = 64; note <= 71; note += 1) this.led(note, 0);
    for (let note = 82; note <= 89; note += 1) this.led(note, 0);
    this.led(98, 0);
  }
}
