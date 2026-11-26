// HR-инструменты «Радар стажировки»: Адаптация, Обращения, Кадровый резерв.
// Подключение: <script src="shared/store.js"></script><script src="hr-tools.js"></script>
//   RadarHR.views.onboarding(el, ctx) · RadarHR.views.inbox(el, ctx) · RadarHR.views.talent(el, ctx)
//   RadarHR.inboxCount() -> Promise<number>   (новые обращения + запросы ОС, не отмеченные «Готово»)
// ctx = { ov, period, go(hash), toast(html), openIntern(id), esc }. Данные — только через window.RadarStore.
(function(){
  const RS = () => window.RadarStore;
  const STAGES = ['День 1', 'Неделя 1', 'Месяц 1', 'Месяц 3', 'Месяц 6'];
  const DONE_KEY = 'radar.inbox.done', REMIND_KEY = 'radar.hr.reminded';
  const escDef = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const C = ctx => ({
    ov: ctx?.ov || {interns: []}, esc: ctx?.esc || escDef,
    period: Number(ctx?.period || ctx?.ov?.current_period || 1),
    toast: ctx?.toast || (h => alert(String(h).replace(/<[^>]+>/g, ''))),
    openIntern: ctx?.openIntern || (() => {}), go: ctx?.go || (() => {}),
  });

  // ---------- стили ----------
  const CSS = `
.ht{font-family:var(--font-text);font-size:16px;color:var(--mgts-navy);line-height:1.45}
.ht *{box-sizing:border-box}
.ht-panel{background:#fff;border-radius:22px;box-shadow:0 1px 2px rgba(19,64,116,.06),0 12px 32px -10px rgba(0,138,224,.16);padding:24px;margin-bottom:20px;min-width:0}
.ht-h{font-family:var(--font-title);font-weight:900;color:var(--mgts-navy);font-size:20px;margin:0 0 4px}
.ht-sub{color:var(--mgts-muted);margin:0 0 16px;font-size:15px}
.ht-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
.ht-tab,.ht-chip{min-height:44px;padding:0 18px;border-radius:22px;border:1px solid var(--mgts-line);background:#fff;color:var(--mgts-navy);font:500 16px var(--font-text);cursor:pointer;display:inline-flex;align-items:center;gap:8px}
.ht-chip{min-height:40px;font-size:15px;padding:0 14px}
.ht-tab[aria-selected=true],.ht-chip[aria-pressed=true]{background:var(--mgts-navy);border-color:var(--mgts-navy);color:#fff}
.ht-tab .ht-n,.ht-chip .ht-n{font-size:13px;opacity:.75}
.ht-btn{min-height:44px;padding:0 20px;border-radius:14px;border:0;background:var(--mgts-blue);color:#fff;font:500 16px var(--font-text);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;white-space:nowrap}
.ht-btn:hover{filter:brightness(.95)}
.ht-btn.ht-ghost{background:var(--mgts-bg-soft);color:var(--mgts-navy)}
.ht-btn.ht-line{background:#fff;color:var(--mgts-blue);border:1px solid var(--mgts-line)}
.ht-btn.ht-accent{background:var(--mgts-orange)}
.ht-btn.ht-sm{min-height:40px;padding:0 14px;font-size:15px}
.ht-btn:disabled{opacity:.45;cursor:default}
.ht-icon-btn{width:44px;height:44px;border-radius:12px;border:1px solid var(--mgts-line);background:#fff;color:var(--mgts-navy);cursor:pointer;font-size:18px;display:inline-flex;align-items:center;justify-content:center}
.ht-icon-btn:disabled{opacity:.35;cursor:default}
.ht-row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.ht-grow{flex:1}
.ht-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;min-width:0}
.ht-field>span{font-size:14px;color:var(--mgts-muted);font-weight:500}
.ht input[type=text],.ht input[type=email],.ht input[type=url],.ht input[type=datetime-local],.ht select,.ht textarea{width:100%;min-height:44px;border:1px solid var(--mgts-line);border-radius:12px;padding:10px 12px;font:16px var(--font-text);color:var(--mgts-navy);background:#fff}
.ht textarea{min-height:88px;resize:vertical}
.ht input:focus,.ht select:focus,.ht textarea:focus{outline:2px solid var(--mgts-blue-soft);border-color:var(--mgts-blue)}
.ht-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -4px;padding:0 4px}
.ht-table{width:100%;border-collapse:collapse;min-width:640px}
.ht-table th{font:500 14px var(--font-text);color:var(--mgts-muted);text-align:left;padding:10px 10px;border-bottom:1px solid var(--mgts-line);white-space:nowrap}
.ht-table td{padding:12px 10px;border-bottom:1px solid var(--mgts-line);vertical-align:middle}
.ht-table tr:last-child td{border-bottom:0}
.ht-id{font-family:var(--font-title);font-weight:500;white-space:nowrap}
.ht-link{color:var(--mgts-blue);background:none;border:0;padding:0;font:inherit;cursor:pointer;text-decoration:none}
.ht-link:hover{text-decoration:underline}
.ht-pct{display:flex;flex-direction:column;gap:4px;min-width:72px}
.ht-pct b{font:500 15px var(--font-title)}
.ht-bar{height:6px;border-radius:3px;background:var(--mgts-bg-soft);overflow:hidden}
.ht-bar i{display:block;height:100%;background:var(--st-green);border-radius:3px}
.ht-pct.ht-late b{color:var(--st-red)} .ht-pct.ht-late .ht-bar i{background:var(--st-red)}
.ht-pct.ht-future{opacity:.4}
.ht-late-row td:first-child{box-shadow:inset 3px 0 0 var(--st-red)}
.ht-tag{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:10px;font-size:13px;font-weight:500;background:var(--mgts-bg-soft);color:var(--mgts-navy);white-space:nowrap}
.ht-tag.ht-red{background:#FDECEC;color:#B4262B} .ht-tag.ht-yellow{background:#FEF4E2;color:#8A5A00} .ht-tag.ht-green{background:#E6F6EE;color:#1B7A46}
.ht-tag.ht-blue{background:var(--mgts-blue-soft);color:var(--mgts-navy)} .ht-tag.ht-new{background:var(--mgts-orange);color:#fff}
.ht-dot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.ht-dot.green{background:var(--st-green)} .ht-dot.yellow{background:var(--st-yellow)} .ht-dot.red{background:var(--st-red)}
.ht-kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}
.ht-kpi{background:var(--mgts-bg-soft);border-radius:16px;padding:12px 16px;min-width:140px}
.ht-kpi b{display:block;font:500 26px var(--font-title);color:var(--mgts-navy)} .ht-kpi span{font-size:14px;color:var(--mgts-muted)}
.ht-kpi.ht-warn b{color:var(--st-red)}
.ht-two{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:20px;align-items:start}
.ht-two.ht-two-eq{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}
.ht-card-ed{border:1px solid var(--mgts-line);border-radius:16px;padding:14px;margin-bottom:12px;display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;align-items:start}
.ht-card-ed .ht-field{margin-bottom:8px}
.ht-ico{width:44px;height:44px;border-radius:12px;background:var(--mgts-bg-soft);color:var(--mgts-blue);display:flex;align-items:center;justify-content:center;flex:none}
.ht-ico svg{width:22px;height:22px}
.ht-ico-pick{display:flex;flex-direction:column;gap:6px;align-items:center}
.ht-ico-pick select{width:auto;min-height:36px;padding:4px 6px;font-size:13px}
.ht-ord{display:flex;flex-direction:column;gap:6px}
.ht-sticky{position:sticky;top:16px}
.ht-phone{width:300px;max-width:100%;margin:0 auto;border:10px solid var(--mgts-navy-2,#102C51);border-radius:38px;background:var(--mgts-bg-soft);height:600px;overflow:hidden;display:flex;flex-direction:column}
.ht-phone-top{background:var(--mgts-blue);color:#fff;padding:18px 16px 14px;font:900 16px var(--font-title)}
.ht-phone-top small{display:block;font:400 12px var(--font-text);opacity:.85}
.ht-phone-body{overflow-y:auto;padding:12px;flex:1}
.ht-pv{background:#fff;border-radius:14px;padding:12px;margin-bottom:10px;display:flex;gap:10px}
.ht-pv .ht-ico{width:34px;height:34px;border-radius:10px} .ht-pv .ht-ico svg{width:18px;height:18px}
.ht-pv b{display:block;font-size:14px;margin-bottom:2px} .ht-pv p{margin:0;font-size:13px;color:#3d5a7a}
.ht-pv a{font-size:13px;color:var(--mgts-blue)}
.ht-people{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-bottom:14px}
.ht-check{display:flex;gap:10px;align-items:center;min-height:48px;border:1px solid var(--mgts-line);border-radius:12px;padding:8px 12px;cursor:pointer}
.ht-check input{width:20px;height:20px;accent-color:var(--mgts-blue);flex:none}
.ht-check small{display:block;color:var(--mgts-muted);font-size:13px}
.ht-meet{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--mgts-line)}
.ht-meet:last-child{border-bottom:0}
.ht-date{background:var(--mgts-bg-soft);border-radius:12px;padding:6px 10px;text-align:center;min-width:64px;font-size:13px;color:var(--mgts-muted)}
.ht-date b{display:block;font:500 18px var(--font-title);color:var(--mgts-navy)}
.ht-item{border:1px solid var(--mgts-line);border-radius:16px;padding:16px;margin-bottom:12px}
.ht-item.ht-done{opacity:.55}
.ht-item-h{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px}
.ht-item-h time{margin-left:auto;color:var(--mgts-muted);font-size:14px}
.ht-item p{margin:0 0 12px;font-size:16px}
.ht-inline{background:var(--mgts-bg-soft);border-radius:14px;padding:14px;margin-top:12px}
.ht-seg{display:inline-flex;background:var(--mgts-bg-soft);border-radius:14px;padding:4px;gap:4px;margin-bottom:12px}
.ht-seg button{min-height:40px;padding:0 16px;border:0;border-radius:10px;background:none;font:500 15px var(--font-text);color:var(--mgts-navy);cursor:pointer}
.ht-seg button[aria-pressed=true]{background:#fff;box-shadow:0 1px 3px rgba(19,64,116,.15)}
.ht-empty{text-align:center;color:var(--mgts-muted);padding:28px 12px}
.ht-nine{display:grid;grid-template-columns:28px minmax(0,1fr);grid-template-rows:minmax(0,1fr) 28px;gap:6px}
.ht-ylab{writing-mode:vertical-rl;transform:rotate(180deg);text-align:center;font-size:14px;color:var(--mgts-muted);font-weight:500}
.ht-xlab{grid-column:2;text-align:center;font-size:14px;color:var(--mgts-muted);font-weight:500}
.ht-box{position:relative;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:4px;aspect-ratio:1.25;min-height:300px}
.ht-cell{border-radius:14px;padding:10px;font-size:13px;font-weight:500;line-height:1.25;color:var(--mgts-navy);background:var(--mgts-bg-soft)}
.ht-cell small{display:block;font-weight:400;color:var(--mgts-muted);font-size:12px;margin-top:2px}
.ht-cell.ht-c-top{background:#E6F6EE} .ht-cell.ht-c-risk{background:#FDECEC} .ht-cell.ht-c-mid{background:#EEF5FC}
.ht-pt{position:absolute;transform:translate(-50%,50%);min-width:44px;height:30px;padding:0 8px;border-radius:15px;border:2px solid #fff;background:var(--mgts-navy);color:#fff;font:500 12px var(--font-title);cursor:pointer;box-shadow:0 2px 8px rgba(19,64,116,.3);white-space:nowrap}
.ht-pt.red{background:var(--st-red)} .ht-pt.yellow{background:var(--st-yellow);color:#3a2600} .ht-pt.green{background:var(--st-green)}
.ht-pt:hover,.ht-pt:focus{z-index:3;outline:3px solid var(--mgts-blue-soft)}
.ht-ticks{position:absolute;inset:0;pointer-events:none}
.ht-note{display:flex;gap:10px;align-items:center;background:var(--mgts-bg-soft);border-radius:14px;padding:12px 14px;font-size:15px;margin-top:16px}
.ht-note b{color:var(--mgts-orange)}
.ht-rec{font-weight:500}
@media (max-width:1100px){.ht-two,.ht-two.ht-two-eq{grid-template-columns:1fr}.ht-sticky{position:static}}
@media (max-width:640px){
  .ht-panel{padding:16px;border-radius:18px}
  .ht-card-ed{grid-template-columns:1fr;}
  .ht-ord{flex-direction:row}
  .ht-ico-pick{flex-direction:row}
  .ht-tabs{flex-wrap:nowrap;overflow-x:auto;margin:0 -16px 16px;padding:0 16px;scrollbar-width:none}
  .ht-tabs::-webkit-scrollbar{display:none}
  .ht-tab{flex:none}
  .ht-row>.ht-btn{flex:1 1 100%}
  .ht-box{min-height:280px;aspect-ratio:auto;height:320px}
  .ht-cell{font-size:11px;padding:6px} .ht-cell small{display:none}
  .ht-kpi{flex:1 1 40%;min-width:0}
}`;
  function injectCss(){ if(document.getElementById('ht-css')) return; const s = document.createElement('style'); s.id = 'ht-css'; s.textContent = CSS; document.head.appendChild(s); }

  // ---------- иконки памятки ----------
  const P = {
    flag:'<path d="M5 21V4m0 0h11l-2 4 2 4H5"/>', pin:'<path d="M12 21s7-6.2 7-11.5a7 7 0 1 0-14 0C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    badge:'<rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>', laptop:'<rect x="4" y="5" width="16" height="11" rx="2"/><path d="M2 19h20"/>',
    tasks:'<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>', people:'<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14c2.5 0 4 1.8 4 4.5"/>',
    chat:'<path d="M4 5h16v11H9l-5 4z"/>', clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', pulse:'<path d="M3 12h4l2-5 4 10 2-5h6"/>',
    star:'<path d="M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2L12 17.4 6.5 20.3l1-6.2L3 9.7l6.2-.9z"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  };
  const ICON_NAMES = {flag:'Флаг', pin:'Адрес', badge:'Пропуск', laptop:'Ноутбук', tasks:'Задачи', people:'Люди', chat:'Чат', clock:'Время', pulse:'Пульс', star:'Звезда', info:'Инфо'};
  const icon = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n] || P.info}</svg>`;

  // ---------- утилиты ----------
  const pad = n => String(n).padStart(2, '0');
  const toLocalInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  function nextFriday15(){ const d = new Date(); d.setSeconds(0, 0); const add = (5 - d.getDay() + 7) % 7; d.setDate(d.getDate() + add); d.setHours(15, 0);
    if(d <= new Date()) d.setDate(d.getDate() + 7); return d; }
  function nextWorkday(h){ const d = new Date(); d.setDate(d.getDate() + 1); while([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d; }
  const fmtDT = s => { const d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('ru-RU', {day:'numeric', month:'long', hour:'2-digit', minute:'2-digit'}); };
  const fmtAgo = s => { const d = new Date(s); if(isNaN(d)) return ''; const m = Math.round((Date.now() - d) / 60000);
    if(m < 1) return 'только что'; if(m < 60) return m + ' мин назад'; if(m < 1440) return Math.round(m / 60) + ' ч назад'; return d.toLocaleDateString('ru-RU', {day:'numeric', month:'short'}); };
  async function copyText(t){ try { await navigator.clipboard.writeText(t); return true; } catch {
    const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} a.remove(); return ok; } }
  const interns = c => (c.ov.interns || []).slice().sort((a, b) => a.intern_id.localeCompare(b.intern_id));
  const internOpts = (c, sel) => interns(c).map(i => `<option value="${c.esc(i.intern_id)}"${i.intern_id === sel ? ' selected' : ''}>${c.esc(i.intern_id)} · ${c.esc(i.department)}</option>`).join('');
  const live = (el, fn) => { RS().onChange(k => { if(el.isConnected) fn(k); }); };
  let docCache = null;
  async function doc(force){ if(!docCache || force) docCache = await RS().memo(); return docCache; }

  // =====================================================================
  // 1. АДАПТАЦИЯ
  // =====================================================================
  function onboarding(el, ctx){
    injectCss(); const c = C(ctx);
    const S = {tab: 'progress'};
    el.innerHTML = `<div class="ht"><div class="ht-tabs" role="tablist">
      <button class="ht-tab" role="tab" data-t="progress">Прогресс адаптации</button>
      <button class="ht-tab" role="tab" data-t="memo">Памятка стажёра</button>
      <button class="ht-tab" role="tab" data-t="meet">Знакомство с командой</button></div><div class="ht-body"></div></div>`;
    const body = el.querySelector('.ht-body');
    const show = t => { S.tab = t; el.querySelectorAll('.ht-tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.t === t)));
      ({progress: tabProgress, memo: tabMemo, meet: tabMeet})[t](body, c); };
    el.querySelectorAll('.ht-tab').forEach(b => b.onclick = () => show(b.dataset.t));
    live(el, k => { if(S.tab === 'progress' && k.startsWith('radar.check.')) show('progress'); });
    show('progress');
  }

  // --- прогресс чек-листа ---
  function stageDue(stage, period){ return stage === 'Месяц 3' ? period >= 3 : stage === 'Месяц 6' ? period >= 6 : true; }
  async function tabProgress(body, c){
    const d = await doc(); const list = d.checklist || [];
    const reminded = RS().ls.get(REMIND_KEY, {});
    const rows = interns(c).map(i => {
      const done = new Set(RS().checklist(i.intern_id));
      const st = STAGES.map(s => { const items = list.filter(x => x.stage === s); const n = items.filter(x => done.has(x.id)).length;
        return {s, total: items.length, n, pct: items.length ? Math.round(n / items.length * 100) : 100, due: stageDue(s, c.period)}; });
      const late = st.find(x => x.due && x.pct < 100);
      const all = list.length ? Math.round(list.filter(x => done.has(x.id)).length / list.length * 100) : 0;
      return {i, st, late, all};
    });
    const started = rows.some(r => r.all > 0);
    if(!started) rows.forEach(r => r.late = null);   // никто ещё не отмечал шаги — это не «отставание», а «не начали»
    const lateN = rows.filter(r => r.late).length;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.all, 0) / rows.length) : 0;
    body.innerHTML = `<div class="ht-panel">
      <div class="ht-row" style="justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div><h3 class="ht-h">Чек-лист адаптации</h3><p class="ht-sub" style="margin:0">Стажёр отмечает шаги в своём кабинете. Срок этапа — по Месяцу ${c.period}.</p></div>
        <button class="ht-btn ht-accent" data-all ${lateN ? '' : 'disabled'}>Напомнить всем отстающим${lateN ? ' · ' + lateN : ''}</button></div>
      ${started ? '' : `<div class="ht-note" style="margin:0 0 14px"><b>i</b><span><b style="color:inherit">Стажёры ещё не отмечали шаги.</b> Чек-лист появился в кабинете стажёра — отправьте ссылку, и прогресс начнёт заполняться сам.
        <button class="ht-btn ht-sm" data-link style="margin-left:8px">Скопировать ссылку на кабинет</button></span></div>`}
      <div class="ht-kpis"><div class="ht-kpi"><b>${started ? avg + '%' : '—'}</b><span>средний прогресс</span></div>
        <div class="ht-kpi ${lateN ? 'ht-warn' : ''}"><b>${started ? lateN : rows.length}</b><span>${started ? 'отстают по сроку' : 'ещё не начали'}</span></div>
        <div class="ht-kpi"><b>${list.length}</b><span>шагов в чек-листе</span></div></div>
      <div class="ht-scroll"><table class="ht-table"><thead><tr><th>Стажёр</th>${STAGES.map(s => `<th>${s}</th>`).join('')}<th>Всего</th><th></th></tr></thead><tbody>
      ${rows.map(r => `<tr class="${r.late ? 'ht-late-row' : ''}">
        <td><button class="ht-link ht-id" data-open="${c.esc(r.i.intern_id)}">${c.esc(r.i.intern_id)}</button><div style="font-size:13px;color:var(--mgts-muted)">${c.esc(r.i.department)}</div></td>
        ${r.st.map(x => `<td><div class="ht-pct ${!started || !x.due ? 'ht-future' : x.pct < 100 ? 'ht-late' : ''}" title="${x.n} из ${x.total}"><b>${started ? x.pct + '%' : '—'}</b><div class="ht-bar"><i style="width:${x.pct}%"></i></div></div></td>`).join('')}
        <td><b class="ht-id">${r.all}%</b></td>
        <td style="text-align:right">${r.late
          ? `<button class="ht-btn ht-sm ${reminded[r.i.intern_id] ? 'ht-line' : ''}" data-remind="${c.esc(r.i.intern_id)}" data-stage="${c.esc(r.late.s)}">${reminded[r.i.intern_id] ? 'Напомнить ещё' : 'Напомнить'}</button>
             <div style="font-size:13px;color:var(--st-red);margin-top:4px;white-space:nowrap">не закрыт «${c.esc(r.late.s)}»</div>`
          : started ? '<span class="ht-tag ht-green">в срок</span>' : '<span class="ht-tag">не начал</span>'}</td></tr>`).join('')}
      </tbody></table></div></div>`;
    const remind = (id, stage) => { const m = RS().ls.get(REMIND_KEY, {}); m[id] = new Date().toISOString(); RS().ls.set(REMIND_KEY, m);
      c.toast(`Напоминание отправлено <b>${c.esc(id)}</b>${stage ? ' — этап «' + c.esc(stage) + '»' : ''}`); };
    body.querySelectorAll('[data-remind]').forEach(b => b.onclick = () => { remind(b.dataset.remind, b.dataset.stage); tabProgress(body, c); });
    body.querySelector('[data-all]').onclick = () => { const ids = rows.filter(r => r.late).map(r => r.i.intern_id);
      const m = RS().ls.get(REMIND_KEY, {}); ids.forEach(id => m[id] = new Date().toISOString()); RS().ls.set(REMIND_KEY, m);
      c.toast(`Напоминание отправлено: <b>${ids.map(c.esc).join(', ')}</b>`); tabProgress(body, c); };
    body.querySelectorAll('[data-open]').forEach(b => b.onclick = () => c.openIntern(b.dataset.open));
    body.querySelector('[data-link]')?.addEventListener('click', () => { const u = new URL('intern.html', location.href).href;
      navigator.clipboard?.writeText(u).catch(() => {}); c.toast('Ссылка на кабинет скопирована: <b>' + c.esc(u) + '</b>'); });
  }

  // --- редактор памятки ---
  async function tabMemo(body, c){
    const d = JSON.parse(JSON.stringify(await doc(true)));
    const S = {d, dirty: false};
    const firstId = interns(c)[0]?.intern_id || 'СТ-001';
    body.innerHTML = `<div class="ht-two"><div class="ht-panel">
        <div class="ht-row" style="justify-content:space-between;margin-bottom:12px">
          <div><h3 class="ht-h">Памятка стажёра</h3><p class="ht-sub" style="margin:0">Что стажёр видит в первый день. Правки сразу у всех стажёров.</p></div>
          <a class="ht-btn ht-line ht-sm" href="intern.html?id=${encodeURIComponent(firstId)}" target="_blank" rel="noopener">Открыть кабинет стажёра ↗</a></div>
        <div class="ht-cards"></div>
        <div class="ht-row" style="margin-top:8px">
          <button class="ht-btn ht-ghost" data-add>+ Добавить карточку</button><span class="ht-grow"></span>
          <button class="ht-btn ht-line" data-reset>Сбросить к шаблону</button>
          <button class="ht-btn" data-save>Сохранить</button></div></div>
      <div class="ht-panel ht-sticky"><h3 class="ht-h" style="text-align:center">Так видит стажёр</h3><p class="ht-sub" style="text-align:center">превью обновляется сразу</p>
        <div class="ht-phone"><div class="ht-phone-top">Памятка<small>${c.esc(d.program?.name || 'Стажёрская программа МГТС')}</small></div><div class="ht-phone-body"></div></div></div></div>`;
    const cardsEl = body.querySelector('.ht-cards'), pv = body.querySelector('.ht-phone-body'), saveBtn = body.querySelector('[data-save]');
    const mark = () => { S.dirty = true; saveBtn.textContent = 'Сохранить •'; };
    const preview = () => { pv.innerHTML = (S.d.memo || []).map(m => `<div class="ht-pv"><div class="ht-ico">${icon(m.icon)}</div><div>
      <b>${c.esc(m.title || 'Без заголовка')}</b><p>${c.esc(m.text || '')}</p>${m.link ? `<a href="${c.esc(m.link)}" target="_blank" rel="noopener">${c.esc(m.link_label || 'Подробнее')} →</a>` : ''}</div></div>`).join('')
      || '<div class="ht-empty">Памятка пустая</div>'; };
    const draw = () => {
      const L = S.d.memo || (S.d.memo = []);
      cardsEl.innerHTML = L.map((m, k) => `<div class="ht-card-ed" data-k="${k}">
        <div class="ht-ico-pick"><div class="ht-ico">${icon(m.icon)}</div><select aria-label="Иконка" data-f="icon">${Object.keys(ICON_NAMES).map(n => `<option value="${n}"${n === m.icon ? ' selected' : ''}>${ICON_NAMES[n]}</option>`).join('')}</select></div>
        <div><label class="ht-field"><span>Заголовок</span><input type="text" data-f="title" value="${c.esc(m.title)}"></label>
          <label class="ht-field"><span>Текст</span><textarea data-f="text" rows="3">${c.esc(m.text)}</textarea></label>
          <div class="ht-row"><label class="ht-field ht-grow" style="min-width:180px;margin:0"><span>Ссылка (необязательно)</span><input type="url" data-f="link" value="${c.esc(m.link || '')}" placeholder="https://"></label>
            <label class="ht-field" style="min-width:160px;margin:0"><span>Текст ссылки</span><input type="text" data-f="link_label" value="${c.esc(m.link_label || '')}" placeholder="Подробнее"></label></div></div>
        <div class="ht-ord"><button class="ht-icon-btn" data-up title="Выше" aria-label="Выше" ${k ? '' : 'disabled'}>↑</button>
          <button class="ht-icon-btn" data-down title="Ниже" aria-label="Ниже" ${k < L.length - 1 ? '' : 'disabled'}>↓</button>
          <button class="ht-icon-btn" data-del title="Удалить" aria-label="Удалить" style="color:var(--st-red)">✕</button></div></div>`).join('');
      cardsEl.querySelectorAll('.ht-card-ed').forEach(card => { const k = +card.dataset.k, m = L[k];
        card.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
          const f = inp.dataset.f; if(inp.value) m[f] = inp.value; else delete m[f]; if(f === 'icon') card.querySelector('.ht-ico').innerHTML = icon(m.icon); mark(); preview(); }));
        card.querySelector('[data-up]').onclick = () => { [L[k - 1], L[k]] = [L[k], L[k - 1]]; mark(); draw(); };
        card.querySelector('[data-down]').onclick = () => { [L[k + 1], L[k]] = [L[k], L[k + 1]]; mark(); draw(); };
        card.querySelector('[data-del]').onclick = () => { if(!confirm('Удалить карточку «' + (m.title || '') + '»?')) return; L.splice(k, 1); mark(); draw(); };
      });
      preview();
    };
    body.querySelector('[data-add]').onclick = () => { S.d.memo.push({id: 'c' + Date.now().toString(36), icon: 'info', title: 'Новая карточка', text: ''}); mark(); draw();
      cardsEl.lastElementChild?.querySelector('input')?.focus(); };
    saveBtn.onclick = () => { RS().saveMemo(S.d); docCache = S.d; S.dirty = false; saveBtn.textContent = 'Сохранить'; c.toast('Памятка сохранена — стажёры видят новую версию'); };
    body.querySelector('[data-reset]').onclick = async () => { if(!confirm('Вернуть памятку к шаблону? Ваши правки удалятся.')) return;
      RS().resetMemo(); docCache = null; c.toast('Памятка возвращена к шаблону'); tabMemo(body, c); };
    draw();
  }

  // --- встречи: знакомство с командой и шаблоны ---
  const MEET_T = {
    intro: {label: 'Знакомство с командой', type: 'intro', title: id => `Знакомство с командой — ${id}`, minutes: 30, roles: null,
      agenda: 'Знакомство: кто чем занимается, к кому с какими вопросами, 30 мин'},
    hr1: {label: '1:1 HR (Месяц 1)', type: '1:1', title: id => `1:1 с HR — ${id}, Месяц 1`, minutes: 30, roles: ['HR программы'],
      agenda: 'Как прошёл первый месяц: задачи, нагрузка, что мешает, чем помочь. 30 мин'},
    mid: {label: 'Промежуточная (Месяц 3)', type: 'mid', title: id => `Промежуточная встреча — ${id}, Месяц 3`, minutes: 45, roles: ['Наставник', 'Руководитель блока', 'HR программы'],
      agenda: 'Итоги 3 месяцев: результаты задач, рост, обратная связь наставника, план на месяцы 4–6. 45 мин'},
    final: {label: 'Финальная (Месяц 6)', type: 'final', title: id => `Финальная встреча — ${id}, Месяц 6`, minutes: 60, roles: ['Наставник', 'Руководитель блока', 'HR программы'],
      agenda: 'Итоги стажировки, результаты, решение по офферу и следующие шаги. 60 мин'},
  };
  async function tabMeet(body, c){
    const d = await doc();
    const S = {tpl: 'intro', id: interns(c)[0]?.intern_id || '', start: toLocalInput(nextFriday15()), link: '', emails: '', checked: null, savedKey: ''};
    const team = () => { const i = interns(c).find(x => x.intern_id === S.id); return (d.departments?.[i?.department]?.team || []).map(t => ({...t, who: t.role === 'Наставник' && i?.mentor_id ? i.mentor_id : t.who})); };
    const defaults = () => { const T = MEET_T[S.tpl]; S.checked = new Set(team().map((t, k) => (!T.roles || T.roles.includes(t.role)) ? k : -1).filter(k => k >= 0)); };
    const people = () => [...team().filter((t, k) => S.checked.has(k)).map(t => `${t.role} (${t.who})`), ...S.emails.split(/[,;\s]+/).filter(x => /@/.test(x))];
    const payload = () => { const T = MEET_T[S.tpl]; return {intern_id: S.id, type: T.type, title: T.title(S.id), start: new Date(S.start).toISOString(), minutes: T.minutes,
      people: [S.id, ...people()], link: S.link.trim(), place: 'МТС Линк', agenda: T.agenda}; };
    const inviteText = () => { const p = payload(); return `${p.title}\nКогда: ${fmtDT(p.start)}, ${p.minutes} мин\nГде: МТС Линк${p.link ? ' — ' + p.link : ''}\nУчастники: ${p.people.join(', ')}\nПовестка: ${p.agenda}`; };
    const saveMeeting = async () => { const p = payload(), key = JSON.stringify([p.type, p.intern_id, p.start]);
      if(S.savedKey === key) return false; S.savedKey = key; await RS().addMeeting(p); return true; };
    defaults();
    const draw = async () => {
      const T = MEET_T[S.tpl]; const tm = team(); const meets = (await RS().meetings()).slice(0, 8);
      body.innerHTML = `<div class="ht-two"><div class="ht-panel">
        <h3 class="ht-h">Пригласить на встречу</h3><p class="ht-sub">Выберите стажёра и участников — приглашение уйдёт в календарь, встреча появится в кабинете стажёра.</p>
        <div class="ht-row" style="margin-bottom:16px">${Object.entries(MEET_T).map(([k, t]) => `<button class="ht-chip" data-tpl="${k}" aria-pressed="${k === S.tpl}">${t.label}</button>`).join('')}</div>
        <label class="ht-field"><span>Стажёр</span><select data-id>${internOpts(c, S.id)}</select></label>
        <div class="ht-field"><span>Участники</span></div>
        <div class="ht-people">${tm.map((t, k) => `<label class="ht-check"><input type="checkbox" data-p="${k}" ${S.checked.has(k) ? 'checked' : ''}><span>${c.esc(t.role)}<small>${c.esc(t.who)}</small></span></label>`).join('') || '<div class="ht-sub">В шаблоне нет команды для этого блока</div>'}</div>
        <label class="ht-field"><span>Ещё участники — email через запятую</span><input type="email" multiple data-emails value="${c.esc(S.emails)}" placeholder="ivanov@mgts.ru, petrova@mgts.ru"></label>
        <div class="ht-row"><label class="ht-field ht-grow" style="min-width:220px"><span>Дата и время · ${T.minutes} мин</span><input type="datetime-local" data-start value="${S.start}"></label>
          <label class="ht-field ht-grow" style="min-width:220px"><span>МТС Линк — ссылка на встречу</span><input type="url" data-link value="${c.esc(S.link)}" placeholder="https://mts-link.ru/..."></label></div>
        <div class="ht-note" style="margin:0 0 16px"><span>Повестка:</span> <span>${c.esc(T.agenda)}</span></div>
        <div class="ht-row"><button class="ht-btn" data-ics>Скачать приглашение (.ics)</button><button class="ht-btn ht-line" data-copy>Скопировать текст приглашения</button></div></div>
      <div class="ht-panel"><h3 class="ht-h">Запланировано</h3><p class="ht-sub">Эти встречи видит стажёр</p>
        ${meets.length ? meets.map(m => { const dt = new Date(m.start); return `<div class="ht-meet"><div class="ht-date"><b>${isNaN(dt) ? '—' : dt.getDate()}</b>${isNaN(dt) ? '' : dt.toLocaleDateString('ru-RU', {month: 'short'})}</div>
          <div class="ht-grow" style="min-width:0"><div style="font-weight:500">${c.esc(m.title || 'Встреча')}</div><div style="font-size:14px;color:var(--mgts-muted)">${isNaN(dt) ? '' : dt.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})} · ${c.esc(m.minutes || 30)} мин · ${c.esc(m.intern_id || '')}</div></div></div>`; }).join('')
          : '<div class="ht-empty">Пока нет встреч. Создайте первую слева.</div>'}</div></div>`;
      body.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { S.tpl = b.dataset.tpl; defaults(); draw(); });
      body.querySelector('[data-id]').onchange = e => { S.id = e.target.value; defaults(); draw(); };
      body.querySelectorAll('[data-p]').forEach(b => b.onchange = () => { const k = +b.dataset.p; b.checked ? S.checked.add(k) : S.checked.delete(k); });
      body.querySelector('[data-emails]').oninput = e => S.emails = e.target.value;
      body.querySelector('[data-start]').onchange = e => S.start = e.target.value || S.start;
      body.querySelector('[data-link]').oninput = e => S.link = e.target.value;
      body.querySelector('[data-ics]').onclick = async () => { const p = payload();
        RS().download(RS().ics({title: p.title, start: p.start, minutes: p.minutes, location: 'МТС Линк' + (p.link ? ' ' + p.link : ''),
          description: p.agenda + '\nУчастники: ' + p.people.join(', ') + (p.link ? '\nСсылка: ' + p.link : ''), attendees: S.emails.split(/[,;\s]+/)}), `vstrecha-${p.type}-${p.intern_id}.ics`);
        const added = await saveMeeting(); c.toast(`Приглашение скачано${added ? ' · встреча добавлена в кабинет <b>' + c.esc(p.intern_id) + '</b>' : ''}`); if(added) draw(); };
      body.querySelector('[data-copy]').onclick = async () => { const ok = await copyText(inviteText()); const added = await saveMeeting();
        c.toast((ok ? 'Текст приглашения скопирован' : 'Не удалось скопировать') + (added ? ' · встреча добавлена в кабинет <b>' + c.esc(S.id) + '</b>' : '')); if(added) draw(); };
    };
    draw();
  }

  // =====================================================================
  // 2. ОБРАЩЕНИЯ
  // =====================================================================
  const reqKey = x => 'r:' + (x.id || (x.at + '|' + (x.text || '')));
  const fbKey = x => 'f:' + (x.id || (x.at + '|' + (x.text || '')));
  const doneSet = () => new Set(RS().ls.get(DONE_KEY, []));
  async function feed(){
    const [reqs, fbs] = await Promise.all([RS().internRequests(), RS().feedbackRequests()]);
    const done = doneSet();
    const items = [
      ...reqs.map(x => ({key: reqKey(x), src: 'req', anon: !!x.anonymous || !x.intern_id, intern_id: x.anonymous ? null : x.intern_id, type: x.type, text: x.text, at: x.at})),
      ...fbs.map(x => ({key: fbKey(x), src: 'fb', anon: false, intern_id: x.intern_id, to: x.to, text: x.text, at: x.at})),
    ].map(x => ({...x, done: done.has(x.key)}));
    items.sort((a, b) => (a.done - b.done) || String(b.at || '').localeCompare(String(a.at || '')));
    return items;
  }
  async function inboxCount(){ try { return (await feed()).filter(x => !x.done).length; } catch { return 0; } }

  const KUDOS_T = {kudos: ['Спасибо за аккуратную работу с задачей — наставник это отметил.', 'Ты быстро разобрался в процессах команды — так держать!', 'Отличная инициатива, команда оценила.'],
    grow: ['Попробуй чаще приходить к наставнику с вопросами — не жди 1:1.', 'Давай планировать задачи на неделю вперёд и сверять сроки с наставником.', 'Предлагаю короткий план развития на месяц — обсудим на встрече.']};
  const fbForm = (c, id, kind, prefix) => `<label class="ht-field"><span>Стажёр</span><select data-fb-id>${internOpts(c, id)}</select></label>
    <div class="ht-seg" role="group"><button data-kind="kudos" aria-pressed="${kind === 'kudos'}">Похвала</button><button data-kind="grow" aria-pressed="${kind === 'grow'}">Зона роста</button></div>
    <div class="ht-row" data-tpls style="margin-bottom:10px"></div>
    <label class="ht-field"><span>Текст</span><textarea data-fb-text placeholder="${prefix || 'Что хотите сказать стажёру'}"></textarea></label>
    <button class="ht-btn" data-fb-send disabled>Отправить стажёру</button>`;
  function bindFb(box, c, onSent, fixedId){
    let kind = 'kudos';
    const ta = box.querySelector('[data-fb-text]'), send = box.querySelector('[data-fb-send]'), sel = box.querySelector('[data-fb-id]');
    if(fixedId && sel){ sel.value = fixedId; sel.closest('.ht-field').style.display = 'none'; }
    const tpls = () => { const t = box.querySelector('[data-tpls]'); t.innerHTML = KUDOS_T[kind].map((s, k) => `<button class="ht-chip" data-t="${k}">${c.esc(s.length > 42 ? s.slice(0, 40) + '…' : s)}</button>`).join('');
      t.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { ta.value = KUDOS_T[kind][+b.dataset.t]; send.disabled = false; ta.focus(); }); };
    box.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; box.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); tpls(); });
    ta.oninput = () => send.disabled = ta.value.trim().length < 3;
    send.onclick = async () => { const id = fixedId || sel.value; await RS().addKudos({intern_id: id, from: 'HR программы', role: 'HR', kind, text: ta.value.trim()});
      c.toast(`${kind === 'kudos' ? 'Похвала' : 'Зона роста'} отправлена <b>${c.esc(id)}</b> — уже в кабинете стажёра`); ta.value = ''; send.disabled = true; onSent && onSent(); };
    tpls();
  }
  const TYPE_L = {mentor: 'Встреча с наставником', hr: 'Вопрос HR', anonymous: 'Сообщение о проблеме'};

  function inbox(el, ctx){
    injectCss(); const c = C(ctx);
    const S = {f: 'all', open: null};
    el.innerHTML = `<div class="ht"><div class="ht-panel"><div class="ht-row" style="justify-content:space-between;margin-bottom:12px"><div><h3 class="ht-h">Лента обращений</h3><p class="ht-sub" style="margin:0">Вопросы стажёров и запросы обратной связи в одном месте</p></div></div>
      <div class="ht-row ht-filters" style="margin-bottom:16px"></div><div class="ht-feed"></div></div>
      <div class="ht-panel"><h3 class="ht-h">Дать обратную связь стажёру</h3><p class="ht-sub">Похвала или зона роста — стажёр увидит у себя сразу.</p><div class="ht-top-fb"></div></div></div>`;
    const top = el.querySelector('.ht-top-fb'); top.innerHTML = fbForm(c, interns(c)[0]?.intern_id); bindFb(top, c);
    const fEl = el.querySelector('.ht-filters'), feedEl = el.querySelector('.ht-feed');
    const draw = async () => {
      const items = await feed();
      const F = {all: ['Все', () => true], anon: ['Анонимные', x => x.anon], fb: ['Запросы ОС', x => x.src === 'fb'], new: ['Новые', x => !x.done]};
      fEl.innerHTML = Object.entries(F).map(([k, [l, fn]]) => `<button class="ht-chip" data-f="${k}" aria-pressed="${k === S.f}">${l} <span class="ht-n">${items.filter(fn).length}</span></button>`).join('');
      fEl.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.f = b.dataset.f; draw(); });
      const L = items.filter(F[S.f][1]);
      feedEl.innerHTML = L.length ? L.map(x => `<div class="ht-item ${x.done ? 'ht-done' : ''}" data-key="${c.esc(x.key)}">
        <div class="ht-item-h">${x.done ? '<span class="ht-tag">готово</span>' : '<span class="ht-tag ht-new">новое</span>'}
          ${x.src === 'fb' ? `<span class="ht-tag ht-blue">Запрос ОС${x.to ? ' → ' + c.esc(x.to) : ''}</span>` : `<span class="ht-tag">${c.esc(TYPE_L[x.type] || 'Обращение')}</span>`}
          ${x.anon ? '<span class="ht-tag ht-yellow">анонимно</span>' : `<button class="ht-link ht-id" data-open="${c.esc(x.intern_id)}">${c.esc(x.intern_id)}</button>`}
          <time>${fmtAgo(x.at)}</time></div>
        <p>${c.esc(x.text || '')}</p>
        <div class="ht-row">${x.anon ? '<span class="ht-sub" style="margin:0;font-size:14px">Ответить лично нельзя — обсудите тему на встрече с блоком</span><span class="ht-grow"></span>'
          : `<button class="ht-btn ht-sm" data-act="fb">Ответить ОС</button><button class="ht-btn ht-sm ht-line" data-act="meet">Назначить 1:1</button><span class="ht-grow"></span>`}
          <button class="ht-btn ht-sm ht-ghost" data-act="done">${x.done ? 'Вернуть в работу' : '✓ Готово'}</button></div>
        <div class="ht-slot"></div></div>`).join('')
        : `<div class="ht-empty">Здесь пусто — новых обращений нет.<br><button class="ht-link" data-demo style="margin-top:8px">Демо: добавить тестовые обращения</button></div>`;
      feedEl.querySelectorAll('.ht-item').forEach(card => { const x = L.find(i => i.key === card.dataset.key), slot = card.querySelector('.ht-slot');
        card.querySelector('[data-open]')?.addEventListener('click', () => c.openIntern(x.intern_id));
        card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
          const a = b.dataset.act;
          if(a === 'done'){ const d = doneSet(); d.has(x.key) ? d.delete(x.key) : d.add(x.key); RS().ls.set(DONE_KEY, [...d]);
            if(!x.done) c.toast('Отмечено как готово'); draw(); el.dispatchEvent(new CustomEvent('radar:inbox', {bubbles: true})); return; }
          if(S.open === x.key + a){ S.open = null; slot.innerHTML = ''; return; } S.open = x.key + a;
          if(a === 'fb'){ slot.innerHTML = `<div class="ht-inline">${fbForm(c, x.intern_id, 'kudos', 'Ответ стажёру ' + x.intern_id)}</div>`; bindFb(slot, c, () => { slot.innerHTML = ''; S.open = null; }, x.intern_id); slot.querySelector('textarea').focus(); }
          if(a === 'meet'){ slot.innerHTML = `<div class="ht-inline"><div class="ht-row" style="align-items:flex-end"><label class="ht-field ht-grow" style="margin:0;min-width:200px"><span>Встреча 1:1 с ${c.esc(x.intern_id)} · 30 мин</span>
              <input type="datetime-local" value="${toLocalInput(nextWorkday(11))}"></label><button class="ht-btn" data-go>Назначить и скачать .ics</button></div></div>`;
            slot.querySelector('[data-go]').onclick = async () => { const start = new Date(slot.querySelector('input').value).toISOString(), title = `1:1 с HR — ${x.intern_id}`;
              const agenda = 'Разбор обращения: ' + (x.text || '').slice(0, 140);
              await RS().addMeeting({intern_id: x.intern_id, type: '1:1', title, start, minutes: 30, people: [x.intern_id, 'HR программы'], link: '', place: 'МТС Линк', agenda});
              RS().download(RS().ics({title, start, minutes: 30, description: agenda, location: 'МТС Линк'}), `1-1-${x.intern_id}.ics`);
              c.toast(`Встреча 1:1 назначена <b>${c.esc(x.intern_id)}</b> · ${fmtDT(start)}`); slot.innerHTML = ''; S.open = null; }; }
        }); });
      feedEl.querySelector('[data-demo]')?.addEventListener('click', seedDemo);
    };
    const seedDemo = async () => { const k = 'radar.intern-requests', all = RS().ls.get(k, []), t = Date.now();
      all.push({intern_id: null, type: 'anonymous', anonymous: true, text: 'В команде не дают обратную связь по задачам, не понимаю, всё ли делаю правильно', at: new Date(t - 3600e3).toISOString()},
               {intern_id: 'СТ-004', type: 'hr', anonymous: false, text: 'Вопрос про нагрузку: три задачи с одним сроком, не успеваю', at: new Date(t - 7200e3).toISOString()});
      RS().ls.set(k, all); await RS().requestFeedback({intern_id: 'СТ-003', to: 'HR', text: 'Хочу понять, как у меня идут дела по итогам месяца'}); draw(); };
    live(el, k => { if(/intern-requests|fbreq|inbox/.test(k)) draw(); });
    draw();
  }

  // =====================================================================
  // 3. КАДРОВЫЙ РЕЗЕРВ (9-box)
  // =====================================================================
  const B1 = 3.5, B2 = 4.3;
  const band = v => v >= B2 ? 2 : v >= B1 ? 1 : 0;
  // позиция 0..1: клетка по границам 3,5 / 4,3, внутри клетки — сжато, чтобы точка не наезжала на подпись (lo..hi)
  const pos = (v, lo, hi) => { v = Math.max(1, Math.min(5, Number(v) || 1)); const b = band(v);
    const f = b === 0 ? (v - 1) / (B1 - 1) : b === 1 ? (v - B1) / (B2 - B1) : (v - B2) / (5 - B2); return (b + lo + (hi - lo) * f) / 3; };
  // CELLS[y][x]: y — вовлечённость (0 низ), x — результат (0 лево)
  const CELLS = [
    [{n: 'Критично', s: 'низкие результат и вовлечённость', cls: 'ht-c-risk', rec: 'Удержание: встреча'}, {n: 'Нужна поддержка', s: 'вовлечённость падает', cls: 'ht-c-risk', rec: 'Удержание: встреча'}, {n: 'Риск ухода', s: 'сильный, но теряет интерес', cls: 'ht-c-risk', rec: 'Удержание: встреча'}],
    [{n: 'Под вопросом', s: 'результат ниже ожиданий', cls: '', rec: 'Развивать: ИПР'}, {n: 'Стабильные', s: 'ровно, без рывка', cls: 'ht-c-mid', rec: 'Развивать: ИПР'}, {n: 'Сильные исполнители', s: 'результат есть, зажечь', cls: 'ht-c-mid', rec: 'Развивать: ИПР'}],
    [{n: 'Мотивированные', s: 'хотят, но нужен навык', cls: '', rec: 'Развивать: ИПР'}, {n: 'Растущие', s: 'кандидаты в резерв', cls: 'ht-c-mid', rec: 'Развивать: ИПР'}, {n: 'Звёзды', s: 'кандидаты на оффер', cls: 'ht-c-top', rec: 'Готовить оффер'}],
  ];
  const ST_L = {green: ['Норма', 'ht-green'], yellow: ['Внимание', 'ht-yellow'], red: ['Критично', 'ht-red']};
  function talent(el, ctx){
    injectCss(); const c = C(ctx);
    const L = interns(c).map(i => { const x = band(i.mentor_avg), y = band(i.intern_avg), cell = CELLS[y][x];
      let rec = cell.rec; if(i.status === 'red' && rec === 'Готовить оффер') rec = 'Удержание: встреча, затем оффер'; else if(i.status === 'red') rec = 'Удержание: встреча';
      // красный статус важнее клетки: сначала разобраться с проблемой, потом говорить об оффере
      const label = i.status === 'red' ? `${cell.n}, но сейчас «Критично»` : i.status === 'yellow' && x + y >= 3 ? `${cell.n}, есть сигнал` : cell.n;
      return {i, x, y, cell, rec, label}; });
    // разводим совпадающие точки
    const seen = {}; L.forEach(r => { const k = (+r.i.mentor_avg).toFixed(1) + '|' + (+r.i.intern_avg).toFixed(1); r.dup = seen[k] = (seen[k] ?? -1) + 1; });
    const offer = L.filter(r => r.rec === 'Готовить оффер').length, keep = L.filter(r => /Удержание/.test(r.rec)).length;
    el.innerHTML = `<div class="ht"><div class="ht-two ht-two-eq">
      <div class="ht-panel"><h3 class="ht-h">Матрица 9-box</h3><p class="ht-sub">По горизонтали — как наставник оценивает результат, по вертикали — как стажёр оценивает свою стажировку. Месяц ${c.period}. Цвет точки — статус светофора. Нажмите на стажёра.</p>
        <div class="ht-nine"><div class="ht-ylab">Вовлечённость (стажёр) →</div>
          <div class="ht-box">${[2, 1, 0].map(y => [0, 1, 2].map(x => `<div class="ht-cell ${CELLS[y][x].cls}">${CELLS[y][x].n}<small>${CELLS[y][x].s}</small></div>`).join('')).join('')}
            ${L.map(r => `<button class="ht-pt ${c.esc(r.i.status)}" data-open="${c.esc(r.i.intern_id)}" style="left:${(pos(r.i.mentor_avg, .2, .8) * 100).toFixed(1)}%;bottom:${(pos(r.i.intern_avg, .12, .55) * 100).toFixed(1)}%;margin-left:${r.dup * -18}px;margin-bottom:${r.dup * -18}px"
              title="${c.esc(r.i.intern_id)}: оценка наставника ${r.i.mentor_avg}, оценка стажёра ${r.i.intern_avg}${r.i.status === 'red' ? ' — сейчас Критично' : ''}">${c.esc(r.i.intern_id.replace(/^СТ-0*/, 'СТ-'))}</button>`).join('')}</div>
          <div></div><div class="ht-xlab">Результат (наставник) →</div></div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mgts-muted);margin:4px 0 0 34px"><span>1</span><span>${B1}</span><span>${B2}</span><span>5</span></div></div>
      <div class="ht-panel"><h3 class="ht-h">Готовность к офферу</h3><p class="ht-sub">Подсказка системы по оценкам и сигналам</p>
        <div class="ht-kpis"><div class="ht-kpi"><b>${offer}</b><span>готовить оффер</span></div><div class="ht-kpi ${keep ? 'ht-warn' : ''}"><b>${keep}</b><span>нужна встреча</span></div></div>
        <div class="ht-scroll"><table class="ht-table" style="min-width:520px"><thead><tr><th>Стажёр</th><th>Клетка</th><th>Статус</th><th>Рекомендация</th></tr></thead><tbody>
        ${L.slice().sort((a, b) => (b.y * 3 + b.x) - (a.y * 3 + a.x)).map(r => `<tr><td><button class="ht-link ht-id" data-open="${c.esc(r.i.intern_id)}">${c.esc(r.i.intern_id)}</button><div style="font-size:13px;color:var(--mgts-muted)">${c.esc(r.i.department)}</div></td>
          <td>${c.esc(r.label)}<div style="font-size:13px;color:var(--mgts-muted)">наставник ${String(r.i.mentor_avg).replace('.', ',')} · стажёр ${String(r.i.intern_avg).replace('.', ',')}</div></td>
          <td><span class="ht-tag ${(ST_L[r.i.status] || ST_L.green)[1]}"><i class="ht-dot ${c.esc(r.i.status)}"></i>${(ST_L[r.i.status] || ['—'])[0]}</span></td>
          <td class="ht-rec" style="color:${/оффер$/.test(r.rec) && !/Удержание/.test(r.rec) ? 'var(--st-green)' : /Удержание/.test(r.rec) ? 'var(--st-red)' : 'var(--mgts-navy)'}">${c.esc(r.rec)}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="ht-note"><b>!</b><span><b style="color:inherit">Решение принимает HR.</b> Матрица — подсказка, а не автоматическое решение по офферу.</span></div></div></div></div>`;
    el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => c.openIntern(b.dataset.open));
  }

  window.RadarHR = {views: {onboarding, inbox, talent}, inboxCount, _css: injectCss};
})();
