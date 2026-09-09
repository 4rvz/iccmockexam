/*
 * Shared exam engine.
 *
 * Call initExam({ passPct, sections }) where each section is:
 *   { title: "Part A — Multiple Choice", type: "mc"|"tf", key: "mc", items: [...] }
 * An "mc" item is { n, text, opts:{A,B,C,D}, ans:"B" }.
 * A  "tf" item is { n, text, ans:"T" }.
 *
 * `key` prefixes the radio-group names and element ids, so two sections in the
 * same exam never collide.
 */

function initExam(config){
  const sections = config.sections;
  const passPct = config.passPct;
  const allItems = sections.flatMap(s => s.items.map(q => ({q, section: s})));
  const totalItems = allItems.length;
  const passMark = Math.ceil(totalItems * passPct / 100);

  let answersRevealed = false;

  const el = id => document.getElementById(id);
  const groupName = (s, q) => s.key + q.n;
  const cardId = (s, q) => s.key + '-q-' + q.n;
  const chosenInput = (s, q) => document.querySelector(`input[name="${groupName(s, q)}"]:checked`);

  function optionHtml(name, letter, label){
    return `
      <label class="opt" data-opt="${letter}">
        <input type="radio" name="${name}" value="${letter}">
        <span class="opt-text"><span class="opt-letter">${letter}.</span> ${label}</span>
      </label>`;
  }

  function build(){
    const container = el('quizForm');
    sections.forEach(s => {
      const wrap = document.createElement('div');
      if(s.title){
        wrap.innerHTML = `<div class="section-title">${s.title}</div>`;
      }
      s.items.forEach(q => {
        const card = document.createElement('div');
        card.className = s.type === 'tf' ? 'q tf-row' : 'q';
        card.id = cardId(s, q);
        const name = groupName(s, q);

        let optsHtml = '';
        if(s.type === 'tf'){
          optsHtml = `
            <label class="opt" data-opt="T">
              <input type="radio" name="${name}" value="T">
              <span class="opt-text"><span class="opt-letter">T</span></span>
            </label>
            <label class="opt" data-opt="F">
              <input type="radio" name="${name}" value="F">
              <span class="opt-text"><span class="opt-letter">F</span></span>
            </label>`;
        } else {
          ['A','B','C','D'].forEach(letter => {
            if(q.opts[letter]) optsHtml += optionHtml(name, letter, q.opts[letter]);
          });
        }

        card.innerHTML = `
          <div class="qnum">${s.itemLabel || 'Question'} ${q.n}</div>
          <div class="qtext">${q.text}</div>
          <div class="opts">${optsHtml}</div>
          <div class="verdict" style="display:none;"></div>
        `;
        wrap.appendChild(card);
      });
      container.appendChild(wrap);
    });
  }

  function updateProgress(){
    let answered = 0;
    allItems.forEach(({q, section}) => {
      const card = el(cardId(section, q));
      if(chosenInput(section, q)){
        answered++;
        card.classList.add('answered');
      } else {
        card.classList.remove('answered');
      }
    });
    el('progressFill').style.width = (answered / totalItems * 100) + '%';
    el('progressLabel').textContent = `${answered} of ${totalItems} answered`;
  }

  function showAnswers(){
    allItems.forEach(({q, section}) => {
      const card = el(cardId(section, q));
      card.classList.add('revealed');
      const target = card.querySelector(`.opt[data-opt="${q.ans}"]`);
      if(target) target.classList.add('is-answer');
      const verdict = card.querySelector('.verdict');
      verdict.className = 'verdict reveal';
      verdict.textContent = `Correct answer: ${q.ans}`;
      verdict.style.display = 'block';
    });
    answersRevealed = true;
    el('showAnswersBtn').textContent = 'Hide answers';
  }

  function hideAnswers(){
    allItems.forEach(({q, section}) => {
      const card = el(cardId(section, q));
      card.classList.remove('revealed');
      card.querySelectorAll('.opt.is-answer').forEach(o => o.classList.remove('is-answer'));
      const verdict = card.querySelector('.verdict');
      verdict.className = 'verdict';
      verdict.textContent = '';
      verdict.style.display = 'none';
    });
    answersRevealed = false;
    el('showAnswersBtn').textContent = 'Show answers';
  }

  function toggleAnswers(){
    if(answersRevealed) hideAnswers();
    else showAnswers();
  }

  function gradeExam(){
    const missing = allItems
      .filter(({q, section}) => !chosenInput(section, q))
      .map(({q, section}) => (section.shortLabel || section.key.toUpperCase()) + ' ' + q.n);

    const missingNote = el('missingNote');
    if(missing.length > 0){
      missingNote.style.display = 'block';
      missingNote.textContent = `Please answer all items before submitting. Missing: ${missing.join(', ')}`;
      return;
    }
    missingNote.style.display = 'none';
    if(answersRevealed) hideAnswers();

    let score = 0;
    allItems.forEach(({q, section}) => {
      const chosen = chosenInput(section, q).value;
      const card = el(cardId(section, q));
      const verdict = card.querySelector('.verdict');
      verdict.style.display = 'block';
      if(chosen === q.ans){
        score++;
        card.classList.add('correct'); card.classList.remove('incorrect');
        verdict.className = 'verdict ok';
        verdict.textContent = `Correct — answer: ${q.ans}`;
      } else {
        card.classList.add('incorrect'); card.classList.remove('correct');
        verdict.className = 'verdict bad';
        verdict.textContent = `Incorrect — your answer: ${chosen}, correct answer: ${q.ans}`;
      }
    });

    const pct = Math.round((score / totalItems) * 1000) / 10;
    const passed = score >= passMark;

    el('resultArea').style.display = 'block';
    const scoreEl = el('resultScore');
    scoreEl.textContent = `${score} / ${totalItems}`;
    scoreEl.className = 'result-score ' + (passed ? 'pass' : 'fail');

    const verdictEl = el('resultVerdict');
    verdictEl.textContent = passed ? 'PASSED' : 'DID NOT PASS';
    verdictEl.style.color = passed ? 'var(--pass)' : 'var(--fail)';

    el('resultDetail').textContent =
      `Score: ${pct}% · Passing mark: ${passPct}% (${passMark}/${totalItems})`;

    el('submitBtn').disabled = true;
    const showBtn = el('showAnswersBtn');
    showBtn.disabled = true;
    showBtn.textContent = 'Answers shown';
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  function resetExam(){
    document.querySelectorAll('input[type=radio]').forEach(r => r.checked = false);
    document.querySelectorAll('.q').forEach(card => {
      card.classList.remove('correct','incorrect','answered','revealed');
      card.querySelectorAll('.opt.is-answer').forEach(o => o.classList.remove('is-answer'));
      const v = card.querySelector('.verdict');
      if(v){ v.className = 'verdict'; v.textContent = ''; v.style.display = 'none'; }
    });
    answersRevealed = false;
    const showBtn = el('showAnswersBtn');
    showBtn.disabled = false;
    showBtn.textContent = 'Show answers';
    el('resultArea').style.display = 'none';
    el('submitBtn').disabled = false;
    el('missingNote').style.display = 'none';
    updateProgress();
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  build();
  el('quizForm').addEventListener('change', updateProgress);
  el('submitBtn').addEventListener('click', gradeExam);
  el('showAnswersBtn').addEventListener('click', toggleAnswers);
  el('resetLink').addEventListener('click', resetExam);
  updateProgress();

  return {passMark, totalItems};
}
