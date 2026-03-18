// ========== popup.js ==========
// Popup UI controller for the STST Attendance Exporter

let selectedFormat = 'csv';

// ---- DOM refs ----
const logArea = document.getElementById('logArea');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnExport = document.getElementById('btnExport');
const progressCard = document.getElementById('progressCard');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const progressPercent = document.getElementById('progressPercent');
const jobCountEl = document.getElementById('jobCount');
const recordCountEl = document.getElementById('recordCount');
const exportSection = document.getElementById('exportSection');
const warning = document.getElementById('warning');

// ---- Logging ----
function addLog(msg, level = 'info') {
  const div = document.createElement('div');
  div.className = `log-${level}`;
  div.textContent = `[${new Date().toLocaleTimeString('ja-JP')}] ${msg}`;
  logArea.appendChild(div);
  logArea.scrollTop = logArea.scrollHeight;
}

// ---- Format selector ----
document.querySelectorAll('.format-option').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.format-option').forEach(o => o.classList.remove('active'));
    el.classList.add('active');
    selectedFormat = el.dataset.format;
  });
});

// ---- State management ----
function updateUI(state) {
  if (!state) return;

  const { status, totalJobs, completedJobs, totalRecords, currentJob, logs } = state;

  jobCountEl.textContent = completedJobs || '--';
  recordCountEl.textContent = totalRecords || '--';

  if (status === 'idle') {
    btnStart.style.display = 'block';
    btnStop.style.display = 'none';
    progressCard.style.display = 'none';
    if (totalRecords > 0) {
      exportSection.style.display = 'block';
    }
  } else if (status === 'running') {
    btnStart.style.display = 'none';
    btnStop.style.display = 'block';
    progressCard.style.display = 'block';
    exportSection.style.display = 'none';

    const pct = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0;
    progressFill.style.width = pct + '%';
    progressPercent.textContent = pct + '%';
    progressLabel.textContent = currentJob || '処理中...';
  } else if (status === 'done') {
    btnStart.style.display = 'block';
    btnStart.textContent = '再スクレイピング';
    btnStop.style.display = 'none';
    progressCard.style.display = 'block';
    exportSection.style.display = 'block';

    progressFill.style.width = '100%';
    progressPercent.textContent = '100%';
    progressLabel.textContent = '完了!';
  } else if (status === 'error' || status === 'stopped') {
    btnStart.style.display = 'block';
    btnStart.textContent = 'スクレイピング再開';
    btnStop.style.display = 'none';
    if (totalRecords > 0) {
      exportSection.style.display = 'block';
    }
  }
}

// ---- Init: load persisted state ----
async function init() {
  const stored = await chrome.storage.local.get(['scrapeState', 'scrapeLogs', 'attendanceData']);

  if (stored.scrapeState) {
    updateUI(stored.scrapeState);
  }

  if (stored.scrapeLogs && stored.scrapeLogs.length > 0) {
    logArea.innerHTML = '';
    stored.scrapeLogs.slice(-50).forEach(l => {
      const div = document.createElement('div');
      div.className = `log-${l.level}`;
      div.textContent = `[${l.time}] ${l.msg}`;
      logArea.appendChild(div);
    });
    logArea.scrollTop = logArea.scrollHeight;
  }

  // Check if we're on the correct page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes('asrv.sic.shibaura-it.ac.jp/STST')) {
    warning.style.display = 'block';
    btnStart.disabled = true;
  }
}

