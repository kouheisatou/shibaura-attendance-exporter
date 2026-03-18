// ========== content-attendance.js ==========
// Content script for the AttendanceBook (勤怠簿) page

(function () {
  'use strict';

  const PROJ_URL = 'https://asrv.sic.shibaura-it.ac.jp/STST/ja/Menu/Proj';
  const MONTH_WAIT = 1500;
  const MAX_MONTHS = 36;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Throws if user pressed stop
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

  // ===== Data Extraction =====

  function extractCurrentMonth() {
    const m = document.body.innerText.match(/(\d{4})年(\d{1,2})月/);
    const year = m ? parseInt(m[1]) : 0;
    const month = m ? parseInt(m[2]) : 0;

    const rows = document.querySelectorAll('table tr');
    const records = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 5) {
        const d = cells[0].textContent.trim();
        if (/^\d{2}\/\d{2}\(/.test(d)) {
          const s = cells[1].textContent.trim();
          const e = cells[2].textContent.trim();
          const b = cells[3].textContent.trim();
          const w = cells[4].textContent.trim();
          const cb = cells[5]?.querySelector('input[type="checkbox"]');
          if (s || e || w) {
            records.push({
              日付: year + '/' + d.split('(')[0],
              曜日: (d.match(/\((.)\)/) || [])[1] || '',
              出勤: s, 退勤: e, 休憩: b, 勤務内容: w,
              承認: cb ? cb.checked : false
            });
          }
        }
      }
    });
    return { year, month, records };
  }

  function getJobTitle() {
    const el = document.querySelector('.ui-collapsible-heading-toggle');
    if (el) return el.textContent.trim().replace(' click to expand contents', '');
    return '不明';
  }

  function canGoPrev() {
    const btn = document.getElementById('prev_month');
    if (!btn) return false;
    return !btn.classList.contains('ui-state-disabled') &&
           btn.getAttribute('aria-disabled') !== 'true';
  }

  // ===== Main Collection =====

  async function collectAllMonths() {
    const jobTitle = getJobTitle();
    await log(`勤怠データ収集: ${jobTitle}`, 'info');
    await updateState({ currentJob: jobTitle.substring(0, 40) });

    const allRecords = [];
    const seen = new Set();

    // Current month
    const cur = extractCurrentMonth();
    seen.add(`${cur.year}-${cur.month}`);
    allRecords.push(...cur.records);
    if (cur.records.length > 0) {
      await log(`${cur.year}年${cur.month}月: ${cur.records.length} 件`, 'info');
    }

    // Navigate backwards
    let count = 0;
    while (count < MAX_MONTHS) {
      await checkStop(); // <-- immediate stop check every month

      if (!canGoPrev()) break;

      document.getElementById('prev_month').click();
      await sleep(MONTH_WAIT);
      count++;

      const data = extractCurrentMonth();
      const key = `${data.year}-${data.month}`;
      if (seen.has(key)) break;
      seen.add(key);

      allRecords.push(...data.records);
      if (data.records.length > 0) {
        await log(`${data.year}年${data.month}月: ${data.records.length} 件`, 'info');
      }
    }

    await log(`${jobTitle}: 合計 ${allRecords.length} 件`, 'success');
    return { jobTitle, records: allRecords, recordCount: allRecords.length };
  }

  // ===== Entry Point =====

  async function main() {
    const { scrapeState, scrapeControl } = await chrome.storage.local.get(['scrapeState', 'scrapeControl']);

    // Only run if active scraping session
    if (!scrapeState || scrapeState.status !== 'running') return;
    if (scrapeControl?.action === 'stop') return;

    await sleep(1500); // Wait for page render

    try {
      await checkStop();

      const jobData = await collectAllMonths();

      await checkStop();

      // Save results
      const { attendanceData = [], scrapeJobIndex = 0, scrapeJobList = [] } =
        await chrome.storage.local.get(['attendanceData', 'scrapeJobIndex', 'scrapeJobList']);

      attendanceData.push(jobData);
      const totalRecords = attendanceData.reduce((s, d) => s + d.recordCount, 0);
      const newIndex = scrapeJobIndex + 1;

      await chrome.storage.local.set({
        attendanceData,
        scrapeJobIndex: newIndex
      });
      await updateState({ completedJobs: attendanceData.length, totalRecords });
      await log(`保存完了 (${attendanceData.length}/${scrapeJobList.length})`, 'success');

      // Check if all done
      if (newIndex >= scrapeJobList.length) {
        await log(`=== 全ジョブ完了! ${attendanceData.length} 件, ${totalRecords} レコード ===`, 'success');
        await updateState({ status: 'done' });
        return;
      }

      // Go back to Proj page
      await chrome.storage.local.set({ scrapeControl: { action: 'resume_proj' } });
      await log('Projページに戻ります...', 'info');
      window.location.href = PROJ_URL;

    } catch (e) {
      if (e.message === 'USER_STOP') {
        await log('ユーザーにより中止されました', 'warn');
        await updateState({ status: 'stopped' });
      } else {
        await log(`エラー: ${e.message} - Projに戻ります`, 'error');
        // On error, skip this job and go back
        const { scrapeJobIndex = 0 } = await chrome.storage.local.get('scrapeJobIndex');
        await chrome.storage.local.set({
          scrapeJobIndex: scrapeJobIndex + 1,
          scrapeControl: { action: 'resume_proj' }
        });
        window.location.href = PROJ_URL;
      }
    }
  }

  main();
})();
