// Local matcher for the static intern cabinet. Rules and sources are shared with FastAPI.
(() => {
  const latin = "qwertyuiop[]asdfghjkl;'zxcvbnm,.";
  const cyrillic = "йцукенгшщзхъфывапролджэячсмитьбю";
  const split = /[?;\n]+|(?:,?\s+)(?:и|а)\s+(?=(?:как|сколько|где|куда|когда|кто|что|почему|до какого)(?![а-яё]))/iu;
  let pending;

  function load() {
    if (!pending) {
      pending = fetch("data/intern-assistant.json")
        .then(response => {
          if (!response.ok) throw new Error("Knowledge unavailable");
          return response.json();
        })
        .catch(error => { pending = null; throw error; });
    }
    return pending;
  }

  function wordsOf(text) {
    let value = text.toLowerCase();
    if (value.trim() !== "feedback" && /^[a-z\s\[\];',.!?0-9]+$/.test(value)) {
      value = Array.from(value, char => cyrillic[latin.indexOf(char)] ?? char).join("");
    }
    return value.replaceAll("ё", "е").match(/[а-яa-z0-9]+/g) || [];
  }

  function oneEdit(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    let index = 0;
    while (index < Math.min(left.length, right.length) && left[index] === right[index]) index++;
    if (left.length < right.length) return left.slice(index) === right.slice(index + 1);
    if (left.length > right.length) return right.slice(index) === left.slice(index + 1);
    return left.slice(index + 1) === right.slice(index + 1)
      || (left[index] === right[index + 1] && left[index + 1] === right[index]
          && left.slice(index + 2) === right.slice(index + 2));
  }

  function clueScore(words, clue) {
    const prefix = clue.endsWith("*");
    const stem = prefix ? clue.slice(0, -1) : clue;
    if (words.some(word => prefix ? word.startsWith(stem) : word === stem)) return 3;
    if (stem.length < 5) return 0;
    const fuzzy = words.some(word => {
      if (!prefix) return oneEdit(word, stem);
      return [stem.length - 1, stem.length, stem.length + 1]
        .some(length => word.length >= length && oneEdit(word.slice(0, length), stem));
    });
    return fuzzy ? 1 : 0;
  }

  function score(words, expression) {
    const groups = expression.split(" ").map(group => group.split("|"));
    const scores = groups.map(group => Math.max(...group.map(clue => clueScore(words, clue))));
    if (scores.includes(0)) return 0;
    if (scores.length === 1 && scores[0] === 1 &&
        Math.max(...groups[0].map(clue => clue.replace(/\*$/, "").length)) < 7) return 0;
    return scores.reduce((sum, value) => sum + value, 0) + 2 * (scores.length - 1);
  }

  function missing(detail) {
    return {status:"unknown", answer:`В доступных материалах не удалось подтвердить ${detail}. Уточни у HR или координатора программы.`};
  }

  function answerOne(question, previous, knowledge) {
    const words = wordsOf(question);
    const gap = Object.entries(knowledge.gaps)
      .map(([expression, detail]) => [score(words, expression), detail])
      .sort((a, b) => b[0] - a[0])[0];
    if (gap[0]) return missing(gap[1]);

    const matches = knowledge.topics.map(topic => ({
      topic,
      value: words.join(" ") === wordsOf(topic.question).join(" ") ? 100
        : Math.max(...topic.patterns.map(pattern => score(words, pattern))),
    })).filter(match => match.value).sort((a, b) => b.value - a.value);
    const wantsDraft = knowledge.draft_requests.some(pattern => score(words, pattern));

    if (!matches.length) {
      if (previous?.draft && wantsDraft && words.length <= 7) {
        return {status:"answered", topic:previous.id, answer:"Можно написать так.", draft:previous.draft};
      }
      if (previous?.id === "survey" && /^(?:(?:а|и) )?(?:где|куда)$/.test(words.join(" "))) {
        return missing("ссылку на актуальную форму");
      }
      if (["опрос*|анкет*|пульс*", "оценк*|балл*", "наставник*|ментор*"].some(clue => score(words, clue))) {
        return {status:"clarify", answer:"Что именно хочешь уточнить?",
          suggestions:[0, 2, 5].map(index => knowledge.topics[index].question)};
      }
      return {status:"unknown"};
    }
    const [{topic, value}, alternative] = matches;
    if (alternative && value - alternative.value < 3) {
      return {status:"clarify", answer:"Вижу несколько тем. С какой начнём?",
        suggestions:matches.slice(0, 3).map(match => match.topic.question)};
    }

    return {
      status:"answered", topic:topic.id, answer:topic.answer,
      source:{title:knowledge.sources[topic.source][0], excerpt:knowledge.excerpts[topic.source]},
      draft:wantsDraft ? topic.draft : undefined,
      suggestions:topic.draft && !wantsDraft ? ["Как это написать?"] : [],
    };
  }

  function resolve(question, topic, knowledge) {
    let previous = knowledge.topics.find(entry => entry.id === topic);
    const parts = question.split(split).map(part => part.trim()).filter(Boolean);
    const replies = (parts.length < 2 ? [question] : parts).map(part => {
      const reply = answerOne(part, previous, knowledge);
      previous = knowledge.topics.find(entry => entry.id === reply.topic);
      return {...reply, question:part};
    });
    return {replies, topic:replies.findLast(reply => reply.status === "answered")?.topic ?? null};
  }

  globalThis.InternAssistant = {
    resolve,
    async ask(question, topic) { return resolve(question, topic, await load()); },
  };
})();
