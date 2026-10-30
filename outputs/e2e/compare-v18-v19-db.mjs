#!/usr/bin/env node
/** v18 → v19 对比：直接从 DB 取每个版本的首节完成课，避免导出文件互相覆盖。 */
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const here=dirname(fileURLToPath(import.meta.url));
const backend=resolve(here,'../../backend');
const require=createRequire(join(backend,'package.json'));
require('dotenv').config({path:join(backend,'.env')});
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
const count=(t,re)=>((t.match(re)||[]).length);
const targets=[
 ['v18','f3','志愿者那句'],
 ['v19','f3','原料—条件—产物'],
 ['v18','f10','把手上会员月消费原始数字'],
 ['v19','f10','充值流水'],
];
const rows=[];
for(const [label,caseId,needle] of targets){
 const s=await p.teaching_sessions.findFirst({where:{topic:{contains:needle},status:'completed'},orderBy:{createdAt:'desc'}});
 if(!s){rows.push({label,caseId,topic:'(not found)'});continue;}
 const msgs=await p.teaching_session_messages.findMany({where:{sessionId:s.id},orderBy:{id:'asc'}});
 const parsed=msgs.map(m=>{try{return JSON.parse(m.payload)}catch{return {}}});
 const all=parsed.map(m=>String(m.content||'')).join('\n');
 rows.push({label,caseId,topic:s.topic,msgs:parsed.length,
  teacher:parsed.filter(m=>m.role==='assistant').length,
  busywork:count(all,/重写|复述|按顺序说|补齐|补全|逐行|抄写/g),
  chartalk:count(all,/图上|看图|摆成图|箭头|两个问号|照着图/g),
  wrongVerdict:count(all,/这道不对|没答到|答错了|选错/g),
  numbers37:count(all,/37\s*个|补全/g),
 });
}
const md=['# v18 → v19 真实课堂对比（f3 / f10）','',
 '| 版本 | 案例 | 首节完成课主题 | 消息 | 老师 | 罚重写/复述 | 看图话术 | 否定作答 | 补全37个数 |',
 '|---|---|---|---|---|---|---|---|---|',
 ...rows.map(r=>`| ${r.label} | ${r.caseId} | ${r.topic} | ${r.msgs??'-'} | ${r.teacher??'-'} | ${r.busywork??'-'} | ${r.chartalk??'-'} | ${r.wrongVerdict??'-'} | ${r.numbers37??'-'} |`),
 '',
 '> 统计口径：每案例第 1 节 completed 课；关键词命中次数，不做语义判断。'];
fs.writeFileSync(resolve(here,'../../doc/learners/V19_COMPARE.md'),md.join('\n'));
console.log(md.join('\n'));
await p.$disconnect();
