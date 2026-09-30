const assert = require('node:assert/strict');
const P = require('../planner.js');

// Normal scheduled study may be split around a hard appointment.
{
 const parsed = P.parsePlan(`【固定】\n睡眠 23:30-07:00\n学校 09:00-16:00\n【可動】\n数学 120 @08:00\n英語 60`);
 assert.deepEqual(parsed.errors, []);
 const result = P.allocate(parsed.tasks, '07:00');
 assert.deepEqual(result.segments.filter(s => s.type === 'flex').map(s => [s.name,s.start,s.end]),
  [['数学',480,540], ['数学',960,1020],['英語',1020,1080]]);
 assert.equal(result.fixedMinutes, 450);
 assert.equal(result.studyMinutes, 180);
 assert.deepEqual(result.overflow, []);
}
// A +10 start delay applies to the chosen task and cascades to later flexible tasks.
{
 const tasks = P.parsePlan('【固定】\n学校 09:00-16:00\n【可動】\n数学 120 @08:00\n英語 60').tasks;
 tasks.find(t => t.name === '数学').delay = 10;
 let r = P.allocate(tasks);
 assert.deepEqual(r.segments.filter(s => s.type === 'flex').map(s => [s.name,s.start,s.end]),
  [['数学',490,540],['数学',960,1030],['英語',1030,1090]]);
 tasks.find(t => t.name === '数学').extra = 5;
 r = P.allocate(tasks);
 assert.equal(r.segments.find(s => s.name === '英語').start,1035);
}
// Overnight previous-day sleep blocks the next morning.
{
 const prev = P.parsePlan('【固定】\n睡眠 23:30-07:00').tasks;
 const curr = P.parsePlan('【固定】\n学校 09:00-11:00\n【可動】\n数学 60 @06:00').tasks;
 const r = P.allocate(curr,'05:30',prev);
 assert.equal(r.segments.find(s => s.type === 'flex').start,420);
 assert.equal(r.segments.find(s => s.isPrev).displayEnd,'07:00');
}
// A task that cannot fit before bedtime is not silently placed inside fixed time.
{
 const tasks = P.parsePlan('【固定】\n睡眠 21:00-07:00\n【可動】\n数学 180 @20:30').tasks;
 const r = P.allocate(tasks);
 assert.deepEqual(r.segments.filter(s => s.type === 'flex').map(s => [s.start,s.end]),[[1230,1260]]);
 assert.equal(r.overflow[0].minutes,150);
}
// Done task finishing late moves the following flexible task later.
{
 const tasks = P.parsePlan('【可動】\n数学 60 @08:00\n英語 60').tasks;
 tasks[0].done = true;tasks[0].actualEnd = 10*60+15;
 const r = P.allocate(tasks);
 assert.equal(r.segments.find(s=>s.name==='英語').start,615);
}
// Invalid input is reported with line numbers; old task adjustments survive text edits.
{
 const p = P.parsePlan('【固定】\n学校 09:00-09:00\n【可動】\n数学 1.5h @17:00\n服薬 0');
 assert.equal(p.errors.length,2);
 assert.equal(p.tasks[0].duration,90);
 p.tasks[0].delay=15;
 const q = P.parsePlan('【可動】\n数学 120 @18:00',p.tasks);
 assert.equal(q.tasks[0].delay,15);
}
{
 const p = P.parsePlan('【固定】\n学校 09:00-12:00\n面談 11:00-13:00');
 assert.equal(P.allocate(p.tasks).warnings.length,1);
 assert.equal(P.formatMin(1440),'翌00:00');
 assert.equal(P.addDays('2026-12-31',1),'2027-01-01');
}
console.log('✓ Seven planner test cases passed');
