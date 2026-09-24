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
  assert.match(nonLife, /Coming soon/);
});

test('pages carry no Insurance Commission or IIAP branding', async () => {
  const pages = ['index.html', 'traditional-life-reviewers/index.html', 'variable-unit-linked-reviewers/index.html',
    'non-life-insurance/index.html', 'traditional-life/index.html', 'traditional-life-full/index.html',
    'variable-unit-linked/index.html'];
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
