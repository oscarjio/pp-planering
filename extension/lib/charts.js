// Enkla SVG-diagram utan externa bibliotek (MV3 tillåter inte CDN-skript).
(function (root) {
  const NS = 'http://www.w3.org/2000/svg';
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function el(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    return steps.find((s) => n <= s) * p;
  }

  const fmt1 = (x) => (Math.round(x * 10) / 10).toLocaleString('sv-SE');

  /** Stapeldiagram: behövd + planerad bemanning per månad, kapacitetslinje. */
  function monthChart(container, months, capacity) {
    container.innerHTML = '';
    const W = 900, H = 260, L = 40, R = 10, T = 14, B = 28;
    const maxV = niceMax(Math.max(capacity || 0, ...months.map((m) => Math.max(m.neededPersons, m.plannedPersons))) * 1.1);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bemanningsbehov per månad' });
    const iw = W - L - R, ih = H - T - B;
    const y = (v) => T + ih - (v / maxV) * ih;
    for (let k = 0; k <= 4; k++) {
      const v = (maxV / 4) * k;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: css('--line') }));
      svg.append(el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, fmt1(v)));
    }
    const slot = iw / months.length, bw = Math.min(26, slot / 3);
    months.forEach((m, i) => {
      const cx = L + slot * i + slot / 2;
      const pb = el('rect', { x: cx - bw - 1, y: y(m.plannedPersons), width: bw, height: Math.max(0, T + ih - y(m.plannedPersons)), fill: css('--plan'), rx: 2 });
      pb.append(el('title', {}, `${m.label}: planerad ${fmt1(m.plannedPersons)} pers`));
      const nb = el('rect', { x: cx + 1, y: y(m.neededPersons), width: bw, height: Math.max(0, T + ih - y(m.neededPersons)),
        fill: capacity && m.neededPersons > capacity ? css('--red') : css('--need'), rx: 2 });
      nb.append(el('title', {}, `${m.label}: behövs ${fmt1(m.neededPersons)} pers (${Math.round(m.neededHours)} h)`));
      svg.append(pb, nb);
      svg.append(el('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, m.label));
    });
    if (capacity > 0) {
      svg.append(el('line', { x1: L, x2: W - R, y1: y(capacity), y2: y(capacity), stroke: css('--cap'), 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
      svg.append(el('text', { x: W - R - 4, y: y(capacity) - 5, 'text-anchor': 'end', fill: css('--cap') }, `Kapacitet ${fmt1(capacity)}`));
    }
    container.append(svg);
  }

  /** Projektkurva: plan (jämn), faktiskt utfört idag, behövd linje till slut, prognos med nuvarande takt. */
  function projectCurve(container, r, today) {
    container.innerHTML = '';
    if (!r.start || !r.end) { container.textContent = 'Saknar datum – ingen kurva.'; return; }
    const W = 520, H = 220, L = 46, R = 12, T = 12, B = 26;
    const t0 = r.start.getTime();
    const tEnd = Math.max(r.end.getTime(), today.getTime(), r.forecastEnd ? Math.min(r.forecastEnd.getTime(), r.end.getTime() * 2 - t0) : 0);
    const maxH = niceMax(Math.max(r.budget, r.actual) * 1.05);
    const x = (ms) => L + ((ms - t0) / (tEnd - t0)) * (W - L - R);
    const y = (h) => T + (H - T - B) - (h / maxH) * (H - T - B);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
    for (let k = 0; k <= 4; k++) {
      const v = (maxH / 4) * k;
      svg.append(el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: css('--line') }));
      svg.append(el('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, Math.round(v).toLocaleString('sv-SE')));
    }
    const d = (ms) => new Date(ms).toLocaleDateString('sv-SE');
    svg.append(el('text', { x: L, y: H - 6 }, d(t0)));
    svg.append(el('text', { x: x(r.end.getTime()), y: H - 6, 'text-anchor': 'middle' }, d(r.end.getTime())));
    // budgetlinje
    svg.append(el('line', { x1: L, x2: W - R, y1: y(r.budget), y2: y(r.budget), stroke: css('--grey'), 'stroke-dasharray': '2 3' }));
    // plan
    svg.append(el('line', { x1: x(t0), y1: y(0), x2: x(r.end.getTime()), y2: y(r.budget), stroke: css('--plan'), 'stroke-width': 3 }));
    // idag
    const tt = Math.min(Math.max(today.getTime(), t0), tEnd);
    svg.append(el('line', { x1: x(tt), x2: x(tt), y1: T, y2: H - B, stroke: css('--muted'), 'stroke-dasharray': '3 3' }));
    svg.append(el('text', { x: x(tt) + 3, y: T + 10 }, 'idag'));
    // faktiskt (rak linje från start – historik saknas)
    svg.append(el('line', { x1: x(t0), y1: y(0), x2: x(tt), y2: y(r.actual), stroke: css('--text'), 'stroke-width': 1.5, 'stroke-dasharray': '1 3' }));
    // behövd
    if (r.remaining > 0 && r.end.getTime() > tt) {
      svg.append(el('line', { x1: x(tt), y1: y(r.actual), x2: x(r.end.getTime()), y2: y(r.budget), stroke: css('--need'), 'stroke-width': 2.5 }));
    }
    // prognos med nuvarande takt
    if (r.forecastEnd && r.remaining > 0) {
      const fe = Math.min(r.forecastEnd.getTime(), tEnd);
      const hAtFe = r.actual + (r.recentWeekly || 0) * ((fe - tt) / (7 * 864e5));
      svg.append(el('line', { x1: x(tt), y1: y(r.actual), x2: x(fe), y2: y(Math.min(hAtFe, r.budget)), stroke: css('--orange'), 'stroke-width': 2, 'stroke-dasharray': '6 4' }));
    }
    svg.append(el('circle', { cx: x(tt), cy: y(r.actual), r: 4, fill: css('--text') }));
    container.append(svg);
    const lg = document.createElement('div');
    lg.className = 'legend';
    lg.innerHTML = '<span><i class="sw plan"></i>Plan (jämn)</span><span><i class="sw need"></i>Behövd till slutdatum</span><span><i class="sw" style="background:var(--orange)"></i>Prognos nuvarande takt</span><span>● Utfört idag</span>';
    container.append(lg);
  }

  root.PPCharts = { monthChart, projectCurve };
})(self);
