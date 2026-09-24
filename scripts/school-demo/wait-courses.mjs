/** 阻塞等待：四学段全部 done>=total，或超时；每 30s 打印一行。
 * 用法: node scripts/school-demo/wait-courses.mjs [maxMinutes] */
import fs from 'node:fs'; import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const DB = path.join(ROOT,'backend','prisma','dev.db');
const OUT = path.join(ROOT,'data','newfeatures-test-2026-09-22');
const maxMin = Number(process.argv[2]||60);
const bands = {P1:'小学',J1:'初中',S1:'高中',C1:'大学'};
const snap = () => {
  const db = new DatabaseSync(DB,{timeout:30000}); const o={};
  try{
    for(const [run,label] of Object.entries(bands)){
      const st = JSON.parse(fs.readFileSync(path.join(OUT,`${run}-state.json`),'utf8'));
      const s = db.prepare(`select learningPathId,status from virtual_sessions where id='${st.sessionId}'`).get()||{};
      let d=0,t=0;
      if(s.learningPathId) for(const m of db.prepare(`select id from milestones where learningPathId='${s.learningPathId}'`).all())
        for(const x of db.prepare(`select status from subtasks where milestoneId='${m.id}'`).all()){t++;if(x.status==='completed')d++;}
      o[label]={d,t,status:s.status};
    }
  } finally { db.close(); }
  return o;
};
const deadline = Date.now()+maxMin*60000;
for(;;){
  const o = snap();
  const line = Object.entries(o).map(([k,v])=>`${k} ${v.d}/${v.t}(${v.status})`).join(' | ');
  console.log(`[${new Date().toISOString().slice(11,19)}] ${line}`);
  if(Object.values(o).every(v=>v.t>0 && v.d>=v.t)){console.log('ALL_DONE');break;}
  if(Date.now()>deadline){console.log('TIMEOUT');break;}
  await new Promise(r=>setTimeout(r,30000));
}
