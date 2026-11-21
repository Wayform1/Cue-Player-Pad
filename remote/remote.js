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
  const projectCard = document.getElementById('projectCard');
  const projectNameEl = document.getElementById('projectName');
  const projectStatus = document.getElementById('projectStatus');
  const projectFile = document.getElementById('projectFile');
  const projectPick = document.getElementById('projectPick');
  const projectLoad = document.getElementById('projectLoad');
  const projectProgress = document.getElementById('projectProgress');

  let lastPads = [];
  let lastState = null;
  let masterDragging = false;
  let masterSendTimer = null;
  let masterQueued = null;
  let toastTimer = null;
  let receivedState = false;
  let pickedProject = null;
  let uploadingProject = false;
  let projectStatusSticky = false;

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

  function setProjectStatus(message, tone = '') {
    projectStatus.textContent = message;
    projectStatus.className = 'project-status';
    if (tone) projectStatus.classList.add(tone);
    projectStatusSticky = tone === 'is-error';
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '';
    const mb = value / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`;
    return `${Math.max(1, Math.round(value / 1024))} KB`;
  }

  function sessionHasContent() {
    if (lastState?.project) return true;
    return Array.isArray(lastState?.pads) && lastState.pads.some((pad) => pad.loaded);
  }

  function updateProjectButtons() {
    projectPick.disabled = uploadingProject;
    projectLoad.disabled = uploadingProject || !pickedProject;
    projectCard.classList.toggle('is-busy', uploadingProject);
  }

  function selectProjectFile(file) {
    if (!file) return;
    if (!/\.cuepad$/i.test(file.name)) {
      pickedProject = null;
      projectProgress.hidden = true;
      setProjectStatus('El archivo debe ser un proyecto .cuepad.', 'is-error');
      updateProjectButtons();
      return;
    }

    pickedProject = file;
    projectProgress.hidden = true;
    projectProgress.value = 0;
    const size = formatSize(file.size);
    setProjectStatus(
      `Listo para cargar «${file.name}»${size ? ` · ${size}` : ''}. Se reemplazará la sesión actual del servidor.`,
    );
    updateProjectButtons();
  }

  function finishProjectUpload() {
    uploadingProject = false;
    updateProjectButtons();
  }

  function uploadProject() {
    if (!pickedProject || uploadingProject) return;

    if (sessionHasContent() && !window.confirm(
      'En el servidor ya hay un proyecto cargado.\n\n¿Reemplazarlo por este .cuepad?',
    )) {
      return;
    }

    const file = pickedProject;
    uploadingProject = true;
    updateProjectButtons();
    projectProgress.hidden = false;
    projectProgress.value = 0;
    setProjectStatus(`Subiendo «${file.name}»…`);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/project?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    // Margen amplio para proyectos grandes en redes lentas; el servidor corta
    // antes si la conexión deja de enviar datos.
    xhr.timeout = 20 * 60 * 1000;

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = Math.round((event.loaded / event.total) * 100);
      projectProgress.value = Math.min(99, percent);
      setProjectStatus(
        percent >= 100
          ? 'Archivo enviado. Extrayendo y cargando en el servidor…'
          : `Subiendo «${file.name}» · ${percent} %`,
      );
    });

    xhr.addEventListener('load', () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // La respuesta no era JSON.
      }

      if (xhr.status >= 200 && xhr.status < 300 && data?.ok) {
        projectProgress.value = 100;
        const loaded = Number(data.loaded) || 0;
        const missing = Array.isArray(data.missingPads) ? data.missingPads.length : 0;
        let message = `Proyecto cargado en el servidor: ${loaded} pista${loaded === 1 ? '' : 's'}`;
        if (missing > 0) message += ` · ${missing} sin audio`;
        setProjectStatus(message, 'is-ok');
        projectNameEl.textContent = data.project || file.name;
        projectNameEl.title = data.project || file.name;
        if (lastState) lastState.project = data.project || file.name;
        pickedProject = null;
        projectFile.value = '';
        showToast('Proyecto cargado en el servidor');
      } else {
        projectProgress.hidden = true;
        setProjectStatus(
          `No se pudo cargar: ${data?.error || `HTTP ${xhr.status}`}`,
          'is-error',
        );
        showToast('No se pudo cargar el proyecto', true);
      }

      finishProjectUpload();
    });

    xhr.addEventListener('error', () => {
      projectProgress.hidden = true;
      setProjectStatus('Error de red durante la subida. Comprueba el estado del servidor antes de reintentar.', 'is-error');
      showToast('Error de red al subir el proyecto', true);
      finishProjectUpload();
    });

    xhr.addEventListener('timeout', () => {
      projectProgress.hidden = true;
      setProjectStatus('No se recibió respuesta. Si el archivo ya se había enviado, el servidor puede haberlo aplicado; comprueba el estado al reconectar.', 'is-error');
      showToast('Tiempo de espera agotado al subir el proyecto', true);
      finishProjectUpload();
    });

    xhr.addEventListener('abort', () => {
      projectProgress.hidden = true;
      setProjectStatus('Carga interrumpida. Comprueba el estado del servidor antes de reintentar.', 'is-error');
      finishProjectUpload();
    });

    xhr.send(file);
  }

  function renderProject(name) {
    const label = typeof name === 'string' && name ? name : 'Sesión vacía';
    projectNameEl.textContent = label;
    projectNameEl.title = label;

    if (uploadingProject || pickedProject || projectStatusSticky) return;
    if (name) {
      setProjectStatus('Proyecto activo en el servidor.', 'is-ok');
    } else {
      setProjectStatus('Elige el archivo .cuepad guardado para cargarlo en el equipo anfitrión.');
    }
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
    // La ventana principal pinta la fila superior como los pads 56–63 y deja
    // los pads 0–7 abajo. El navegador debe mostrar exactamente el mismo orden.
    for (let visualRow = 0; visualRow < 8; visualRow += 1) {
      const row = 7 - visualRow;
      for (let column = 0; column < 8; column += 1) {
        const note = row * 8 + column;
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
        padEls[note] = { button, name };
      }
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
    lastState = state;
    setConnection('on', 'Conectado');
    renderMaster(state);
    renderProject(state.project);
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

  projectPick.addEventListener('click', () => projectFile.click());
  projectFile.addEventListener('change', () => {
    selectProjectFile(projectFile.files?.[0]);
  });
  projectLoad.addEventListener('click', uploadProject);

  projectCard.addEventListener('dragenter', (event) => {
    event.preventDefault();
    projectCard.classList.add('is-dragover');
  });
  projectCard.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  projectCard.addEventListener('dragleave', (event) => {
    if (!projectCard.contains(event.relatedTarget)) {
      projectCard.classList.remove('is-dragover');
    }
  });
  projectCard.addEventListener('drop', (event) => {
    event.preventDefault();
    projectCard.classList.remove('is-dragover');
    selectProjectFile(event.dataTransfer?.files?.[0]);
  });

  updateProjectButtons();
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
