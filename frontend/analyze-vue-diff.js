const { execSync } = require('child_process');
const fs = require('fs');

const gitRoot = 'D:/wenflow/wenflow';

function getClean(ref) {
  return execSync(`git show ${ref}`, { cwd: gitRoot, maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
}

// Get the git diff to see what Phase 5 changed
const diff = execSync('git diff HEAD -- frontend/src/views/admin/AgentRegistry.vue', {
  cwd: gitRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024
});

// Extract just the + lines (additions by migration)
const addLines = diff.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
const delLines = diff.split('\n').filter(l => l.startsWith('-') && !l.startsWith('---'));

console.log('AgentRegistry.vue: +' + addLines.length + ' lines added, -' + delLines.length + ' lines removed');

// Categorize the changes
let apiChanges = 0, textChanges = 0, typeChanges = 0, otherChanges = 0;
addLines.forEach(l => {
  const s = l.substring(1).trim();
  if (s.includes('agentApi') || s.includes('agents/') || s.includes('/agents/')) apiChanges++;
  else if (s.includes('编排') || s.includes('Agent') || s.includes('节点') || s.includes('能力')) textChanges++;
  else if (s.includes(': ') && (s.includes('string') || s.includes('boolean') || s.includes('interface') || s.includes('type'))) typeChanges++;
  else otherChanges++;
});
console.log('  API calls: ' + apiChanges + ', Text: ' + textChanges + ', Types: ' + typeChanges + ', Other: ' + otherChanges);

// Do the same for ExecutionLogs.vue
const diff2 = execSync('git diff HEAD -- frontend/src/views/admin/ExecutionLogs.vue', {
  cwd: gitRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024
});
const addLines2 = diff2.split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++'));
console.log('\nExecutionLogs.vue: +' + addLines2.length + ' lines');
let text2 = 0, other2 = 0;
addLines2.forEach(l => {
  if (l.includes('编排') || l.includes('Agent') || l.includes('层') || l.includes('节点') || l.includes('映射')) text2++;
  else other2++;
});
console.log('  Text changes: ' + text2 + ', Other: ' + other2);
