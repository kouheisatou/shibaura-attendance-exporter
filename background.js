// ========== background.js ==========
// Service worker for the STST Attendance Exporter
// Handles tab navigation events and coordination

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab.url) return;

  const { scrapeState } = await chrome.storage.local.get('scrapeState');
  if (!scrapeState || scrapeState.status !== 'running') return;

  // When navigating to Proj page during scraping:
  // autoStart() in content-proj.js handles both 'start' and 'resume_proj' actions,
  // so background.js does not need to send additional messages.
  // This prevents duplicate execution when page reloads (e.g. from select change).
  // AttendanceBook page auto-runs via content-attendance.js main()
});

// Handle extension icon click when already on the page
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.includes('asrv.sic.shibaura-it.ac.jp/STST')) {
    // Open popup
  }
});
