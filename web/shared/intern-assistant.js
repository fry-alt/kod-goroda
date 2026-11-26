// Куб — помощник стажёра. Отвечает только по базе программы, оценок и сигналов HR не видит.
// 1) Поиск BM25 по фрагментам: памятка (правит HR), чек-лист, правила опроса, ответы про кабинет, «твоя команда».
//    Слова приводятся к основе (простой стемминг), опечатки ловим по расстоянию 1–2, раскладку qwerty чиним.
// 2) Ответ — текст найденного фрагмента + источник («Из памятки: Пропуск»).
// 3) Если есть API с ключами LLM — POST /api/intern-chat: модель переформулирует ответ СТРОГО по найденным
//    фрагментам (RAG). Без сети/ключей/на Vercel работает п.1–2 целиком в браузере.
// 4) Ничего не нашлось — честно говорим и предлагаем «Написать HR».
(() => {
  const latin = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
  const cyrillic = "йцукенгшщзхъфывапролджэячсмитьбюё";
  const STOP = new Set(("а и в во на но не ни по с со к ко у о об от до за из изо для при про без над под же ли бы то это этот эта эти как где когда куда что чем кто кого кому зачем почему какой какая какие каком сколько " +
    "я мне меня мной мой моя мои моё мое ты тебе тебя твой твоя вы вам вас ваш он она они его ее её их нам нас мы " +
    "можно нужно надо есть был была было быть будет будут если или ещё еще уже вот так там тут всё все весь очень просто скажи подскажи расскажи пожалуйста привет здравствуй куб слушай вообще " +
    "делать сделать ничего ничем дадут дают дать хочу хотел хотела могу может можешь будешь буду стажировка стажировке стажировки стажировку стажер стажёр стажера программа программе программы мгтс компании компания").split(" "));
  const ENDINGS = ["иями","ями","ами","ией","иях","иям","ого","его","ому","ему","ыми","ими","ешь","ете","ишь","ите","ться","тся","ешься",
    "ая","яя","ое","ее","ые","ие","ый","ий","ой","ей","ом","ем","ам","ям","ах","ях","ую","юю","ов","ев","ть","ет","ют","ут","ит","ат","ят","ла","ло","ли","ал","ил","ел",
    "а","я","о","е","ы","и","у","ю","ь","й"];
  const SPLIT = /[?\n]+|(?:,?\s+)(?:и|а)\s+(?=(?:как|сколько|где|куда|когда|кто|что|почему|можно)(?![а-яё]))/iu;
  const DRAFT = /(как|что) (это |ему |ей |им )?(написать|сформулировать|сказать)|черновик|шаблон|пример (текста|сообщения)|напиши за меня/i;
  let pending;

  function load() {
    if (!pending) {
      const get = url => fetch(url, {cache: "no-store"}).then(r => { if (!r.ok) throw new Error(url); return r.json(); });
      pending = Promise.all([get("data/intern-kb.json"), get("data/intern-assistant.json").catch(() => ({topics: []}))])
        .then(([kb, rules]) => ({kb, rules}))
        .catch(error => { pending = null; throw error; });
    }
    return pending;
  }

  function fixLayout(text) {
    const value = text.toLowerCase();
    if (!/^[a-z\s\[\];',.`!?0-9-]+$/.test(value) || /\b(hr|it|vpn|feedback)\b/.test(value)) return value;
    return Array.from(value, ch => (latin.indexOf(ch) >= 0 ? cyrillic[latin.indexOf(ch)] : ch)).join("");
  }
  function stem(word) {
    if (word.length <= 3) return word;
    for (const end of ENDINGS) {
      if (word.length - end.length >= 3 && word.endsWith(end)) { word = word.slice(0, -end.length); break; }
    }
    return word.slice(0, 6);
  }
  function tokens(text, keepStop = false) {
    const words = fixLayout(String(text || "")).replaceAll("ё", "е").match(/[а-яa-z0-9]+/g) || [];
    return words.filter(w => keepStop || !STOP.has(w)).map(stem).filter(w => w.length > 1);
  }
  // расстояние Дамерау–Левенштейна с ранним выходом
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    const d = Array.from({length: a.length + 1}, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      let rowMin = Infinity;
      for (let j = 1; j <= b.length; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
        rowMin = Math.min(rowMin, d[i][j]);
      }
      if (rowMin > max) return max + 1;
    }
    return d[a.length][b.length];
  }

  // ---------- база фрагментов ----------
  function buildDocs(data, ctx) {
    const {kb, rules} = data, onb = ctx.onb || {}, docs = [];
    // keys — разговорные синонимы (вес ×2), raw — готовые основы из правил опроса (без стемминга), phrases — точные фразы
    const add = (doc, keys = "", raw = []) => docs.push({boost: 1, ...doc,
      phrases: (doc.phrases || []).map(p => " " + tokens(p, true).join(" ") + " "),
      terms: [...tokens(doc.title), ...tokens(doc.title), ...tokens(keys), ...tokens(keys), ...raw, ...raw, ...tokens(doc.text)]});
    for (const m of onb.memo || []) add({id: "memo:" + m.id, title: m.title, text: m.text, source: "Памятка", link: m.link, link_label: m.link_label, phrases: kb.memo_phrases?.[m.id]}, kb.memo_keys?.[m.id]);
    for (const f of kb.faq || []) add({id: "faq:" + f.id, title: f.title, text: f.text, source: f.source, actions: f.actions, phrases: f.phrases}, f.keys);
    const srcTitle = key => (rules.sources?.[key] || [])[0] || "Правила программы";
    for (const t of rules.topics || []) {
      const raw = (t.patterns || []).join(" ").toLowerCase().replaceAll("ё", "е").match(/[а-яa-z0-9]{3,}/g) || [];
      add({id: "rule:" + t.id, title: t.question, text: t.answer, source: srcTitle(t.source), draft: t.draft}, "", raw.filter(w => !STOP.has(w)).map(w => w.slice(0, 6)));
    }
    if (onb.checklist?.length) {
      const stages = [...new Set(onb.checklist.map(c => c.stage))];
      add({id: "checklist", title: "Чек-лист адаптации", source: "Чек-лист", boost: 0.7, phrases: ["чек лист", "чеклист", "первую неделю", "первый месяц"],
        text: stages.map(s => `${s}: ${onb.checklist.filter(c => c.stage === s).map(c => c.title.toLowerCase()).join(", ")}.`).join(" ") + " Отмечай пункты во вкладке «Шаги»."},
        "чек-лист чеклист шаги план адаптации что сделать в первую неделю первый месяц список дел что нужно успеть");
    }
    const team = onb.departments?.[ctx.department];
    if (ctx.mentor_id || team) {
      const mentor = ctx.mentor_id || team?.team?.find(p => p.role === "Наставник")?.who;
      add({id: "team", title: "Твоя команда", source: "Кабинет стажёра", phrases: ["мой наставник", "мой ментор", "кто наставник", "кто ментор", "мой куратор", "моя команда", "чат команды"],
        text: `Твой наставник — ${mentor || "его назначит HR"}${ctx.department ? `, ${ctx.department}` : ""}. По задачам — к нему, встреча 1:1 каждую неделю.` +
          (team?.chat ? ` Чат команды — ${team.chat.replace(/^Чат\s*/, "")}, добавит наставник в первый день.` : "") + " Вся команда — во вкладке «Команда»."},
        "кто мой наставник ментор руководитель бадди куратор команда чат команды кто отвечает за меня с кем работаю");
    }
    const hr = onb.program?.hr;
    if (hr) add({id: "hr", title: "Контакты HR", source: "Памятка",
      text: `${hr.role || "HR программы"}: ${hr.contact || "контакт в разделе «Команда»"}${hr.hours ? `, ${hr.hours}` : ""}. Можно и прямо отсюда — кнопка «Написать HR».`, actions: ["hr"]},
      "контакт hr эйчар почта hr телефон hr как связаться с hr часы работы hr координатор");
    if (onb.program?.months) add({id: "program", title: "О программе", source: "Памятка",
      text: `${onb.program.name || "Программа стажировки"} длится ${onb.program.months} месяцев. Раз в месяц короткий пульс-опрос, в 3-м месяце промежуточная встреча, в 6-м финальная.`},
      "сколько длится срок длительность месяцев полгода когда закончится этапы");
    return docs;
  }

  function buildIndex(docs) {
    const df = new Map(), vocab = new Set();
    docs.forEach(d => { d.tf = new Map(); d.terms.forEach(t => d.tf.set(t, (d.tf.get(t) || 0) + 1)); d.len = d.terms.length; d.tf.forEach((_, t) => { df.set(t, (df.get(t) || 0) + 1); vocab.add(t); }); });
    const avg = docs.reduce((s, d) => s + d.len, 0) / Math.max(docs.length, 1);
    return {docs, df, vocab: [...vocab], avg, N: docs.length};
  }

  // термин запроса → термины базы (точно, по префиксу, с опечаткой)
  function expand(term, index, memo) {
    if (memo.has(term)) return memo.get(term);
    const out = [];
    for (const v of index.vocab) {
      if (v === term) { out.push([v, 1]); continue; }
      const short = Math.min(v.length, term.length);
      if (short >= 4 && (v.startsWith(term) || term.startsWith(v))) { out.push([v, 0.75]); continue; }
      const max = term.length >= 8 ? 2 : term.length >= 4 ? 1 : 0;
      if (max && dist(term, v, max) <= max) out.push([v, 0.6]);
    }
    memo.set(term, out);
    return out;
  }

  function search(question, index, k = 3) {
    const q = [...new Set(tokens(question))], memo = new Map(), k1 = 1.2, b = 0.6;
    const line = " " + tokens(question, true).join(" ") + " ";
    const scored = index.docs.map(d => {
      let score = 0, hits = 0;
      for (const t of q) {
        let best = 0;
        for (const [v, w] of expand(t, index, memo)) {
          const f = d.tf.get(v); if (!f) continue;
          const idf = Math.log(1 + (index.N - index.df.get(v) + 0.5) / (index.df.get(v) + 0.5));
          best = Math.max(best, w * idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avg)));
        }
        if (best) { score += best; hits++; }
      }
      const phrase = d.phrases.some(p => p.trim() && line.includes(p));
      if (phrase) score += 4;
      score *= d.boost;
      return {doc: d, score, hits, phrase, coverage: q.length ? hits / q.length : 0};
    }).filter(r => r.score > 0).sort((a, b2) => b2.score - a.score);
    // слова, которых в базе нет совсем (не опечатка, не форма): «парковка», «зарплата»
    const words = fixLayout(question).replaceAll("ё", "е").match(/[а-яa-z0-9]+/g) || [];
    const unknown = q.filter(t => t.length >= 3 && !expand(t, index, memo).length)
      .map(t => words.find(w => stem(w) === t) || t);
    return {terms: q, unknown, results: scored.slice(0, k)};
  }

  const MIN_SCORE = 1.6;
  let cache = {key: null, index: null};

  function answerOne(question, prev, data, ctx) {
    const key = JSON.stringify([ctx.onb?.memo, ctx.onb?.checklist, ctx.department, ctx.mentor_id]);
    if (cache.key !== key) cache = {key, index: buildIndex(buildDocs(data, ctx))};
    const wantsDraft = DRAFT.test(question);
    const {terms, unknown, results} = search(question, cache.index);
    // «как это написать?» после ответа с черновиком
    if (wantsDraft && prev?.draft && (!results.length || terms.length <= 2)) {
      return {status: "answered", question, doc: prev, answer: "Можно написать так:", draft: prev.draft, fragments: [prev]};
    }
    const top = results[0];
    if (!top || top.score < MIN_SCORE || (top.coverage < 0.34 && top.score < 3.5) || (unknown.length && top.coverage <= 0.5 && !top.phrase && top.score < 6)) {
      return {status: "unknown", question, terms, unknown, best: top && {title: top.doc.title, score: +top.score.toFixed(2)}};
    }
    const doc = top.doc, also = results.slice(1).filter(r => r.score >= Math.max(MIN_SCORE, top.score * 0.8) && r.doc.title !== doc.title);
    return {
      status: "answered", question, doc, answer: doc.text, score: +top.score.toFixed(2), unknown,
      source: {kind: doc.source, title: doc.title},
      draft: wantsDraft ? doc.draft : undefined,
      suggestions: [...(doc.draft && !wantsDraft ? ["Как это написать?"] : []), ...also.slice(0, 1).map(r => r.doc.title)],
      actions: doc.actions || [],
      fragments: results.filter(r => r.score >= MIN_SCORE).map(r => r.doc),
    };
  }

  function resolve(question, prevId, data, ctx = {}) {
    let prev = prevId || null;
    const parts = question.split(SPLIT).map(p => p.trim()).filter(p => tokens(p).length);
    const replies = (parts.length < 2 ? [question] : parts).map(part => {
      const r = answerOne(part, prev, data, ctx);
      if (r.doc) prev = r.doc;
      return r;
    });
    return {replies, topic: [...replies].reverse().find(r => r.doc)?.doc ?? null};
  }

  // RAG через бэк: модель только переформулирует найденные фрагменты. null → показываем фрагмент как есть.
  async function llm(api, reply, timeout = 6000) {
    if (!api || reply.status !== "answered" || reply.draft) return null;
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(api + "/api/intern-chat", {method: "POST", signal: ctrl.signal, headers: {"Content-Type": "application/json"},
        body: JSON.stringify({question: reply.question, fragments: reply.fragments.slice(0, 3).map(d => ({title: d.title, source: d.source, text: d.text}))})});
      if (!r.ok) return null;
      const j = await r.json();
      return j && typeof j.answer === "string" && j.answer.trim() ? j : null;
    } catch { return null; } finally { clearTimeout(t); }
  }

  globalThis.InternAssistant = {
    tokens, stem, resolve, load,
    async ask(question, prev, ctx = {}) {
      const res = resolve(question, prev, await load(), ctx);
      if (ctx.api) {
        await Promise.all(res.replies.map(async reply => {
          const out = await llm(ctx.api, reply);
          if (out) { reply.answer = out.answer; reply.engine = out.engine; }
        }));
      }
      return res;
    },
  };
})();
