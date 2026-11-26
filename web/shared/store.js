// Общее хранилище фронта для дашборда HR и кабинета стажёра.
// Сначала пробует API бэка. Если API нет (Vercel, бэк лежит, эндпоинт ещё не сделан) — пишет в localStorage,
// поэтому демо работает в одном браузере: HR похвалил в дашборде → стажёр видит это у себя (событие storage).
// Эндпоинты для Андрея (все необязательные):
//   GET/PUT  /api/onboarding                      памятка (JSON как data/onboarding.json)
//   GET/POST /api/checklist/{intern_id}           {done:[ids]}
//   GET/POST /api/kudos                           [{id,intern_id,from,role,kind,text,at}]
//   GET/POST /api/feedback-requests               [{id,intern_id,to,text,at,status}]
//   GET/POST /api/meetings                        [{id,intern_id,type,title,start,minutes,people,link}]
//   GET      /api/intern-requests                 обращения стажёров (POST уже шлёт кабинет стажёра)
//   POST     /api/huntflow/sync                    {intern_id,period,status,comment,tags}
(function(){
  const qs = new URLSearchParams(location.search);
  const API = (() => { let a = qs.get('api'); try { if(a) localStorage.setItem('radar.api', a); else a = localStorage.getItem('radar.api'); } catch {}
    return (a || window.RADAR_API || '').replace(/\/$/, ''); })();
  const STATIC = /vercel\.app$|netlify\.app$|github\.io$/.test(location.hostname) && !API;
  // Бэк через HTTPS-туннель (ngrok / Pinggy) в бесплатном режиме отдаёт браузеру HTML-заглушку вместо JSON.
  // Эти заголовки её отключают. Добавляем их ко ВСЕМ запросам к API на странице (store, дашборд, кабинет, отчёты), см. issue #4.
  if(API && !window.__radarTunnel){
    window.__radarTunnel = true;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if(url.startsWith(API)){
        const h = new Headers(init.headers || (typeof input !== 'string' && input.headers) || undefined);
        h.set('ngrok-skip-browser-warning', '1'); h.set('X-Pinggy-No-Screen', '1');
        init = {...init, headers: h};
      }
      return nativeFetch(input, init);
    };
  }
  const ls = {
    get(k, d){ try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  async function api(path, opt){
    if(STATIC) return null;
    try { const r = await fetch(API + path, {cache:'no-store', signal: AbortSignal.timeout?.(10000), ...opt}); return r.ok ? await r.json() : null; } catch { return null; }
  }
  const post = (path, body, method = 'POST') => api(path, {method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)});
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nowIso = () => new Date().toISOString();
  // список: локальные записи + с бэка, без дублей по id
  async function list(key, path, filter){
    const remote = await api(path); const local = ls.get(key, []);
    const all = [...(Array.isArray(remote) ? remote : []), ...local];
    const seen = new Set(), kf = x => x.id || (x.at + '|' + (x.text || ''));
    const out = all.filter(x => x && !seen.has(kf(x)) && seen.add(kf(x)));
    out.sort((a, b) => String(b.at || b.start || '').localeCompare(String(a.at || a.start || '')));
    return filter ? out.filter(filter) : out;
  }
  async function add(key, path, item){
    const rec = {id: uid(), at: nowIso(), ...item};
    const all = ls.get(key, []); all.unshift(rec); ls.set(key, all.slice(0, 300));
    post(path, rec);
    return rec;
  }

  const RS = {
    API, STATIC, ls, uid,

    // ---- памятка стажёра ----
    async memo(){
      const saved = ls.get('radar.memo', null); if(saved) return saved;
      const remote = await api('/api/onboarding'); if(remote && remote.memo) return remote;
      return fetch('data/onboarding.json', {cache:'no-store'}).then(r => r.json());
    },
    saveMemo(m){ ls.set('radar.memo', m); post('/api/onboarding', m, 'PUT'); },
    resetMemo(){ try { localStorage.removeItem('radar.memo'); } catch {} },

    // ---- чек-лист адаптации ----
    checklist(id){ return ls.get('radar.check.' + id, []); },
    async checklistRemote(id){ const r = await api('/api/checklist/' + encodeURIComponent(id)); return r?.done || RS.checklist(id); },
    toggleCheck(id, item){
      const d = new Set(RS.checklist(id)); d.has(item) ? d.delete(item) : d.add(item);
      const done = [...d]; ls.set('radar.check.' + id, done); post('/api/checklist/' + encodeURIComponent(id), {done}); return done;
    },

    // ---- обратная связь стажёру (похвала / зона роста) ----
    kudos: (internId) => list('radar.kudos', '/api/kudos', internId ? x => x.intern_id === internId : null),
    addKudos: (k) => add('radar.kudos', '/api/kudos', k),       // {intern_id, from, role:'HR'|'Наставник'|'Коллега', kind:'kudos'|'grow', text}

    // ---- запросы ОС от стажёра ----
    feedbackRequests: (internId) => list('radar.fbreq', '/api/feedback-requests', internId ? x => x.intern_id === internId : null),
    requestFeedback: (r) => add('radar.fbreq', '/api/feedback-requests', {status:'new', ...r}),  // {intern_id, to:'Наставник'|'HR'|'Команда', text}

    // ---- обращения стажёров (кабинет стажёра пишет в radar.intern-requests) ----
    internRequests: () => list('radar.intern-requests', '/api/intern-requests'),

    // ---- встречи: 1:1, знакомство с командой ----
    meetings: (internId) => list('radar.meetings', '/api/meetings', internId ? x => x.intern_id === internId : null),
    addMeeting: (m) => add('radar.meetings', '/api/meetings', m),  // {intern_id, type:'1:1'|'intro'|'mid'|'final', title, start, minutes, people:[...], link}

    // ---- файл приглашения в календарь (Outlook / Яндекс / Google открывают .ics) ----
    ics({title, start, minutes = 30, description = '', location = '', attendees = []}){
      const d = new Date(start), e = new Date(d.getTime() + minutes * 60000);
      const f = x => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const esc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MGTS//Radar//RU', 'METHOD:REQUEST', 'BEGIN:VEVENT',
        'UID:' + uid() + '@radar.mgts', 'DTSTAMP:' + f(new Date()), 'DTSTART:' + f(d), 'DTEND:' + f(e),
        'SUMMARY:' + esc(title), 'DESCRIPTION:' + esc(description), 'LOCATION:' + esc(location),
        ...attendees.filter(a => /@/.test(a)).map(a => 'ATTENDEE;ROLE=REQ-PARTICIPANT:mailto:' + a),
        'END:VEVENT', 'END:VCALENDAR'];
      return new Blob([lines.join('\r\n')], {type: 'text/calendar;charset=utf-8'});
    },
    download(blob, name){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); },

    // ---- Huntflow: комментарий и метка в карточку кандидата ----
    async huntflow(payload){ const r = await post('/api/huntflow/sync', payload); const log = ls.get('radar.huntflow', {});
      log[payload.intern_id] = nowIso(); ls.set('radar.huntflow', log); return r || {ok:true, demo:true}; },
    huntflowSentAt: (id) => ls.get('radar.huntflow', {})[id] || null,

    // подписка на изменения из другой вкладки (HR ↔ стажёр)
    onChange(fn){ addEventListener('storage', e => { if(e.key && e.key.startsWith('radar.')) fn(e.key); }); },
  };
  window.RadarStore = RS;
})();
