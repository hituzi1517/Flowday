/* Flowday scheduling engine. Pure functions, testable with Node. */
(function (root, factory) {
  const engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.StudyPlanner = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_DAY = 1440;
  const CLOCK = /(?:[01]\d|2[0-3]):[0-5]\d/;
  const FIXED_LINE = new RegExp('^(.+?)\\s+(' + CLOCK.source + ')\\s*[-－〜～]\\s*(' + CLOCK.source + ')$');
  const FLEX_LINE = new RegExp('^(.+?)\\s+(\\d+(?:\\.\\d+)?)(h|時間|m|min|分)?(?:\\s*@\\s*(' + CLOCK.source + '))?$','i');
  const STUDY = /数学|英語|物理|化学|国語|地理|歴史|勉強|復習|問題|読書|TOEIC|単語|演習/i;

  function toMin(hhmm) {
    if (typeof hhmm !== 'string' || !new RegExp('^' + CLOCK.source + '$').test(hhmm)) return null;
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
  }
  function formatMin(min) {
    min = Math.max(0, Math.floor(min));
    const prefix = min >= MAX_DAY ? '翌' : '';
    const value = min % MAX_DAY;
    return prefix + String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  }
  function fingerprint(kind, name, index) {
    let h = 2166136261;
    for (const char of kind + '|' + name + '|' + index) {
      h ^= char.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
    return kind + '-' + (h >>> 0).toString(36);
  }
  function parsePlan(text, oldTasks = []) {
    const tasks = [], errors = [], counts = {};
    const old = new Map(oldTasks.map(t => [t.id, t]));
    let section = 'fixed';
    const lines = (text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^#|^\/\//.test(line)) continue;
      if (/^(?:【|\[)\s*固定\s*(?:】|\])$/.test(line)) { section = 'fixed'; continue; }
      if (/^(?:【|\[)\s*可動\s*(?:】|\])$/.test(line)) { section = 'flex'; continue; }
      const countName = (kind, name) => {
        const key = kind + '|' + name;
        const nth = counts[key] || 0;
        counts[key] = nth + 1;
        return fingerprint(kind, name, nth);
      };
      if (section === 'fixed') {
        const m = line.match(FIXED_LINE);
        if (!m) { errors.push(`${i + 1}行目：固定予定は「学校 09:00-16:00」の形式で入力してください。`); continue; }
        const name = m[1].trim(), start = toMin(m[2]), end = toMin(m[3]);
        if (start === end) { errors.push(`${i + 1}行目：「${name}」の開始と終了が同じです。`); continue; }
        tasks.push({ id: countName('fixed', name), kind: 'fixed', name, start, end });
      } else {
        const m = line.match(FLEX_LINE);
        if (!m) { errors.push(`${i + 1}行目：可動予定は「数学 90 @17:00」の形式で入力してください（@以降は省略可）。`); continue; }
        const name = m[1].trim();
        let duration = Number(m[2]) * (/^(h|時間)$/i.test(m[3] || '') ? 60 : 1);
        duration = Math.round(duration);
        if (!Number.isSafeInteger(duration) || duration <= 0 || duration > 1440) {
          errors.push(`${i + 1}行目：「${name}」の所要時間は1〜1440分で指定してください。`); continue;
        }
        const id = countName('flex', name), previous = old.get(id);
        tasks.push({
          id, kind: 'flex', name, duration,
          earliest: m[4] ? toMin(m[4]) : null,
          extra: previous ? Math.max(0, Number(previous.extra) || 0) : 0,
          delay: previous ? Math.max(0, Number(previous.delay) || 0) : 0,
          done: previous ? Boolean(previous.done) : false,
          actualEnd: previous && Number.isFinite(previous.actualEnd) ? previous.actualEnd : null
        });
      }
    }
    return { tasks, errors };
  }
  function fixedIntervals(tasks, previousTasks = []) {
    const entries = [];
    for (const t of previousTasks.filter(t => t.kind === 'fixed' && t.end < t.start)) {
      entries.push({ id: 'prev-' + t.id, name: t.name, start: 0, end: t.end,
        fullStart: - (MAX_DAY - t.start), fullEnd: t.end, isPrev: true });
    }
    for (const t of tasks.filter(t => t.kind === 'fixed')) {
      entries.push({ id: t.id, name: t.name, start: t.start,
        end: t.end <= t.start ? MAX_DAY : t.end,
        fullStart: t.start, fullEnd: t.end <= t.start ? MAX_DAY + t.end : t.end,
        isPrev: false });
    }
    entries.sort((a, b) => a.start - b.start || a.end - b.end);
    const overlaps = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length && entries[j].start < entries[i].end; j++) {
        overlaps.push(`固定予定「${entries[i].name}」と「${entries[j].name}」が重なっています。`);
      }
    }
    // Merge occupied ranges for efficient allocation; still keep original entries for display.
    const busy = [];
    for (const b of entries) {
      const last = busy[busy.length - 1];
      if (last && b.start <= last.end) last.end = Math.max(last.end, b.end);
      else busy.push({ start: b.start, end: b.end });
    }
    return { entries, busy, overlaps };
  }
  function allocate(tasks, wake = '07:00', previousTasks = []) {
    const warnings = [];
    const earliestWake = toMin(wake);
    if (earliestWake === null) warnings.push('起床時刻が不正なため、07:00として計算しました。');
    const fixed = fixedIntervals(tasks, previousTasks);
    warnings.push(...fixed.overlaps);
    const segments = fixed.entries.map(f => ({
      type: 'fixed', id: f.id, name: f.name, start: f.start, end: f.end,
      displayStart: f.isPrev ? '00:00' : formatMin(f.fullStart),
      displayEnd: f.isPrev ? formatMin(f.end) : formatMin(f.fullEnd),
      isPrev: f.isPrev
    }));
    const overflow = [], placements = {};
    let cursor = earliestWake === null ? 420 : earliestWake;
    const flex = tasks.filter(t => t.kind === 'flex');
    let studyMinutes = 0, completed = 0;
    for (const t of flex) {
      let start = Math.max(cursor, t.earliest === null ? 0 : t.earliest);
      start = Math.min(MAX_DAY, start + Math.max(0, Math.round(Number(t.delay) || 0)));
      const total = Math.max(1, Math.round(t.duration + Math.max(0, Number(t.extra) || 0)));
      let remaining = total;
      const chunks = [];
      while (start < MAX_DAY && remaining > 0) {
        const conflict = fixed.busy.find(f => start >= f.start && start < f.end);
        if (conflict) { start = conflict.end; continue; }
        const nextFixed = fixed.busy.find(f => f.start >= start);
        const endLimit = nextFixed ? Math.min(nextFixed.start, MAX_DAY) : MAX_DAY;
        if (endLimit <= start) { start = nextFixed ? nextFixed.end : MAX_DAY; continue; }
        const end = Math.min(endLimit, start + remaining);
        chunks.push({ type: 'flex', id: t.id, name: t.name, start, end, done: Boolean(t.done) });
        remaining -= end - start;
        start = end;
      }
      if (remaining > 0 && !t.done) overflow.push({ id: t.id, name: t.name, minutes: remaining });
      if (chunks.length) {
        chunks.forEach((c, i) => {
          c.part = i + 1; c.parts = chunks.length; c.total = total;
          segments.push(c);
        });
        cursor = chunks[chunks.length - 1].end;
      } else {
        cursor = start;
      }
      if (t.done && t.actualEnd !== null && Number.isFinite(t.actualEnd) && t.actualEnd >= 0 && t.actualEnd <= MAX_DAY) {
        cursor = Math.max(cursor, t.actualEnd);
      }
      placements[t.id] = { chunks, remaining, total };
      if (STUDY.test(t.name)) studyMinutes += total;
      if (t.done) completed++;
    }
    segments.sort((a, b) => a.start - b.start || (a.type === 'fixed' ? -1 : 1));
    return { segments, placements, overflow, warnings, studyMinutes, completed,
      flexCount: flex.length, fixedMinutes: fixed.busy.reduce((s, f) => s + f.end - f.start, 0),
      scheduledFlexMinutes: segments.filter(s => s.type === 'flex').reduce((s, f) => s + f.end - f.start, 0) };
  }
  function addDays(date, delta) {
    const [year, month, day] = date.split('-').map(Number);
    const d = new Date(year, month - 1, day + delta, 12);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function weekday(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d, 12).getDay();
  }
  return { parsePlan, allocate, toMin, formatMin, addDays, weekday };
});
