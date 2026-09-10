const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let mainWindow;
const UPDATE_REPOSITORY = 'youyouboydragonOfficial/reclaim-studio';

function compareVersions(left, right) {
  const a = String(left).replace(/^v/, '').split('.').map(Number);
  const b = String(right).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0); }
  return 0;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#f4f7f8',
    title: 'Reclaim Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

function walkDirectory(root, maxFiles, onFile) {
  const stack = [root];
  let count = 0;
  while (stack.length && count < maxFiles) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (count >= maxFiles) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['System Volume Information', 'node_modules'].includes(entry.name)) stack.push(full);
        continue;
      }
      try {
        const stat = fs.statSync(full);
        if (stat.size > 0) { onFile({ path: full, name: entry.name, size: stat.size, modified: stat.mtimeMs }); count++; }
      } catch { /* inaccessible files are skipped */ }
    }
  }
  return count;
}

function driveRoots() {
  const roots = [];
  for (let code = 67; code <= 90; code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (fs.existsSync(root)) roots.push(root);
  }
  return roots;
}

function rawSource(source) {
  const value = (source || 'C:\\').trim();
  const drive = value.match(/^([A-Za-z]):\\?$/);
  return drive ? `\\\\.\\${drive[1].toUpperCase()}:` : value;
}

function signatureCandidates(filePath, maxFiles, onProgress) {
  const found = [];
  const seenOffsets = new Set();
  const signatures = [
    { ext: 'jpg', mime: 'image/jpeg', start: Buffer.from([0xff, 0xd8, 0xff]), end: Buffer.from([0xff, 0xd9]), max: 80 * 1024 * 1024 },
    { ext: 'png', mime: 'image/png', start: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), end: Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]), max: 80 * 1024 * 1024 },
    { ext: 'gif', mime: 'image/gif', start: Buffer.from('GIF8'), end: Buffer.from([0x3b]), max: 32 * 1024 * 1024 },
    { ext: 'mp4', mime: 'video/mp4', start: Buffer.from('ftyp'), end: null, max: 256 * 1024 * 1024 },
    { ext: 'avi', mime: 'video/x-msvideo', start: Buffer.from('RIFF'), end: null, max: 256 * 1024 * 1024 }
  ];
  let fd;
  try { fd = fs.openSync(filePath, 'r'); } catch (error) { throw new Error(`読み取りに失敗しました: ${error.message}`); }
  const chunkSize = 4 * 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  let offset = 0;
  let carry = Buffer.alloc(0);
  let active = null;
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, chunkSize, offset);
      if (!bytes) break;
      const chunk = Buffer.concat([carry, buffer.subarray(0, bytes)]);
      for (const sig of signatures) {
        let cursor = 0;
        while ((cursor = chunk.indexOf(sig.start, cursor)) !== -1 && found.length < maxFiles) {
          const isMp4 = sig.ext === 'mp4' && cursor < 4;
          if (sig.ext !== 'mp4' || (cursor >= 4 && chunk[cursor - 4] === 0)) {
            const absolute = offset - carry.length + cursor;
            const start = sig.ext === 'mp4' ? absolute - 4 : absolute;
            if (start >= 0 && !seenOffsets.has(start)) {
              seenOffsets.add(start);
              const endAt = sig.end ? chunk.indexOf(sig.end, cursor + sig.start.length) : -1;
              const size = endAt >= 0 ? endAt + sig.end.length - (sig.ext === 'mp4' ? cursor - 4 : cursor) : 0;
              found.push({ id: `${sig.ext}-${start}`, name: `recovered_${String(found.length + 1).padStart(4, '0')}.${sig.ext}`, extension: sig.ext, mime: sig.mime, size, offset: start, source: filePath, confidence: sig.ext === 'mp4' ? 71 : 92, status: '候補' });
            }
          }
          cursor += sig.start.length;
        }
      }
      onProgress(Math.min(99, Math.round((offset / Math.max(offset + bytes, 1)) * 100)), found.length);
      offset += bytes;
      carry = chunk.subarray(Math.max(0, chunk.length - 1024));
      if (found.length >= maxFiles) break;
    }
  } finally { fs.closeSync(fd); }
  return found;
}

