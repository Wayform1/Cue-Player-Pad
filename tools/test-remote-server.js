'use strict';

// Prueba del servidor remoto: HTTP + HTTPS, certificado propio y órdenes MIDI.
// Uso: node tools/test-remote-server.js

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const https = require('node:https');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { RemoteServer } = require('../remote-server');
const { readProjectFile, writeProjectFile } = require('../project-format');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function post(base, command) {
  return request(`${base}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
}

function upload(base, body, name = 'prueba.cuepad', headers = {}) {
  return request(`${base}/api/project?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', ...headers },
    body,
  });
}

async function main() {
  const dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cue-remote-test-'));
  const received = [];
  const uploadCalls = { count: 0, names: [] };
  const extractRoot = path.join(dataDir, 'extraidos');
  const maxProjectBytes = 1024 * 1024;

  const audioPath = path.join(dataDir, 'tono.wav');
  await fsp.writeFile(audioPath, Buffer.from('RIFFprueba-audio'));
  const projectPath = path.join(dataDir, 'prueba.cuepad');
  await writeProjectFile({
    filePath: projectPath,
    appVersion: 'test',
    projectId: '12345678-1234-4123-8123-123456789abc',
    config: {
      version: 3,
      master: 0.7,
      master_cc: 56,
      controls: {},
      pads: {
        0: { path: audioPath, name: 'Prueba', volume: 0.8, fader: null },
      },
    },
  });
  const projectBytes = await fsp.readFile(projectPath);

  const server = new RemoteServer({
    dataDir,
    maxProjectBytes,
    onCommand: (command) => received.push(command),
    onProjectUpload: async ({ filePath, fileName, size }) => {
      uploadCalls.count += 1;
      uploadCalls.names.push(fileName);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const project = await readProjectFile({
        filePath,
        extractRoot,
        sanitizeConfig: (config) => config,
      });
      return {
        project: fileName,
        bytes: size,
        loaded: 1,
        audioCount: project.audioCount,
        missingPads: project.missingPads,
      };
    },
  });

  const result = { ok: false };

  try {
    const info = await server.start();
    const httpBase = `http://127.0.0.1:${info.port}`;
    const httpsBase = `https://127.0.0.1:${info.securePort}`;

    result.httpPort = info.port;
    result.httpsPort = info.securePort;
    result.httpsAvailable = info.httpsAvailable;

    const httpInfo = await request(`${httpBase}/api/info`);
    const httpsInfo = await request(`${httpsBase}/api/info`);
    result.infoSecureFlag = JSON.parse(httpsInfo.body).secure;
    result.infoInsecureFlag = JSON.parse(httpInfo.body).secure;

    const page = await request(`${httpsBase}/`);
    result.pageStatus = page.status;
    result.pageHasMidiScript = page.body.includes('/midi-remote.js');
    result.pageHasApcPanel = page.body.includes('apcConnect');

    const midiScript = await request(`${httpsBase}/midi-remote.js`);
    result.midiScriptStatus = midiScript.status;

    const valid = [
      { kind: 'toggle', note: 0 },
      { kind: 'mute', note: 63 },
      { kind: 'control', note: 82 },
      { kind: 'control', note: 98 },
      { kind: 'fader', cc: 48, value: 0.5 },
      { kind: 'fader', cc: 56, value: 1 },
      { kind: 'master', value: 0.25 },
      { kind: 'master_mute' },
      { kind: 'stop_all' },
      { kind: 'reset' },
    ];

    const accepted = [];
    for (const command of valid) {
      const response = await post(httpsBase, command);
      accepted.push(response.status);
    }
    result.acceptedAll200 = accepted.every((status) => status === 200);
    result.commandsReceived = received.length;

    const invalid = [
      { kind: 'control', note: 65.5 },
      { kind: 'control', note: 70 },
      { kind: 'control', note: 90 },
      { kind: 'fader', cc: 48, value: 2 },
      { kind: 'fader', cc: 200, value: 0.5 },
      { kind: 'fader', cc: 48.5, value: 0.5 },
      { kind: 'toggle', note: 64 },
      { kind: 'shutdown' },
    ];

    const rejected = [];
    for (const command of invalid) {
      // 70 es un botón de pista válido: se espera 200.
      const response = await post(httpsBase, command);
      rejected.push({ command, status: response.status });
    }
    result.invalidStatuses = rejected;

    const validUpload = await upload(httpsBase, projectBytes, 'prueba.cuepad');
    const validJson = JSON.parse(validUpload.body);
    result.uploadStatus = validUpload.status;
    result.uploadOk = validJson.ok === true && validJson.loaded === 1 && validJson.audioCount === 1;
    result.uploadName = validJson.project;

    const invalidUpload = await upload(
      httpsBase,
      Buffer.from('esto no es un proyecto'),
      'malo.cuepad',
    );
    result.invalidUploadStatus = invalidUpload.status;

    const emptyUpload = await upload(httpsBase, Buffer.alloc(0), 'vacio.cuepad', {
      'content-length': '0',
    });
    result.emptyUploadStatus = emptyUpload.status;

    const bigBody = Buffer.alloc(maxProjectBytes + 2048, 1);
    const bigUpload = await upload(httpsBase, bigBody, 'grande.cuepad', {
      'content-length': String(bigBody.length),
    });
    result.overSizeStatus = bigUpload.status;

    const concurrent = await Promise.all([
      upload(httpsBase, projectBytes, 'uno.cuepad'),
      upload(httpsBase, projectBytes, 'dos.cuepad'),
    ]);
    result.concurrentStatuses = concurrent
      .map((response) => response.status)
      .sort((a, b) => a - b);
    result.uploadCalls = uploadCalls.count;
    result.uploadNames = uploadCalls.names;

    await new Promise((resolve) => setTimeout(resolve, 250));
    const leftovers = await fsp
      .readdir(path.join(dataDir, 'remote-uploads'))
      .catch(() => []);
    result.uploadTempClean = leftovers.length === 0;

    const certDir = path.join(dataDir, 'remote-cert');
    const files = await fsp.readdir(certDir);
    result.certFiles = files;
    const cert = await fsp.readFile(path.join(certDir, 'cert.pem'), 'utf8');
    result.certFingerprint = crypto.createHash('sha256').update(cert).digest('hex').slice(0, 16);

    const before = await fsp.readFile(path.join(certDir, 'cert.pem'), 'utf8');
    server.stop();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const again = new RemoteServer({ dataDir, onCommand: () => {} });
    const secondInfo = await again.start();
    const after = await fsp.readFile(path.join(certDir, 'cert.pem'), 'utf8');
    result.httpsRestarted = Boolean(secondInfo.httpsAvailable);
    result.certReused = before === after;
    again.stop();

    const statuses = rejected.map((entry) => entry.status);
    result.ok = result.httpsAvailable
      && result.infoSecureFlag === true
      && result.infoInsecureFlag === false
      && result.pageStatus === 200
      && result.pageHasMidiScript
      && result.pageHasApcPanel
      && result.midiScriptStatus === 200
      && result.acceptedAll200
      && result.commandsReceived === valid.length
      && statuses[0] === 400
      && statuses[1] === 200
      && statuses[2] === 400
      && statuses[3] === 400
      && statuses[4] === 400
      && statuses[5] === 400
      && statuses[6] === 400
      && statuses[7] === 400
      && result.uploadStatus === 200
      && result.uploadOk
      && result.uploadName === 'prueba.cuepad'
      && result.invalidUploadStatus === 400
      && result.emptyUploadStatus === 400
      && result.overSizeStatus === 413
      && result.concurrentStatuses.length === 2
      && result.concurrentStatuses[0] === 200
      && result.concurrentStatuses[1] === 409
      && result.uploadCalls === 3
      && result.uploadTempClean
      && result.certReused
      && result.httpsRestarted;
  } finally {
    server.stop();
    await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
