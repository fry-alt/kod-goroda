// Общая логика «почему стажёр в зоне внимания» для дашборда и отчётов.
// Сигналы бэка группируем по причине: «Нагрузка», «Низкая оценка: нагрузка» и «Снижение: нагрузка» — одна проблема с тремя основаниями.
// Аналитику не пересчитываем — только объединяем и формулируем по-человечески.
(function(){
const plural = (n, f) => f[(n % 10 === 1 && n % 100 !== 11) ? 0 : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 1 : 2];
const SUBJ = [
  [/средний балл/i, 'Общий уровень оценок'],
  [/пропуск|не заполн/i, 'Пропуск анкеты'],
  [/нагруз|срок/i, 'Нагрузка и сроки'],
  [/поддерж|обратн/i, 'Поддержка наставника'],
  [/понятн|понимание задач|задачи и их/i, 'Понятность задач'],
  [/удовлетвор/i, 'Удовлетворённость стажировкой'],
  [/самостоят|качество выполн|навык/i, 'Самостоятельность и навыки'],
  [/интерес|вовлеч|инициатив/i, 'Интерес и вовлечённость'],
  [/коммуник|команд|взаимодейств/i, 'Команда и коммуникация'],
  [/развити/i, 'Профессиональное развитие'],
  [/процесс|организац/i, 'Процессы и организация'],
];
const KIND = {'Низкая оценка':'Низкая оценка', 'Снижение':'Падение к личной норме', 'Расхождение':'Стажёр и наставник оценивают по-разному', 'Низкий средний балл':'Низкий средний балл'};
function subjOf(s){ const t = String(s.title || ''), body = (t.includes(':') ? t.split(':').slice(1).join(':') : t).split(',')[0];
  return (SUBJ.find(([re]) => re.test(t.includes('средний балл') ? t : body)) || [0, body.trim() || t])[1]; }
function kindOf(s){ const t = String(s.title || ''); if(!t.includes(':')) return 'Комментарии в анкете'; const k = t.split(':')[0].trim(); return KIND[k] || k; }
function groupsOf(c){
  const G = {};
  for(const s of c.signals || []){ const k = subjOf(s), g = G[k] ||= {id:'g:' + k, subj:k, level:'yellow', sigs:[]}; g.sigs.push(s); if(s.level === 'red') g.level = 'red'; }
  return Object.values(G).map(g => {
    const seen = new Set(), ev = [];
    for(const s of g.sigs) for(const e of s.evidence || []){ const key = e.period + '|' + e.source + '|' + (e.quote || e.field + e.value); if(!seen.has(key)){ seen.add(key); ev.push(e); } }
    ev.sort((a, b) => (b.quote ? 1 : 0) - (a.quote ? 1 : 0) || b.period - a.period);
    return {...g, ev, title:g.subj, evidence:ev};
  }).sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1) || b.sigs.length - a.sigs.length);
}
function whoOf(g){
  const pairOnly = g.sigs.every(s => /\|pair-/.test(s.id) || /^Расхождение/.test(s.title));
  if(pairOnly) return 'стажёр и наставник оценивают это по-разному';
  const src = new Set(g.ev.map(e => e.source));
  return src.has('стажёр') && src.has('наставник') ? 'это отмечают и стажёр, и наставник' : src.has('наставник') ? 'это отмечает наставник' : 'это отмечает стажёр';
}
function summaryOf(c, groups){
  if(!groups.length) return c.status === 'green' ? 'Всё спокойно: оценки ровные, тревожных комментариев нет. Достаточно планового опроса.' : (c.summary || '—');
  const g = groups[0], last = Math.max(...g.ev.map(e => +e.period || 0));
  let s = `Главное — ${g.subj.toLowerCase()}: ${whoOf(g)}${last ? ` (Месяц ${last})` : ''}.`;
  if(groups.length > 1) s += ` Ещё ${groups.length - 1 === 1 ? 'одна причина' : (groups.length - 1) + ' ' + plural(groups.length - 1, ['причина', 'причины', 'причин'])}: ${groups.slice(1, 3).map(x => x.subj.toLowerCase()).join(', ')}${groups.length > 3 ? ' и другие' : ''}.`;
  return s;
}
window.RadarInsight = {plural, groupsOf, whoOf, summaryOf, kindOf, subjOf};
})();
