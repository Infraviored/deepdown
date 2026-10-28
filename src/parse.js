// Pure parsing of Gemini's batchexecute payloads. No DOM access, so it can be
// loaded by the content script and by node tests alike (both read globalThis.GeminiMd).
(function (root) {
  'use strict';

  // A batchexecute response with rt=c is ")]}'" followed by length-prefixed
  // chunks. Every chunk's JSON sits on its own line, so we parse line-wise and
  // skip the length lines instead of trusting the (byte vs. char) lengths.
  function parseBatchResponse(text, rpcId) {
    const payloads = [];
    for (const line of text.split('\n')) {
      if (!line.startsWith('[')) continue;
      let chunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      for (const entry of chunk) {
        if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === rpcId && typeof entry[2] === 'string') {
          try {
            payloads.push(JSON.parse(entry[2]));
          } catch {
            // A broken chunk must not cost us the intact ones.
          }
        }
      }
    }
    return payloads;
  }

  // A Deep Research report node looks like
  //   ["im_…", null, title, taskId, markdown, [{"44": citeGroups, …}], …]
  // We match on shape rather than on a fixed path, since the path depends on
  // the turn's position in the chat.
  function isReportNode(a) {
    return (
      Array.isArray(a) &&
      typeof a[0] === 'string' &&
      a[0].startsWith('im_') &&
      typeof a[2] === 'string' &&
      typeof a[4] === 'string' &&
      a[4].length > 0
    );
  }

  function findReports(payload) {
    const reports = [];
    const seen = new Set();
    const stack = [payload];
    while (stack.length) {
      const node = stack.pop();
      if (!Array.isArray(node)) {
        if (node && typeof node === 'object') stack.push(...Object.values(node));
        continue;
      }
      if (isReportNode(node) && !seen.has(node[0])) {
        seen.add(node[0]);
        reports.push({ id: node[0], title: node[2], markdown: node[4], sources: extractSources(node[5]) });
        continue;
      }
      // Reverse keeps document order when popping from the stack.
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    }
    return reports;
  }

  // citeGroups: [[[" [cite: 1, 2]"], [source, …]], …]
  // source:     [null, null, null, [[favicon, url, title, …], number, …], …]
  function extractSources(meta) {
    const sources = new Map();
    const groups = Array.isArray(meta) && meta[0] && meta[0]['44'];
    if (!Array.isArray(groups)) return sources;
    for (const group of groups) {
      for (const s of (Array.isArray(group) && group[1]) || []) {
        const info = Array.isArray(s) && s[3];
        const link = Array.isArray(info) && info[0];
        const num = Array.isArray(info) && info[1];
        if (!Array.isArray(link) || typeof num !== 'number' || typeof link[1] !== 'string') continue;
        if (!sources.has(num)) sources.set(num, { url: link[1], title: link[2] || link[1] });
      }
    }
    return sources;
  }

  function escapeLinkText(s) {
    return s.replace(/([\[\]\\])/g, '\\$1').replace(/\s+/g, ' ').trim();
  }

  function escapeUrl(u) {
    return u.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/ /g, '%20');
  }

  function reportToMarkdown(report) {
    let md = report.markdown
      .replace(/\[cite_start\]/g, '')
      // Only numbers with a known source become footnotes; a marker with none
      // stays as it was rather than pointing at footnotes that do not exist.
      .replace(/[ \t]*\[cite:\s*([\d,\s]+)\]/g, (marker, nums) => {
        const known = nums
          .split(',')
          .map((n) => n.trim())
          .filter((n) => n && report.sources.has(Number(n)));
        return known.length ? known.map((n) => `[^${n}]`).join('') : marker;
      })
      .trimEnd();

    if (report.sources.size) {
      const lines = [...report.sources.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([n, s]) => `[^${n}]: [${escapeLinkText(s.title)}](${escapeUrl(s.url)})`);
      md += '\n\n## Sources\n\n' + lines.join('\n');
    }
    return md + '\n';
  }

  root.GeminiMd = { parseBatchResponse, findReports, extractSources, reportToMarkdown };
})(globalThis);
