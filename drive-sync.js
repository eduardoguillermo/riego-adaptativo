/* drive-sync.js — v1.0.0
   Sincroniza el Stock (componentes + movimientos) del escaner de Riego Adaptativo
   contra una carpeta visible "RiegoAdaptativoStock" en Drive. Mismo Client ID de
   OAuth que el resto del ecosistema de apps.
   Un solo archivo: riego-adaptativo-stock.json (componentes, movimientos, config de listas).
*/
const DriveSync = (() => {
  const CLIENT_ID = '1049169592532-is5j1j4s1bmgrc9tsq48slrgul8fbj17.apps.googleusercontent.com';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const CARPETA = 'RiegoAdaptativoStock';
  const ARCHIVO_BACKUP = 'riego-adaptativo-stock.json';

  let tokenClient = null;
  let accessToken = null;
  let folderId = null;
  let backupFileId = null;
  let renewTimer = null;
  const TOKEN_KEY = 'riego_stock_drive_token';

  function log(...args) { console.log('[DriveSync]', ...args); }

  function guardarToken(token, expiresInSeg) {
    const vencimiento = Date.now() + (expiresInSeg * 1000) - 60000; // 1 min de margen
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, vencimiento }));
  }
  function tokenGuardadoValido() {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return null;
      const { token, vencimiento } = JSON.parse(raw);
      if (Date.now() < vencimiento) return token;
      return null;
    } catch (e) { return null; }
  }

  function init(onReady) {
    if (!window.google || !google.accounts) {
      log('Google Identity Services todavía no cargó, reintentando...');
      setTimeout(() => init(onReady), 400);
      return;
    }
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
          if (resp.error) { log('Error de token', resp); return; }
          accessToken = resp.access_token;
          guardarToken(accessToken, resp.expires_in || 3600);
          programarRenovacion();
          if (onReady) onReady();
        },
        error_callback: (err) => { log('Intento de token falló (silencioso):', err && err.type); }
      });
    }
    // Si ya hay un token vigente guardado, lo reusamos sin pedir nada
    const guardado = tokenGuardadoValido();
    if (guardado) {
      accessToken = guardado;
      programarRenovacion();
      if (onReady) onReady();
    } else if (localStorage.getItem(TOKEN_KEY)) {
      // Hubo token antes pero venció: renovación silenciosa recién ahora,
      // que tokenClient ya existe (antes conectar() corría con tokenClient=null
      // porque GIS carga async y perdía la carrera → nunca se reconectaba).
      // Si nunca hubo token, no se intenta nada: el usuario conecta manualmente.
      tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  function conectar() {
    if (accessToken) return; // ya conectado (sesión en memoria o token guardado vigente)
    if (!tokenClient) { log('tokenClient no inicializado todavía'); return; }
    tokenClient.requestAccessToken({ prompt: '' }); // intento silencioso primero
  }

  function forzarReconexion() {
    accessToken = null;
    localStorage.removeItem(TOKEN_KEY);
    if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  // Renovación silenciosa: se programa según el vencimiento real del token (o 50 min por defecto)
  function programarRenovacion() {
    if (renewTimer) clearTimeout(renewTimer);
    let delay = 50 * 60 * 1000;
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (raw) {
        const { vencimiento } = JSON.parse(raw);
        delay = Math.max(vencimiento - Date.now() - 60000, 5000); // 1 min antes de vencer
      }
    } catch (e) { /* usar delay por defecto */ }
    renewTimer = setTimeout(() => {
      tokenClient.requestAccessToken({ prompt: '' });
    }, delay);
  }

  async function api(url, opts = {}) {
    const resp = await fetch(url, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok) throw new Error(`Drive API ${resp.status}: ${await resp.text()}`);
    return resp;
  }

  let _folderPromise = null;
  async function ensureFolder() {
    if (folderId) return folderId;
    if (_folderPromise) return _folderPromise; // ya hay una búsqueda/creación en curso: esperar esa misma
    _folderPromise = (async () => {
      const q = encodeURIComponent(`name='${CARPETA}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const resp = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await resp.json();
      if (data.files && data.files.length) { folderId = data.files[0].id; return folderId; }

      const createResp = await api('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: CARPETA, mimeType: 'application/vnd.google-apps.folder' })
      });
      const created = await createResp.json();
      folderId = created.id;
      return folderId;
    })();
    try { return await _folderPromise; } finally { _folderPromise = null; }
  }

  let _backupFilePromise = null;
  async function ensureBackupFile() {
    if (backupFileId) return backupFileId;
    if (_backupFilePromise) return _backupFilePromise; // ídem: evita crear el archivo dos veces en paralelo
    _backupFilePromise = (async () => {
      await ensureFolder();
      const q = encodeURIComponent(`name='${ARCHIVO_BACKUP}' and '${folderId}' in parents and trashed=false`);
      const resp = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`);
      const data = await resp.json();
      if (data.files && data.files.length) { backupFileId = data.files[0].id; return backupFileId; }

      // Archivo no existe: se crea vacío
      backupFileId = await subirJSON({}, true);
      return backupFileId;
    })();
    try { return await _backupFilePromise; } finally { _backupFilePromise = null; }
  }

  async function subirJSON(obj, creando = false, keepalive = false) {
    await ensureFolder();
    const boundary = 'riegostock_boundary';
    const metadata = creando
      ? { name: ARCHIVO_BACKUP, parents: [folderId], mimeType: 'application/json' }
      : { mimeType: 'application/json' };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;

    const url = creando
      ? 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
      : `https://www.googleapis.com/upload/drive/v3/files/${backupFileId}?uploadType=multipart`;

    const opts = {
      method: creando ? 'POST' : 'PATCH',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    };
    // keepalive: solo con body chico (límite del navegador ~64KB; si se excede,
    // fetch tira error de entrada y NO subiría nada — peor que sin keepalive)
    if (keepalive && body.length < 60000) opts.keepalive = true;

    const resp = await api(url, opts);
    const data = await resp.json();
    return data.id;
  }

  // ---------- Backup completo del stock ----------
  async function subirBackup(datosCompletos, keepalive = false) {
    await ensureBackupFile();
    await subirJSON(datosCompletos, false, keepalive);
  }

  async function bajarBackup() {
    await ensureBackupFile();
    const resp = await api(`https://www.googleapis.com/drive/v3/files/${backupFileId}?alt=media`);
    return resp.json();
  }

  return {
    init, conectar, forzarReconexion,
    subirBackup, bajarBackup,
    get conectado() { return !!accessToken; }
  };
})();