function recoverCandidate(candidate, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const target = path.join(destination, candidate.name);
  const sourceFd = fs.openSync(candidate.source, 'r');
  const targetFd = fs.openSync(target, 'w');
  const chunk = Buffer.alloc(1024 * 1024);
  let remaining = candidate.size || 0;
  let position = candidate.offset;
  try {
    if (!remaining) remaining = candidate.extension === 'jpg' || candidate.extension === 'png' || candidate.extension === 'gif' ? 16 * 1024 * 1024 : 64 * 1024 * 1024;
    while (remaining > 0) {
      const read = fs.readSync(sourceFd, chunk, 0, Math.min(chunk.length, remaining), position);
      if (!read) break;
      fs.writeSync(targetFd, chunk, 0, read);
      position += read; remaining -= read;
    }
  } finally { fs.closeSync(sourceFd); fs.closeSync(targetFd); }
  return target;
}

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('scan-folder', async (event, root) => {
  const results = [];
  const roots = root && root.trim() ? [root.trim()] : driveRoots().map(drive => path.join(drive, '$Recycle.Bin'));
  let count = 0;
  for (const scanRoot of roots) count += walkDirectory(scanRoot, 5000 - count, item => {
    const ext = path.extname(item.name).slice(1).toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'pdf', 'docx'].includes(ext)) {
      results.push({ id: item.path, name: item.name, extension: ext, mime: ext, size: item.size, offset: 0, source: item.path, confidence: 100, status: '確認済み' });
    }
  });
  return { results, scanned: count };
});

ipcMain.handle('scan-raw', async (event, source) => {
  return signatureCandidates(rawSource(source), 300, (progress, found) => event.sender.send('scan-progress', { progress, found }));
});

ipcMain.handle('recover', async (event, { candidate, destination }) => {
  const output = recoverCandidate(candidate, destination);
  return { output };
});

ipcMain.handle('preview', async (event, candidate) => {
  const limit = 6 * 1024 * 1024;
  const size = Math.min(candidate.size || limit, limit);
  const fd = fs.openSync(candidate.source, 'r');
  const data = Buffer.alloc(size);
  try {
    const bytes = fs.readSync(fd, data, 0, size, candidate.offset || 0);
    const ext = String(candidate.extension || '').toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
    return { dataUrl: mime.startsWith('image/') ? `data:${mime};base64,${data.subarray(0, bytes).toString('base64')}` : null, bytes, mime };
  } finally { fs.closeSync(fd); }
});

ipcMain.handle('check-update', async () => {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`, { headers: { 'User-Agent': 'Reclaim-Studio' } });
  if (!response.ok) throw new Error(`更新情報の取得に失敗しました (${response.status})`);
  const release = await response.json();
  const latestVersion = String(release.tag_name || '').replace(/^v/, '');
  const asset = (release.assets || []).find(item => /^Reclaim\.Studio\.Setup\..+\.exe$/i.test(item.name));
  return { currentVersion: app.getVersion(), latestVersion, available: Boolean(asset) && compareVersions(latestVersion, app.getVersion()) > 0, releaseUrl: release.html_url, assetName: asset?.name || null, assetUrl: asset?.browser_download_url || null };
});

ipcMain.handle('download-update', async (event, { assetUrl, assetName }) => {
  if (!assetUrl || !/^https:\/\/github\.com\//.test(assetUrl)) throw new Error('更新ファイルのURLが無効です');
  const response = await fetch(assetUrl, { headers: { 'User-Agent': 'Reclaim-Studio' } });
  if (!response.ok || !response.body) throw new Error(`更新ファイルの取得に失敗しました (${response.status})`);
  const destination = path.join(app.getPath('temp'), assetName || 'Reclaim-Studio-Update.exe');
  const total = Number(response.headers.get('content-length') || 0);
  const writer = fs.createWriteStream(destination);
  const reader = response.body.getReader();
  let downloaded = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      writer.write(Buffer.from(part.value));
      downloaded += part.value.length;
      event.sender.send('update-progress', { downloaded, total, percent: total ? Math.round(downloaded / total * 100) : 0 });
    }
  } finally { await new Promise(resolve => writer.end(resolve)); }
  return { path: destination };
});

ipcMain.handle('install-update', async (event, installerPath) => {
  if (!installerPath || path.extname(installerPath).toLowerCase() !== '.exe') throw new Error('更新ファイルが見つかりません');
  const child = spawn(installerPath, [], { detached: true, stdio: 'ignore' });
  child.unref();
  setTimeout(() => app.quit(), 300);
  return true;
});

ipcMain.handle('open-folder', async (event, folder) => { await shell.openPath(folder); return true; });

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
