/** 通过 admin API 查四学段进度（避免 SQLite 竞争） */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = 'http://127.0.0.1:3010';
const env = fs.readFileSync(path.join(ROOT,'backend','.env'),'utf8');
const g=(k)=>{const m=env.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim():''};
const lr=await fetch(BASE+'/api/admin-auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173'},body:JSON.stringify({name:g('INIT_ADMIN_NAME'),password:g('INIT_ADMIN_PASSWORD'),remember:true})});
const ck=(lr.headers.get('set-cookie')||'').match(/wenflow_admin_token=[^;]+/)[0];
for(const run of ['P1','J1','S1','C1']){
  try{
    const st=JSON.parse(fs.readFileSync(path.join(ROOT,'data','newfeatures-test-2026-09-22',`${run}-state.json`),'utf8'));
    const r=await fetch(`${BASE}/api/admin/virtual-learners/sessions/${st.sessionId}`,{headers:{Cookie:ck,Origin:'http://localhost:5173'}});
    const d=(await r.json()).data||{};
    console.log(`${run}: ${d.completedTasks??0}/${d.totalTasks??0} | ${d.status} | ${d.currentStage}`);
  }catch(e){console.log(run,'err',e.message.slice(0,40));}
}
