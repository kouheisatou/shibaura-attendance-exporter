// ========== background.js ==========
// Service worker for the STST Attendance Exporter
// Handles tab navigation events and coordination

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;

  const { scrapeState } = await chrome.storage.local.get('scrapeState');
  if (!scrapeState || scrapeState.status !== 'running') return;

  // When navigating to Proj page during scraping, tell content script to resume
  if (tab.url.includes('/STST/ja/Menu/Proj')) {
    const { scrapeControl } = await chrome.storage.local.get('scrapeControl');

    if (scrapeControl && scrapeControl.action === 'start') {
      // Initial start
      setTimeout(() => {
        chrome.tabs.sendMessage(tabId, { type: 'START_SCRAPE' }).catch(() => {});
      }, 2000);
    }
    // resume_proj is handled by content-proj.js's checkAndResume on load
  }
  // AttendanceBook page auto-runs via content-attendance.js main()
});

// Handle extension icon click when already on the page
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes('asrv.sic.shibaura-it.ac.jp/STST')) {
    // Open popup
  }
});
