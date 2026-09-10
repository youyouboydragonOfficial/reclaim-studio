const $ = id => document.getElementById(id);
let results = [];
let startedAt = 0;
let timer;

function showToast(message) { const toast = $('toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3200); }
function fmtSize(bytes) { if (!bytes) return '未確定'; const units = ['B', 'KB', 'MB', 'GB']; let i = 0; let n = bytes; while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${units[i]}`; }
function renderResults() {
  $('results-list').innerHTML = results.length ? results.map((r, i) => `<div class="result-row"><input type="checkbox" data-index="${i}" checked><div class="file-name"><span class="file-icon">${r.extension.toUpperCase()}</span><span title="${r.name}">${r.name}</span></div><span>${r.extension.toUpperCase()}</span><span>${fmtSize(r.size)}</span><span class="confidence">${r.confidence}%</span><span class="state ${r.confidence === 100 ? 'confirmed' : ''}">${r.status}</span></div>`).join('') : '<div class="result-row"><span></span><span>候補は見つかりませんでした</span></div>';
  $('results-section').classList.remove('hidden');
  $('results-summary').textContent = `${results.length} 件の候補。復元先を選んでから、選択を復元してください。`;
  $('recover-button').disabled = !results.length;
}
function selected() { return [...document.querySelectorAll('#results-list input[type=checkbox]:checked')].map(x => results[Number(x.dataset.index)]); }
function setStep(step) { document.querySelectorAll('.step').forEach((node, i) => node.classList.toggle('active', i <= step)); }

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { $('splash').classList.add('hidden'); $('app').classList.remove('hidden'); }, 2600);
  $('browse-button').addEventListener('click', async () => { const folder = await window.reclaim.chooseFolder(); if (folder) $('source-path').value = folder; });
  document.querySelectorAll('.mode').forEach(mode => mode.addEventListener('click', () => { document.querySelectorAll('.mode').forEach(m => m.classList.remove('active')); mode.classList.add('active'); mode.querySelector('input').checked = true; }));
  $('scan-button').addEventListener('click', async () => {
    const source = $('source-path').value.trim();
    if (!source) return showToast('先に探す場所を指定してください');
    $('scan-button').disabled = true; $('activity-status').textContent = '走査中'; $('activity-status').classList.add('running'); $('signal-value').textContent = 'SCANNING'; $('activity-message').textContent = 'ストレージを読み取り中。元データには変更を加えません。'; $('progress-bar').style.width = '2%'; startedAt = Date.now(); timer = setInterval(() => { const s = Math.floor((Date.now() - startedAt) / 1000); $('elapsed').textContent = `00:${String(s).padStart(2, '0')}`; }, 1000); setStep(1);
    try {
      const mode = document.querySelector('input[name=mode]:checked').value;
      if (mode === 'raw') { window.reclaim.onProgress(value => { $('progress-bar').style.width = `${value.progress}%`; $('found-count').textContent = value.found; }); results = await window.reclaim.scanRaw(source); $('scanned-count').textContent = 'raw drive'; }
      else { const response = await window.reclaim.scanFolder(source); results = response.results; $('scanned-count').textContent = `${response.scanned.toLocaleString()} files`; $('found-count').textContent = results.length; $('progress-bar').style.width = '100%'; }
      renderResults(); $('activity-message').textContent = results.length ? `${results.length} 件の候補を検出しました。復元するものを選択してください。` : '候補は見つかりませんでした。別の場所でディープスキャンを試してください。'; $('activity-status').textContent = '完了'; $('signal-value').textContent = results.length ? 'FOUND' : 'CLEAR'; setStep(2);
    } catch (error) { showToast(error.message || 'スキャンに失敗しました'); $('activity-message').textContent = 'スキャンに失敗しました。パスと権限を確認してください。'; $('activity-status').textContent = 'エラー'; }
    clearInterval(timer); $('scan-button').disabled = false;
  });
  $('select-all').addEventListener('click', () => { const boxes = document.querySelectorAll('#results-list input[type=checkbox]'); const shouldCheck = [...boxes].some(x => !x.checked); boxes.forEach(x => x.checked = shouldCheck); });
  $('recover-button').addEventListener('click', async () => { const picks = selected(); if (!picks.length) return showToast('復元するファイルを選択してください'); const dest = await window.reclaim.chooseFolder(); if (!dest) return; $('recover-button').disabled = true; let done = 0; for (const candidate of picks) { try { await window.reclaim.recover({ candidate, destination: dest }); done++; } catch { /* continue with remaining candidates */ } } $('activity-message').textContent = `${done} 件を ${dest} に復元しました。`; showToast(`${done} 件を復元しました`); await window.reclaim.openFolder(dest); setStep(2); $('recover-button').disabled = false; });
  $('info-button').addEventListener('click', () => $('modal').classList.remove('hidden')); $('modal-close').addEventListener('click', () => $('modal').classList.add('hidden')); $('modal-ok').addEventListener('click', () => $('modal').classList.add('hidden'));
});
