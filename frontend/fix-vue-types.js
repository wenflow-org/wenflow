const fs = require('fs');
const file = 'D:/wenflow/wenflow/frontend/src/views/admin/AgentRegistry.vue';
let c = fs.readFileSync(file, 'utf8');
const before = (c.match(/'orchestrator-no-direct-prompt'/g) || []).length;
c = c.replace(/'orchestrator-no-direct-prompt'/g, "'agent-no-direct-prompt'");
fs.writeFileSync(file, c, 'utf8');
const after = (c.match(/'orchestrator-no-direct-prompt'/g) || []).length;
console.log('Fixed ' + before + ' occurrences, remaining: ' + after);
console.log('FFFD: ' + (c.match(/\ufffd/g) || []).length);
