const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('=== ALL agent_prompts RECORDS ===\n');
  
  const allPrompts = await prisma.agent_prompts.findMany({
    orderBy: [
      { agentId: 'asc' },
      { version: 'asc' }
    ]
  });
  
  console.log('Total records:', allPrompts.length, '\n');
  
  // Group by agentId
  const groupedByAgent = {};
  allPrompts.forEach(p => {
    if (!groupedByAgent[p.agentId]) {
      groupedByAgent[p.agentId] = [];
    }
    groupedByAgent[p.agentId].push(p);
  });
  
  console.log('=== GROUPED BY agentId ===\n');
  
  const agentIds = Object.keys(groupedByAgent).sort();
  agentIds.forEach(agentId => {
    const prompts = groupedByAgent[agentId];
    console.log('\n[' + agentId + '] - ' + prompts.length + ' version(s)');
    prompts.forEach(p => {
      const date = p.createdAt.toISOString().slice(0, 10);
      console.log('  - v' + p.version + ' | ' + p.status.toUpperCase() + ' | ' + p.name + ' | by: ' + p.createdBy + ' | ' + date);
    });
  });
  
  // Target agents
  console.log('\n\n=== TARGET AGENTS STATUS ===\n');
  const targetAgents = [
    'requirement-orchestrator',
    'session-evaluation-agent',
    'session-wrapup-agent',
    'summary-agent',
    'teaching-turn-agent',
    'tutor-agent',
    'user-profile-agent'
  ];
  
  targetAgents.forEach(agentId => {
    const prompts = groupedByAgent[agentId];
    if (prompts) {
      const statuses = prompts.map(p => p.status.toUpperCase());
      console.log('[FOUND] ' + agentId + ': ' + prompts.length + ' version(s) [' + statuses.join(', ') + ']');
    } else {
      console.log('[NOT FOUND] ' + agentId + ': No records');
    }
  });
  
  // Status summary
  console.log('\n\n=== GLOBAL STATUS SUMMARY ===\n');
  const statusCount = { DRAFT: 0, ACTIVE: 0, ARCHIVED: 0, OTHER: 0 };
  allPrompts.forEach(p => {
    const s = p.status.toUpperCase();
    if (statusCount[s] !== undefined) {
      statusCount[s]++;
    } else {
      statusCount.OTHER++;
    }
  });
  console.log('DRAFT:', statusCount.DRAFT);
  console.log('ACTIVE:', statusCount.ACTIVE);
  console.log('ARCHIVED:', statusCount.ARCHIVED);
  console.log('OTHER:', statusCount.OTHER);
  
  await prisma.$disconnect();
}

main().catch(console.error);
