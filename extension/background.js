// Klick på tilläggsikonen öppnar (eller fokuserar) översikten i en egen flik.
// Använder runtime.getContexts i stället för tabs-behörigheten (som annars ger
// varningen "läsa din webbhistorik" vid installation).
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('dashboard.html');
  try {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    const existing = ctx.find((c) => c.tabId >= 0);
    if (existing) {
      await chrome.tabs.update(existing.tabId, { active: true });
      if (existing.windowId >= 0) await chrome.windows.update(existing.windowId, { focused: true });
      return;
    }
  } catch { /* äldre Chrome utan getContexts – öppna ny flik */ }
  await chrome.tabs.create({ url });
});
