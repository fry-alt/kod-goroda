// Радар стажировки · модуль «Отчёты» для HR.
// Данные — по API-контракту из CLAUDE.md (GET /api/overview, GET /api/interns/{id}), при недоступности — моки web/mock/p{2,3,4,6}.
// Фронт аналитику не считает: только фильтрует, группирует и усредняет то, что отдал бэк, для подписи графиков.
// URL: ?tpl=program|dept|status|intern&dept=HR-блок&id=СТ-004&period=4  (+ ?api=… и ?mock=N как на дашборде)
(() => {
'use strict';

// ---------- адрес бэка и моки: та же логика, что в index.html ----------
const qs = new URLSearchParams(location.search);
const API = (() => { let a = qs.get('api'); try { if(a) localStorage.setItem('radar.api', a); else a = localStorage.getItem('radar.api'); } catch {}
  return (a || window.RADAR_API || '').replace(/\/$/, ''); })();
const STATIC_HOST = /vercel\.app$|netlify\.app$|github\.io$/.test(location.hostname) && !API;
const MOCKS = [2, 3, 4, 6];

const ST = {red:'Критично', yellow:'Внимание', green:'Положительно', grey:'Нет данных'};
const ORDER = {red:0, yellow:1, grey:2, green:3};
const TPL = {
  program: {name:'Сводка по программе', file:'Сводка'},
  dept:    {name:'Отчёт по подразделению', file:'Подразделение'},
  status:  {name:'Критичные и зона внимания', file:'Статус'},
  intern:  {name:'Карточка стажёра для встречи 1:1', file:'Стажёр'},
};
const HEX = {blue:'008AE0', navy:'134074', orange:'FF7654', red:'E5484D', yellow:'F5A623', green:'2BAE66', muted:'829CB5', line:'D9E5F1', soft:'F2F7FC', grey:'C5D3E2'};
const C = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, '#' + v]));
const STC = {red:C.red, yellow:C.yellow, green:C.green, grey:C.grey};

const R = {mock:null, periods:[], period:null, last:null, tpl:'program', dept:null, id:null,
           base:null, cards:{}, m:null, charts:{}, token:0, logo:null};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = v => v == null || v === '' || Number.isNaN(v) ? '—' : (typeof v === 'number' ? v.toFixed(1) : String(v)).replace('.', ',');
const sgn = v => v == null ? '—' : (v > 0 ? '+' : '') + fmt(v);
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const avg = a => { const x = a.filter(v => typeof v === 'number' && !Number.isNaN(v)); return x.length ? r1(x.reduce((s, v) => s + v, 0) / x.length) : null; };
const pad = n => String(n).padStart(2, '0');
const dateISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateRu = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;

// ---------- загрузка ----------
async function getJSON(url){ const r = await fetch(url, {cache:'no-store'}); if(!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }
function mockDir(p){ const want = p || 6; return 'mock/p' + (MOCKS.filter(m => m <= want).pop() || MOCKS[0]); }
async function loadOverview(p){
  if(R.mock) return getJSON(`${mockDir(p)}/overview.json`);
  try { return await getJSON(API + '/api/overview' + (p ? `?period=${p}` : '')); }
  catch(e){ R.mock = 'auto'; banner(); return getJSON(`${mockDir(p)}/overview.json`); }
}
async function loadIntern(id, p){
  const key = `${R.mock ? 'm' : 'a'}:${p}:${id}`;
  if(!R.cards[key]) R.cards[key] = (R.mock
      ? getJSON(`${mockDir(p)}/intern_${id}.json`)
      : getJSON(API + `/api/interns/${encodeURIComponent(id)}` + (p ? `?period=${p}` : ''))
    ).catch(e => { delete R.cards[key]; console.warn('Карточка не загрузилась', id, e); return null; });
  return R.cards[key];
}
function banner(){ const b = $('mockbar'); b.hidden = !R.mock;
  b.textContent = R.mock === 'auto' ? 'Нет связи с сервером — отчёт собран по сохранённым данным' : `Демо-данные · срез на Месяц ${R.period || ''}`; }

// ---------- модель отчёта ----------
async function buildModel(){
  const p = R.period, ov = await loadOverview(p);
  const cur = ov.current_period || p;
  const all = [...(ov.interns || [])].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || a.intern_id.localeCompare(b.intern_id));
  const depts = [...new Set((ov.interns || []).map(i => i.department).filter(Boolean))];
  if(R.tpl === 'dept' && !depts.includes(R.dept)) R.dept = depts[0] || null;
  if(R.tpl === 'intern' && !all.some(i => i.intern_id === R.id)) R.id = all[0]?.intern_id || null;

  let set = all, filter = 'Все стажёры программы';
  if(R.tpl === 'dept'){ set = all.filter(i => i.department === R.dept); filter = R.dept || '—'; }
  if(R.tpl === 'status'){ set = all.filter(i => i.status === 'red' || i.status === 'yellow'); filter = 'Статусы «Критично» и «Внимание»'; }
  if(R.tpl === 'intern'){ set = all.filter(i => i.intern_id === R.id); const i = set[0]; filter = i ? `${i.intern_id} · наставник ${i.mentor_id} · ${i.department}` : '—'; }

  const cardsArr = await Promise.all(set.map(i => loadIntern(i.intern_id, p)));
  const cards = Object.fromEntries(set.map((i, k) => [i.intern_id, cardsArr[k]]));

  // кто ответил за текущий месяц
  const ss = Object.fromEntries((ov.survey_status || []).map(r => [r.intern_id, r]));
  const done = (id, who) => !!(((ss[id] || {}).periods || {})[cur] || {})[who];
  const cnt = s => set.filter(i => i.status === s).length;
  const kpi = (R.tpl === 'program' && ov.kpi) ? {...ov.kpi} : {
    responded_interns: `${set.filter(i => done(i.intern_id, 'intern')).length}/${set.length}`,
    responded_mentors: `${set.filter(i => done(i.intern_id, 'mentor')).length}/${set.length}`,
    red: cnt('red'), yellow: cnt('yellow'), green: cnt('green')};

  // сигналы: основания + цитаты (если бэк не положил quote — берём комментарии того месяца, где сработал сигнал)
  const signals = [];
  for(const i of set){
    const c = cards[i.intern_id]; if(!c) continue;
    for(const s of c.signals || []) signals.push({intern:i, s, ev:groupEvidence(s.evidence || [], cur), quotes:quotesFor(s, c)});
  }
  signals.sort((a, b) => (a.s.level === 'red' ? 0 : 1) - (b.s.level === 'red' ? 0 : 1) || a.intern.intern_id.localeCompare(b.intern.intern_id));

  // действия: от бэка; если бэк их не дал — шаблонные формулировки по статусу (помечены)
  const actions = [];
  for(const i of set){
    const c = cards[i.intern_id];
    const own = (c?.actions || []).filter(Boolean);
    if(own.length) own.forEach(a => actions.push({who:i.intern_id, text:a}));
    else if(i.status === 'red' || i.status === 'yellow'){
      const top = (c?.signals || [])[0]?.title || i.reason || 'сигнал по анкетам';
      actions.push({who:i.intern_id, tpl:true, text: i.status === 'red'
        ? `Встреча 1:1 со стажёром ${i.intern_id} на этой неделе; обсудить с наставником ${i.mentor_id}: «${top}»`
        : `Уточнить у ${i.intern_id} на ближайшей встрече: «${top}»; проверить в следующем месяце`});
    }
  }
  const missing = set.flatMap(i => [!done(i.intern_id, 'intern') ? `${i.intern_id} (стажёр)` : null,
                                    !done(i.intern_id, 'mentor') ? `${i.mentor_id} (наставник ${i.intern_id})` : null]).filter(Boolean);
  if(missing.length) actions.push({who:'опросы', tpl:true, text:`Напомнить о заполнении анкеты за Месяц ${cur}: ${missing.join(', ')}`});
  for(const t of (R.tpl === 'program' ? ov.themes || [] : []))
    actions.push({who:'программа', text:`Повторяется у ${(t.interns || []).join(', ')}: «${t.topic}» — решить на уровне программы`});

  const periods = (ov.periods || []).filter(x => x <= cur);
  const charts = chartSpecs({ov, set, cards, periods, cur});
  return {ov, cur, set, all, cards, depts, kpi, filter, signals, actions, missing, periods, charts, ss, done,
          title: TPL[R.tpl].name, at: new Date(), src: R.mock ? 'демо-данные (без связи с сервером)' : 'API Радара'};
}

