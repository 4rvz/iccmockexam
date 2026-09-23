import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('the main chooser links each insurance category to its reviewer page', async () => {
  const chooser = await readProjectFile('public/iccmockexam/index.html');

  assert.match(chooser, /Choose a category/);
  assert.match(chooser, /href="\/iccmockexam\/traditional-life-reviewers"/);
  assert.match(chooser, /href="\/iccmockexam\/variable-unit-linked-reviewers"/);
  assert.match(chooser, /href="\/iccmockexam\/non-life-insurance"/);
  assert.doesNotMatch(chooser, /href="\/iccmockexam\/iiap-trad"/);
});

test('each category owns its own reviewer choices or empty state', async () => {
  const traditional = await readProjectFile('public/iccmockexam/traditional-life-reviewers/index.html');
  const variable = await readProjectFile('public/iccmockexam/variable-unit-linked-reviewers/index.html');
  const nonLife = await readProjectFile('public/iccmockexam/non-life-insurance/index.html');

  assert.match(traditional, /href="\/iccmockexam\/traditional-life"/);
  assert.match(traditional, /href="\/iccmockexam\/iiap-trad"/);
  assert.match(variable, /href="\/iccmockexam\/variable-unit-linked"/);
  assert.match(nonLife, /Coming soon/);
});

test('the Variable Unit-Linked reviewer contains a complete 100-question exam', async () => {
  const reviewer = await readProjectFile('public/iccmockexam/variable-unit-linked/index.html');
  const questions = await readProjectFile('public/iccmockexam/variable-unit-linked/questions.js');

  assert.match(reviewer, /Variable Unit-Linked/);
  assert.match(reviewer, /100 items total/);
  assert.match(reviewer, /passPct:\s*80/);
  assert.equal((questions.match(/"n": \d+, "text":/g) || []).length, 100);
  assert.match(questions, /"n": 1, "text":.*?"ans": "A"/);
  assert.match(questions, /"n": 100, "text":.*?"ans": "A"/);
});
