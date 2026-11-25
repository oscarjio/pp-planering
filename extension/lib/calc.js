// Planeringsberäkningar – ren logik utan DOM/Chrome-beroenden (testbar i Node).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PPCalc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY = 864e5;
  const WEEK = 7 * DAY;

  const DEFAULTS = {
    threshold: 40,          // minsta budget (h) för att projektet ska tas med
    hoursPerWeek: 40,       // timmar per person och vecka
    orangeFactor: 1.15,     // uppmanningsfaktor över detta = gul/orange
    redFactor: 1.5,         // över detta = röd
    earlyOverFactor: 1.3,   // utfört > förväntat × detta tidigt i projektet = blå
    earlyOverMinHours: 40,  // ...och minst så här många timmar över plan
    minExtraPersons: 0.5,   // röd kräver också minst så här många extra personer (annars orange)
  };

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return new Date(v.getTime());
    const s = String(v).slice(0, 10);
    const d = new Date(s + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  function startOfDay(d) {
    const x = new Date(d.getTime());
    x.setHours(0, 0, 0, 0);
    return x;
  }

  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const round1 = (x) => (x == null || !isFinite(x) ? x : Math.round(x * 10) / 10);

  /**
   * Beräkna planeringsläge för ett projekt.
   * @param {object} p  { id, budget, actual, start, end, recentWeekly? }
   * @param {Date} today
   * @param {object} opts  se DEFAULTS
   */
  function computeProject(p, today, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const t = startOfDay(today);
    const start = toDate(p.start);
    const end = toDate(p.end);
    const budget = Number(p.budget) || 0;
    const actual = Number(p.actual) || 0;
    const remaining = Math.max(0, budget - actual);
    const flags = [];

    const r = {
      ...p,
      budget, actual, remaining,
      start, end,
      totalWeeks: null, weeksLeft: null, elapsedFrac: null,
      expected: null, deviation: null,
      plannedRate: null, neededRate: null, factor: null,
      plannedPersons: null, neededPersons: null, recentPersons: null,
      forecastEnd: null,
      budgetUsedFrac: budget > 0 ? actual / budget : null,
      status: 'grey', flags,
    };

    if (!start || !end || end <= start) {
      r.status = 'grey';
      flags.push('Saknar giltigt start-/slutdatum');
      return r;
    }

    const totalMs = end - start;
    r.totalWeeks = totalMs / WEEK;
    r.elapsedFrac = clamp((t - start) / totalMs, 0, 1);
    r.weeksLeft = (end - t) / WEEK;
    r.plannedRate = budget / r.totalWeeks;            // jämn bemanning h/vecka
    r.expected = budget * r.elapsedFrac;
    r.deviation = actual - r.expected;                  // negativ = efter plan

    if (t < start) {
      // Inte startat: behövd takt = budget över hela projektets längd
      r.neededRate = r.plannedRate;
    } else if (r.weeksLeft > 0) {
      r.neededRate = remaining / Math.max(r.weeksLeft, 1 / 7); // minst en dag
    } else {
      r.neededRate = remaining > 0 ? Infinity : 0;
    }

    r.factor = r.plannedRate > 0 ? r.neededRate / r.plannedRate : null;
    r.plannedPersons = r.plannedRate / o.hoursPerWeek;
    r.neededPersons = isFinite(r.neededRate) ? r.neededRate / o.hoursPerWeek : Infinity;

    if (p.recentWeekly != null && isFinite(p.recentWeekly)) {
      r.recentPersons = p.recentWeekly / o.hoursPerWeek;
      if (p.recentWeekly > 0 && remaining > 0) {
        r.forecastEnd = new Date(t.getTime() + (remaining / p.recentWeekly) * WEEK);
      } else if (remaining === 0) {
        r.forecastEnd = t;
      }
    }

    // Status
    if (actual > budget && budget > 0) flags.push('Budget överskriden');
    // Extra personer som krävs utöver jämn bemanning – små restbelopp ska inte larma rött.
    const extraPersons = (isFinite(r.neededRate) ? r.neededRate - r.plannedRate : remaining) / o.hoursPerWeek;
    if (r.weeksLeft <= 0 && remaining > 0) {
      r.status = remaining >= o.hoursPerWeek * o.minExtraPersons ? 'red' : 'orange';
      flags.push('Slutdatum passerat med timmar kvar');
    } else if (r.factor != null && r.factor > o.redFactor) {
      r.status = extraPersons >= o.minExtraPersons ? 'red' : 'orange';
      flags.push(r.status === 'red' ? 'Kräver kraftig uppmanning' : 'Efter plan (litet antal timmar)');
    } else if (r.factor != null && r.factor > o.orangeFactor) {
      r.status = 'orange';
      flags.push('Ligger efter plan');
    } else if (
      r.elapsedFrac < 0.5 &&
      actual > r.expected * o.earlyOverFactor &&
      actual - r.expected > o.earlyOverMinHours
    ) {
      r.status = 'blue';
      flags.push('Tidigt överbemannat / hög förbrukning');
    } else {
      r.status = 'green';
    }
    if (r.forecastEnd && end && r.forecastEnd > end && remaining > 0) {
      flags.push('Prognos med nuvarande takt: klart efter slutdatum');
    }
    return r;
  }

  /** Första dagen i månaden för datum d */
  function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }

  /**
   * Bemanningsbehov per månad framåt (summa över projekt).
   * Behövd takt läggs jämnt ut från idag (eller start) till slutdatum.
   * Planerad takt = jämn bemanning från start till slut.
   * @returns [{ month: Date, label, neededPersons, plannedPersons, byProject: [{id, persons}] }]
   */
  function monthlyDemand(results, today, months = 12, opts = {}) {
    const o = { ...DEFAULTS, ...opts };
    const t = startOfDay(today);
    const out = [];
    let m = monthStart(t);
    for (let i = 0; i < months; i++) {
      const mStart = new Date(m.getFullYear(), m.getMonth() + i, 1);
      const mEnd = new Date(m.getFullYear(), m.getMonth() + i + 1, 1);
      const from = i === 0 ? t : mStart;  // innevarande månad räknas från idag
      const monthWeeks = (mEnd - from) / WEEK;
      let needH = 0, planH = 0;
      const byProject = [];
      for (const r of results) {
        if (!r.start || !r.end || r.status === 'grey') continue;
        // behövd: från max(idag, start) till slut
        if (isFinite(r.neededRate) && r.neededRate > 0) {
          const a = new Date(Math.max(from, r.start, t));
          const b = new Date(Math.min(mEnd, r.end));
          if (b > a) {
            const h = r.neededRate * ((b - a) / WEEK);
            needH += h;
            byProject.push({ id: r.id, hours: h });
          }
        }
        if (r.plannedRate > 0) {
          const a = new Date(Math.max(from, r.start));
          const b = new Date(Math.min(mEnd, r.end));
          if (b > a) planH += r.plannedRate * ((b - a) / WEEK);
        }
      }
      const denom = monthWeeks * o.hoursPerWeek;
      out.push({
        month: mStart,
        label: mStart.toLocaleDateString('sv-SE', { month: 'short', year: '2-digit' }),
        neededHours: needH,
        plannedHours: planH,
        neededPersons: denom > 0 ? needH / denom : 0,
        plannedPersons: denom > 0 ? planH / denom : 0,
        byProject: byProject
          .map((x) => ({ id: x.id, persons: denom > 0 ? x.hours / denom : 0 }))
          .sort((a, b) => b.persons - a.persons),
      });
    }
    return out;
  }

  /**
   * Takt från sparade ögonblicksbilder: [{ date: 'YYYY-MM-DD', actual }].
   * Använder äldsta bilden inom lookbackDays (minst minDays gammal).
   * @returns h/vecka eller null
   */
  function rateFromSnapshots(snaps, today, lookbackDays = 28, minDays = 7) {
    if (!Array.isArray(snaps) || snaps.length < 2) return null;
    const t = startOfDay(today);
    const sorted = snaps
      .map((s) => ({ d: toDate(s.date), a: Number(s.actual) }))
      .filter((s) => s.d && isFinite(s.a))
      .sort((a, b) => a.d - b.d);
    const latest = sorted[sorted.length - 1];
    const cutoff = new Date(t.getTime() - lookbackDays * DAY);
    const base = sorted.find((s) => s.d >= cutoff && (latest.d - s.d) / DAY >= minDays);
    if (!base) return null;
    const weeks = (latest.d - base.d) / WEEK;
    return weeks > 0 ? Math.max(0, latest.a - base.a) / weeks : null;
  }

  /**
   * Takt från tidrader: [{ date, hours }] → h/vecka över senaste lookbackDays.
   */
  function rateFromTimeRows(rows, today, lookbackDays = 28) {
    if (!Array.isArray(rows)) return null;
    const t = startOfDay(today);
    const cutoff = new Date(t.getTime() - lookbackDays * DAY);
    let sum = 0;
    for (const r of rows) {
      const d = toDate(r.date);
      if (d && d >= cutoff && d <= t) sum += Number(r.hours) || 0;
    }
    return sum / (lookbackDays / 7);
  }

  /** Statussortering: värst först */
  const STATUS_ORDER = { red: 0, orange: 1, blue: 2, green: 3, grey: 4 };

  function sortResults(results) {
    return results.slice().sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s) return s;
      const fa = a.factor == null ? -1 : a.factor, fb = b.factor == null ? -1 : b.factor;
      return fb - fa;
    });
  }

  return {
    DEFAULTS, computeProject, monthlyDemand, rateFromSnapshots, rateFromTimeRows,
    sortResults, toDate, round1, WEEK, DAY,
  };
});
