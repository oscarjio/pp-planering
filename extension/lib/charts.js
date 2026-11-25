// SVG-diagram utan externa bibliotek (MV3 tillåter inte CDN-skript).
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const WEEK = 7 * 864e5;
  const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function el(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    return steps.find((s) => n <= s + 1e-9) * p;
  }

  const fmt0 = (x) => Math.round(x).toLocaleString('sv-SE');
  const fmt1 = (x) => (Math.round(x * 10) / 10).toLocaleString('sv-SE');
  const dShort = (d) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
  const dMonth = (d) => d.toLocaleDateString('sv-SE', { month: 'short', year: '2-digit' }).replace('.', '');
  const dFull = (d) => d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });

  // ---------- Tooltip ----------
  const tip = () => document.getElementById('tooltip');
  function showTip(evt, html) {
    const t = tip(); if (!t) return;
    t.innerHTML = html; t.classList.remove('hidden');
    const pad = 14, w = t.offsetWidth, h = t.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { const t = tip(); if (t) t.classList.add('hidden'); }

  /** Månadsticks mellan två datum (max ~10 etiketter). */
  function monthTicks(a, b) {
    const out = [];
    let d = new Date(a.getFullYear(), a.getMonth() + (a.getDate() > 1 ? 1 : 0), 1);
    while (d <= b) { out.push(new Date(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
    const step = Math.max(1, Math.ceil(out.length / 10));
    return out.filter((_, i) => i % step === 0);
  }

  // ======================================================================
  // Bemanning per månad (översikt)
  // ======================================================================
  function monthChart(container, months, capacity) {
    container.innerHTML = '';
    const W = 1100, H = 250, L = 44, R = 14, T = 20, B = 30;
    const maxV = niceMax(Math.max(capacity || 0, ...months.map((m) => Math.max(m.neededPersons, m.plannedPersons)), 0.5) * 1.12);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bemanningsbehov per månad' });
    const iw = W - L - R, ih = H - T - B;
    const y = (v) => T + ih - (v / maxV) * ih;
    for (let k = 0; k <= 4; k++) {
      const v = (maxV / 4) * k;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: cssVar('--line') }));
      svg.append(el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, fmt1(v)));
    }
    svg.append(el('text', { x: 4, y: T - 8 }, 'pers'));
    const slot = iw / months.length, bw = Math.min(28, slot / 3.2);
    months.forEach((m, i) => {
      const cx = L + slot * i + slot / 2;
      const over = capacity > 0 && m.neededPersons > capacity;
      const g = el('g');
      g.append(el('rect', { x: cx - slot / 2, y: T, width: slot, height: ih, fill: 'transparent' }));
      g.append(el('rect', { x: cx - bw - 2, y: y(m.plannedPersons), width: bw, height: Math.max(0, T + ih - y(m.plannedPersons)), fill: cssVar('--plan'), rx: 3 }));
      g.append(el('rect', { x: cx + 2, y: y(m.neededPersons), width: bw, height: Math.max(0, T + ih - y(m.neededPersons)), fill: over ? cssVar('--red') : cssVar('--need'), rx: 3 }));
      if (m.neededPersons >= 0.05) g.append(el('text', { x: cx + 2 + bw / 2, y: y(m.neededPersons) - 5, 'text-anchor': 'middle', style: `fill:${over ? cssVar('--red') : cssVar('--ink-2')};font-weight:600` }, fmt1(m.neededPersons)));
      g.append(el('text', { x: cx, y: H - 10, 'text-anchor': 'middle' }, m.label));
      g.addEventListener('mousemove', (e) => {
        const top = (m.topProjects || []).slice(0, 4).map((p) => `<br>· ${p.label}: ${fmt1(p.persons)} pers`).join('');
        showTip(e, `<b>${m.label}</b><br>Behövs: <b>${fmt1(m.neededPersons)} pers</b> (${fmt0(m.neededHours)} h)<br>Jämn plan: ${fmt1(m.plannedPersons)} pers${capacity ? `<br>Kapacitet: ${fmt1(capacity)} pers` : ''}${top ? '<br><span style="opacity:.75">Största behov:</span>' + top : ''}`);
      });
      g.addEventListener('mouseleave', hideTip);
      svg.append(g);
    });
    if (capacity > 0) {
      svg.append(el('line', { x1: L, x2: W - R, y1: y(capacity), y2: y(capacity), stroke: cssVar('--cap'), 'stroke-width': 2, 'stroke-dasharray': '7 5', style: 'pointer-events:none' }));
      svg.append(el('text', { x: W - R - 4, y: y(capacity) - 6, 'text-anchor': 'end', style: `fill:${cssVar('--cap')};font-weight:600;pointer-events:none` }, `Kapacitet ${fmt1(capacity)}`));
    }
    container.append(svg);
  }

  // ======================================================================
  // Projektets förbrukningskurva
  // ======================================================================
  /**
   * @param r        beräknat projekt (PPCalc.computeProject)
   * @param history  { source, rows?, snaps? }
   */
  function progressChart(container, r, history, today) {
    container.innerHTML = '';
    if (!r.start || !r.end) { container.innerHTML = '<div class="nohist">Projektet saknar start- eller slutdatum – ingen kurva kan ritas.</div>'; return; }

    const statusColor = cssVar({ red: '--red', orange: '--amber', green: '--green', blue: '--blue' }[r.status] || '--grey');
    const W = 860, H = 340, L = 56, R = 20, T = 30, B = 34;
    const t0 = r.start.getTime(), tE = r.end.getTime(), tT = today.getTime();
    const dur = tE - t0;
    let tMax = Math.max(tE, tT);
    if (r.forecastEnd && r.remaining > 0) tMax = Math.max(tMax, Math.min(r.forecastEnd.getTime(), tE + dur * 0.5));
    tMax += (tMax - t0) * 0.02;

    // Faktisk serie
    let actualPts = null, actualKind = 'none';
    if (history && history.source === 'tidrader') {
      const cum = PPCalc.cumulativeSeries(history.rows);
      const last = cum.length ? cum[cum.length - 1].cum : 0;
      const k = last > 0 && r.actual > 0 ? r.actual / last : 1;  // stäm av mot PP:s summa
      const firstT = cum[0] ? Math.min(t0, cum[0].d.getTime()) : t0;
      actualPts = [{ t: firstT, h: 0 }, ...cum.map((p) => ({ t: p.d.getTime(), h: p.cum * k }))];
      if (actualPts[actualPts.length - 1].t < tT) actualPts.push({ t: tT, h: r.actual });
      actualKind = 'rows';
    } else if (history && history.source === 'historik') {
      actualPts = [{ t: t0, h: 0 }, ...history.snaps.map((s) => ({ t: PPCalc.toDate(s.date).getTime(), h: Number(s.actual) }))];
      actualKind = 'snaps';
    }

    const fcAtMax = r.recentWeekly > 0 ? r.actual + r.recentWeekly * ((tMax - tT) / WEEK) : 0;
    const maxH = niceMax(Math.max(r.budget, r.actual, Math.min(fcAtMax, r.budget * 1.3)) * 1.08);
    const iw = W - L - R, ih = H - T - B;
    const x = (t) => L + ((t - t0) / (tMax - t0)) * iw;
    const y = (h) => T + ih - (Math.min(h, maxH) / maxH) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Timförbrukning över projektet' });

    const defs = el('defs');
    const grad = el('linearGradient', { id: 'gA', x1: 0, x2: 0, y1: 0, y2: 1 });
    grad.append(el('stop', { offset: '0%', 'stop-color': statusColor, 'stop-opacity': 0.25 }));
    grad.append(el('stop', { offset: '100%', 'stop-color': statusColor, 'stop-opacity': 0.02 }));
    defs.append(grad);
    svg.append(defs);

    // Efter slutdatum – tonad zon
    if (tMax > tE) svg.append(el('rect', { x: x(tE), y: T, width: x(tMax) - x(tE), height: ih, fill: cssVar('--red'), opacity: 0.05 }));

    // Rutnät
    for (let k = 0; k <= 4; k++) {
      const v = (maxH / 4) * k;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: cssVar('--line') }));
      svg.append(el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, fmt0(v)));
    }
    svg.append(el('text', { x: 6, y: T - 14 }, 'timmar'));
    for (const m of monthTicks(r.start, new Date(tMax))) {
      svg.append(el('line', { x1: x(m), x2: x(m), y1: T + ih, y2: T + ih + 4, stroke: cssVar('--muted') }));
      svg.append(el('text', { x: x(m), y: H - 12, 'text-anchor': 'middle' }, dMonth(m)));
    }

    // Budget
    svg.append(el('line', { x1: L, x2: W - R, y1: y(r.budget), y2: y(r.budget), stroke: cssVar('--muted'), 'stroke-dasharray': '2 4', opacity: 0.8 }));
    svg.append(el('text', { x: L + 6, y: y(r.budget) - 6, style: 'font-weight:600' }, `Budget ${fmt0(r.budget)} h`));

    // Plan (jämn)
    svg.append(el('line', { x1: x(t0), y1: y(0), x2: x(tE), y2: y(r.budget), stroke: cssVar('--plan'), 'stroke-width': 3, 'stroke-linecap': 'round' }));

    // Start/slutdatum
    svg.append(el('text', { x: x(t0), y: T - 14, 'text-anchor': 'start', style: `fill:${cssVar('--ink-2')};font-weight:600` }, `Start ${dShort(r.start)}`));
    svg.append(el('line', { x1: x(tE), x2: x(tE), y1: T - 8, y2: T + ih, stroke: cssVar('--ink-2'), 'stroke-width': 1.5 }));
    svg.append(el('text', { x: x(tE), y: T - 14, 'text-anchor': tE > tMax - (tMax - t0) * 0.08 ? 'end' : 'middle', style: `fill:${cssVar('--ink-2')};font-weight:650` }, `Slut ${dShort(r.end)}`));

    // Faktiskt
    if (actualPts && actualPts.length > 1) {
      const pts = actualPts.filter((p) => p.t <= tT + 864e5);
      const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.h).toFixed(1)}`).join(' ');
      const area = `${line} L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)} L${x(pts[0].t).toFixed(1)},${y(0)} Z`;
      svg.append(el('path', { d: area, fill: 'url(#gA)' }));
      if (actualKind === 'snaps') {
        svg.append(el('path', { d: `M${x(pts[0].t)},${y(0)} L${x(pts[1].t)},${y(pts[1].h)}`, fill: 'none', stroke: cssVar('--ink'), 'stroke-width': 1.5, 'stroke-dasharray': '2 4' }));
        if (pts.length > 2) svg.append(el('path', { d: pts.slice(1).map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.h)}`).join(' '), fill: 'none', stroke: cssVar('--ink'), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      } else {
        svg.append(el('path', { d: line, fill: 'none', stroke: cssVar('--ink'), 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      }
    } else {
      svg.append(el('path', { d: `M${x(t0)},${y(0)} L${x(Math.min(tT, tMax))},${y(r.actual)}`, fill: 'none', stroke: cssVar('--ink'), 'stroke-width': 1.5, 'stroke-dasharray': '2 4' }));
    }

    // Behövs till slut + prognos
    const tTc = Math.min(Math.max(tT, t0), tMax);
    if (r.remaining > 0 && tE > tTc) {
      svg.append(el('line', { x1: x(tTc), y1: y(r.actual), x2: x(tE), y2: y(r.budget), stroke: cssVar('--need'), 'stroke-width': 2.5, 'stroke-linecap': 'round' }));
    }
    if (r.recentWeekly > 0 && r.remaining > 0) {
      const tF = Math.min(r.forecastEnd ? r.forecastEnd.getTime() : tMax, tMax);
      const hF = Math.min(r.actual + r.recentWeekly * ((tF - tTc) / WEEK), r.budget);
      svg.append(el('line', { x1: x(tTc), y1: y(r.actual), x2: x(tF), y2: y(hF), stroke: cssVar('--fc'), 'stroke-width': 2.5, 'stroke-dasharray': '7 5', 'stroke-linecap': 'round' }));
      if (r.forecastEnd && r.forecastEnd.getTime() <= tMax) {
        svg.append(el('circle', { cx: x(tF), cy: y(hF), r: 4, fill: '#fff', stroke: cssVar('--fc'), 'stroke-width': 2 }));
        svg.append(el('text', { x: x(tF) - 8, y: y(hF) - 10, 'text-anchor': 'end', style: `fill:${cssVar('--fc')};font-weight:650` }, `Prognos klar ${dShort(r.forecastEnd)}`));
      }
    }

    // Idag
    if (tT >= t0 && tT <= tMax) {
      svg.append(el('line', { x1: x(tT), x2: x(tT), y1: T, y2: T + ih, stroke: cssVar('--ink'), 'stroke-dasharray': '3 3', opacity: 0.6 }));
      svg.append(el('rect', { x: x(tT) - 20, y: T + ih - 21, width: 40, height: 17, rx: 8, fill: cssVar('--ink') }));
      svg.append(el('text', { x: x(tT), y: T + ih - 9, 'text-anchor': 'middle', style: 'fill:#fff;font-weight:650;font-size:10.5px' }, 'Idag'));
    }
    // Plan idag (ring) + utfört (punkt)
    if (tT >= t0 && tT <= tE) {
      svg.append(el('circle', { cx: x(tT), cy: y(r.expected), r: 5, fill: '#fff', stroke: cssVar('--plan'), 'stroke-width': 3 }));
    }
    const ax = x(tTc), ay = y(r.actual);
    svg.append(el('circle', { cx: ax, cy: ay, r: 7, fill: statusColor, stroke: '#fff', 'stroke-width': 2.5 }));
    const left = ax > W - R - 110;
    svg.append(el('text', { x: ax + (left ? -13 : 13), y: ay - 10, 'text-anchor': left ? 'end' : 'start', style: `fill:${cssVar('--ink')};font-weight:700;font-size:13px` }, `${fmt0(r.actual)} h`));

    // Hover
    const hover = el('g', { style: 'pointer-events:none', visibility: 'hidden' });
    const hl = el('line', { y1: T, y2: T + ih, stroke: cssVar('--muted'), 'stroke-width': 1 });
    hover.append(hl);
    svg.append(hover);
    const overlay = el('rect', { x: L, y: T, width: iw, height: ih, fill: 'transparent' });
    overlay.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const sx = ((e.clientX - rect.left) / rect.width) * W;
      const t = t0 + ((sx - L) / iw) * (tMax - t0);
      hl.setAttribute('x1', sx); hl.setAttribute('x2', sx); hover.setAttribute('visibility', 'visible');
      const planH = t <= t0 ? 0 : t >= tE ? r.budget : r.budget * ((t - t0) / dur);
      let actH = null;
      if (t <= tT && actualKind === 'rows') {
        let prev = actualPts[0];
        for (const p of actualPts) { if (p.t > t) break; prev = p; }
        actH = prev.h;
      }
      let html = `<b>${dFull(new Date(t))}</b><br><span class="tt-sw" style="background:${cssVar('--plan')}"></span>Jämn plan: ${fmt0(planH)} h`;
      if (actH != null) html += `<br><span class="tt-sw" style="background:${cssVar('--ink')}"></span>Faktiskt: ${fmt0(actH)} h (${actH >= planH ? '+' : '−'}${fmt0(Math.abs(actH - planH))})`;
      if (t > tT && t <= tE && r.remaining > 0) {
        const needH = r.actual + (r.budget - r.actual) * ((t - tT) / (tE - tT));
        html += `<br><span class="tt-sw" style="background:${cssVar('--need')}"></span>Behövs: ${fmt0(needH)} h`;
      }
      if (t > tT && r.recentWeekly > 0) html += `<br><span class="tt-sw" style="background:${cssVar('--fc')}"></span>Prognos: ${fmt0(Math.min(r.actual + r.recentWeekly * ((t - tT) / WEEK), r.budget))} h`;
      showTip(e, html);
    });
    overlay.addEventListener('mouseleave', () => { hover.setAttribute('visibility', 'hidden'); hideTip(); });
    svg.append(overlay);

    container.append(svg);
  }

  // ======================================================================
  // Timmar per vecka
  // ======================================================================
  function weeklyChart(container, r, history, today, hoursPerWeek = 40) {
    container.innerHTML = '';
    if (!history || history.source !== 'tidrader' || !r.start) {
      container.innerHTML = '<div class="nohist">Veckodata saknas – tidrader för projektet kunde inte läsas (kräver behörighet i Projektportalen).<br>Takten byggs i stället upp från tilläggets egen historik vid varje uppdatering.</div>';
      return;
    }
    const to = r.end && r.end > today ? r.end : today;
    const weeks = PPCalc.weeklyBuckets(history.rows, r.start, to);
    if (!weeks.length) { container.innerHTML = '<div class="nohist">Inga veckor att visa.</div>'; return; }
    const W = 860, H = 190, L = 56, R = 20, T = 18, B = 28;
    const tT = today.getTime();
    const maxV = niceMax(Math.max(...weeks.map((w) => w.hours), r.plannedRate || 0, isFinite(r.neededRate) ? r.neededRate : 0, 1) * 1.12);
    const iw = W - L - R, ih = H - T - B;
    const slot = iw / weeks.length, bw = Math.max(1.5, slot * 0.72);
    const y = (v) => T + ih - (Math.min(v, maxV) / maxV) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Timmar per vecka' });
    for (let k = 0; k <= 3; k++) {
      const v = (maxV / 3) * k;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: cssVar('--line') }));
      svg.append(el('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, fmt0(v)));
    }
    svg.append(el('text', { x: 6, y: T - 6 }, 'h/vecka'));
    let lastMonth = -1, labels = 0, lastX = -1e9;
    const every = Math.max(1, Math.ceil(weeks.length / 4.3 / 10));
    weeks.forEach((w, i) => {
      const cx = L + slot * i + slot / 2;
      if (w.weekStart.getTime() <= tT) {
        const b = el('rect', { x: cx - bw / 2, y: y(w.hours), width: bw, height: Math.max(0, T + ih - y(w.hours)), fill: '#8fa7dd', rx: Math.min(2, bw / 3) });
        b.addEventListener('mousemove', (e) => showTip(e, `<b>Vecka från ${dFull(w.weekStart)}</b><br>${fmt1(w.hours)} h rapporterat<br>≈ ${fmt1(w.hours / hoursPerWeek)} pers à ${hoursPerWeek} h`));
        b.addEventListener('mouseleave', hideTip);
        svg.append(b);
      }
      const m = w.weekStart.getMonth();
      if (m !== lastMonth) {
        if (labels++ % every === 0 && cx - lastX > 44) { svg.append(el('text', { x: cx, y: H - 10, 'text-anchor': 'middle' }, dMonth(w.weekStart))); lastX = cx; }
        lastMonth = m;
      }
    });
    if (r.plannedRate > 0) {
      svg.append(el('line', { x1: L, x2: W - R, y1: y(r.plannedRate), y2: y(r.plannedRate), stroke: cssVar('--plan'), 'stroke-width': 2.5, style: 'pointer-events:none' }));
    }
    const idxToday = weeks.findIndex((w) => w.weekStart.getTime() > tT);
    if (idxToday >= 0 && isFinite(r.neededRate) && r.neededRate > 0) {
      const xa = L + slot * idxToday;
      svg.append(el('line', { x1: xa, x2: W - R, y1: y(r.neededRate), y2: y(r.neededRate), stroke: cssVar('--need'), 'stroke-width': 2.5, style: 'pointer-events:none' }));
      svg.append(el('text', { x: W - R - 4, y: y(r.neededRate) - 6, 'text-anchor': 'end', style: `fill:${cssVar('--need')};font-weight:650;pointer-events:none` }, `Behövs ${fmt0(r.neededRate)} h/v`));
    }
    if (idxToday > 0) {
      const xt = L + slot * idxToday;
      svg.append(el('line', { x1: xt, x2: xt, y1: T, y2: T + ih, stroke: cssVar('--ink'), 'stroke-dasharray': '3 3', opacity: 0.5, style: 'pointer-events:none' }));
    }
    container.append(svg);
  }

  root.PPCharts = { monthChart, progressChart, weeklyChart, hideTip };
})(self);