// ---- Start scraping ----
btnStart.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  // Clear previous data
  await chrome.storage.local.set({
    scrapeState: {
      status: 'running',
      totalJobs: 0,
      completedJobs: 0,
      totalRecords: 0,
      currentJob: '初期化中...'
    },
    scrapeLogs: [],
    attendanceData: [],
    scrapeControl: { action: 'start' }
  });

  logArea.innerHTML = '';
  addLog('スクレイピングを開始します...', 'info');

  // Navigate to Proj page, or reload if already there
  // This ensures the content script loads fresh and picks up the 'start' control
  if (!tab.url.includes('/STST/ja/Menu/Proj')) {
    await chrome.tabs.update(tab.id, { url: 'https://asrv.sic.shibaura-it.ac.jp/STST/ja/Menu/Proj' });
    addLog('アルバイト一覧ページに移動中...', 'info');
  } else {
    // Try sending message; if content script isn't loaded, reload the page
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'START_SCRAPE' });
    } catch (e) {
      addLog('コンテンツスクリプト未検出 - ページをリロード', 'info');
      await chrome.tabs.reload(tab.id);
    }
  }

  updateUI({
    status: 'running', totalJobs: 0, completedJobs: 0, totalRecords: 0, currentJob: '初期化中...'
  });
});

// ---- Stop scraping ---- FORCE KILL via tab reload ----
btnStop.addEventListener('click', async () => {
  // 1) Set stop flag + stopped state immediately
  await chrome.storage.local.set({
    scrapeControl: { action: 'stop' },
    scrapeState: {
      ...(await chrome.storage.local.get('scrapeState')).scrapeState,
      status: 'stopped'
    }
  });

  // 2) Force-reload the tab to kill all running content scripts
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes('asrv.sic.shibaura-it.ac.jp')) {
    await chrome.tabs.update(tab.id, { url: 'https://asrv.sic.shibaura-it.ac.jp/STST/ja/Menu/Proj' });
  }

  addLog('強制中止しました', 'warn');
  updateUI({ ...(await chrome.storage.local.get('scrapeState')).scrapeState });
});

// ---- Export ----
btnExport.addEventListener('click', async () => {
  const { attendanceData } = await chrome.storage.local.get('attendanceData');
  if (!attendanceData || attendanceData.length === 0) {
    addLog('エクスポートするデータがありません', 'error');
    return;
  }

  if (selectedFormat === 'csv') {
    exportCSV(attendanceData);
  } else if (selectedFormat === 'json') {
    exportJSON(attendanceData);
  } else if (selectedFormat === 'xlsx') {
    exportCSV(attendanceData); // fallback to CSV, note in log
    addLog('XLSX形式はCSVとしてエクスポートされます（Excelで開けます）', 'warn');
  }
});

function exportCSV(data) {
  let csv = '\uFEFF' + 'アルバイト名,管理番号,日付,曜日,出勤,退勤,休憩,勤務内容,承認\n';
  data.forEach(job => {
    const match = job.jobTitle.match(/\((\d+)\)/);
    const id = match ? match[1] : '';
    const name = job.jobTitle.replace(/ \(\d+\)$/, '');
    if (job.records.length === 0) {
      csv += `"${name}",${id},,,,,,,"レコードなし"\n`;
    } else {
      job.records.forEach(r => {
        const content = (r.勤務内容 || '').replace(/"/g, '""');
        csv += `"${name}",${id},${r.日付},${r.曜日},${r.出勤},${r.退勤},${r.休憩},"${content}",${r.承認}\n`;
      });
    }
  });

  downloadFile(csv, 'attendance_data.csv', 'text/csv;charset=utf-8');
  addLog('CSVファイルをエクスポートしました', 'success');
}

function exportJSON(data) {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, 'attendance_data.json', 'application/json');
  addLog('JSONファイルをエクスポートしました', 'success');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  if (chrome.downloads && chrome.downloads.download) {
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }).catch(() => {
      fallbackDownload(url, filename);
    });
  } else {
    fallbackDownload(url, filename);
  }
}

function fallbackDownload(url, filename) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ---- Listen for state updates ----
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;

  if (changes.scrapeState) {
    updateUI(changes.scrapeState.newValue);
  }

  if (changes.scrapeLogs) {
    const logs = changes.scrapeLogs.newValue || [];
    if (logs.length > 0) {
      const last = logs[logs.length - 1];
      addLog(last.msg, last.level);
    }
  }
});

init();
