const { execSync } = require('child_process');
const fs = require('fs');

const gitRoot = 'D:/wenflow/wenflow';

function getClean(ref) {
  return execSync(`git show ${ref}`, { cwd: gitRoot, maxBuffer: 10 * 1024 * 1024 }).toString('utf8');
}

// AgentRegistry.vue
const cleanAg = getClean('HEAD:frontend/src/views/admin/AgentRegistry.vue');
const cleanAgFFFD = (cleanAg.match(/\ufffd/g) || []).length;

const currentAg = fs.readFileSync(gitRoot + '/frontend/src/views/admin/AgentRegistry.vue', 'utf8');
const currentAgFFFD = (currentAg.match(/\ufffd/g) || []).length;

console.log('AgentRegistry.vue: clean=' + cleanAgFFFD + ' FFFD, current=' + currentAgFFFD + ' FFFD');

// Use clean version as base, then re-apply migration text changes
let result = cleanAg;

// Migration changes needed:
result = result.replace(/编排器/g, 'Agent');
result = result.replace(/编排/g, 'Agent');

// But restore known verb usages  
result = result.replace(/统一编排/g, '统一编排'); // no-op, keep verb
result = result.replace(/编排虚拟学习者/g, '编排虚拟学习者'); // no-op, keep verb

// Fix over-corrections
result = result.replace(/统一Agent学习者/g, '统一编排学习者');
result = result.replace(/Agent虚拟学习者/g, '编排虚拟学习者');

const resultFFFD = (result.match(/\ufffd/g) || []).length;
console.log('AgentRegistry migrated: ' + resultFFFD + ' FFFD');
fs.writeFileSync(gitRoot + '/frontend/src/views/admin/AgentRegistry.vue', result, 'utf8');

// ExecutionLogs.vue
const cleanEl = getClean('HEAD:frontend/src/views/admin/ExecutionLogs.vue');
const currentEl = fs.readFileSync(gitRoot + '/frontend/src/views/admin/ExecutionLogs.vue', 'utf8');
const currentElFFFD = (currentEl.match(/\ufffd/g) || []).length;
console.log('ExecutionLogs.vue: current=' + currentElFFFD + ' FFFD');

// Use clean version
let result2 = cleanEl;
result2 = result2.replace(/编排器/g, 'Agent');
result2 = result2.replace(/编排/g, 'Agent');
// Restore verb usages
result2 = result2.replace(/统一Agent/g, '统一编排');

const result2FFFD = (result2.match(/\ufffd/g) || []).length;
console.log('ExecutionLogs migrated: ' + result2FFFD + ' FFFD');
fs.writeFileSync(gitRoot + '/frontend/src/views/admin/ExecutionLogs.vue', result2, 'utf8');

console.log('\nDone');
