// ========== content-proj.js ==========
// Content script for the Proj (アルバイト一覧) page

(function () {
  'use strict';

  const PROJ_URL = 'https://asrv.sic.shibaura-it.ac.jp/STST/ja/Menu/Proj';
  const WAIT = 2000;
  const MODAL_WAIT = 1500;
  const MODAL_POLL_INTERVAL = 300;
  const MODAL_MAX_WAIT = 10000;

  // ===== Utility =====
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Immediate stop check - throws if stopped
  async function checkStop() {
    const { scrapeControl } = await chrome.storage.local.get('scrapeControl');
    if (scrapeControl && scrapeControl.action === 'stop') {
      throw new Error('USER_STOP');
    }
  }

  async function log(msg, level = 'info') {
    const { scrapeLogs = [] } = await chrome.storage.local.get('scrapeLogs');
    scrapeLogs.push({ msg, level, time: new Date().toLocaleTimeString('ja-JP') });
    if (scrapeLogs.length > 200) scrapeLogs.splice(0, scrapeLogs.length - 200);
    await chrome.storage.local.set({ scrapeLogs });
  }

  async function updateState(partial) {
    const { scrapeState = {} } = await chrome.storage.local.get('scrapeState');
    Object.assign(scrapeState, partial);
    await chrome.storage.local.set({ scrapeState });
  }

  // ===== DOM Helpers =====

  // Force select to 全て (always fires change)
  async function forceSearchToAll() {
    const select = document.querySelector('select');
    if (!select) throw new Error('SELECT_NOT_FOUND');

    let val = null;
    for (const opt of select.options) {
      if (opt.textContent.trim() === '全て') { val = opt.value; break; }
    }
    if (val === null) throw new Error('ALL_OPTION_NOT_FOUND');

    // Skip if already set to 全て (avoids unnecessary page reload)
    if (select.value === val) return;

    select.value = val;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(WAIT);
  }

  // Get visible job rows from the table
  function getVisibleJobIds() {
    const rows = document.querySelectorAll('table tbody tr');
    const jobs = [];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 4) {
        const id = cells[1]?.textContent?.trim();
        const name = cells[2]?.textContent?.trim();
        const button = cells[0]?.querySelector('button');
        if (id && /^\d+$/.test(id) && button) {
          jobs.push({ id, name, button });
        }
      }
    });
    return jobs;
  }

  // Navigate to page N
  async function goToPage(n) {
    // Find page link
    const allLinks = document.querySelectorAll('a');
    for (const link of allLinks) {
      if (link.textContent.trim() === String(n)) {
        link.click();
        await sleep(WAIT);
        return true;
      }
    }
    return false;
  }

  // Wait for modal/dialog to appear by polling for visible modal content
  async function waitForModal() {
    const start = Date.now();
    while (Date.now() - start < MODAL_MAX_WAIT) {
      // Check for various modal/dialog indicators
      const modal = document.querySelector('.modal.show, .modal.in, .ui-popup-container, [role="dialog"]');
      if (modal && modal.getBoundingClientRect().height > 0) {
        // Modal is visible, wait a bit more for content to render
        await sleep(MODAL_WAIT);
        return true;
      }
      // Also check if proj_reg_list_btn appeared (some modals might not match selectors above)
      const kinBtn = document.getElementById('proj_reg_list_btn');
      if (kinBtn && kinBtn.getBoundingClientRect().width > 0) {
        await sleep(500);
        return true;
      }
      await sleep(MODAL_POLL_INTERVAL);
    }
    return false;
  }

  // ===== Job Collection =====
  async function collectAllJobs() {
    await log('検索条件を「全て」に設定...', 'info');
    await forceSearchToAll();
    await checkStop();

    // Figure out total pages
    const m = document.body.innerText.match(/(\d+)\s*件中/);
    const total = m ? parseInt(m[1]) : 0;
    const totalPages = Math.ceil(total / 15);
    await log(`全 ${total} 件 (${totalPages} ページ)`, 'info');

    // Go to page 1
    if (totalPages > 1) await goToPage(1);

    const allJobs = [];

    for (let page = 1; page <= totalPages; page++) {
      await checkStop();
      if (page > 1) await goToPage(page);

      const jobs = getVisibleJobIds();
      for (const j of jobs) {
        if (!allJobs.find(x => x.id === j.id)) {
          allJobs.push({ id: j.id, name: j.name, page });
        }
      }
      await log(`ページ ${page}: ${jobs.length} 件`, 'info');
    }

    await log(`合計 ${allJobs.length} 件のジョブを検出`, 'success');
    return allJobs;
  }

  // ===== Process One Job =====
  async function processOneJob(jobId, jobName, jobPage) {
    await checkStop();

    // 1) Ensure 全て filter
    await forceSearchToAll();

    // 2) Navigate to correct page
    if (jobPage > 1) {
      await goToPage(jobPage);
    }

    // 3) Find the job button and click it
    const jobs = getVisibleJobIds();
    const target = jobs.find(j => j.id === jobId);
    if (!target) {
      // Fallback: try all pages
      const totalPages = Math.ceil(26 / 15); // rough
      for (let p = 1; p <= totalPages; p++) {
        await goToPage(p);
        const retry = getVisibleJobIds().find(j => j.id === jobId);
        if (retry) { retry.button.click(); break; }
      }
      // If still not found
      const retryJobs = getVisibleJobIds();
      if (!retryJobs.find(j => j.id === jobId)) {
        await log(`${jobId}: テーブル上に見つかりません - スキップ`, 'warn');
        return 'skipped';
      }
    }

    // Re-fetch after possible page changes
    const freshJobs = getVisibleJobIds();
    const freshTarget = freshJobs.find(j => j.id === jobId);
    if (!freshTarget) {
      await log(`${jobId}: ボタンが見つかりません - スキップ`, 'warn');
      return 'skipped';
    }

    await log(`処理中: ${jobName} (${jobId})`, 'info');
    await updateState({ currentJob: `${jobName.substring(0, 35)}...` });

    // 4) Click button to open modal
    freshTarget.button.click();

    // 5) Wait for modal to fully appear by polling for visible content
    const modalReady = await waitForModal();

    if (!modalReady) {
      await log(`${jobId} ${jobName}: モーダルが開けませんでした - スキップ`, 'warn');
      const closeBtn = document.querySelector('.modal button, .ui-popup-container .ui-btn');
      if (closeBtn) closeBtn.click();
      await sleep(500);
      return 'no_attendance';
    }

    // 6) Check if 勤怠簿 button exists in modal (by ID)
    const kinBtn = document.getElementById('proj_reg_list_btn');

    if (!kinBtn || kinBtn.getBoundingClientRect().width === 0) {
      // No attendance book for this job (e.g. TA)
      await log(`${jobId} ${jobName}: 勤怠簿なし - スキップ`, 'warn');
      // Close modal
      const closeBtn = document.querySelector('.modal button, .ui-popup-container .ui-btn');
      if (closeBtn) closeBtn.click();
      await sleep(500);
      return 'no_attendance';
    }

    // 7) Save state and click 勤怠簿 → navigates to AttendanceBook
    await chrome.storage.local.set({
      currentScrapeJob: { jobId, jobName },
      scrapeControl: { action: 'continue' }
    });

    kinBtn.click();
    // Page navigates away; content-attendance.js takes over
    return 'navigating';
  }

  // ===== Main Loop =====
  async function processNextJob() {
    await checkStop();

    const { scrapeJobList, scrapeJobIndex, attendanceData = [] } = await chrome.storage.local.get([
      'scrapeJobList', 'scrapeJobIndex', 'attendanceData'
    ]);

    if (!scrapeJobList || scrapeJobIndex >= scrapeJobList.length) {
      // All done
      const totalRecords = attendanceData.reduce((s, d) => s + d.recordCount, 0);
      await log(`=== 全ジョブ完了! ${attendanceData.length} 件, ${totalRecords} レコード ===`, 'success');
      await updateState({ status: 'done', completedJobs: attendanceData.length, totalRecords });
      return;
    }

    const job = scrapeJobList[scrapeJobIndex];
    let result;

    try {
      result = await processOneJob(job.id, job.name, job.page);
    } catch (e) {
      if (e.message === 'USER_STOP') {
        await log('ユーザーにより中止されました', 'warn');
        await updateState({ status: 'stopped' });
        return;
      }
      // Unexpected error → skip this job
      await log(`${job.id} エラー: ${e.message} - スキップ`, 'error');
      result = 'error';
    }

    if (result === 'navigating') {
      // AttendanceBook page handles the rest
      return;
    }

    // Job was skipped or errored → record and move on
    const { attendanceData: data = [] } = await chrome.storage.local.get('attendanceData');
    data.push({
      jobTitle: `${job.name} (${job.id})`,
      records: [],
      recordCount: 0,
      skipped: true,
      reason: result
    });
    const totalRecords = data.reduce((s, d) => s + d.recordCount, 0);
    await chrome.storage.local.set({
      attendanceData: data,
      scrapeJobIndex: scrapeJobIndex + 1
    });
    await updateState({ completedJobs: data.length, totalRecords });

    await sleep(1000);
    return processNextJob();
  }

  // ===== Entry Points =====

  async function startScraping() {
    try {
      // Immediately change action to 'running' to prevent duplicate starts on page reload
      await chrome.storage.local.set({ scrapeControl: { action: 'running' } });

      await log('=== スクレイピング開始 ===', 'success');
      await updateState({ status: 'running', totalRecords: 0, completedJobs: 0 });

      const allJobs = await collectAllJobs();
      await updateState({ totalJobs: allJobs.length });

      await chrome.storage.local.set({
        scrapeJobList: allJobs,
        scrapeJobIndex: 0
      });

      // Go back to page 1 before processing
      await goToPage(1);
      await processNextJob();

    } catch (e) {
      if (e.message === 'USER_STOP') {
        await log('ユーザーにより中止されました', 'warn');
        await updateState({ status: 'stopped' });
      } else {
        await log(`致命的エラー: ${e.message}`, 'error');
        await updateState({ status: 'error' });
      }
    }
  }

  async function resumeAfterAttendance() {
    const { scrapeControl, scrapeState } = await chrome.storage.local.get(['scrapeControl', 'scrapeState']);

    if (scrapeState?.status === 'running' && scrapeControl?.action === 'resume_proj') {
      await log('Projページに復帰', 'info');
      await sleep(WAIT);
      try {
        await processNextJob();
      } catch (e) {
        if (e.message === 'USER_STOP') {
          await log('ユーザーにより中止されました', 'warn');
          await updateState({ status: 'stopped' });
        } else {
          await log(`エラー: ${e.message}`, 'error');
          await updateState({ status: 'error' });
        }
      }
    }
  }

  // ===== Auto-start / auto-resume on page load =====
  async function autoStart() {
    const { scrapeControl, scrapeState } = await chrome.storage.local.get(['scrapeControl', 'scrapeState']);

    // Stopped by user → do nothing
    if (scrapeControl?.action === 'stop') return;

    // Fresh start requested (from popup button)
    if (scrapeControl?.action === 'start' && scrapeState?.status === 'running') {
      if (scrapeStarted) return;
      scrapeStarted = true;
      // Immediately change to 'running' to prevent duplicate starts
      await chrome.storage.local.set({ scrapeControl: { action: 'running' } });
      await sleep(1000);
      startScraping();
      return;
    }

    // Resume after returning from AttendanceBook
    if (scrapeState?.status === 'running' && scrapeControl?.action === 'resume_proj') {
      if (scrapeStarted) return;
      scrapeStarted = true;
      await log('Projページに復帰', 'info');
      await sleep(WAIT);
      try {
        await processNextJob();
      } catch (e) {
        if (e.message === 'USER_STOP') {
          await log('ユーザーにより中止されました', 'warn');
          await updateState({ status: 'stopped' });
        } else {
          await log(`エラー: ${e.message}`, 'error');
          await updateState({ status: 'error' });
        }
      }
      return;
    }

    // Resume if page reloaded mid-scraping (e.g. select change caused reload)
    if (scrapeState?.status === 'running' && scrapeControl?.action === 'running') {
      if (scrapeStarted) return;
      scrapeStarted = true;
      const { scrapeJobList, scrapeJobIndex } = await chrome.storage.local.get(['scrapeJobList', 'scrapeJobIndex']);
      if (scrapeJobList && scrapeJobIndex != null) {
        await log('ページリロードから復帰 - 次のジョブへ', 'info');
        await sleep(WAIT);
        try {
          await processNextJob();
        } catch (e) {
          if (e.message === 'USER_STOP') {
            await log('ユーザーにより中止されました', 'warn');
            await updateState({ status: 'stopped' });
          } else {
            await log(`エラー: ${e.message}`, 'error');
            await updateState({ status: 'error' });
          }
        }
      }
    }
  }

  // Prevent double execution
  let scrapeStarted = false;

  // Message listener (for direct messages from popup)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_SCRAPE') {
      if (!scrapeStarted) {
        scrapeStarted = true;
        startScraping();
      }
      sendResponse({ ok: true });
    }
    return true;
  });

  autoStart();
})();
