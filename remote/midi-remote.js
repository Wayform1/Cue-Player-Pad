'use strict';

// Puente MIDI del control remoto.
// Permite usar un APC mini conectado al equipo remoto (Chrome/Edge de escritorio
// o Chrome de Android sobre HTTPS). Las órdenes viajan por HTTP al anfitrión y
// los LEDs se actualizan con el estado que llega por SSE.

(() => {
  const APC_RE = /apc[\s_-]*mini/i;
  const PAD_COUNT = 64;
  const CONTROL_NOTES = [64, 65, 66, 67, 68, 69, 70, 71, 82, 83, 84, 85, 86, 87, 88, 89, 98];
  const CONTROL_SET = new Set(CONTROL_NOTES);
  const FLUSH_MS = 60;

  let sendCommand = null;
  let access = null;
  let input = null;
  let output = null;
  let latestState = null;
  let sent = new Map();
  let connecting = false;
  let flushTimer = null;
  let pendingFaders = new Map();

  const card = () => document.getElementById('apcCard');
  const statusEl = () => document.getElementById('apcStatus');
  const buttonEl = () => document.getElementById('apcConnect');
  const linkEl = () => document.getElementById('apcSecureLink');

  function setStatus(text, tone = '') {
    const node = statusEl();
    const panel = card();
    if (node) node.textContent = text;
    if (panel) {
      panel.hidden = false;
      panel.classList.toggle('is-on', tone === 'on');
      panel.classList.toggle('is-error', tone === 'error');
    }
  }

  function init(options = {}) {
    sendCommand = typeof options.sendCommand === 'function' ? options.sendCommand : null;
    const secure = Boolean(options.secure);
    const httpsPort = Number.isFinite(options.httpsPort) ? options.httpsPort : null;
    const panel = card();
    const button = buttonEl();
    const link = linkEl();
    if (!panel) return;

    panel.hidden = false;

    if (!secure) {
      if (link && httpsPort) {
        link.href = `https://${location.hostname}:${httpsPort}/`;
        link.hidden = false;
        link.textContent = 'Usar HTTPS';
      }
      setStatus('Este equipo puede usar su propio APC mini desde la dirección HTTPS.');
      return;
    }

    if (!navigator.requestMIDIAccess) {
      setStatus('Este navegador no admite Web MIDI. Usa Chrome o Edge de escritorio, o Chrome en Android.', 'error');
      return;
    }

    if (button) {
      button.hidden = false;
      button.addEventListener('click', () => {
        if (access) disconnect();
        else void connect();
      });
    }

    setStatus('Pulsa «Conectar APC» y acepta el permiso MIDI del navegador.');
    if (latestState) applyLeds(latestState);
    window.addEventListener('pagehide', () => {
      if (output) allLedsOff();
    });
  }

  async function connect() {
    if (connecting || access) return;
    connecting = true;

    const button = buttonEl();
    if (button) {
      button.disabled = true;
      button.textContent = 'Conectando…';
    }
    setStatus('Solicitando acceso MIDI…');

    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (error) {
      connecting = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'Conectar APC';
      }
      setStatus(permissionMessage(error), 'error');
      return;
    }

    connecting = false;
    if (button) {
      button.disabled = false;
      button.textContent = 'Desconectar APC';
    }

    access.onstatechange = () => refresh();
    refresh();
  }

  function permissionMessage(error) {
    if (error && (error.name === 'SecurityError' || error.name === 'NotAllowedError')) {
      return 'Permiso MIDI denegado. Permite el acceso MIDI en el navegador y vuelve a intentarlo.';
    }
    return `No se pudo acceder al MIDI: ${error?.message || error}`;
  }

  function pickPort(map) {
    const ports = [...map.values()].filter((port) => APC_RE.test(port.name || ''));
    return ports.find((port) => port.state === 'connected') || null;
  }

  function refresh() {
    if (!access) return;

    const nextInput = pickPort(access.inputs);
    const nextOutput = pickPort(access.outputs);

    if (nextInput !== input) {
      if (input) input.onmidimessage = null;
      input = nextInput;
      if (input) {
        input.onmidimessage = handleMessage;
        try {
          input.open();
        } catch {
          // Algunos navegadores abren el puerto al asignar el manejador.
        }
      }
    }

    if (nextOutput !== output) {
      output = nextOutput;
      sent = new Map();
    }

    const button = buttonEl();
    if (input || output) {
      const name = input?.name || output?.name || 'APC mini';
      if (button) button.textContent = 'Desconectar APC';
      if (!output) {
        setStatus(`${name}: sin salida MIDI. Los LEDs no se actualizarán.`, 'error');
      } else if (!input) {
        setStatus(`${name}: sin entrada MIDI. No se pueden enviar órdenes.`, 'error');
      } else {
        setStatus(`${name} conectado. Los LEDs siguen el estado del anfitrión.`, 'on');
      }
      if (latestState) applyLeds(latestState);
    } else if (button) {
      button.textContent = 'Conectar APC';
      setStatus('No se encontró ningún APC mini en este equipo. Conéctalo por USB y vuelve a intentarlo.', 'error');
    }
  }

  function disconnect() {
    if (input) input.onmidimessage = null;
    if (output) allLedsOff();
    if (access) {
      try {
        access.onstatechange = null;
      } catch {
        // El acceso ya estaba cerrado.
      }
    }

    input = null;
    output = null;
    access = null;
    sent = new Map();

    const button = buttonEl();
    if (button) button.textContent = 'Conectar APC';
    setStatus('APC desconectado. Pulsa «Conectar APC» para volver a usarlo.');
  }

  function led(note, velocity) {
    if (!output || output.state !== 'connected') return;
    try {
      output.send([0x90, note & 0x7f, Math.max(0, Math.min(127, velocity))]);
    } catch {
      // El controlador puede haberse desconectado.
    }
  }

  function allLedsOff() {
    for (let note = 0; note < PAD_COUNT; note += 1) led(note, 0);
    for (const note of CONTROL_NOTES) led(note, 0);
  }

  function updateState(state, force = false) {
    if (!state || !Array.isArray(state.pads)) return;
    latestState = state;
    if (force) sent = new Map();
    applyLeds(state);
  }

  function applyLeds(state) {
    if (!output || !Array.isArray(state.pads)) return;

    for (let note = 0; note < PAD_COUNT; note += 1) {
      const velocity = Number(state.pads[note]?.led) || 0;
      if (sent.get(note) !== velocity) {
        sent.set(note, velocity);
        led(note, velocity);
      }
    }

    const controls = state.controls || {};
    for (const note of CONTROL_NOTES) {
      const velocity = Number(controls[note]) || 0;
      if (sent.get(note) !== velocity) {
        sent.set(note, velocity);
        led(note, velocity);
      }
    }
  }

  function handleMessage(event) {
    const data = event?.data;
    if (!data || data.length < 2) return;

    const command = data[0] & 0xf0;
    const note = data[1];
    const velocity = data.length > 2 ? data[2] : 0;

    if (command === 0x90 && velocity > 0) {
      if (note < PAD_COUNT) {
        void sendCommand?.({ kind: 'toggle', note });
      } else if (CONTROL_SET.has(note)) {
        void sendCommand?.({ kind: 'control', note });
      }
      return;
    }

    if (command === 0xb0) {
      pendingFaders.set(note, Math.max(0, Math.min(127, velocity)) / 127);
      if (flushTimer === null) {
        flushTimer = setTimeout(flushFaders, FLUSH_MS);
      }
    }
  }

  function flushFaders() {
    flushTimer = null;
    if (pendingFaders.size === 0) return;

    const entries = [...pendingFaders.entries()];
    pendingFaders = new Map();

    for (const [cc, value] of entries) {
      void sendCommand?.({ kind: 'fader', cc, value });
    }
  }

  window.CuePadRemoteMidi = { init, updateState };
})();
