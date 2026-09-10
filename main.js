const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#0b1016',
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
        if (!['System Volume Information', '$RECYCLE.BIN', 'node_modules'].includes(entry.name)) stack.push(full);
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
  const count = walkDirectory(root, 5000, item => {
    const ext = path.extname(item.name).slice(1).toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'pdf', 'docx'].includes(ext)) {
      results.push({ id: item.path, name: item.name, extension: ext, mime: ext, size: item.size, offset: 0, source: item.path, confidence: 100, status: '確認済み' });
    }
  });
  return { results, scanned: count };
});

ipcMain.handle('scan-raw', async (event, source) => {
  return signatureCandidates(source, 300, (progress, found) => event.sender.send('scan-progress', { progress, found }));
});

ipcMain.handle('recover', async (event, { candidate, destination }) => {
  const output = recoverCandidate(candidate, destination);
  return { output };
});

ipcMain.handle('open-folder', async (event, folder) => { await shell.openPath(folder); return true; });

app.whenReady().then(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
