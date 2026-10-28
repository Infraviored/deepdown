import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

await import('../src/parse.js');
const { parseBatchResponse, findReports, reportToMarkdown } = globalThis.GeminiMd;

function source(num, url, title) {
  return [null, null, null, [['https://favicon', url, title, null, null, url + '#:~:text=x'], num, null, null, null, []]];
}

function batch(payload) {
  const line = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify(payload), null, null, null, 'generic']]);
  return `)]}'\n\n${line.length}\n${line}\n57\n[["di",42],["af.httprm",42,"1",1]]\n`;
}

const reportNode = [
  'im_abc',
  null,
  'My Report',
  'agency-placeholder-task-id',
  '# Heading\n\nClaim one [cite: 1, 2]. Claim two [cite: 2].\n',
  [{ 44: [[[' [cite: 1, 2]'], [source(1, 'https://a.org/x(1)', 'A [paper]'), source(2, 'https://b.org', 'B')]]] }],
];

test('extracts report from a batchexecute response', () => {
  const payloads = parseBatchResponse(batch([[['c_1', 'r_1'], [[['rc_1', ['done']]], [reportNode]]]]), 'hNvQHb');
  const reports = payloads.flatMap(findReports);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].title, 'My Report');
  assert.equal(reports[0].sources.size, 2);
});

test('turns citations into footnotes with a source list', () => {
  const [r] = findReports([reportNode]);
  assert.equal(
    reportToMarkdown(r),
    '# Heading\n\nClaim one[^1][^2]. Claim two[^2].\n\n## Sources\n\n' +
      '[^1]: [A \\[paper\\]](https://a.org/x%281%29)\n[^2]: [B](https://b.org)\n',
  );
});

test('dedupes the same report reachable twice', () => {
  assert.equal(findReports([reportNode, [reportNode]]).length, 1);
});

test('keeps citations without a known source as they were', () => {
  const [r] = findReports([[...reportNode.slice(0, 4), 'A [cite: 1, 9]. B [cite: 9].', reportNode[5]]]);
  assert.equal(reportToMarkdown(r).split('\n')[0], 'A[^1]. B [cite: 9].');
});

test('skips a malformed payload but keeps the intact ones', () => {
  const good = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[reportNode]])]]);
  const bad = JSON.stringify([['wrb.fr', 'hNvQHb', '{not json']]);
  const reports = parseBatchResponse(`)]}'\n${bad}\n${good}\n`, 'hNvQHb').flatMap(findReports);
  assert.equal(reports.length, 1);
});

// Optional check against a real captured response (not committed: private data).
const real = process.env.GEMINI_MD_FIXTURE;
test('real capture: every cited number has a source', { skip: !real || !existsSync(real) }, () => {
  const text = readFileSync(real, 'utf8');
  const reports = parseBatchResponse(text, 'hNvQHb').flatMap(findReports);
  assert.ok(reports.length >= 1);
  for (const r of reports) {
    const md = reportToMarkdown(r);
    assert.doesNotMatch(md, /\[cite/);
    for (const [, n] of md.matchAll(/\[\^(\d+)\](?!:)/g)) assert.ok(r.sources.has(Number(n)), `missing source ${n}`);
  }
});
