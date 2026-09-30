'use strict';
(() => {
  const P = window.StudyPlanner;
  const KEY = 'flowday.study.v1';
  const DEFAULT_TEXT = `# 固定予定はこの欄に
【固定】
睡眠 23:30-07:00
# 学校のある日は例：学校 09:00-16:00
# 服薬に指定時刻がある場合は固定に追加してください

# 上から順番に自動配置されます
【可動】
数学 90 @08:00
英語 60
物理 90
風呂 30 @20:00
歯磨き 10`;
  const $ = id => document.getElementById(id);
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const nowDate = () => localDate(new Date());
  const tomorrowDate = () => P.addDays(nowDate(), 1);
  const safeText = s => String(s).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const minutesLabel = n => n >= 60 ? `${Math.floor(n / 60)}時間${n % 60 ? `${n % 60}分` : ''}` : `${n}分`;
  const $toast = $('toast');
  let toastTimer;
  let state = load();
  let activeDate = tomorrowDate();
  let appliedSchedule = null;

  function toast(message) {
    clearTimeout(toastTimer); $toast.textContent = message; $toast.classList.add('show');
    toastTimer = setTimeout(() => $toast.classList.remove('show'), 3000);
  }
  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.version === 1 && raw.days && typeof raw.days === 'object')
        return { version: 1, global: raw.global || { text: DEFAULT_TEXT, wake: '07:00' },
          weekdays: raw.weekdays || {}, days: raw.days, carryLog: raw.carryLog || {} };
    } catch (error) { console.warn('Could not load saved data', error); }
    return { version: 1, global: { text: DEFAULT_TEXT, wake: '07:00' }, weekdays: {}, days: {}, carryLog: {} };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); $('saveLabel').textContent = 'この端末に保存済み'; return true; }
    catch { $('saveLabel').textContent = '容量不足・保存失敗'; toast('保存できませんでした。JSONでバックアップし、空き容量を確認してください。'); return false; }
  }
  function templateFor(date) { return state.weekdays[P.weekday(date)] || state.global; }
  function dayFor(date) {
    if (!state.days[date]) {
      const template = templateFor(date);
      const text = template.text || DEFAULT_TEXT;
      state.days[date] = { text, wake: template.wake || '07:00', appliedText: text, appliedWake: template.wake || '07:00', tasks: P.parsePlan(text).tasks };
      save();
    }
    return state.days[date];
  }
  function relevantPrevTasks(date) {
    const prev = state.days[P.addDays(date, -1)];
    return prev && Array.isArray(prev.tasks) ? prev.tasks : [];
  }
  function showDay(date) {
    activeDate = date;
    const day = dayFor(date);
    $('datePicker').value = date;
    $('wakePicker').value = day.wake || '07:00';
    $('planInput').value = day.text || '';
    $('dirtyLabel').textContent = (day.text !== (day.appliedText ?? day.text) || day.wake !== (day.appliedWake ?? day.wake)) ? '時間割に未反映' : '';
    const today = nowDate(), tomorrow = tomorrowDate();
    document.querySelectorAll('.date-shortcut').forEach(button => button.classList.toggle('selected', button.dataset.date === 'today' ? date === today : date === tomorrow));
    $('editorHeading').textContent = date === tomorrow ? '翌日の計画を書く' : (date === today ? '今日の計画を調整' : 'この日の計画を書く');
    const [y,m,d] = date.split('-').map(Number);
    const dayName = ['日','月','火','水','木','金','土'][P.weekday(date)];
    $('timelineDate').textContent = `${y}年${m}月${d}日（${dayName}）`;
    render();
  }
  function currentEditorToDraft() {
    const day = dayFor(activeDate);
    day.text = $('planInput').value;
    day.wake = $('wakePicker').value || '07:00';
    const parsed = P.parsePlan(day.text, day.tasks);
    $('dirtyLabel').textContent = parsed.errors.length ? `${parsed.errors.length}件の入力エラー` : '時間割に未反映';
    save();
  }
  function applyEditor(quiet = false) {
    const day = dayFor(activeDate);
    const draft = $('planInput').value, parsed = P.parsePlan(draft, day.tasks);
    if (parsed.errors.length) {
      $('alertBox').classList.remove('hidden');
      $('alertBox').textContent = parsed.errors.join('\n');
      $('dirtyLabel').textContent = '入力を修正してください';
      $('alertBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    day.text = draft;
    day.wake = $('wakePicker').value || '07:00';
    day.tasks = parsed.tasks;
    day.appliedText = draft; day.appliedWake = day.wake;
    $('dirtyLabel').textContent = '';
    save(); render();
    if (!quiet) toast('時間割を更新しました');
    return true;
  }
  function isStudy(name) { return /数学|英語|物理|化学|国語|地理|歴史|勉強|復習|問題|読書|TOEIC|単語|演習/i.test(name); }
  function render() {
    const day = dayFor(activeDate), prev = relevantPrevTasks(activeDate);
    const plan = P.allocate(day.tasks, day.wake, prev);
    appliedSchedule = plan;
    const scheduledFlex = day.tasks.filter(t => t.kind === 'flex');
    $('studyTotal').innerHTML = `${Math.floor(plan.studyMinutes / 60) ? `${Math.floor(plan.studyMinutes / 60)}<small>時間</small>${plan.studyMinutes % 60 ? `${plan.studyMinutes % 60}<small>分</small>` : ''}` : `${plan.studyMinutes}<small>分</small>`}`;
    $('flexTotal').innerHTML = `${plan.flexCount}<small>件</small>`;
    $('completionSub').textContent = `完了 ${plan.completed} / ${plan.flexCount} 件`;
    const overflowMinutes = plan.overflow.reduce((s, t) => s + t.minutes, 0);
    $('overflowTotal').innerHTML = `${overflowMinutes}<small>分</small>`;
    const alert = plan.warnings;
    $('alertBox').classList.toggle('hidden', !alert.length);
    if (alert.length) $('alertBox').textContent = alert.join('\n');
    const list = $('timeline');
    if (!plan.segments.length) {
      list.innerHTML = '<div class="empty-timeline">予定がありません。入力欄から時間割を作りましょう。</div>';
    } else {
      const taskMap = new Map(scheduledFlex.map(task => [task.id, task]));
      const minutesNow = new Date().getHours() * 60 + new Date().getMinutes();
      list.innerHTML = plan.segments.map(e => {
        const isFlex = e.type === 'flex';
        const task = isFlex ? taskMap.get(e.id) : null;
        const time = isFlex ? `${P.formatMin(e.start)} – ${P.formatMin(e.end)}` : `${e.displayStart} – ${e.displayEnd}`;
        const active = activeDate === nowDate() && e.start <= minutesNow && minutesNow < e.end;
        const desc = !isFlex ? (e.isPrev ? '前日から続く固定予定' : 'この時間は動かしません')
          : `${e.parts > 1 ? `${e.part}/${e.parts} 回目 · ` : ''}${e.end - e.start}分${task.extra ? ` · 合計${e.total}分` : ''}${task.delay ? ` · 開始を${task.delay}分調整` : ''}${task.done && task.actualEnd !== null ? ` · 実際の終了 ${P.formatMin(task.actualEnd)}` : ''}`;
        const controls = isFlex && e.part === 1 ? `<div class="event-actions" role="group" aria-label="${safeText(e.name)}の調整">
          <button class="small-action" data-action="delay" data-id="${safeText(e.id)}" data-amount="5" title="この予定と後続を5分遅らせる">+5分遅らせる</button>
          <button class="small-action" data-action="delay" data-id="${safeText(e.id)}" data-amount="10" title="この予定と後続を10分遅らせる">+10分</button>
          <button class="small-action" data-action="extend" data-id="${safeText(e.id)}" data-amount="5" title="作業時間を5分長くする">+5分延長</button>
          <button class="small-action ${task.done ? 'undo' : 'finish'}" data-action="done" data-id="${safeText(e.id)}">${task.done ? '完了を取り消す' : '✓ 完了'}</button>
          ${task.delay || task.extra ? `<button class="small-action" data-action="reset" data-id="${safeText(e.id)}">調整を元に戻す</button>` : ''}
          </div>` : '';
        return `<div class="timeline-entry ${isFlex ? 'flex-entry' : ''}"><div class="timeline-hour">${P.formatMin(e.start)}</div><div class="timeline-marker"></div><article class="event-card ${isFlex ? 'flex-card' : ''} ${isFlex && isStudy(e.name) ? 'is-study' : ''} ${isFlex && task.done ? 'is-done' : ''}"><div class="event-top"><span class="event-time">${time}${active ? ' · 現在' : ''}</span><span class="event-kind ${isFlex ? 'flex-kind' : ''}">${isFlex ? '可動' : '固定'}</span></div><div class="event-title">${safeText(e.name)}</div><p class="event-subtitle">${safeText(desc)}</p>${controls}</article></div>`;
      }).join('');
    }
    const canCarry = plan.overflow.filter(t => !state.carryLog[activeDate + '|' + t.id]);
    $('overflowPanel').classList.toggle('hidden', !overflowMinutes);
    if (overflowMinutes) {
      $('overflowText').textContent = plan.overflow.map(t => `${t.name} ${minutesLabel(t.minutes)}${state.carryLog[activeDate + '|' + t.id] ? '（繰り越し済み）' : ''}`).join('、');
      $('carryButton').disabled = !canCarry.length;
      $('carryButton').textContent = canCarry.length ? '残りを翌日に繰り越す →' : 'すべて繰り越し済み';
    }
  }
  function applyAction(action, id, amount) {
    const day = dayFor(activeDate), task = day.tasks.find(t => t.id === id && t.kind === 'flex');
    if (!task) return;
    if (action === 'delay') task.delay = Math.min(1440, task.delay + amount);
    else if (action === 'extend') task.extra = Math.min(1440, task.extra + amount);
    else if (action === 'reset') { task.delay = 0; task.extra = 0; }
    else if (action === 'done') {
      if (task.done) { task.done = false; task.actualEnd = null; }
      else {
        task.done = true;
        if (activeDate === nowDate()) {
          const time = new Date();
          const now = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
          const answer = prompt(`${task.name} の実際の終了時刻（必要に応じて変更）\n空欄にすると終了時刻は反映しません。`, now);
          if (answer === null) { task.done = false; return; }
          if (answer.trim()) {
            const mins = P.toMin(answer.trim());
            if (mins === null) { task.done = false; toast('時刻は 18:30 の形式で入力してください'); return; }
            task.actualEnd = mins;
          } else task.actualEnd = null;
        }
      }
    }
    save(); render();
  }
  function carryOver() {
    if (!appliedSchedule) return;
    const eligible = appliedSchedule.overflow.filter(t => !state.carryLog[activeDate + '|' + t.id]);
    if (!eligible.length) { toast('繰り越す予定はありません'); return; }
    const nextDate = P.addDays(activeDate, 1);
    const next = dayFor(nextDate);
    const additions = eligible.map(t => `${t.name} ${t.minutes}`).join('\n');
    const match = next.text.match(/【可動】/);
    if (match) {
      const index = match.index + match[0].length;
      // Insert at top of next day's flexible list so rollover is not silently pushed to the end.
      next.text = next.text.slice(0, index) + `\n# ${activeDate} からの繰り越し\n${additions}` + next.text.slice(index);
    } else next.text += `\n【可動】\n# ${activeDate} からの繰り越し\n${additions}`;
    const parsed = P.parsePlan(next.text, next.tasks);
    if (parsed.errors.length) { toast('翌日の計画に入力エラーがあるため、繰り越せません'); return; }
    next.tasks = parsed.tasks;
    next.appliedText = next.text; next.appliedWake = next.wake;
    for (const task of eligible) state.carryLog[activeDate + '|' + task.id] = nextDate;
    save(); render();
    toast(`${eligible.length}件を${nextDate}へ繰り越しました`);
  }
  function saveTemplate(scope) {
    const parsed = P.parsePlan($('planInput').value);
    if (parsed.errors.length) { toast('テンプレートを保存する前に入力エラーを修正してください'); return; }
    const template = { text: $('planInput').value, wake: $('wakePicker').value || '07:00' };
    if (scope === 'weekday') {
      const w = P.weekday(activeDate);
      state.weekdays[w] = template;
      toast(`毎週${['日','月','火','水','木','金','土'][w]}曜日の基本形に保存しました`);
    } else { state.global = template; toast('毎日の基本形に保存しました'); }
    save();
  }
  function downloadBackup() {
    state.days[activeDate].text = $('planInput').value;
    state.days[activeDate].wake = $('wakePicker').value;
    save();
    const blob = new Blob([JSON.stringify({ app:'Flowday', ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url;
    link.download = `flowday-backup-${nowDate()}.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  async function importBackup(file) {
    try {
      if (file.size > 5_000_000) { toast('ファイルが大きすぎます（上限5MB）'); return; }
      const incoming = JSON.parse(await file.text());
      if (incoming.app !== 'Flowday' || incoming.version !== 1 || !incoming.days || !incoming.global || typeof incoming.days !== 'object')
        throw Error('Flowdayのバックアップ形式ではありません。');
      if (!confirm('今の端末に保存されている予定を、読み込んだバックアップで置き換えます。続行しますか？')) return;
      state = { version:1, global:incoming.global, weekdays:incoming.weekdays || {}, days:incoming.days, carryLog:incoming.carryLog || {} };
      if (save()) { showDay(activeDate); toast('バックアップを読み込みました'); }
    } catch(error) { toast(error.message || 'バックアップを読み込めませんでした'); }
  }
  $('datePicker').addEventListener('change', e => { if (e.target.value) showDay(e.target.value); });
  document.querySelectorAll('.date-shortcut').forEach(b => b.addEventListener('click', () => showDay(b.dataset.date === 'today' ? nowDate() : tomorrowDate())));
  $('planInput').addEventListener('input', currentEditorToDraft);
  $('wakePicker').addEventListener('change', currentEditorToDraft);
  $('applyButton').addEventListener('click', () => applyEditor());
  $('weekdayTemplateButton').addEventListener('click', () => saveTemplate('weekday'));
  $('globalTemplateButton').addEventListener('click', () => saveTemplate('global'));
  $('reloadTemplateButton').addEventListener('click', () => {
    if (!confirm('この日の入力欄をテンプレートで上書きします。現在の入力内容を置き換えますか？')) return;
    const template = templateFor(activeDate);
    $('planInput').value = template.text;
    $('wakePicker').value = template.wake || '07:00';
    currentEditorToDraft(); applyEditor(true); toast('テンプレートを読み込みました');
  });
  $('timeline').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (button) applyAction(button.dataset.action, button.dataset.id, Number(button.dataset.amount) || 0);
  });
  $('carryButton').addEventListener('click', carryOver);
  $('exportButton').addEventListener('click', downloadBackup);
  $('importButton').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async e => { const file = e.target.files[0]; if (file) await importBackup(file); e.target.value = ''; });
  const dialog = $('helpDialog');
  $('helpButton').addEventListener('click', () => dialog.showModal());
  $('closeHelp').addEventListener('click', () => dialog.close());
  $('okHelp').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  showDay(activeDate);
  // Update the 'current' indicator while app is open (not a background notification).
  setInterval(() => { if (activeDate === nowDate()) render(); }, 60_000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:')
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Offline cache unavailable', e)));
})();
