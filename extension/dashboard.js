(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct = (x) => (x == null || !isFinite(x) ? '–' : Math.round(x * 100) + ' %');
  const n0 = (x) => (x == null || !isFinite(x) ? '–' : nf0.format(x));
  const n1 = (x) => (x == null ? '–' : !isFinite(x) ? '∞' : nf1.format(x));
  const dstr = (d) => (d ? d.toLocaleDateString('sv-SE') : '–');

  const DEFAULT_SETTINGS = { threshold: 40, hoursPerWeek: 40, lookbackDays: 28, capacity: null,
    orangeFactor: 1.15, redFactor: 1.5, showFrames: false };

  let settings = { ...DEFAULT_SETTINGS };
  let frames = {};          // projectId -> true (ramavtal, räknas inte)
  let data = null;          // { today, projects, meta }
  let results = [];
  let sortKey = null, sortDir = 1;
  let openId = null;

  function setStatus(msg, err = false) {
    const s = $('#status');
    s.textContent = msg || '';
    s.className = 'status' + (err ? ' err' : '');
  }

  async function loadSettings() {
    const st = await chrome.storage.local.get(['settings', 'frames']);
    settings = { ...DEFAULT_SETTINGS, ...(st.settings || {}) };
    frames = st.frames || {};
  }

  function fillSettingsForm() {
    $('#setThreshold').value = settings.threshold;
    $('#setHours').value = settings.hoursPerWeek;
    $('#setLookback').value = settings.lookbackDays;
    $('#setCapacity').value = settings.capacity ?? '';
    $('#setOrange').value = settings.orangeFactor;
    $('#setRed').value = settings.redFactor;
    $('#setShowFrames').checked = !!settings.showFrames;
  }

  async function saveSettings() {
    const num = (id, def) => { const v = parseFloat($(id).value); return isFinite(v) ? v : def; };
    const prevThreshold = settings.threshold, prevLookback = settings.lookbackDays;
    settings = {
      threshold: num('#setThreshold', 40),
      hoursPerWeek: num('#setHours', 40),
      lookbackDays: Math.max(7, Math.round(num('#setLookback', 28) / 7) * 7),
      capacity: $('#setCapacity').value === '' ? null : num('#setCapacity', null),
      orangeFactor: num('#setOrange', 1.15),
      redFactor: num('#setRed', 1.5),
      showFrames: $('#setShowFrames').checked,
    };
    await chrome.storage.local.set({ settings });
    $('#settingsBox').classList.add('hidden');
    if (settings.threshold < prevThreshold || settings.lookbackDays !== prevLookback) await reload();
    else render();
  }

  async function connect() {
    const conn = $('#conn');
    const t = await PPData.findTab();
    if (!t || !t.loggedIn) {
      conn.textContent = t ? 'Ej inloggad i Projektportalen' : 'Projektportalen ej öppen';
      conn.className = 'conn bad';
      $('#connectBox').classList.remove('hidden');
      return false;
    }
    $('#connectBox').classList.add('hidden');
    conn.textContent = `Ansluten · kund ${t.user?.clientNumber ?? '?'} · roll ${t.user?.roleCode ?? '?'}`;
    conn.className = 'conn ok';
    return true;
  }

  async function reload() {
    $('#btnReload').disabled = true;
    try {
      if (!(await connect())) { setStatus(''); return; }
      setStatus('Hämtar…');
      data = await PPData.loadAll(settings, (m) => setStatus(m));
      setStatus('');
      $('#main').classList.remove('hidden');
      $('#btnCsv').disabled = false;
      render();
    } catch (e) {
      console.error(e);
      setStatus('Fel vid hämtning: ' + e.message, true);
    } finally {
      $('#btnReload').disabled = false;
    }
  }

  function compute() {
    const opts = { hoursPerWeek: settings.hoursPerWeek, orangeFactor: settings.orangeFactor, redFactor: settings.redFactor };
    results = data.projects
      .filter((p) => p.budget >= settings.threshold)
      .map((p) => ({ ...PPCalc.computeProject(p, data.today, opts), isFrame: !!frames[p.id] }));
  }

  function capacityValue() {
    if (settings.capacity != null) return { v: settings.capacity, auto: false };
    const est = data.meta.capacityEstimate;
    return { v: est || 0, auto: true };
  }

  function render() {
    if (!data) return;
    compute();
    const counted = results.filter((r) => !r.isFrame);
    const shown = settings.showFrames ? results : counted;
    renderCards(counted);
    const months = PPCalc.monthlyDemand(counted, data.today, 12, { hoursPerWeek: settings.hoursPerWeek });
    PPCharts.monthChart($('#monthChart'), months, capacityValue().v);
    renderTable(shown);
    renderFoot();
  }

  function renderCards(counted) {
    const by = (s) => counted.filter((r) => r.status === s).length;
    const remaining = counted.reduce((a, r) => a + r.remaining, 0);
    const months = PPCalc.monthlyDemand(counted, data.today, 3, { hoursPerWeek: settings.hoursPerWeek });
    const need3 = Math.max(...months.map((m) => m.neededPersons), 0);
    const cap = capacityValue();
    const gap = cap.v > 0 ? need3 - cap.v : null;
    const cards = [
      ['', counted.length, 'Stora projekt (≥ ' + settings.threshold + ' h)'],
      ['red', by('red'), 'Kräver kraftig uppmanning'],
      ['orange', by('orange'), 'Ligger efter plan'],
      ['green', by('green') + by('blue'), 'I fas / före plan'],
      ['', n0(remaining) + ' h', 'Timmar kvar totalt'],
      [gap != null && gap > 0 ? 'red' : '', n1(need3) + ' pers', 'Max behov kommande 3 mån'],
      ['', (cap.v ? n1(cap.v) : '–') + ' pers', cap.auto ? 'Kapacitet (uppskattad – ändra i inställningar)' : 'Kapacitet (inställd)'],
    ];
    $('#cards').innerHTML = cards.map(([c, v, l]) => `<div class="card ${c}"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></div>`).join('');
  }

  function sortVal(r, k) {
    const v = r[k];
    if (k === 'status') return { red: 0, orange: 1, blue: 2, green: 3, grey: 4 }[v];
    if (v instanceof Date) return v.getTime();
    if (v == null) return -Infinity;
    return v;
  }

  function renderTable(list) {
    const q = $('#filter').value.trim().toLowerCase();
    let rows = q ? list.filter((r) => [r.number, r.name, r.manager, r.customer].join(' ').toLowerCase().includes(q)) : list;
    rows = sortKey
      ? rows.slice().sort((a, b) => { const x = sortVal(a, sortKey), y = sortVal(b, sortKey); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; })
      : PPCalc.sortResults(rows);

    document.querySelectorAll('#tbl th').forEach((th) => {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.k && th.dataset.k === sortKey) th.classList.add(sortDir > 0 ? 'sorted-asc' : 'sorted-desc');
    });

    const tb = $('#tbl tbody');
    tb.innerHTML = rows.map((r) => {
      const fc = r.factor != null && r.factor > settings.redFactor ? 'red' : r.factor != null && r.factor > settings.orangeFactor ? 'orange' : '';
      const fcLate = r.forecastEnd && r.end && r.forecastEnd > r.end ? ' style="color:var(--orange)"' : '';
      const main = `<tr class="main${r.isFrame ? ' frame' : ''}" data-id="${r.id}" title="${esc(r.flags.join(' · '))}">
        <td><span class="dot ${r.isFrame ? 'grey' : r.status}"></span></td>
        <td>${esc(r.number)}</td>
        <td class="name">${esc(r.name)}</td>
        <td>${esc(r.manager)}</td>
        <td>${dstr(r.end)}</td>
        <td class="num">${n0(r.budget)}</td>
        <td class="num">${n0(r.actual)}</td>
        <td class="num">${n0(r.remaining)}</td>
        <td class="num">${pct(r.elapsedFrac)}</td>
        <td class="num">${pct(r.budgetUsedFrac)}</td>
        <td class="num">${n1(r.plannedPersons)}</td>
        <td class="num" title="Källa: ${esc(r.rateSource || 'saknas')}">${n1(r.recentPersons)}</td>
        <td class="num">${n1(r.neededPersons)}</td>
        <td class="num factor ${fc}">${r.factor == null ? '–' : !isFinite(r.factor) ? '∞' : nf1.format(r.factor)}</td>
        <td${fcLate}>${dstr(r.forecastEnd)}</td>
        <td><input type="checkbox" class="frame-cb" data-id="${r.id}" ${r.isFrame ? 'checked' : ''} title="Ramavtal – räknas inte i behov"></td>
      </tr>`;
      const det = r.id === openId ? `<tr class="detail"><td colspan="16"><div class="detail-grid"><div class="curve" data-id="${r.id}"></div>${detailInfo(r)}</div></td></tr>` : '';
      return main + det;
    }).join('') || `<tr><td colspan="16" class="hint">Inga projekt matchar.</td></tr>`;

    if (openId != null) {
      const c = tb.querySelector('.curve');
      const r = rows.find((x) => x.id === openId);
      if (c && r) PPCharts.projectCurve(c, r, data.today);
    }
  }

  function detailInfo(r) {
    const dev = r.deviation == null ? '–' : (r.deviation >= 0 ? '+' : '') + n0(r.deviation) + ' h';
    return `<div>
      <dl>
        <dt>Kund</dt><dd>${esc(r.customer || '–')}</dd>
        <dt>Status</dt><dd>${esc(r.statusName || r.statusCode || '–')}</dd>
        <dt>Period</dt><dd>${dstr(r.start)} – ${dstr(r.end)} (${n1(r.weeksLeft)} v kvar)</dd>
        <dt>Planerad takt</dt><dd>${n0(r.plannedRate)} h/v (${n1(r.plannedPersons)} pers)</dd>
        <dt>Behövd takt</dt><dd>${isFinite(r.neededRate) ? n0(r.neededRate) : '∞'} h/v (${n1(r.neededPersons)} pers)</dd>
        <dt>Nuvarande takt</dt><dd>${r.recentWeekly == null ? 'okänd' : n0(r.recentWeekly) + ' h/v'} <span class="hint">(${esc(r.rateSource || 'ingen källa')})</span></dd>
        <dt>Mot plan</dt><dd>${dev} (förväntat ${n0(r.expected)} h)</dd>
        <dt>Riskindikator PP</dt><dd>${esc(r.riskLevel || '–')}</dd>
      </dl>
      ${r.flags.length ? '<ul>' + r.flags.map((f) => `<li>${esc(f)}</li>`).join('') + '</ul>' : ''}
    </div>`;
  }

  function renderFoot() {
    const m = data.meta;
    const src = Object.entries(m.rateSources).map(([k, v]) => `${k}: ${v}`).join(', ');
    $('#foot').innerHTML = [
      `Hämtat ${m.loadedAt.toLocaleString('sv-SE')}`,
      `${m.totalWithRisk} projekt med budgetdata, ${m.bigCount} över tröskel, ${m.inactiveSkipped} avslutade/utförda borttagna`,
      `Källa för nuvarande takt – ${esc(src)}`,
      'Historik sparas lokalt vid varje uppdatering; takten blir säkrare efter en vecka.',
      ...m.warnings.map((w) => '⚠ ' + esc(w)),
    ].join('<br>');
  }

  function exportCsv() {
    const cols = [
      ['Status', (r) => r.isFrame ? 'ram' : r.status], ['Nr', (r) => r.number], ['Projekt', (r) => r.name], ['PL', (r) => r.manager],
      ['Kund', (r) => r.customer], ['Start', (r) => dstr(r.start)], ['Slut', (r) => dstr(r.end)],
      ['Budget h', (r) => r.budget], ['Utfört h', (r) => r.actual], ['Kvar h', (r) => r.remaining],
      ['Tid gått %', (r) => r.elapsedFrac == null ? '' : Math.round(r.elapsedFrac * 100)],
      ['Plan pers', (r) => r.plannedPersons], ['Nu pers', (r) => r.recentPersons], ['Behövs pers', (r) => r.neededPersons],
      ['Faktor', (r) => r.factor], ['Prognos klar', (r) => dstr(r.forecastEnd)], ['Flaggor', (r) => r.flags.join('; ')],
    ];
    const cell = (v) => {
      if (typeof v === 'number') v = isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '';
      v = String(v ?? '');
      return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [cols.map((c) => c[0]).join(';'), ...PPCalc.sortResults(results).map((r) => cols.map((c) => cell(c[1](r))).join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pp-planering-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // --- Händelser ---
  $('#btnReload').addEventListener('click', reload);
  $('#btnOpenPortal').addEventListener('click', () => PPData.openPortal());
  $('#btnCsv').addEventListener('click', exportCsv);
  $('#btnSettings').addEventListener('click', () => { fillSettingsForm(); $('#settingsBox').classList.toggle('hidden'); });
  $('#btnCloseSettings').addEventListener('click', () => $('#settingsBox').classList.add('hidden'));
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#filter').addEventListener('input', () => data && renderTable(settings.showFrames ? results : results.filter((r) => !r.isFrame)));

  document.querySelectorAll('#tbl th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
    render();
  }));

  $('#tbl tbody').addEventListener('click', async (e) => {
    const cb = e.target.closest('.frame-cb');
    if (cb) {
      e.stopPropagation();
      const id = Number(cb.dataset.id);
      if (cb.checked) frames[id] = true; else delete frames[id];
      await chrome.storage.local.set({ frames });
      render();
      return;
    }
    const tr = e.target.closest('tr.main');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    openId = openId === id ? null : id;
    render();
  });

  (async () => {
    await loadSettings();
    await reload();
  })();
})();
