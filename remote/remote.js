'use strict';

(() => {
  const conn = document.getElementById('conn');
  const connText = document.getElementById('connText');
  const grid = document.getElementById('grid');
  const now = document.getElementById('now');
  const master = document.getElementById('master');
  const masterValue = document.getElementById('masterValue');
  const masterMute = document.getElementById('masterMute');
  const stopAll = document.getElementById('stopAll');
  const reset = document.getElementById('reset');
  const toastEl = document.getElementById('toast');

  let lastPads = [];
  let masterDragging = false;
  let masterSendTimer = null;
  let masterQueued = null;
  let toastTimer = null;
  let receivedState = false;

  const padEls = [];

  function setConnection(mode, text) {
    conn.classList.toggle('is-on', mode === 'on');
    conn.classList.toggle('is-error', mode === 'error');
    connText.textContent = text;
  }

  function showToast(message, isError = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', isError);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 2400);
  }

  function sendCommand(command) {
    return fetch('/api/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    }).catch(() => {
      showToast('No se pudo enviar la orden. ¿Sigue conectado el equipo?', true);
      return false;
    });
  }

  function buildGrid() {
    for (let note = 0; note < 64; note += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pad';
      button.dataset.note = String(note);

      const number = document.createElement('span');
      number.className = 'pad-num';
      number.textContent = String(note + 1);

      const name = document.createElement('span');
      name.className = 'pad-name';
      name.textContent = 'Libre';

      button.append(number, name);
      button.addEventListener('click', () => {
        const pad = lastPads[note];
        if (!pad || !pad.loaded) {
          showToast('Ese pad está vacío');
          return;
        }
        void sendCommand({ kind: 'toggle', note });
      });

      grid.append(button);
      padEls.push({ button, name });
    }
  }

  function renderPads(pads) {
    lastPads = pads;
    let playing = 0;
    let playingName = '';

    for (let note = 0; note < 64; note += 1) {
      const pad = pads[note] || { note, name: '', status: 'empty', loaded: false, muted: false, volume: 1 };
      const view = padEls[note];
      if (!view) continue;

      const { button, name } = view;
      const loaded = Boolean(pad.loaded);
      const isPlaying = pad.status === 'playing';

      button.classList.toggle('is-loaded', loaded && !isPlaying && pad.status !== 'stopped');
      button.classList.toggle('is-playing', isPlaying);
      button.classList.toggle('is-stopped', pad.status === 'stopped');
      button.classList.toggle('is-muted', Boolean(pad.muted));
      button.classList.toggle('is-empty', !loaded);
      button.disabled = !loaded;

      name.textContent = loaded ? (pad.name || `Pad ${note + 1}`) : 'Libre';
      button.title = loaded
        ? `${pad.name || `Pad ${note + 1}`} · ${isPlaying ? 'sonando' : pad.status === 'stopped' ? 'detenido' : 'cargado'} · ${Math.round((pad.volume ?? 1) * 100)} %${pad.muted ? ' · silenciado' : ''}`
        : 'Pad vacío';
      button.setAttribute('aria-label', loaded
        ? `Pad ${note + 1}, ${pad.name || 'sin nombre'}, ${isPlaying ? 'sonando' : 'cargado'}`
        : `Pad ${note + 1}, vacío`);

      if (isPlaying) {
        playing += 1;
        if (!playingName) playingName = pad.name || `Pad ${note + 1}`;
      }
    }

    if (playing > 0) {
      now.textContent = `Sonando: ${playingName}${playing > 1 ? ` · +${playing - 1} más` : ''}`;
      now.classList.add('is-playing');
    } else {
      now.textContent = 'Sin reproducción';
      now.classList.remove('is-playing');
    }

    document.title = playing > 0
      ? `${playing} sonando · CUE PLAYER PAD`
      : 'CUE PLAYER PAD · Remoto';
  }

  function renderMaster(state) {
    const value = Math.round((state.master ?? 1) * 100);
    masterValue.textContent = `${value}%`;
    if (!masterDragging) master.value = String(value);

    const muted = Boolean(state.masterMuted);
    masterMute.classList.toggle('is-on', muted);
    masterMute.textContent = muted ? 'Mute activo' : 'Mute';
    masterMute.setAttribute('aria-pressed', String(muted));
  }

  function applyState(state) {
    if (!state || typeof state !== 'object') return;
    receivedState = true;
    setConnection('on', 'Conectado');
    renderMaster(state);
    if (Array.isArray(state.pads)) renderPads(state.pads);
    window.CuePadRemoteMidi?.updateState(state);
  }

  async function startMidi() {
    let httpsPort = null;
    try {
      const response = await fetch('/api/info', { cache: 'no-store' });
      if (response.ok) {
        const info = await response.json();
        if (Number.isFinite(info?.httpsPort)) httpsPort = info.httpsPort;
      }
    } catch {
      // Sin información del servidor: la tarjeta MIDI mostrará solo lo básico.
    }

    window.CuePadRemoteMidi?.init({
      sendCommand,
      secure: Boolean(window.isSecureContext),
      httpsPort,
    });
  }

  function connect() {
    const source = new EventSource('/api/events');
    source.addEventListener('open', () => setConnection('on', 'Conectado'));
    source.addEventListener('message', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'state') applyState(payload.state);
      } catch {
        // Mensaje incompleto: el siguiente estado lo corrige.
      }
    });
    source.addEventListener('error', () => {
      setConnection('error', 'Reconectando…');
    });
  }

  master.addEventListener('pointerdown', () => { masterDragging = true; });
  master.addEventListener('pointerup', () => { masterDragging = false; });
  master.addEventListener('pointercancel', () => { masterDragging = false; });

  master.addEventListener('input', () => {
    masterDragging = true;
    const value = Number(master.value) / 100;
    masterValue.textContent = `${master.value}%`;
    masterQueued = value;

    clearTimeout(masterSendTimer);
    masterSendTimer = setTimeout(() => {
      if (masterQueued === null) return;
      const pending = masterQueued;
      masterQueued = null;
      void sendCommand({ kind: 'master', value: pending });
    }, 90);
  });

  master.addEventListener('change', () => {
    masterDragging = false;
  });

  masterMute.addEventListener('click', () => { void sendCommand({ kind: 'master_mute' }); });

  stopAll.addEventListener('click', async () => {
    if (await sendCommand({ kind: 'stop_all' })) showToast('Todas las pistas detenidas');
  });

  reset.addEventListener('click', async () => {
    if (await sendCommand({ kind: 'reset' })) showToast('LEDs y estados reiniciados');
  });

  buildGrid();
  setConnection('', 'Conectando…');
  connect();
  void startMidi();

  setTimeout(() => {
    if (!receivedState) {
      setConnection('error', 'Sin conexión');
      showToast('No se pudo conectar. Comprueba que el equipo y el dispositivo estén en la misma red.', true);
    }
  }, 6000);
})();