function groupEvidence(ev, cur){
  const g = new Map();
  for(const e of ev){ const k = `${e.source}|${e.field}`; if(!g.has(k)) g.set(k, {source:e.source, field:e.field, pts:[]}); g.get(k).pts.push(e); }
  return [...g.values()].map(x => ({...x, pts: x.pts.sort((a, b) => a.period - b.period)}));
}
function quotesFor(s, card){
  const ev = s.evidence || [], out = [];
  ev.filter(e => e.quote).forEach(e => out.push({source:e.source, period:e.period, text:e.quote}));
  if(out.length) return out.slice(0, 3);
  const p = Math.max(...ev.map(e => e.period).filter(Number.isFinite));
  const per = (card.periods || []).find(x => x.period === p);
  if(!per) return out;
  for(const src of new Set(ev.map(e => e.source))){
    const key = /настав/i.test(src) ? 'mentor' : 'intern';
    // по одному комментарию от каждой стороны: сначала поля про сложности / что мешает / ситуации для внимания
    const ent = Object.entries((per.comments || {})[key] || {}).filter(([, v]) => v && String(v).trim());
    const pick = ent.find(([f]) => /сложн|меша|вниман/i.test(f)) || ent[0];
    if(pick) out.push({source:src, period:p, field:pick[0], text:pick[1], derived:true});
  }
  return out.slice(0, 2);
}

