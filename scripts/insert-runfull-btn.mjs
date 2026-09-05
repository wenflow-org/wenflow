import { readFileSync, writeFileSync } from 'node:fs';
const p = 'D:/wenflow/wenflow/frontend/src/views/admin-redesign/VirtualProfile.vue';
const lines = readFileSync(p, 'utf8').split('\n');

// Find the "运行" button line (mk-btn--primary with runStory)
let runBtnLine = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('runStory(s, i)') && lines[i].includes('mk-btn--primary')) {
    runBtnLine = i;
    break;
  }
}
if (runBtnLine === -1) { console.log('NOT FOUND run button'); process.exit(1); }
console.log('run button at line', runBtnLine + 1, ':', lines[runBtnLine].trim());

// Determine base indent (from the run button line)
const runIndent = lines[runBtnLine].match(/^\s*/)[0];
const innerIndent = runIndent + '  ';
const opsIndent = runIndent.slice(0, -2); // vp-story__ops children are indented deeper

// Find the closing </button> of the run button (next line(s))
let closeBtnLine = runBtnLine;
for (let i = runBtnLine; i < lines.length && i < runBtnLine + 4; i++) {
  if (lines[i].trim() === '</button>') { closeBtnLine = i; break; }
}
console.log('close </button> at line', closeBtnLine + 1);

// Build the replacement: change run button disabled + add run-full button after it
const runDisabled = lines[runBtnLine].replace(':disabled="running"', ':disabled="running || runFullBusy"');
const runTextLine = runBtnLine + 1;
const runText = lines[runTextLine].replace("'运行中…'", "'运行中…'").replace(': \'运行\' }}', ": '运行' }}");

// Insert new button after closeBtnLine
const newButton = [
  innerIndent + '<button',
  innerIndent + '  type="button"',
  innerIndent + '  class="mk-btn mk-btn--sm mk-btn--ghost"',
  innerIndent + '  :disabled="running || runFullBusy"',
  innerIndent + '  :title="runFullTitle"',
  innerIndent + '  @click="runFullStory(s, i)"',
  innerIndent + '>',
  innerIndent + '  {{ runFullBusy ? \'一键学完中…\' : \'一键学完\' }}',
  innerIndent + '</button>',
];

lines[runBtnLine] = runDisabled;
lines.splice(closeBtnLine + 1, 0, ...newButton);

writeFileSync(p, lines.join('\n'), 'utf8');
console.log('DONE - inserted 一键学完 button');