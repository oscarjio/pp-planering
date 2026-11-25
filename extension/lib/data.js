// Datainhämtning från Projektportalen via content scriptet (skrivskyddad proxy).
// Körs i tilläggets dashboard-sida.
(function (root) {
  const PP_URL = 'https://new-app.projektportalen.se/';
  const PP_MATCH = 'https://new-app.projektportalen.se/*';
  const INACTIVE_RE = /COMPLET|CLOS|DONE|FINISH|INVOIC|CANCEL|ARCHIV|LOST|AVSLUT|UTF[ÖO]RD|FAKTUR/i;

  let ppTabId = null;

  async function ping(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: 'pp-ping' });
    } catch {
      return null;
    }
  }

  /** Hitta en öppen Projektportalen-flik (injicera content script vid behov). */
  async function findTab() {
    const tabs = await chrome.tabs.query({ url: PP_MATCH });
    for (const t of tabs) {
      let r = await ping(t.id);
      if (!r) {
        try {
          await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content.js'] });
          r = await ping(t.id);
        } catch { /* fliken kanske laddar */ }
      }
      if (r && r.ok) {
        ppTabId = t.id;
        return { tabId: t.id, ...r };
      }
    }
    return null;
  }

  async function openPortal() {
    await chrome.tabs.create({ url: PP_URL, active: true });
  }

  async function api(req) {
    if (ppTabId == null) throw new Error('Ingen Projektportalen-flik ansluten.');
    const res = await chrome.tabs.sendMessage(ppTabId, { type: 'pp-api', req });
    if (!res) throw new Error('Inget svar från Projektportalen-fliken.');
    if (!res.ok) {
      const e = new Error(res.error || 'Okänt fel');
      e.status = res.status;
      throw e;
    }
    return res.data;
  }

  async function pool(items, n, fn) {
    const out = new Array(items.length);
    let i = 0;
    async function worker() {
      while (i < items.length) {
        const idx = i++;
        try { out[idx] = await fn(items[idx], idx); } catch (e) { out[idx] = { __error: e }; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return out;
  }

  const ymd = (d) => {
    const z = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  };

  async function loadProjectList() {
    const rows = [];
    for (let start = 0; start < 5000; start += 500) {
      const r = await api({
        method: 'POST', path: '/projects/list',
        body: { StartRow: start, EndRow: start + 500, SortModel: [], FilterModel: {}, RowGroupCols: [],
          ValueCols: [], TabIndex: 4, Keyword: '', GroupKeys: [] },
      });
      const page = (r && r.Rows) || [];
      rows.push(...page);
      if (page.length < 500 || rows.length >= (r.TotalCount || 0)) break;
    }
    return rows;
  }

  async function loadTimeManage(today, days) {
    // Veckovis bakåt, `days` dagar som slutar igår.
    const perProject = new Map();   // ProjectId -> [{date, hours}]
    const perUser = new Map();      // UserId -> timmar
    const end = new Date(today.getTime() - 864e5);
    for (let off = 0; off < days; off += 7) {
      const e = new Date(end.getTime() - off * 864e5);
      const s = new Date(e.getTime() - 6 * 864e5);
      const j = await api({ method: 'GET', path: '/time-manage',
        query: { StartDate: ymd(s), EndDate: ymd(e), ShowSevenDays: 'true' } });
      for (const u of (j && j.AllUsersReportTime) || []) {
        for (const t of u.UserActualTimeList || []) {
          const h = Number(t.Quantity) || 0;
          if (!perProject.has(t.ProjectId)) perProject.set(t.ProjectId, []);
          perProject.get(t.ProjectId).push({ date: t.ReportDate || t.Timestamp, hours: h });
          perUser.set(u.UserId, (perUser.get(u.UserId) || 0) + h);
        }
        if (!perUser.has(u.UserId)) perUser.set(u.UserId, 0);
      }
    }
    return { perProject, perUser };
  }

  async function loadReportedTimes(projectId) {
    const r = await api({
      method: 'POST', path: '/projects/reported-user-times',
      body: { StartRow: 0, EndRow: 1000, ProjectId: String(projectId), FilterModel: {},
        SortModel: [{ colId: 'ReportDate', sort: 'desc' }], RowGroupCols: [], ValueCols: [],
        PivotCols: [], PivotMode: false, GroupKeys: [], Keyword: '' },
    });
    const rows = Array.isArray(r) ? r : (r && (r.Rows || r.rows)) || [];
    return rows.map((x) => ({ date: x.ReportDate || x.Timestamp, hours: Number(x.Quantity) || 0 }));
  }

  /**
   * Hämta allt för översikten.
   * @param {object} settings { threshold, lookbackDays }
   * @param {(msg:string)=>void} progress
   */
  async function loadAll(settings, progress = () => {}) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const lookbackDays = settings.lookbackDays || 28;
    const meta = { warnings: [], rateSources: {} };

    progress('Hämtar budget och utfall…');
    const risk = (await api({ method: 'GET', path: '/projects/risk-scores' })) || [];
    meta.totalWithRisk = risk.length;
    const big = risk.filter((r) => (Number(r.TotalBudgetHours) || 0) >= settings.threshold);
    meta.bigCount = big.length;

    progress('Hämtar projektlista…');
    let list = [];
    try { list = await loadProjectList(); } catch (e) { meta.warnings.push('Projektlistan kunde inte hämtas: ' + e.message); }
    const listById = new Map(list.map((r) => [r.ProjectId, r]));

    const missing = big.filter((r) => !listById.has(r.ProjectId));
    let i = 0;
    const details = new Map();
    await pool(missing, 4, async (r) => {
      progress(`Hämtar projektdetaljer ${++i}/${missing.length}…`);
      const d = await api({ method: 'GET', path: `/projects/${r.ProjectId}` });
      details.set(r.ProjectId, d);
    });

    const projects = [];
    let inactive = 0;
    for (const r of big) {
      const l = listById.get(r.ProjectId);
      const d = details.get(r.ProjectId);
      const statusCode = l ? (l.ProjectStatusCode || '') : (d && d.ProjectStatus && d.ProjectStatus.Code) || '';
      const statusName = l ? l.StatusName : statusCode;
      if (INACTIVE_RE.test(statusCode) || INACTIVE_RE.test(statusName || '')) { inactive++; continue; }
      projects.push({
        id: r.ProjectId,
        number: r.ProjectNumber || (l && l.ProjectNumber) || (d && d.ProjectNumber),
        name: (l && l.ProjectName) || (d && d.ProjectNameWithoutNumber) || r.ProjectName,
        manager: (l && l.ProjectManager) || '',
        customer: (l && l.CustomerName) || (d && d.Customer && d.Customer.CustomerName) || '',
        statusName: statusName || '',
        statusCode,
        start: (l && l.StartDate) || (d && d.StartDate),
        end: (l && l.EndDate) || (d && d.EndDate),
        budget: Number(r.TotalBudgetHours) || 0,
        actual: Number(r.TotalActualHours) || 0,
        riskLevel: r.RiskLevel,
        earlyBurnPercent: r.EarlyBurnPercent,
        recentWeekly: null,
        rateSource: null,
      });
    }
    meta.inactiveSkipped = inactive;

    // --- Takt: 1) ögonblicksbilder, 2) tidrader per projekt, 3) Hantera tid ---
    progress('Uppdaterar historik…');
    const store = await chrome.storage.local.get('snaps');
    const snaps = store.snaps || {};
    const todayStr = ymd(today);
    const keepFrom = new Date(today.getTime() - 180 * 864e5);
    for (const p of projects) {
      const arr = (snaps[p.id] || []).filter((s) => s.date !== todayStr && new Date(s.date) >= keepFrom);
      arr.push({ date: todayStr, actual: p.actual });
      snaps[p.id] = arr;
      const rate = PPCalc.rateFromSnapshots(arr, today, lookbackDays);
      if (rate != null) { p.recentWeekly = rate; p.rateSource = 'historik'; }
    }
    await chrome.storage.local.set({ snaps });

    const needRate = projects.filter((p) => p.recentWeekly == null && p.actual > 0);
    let reportedWorks = needRate.length > 0;
    for (let k = 0; k < needRate.length && reportedWorks; k++) {
      const p = needRate[k];
      progress(`Hämtar tidrader ${k + 1}/${needRate.length}…`);
      try {
        const rows = await loadReportedTimes(p.id);
        if (rows.length === 0 && k === 0) { reportedWorks = false; break; } // saknar behörighet → hoppa över
        p.recentWeekly = PPCalc.rateFromTimeRows(rows, today, lookbackDays);
        p.rateSource = 'tidrader';
      } catch { if (k === 0) reportedWorks = false; }
    }

    progress('Hämtar veckoöversikt (Hantera tid)…');
    try {
      const tm = await loadTimeManage(today, lookbackDays);
      for (const p of projects) {
        if (p.recentWeekly == null) {
          const rows = tm.perProject.get(p.id);
          if (rows) { p.recentWeekly = PPCalc.rateFromTimeRows(rows, today, lookbackDays); p.rateSource = 'hantera tid'; }
        }
      }
      const weeks = lookbackDays / 7;
      meta.capacityEstimate = [...tm.perUser.values()].filter((h) => h / weeks >= 20).length;
      meta.timeManageUsers = tm.perUser.size;
    } catch (e) {
      meta.warnings.push('Hantera tid kunde inte läsas: ' + e.message);
    }

    for (const p of projects) meta.rateSources[p.rateSource || 'saknas'] = (meta.rateSources[p.rateSource || 'saknas'] || 0) + 1;
    meta.loadedAt = new Date();
    return { today, projects, meta };
  }

  root.PPData = { findTab, openPortal, loadAll, api };
})(self);