// ---------- спецификации графиков (общие для Chart.js и PowerPoint) ----------
function chartSpecs({ov, set, cards, periods, cur}){
  const labels = periods.map(p => 'М' + p);
  const byP = (id, p, k) => ((cards[id]?.periods || []).find(x => x.period === p) || {})[k];
  const dyn = {title: R.tpl === 'intern' ? 'Средняя оценка по месяцам: стажёр и наставник' : 'Средняя оценка по месяцам: стажёры и наставники',
    kind:'line', labels, yMin:1, yMax:5, legend:true,
    series:[{name:'Стажёр', color:HEX.blue, values: periods.map(p => avg(set.map(i => byP(i.intern_id, p, 'intern_avg'))))},
            {name:'Наставник', color:HEX.navy, dash:true, values: periods.map(p => avg(set.map(i => byP(i.intern_id, p, 'mentor_avg'))))}]};
  if(R.tpl === 'intern'){
    const c = cards[set[0]?.intern_id] || {}, last = (c.periods || []).find(x => x.period === cur) || (c.periods || []).at(-1) || {};
    const pairs = (c.pairs || []).map(pr => ({n: shortName(pr.intern), v: pr.by_period[(c.periods || []).indexOf(last)] || pr.by_period.at(-1) || []}));
    const ind = Object.entries(last.intern || {});
    return {
      status: {title:`Пары «стажёр ↔ наставник», Месяц ${last.period ?? cur}`, kind:'bar', labels: pairs.map(x => x.n), yMin:0, yMax:5, legend:true,
               series:[{name:'Стажёр', color:HEX.blue, values: pairs.map(x => x.v[0] ?? null)}, {name:'Наставник', color:HEX.navy, values: pairs.map(x => x.v[1] ?? null)}]},
      dyn,
      dept: {title:`Оценки стажёра за Месяц ${last.period ?? cur}`, kind:'hbar', labels: ind.map(([k]) => shortName(k)), yMin:0, yMax:5, legend:false,
             series:[{name:'Оценка', color:HEX.blue, colors: ind.map(([, v]) => v <= 2 ? HEX.red : v < 4 ? HEX.yellow : HEX.blue), values: ind.map(([, v]) => v)}]},
    };
  }
  const st = ['red', 'yellow', 'green'];
  const groupKey = R.tpl === 'dept' ? 'intern_id' : 'department';
  const groups = [...new Set(set.map(i => i[groupKey]))];
  return {
    status: {title:'Стажёры по статусам', kind:'bar', labels: st.map(s => ST[s]), yMin:0, legend:false, integer:true,
             series:[{name:'Стажёров', colors: st.map(s => HEX[s]), values: st.map(s => set.filter(i => i.status === s).length)}]},
    dyn,
    dept: {title: R.tpl === 'dept' ? `Средние оценки по стажёрам, Месяц ${cur}` : `Средние оценки по подразделениям, Месяц ${cur}`,
           kind:'bar', labels: groups.map(g => R.tpl === 'dept' ? g : shortDept(g)), yMin:0, yMax:5, legend:true,
           series:[{name:'Стажёр', color:HEX.blue, values: groups.map(g => avg(set.filter(i => i[groupKey] === g).map(i => i.intern_avg)))},
                   {name:'Наставник', color:HEX.navy, values: groups.map(g => avg(set.filter(i => i[groupKey] === g).map(i => i.mentor_avg)))}]},
  };
}
const wrapLabel = (s, n) => { const out = []; let cur = '';
  for(const w of String(s).split(/\s+/)){ if(cur && (cur + ' ' + w).length > n){ out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if(cur) out.push(cur); return out.length > 1 ? out : String(s); };
const shortDept = d => String(d || '').replace(/\s*блок$/i, '').replace(/-$/, '') || d;
const shortName = s => { s = String(s || ''); return s.length > 26 ? s.slice(0, 25).replace(/\s+\S*$/, '') + '…' : s; };

// ---------- предпросмотр ----------
function pill(s){ return `<span class="pill p-${s || 'grey'}"><span class="dot d-${s || 'grey'}"></span>${ST[s] || ST.grey}</span>`; }
function render(m){
  const intern = R.tpl === 'intern' ? m.set[0] : null, card = intern ? m.cards[intern.intern_id] : null;
  const k = m.kpi;
  const kp = (v, l, cls = '', dot = '') => `<div class="kpi ${cls}"><div class="v">${esc(v ?? '—')}</div><div class="l">${dot ? `<span class="dot d-${dot}"></span>` : ''}${l}</div></div>`;
  const kpis = intern
    ? kp(done(m, intern, 'intern') ? 'да' : 'нет', 'Анкета стажёра') + kp(done(m, intern, 'mentor') ? 'да' : 'нет', 'Анкета наставника')
      + kp(fmt(intern.intern_avg), 'Ср. оценка стажёра') + kp(fmt(intern.mentor_avg), 'Ср. оценка наставника')
      + kp(ST[intern.status] || '—', 'Статус', intern.status, intern.status)
    : kp(k.responded_interns, 'Ответили стажёры') + kp(k.responded_mentors, 'Ответили наставники')
      + kp(k.red ?? 0, 'Критично', 'red', 'red') + kp(k.yellow ?? 0, 'Внимание', 'yellow', 'yellow') + kp(k.green ?? 0, 'Положительно', 'green', 'green');

  const chart = (key, wide) => `<div class="chart ${wide ? 'wide' : ''}"><h3>${esc(m.charts[key].title)}</h3>
    <div class="cv"><canvas id="ch-${key}" role="img" aria-label="${esc(m.charts[key].title)}"></canvas></div><img class="pimg" id="img-${key}" alt=""></div>`;

  const rows = m.set.map(i => `<tr>
      <td class="id">${esc(i.intern_id)}<small>${esc(i.mentor_id)}</small></td><td>${esc(i.department)}</td><td>${pill(i.status)}</td>
      <td class="reason">${esc(i.reason || '—')}</td><td class="r">${fmt(i.intern_avg)}</td><td class="r">${fmt(i.mentor_avg)}</td>
      <td class="r">${sgn(i.gap)}</td><td class="r">${sgn(i.trend)}</td><td class="r">${i.signals ?? 0}</td></tr>`).join('');
  const table = m.set.length ? `<table class="t fixed"><colgroup><col style="width:10.5%"><col style="width:17%"><col style="width:17%"><col style="width:21.5%">${'<col style="width:6.8%">'.repeat(5)}</colgroup>
      <thead><tr><th>Стажёр</th><th>Подразделение</th><th>Статус</th><th>Причина</th>
      <th class="r" title="Средняя оценка стажёра">Стаж.</th><th class="r" title="Средняя оценка наставника">Наст.</th><th class="r" title="Разрыв стажёр − наставник">Разр.</th><th class="r" title="Динамика к прошлому месяцу">Дин.</th><th class="r">Сигн.</th></tr></thead>
      <tbody>${rows}</tbody></table>` : `<div class="empty">На Месяц ${m.cur} в этой категории стажёров нет</div>`;

  const sigs = m.signals.length ? m.signals.map(({intern:i, s, ev, quotes}) => `<div class="sig ${s.level === 'red' ? 'red' : ''}">
      <div class="h">${pill(s.level)}<span class="who">${esc(i.intern_id)}</span><b>${esc(s.title)}</b></div>
      ${s.why ? `<p class="why">${esc(s.why)}</p>` : ''}
      ${ev.length ? `<ul class="ev">${ev.map(g => `<li>${esc(g.field)} <span class="mut">(${esc(g.source)})</span>: ${g.pts.map(e =>
          `М${e.period} ${e.period === m.cur ? `<em>${esc(fmtVal(e.value))}</em>` : esc(fmtVal(e.value))}`).join(' · ')}</li>`).join('')}</ul>` : ''}
      ${quotes.map(q => `<q><small>${q.derived ? 'Комментарий' : 'Цитата'} · ${esc(q.source)} · М${q.period}${q.field ? ' · ' + esc(q.field) : ''}</small>«${esc(q.text)}»</q>`).join('')}
    </div>`).join('') : `<div class="empty">Сигналов на Месяц ${m.cur} нет</div>`;

  const acts = m.actions.length ? `<ol class="acts">${m.actions.map(a => `<li><span>${esc(a.text)}${a.tpl ? ' <small>· типовая рекомендация</small>' : ''}</span></li>`).join('')}</ol>`
    : `<div class="empty">Действий не требуется — продолжать плановые встречи</div>`;

  let extra = '';
  if(intern && card){
    const P = (card.periods || []);
    const names = [...new Set(P.flatMap(p => Object.keys(p.intern || {})))], mnames = [...new Set(P.flatMap(p => Object.keys(p.mentor || {})))];
    const cell = (v, p) => `<td class="r ${p === m.cur ? 'cur' : ''} ${typeof v === 'number' && v <= 2 ? 'low' : ''}">${v ?? '—'}</td>`;
    const block = (title, list, who) => `<tr><td colspan="${P.length + 1}" style="background:var(--mgts-bg-soft);font-weight:700">${title}</td></tr>`
      + list.map(n => `<tr><td>${esc(n)}</td>${P.map(p => cell((p[who] || {})[n], p.period)).join('')}</tr>`).join('');
    const last = P.find(p => p.period === m.cur) || P.at(-1) || {};
    const cm = (who, t) => `<div class="cm"><b>${t}</b>${Object.entries((last.comments || {})[who] || {}).map(([f, v]) => `<p><span class="mut">${esc(f)}:</span> ${esc(v || '—')}</p>`).join('') || '<p>—</p>'}</div>`;
    const ca = last.comment_analysis || {};
    extra = `
      <section class="sec"><h2>Резюме для HR</h2><div class="summary">${esc(card.summary || intern.reason || '—')}</div></section>
      <section class="sec"><h2>Оценки по месяцам <small>1–5, текущий месяц выделен</small></h2>
        <table class="t"><thead><tr><th>Показатель</th>${P.map(p => `<th class="r">М${p.period}</th>`).join('')}</tr></thead><tbody>
        ${block('Стажёр', names, 'intern')}${block('Наставник', mnames, 'mentor')}
        <tr><td><b>Средняя стажёра / наставника</b></td>${P.map(p => `<td class="r ${p.period === m.cur ? 'cur' : ''}">${fmt(p.intern_avg)} / ${fmt(p.mentor_avg)}</td>`).join('')}</tr>
        </tbody></table></section>
      <section class="sec"><h2>Комментарии за Месяц ${last.period ?? m.cur}
          <small>${ca.topics?.length ? 'темы: ' + esc(ca.topics.join(', ')) + ' · ' : ''}${ca.tone && ca.tone !== '—' ? 'тон: ' + esc(ca.tone) : ''}${ca.risk ? ' · есть риск' : ''}</small></h2>
        <div class="cms">${cm('intern', 'Стажёр')}${cm('mentor', 'Наставник ' + esc(intern.mentor_id))}</div></section>`;
  }

  $('sheet').innerHTML = `
    <header class="dh"><img src="brand/logos/logo1.svg" alt="МГТС">
      <div><div class="k">МГТС · Радар стажировки</div><h1>${esc(m.title)}</h1><div class="f">${esc(m.filter)}</div></div>
      <div class="meta"><b>Срез на Месяц ${m.cur}</b>Сформировано ${dateRu(m.at)}</div></header>
    <section class="kpis">${kpis}</section>
    ${intern && !card ? '<div class="empty" style="margin-top:16px">Карточка стажёра не загрузилась — показаны данные из обзора</div>' : ''}
    <section class="sec"><div class="charts">${intern ? chart('dyn') + chart('dept') + chart('status', true) : chart('status') + chart('dyn') + chart('dept', true)}</div></section>
    ${intern ? extra : `<section class="sec"><h2>Стажёры <small>${m.set.length} чел. · средние оценки за Месяц ${m.cur}, шкала 1–5</small></h2>${table}</section>`}
    <section class="sec"><h2>Ключевые сигналы <small>с основаниями: оценки и комментарии</small></h2><div class="sigs">${sigs}</div></section>
    <section class="sec"><h2>Рекомендованные действия</h2>${acts}</section>
    <footer class="df"><span>Источник: анкеты стажёров и наставников · ${esc(m.src)}</span><span>Решение о человеке принимает HR; система даёт сигнал и основания.</span></footer>`;
  drawCharts(m);
  $('capInfo').textContent = `${TPL[R.tpl].name} · Месяц ${m.cur}`;
}
const fmtVal = v => v === true ? 'да' : v === false ? 'нет' : v;
const done = (m, i, who) => m.done(i.intern_id, who);

// ---------- Chart.js ----------
const bgPlugin = {id:'whiteBg', beforeDraw(c){ const x = c.ctx; x.save(); x.globalCompositeOperation = 'destination-over'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.restore(); }};
const valuePlugin = {id:'values', afterDatasetsDraw(c){
  const x = c.ctx, hz = c.options.indexAxis === 'y'; if(c.config.type !== 'bar') return;
  x.save(); x.font = `700 11px MTSText, Arial`; x.fillStyle = C.navy;
  c.data.datasets.forEach((ds, di) => c.getDatasetMeta(di).data.forEach((el, k) => {
    const v = ds.data[k]; if(v == null || v === 0) return;
    const t = c.options.plugins.values?.integer ? String(v) : fmt(v);
    if(hz){ x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(t, el.x + 4, el.y); }
    else { x.textAlign = 'center'; x.textBaseline = 'bottom'; x.fillText(t, el.x, el.y - 2); }
  })); x.restore(); }};

function drawCharts(m){
  Object.values(R.charts).forEach(c => c.destroy()); R.charts = {};
  Chart.defaults.font.family = 'MTSText, Arial, sans-serif'; Chart.defaults.color = C.navy;
  for(const [key, sp] of Object.entries(m.charts)){
    const el = $('ch-' + key); if(!el) continue;
    const hz = sp.kind === 'hbar', line = sp.kind === 'line';
    const val = {min: sp.yMin, max: sp.yMax, ticks:{stepSize: sp.integer || line || sp.yMax ? 1 : undefined, precision: 0}, grid:{color:C.line}, border:{display:false}};
    if(!line && !sp.yMax) val.grace = '15%';
    R.charts[key] = new Chart(el, {
      type: line ? 'line' : 'bar',
      data: {labels: line ? sp.labels : sp.labels.map(l => wrapLabel(l, hz ? 22 : 16)), datasets: sp.series.map(s => ({label:s.name, data:s.values,
        backgroundColor: s.colors ? s.colors.map(h => '#' + h) : '#' + s.color, borderColor: '#' + (s.color || HEX.blue),
        borderWidth: line ? 3 : 0, borderDash: s.dash ? [6, 4] : [], borderRadius: line ? 0 : 6, maxBarThickness: 46,
        pointRadius: 4, pointBackgroundColor: '#' + (s.color || HEX.blue), tension: .25, spanGaps: true}))},
      options: {animation:false, responsive:true, maintainAspectRatio:false, devicePixelRatio: Math.max(2, window.devicePixelRatio || 1),
        indexAxis: hz ? 'y' : 'x', layout:{padding:{top: hz ? 0 : 14, right: hz ? 24 : 4}},
        plugins:{legend:{display: !!sp.legend, position:'bottom', labels:{usePointStyle:true, pointStyle:'rectRounded', boxWidth:10, boxHeight:10, font:{size:11}}},
                 tooltip:{callbacks:{label: t => `${t.dataset.label}: ${fmt(t.raw)}`}}, values:{integer: sp.integer}},
        scales: hz ? {x: val, y:{grid:{display:false}, ticks:{font:{size:10.5}}}}
                   : {y: val, x:{grid:{display:false}, ticks:{font:{size: sp.labels.length > 4 ? 10 : 11}, maxRotation:0, autoSkip:false}}}},
      plugins: [bgPlugin, valuePlugin]});
  }
}
function chartImages(){ for(const [k, c] of Object.entries(R.charts)){ const img = $('img-' + k); if(img) img.src = c.toBase64Image('image/png', 1); } }
window.addEventListener('beforeprint', chartImages);

// ---------- управление ----------
function renderControls(){
  document.querySelectorAll('.tpl').forEach(l => { const on = l.dataset.tpl === R.tpl; l.classList.toggle('on', on); l.querySelector('input').checked = on; });
  const avail = R.mock ? MOCKS : R.periods;
  $('months').innerHTML = [1, 2, 3, 4, 5, 6].concat(R.periods.filter(p => p > 6)).map(p =>
    `<button data-p="${p}" class="${p === R.period ? 'on' : ''}" ${avail.includes(p) && R.periods.includes(p) ? '' : 'disabled'}>${p}<small>месяц</small></button>`).join('');
  $('months').querySelectorAll('button:not([disabled])').forEach(b => b.onclick = () => { R.period = +b.dataset.p; update(); });
  $('monthsHint').textContent = R.mock ? 'Демо-режим: доступны сохранённые срезы на месяцы 2, 3, 4 и 6.' : 'Отчёт покажет картину так, как она выглядела на конец выбранного месяца.';
}
function fillSelects(m){
  $('dept').innerHTML = m.depts.map(d => `<option ${d === R.dept ? 'selected' : ''}>${esc(d)}</option>`).join('');
  $('intern').innerHTML = m.all.map(i => `<option value="${esc(i.intern_id)}" ${i.intern_id === R.id ? 'selected' : ''}>${esc(i.intern_id)} · ${esc(i.department)} · ${ST[i.status] || ''}</option>`).join('');
}
function syncURL(){
  const u = new URLSearchParams(location.search);
  ['tpl', 'dept', 'id', 'period'].forEach(k => u.delete(k));
  u.set('tpl', R.tpl); if(R.tpl === 'dept' && R.dept) u.set('dept', R.dept); if(R.tpl === 'intern' && R.id) u.set('id', R.id); u.set('period', R.period);
  history.replaceState(null, '', location.pathname + '?' + u.toString());
  const back = new URLSearchParams(); if(qs.get('mock')) back.set('mock', qs.get('mock'));
  $('back').href = './' + (back.toString() ? '?' + back : '');
}
async function update(){
  const t = ++R.token; renderControls(); $('sheet').classList.add('busy');
  try {
    const m = await buildModel(); if(t !== R.token) return;
    R.m = m; fillSelects(m); render(m); renderControls(); syncURL(); banner();
  } catch(e){ console.error(e); if(t === R.token) $('sheet').innerHTML = `<div class="empty">Не удалось собрать отчёт: ${esc(e.message)}</div>`; }
  finally { if(t === R.token) $('sheet').classList.remove('busy'); }
}

// ---------- выгрузка: общее ----------
function fileName(ext){
  const m = R.m, part = R.tpl === 'dept' ? `${TPL.dept.file}_${R.dept}` : R.tpl === 'intern' ? `${TPL.intern.file}_${R.id}` : TPL[R.tpl].file;
  return `Радар_${part}_Месяц${m.cur}_${dateISO(new Date())}.${ext}`.replace(/[\\/:*?"<>|\s]+/g, '_');
}
function saveBlob(blob, name){
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  window.RadarReport.lastSaved = {name, size: blob.size, type: blob.type};
}
const libs = {};
// библиотеки грузим по требованию: PDF и CSV работают офлайн, Excel и PowerPoint — при наличии интернета
function loadOne(src, globalName){
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => window[globalName] ? ok(window[globalName]) : fail(new Error('библиотека не загрузилась'));
    s.onerror = () => { s.remove(); fail(new Error('нет доступа к CDN — проверьте интернет')); }; document.head.appendChild(s); });
}
function loadScript(srcs, globalName){
  if(window[globalName]) return Promise.resolve(window[globalName]);
  const key = globalName;
  return libs[key] ||= (async () => { let err;
    for(const src of [].concat(srcs)){ try { return await loadOne(src, globalName); } catch(e){ err = e; } }
    delete libs[key]; throw err; })();
}
function say(text, cls = ''){ const el = $('msg'); el.className = 'msg ' + cls; el.textContent = text; }
async function logoData(){
  if(R.logo) return R.logo;
  const img = new Image(); img.src = 'brand/logos/logo1.png'; await img.decode();
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; cv.getContext('2d').drawImage(img, 0, 0, 256, 256);
  return R.logo = cv.toDataURL('image/png');
}
// логотип в колонтитуле печати: @page margin box (Chrome 131+), картинка — SVG-обёртка нужного размера
async function printFooterStyle(){
  $('pageLogo')?.remove();
  try {
    const png = await logoData();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="18" height="18"><image width="18" height="18" href="${png}" xlink:href="${png}"/></svg>`;
    const st = document.createElement('style'); st.id = 'pageLogo';
    st.textContent = `@page{@bottom-left{content:url("data:image/svg+xml;base64,${btoa(svg)}") "  МГТС · Радар стажировки · ${TPL[R.tpl].name} · Месяц ${R.m.cur}";
      font-family:MTSText,Arial,sans-serif;font-size:8.5pt;color:#829CB5;vertical-align:middle}}`;
    document.head.appendChild(st);
  } catch(e){ console.warn('Логотип для колонтитула не подготовлен', e); }
}
const statusRu = s => ST[s] || ST.grey;
const sigText = x => `${x.intern.intern_id} · ${statusRu(x.s.level)}: ${x.s.title}`;
const evText = x => x.ev.map(g => `${g.field} (${g.source}): ${g.pts.map(e => `М${e.period} ${fmtVal(e.value)}`).join(', ')}`).join('; ');
const quoteText = x => x.quotes.map(q => `${q.source}, М${q.period}: «${q.text}»`).join(' ');

// ---------- PDF ----------
async function exportPDF(){
  await printFooterStyle();
  chartImages();
  await Promise.all([...document.querySelectorAll('img.pimg')].map(i => i.decode().catch(() => {})));
  const old = document.title; document.title = fileName('pdf').replace(/\.pdf$/, '');
  window.print(); document.title = old;
  return 'Открыто окно печати — выберите «Сохранить как PDF»';
}

// ---------- Excel ----------
async function exportXLSX(){
  const ExcelJS = await loadScript(['https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'], 'ExcelJS');
  const m = R.m, wb = new ExcelJS.Workbook();
  wb.creator = 'Радар стажировки · МГТС'; wb.created = m.at;
  const BLUE = 'FF' + HEX.blue, font = {name:'Arial', size:11, color:{argb:'FF' + HEX.navy}};
  const head = row => row.eachCell(c => { c.fill = {type:'pattern', pattern:'solid', fgColor:{argb:BLUE}}; c.font = {name:'Arial', bold:true, color:{argb:'FFFFFFFF'}, size:11};
    c.alignment = {vertical:'middle', wrapText:true}; c.border = {bottom:{style:'thin', color:{argb:BLUE}}}; });
  const stFill = (cell, s) => { const col = HEX[s] || HEX.grey; cell.fill = {type:'pattern', pattern:'solid', fgColor:{argb:'FF' + col}};
    cell.font = {name:'Arial', bold:true, color:{argb: s === 'yellow' || !HEX[s] ? 'FF' + HEX.navy : 'FFFFFFFF'}}; cell.alignment = {horizontal:'center', vertical:'middle'}; };
  const table = (ws, cols, rows, statusKey) => {
    ws.columns = cols.map(c => ({header:c.h, key:c.k, width:c.w, style:{font, alignment:{vertical:'top', wrapText: !!c.wrap}, numFmt:c.num}}));
    head(ws.getRow(1)); ws.getRow(1).height = 32;
    rows.forEach(r => { const row = ws.addRow(r); if(statusKey) stFill(row.getCell(statusKey), r._st); });
    ws.autoFilter = {from:{row:1, column:1}, to:{row:1, column:cols.length}};
    ws.views = [{state:'frozen', ySplit:1}];
  };

  // Сводка
  const ws = wb.addWorksheet('Сводка', {views:[{showGridLines:false}], properties:{tabColor:{argb:BLUE}}});
  ws.columns = [{width:30}, {width:22}, {width:4}, {width:14}, {width:14}, {width:14}, {width:14}, {width:14}, {width:14}];
  ws.mergeCells('A1:I1'); const t = ws.getCell('A1');
  t.value = `МГТС · Радар стажировки — ${m.title}`; t.fill = {type:'pattern', pattern:'solid', fgColor:{argb:BLUE}};
  t.font = {name:'Arial', bold:true, size:16, color:{argb:'FFFFFFFF'}}; t.alignment = {vertical:'middle', indent:1}; ws.getRow(1).height = 36;
  const meta = [['Срез', `на Месяц ${m.cur}`], ['Выборка', m.filter], ['Сформировано', dateRu(m.at)], ['Источник', m.src]];
  meta.forEach((r, k) => { const row = ws.getRow(3 + k); row.getCell(1).value = r[0]; row.getCell(2).value = r[1];
    row.getCell(1).font = {name:'Arial', color:{argb:'FF' + HEX.muted}}; row.getCell(2).font = {...font, bold:true}; });
  const kr = ws.getRow(8); kr.values = ['Показатель', 'Значение']; head(kr);
  const kv = [['Ответили стажёры', m.kpi.responded_interns], ['Ответили наставники', m.kpi.responded_mentors],
              ['Критично', m.kpi.red ?? 0, 'red'], ['Внимание', m.kpi.yellow ?? 0, 'yellow'], ['Положительно', m.kpi.green ?? 0, 'green'],
              ['Сигналов', m.signals.length]];
  kv.forEach((r, k) => { const row = ws.getRow(9 + k); row.getCell(1).value = r[0]; row.getCell(2).value = r[1];
    row.getCell(1).font = font; row.getCell(2).font = {...font, bold:true}; row.getCell(2).alignment = {horizontal:'center'};
    if(r[2]) stFill(row.getCell(1), r[2]);
    [1, 2].forEach(c => row.getCell(c).border = {bottom:{style:'thin', color:{argb:'FF' + HEX.line}}}); });
  let y = 16;
  const ar = ws.getRow(y); ar.getCell(1).value = 'Рекомендованные действия'; ar.getCell(1).font = {name:'Arial', bold:true, size:13, color:{argb:BLUE}};
  m.actions.forEach((a, k) => { ws.mergeCells(y + 1 + k, 1, y + 1 + k, 2); const c = ws.getCell(y + 1 + k, 1);
    c.value = `${k + 1}. ${a.text}${a.tpl ? ' (типовая рекомендация)' : ''}`; c.font = font; c.alignment = {wrapText:true, vertical:'top'}; ws.getRow(y + 1 + k).height = 44; });
  if(!m.actions.length) ws.getCell(y + 1, 1).value = 'Действий не требуется';
  // графики картинками
  let iy = 2;
  for(const [k, c] of Object.entries(R.charts)){
    const id = wb.addImage({base64: c.toBase64Image('image/png', 1), extension:'png'});
    const h = k === 'dyn' ? 250 : 240;
    ws.addImage(id, {tl:{col:3, row:iy}, ext:{width:560, height:h}});
    ws.getCell(iy, 4).value = m.charts[k].title; ws.getCell(iy, 4).font = {name:'Arial', bold:true, color:{argb:'FF' + HEX.navy}};
    iy += Math.ceil(h / 20) + 2;
  }

  // Стажёры
  table(wb.addWorksheet('Стажёры'), [
    {h:'ID стажёра', k:'id', w:13}, {h:'Наставник', k:'mentor', w:12}, {h:'Подразделение', k:'dept', w:24}, {h:'Статус', k:'st', w:15},
    {h:'Причина', k:'reason', w:46, wrap:true}, {h:'Ср. оценка стажёра', k:'ia', w:12, num:'0.0'}, {h:'Ср. оценка наставника', k:'ma', w:12, num:'0.0'},
    {h:'Разрыв', k:'gap', w:10, num:'+0.0;-0.0;0.0'}, {h:'Динамика', k:'trend', w:11, num:'+0.0;-0.0;0.0'}, {h:'Сигналов', k:'sig', w:10},
    {h:'Анкета стажёра', k:'si', w:11}, {h:'Анкета наставника', k:'sm', w:12}],
    m.set.map(i => ({id:i.intern_id, mentor:i.mentor_id, dept:i.department, st:statusRu(i.status), _st:i.status, reason:i.reason || '',
      ia:i.intern_avg, ma:i.mentor_avg, gap:i.gap, trend:i.trend, sig:i.signals ?? 0,
      si: m.done(i.intern_id, 'intern') ? 'да' : 'нет', sm: m.done(i.intern_id, 'mentor') ? 'да' : 'нет'})), 'st');

  // Сигналы
  table(wb.addWorksheet('Сигналы'), [
    {h:'ID стажёра', k:'id', w:13}, {h:'Подразделение', k:'dept', w:22}, {h:'Уровень', k:'lvl', w:14}, {h:'Сигнал', k:'title', w:40, wrap:true},
    {h:'Почему', k:'why', w:40, wrap:true}, {h:'Основания (оценки)', k:'ev', w:55, wrap:true}, {h:'Цитаты / комментарии', k:'q', w:60, wrap:true}],
    m.signals.map(x => ({id:x.intern.intern_id, dept:x.intern.department, lvl:statusRu(x.s.level), _st:x.s.level, title:x.s.title, why:x.s.why || '',
      ev:evText(x), q:quoteText(x)})), 'lvl');

  // Ответы по месяцам
  const P = m.periods, names = new Set(), mnames = new Set();
  m.set.forEach(i => (m.cards[i.intern_id]?.periods || []).forEach(p => { Object.keys(p.intern || {}).forEach(n => names.add(n)); Object.keys(p.mentor || {}).forEach(n => mnames.add(n)); }));
  const cols = [{h:'ID стажёра', k:'id', w:13}, {h:'Наставник', k:'mentor', w:12}, {h:'Подразделение', k:'dept', w:22}, {h:'Месяц', k:'p', w:9},
    {h:'Анкета стажёра', k:'si', w:11}, {h:'Анкета наставника', k:'sm', w:12}, {h:'Ср. стажёр', k:'ia', w:11, num:'0.0'}, {h:'Ср. наставник', k:'ma', w:12, num:'0.0'},
    {h:'Разрыв', k:'gap', w:10, num:'+0.0;-0.0;0.0'},
    ...[...names].map((n, k) => ({h:'Стажёр: ' + n, k:'i' + k, w:16})), ...[...mnames].map((n, k) => ({h:'Наставник: ' + n, k:'m' + k, w:16}))];
  const rows = [];
  for(const i of m.set) for(const p of P){
    const per = (m.cards[i.intern_id]?.periods || []).find(x => x.period === p) || {}, s = ((m.ss[i.intern_id] || {}).periods || {})[p] || {};
    const r = {id:i.intern_id, mentor:i.mentor_id, dept:i.department, p, si: s.intern ? 'да' : 'нет', sm: s.mentor ? 'да' : 'нет',
               ia:per.intern_avg ?? null, ma:per.mentor_avg ?? null, gap:per.gap ?? null};
    [...names].forEach((n, k) => r['i' + k] = (per.intern || {})[n] ?? null); [...mnames].forEach((n, k) => r['m' + k] = (per.mentor || {})[n] ?? null);
    rows.push(r);
  }
  const wa = wb.addWorksheet('Ответы по месяцам'); table(wa, cols, rows);
  wa.getRow(1).height = 60;
  for(let r = 2; r <= rows.length + 1; r++) for(let c = 10; c <= cols.length; c++){ const cell = wa.getCell(r, c);
    if(typeof cell.value === 'number' && cell.value <= 2){ cell.font = {...font, bold:true, color:{argb:'FF' + HEX.red}}; } cell.alignment = {horizontal:'center'}; }

  const buf = await wb.xlsx.writeBuffer();
  saveBlob(new Blob([buf], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}), fileName('xlsx'));
  return 'Excel сохранён: ' + fileName('xlsx');
}

// ---------- PowerPoint ----------
async function exportPPTX(){
  const PptxGenJS = await loadScript([  // на cdnjs PptxGenJS нет (404), поэтому jsDelivr, запасной — unpkg
    'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js', 'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'], 'PptxGenJS');
  const m = R.m, logo = await logoData(), arial = $('arial').checked;
  const FT = arial ? 'Arial' : 'MTS Extended', FB = arial ? 'Arial' : 'MTS Text';
  const pp = new PptxGenJS(); pp.layout = 'LAYOUT_16x9'; pp.author = 'Радар стажировки · МГТС'; pp.title = `${m.title} · Месяц ${m.cur}`;
  pp.defineSlideMaster({title:'MGTS', background:{color:'FFFFFF'}, objects:[
    {rect:{x:0, y:0, w:10, h:0.08, fill:{color:HEX.blue}}},
    {image:{x:9.32, y:5.0, w:0.38, h:0.38, data:logo}},
    {text:{text:`МГТС · Радар стажировки · ${m.title} · Месяц ${m.cur}`, options:{x:0.45, y:5.08, w:7, h:0.25, fontFace:FB, fontSize:9, color:HEX.muted}}}],
    slideNumber:{x:8.75, y:5.08, w:0.5, h:0.25, fontFace:FB, fontSize:9, color:HEX.muted}});
  const title = (s, t, sub) => { s.addText(t, {x:0.45, y:0.28, w:9.1, h:0.55, fontFace:FT, bold:true, fontSize:24, color:HEX.blue, margin:0});
    if(sub) s.addText(sub, {x:0.45, y:0.82, w:9.1, h:0.3, fontFace:FB, fontSize:12, color:HEX.muted, margin:0}); };
  const axis = {catAxisLabelFontFace:FB, valAxisLabelFontFace:FB, legendFontFace:FB, dataLabelFontFace:FB, titleFontFace:FB,
    catAxisLabelColor:HEX.navy, valAxisLabelColor:HEX.muted, catAxisLabelFontSize:10, valAxisLabelFontSize:9, legendFontSize:10, dataLabelFontSize:9,
    dataLabelColor:HEX.navy, valGridLine:{color:HEX.line, size:0.5}, catGridLine:{style:'none'}, catAxisLineShow:false, valAxisLineShow:false,
    showTitle:true, titleFontSize:12, titleColor:HEX.navy};
  const nz = v => v == null ? 0 : v;
  const chart = (s, sp, box) => {
    if(sp.kind === 'line'){
      s.addChart(pp.charts.LINE, sp.series.map(x => ({name:x.name, labels:sp.labels, values:x.values.map(nz)})), {...box, ...axis, title:sp.title,
        chartColors: sp.series.map(x => x.color), lineSize:3, lineDataSymbol:'circle', lineDataSymbolSize:7, valAxisMinVal:sp.yMin ?? 0, valAxisMaxVal:sp.yMax ?? 5,
        valAxisMajorUnit:1, showLegend:true, legendPos:'b', showValue:true, dataLabelPosition:'t', dataLabelFormatCode:'0.0'});
    } else if(sp.series.length === 1 && sp.series[0].colors){
      // разные цвета столбцов: по серии на столбец, stacked, нули не подписываем
      const s0 = sp.series[0];
      s.addChart(pp.charts.BAR, sp.labels.map((l, k) => ({name:l, labels:sp.labels, values:sp.labels.map((_, j) => j === k ? nz(s0.values[j]) : 0)})),
        {...box, ...axis, title:sp.title, barDir: sp.kind === 'hbar' ? 'bar' : 'col', barGrouping:'stacked', chartColors:s0.colors, barGapWidthPct:60,
         showLegend:false, showValue:true, dataLabelFormatCode: sp.integer ? '0;;;' : '0.0;;;', valAxisMinVal:0, ...(sp.yMax ? {valAxisMaxVal:sp.yMax} : {}),
         ...(sp.integer ? {valAxisMajorUnit:1} : {}), ...(sp.kind === 'hbar' ? {catAxisOrientation:'maxMin'} : {})});
    } else {
      s.addChart(pp.charts.BAR, sp.series.map(x => ({name:x.name, labels:sp.labels, values:x.values.map(nz)})), {...box, ...axis, title:sp.title,
        barDir: sp.kind === 'hbar' ? 'bar' : 'col', barGrouping:'clustered', chartColors: sp.series.map(x => x.color), barGapWidthPct:70,
        showLegend: sp.series.length > 1, legendPos:'b', showValue:true, dataLabelFormatCode:'0.0', valAxisMinVal:0, valAxisMaxVal:sp.yMax ?? 5, valAxisMajorUnit:1});
    }
  };

  // 1. Титул + KPI
  let s = pp.addSlide({masterName:'MGTS'});
  s.addImage({data:logo, x:0.45, y:0.45, w:0.8, h:0.8});
  s.addText('Радар стажировки', {x:1.45, y:0.45, w:8, h:0.4, fontFace:FB, fontSize:14, color:HEX.muted, margin:0});
  s.addText(m.title, {x:1.45, y:0.82, w:8.1, h:0.7, fontFace:FT, bold:true, fontSize:30, color:HEX.blue, margin:0, fit:'shrink'});
  s.addText([{text:`Срез на Месяц ${m.cur}`, options:{bold:true, color:HEX.navy}}, {text:`   ·   ${m.filter}   ·   сформировано ${dateRu(m.at)}`, options:{color:HEX.muted}}],
    {x:1.45, y:1.55, w:8.1, h:0.35, fontFace:FB, fontSize:13, margin:0});
  s.addShape(pp.shapes.RECTANGLE, {x:1.45, y:2.0, w:0.9, h:0.06, fill:{color:HEX.orange}, line:{color:HEX.orange}});
  const intern = R.tpl === 'intern' ? m.set[0] : null;
  const tiles = intern
    ? [[m.done(intern.intern_id, 'intern') ? 'да' : 'нет', 'Анкета стажёра', HEX.navy], [m.done(intern.intern_id, 'mentor') ? 'да' : 'нет', 'Анкета наставника', HEX.navy],
       [fmt(intern.intern_avg), 'Ср. стажёра', HEX.navy], [fmt(intern.mentor_avg), 'Ср. наставника', HEX.navy], [statusRu(intern.status), 'Статус', HEX[intern.status] || HEX.muted]]
    : [[m.kpi.responded_interns, 'Ответили стажёры', HEX.navy], [m.kpi.responded_mentors, 'Ответили наставники', HEX.navy],
       [String(m.kpi.red ?? 0), 'Критично', HEX.red], [String(m.kpi.yellow ?? 0), 'Внимание', 'C98100'], [String(m.kpi.green ?? 0), 'Положительно', HEX.green]];
  tiles.forEach(([v, l, col], k) => { const x = 0.45 + k * 1.84;
    s.addShape(pp.shapes.ROUNDED_RECTANGLE, {x, y:2.55, w:1.7, h:1.45, fill:{color:HEX.soft}, line:{color:HEX.soft}, rectRadius:0.12});
    s.addText(v, {x, y:2.7, w:1.7, h:0.75, align:'center', fontFace:FT, fontSize: String(v).length > 6 ? 18 : 30, color:col, margin:0, fit:'shrink'});
    s.addText(l, {x, y:3.45, w:1.7, h:0.4, align:'center', fontFace:FB, fontSize:11, color:HEX.muted, margin:0}); });
  const lead = intern ? (m.cards[intern.intern_id]?.summary || intern.reason || '') : `Стажёров в отчёте: ${m.set.length}. Сигналов: ${m.signals.length}.` +
    (m.missing.length ? ` Не сдали анкету: ${m.missing.join(', ')}.` : ' Все анкеты за месяц получены.');
  s.addText(lead, {x:0.45, y:4.2, w:9.1, h:0.6, fontFace:FB, fontSize:12, color:HEX.navy, margin:0, fit:'shrink', valign:'top'});

  // 2. Статусы и динамика
  s = pp.addSlide({masterName:'MGTS'});
  title(s, intern ? 'Динамика и расхождения' : 'Статусы и динамика', `Месяц ${m.cur} · шкала 1–5`);
  chart(s, m.charts.status, {x:0.4, y:1.25, w:3.9, h:3.6});
  chart(s, m.charts.dyn, {x:4.45, y:1.25, w:5.15, h:3.6});

  // 3. Подразделения / оценки стажёра
  s = pp.addSlide({masterName:'MGTS'});
  title(s, intern ? 'Оценки стажёра' : R.tpl === 'dept' ? 'Средние по стажёрам' : 'Средние по подразделениям', m.charts.dept.title);
  chart(s, {...m.charts.dept, title:''}, {x:0.4, y:1.25, w:9.2, h:3.65});

  // 4. Таблица стажёров
  s = pp.addSlide({masterName:'MGTS'});
  title(s, 'Стажёры', `${m.set.length} чел. · средние за Месяц ${m.cur}`);
  const th = t => ({text:t, options:{bold:true, color:'FFFFFF', fill:{color:HEX.blue}, fontFace:FB, fontSize:11, valign:'middle'}});
  const td = (t, o = {}) => ({text:String(t ?? '—'), options:{fontFace:FB, fontSize:11, color:HEX.navy, valign:'middle', ...o}});
  const trows = [['Стажёр', 'Наставник', 'Подразделение', 'Статус', 'Причина', 'Ср. стаж.', 'Ср. наст.', 'Разрыв'].map(th),
    ...m.set.map(i => [td(i.intern_id, {bold:true}), td(i.mentor_id), td(i.department),
      td(statusRu(i.status), {bold:true, align:'center', color: i.status === 'yellow' ? HEX.navy : 'FFFFFF', fill:{color:HEX[i.status] || HEX.grey}}),
      td(i.reason || '—', {fontSize:10}), td(fmt(i.intern_avg), {align:'right'}), td(fmt(i.mentor_avg), {align:'right'}), td(sgn(i.gap), {align:'right'})])];
  if(m.set.length) s.addTable(trows, {x:0.45, y:1.3, w:9.1, colW:[0.9, 1.0, 1.75, 1.15, 2.6, 0.6, 0.6, 0.5], border:{type:'solid', pt:0.5, color:HEX.line},
    rowH:0.42, autoPage:true, autoPageRepeatHeader:true, autoPageSlideStartY:1.3, newSlideStartY:1.3, masterName:'MGTS'});
  else s.addText(`На Месяц ${m.cur} в этой категории стажёров нет`, {x:0.45, y:2.2, w:9.1, h:0.6, fontFace:FB, fontSize:16, color:HEX.muted, align:'center'});

  // 5. Сигналы и действия
  s = pp.addSlide({masterName:'MGTS'});
  title(s, 'Сигналы и действия', 'Каждый сигнал — с основаниями из анкет. Решение принимает HR.');
  const sg = m.signals.slice(0, 6), more = m.signals.length - sg.length;
  const sigRuns = sg.length ? sg.flatMap(x => [
      {text:`${x.intern.intern_id} · ${x.s.title}`, options:{bold:true, color: x.s.level === 'red' ? HEX.red : 'C98100', bullet:{code:'25CF'}, breakLine:true}},
      {text: (x.s.why ? x.s.why + ' ' : '') + (x.quotes[0] ? `«${x.quotes[0].text}»` : evText(x)), options:{color:HEX.navy, fontSize:10, indentLevel:1, breakLine:true}}])
    : [{text:`Сигналов на Месяц ${m.cur} нет`, options:{color:HEX.muted}}];
  if(more > 0) sigRuns.push({text:`…и ещё ${more} в Excel-выгрузке`, options:{color:HEX.muted, fontSize:10}});
  s.addText('Ключевые сигналы', {x:0.45, y:1.25, w:5.3, h:0.35, fontFace:FT, bold:true, fontSize:14, color:HEX.navy, margin:0});
  s.addText(sigRuns, {x:0.45, y:1.65, w:5.3, h:3.25, fontFace:FB, fontSize:11, valign:'top', margin:0, paraSpaceAfter:3, fit:'shrink'});
  s.addShape(pp.shapes.ROUNDED_RECTANGLE, {x:6.0, y:1.2, w:3.6, h:3.75, fill:{color:HEX.soft}, line:{color:HEX.soft}, rectRadius:0.1});
  s.addText('Что сделать HR', {x:6.2, y:1.32, w:3.2, h:0.35, fontFace:FT, bold:true, fontSize:14, color:HEX.blue, margin:0});
  const acts = m.actions.slice(0, 6);
  s.addText(acts.length ? acts.map(a => ({text:a.text, options:{bullet:{type:'number'}, breakLine:true}})) : [{text:'Действий не требуется — плановые встречи'}],
    {x:6.2, y:1.75, w:3.25, h:3.1, fontFace:FB, fontSize:11, color:HEX.navy, valign:'top', margin:0, paraSpaceAfter:4, fit:'shrink'});

  const blob = await pp.write({outputType:'blob'});
  saveBlob(new Blob([blob], {type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}), fileName('pptx'));
  return 'PowerPoint сохранён: ' + fileName('pptx');
}

// ---------- CSV ----------
function exportCSV(){
  const m = R.m, q = v => { const s = v == null ? '' : String(v); return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const num = v => v == null ? '' : String(v).replace('.', ',');
  const head = ['Срез (месяц)', 'ID стажёра', 'ID наставника', 'Подразделение', 'Статус', 'Код статуса', 'Причина', 'Ср. оценка стажёра',
                'Ср. оценка наставника', 'Разрыв', 'Динамика', 'Сигналов', 'Анкета стажёра', 'Анкета наставника', 'Сигналы', 'Дата формирования'];
  const rows = m.set.map(i => [m.cur, i.intern_id, i.mentor_id, i.department, statusRu(i.status), i.status, i.reason, num(i.intern_avg), num(i.mentor_avg),
    num(i.gap), num(i.trend), i.signals ?? 0, m.done(i.intern_id, 'intern') ? 'да' : 'нет', m.done(i.intern_id, 'mentor') ? 'да' : 'нет',
    m.signals.filter(x => x.intern.intern_id === i.intern_id).map(x => `${statusRu(x.s.level)}: ${x.s.title}`).join(' | '), dateISO(m.at)]);
  const csv = '﻿' + [head, ...rows].map(r => r.map(q).join(';')).join('\r\n') + '\r\n';
  saveBlob(new Blob([csv], {type:'text/csv;charset=utf-8'}), fileName('csv'));
  return 'CSV сохранён: ' + fileName('csv');
}

// ---------- события ----------
const EXPORTS = {pdf:exportPDF, xlsx:exportXLSX, pptx:exportPPTX, csv:exportCSV};
document.querySelectorAll('.fmt').forEach(b => b.onclick = async () => {
  if(!R.m) return;
  const f = b.dataset.fmt; b.disabled = true; say(f === 'pdf' ? 'Готовим печать…' : f === 'csv' ? 'Готовим файл…' : 'Готовим файл… первый раз нужно 2–3 секунды');
  try { say(await EXPORTS[f](), 'ok'); }
  catch(e){ console.error(e); say(`Не получилось: ${e.message}. PDF и CSV работают без интернета.`, 'err'); }
  finally { b.disabled = false; }
});
document.querySelectorAll('.tpl input').forEach(i => i.onchange = () => { R.tpl = i.value; update(); });
$('dept').onchange = e => { R.dept = e.target.value; update(); };
$('intern').onchange = e => { R.id = e.target.value; update(); };
['dept', 'intern'].forEach(id => $(id).addEventListener('click', e => e.stopPropagation()));

window.RadarReport = {state:R, update, exports:EXPORTS, saveBlob, lastSaved:null};

// ---------- старт ----------
(async function init(){
  const tpl = qs.get('tpl'); if(TPL[tpl]) R.tpl = tpl;
  R.dept = qs.get('dept'); R.id = qs.get('id');
  if(R.id && !qs.get('tpl')) R.tpl = 'intern';
  if(R.dept && !qs.get('tpl')) R.tpl = 'dept';
  if(qs.has('mock')){ R.mock = 'param'; }
  else if(STATIC_HOST){ R.mock = 'param'; }
  try { await document.fonts?.ready; } catch {}
  try { R.base = await loadOverview(null); }
  catch(e){ $('sheet').innerHTML = `<div class="empty">Нет данных: ${esc(e.message)}</div>`; return; }
  R.periods = R.base.periods || [1, 2, 3, 4, 5, 6]; R.last = R.base.current_period || Math.max(...R.periods);
  const want = +qs.get('period') || (qs.has('mock') ? +qs.get('mock') : 0) || (STATIC_HOST ? 4 : R.last);
  const allowed = (R.mock ? MOCKS : R.periods).filter(p => R.periods.includes(p));
  R.period = allowed.includes(want) ? want : allowed.filter(p => p <= want).pop() || allowed.at(-1);
  banner(); await update();
})();
})();
