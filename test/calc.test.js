// Kör: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const C = require('../extension/lib/calc.js');

const today = new Date('2026-11-25T00:00:00');
const near = (a, b, eps = 0.05) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('i fas: utfört enligt linjär plan ger faktor ≈ 1 och grön', () => {
  // 20 veckor, 10 gått, 800 h budget, 400 utfört
  const start = new Date(today.getTime() - 10 * C.WEEK);
  const end = new Date(today.getTime() + 10 * C.WEEK);
  const r = C.computeProject({ id: 1, budget: 800, actual: 400, start, end }, today);
  near(r.plannedRate, 40);
  near(r.neededRate, 40);
  near(r.factor, 1);
  near(r.plannedPersons, 1);
  assert.strictEqual(r.status, 'green');
});

test('Oscars exempel: 1500 h kvar på ~2 månader, plan 2 pers → röd', () => {
  // Projekt 40 veckor à 80 h/v = 3200 h, 8,5 v kvar, bara 1700 utfört
  const start = new Date(today.getTime() - 31.5 * C.WEEK);
  const end = new Date(today.getTime() + 8.5 * C.WEEK);
  const r = C.computeProject({ id: 2, budget: 3200, actual: 1700, start, end }, today);
  near(r.remaining, 1500);
  near(r.neededPersons, 1500 / 8.5 / 40, 0.01); // ≈ 4,4 pers
  near(r.factor, 2.21, 0.02);
  assert.strictEqual(r.status, 'red');
});

test('efter plan men måttligt → orange', () => {
  const start = new Date(today.getTime() - 10 * C.WEEK);
  const end = new Date(today.getTime() + 10 * C.WEEK);
  const r = C.computeProject({ id: 3, budget: 800, actual: 300, start, end }, today);
  near(r.factor, 1.25);
  assert.strictEqual(r.status, 'orange');
});

test('tidigt överbemannat → blå', () => {
  const start = new Date(today.getTime() - 4 * C.WEEK);
  const end = new Date(today.getTime() + 16 * C.WEEK);
  const r = C.computeProject({ id: 4, budget: 800, actual: 400, start, end }, today);
  assert.strictEqual(r.status, 'blue');
  assert.ok(r.factor < 1);
});

test('slutdatum passerat med timmar kvar → röd, oändligt behov', () => {
  const start = new Date(today.getTime() - 20 * C.WEEK);
  const end = new Date(today.getTime() - 1 * C.WEEK);
  const r = C.computeProject({ id: 5, budget: 500, actual: 300, start, end }, today);
  assert.strictEqual(r.status, 'red');
  assert.strictEqual(r.neededRate, Infinity);
});

test('saknar datum → grå', () => {
  const r = C.computeProject({ id: 6, budget: 500, actual: 0, start: null, end: '2027-01-01' }, today);
  assert.strictEqual(r.status, 'grey');
});

test('ej startat: behövd = planerad', () => {
  const start = new Date(today.getTime() + 4 * C.WEEK);
  const end = new Date(today.getTime() + 14 * C.WEEK);
  const r = C.computeProject({ id: 7, budget: 400, actual: 0, start, end }, today);
  near(r.factor, 1);
  assert.strictEqual(r.status, 'green');
});

test('prognos med nuvarande takt', () => {
  const start = new Date(today.getTime() - 10 * C.WEEK);
  const end = new Date(today.getTime() + 10 * C.WEEK);
  const r = C.computeProject({ id: 8, budget: 800, actual: 400, start, end, recentWeekly: 20 }, today);
  near((r.forecastEnd - today) / C.WEEK, 20); // 400 h / 20 h/v = 20 v
  assert.ok(r.flags.some((f) => f.includes('efter slutdatum')));
});

test('månadsbehov summerar timmar korrekt', () => {
  const start = new Date('2026-06-01');
  const end = new Date('2027-03-01');
  const r = C.computeProject({ id: 9, budget: 1000, actual: 600, start, end }, today);
  const months = C.monthlyDemand([r], today, 6);
  const total = months.reduce((a, m) => a + m.neededHours, 0);
  near(total, 400, 1); // allt som är kvar fördelas fram till slutdatum
  assert.strictEqual(months[5].neededHours, 0); // maj 2027 efter slut
});

test('takt från ögonblicksbilder', () => {
  const snaps = [
    { date: '2026-10-20', actual: 100 },
    { date: '2026-11-04', actual: 160 },
    { date: '2026-11-25', actual: 280 },
  ];
  // äldsta inom 28 d = 2026-11-04 → 120 h på 3 v = 40 h/v
  near(C.rateFromSnapshots(snaps, today, 28), 40);
  assert.strictEqual(C.rateFromSnapshots([{ date: '2026-11-25', actual: 1 }], today), null);
});

test('litet restbelopp nära slutdatum blir orange, inte röd', () => {
  // 25 h kvar, 1 dag kvar, planerat 0,1 pers → hög faktor men under halv person extra? Nej: 25 h/dag = 4,4 pers → röd
  const start = new Date(today.getTime() - 30 * C.WEEK);
  const end1 = new Date(today.getTime() + 1 * C.DAY);
  assert.strictEqual(C.computeProject({ id: 10, budget: 150, actual: 125, start, end: end1 }, today).status, 'red');
  // 10 h kvar, 3 veckor kvar, planerat 0,05 pers → faktor > 1,5 men bara ~0,02 pers extra → orange
  const end2 = new Date(today.getTime() + 3 * C.WEEK);
  const r = C.computeProject({ id: 11, budget: 60, actual: 50, start, end: end2 }, today);
  assert.ok(r.factor > 1.5);
  assert.strictEqual(r.status, 'orange');
  // passerat slutdatum med 5 h kvar → orange
  const end3 = new Date(today.getTime() - 1 * C.WEEK);
  assert.strictEqual(C.computeProject({ id: 12, budget: 60, actual: 55, start, end: end3 }, today).status, 'orange');
});

test('takt från tidrader', () => {
  const rows = [
    { date: '2026-11-24T00:00:00', hours: 8 },
    { date: '2026-11-10', hours: 32 },
    { date: '2026-09-01', hours: 100 }, // utanför fönstret
  ];
  near(C.rateFromTimeRows(rows, today, 28), 10);
});
