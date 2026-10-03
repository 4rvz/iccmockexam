/*
 * Shared exam engine.
 *
 * Call initExam({ passPct, minutes, sections }) where each section is:
 *   { title: "Part A — Multiple Choice", type: "mc"|"tf", key: "mc", items: [...] }
 * An "mc" item is { n, text, opts:{A,B,C,D}, ans:"B" }.
 * A  "tf" item is { n, text, ans:"T" }.
 * `minutes` is the timed-exam length; it defaults to one minute per item.
 *
 * `key` prefixes the radio-group names and element ids, so two sections in the
 * same exam never collide. The page provides an empty <main id="exam"> to render into.
 *
 * Progress is saved to localStorage per page, so a refresh or a closed tab
 * picks up where the user left off.
 *
 * Each start shuffles the questions within every section and the choices within
 * every "mc" item. The shuffle is saved with the progress, so it holds across
 * reloads. Answers are always stored by the item's original letter.
 */

function initExam(config){
  const sections = config.sections;
  const passPct = config.passPct;
  const allItems = sections.flatMap(s => s.items.map(q => ({q, section: s, name: s.key + q.n})));
  const byName = Object.fromEntries(allItems.map(it => [it.name, it]));
  const totalItems = allItems.length;
  const passMark = Math.ceil(totalItems * passPct / 100);
  const minutes = config.minutes || totalItems;
  const storageKey = 'mockexam:' + location.pathname.replace(/\/+$/, '');
  // Progress saved before the /iccmockexam → /mockexam rename.
  const legacyKey = 'iccmockexam:' + location.pathname.replace(/\/+$/, '')
    .replace(/^\/mockexam/, '/iccmockexam').replace(/\/traditional-life-full$/, '/iiap-trad');
  const scrollBehavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

  // "All of the above" and friends keep their slot; a choice that names another
  // choice by letter ("Both a & b") means the whole item keeps its order.
  const PINNED = /\b(all|none|any)\b.*\babove\b/i;
  const NAMES_LETTER = /^(both|either|neither) [a-d]\b|\b[a-d] (&|and|or) [a-d]\b/i;

  let state = load() || freshState();
  let flagMissing = false;
  let showOnlyMissed = false;
  let timerId = null;
  let lastWarnedMinute = null;

  function h(tag, props, ...children){
    const node = document.createElement(tag);
    for(const [k, v] of Object.entries(props || {})){
      if(v == null || v === false) continue;
      if(k === 'class') node.className = v;
      else if(k === 'text') node.textContent = v;
      else if(k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    children.flat().forEach(c => { if(c != null) node.append(c); });
    return node;
  }

  /* ---- Saved state ---- */

  function freshState(){
    return {v: 1, mode: null, startedAt: null, deadline: null, answers: {}, checked: [],
            graded: false, timeUp: false, round: null, firstScore: null, order: null, opts: null};
  }

  /* ---- Shuffle ---- */

  function shuffle(list){
    const a = list.slice();
    for(let i = a.length - 1; i > 0; i--){
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function letters(s, q){
    return s.type === 'tf' ? ['T', 'F'] : ['A', 'B', 'C', 'D'].filter(l => q.opts[l]);
  }

  function shuffleOpts(s, q){
    const base = letters(s, q);
    if(s.type === 'tf' || base.some(l => NAMES_LETTER.test(q.opts[l]))) return base;
    const loose = shuffle(base.filter(l => !PINNED.test(q.opts[l])));
    return base.map(l => PINNED.test(q.opts[l]) ? l : loose.shift());
  }

  function shuffled(){
    return {
      order: Object.fromEntries(sections.map(s => [s.key, shuffle(s.items.map(q => s.key + q.n))])),
      opts: Object.fromEntries(allItems.map(it => [it.name, shuffleOpts(it.section, it.q)])),
    };
  }

  // Fill in or repair the saved shuffle so it covers exactly the current items.
  function withLayout(st){
    const fresh = shuffled();
    const order = {}, opts = {};
    sections.forEach(s => {
      const saved = (st.order && st.order[s.key] || []).filter(n => byName[n] && byName[n].section === s);
      const added = fresh.order[s.key].filter(n => !saved.includes(n));
      order[s.key] = saved.concat(added);
    });
    allItems.forEach(it => {
      const saved = st.opts && st.opts[it.name];
      const base = letters(it.section, it.q);
      const valid = saved && saved.length === base.length && base.every(l => saved.includes(l));
      opts[it.name] = valid ? saved : fresh.opts[it.name];
    });
    return {...st, order, opts};
  }

  function load(){
    try{
      const saved = JSON.parse(localStorage.getItem(storageKey) || localStorage.getItem(legacyKey));
      if(!saved || saved.v !== 1 || !saved.startedAt) return null;
      // Drop anything that no longer matches the question set.
      saved.answers = Object.fromEntries(Object.entries(saved.answers || {}).filter(([n]) => byName[n]));
      saved.checked = (saved.checked || []).filter(n => byName[n]);
      if(saved.round) saved.round = saved.round.filter(n => byName[n]);
      if(saved.round && !saved.round.length) saved.round = null;
      return withLayout({...freshState(), ...saved});
    }catch(e){ return null; }
  }

  function save(){
    try{ localStorage.setItem(storageKey, JSON.stringify(state)); }catch(e){}
  }

  function clearSaved(){
    try{ localStorage.removeItem(storageKey); localStorage.removeItem(legacyKey); }catch(e){}
  }

  const position = name => {
    const it = byName[name];
    return sections.indexOf(it.section) * 1e6 + (state.order ? state.order[it.section.key].indexOf(name) : it.q.n);
  };
  const active = () => (state.round ? state.round.map(n => byName[n]) : allItems.slice())
    .sort((a, b) => position(a.name) - position(b.name));
  const isCorrect = it => state.answers[it.name] === it.q.ans;
  const cardOf = name => document.getElementById(byName[name].section.key + '-q-' + byName[name].q.n);
  // The letter a choice shows on screen after shuffling.
  const shownLetter = (name, v) => state.opts ? 'ABCD'[state.opts[name].indexOf(v)] : v;
  const answerLabel = (section, v, name) => section.type === 'tf' ? (v === 'T' ? 'True' : 'False') : shownLetter(name, v);
  const isLocked = name => state.graded || state.checked.includes(name);

  /* ---- Build ---- */

  function buildStart(){
    const choice = (value, title, desc) => h('label', {class: 'mode-opt'},
      h('input', {type: 'radio', name: 'mode', value, checked: value === 'study'}),
      h('span', {},
        h('span', {class: 'mode-title', text: title}),
        h('span', {class: 'mode-desc', text: desc})));
    return h('section', {class: 'start', 'aria-labelledby': 'startTitle'},
      h('h2', {class: 'start-title', id: 'startTitle', text: 'How do you want to practice?'}),
      h('div', {class: 'modes', role: 'radiogroup', 'aria-labelledby': 'startTitle'},
        choice('study', 'Study', 'Check each answer as you go. No clock.'),
        choice('exam', 'Timed exam', `${minutes} minutes on the clock. Answers stay hidden until you submit.`)),
      h('button', {type: 'button', class: 'btn primary', onclick: start}, 'Start'),
      h('p', {class: 'start-note', text: 'Your answers are saved in this browser, so you can close the tab and pick up where you left off.'}));
  }

  function buildCard(s, q){
    const name = s.key + q.n;
    const opts = letters(s, q).map(letter => h('label', {class: 'opt', 'data-opt': letter},
      h('input', {type: 'radio', name, value: letter}),
      h('span', {class: 'opt-text'},
        h('span', {class: 'opt-letter', text: s.type === 'tf' ? answerLabel(s, letter) : letter + '.'}),
        s.type === 'tf' ? null : ' ' + q.opts[letter])));

    const id = s.key + '-q-' + q.n;
    return h('fieldset', {class: s.type === 'tf' ? 'q tf-row' : 'q', id},
      h('legend', {},
        h('span', {class: 'qnum'}),
        h('span', {class: 'qtext', text: q.text})),
      h('div', {class: 'opts'}, opts),
      h('div', {class: 'q-foot'},
        h('button', {type: 'button', class: 'btn small', 'data-check': name, hidden: true}, 'Check answer'),
        h('p', {class: 'verdict', id: id + '-verdict', tabindex: '-1', hidden: true})));
  }

  const root = document.getElementById('exam');
  const startPanel = buildStart();

  const progressFill = h('div', {class: 'progress-fill'});
  const progressLabel = h('span', {class: 'progress-label'});
  const timerEl = h('span', {class: 'timer', role: 'timer', hidden: true});
  const restartBtn = h('button', {type: 'button', class: 'text-btn', onclick: () => startOver(restartBtn)}, 'Start over');
  const progressWrap = h('div', {class: 'progress-wrap'},
    h('div', {class: 'progress-track'}, progressFill),
    h('div', {class: 'progress-row'}, progressLabel, h('span', {class: 'progress-side'}, timerEl, restartBtn)));

  const result = h('section', {class: 'result-card', tabindex: '-1', 'aria-label': 'Result', hidden: true});

  const form = h('form', {class: 'quiz', onsubmit: e => e.preventDefault()});
  const parts = sections.map(s => {
    const part = h('section', {class: 'part'});
    if(s.title) part.append(h('h2', {class: 'section-title', text: s.title}));
    s.items.forEach(q => part.append(buildCard(s, q)));
    form.append(part);
    return part;
  });

  // Put cards and choices in the saved shuffled order, and number them as shown.
  function layout(){
    if(!state.order) return;
    sections.forEach((s, i) => {
      state.order[s.key].forEach((name, pos) => {
        const card = cardOf(name);
        card.querySelector('.qnum').textContent = `${s.itemLabel || 'Question'} ${pos + 1}`;
        parts[i].append(card);
        if(s.type === 'tf') return;
        const opts = card.querySelector('.opts');
        state.opts[name].forEach((letter, k) => {
          const opt = opts.querySelector(`[data-opt="${letter}"]`);
          opt.querySelector('.opt-letter').textContent = 'ABCD'[k] + '.';
          opts.append(opt);
        });
      });
    });
  }

  const submitBtn = h('button', {type: 'button', class: 'btn primary', onclick: requestSubmit});
  const confirmText = h('p', {class: 'confirm-text', role: 'alert'});
  const confirmActions = h('div', {class: 'confirm-actions'});
  const confirmBox = h('div', {class: 'confirm', hidden: true}, confirmText, confirmActions);
  const submitBar = h('div', {class: 'submit-bar'}, confirmBox, submitBtn);
  const announcer = h('div', {class: 'visually-hidden', role: 'status'});

  root.append(startPanel, progressWrap, result, form, submitBar, announcer);

  /* ---- Render ---- */

  function render(){
    const started = !!state.startedAt;
    startPanel.hidden = started;
    progressWrap.hidden = form.hidden = !started;
    submitBar.hidden = !started || state.graded;
    restartBtn.hidden = state.graded;
    form.classList.toggle('only-missed', showOnlyMissed && state.graded);

    const inRound = new Set(active().map(it => it.name));
    allItems.forEach(it => syncCard(it, inRound.has(it.name)));
    renderProgress();
    renderResult();
    submitBtn.textContent = state.round ? 'Finish retry'
      : state.mode === 'exam' ? 'Submit exam' : 'Finish and see score';
    tickTimer();
  }

  function syncCard({q, section, name}, inRound){
    const card = cardOf(name);
    const chosen = state.answers[name] || null;
    const reveal = isLocked(name);
    card.hidden = !inRound;
    // Checked answers are read-only, not disabled, so they stay in the tab order for review.
    card.classList.toggle('locked', reveal);
    if(reveal) card.setAttribute('aria-describedby', card.id + '-verdict');
    else card.removeAttribute('aria-describedby');
    card.classList.toggle('answered', !!chosen);
    card.classList.toggle('missing', flagMissing && !chosen && !reveal);
    card.classList.toggle('correct', reveal && chosen === q.ans);
    card.classList.toggle('incorrect', reveal && chosen !== q.ans);
    card.querySelectorAll('input').forEach(i => { i.checked = i.value === chosen; });
    card.querySelectorAll('.opt').forEach(o => {
      const letter = o.dataset.opt;
      o.classList.toggle('is-chosen', letter === chosen);
      o.classList.toggle('is-answer', reveal && letter === q.ans);
      o.classList.toggle('is-wrong', reveal && letter === chosen && chosen !== q.ans);
    });

    const verdict = card.querySelector('.verdict');
    verdict.hidden = !reveal;
    if(reveal){
      const ans = answerLabel(section, q.ans, name);
      verdict.className = 'verdict ' + (chosen === q.ans ? 'ok' : 'bad');
      verdict.textContent = chosen === q.ans ? `Correct — ${ans}.`
        : chosen ? `Incorrect — you chose ${answerLabel(section, chosen, name)}. The answer is ${ans}.`
        : `Not answered. The answer is ${ans}.`;
    }
    card.querySelector('[data-check]').hidden = !(state.mode === 'study' && chosen && !reveal);
  }

  function renderProgress(){
    const items = active();
    const answered = items.filter(it => state.answers[it.name]).length;
    progressFill.style.transform = `scaleX(${items.length ? answered / items.length : 0})`;

    let text = (state.round ? 'Retry' : state.mode === 'exam' ? 'Timed exam' : 'Study')
      + ` · ${answered} of ${items.length} answered`;
    if(state.mode === 'study' && !state.graded){
      const checked = items.filter(it => state.checked.includes(it.name));
      if(checked.length) text += ` · ${checked.filter(isCorrect).length} of ${checked.length} correct`;
    }
    progressLabel.textContent = text;
  }

  function renderResult(){
    result.hidden = !state.graded;
    if(!state.graded) return;

    const items = active();
    const score = items.filter(isCorrect).length;
    const missed = items.length - score;
    let verdict, scoreClass, details = [];

    if(state.round){
      verdict = missed ? 'Retry round' : 'All fixed';
      scoreClass = missed ? '' : 'pass';
      details.push(`${score} of the ${items.length} you retried ${score === 1 ? 'is' : 'are'} now correct.`);
      if(state.firstScore) details.push(`First attempt: ${state.firstScore.score} / ${state.firstScore.total}.`);
    } else {
      const passed = score >= passMark;
      const pct = Math.round((score / totalItems) * 1000) / 10;
      verdict = passed ? 'Passed' : 'Not passed yet';
      scoreClass = passed ? 'pass' : 'fail';
      details.push(`${pct}% · you need ${passMark} (${passPct}%) to pass.`
        + (passed ? '' : ` ${passMark - score} more correct would get you there.`));
      if(state.timeUp) details.push('Time ran out. Unanswered items were counted as wrong.');
    }

    const breakdown = !state.round && sections.length > 1
      ? h('ul', {class: 'breakdown'}, sections.map(s => {
          const part = allItems.filter(it => it.section === s);
          return h('li', {},
            h('span', {text: s.title || s.key}),
            h('span', {class: 'breakdown-score', text: `${part.filter(isCorrect).length} / ${part.length}`}));
        }))
      : null;

    const actions = h('div', {class: 'result-actions'});
    if(missed){
      actions.append(
        h('button', {type: 'button', class: 'btn primary', onclick: retryMissed},
          `Retry the ${missed} I missed`),
        h('button', {type: 'button', class: 'btn', 'aria-pressed': String(showOnlyMissed), onclick: toggleOnlyMissed},
          showOnlyMissed ? 'Show all questions' : `Show only the ${missed} missed`));
    }
    const again = h('button', {type: 'button', class: 'text-btn'}, 'Start over');
    again.addEventListener('click', () => startOver(again));
    actions.append(again);

    result.replaceChildren(
      h('h2', {class: 'result-verdict ' + scoreClass, text: verdict}),
      h('p', {class: 'result-score ' + scoreClass, text: `${score} / ${items.length}`}),
      ...details.map(d => h('p', {class: 'result-detail', text: d})),
      ...(breakdown ? [breakdown] : []),
      actions);
  }

  function tickTimer(){
    clearTimeout(timerId);
    const running = state.mode === 'exam' && state.deadline && !state.graded;
    timerEl.hidden = !running;
    if(!running) return;

    const left = state.deadline - Date.now();
    if(left <= 0){ grade(true); return; }
    const secs = Math.ceil(left / 1000);
    timerEl.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} left`;
    timerEl.classList.toggle('low', secs <= 300);

    const minute = Math.ceil(secs / 60);
    if((minute === 5 || minute === 1) && lastWarnedMinute !== minute){
      lastWarnedMinute = minute;
      announcer.textContent = `${minute} minute${minute === 1 ? '' : 's'} left.`;
    }
    timerId = setTimeout(tickTimer, (left % 1000) || 1000);
  }

  /* ---- Actions ---- */

  function start(){
    const mode = startPanel.querySelector('input[name=mode]:checked').value;
    const now = Date.now();
    state = {...freshState(), ...shuffled(), mode, startedAt: now, deadline: mode === 'exam' ? now + minutes * 60000 : null};
    save();
    layout();
    render();
    form.querySelector('input').focus({preventScroll: true});
  }

  function goTo(name){
    const card = cardOf(name);
    card.scrollIntoView({behavior: scrollBehavior, block: 'center'});
    card.querySelector('input').focus({preventScroll: true});
  }

  function requestSubmit(){
    flagMissing = true;
    confirmBox.hidden = false;
    submitBtn.hidden = true;
    renderConfirm();
    active().forEach(it => syncCard(it, true));
  }

  function renderConfirm(){
    const missing = active().filter(it => !state.answers[it.name]);
    confirmText.textContent = missing.length
      ? `${missing.length} unanswered. ${missing.length === 1 ? 'It counts' : 'They count'} as wrong if you submit now.`
      : `All ${active().length} answered. Submit for grading?`;
    confirmActions.replaceChildren(
      ...(missing.length ? [h('button', {type: 'button', class: 'btn', onclick: () => goTo(missing[0].name)}, 'Go to next unanswered')] : []),
      h('button', {type: 'button', class: 'btn primary', onclick: () => grade(false)}, missing.length ? 'Submit anyway' : 'Submit'),
      h('button', {type: 'button', class: 'text-btn', onclick: cancelSubmit}, 'Keep answering'));
  }

  function closeConfirm(){
    flagMissing = false;
    confirmBox.hidden = true;
    submitBtn.hidden = false;
  }

  function cancelSubmit(){
    closeConfirm();
    active().forEach(it => syncCard(it, true));
    submitBtn.focus();
  }

  function grade(timeUp){
    clearTimeout(timerId);
    const items = active();
    state.graded = true;
    state.timeUp = !!timeUp;
    if(!state.round) state.firstScore = {score: items.filter(isCorrect).length, total: items.length};
    save();
    closeConfirm();
    render();
    result.scrollIntoView({behavior: scrollBehavior, block: 'start'});
    result.focus({preventScroll: true});
  }

  function toggleOnlyMissed(){
    showOnlyMissed = !showOnlyMissed;
    render();
    result.querySelector('[aria-pressed]').focus();
  }

  function retryMissed(){
    const missed = active().filter(it => !isCorrect(it)).map(it => it.name);
    missed.forEach(n => delete state.answers[n]);
    state.checked = state.checked.filter(n => !missed.includes(n));
    state.round = missed;
    state.graded = false;
    state.timeUp = false;
    state.deadline = null;
    showOnlyMissed = false;
    save();
    render();
    goTo(missed[0]);
  }

  function startOver(btn){
    const unsaved = !state.graded && Object.keys(state.answers).length > 0;
    if(unsaved && btn.dataset.armed !== '1'){
      btn.dataset.armed = '1';
      btn.textContent = 'Tap again to clear your answers';
      announcer.textContent = 'Tap Start over again to clear your answers.';
      setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Start over'; }, 4000);
      return;
    }
    btn.dataset.armed = '';
    btn.textContent = 'Start over';
    clearTimeout(timerId);
    clearSaved();
    state = freshState();
    showOnlyMissed = false;
    closeConfirm();
    render();
    window.scrollTo({top: 0, behavior: scrollBehavior});
    startPanel.querySelector('input[name=mode]:checked').focus({preventScroll: true});
  }

  form.addEventListener('change', e => {
    const input = e.target;
    if(input.type !== 'radio' || !byName[input.name]) return;
    // Arrow keys can still move a locked group's selection; put it back.
    if(isLocked(input.name)){ syncCard(byName[input.name], true); return; }
    const wasAnswered = !!state.answers[input.name];
    state.answers[input.name] = input.value;
    save();
    syncCard(byName[input.name], true);
    renderProgress();
    if(!confirmBox.hidden) renderConfirm();
    const items = active();
    if(!wasAnswered && items.every(it => state.answers[it.name])){
      announcer.textContent = `All ${items.length} answered.`;
    }
  });

  form.addEventListener('click', e => {
    if(e.target.matches('input[type=radio]') && isLocked(e.target.name)){ e.preventDefault(); return; }
    const btn = e.target.closest('[data-check]');
    if(!btn) return;
    const name = btn.dataset.check;
    state.checked.push(name);
    save();
    syncCard(byName[name], true);
    renderProgress();
    cardOf(name).querySelector('.verdict').focus({preventScroll: true});
  });

  if(state.startedAt) save();
  layout();
  render();

  return {passMark, totalItems};
}
