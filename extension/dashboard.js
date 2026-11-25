(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf0 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const n0 = (x) => (x == null || !isFinite(x) ? '–' : nf0.format(x));
  const n1 = (x) => (x == null ? '–' : !isFinite(x) ? '∞' : nf1.format(x));
  const pct = (x) => (x == null || !isFinite(x) ? '–' : Math.round(x * 100) + ' %');
  const signed = (x) => { if (x == null || !isFinite(x)) return '–'; const v = Math.round(x); return (v > 0 ? '+' : v < 0 ? '−' : '') + nf0.format(Math.abs(v)); };
  const dLong = (d) => (d ? d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
  const dIso = (d) => (d ? d.toLocaleDateString('sv-SE') : '');

  const STATUS = {
    red:    { label: 'Kritisk',      cls: 's-red',    color: 'var(--red)' },
    orange: { label: 'Efter plan',   cls: 's-orange', color: 'var(--amber)' },
    green:  { label: 'I fas',        cls: 's-green',  color: 'var(--green)' },
    blue:   { label: 'Före plan',    cls: 's-blue',   color: 'var(--blue)' },
    grey:   { label: 'Saknar datum', cls: 's-grey',   color: 'var(--grey)' },
    frame:  { label: 'Ramavtal',     cls: 'frame',    color: 'var(--grey)' },
  };
  const st = (r) => (r.isFrame ? STATUS.frame : STATUS[r.status] || STATUS.grey);

  const DEFAULT_SETTINGS = { threshold: 40, hoursPerWeek: 40, lookbackDays: 28, capacity: null,
    orangeFactor: 1.15, redFactor: 1.5, showFrames: false };

  const state = {
    settings: { ...DEFAULT_SETTINGS }, frames: {}, data: null, results: [],
    filter: 'all', q: '', sort: 'risk', view: 'cards', openId: null,
  };

  // ---------------------------------------------------------------- Laddning
  function setLoading(msg) {
    if (msg == null) { $('#status').classList.add('hidden'); return; }
    $('#status').classList.remove('hidden');
    $('#statusText').textContent = msg;
  }
  function setError(msg) {
    const e = $('#error');
    if (!msg) { e.classList.add('hidden'); return; }
    e.textContent = msg; e.classList.remove('hidden');
  }

  async function loadPrefs() {
    const s = await chrome.storage.local.get(['settings', 'frames', 'ui']);
    state.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    state.frames = s.frames || {};
    if (s.ui) { state.sort = s.ui.sort || state.sort; state.view = s.ui.view || state.view; }
    $('#sort').value = state.sort;
    setView(state.view, false);
  }
  const saveUi = () => chrome.storage.local.set({ ui: { sort: state.sort, view: state.view } });

  async function connect() {
    const conn = $('#conn');
    const t = await PPData.findTab();
    if (!t || !t.loggedIn) {
      conn.textContent = t ? 'Inte inloggad i Projektportalen' : 'Projektportalen är inte öppen';
      conn.className = 'brand-sub bad';
      $('#connectBox').classList.remove('hidden');
      return false;
    }
    $('#connectBox').classList.add('hidden');
    conn.textContent = `Projektportalen · kund ${t.user?.clientNumber ?? '?'} · ${roleName(t.user?.roleCode)}`;
    conn.className = 'brand-sub ok';
    return true;
  }
  const roleName = (c) => ({ ADMINISTRATOR: 'administratör', PROJECTMANAGER: 'projektledare' }[c] || (c || '').toLowerCase());

  async function reload() {
    $('#btnReload').disabled = true;
    setError(null);
    try {
      if (!(await connect())) { setLoading(null); return; }
      if (!state.data) setLoading('Hämtar projekt…');
      PPData.clearHistoryCache();
      state.data = await PPData.loadAll(state.settings, (m) => setLoading(m));
      setLoading(null);
      $('#main').classList.remove('hidden');
      $('#btnCsv').disabled = false;
      $('#updated').textContent = 'Uppdaterad ' + state.data.meta.loadedAt.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
      render();
    } catch (e) {
      console.error(e);
      setLoading(null);
      setError('Kunde inte hämta data: ' + e.message);
    } finally {
      $('#btnReload').disabled = false;
    }
  }

  // ---------------------------------------------------------------- Beräkning
  function compute() {
    const s = state.settings;
    const opts = { hoursPerWeek: s.hoursPerWeek, orangeFactor: s.orangeFactor, redFactor: s.redFactor };
    state.results = state.data.projects
      .filter((p) => p.budget >= s.threshold)
      .map((p) => ({ ...PPCalc.computeProject(p, state.data.today, opts), isFrame: !!state.frames[p.id] }));
    for (const r of state.results) r.headline = PPCalc.headline(r, s.hoursPerWeek);
  }
  const counted = () => state.results.filter((r) => !r.isFrame);

  function capacity() {
    if (state.settings.capacity != null) return { v: state.settings.capacity, auto: false };
    return { v: state.data.meta.capacityEstimate || 0, auto: true };
  }

  // ---------------------------------------------------------------- Rendering
  function render() {
    if (!state.data) return;
    compute();
    renderKpis();
    renderStatusbar();
    renderChips();
    renderProjects();
    renderMonths();
    renderFoot();
  }

  function renderKpis() {
    const c = counted();
    const by = (...ss) => c.filter((r) => ss.includes(r.status)).length;
    const budget = c.reduce((a, r) => a + r.budget, 0);
    const actual = c.reduce((a, r) => a + Math.min(r.actual, r.budget), 0);
    const remaining = c.reduce((a, r) => a + r.remaining, 0);
    const m3 = PPCalc.monthlyDemand(c, state.data.today, 3, { hoursPerWeek: state.settings.hoursPerWeek });
    const need = Math.max(0, ...m3.map((m) => m.neededPersons));
    const cap = capacity();
    const capPct = cap.v > 0 ? Math.min(1, need / Math.max(need, cap.v)) : 0;
    const capOver = cap.v > 0 && need > cap.v;
    const tile = (cls, label, value, sub, filter, extra = '') =>
      `<div class="kpi ${cls}${filter ? ' clickable' : ''}" ${filter ? `data-filter="${filter}"` : ''}>
        <div class="k-label">${label}</div><div class="k-value">${value}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}${extra}</div>`;
    $('#kpis').innerHTML = [
      tile('', 'Aktiva projekt', c.length, `med budget ≥ ${n0(state.settings.threshold)} h`, 'all'),
      tile('green', 'I fas', by('green', 'blue'), by('blue') ? `varav ${by('blue')} före plan` : 'följer jämn bemanning', 'ok'),
      tile('amber', 'Efter plan', by('orange'), 'behöver mer folk', 'orange'),
      tile('red', 'Kritiska', by('red'), 'kraftig uppmanning krävs', 'red'),
      tile('', 'Timmar kvar', `${n0(remaining)} <small>h</small>`, `${pct(budget ? actual / budget : null)} av ${n0(budget)} h förbrukat`, null,
        `<div class="k-meter"><span style="width:${budget ? (actual / budget) * 100 : 0}%;background:var(--accent)"></span></div>`),
      tile(capOver ? 'red' : '', 'Bemanning 3 mån', `${n1(need)} <small>/ ${cap.v ? n1(cap.v) : '?'} pers</small>`,
        cap.auto ? 'behov / kapacitet (uppskattad)' : 'behov / kapacitet', null,
        `<div class="k-meter"><span style="width:${capPct * 100}%;background:${capOver ? 'var(--red)' : 'var(--green)'}"></span></div>`),
    ].join('');
  }

  function renderStatusbar() {
    const c = counted();
    const segs = ['red', 'orange', 'green', 'blue', 'grey'].map((s) => [s, c.filter((r) => r.status === s).length]).filter(([, n]) => n);
    $('#statusbar').innerHTML = segs.map(([s, n]) => `<span style="flex-grow:${n};background:${STATUS[s].color}" title="${STATUS[s].label}: ${n}"></span>`).join('');
  }

  const FILTERS = [
    ['all', 'Alla', null],
    ['red', 'Kritiska', 'var(--red)'],
    ['orange', 'Efter plan', 'var(--amber)'],
    ['ok', 'I fas', 'var(--green)'],
    ['blue', 'Före plan', 'var(--blue)'],
    ['grey', 'Saknar datum', 'var(--grey)'],
    ['frame', 'Ramavtal', 'var(--grey)'],
  ];
  function matchFilter(r, f) {
    if (f === 'frame') return r.isFrame;
    if (r.isFrame) return f === 'all' && state.settings.showFrames;
    if (f === 'all') return true;
    if (f === 'ok') return r.status === 'green' || r.status === 'blue';
    return r.status === f;
  }
  function renderChips() {
    $('#chips').innerHTML = FILTERS.map(([k, label, color]) => {
      const n = state.results.filter((r) => matchFilter(r, k)).length;
      if (!n && !['all', 'red', 'orange', 'ok'].includes(k) && state.filter !== k) return '';
      return `<button class="chip${state.filter === k ? ' on' : ''}" data-filter="${k}">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${label} <span class="n">${n}</span></button>`;
    }).join('');
  }

  const SORTS = {
    risk: (a, b) => rank(a) - rank(b) || (b.factor ?? -1) - (a.factor ?? -1) || b.remaining - a.remaining,
    end: (a, b) => (a.end ? a.end.getTime() : Infinity) - (b.end ? b.end.getTime() : Infinity),
    remaining: (a, b) => b.remaining - a.remaining,
    budget: (a, b) => b.budget - a.budget,
    deviation: (a, b) => (a.deviation ?? 0) - (b.deviation ?? 0),
    progress: (a, b) => (b.budgetUsedFrac ?? 0) - (a.budgetUsedFrac ?? 0),
    number: (a, b) => String(a.number).localeCompare(String(b.number), 'sv', { numeric: true }),
    name: (a, b) => String(a.name).localeCompare(String(b.name), 'sv'),
    manager: (a, b) => String(a.manager || 'ö').localeCompare(String(b.manager || 'ö'), 'sv') || rank(a) - rank(b),
  };
  function rank(r) { return r.isFrame ? 9 : { red: 0, orange: 1, blue: 2, green: 3, grey: 4 }[r.status] ?? 5; }

  function visible() {
    const q = state.q.trim().toLowerCase();
    return state.results
      .filter((r) => matchFilter(r, state.filter))
      .filter((r) => !q || [r.number, r.name, r.manager, r.customer].join(' ').toLowerCase().includes(q))
      .sort(SORTS[state.sort] || SORTS.risk);
  }

  function meterHtml(r) {
    const used = r.budget > 0 ? r.actual / r.budget : 0;
    const over = used > 1;
    const fillW = over ? (1 / used) * 100 : used * 100;
    const markPos = r.elapsedFrac != null ? (over ? r.elapsedFrac / used : r.elapsedFrac) * 100 : null;
    return `<div class="meter">
      <div class="fill" style="width:${fillW.toFixed(1)}%"></div>
      ${over ? `<div class="over" style="width:${(100 - fillW).toFixed(1)}%"></div>` : ''}
      ${markPos != null ? `<div class="mark" style="left:${markPos.toFixed(1)}%" title="Enligt jämn plan borde ${n0(r.expected)} h vara förbrukat idag"></div>` : ''}
    </div>`;
  }

  function timeLeft(r) {
    if (r.weeksLeft == null) return '';
    const days = Math.round(r.weeksLeft * 7);
    if (days > 13) return `${n0(Math.round(r.weeksLeft))} v kvar`;
    if (days > 0) return `${days} d kvar`;
    if (days === 0) return 'slutar idag';
    return -days > 13 ? `${n0(Math.round(-r.weeksLeft))} v sen` : `${-days} d sen`;
  }

  function staffHtml(r) {
    const cls = r.status === 'red' ? 'bad' : r.status === 'orange' ? 'warn' : 'good';
    if (r.status === 'grey') return '–';
    if (!isFinite(r.neededPersons)) return `<span class="${cls}">slut passerat</span>`;
    return `${n1(r.plannedPersons)} → <span class="${cls}">${n1(r.neededPersons)}</span>`;
  }

  function cardHtml(r) {
    const s = st(r);
    const weeksLeft = timeLeft(r);
    const devCls = r.deviation == null ? '' : r.status === 'red' ? 'bad' : r.status === 'orange' ? 'warn' : '';
    return `<article class="card ${s.cls}${r.isFrame ? ' frame' : ''}" tabindex="0" data-id="${r.id}">
      <div class="c-top">
        <div style="min-width:0">
          <div class="c-num">${esc(r.number)}</div>
          <div class="c-title" title="${esc(r.name)}">${esc(r.name)}</div>
          <div class="c-sub">${esc([r.manager, r.customer].filter(Boolean).join(' · ') || ' ')}</div>
        </div>
        <span class="pill">${s.label}</span>
      </div>
      <div>
        <div class="meter-label"><span>Timmar</span><span><b>${n0(r.actual)}</b> / ${n0(r.budget)} h</span></div>
        ${meterHtml(r)}
        <div class="meter-legend"><span>${pct(r.budgetUsedFrac)} förbrukat</span>${r.expected != null ? `<span>▼ plan idag ${n0(r.expected)} h</span>` : ''}</div>
      </div>
      <div>
        <div class="time"><div class="fill" style="width:${((r.elapsedFrac ?? 0) * 100).toFixed(1)}%"></div></div>
        <div class="time-label"><span>${r.start ? dLong(r.start) : '–'}</span><span><b>${weeksLeft}</b>${weeksLeft ? ' · ' : ''}slut ${dLong(r.end)}</span></div>
      </div>
      <div class="c-stats">
        <div class="c-stat"><div class="l">Kvar</div><div class="v">${n0(r.remaining)} <small>h</small></div></div>
        <div class="c-stat"><div class="l">Bemanning</div><div class="v">${staffHtml(r)}${isFinite(r.neededPersons) && r.status !== 'grey' ? ' <small>pers</small>' : ''}</div></div>
        <div class="c-stat"><div class="l">Mot plan</div><div class="v ${devCls}">${signed(r.deviation)} <small>h</small></div></div>
      </div>
      <div class="c-msg">${esc(r.isFrame ? 'Markerad som ramavtal – räknas inte i behovet' : r.headline)}</div>
    </article>`;
  }

  function rowHtml(r) {
    const s = st(r);
    const fCls = r.status === 'red' ? 'bad' : r.status === 'orange' ? 'warn' : '';
    return `<tr class="${s.cls}" data-id="${r.id}">
      <td><span class="sdot" title="${s.label}"></span></td>
      <td>${esc(r.number)}</td>
      <td class="name" title="${esc(r.name)}">${esc(r.name)}</td>
      <td>${esc(r.manager)}</td>
      <td>${dIso(r.end)}</td>
      <td><span class="mini">${meterHtml(r)}</span></td>
      <td class="num">${n0(r.actual)} / ${n0(r.budget)}</td>
      <td class="num">${pct(r.elapsedFrac)}</td>
      <td class="num">${n0(r.remaining)}</td>
      <td class="num">${staffHtml(r)}</td>
      <td class="num v ${fCls}">${r.factor == null ? '–' : !isFinite(r.factor) ? 'sen' : n1(r.factor) + '×'}</td>
    </tr>`;
  }

  function renderProjects() {
    const rows = visible();
    $('#empty').classList.toggle('hidden', rows.length > 0);
    if (state.view === 'cards') {
      $('#grid').innerHTML = rows.map(cardHtml).join('');
    } else {
      $('#tbl').innerHTML = `<thead><tr><th></th><th>Nr</th><th>Projekt</th><th>PL</th><th>Slut</th><th>Timmar mot plan</th>
        <th class="num">Utfört / budget</th><th class="num">Tid gått</th><th class="num">Kvar h</th><th class="num">Pers plan → behövs</th><th class="num">Faktor</th></tr></thead>
        <tbody>${rows.map(rowHtml).join('')}</tbody>`;
    }
  }

  function renderMonths() {
    const c = counted();
    const months = PPCalc.monthlyDemand(c, state.data.today, 12, { hoursPerWeek: state.settings.hoursPerWeek });
    const byId = new Map(c.map((r) => [r.id, r]));
    for (const m of months) m.topProjects = m.byProject.map((p) => ({ label: `${byId.get(p.id)?.number ?? ''} ${byId.get(p.id)?.name ?? ''}`.slice(0, 40), persons: p.persons }));
    PPCharts.monthChart($('#monthChart'), months, capacity().v);
  }

  function renderFoot() {
    const m = state.data.meta;
    const src = Object.entries(m.rateSources).map(([k, v]) => `${k} ${v}`).join(', ');
    $('#foot').innerHTML = [
      `Hämtat ${m.loadedAt.toLocaleString('sv-SE')} · ${m.totalWithRisk} projekt med budgetdata, ${m.bigCount} över ${n0(state.settings.threshold)} h, ${m.inactiveSkipped} avslutade/utförda borttagna.`,
      `Nuvarande takt – källa: ${esc(src || '–')}. Tillägget sparar historik lokalt vid varje uppdatering; takten blir säkrare efter en vecka.`,
      'Jämn plan = budget fördelad lika över projektets hela period. Tillägget läser endast data från Projektportalen och ändrar ingenting.',
      ...m.warnings.map((w) => '⚠ ' + esc(w)),
    ].join('<br>');
  }

  // ---------------------------------------------------------------- Detaljvy
  async function openDetail(id) {
    const r = state.results.find((x) => x.id === id);
    if (!r) return;
    state.openId = id;
    const s = st(r);
    const card = $('#modal .modal-card');
    card.className = 'modal-card ' + s.cls;
    $('#mKicker').innerHTML = `<span>${esc(r.number)}</span><span class="pill">${s.label}</span>`;
    $('#mTitle').textContent = r.name;
    $('#mSub').textContent = [r.manager && 'PL ' + r.manager, r.customer, r.statusName].filter(Boolean).join(' · ');
    $('#mLink').href = `https://new-app.projektportalen.se/project/${r.id}/overview`;
    $('#mHeadline').textContent = r.isFrame ? 'Markerad som ramavtal – räknas inte i bemanningsbehovet.' : r.headline;
    $('#mFacts').innerHTML = factsHtml(r);
    $('#mChart').innerHTML = '<div class="loading"><span class="spinner"></span>Hämtar tidrader…</div>';
    $('#mWeekly').innerHTML = '';
    $('#mSource').textContent = '';
    $('#modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    let hist = { source: null };
    try { hist = await PPData.loadHistory(r.id); } catch (e) { console.warn(e); }
    if (state.openId !== id) return;
    PPCharts.progressChart($('#mChart'), r, hist, state.data.today);
    PPCharts.weeklyChart($('#mWeekly'), r, hist, state.data.today, state.settings.hoursPerWeek);
    $('#mSource').textContent = hist.source === 'tidrader'
      ? `Kurvan bygger på ${n0(hist.rows.length)} tidrader från Projektportalen.`
      : hist.source === 'historik'
        ? 'Kurvan bygger på tilläggets sparade ögonblicksbilder (tidrader saknas för din behörighet). Streckad del är uppskattad.'
        : 'Ingen historik ännu – streckad linje visar bara rak väg från start till dagens utfall.';
  }

  function factsHtml(r) {
    const s = state.settings;
    const f = (l, v, cls = '') => `<div class="fact"><span>${l}</span><span class="${cls}">${v}</span></div>`;
    const sCls = r.status === 'red' ? 'bad' : r.status === 'orange' ? 'warn' : 'good';
    return `
      <h4>Timmar</h4>
      ${f('Budget', n0(r.budget) + ' h')}
      ${f('Utfört', n0(r.actual) + ' h · ' + pct(r.budgetUsedFrac))}
      ${f('Kvar', n0(r.remaining) + ' h')}
      ${f('Enligt jämn plan idag', n0(r.expected) + ' h')}
      ${f('Mot plan', signed(r.deviation) + ' h', r.deviation < 0 ? sCls : 'good')}
      <h4>Tid</h4>
      ${f('Start', dLong(r.start))}
      ${f('Slut', dLong(r.end))}
      ${f('Tid gått', pct(r.elapsedFrac))}
      ${f('Kvar', timeLeft(r) || '–', r.weeksLeft <= 0 ? 'bad' : '')}
      <h4>Bemanning (${n0(s.hoursPerWeek)} h/pers/v)</h4>
      ${f('Jämn plan', `${n0(r.plannedRate)} h/v · ${n1(r.plannedPersons)} pers`)}
      ${f('Nuvarande takt', r.recentWeekly == null ? 'okänd' : `${n0(r.recentWeekly)} h/v · ${n1(r.recentPersons)} pers`)}
      ${f('Behövs resten', isFinite(r.neededRate) ? `${n0(r.neededRate)} h/v · ${n1(r.neededPersons)} pers` : 'ej möjligt i tid', sCls)}
      ${f('Faktor mot plan', r.factor == null ? '–' : !isFinite(r.factor) ? 'slutdatum passerat' : n1(r.factor) + '×', sCls)}
      ${f('Prognos klar', r.forecastEnd ? dLong(r.forecastEnd) : '–', r.forecastEnd && r.end && r.forecastEnd > r.end ? 'warn' : '')}
      ${r.riskLevel ? f('Riskindikator PP', esc(r.riskLevel)) : ''}
      ${r.flags.length ? '<h4>Noteringar</h4><ul>' + r.flags.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' : ''}
      <label class="frame-toggle"><input type="checkbox" id="mFrame" ${r.isFrame ? 'checked' : ''}> Ramavtal – räkna inte in i behovet</label>`;
  }

  function closeModals() {
    document.querySelectorAll('.modal').forEach((m) => m.classList.add('hidden'));
    document.body.style.overflow = '';
    state.openId = null;
    PPCharts.hideTip();
  }

  // ---------------------------------------------------------------- Inställningar
  function openSettings() {
    const s = state.settings;
    $('#setThreshold').value = s.threshold;
    $('#setHours').value = s.hoursPerWeek;
    $('#setLookback').value = s.lookbackDays;
    $('#setCapacity').value = s.capacity ?? '';
    $('#setOrange').value = s.orangeFactor;
    $('#setRed').value = s.redFactor;
    $('#setShowFrames').checked = !!s.showFrames;
    $('#settings').classList.remove('hidden');
  }
  async function saveSettings() {
    const num = (id, def) => { const v = parseFloat($(id).value); return isFinite(v) ? v : def; };
    const prev = state.settings;
    state.settings = {
      threshold: Math.max(0, num('#setThreshold', 40)),
      hoursPerWeek: Math.max(1, num('#setHours', 40)),
      lookbackDays: Math.max(7, Math.round(num('#setLookback', 28) / 7) * 7),
      capacity: $('#setCapacity').value === '' ? null : Math.max(0, num('#setCapacity', 0)),
      orangeFactor: Math.max(1, num('#setOrange', 1.15)),
      redFactor: Math.max(1, num('#setRed', 1.5)),
      showFrames: $('#setShowFrames').checked,
    };
    await chrome.storage.local.set({ settings: state.settings });
    closeModals();
    if (state.settings.threshold < prev.threshold || state.settings.lookbackDays !== prev.lookbackDays) await reload();
    else render();
  }

  // ---------------------------------------------------------------- Export
  function exportCsv() {
    const cols = [
      ['Status', (r) => st(r).label], ['Nr', (r) => r.number], ['Projekt', (r) => r.name], ['Projektledare', (r) => r.manager],
      ['Kund', (r) => r.customer], ['Start', (r) => dIso(r.start)], ['Slut', (r) => dIso(r.end)],
      ['Budget h', (r) => r.budget], ['Utfört h', (r) => r.actual], ['Kvar h', (r) => r.remaining],
      ['Plan idag h', (r) => r.expected], ['Mot plan h', (r) => r.deviation],
      ['Tid gått %', (r) => (r.elapsedFrac == null ? '' : Math.round(r.elapsedFrac * 100))],
      ['Pers jämn plan', (r) => r.plannedPersons], ['Pers nu', (r) => r.recentPersons], ['Pers behövs', (r) => r.neededPersons],
      ['Faktor', (r) => r.factor], ['Prognos klar', (r) => dIso(r.forecastEnd)], ['Läge', (r) => r.headline],
    ];
    const cell = (v) => {
      if (typeof v === 'number') v = isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '';
      v = String(v ?? '');
      return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const lines = [cols.map((c) => c[0]).join(';'), ...visible().map((r) => cols.map((c) => cell(c[1](r))).join(';'))];
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `projektlage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------- Vyval
  function setView(v, rerender = true) {
    state.view = v;
    $('#viewCards').classList.toggle('on', v === 'cards');
    $('#viewList').classList.toggle('on', v === 'list');
    $('#grid').classList.toggle('hidden', v !== 'cards');
    $('#list').classList.toggle('hidden', v !== 'list');
    if (rerender) { saveUi(); if (state.data) renderProjects(); }
  }

  // ---------------------------------------------------------------- Händelser
  $('#btnReload').addEventListener('click', reload);
  $('#btnOpenPortal').addEventListener('click', () => PPData.openPortal());
  $('#btnCsv').addEventListener('click', exportCsv);
  $('#btnSettings').addEventListener('click', openSettings);
  $('#btnSaveSettings').addEventListener('click', saveSettings);
  $('#q').addEventListener('input', (e) => { state.q = e.target.value; renderProjects(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; saveUi(); renderProjects(); });
  $('#viewCards').addEventListener('click', () => setView('cards'));
  $('#viewList').addEventListener('click', () => setView('list'));

  const setFilter = (f) => { state.filter = f; renderChips(); renderProjects(); };
  $('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) setFilter(b.dataset.filter); });
  $('#kpis').addEventListener('click', (e) => { const k = e.target.closest('[data-filter]'); if (k) setFilter(k.dataset.filter); });

  const openFrom = (e) => { const c = e.target.closest('[data-id]'); if (c) openDetail(Number(c.dataset.id)); };
  $('#grid').addEventListener('click', openFrom);
  $('#grid').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFrom(e); } });
  $('#list').addEventListener('click', openFrom);

  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModals(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });
  $('#mFacts').addEventListener('change', async (e) => {
    if (e.target.id !== 'mFrame' || state.openId == null) return;
    if (e.target.checked) state.frames[state.openId] = true; else delete state.frames[state.openId];
    await chrome.storage.local.set({ frames: state.frames });
    const id = state.openId;
    render();
    openDetail(id);
  });

  (async () => {
    await loadPrefs();
    await reload();
  })();
})();
