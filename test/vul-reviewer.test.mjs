import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('the main chooser links each insurance category to its reviewer page', async () => {
  const chooser = await readProjectFile('public/mockexam/index.html');

  assert.match(chooser, /Choose a category/);
  assert.match(chooser, /href="\/mockexam\/traditional-life-reviewers"/);
  assert.match(chooser, /href="\/mockexam\/variable-unit-linked-reviewers"/);
  assert.match(chooser, /<div class="reviewer is-soon">\s*<h2 class="reviewer-name">Non-Life Insurance<\/h2>/);
  assert.doesNotMatch(chooser, /href="\/mockexam\/non-life-insurance"/);
  assert.doesNotMatch(chooser, /href="\/mockexam\/traditional-life-full"/);
});

test('each category owns its own reviewer choices or empty state', async () => {
  const traditional = await readProjectFile('public/mockexam/traditional-life-reviewers/index.html');
  const variable = await readProjectFile('public/mockexam/variable-unit-linked-reviewers/index.html');
  const nonLife = await readProjectFile('public/mockexam/non-life-insurance/index.html');

  assert.match(traditional, /href="\/mockexam\/traditional-life"/);
  assert.match(traditional, /href="\/mockexam\/traditional-life-full"/);
  assert.match(variable, /href="\/mockexam\/variable-unit-linked"/);
  assert.match(variable, /href="\/mockexam\/variable-unit-linked-mock-1"/);
  assert.match(variable, /href="\/mockexam\/variable-unit-linked-mock-2"/);
  assert.match(variable, /href="\/mockexam\/variable-unit-linked-answers"/);
  assert.match(nonLife, /Coming soon/);
});

test('pages carry no Insurance Commission or IIAP branding', async () => {
  const pages = ['index.html', 'traditional-life-reviewers/index.html', 'variable-unit-linked-reviewers/index.html',
    'non-life-insurance/index.html', 'traditional-life/index.html', 'traditional-life-full/index.html',
    'variable-unit-linked/index.html', 'variable-unit-linked-mock-1/index.html',
    'variable-unit-linked-mock-2/index.html', 'variable-unit-linked-answers/index.html'];
  for (const page of pages) {
    const html = await readProjectFile('public/mockexam/' + page);
    const chrome = html.split(/const \w+ = \[/)[0]; // page copy only, not question data
    assert.doesNotMatch(chrome, /Insurance Commission|IIAP|IC Mock|iccmockexam/, page);
  }
});

test('old /iccmockexam links redirect to /mockexam', async () => {
  const redirects = await readProjectFile('public/_redirects');
  assert.match(redirects, /^\/iccmockexam\/iiap-trad\s+\/mockexam\/traditional-life-full\s+301$/m);
  assert.match(redirects, /^\/iccmockexam\/\*\s+\/mockexam\/:splat\s+301$/m);
});

test('the Variable Unit-Linked reviewer contains a complete 100-question exam', async () => {
  const reviewer = await readProjectFile('public/mockexam/variable-unit-linked/index.html');
  const questions = await readProjectFile('public/mockexam/variable-unit-linked/questions.js');

  assert.match(reviewer, /Variable Unit-Linked/);
  assert.match(reviewer, /100 items total/);
  assert.match(reviewer, /passPct:\s*80/);
  assert.equal((questions.match(/"n": \d+, "text":/g) || []).length, 100);
  assert.match(questions, /"n": 1, "text":.*?"ans": "A"/);
  assert.match(questions, /"n": 100, "text":.*?"ans": "A"/);
});

for (const [set, key, first, last] of [[1, 'vulm1', 'B', 'A'], [2, 'vulm2', 'A', 'D']]) {
  test(`Variable Unit-Linked Mock Exam ${set} contains a complete 50-question exam`, async () => {
    const reviewer = await readProjectFile(`public/mockexam/variable-unit-linked-mock-${set}/index.html`);
    const questions = await readProjectFile(`public/mockexam/variable-unit-linked-mock-${set}/questions.js`);

    assert.match(reviewer, new RegExp(`Mock Exam ${set}`));
    assert.match(reviewer, /50 items total/);
    assert.match(reviewer, /passPct:\s*80/);
    assert.match(reviewer, new RegExp(`key:"${key}"`));
    assert.equal((questions.match(/"n": \d+, "text":/g) || []).length, 50);
    assert.match(questions, new RegExp(`"n": 1, "text":.*?"ans": "${first}"`));
    assert.match(questions, new RegExp(`"n": 50, "text":.*?"ans": "${last}"`));
  });
}

test('the Variable Unit-Linked answer sheet shows 80 questions, each with its answer and nothing to answer', async () => {
  const sheet = await readProjectFile('public/mockexam/variable-unit-linked-answers/index.html');

  assert.equal((sheet.match(/<article class="q study">/g) || []).length, 80);
  assert.equal((sheet.match(/<p class="answer">/g) || []).length, 80);
  assert.doesNotMatch(sheet, /<input|<script|initExam/);
});

test('each category card on the chooser states how many reviewers its page lists', async () => {
  const chooser = await readProjectFile('public/mockexam/index.html');
  const cards = [...chooser.matchAll(/href="\/mockexam\/([\w-]+-reviewers)">[^<]*<\/a><\/h2>\s*<div class="reviewer-meta">(\d+) reviewers? available/g)];

  assert.equal(cards.length, 2);
  for (const [, page, count] of cards) {
    const list = await readProjectFile(`public/mockexam/${page}/index.html`);
    assert.equal((list.match(/class="reviewer-link"/g) || []).length, Number(count), page);
  }
});
