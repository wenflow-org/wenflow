#!/usr/bin/env bash
# 续跑 J1/S1/C1 三门课（每门失败自动 restart-learning 续），直到完成。
cd /d/wenflow/wenflow
declare -A BK=([J1]=junior [S1]=senior [C1]=college)
for run in J1 S1 C1; do
  b=${BK[$run]}
  echo "===== $b ($run) START $(date '+%H:%M:%S') ====="
  for attempt in 1 2 3 4; do
    node scripts/school-demo/run-band.mjs --band=$b --phase=learn 2>&1 | tail -4
    res=$(node -e "
const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('backend/prisma/dev.db');
const st=JSON.parse(require('fs').readFileSync('data/newfeatures-test-2026-09-22/${run}-state.json','utf8'));
const pid=db.prepare(\"select learningPathId from virtual_sessions where id='\${st.sessionId}'\").get()?.learningPathId;
if(!pid){console.log('0 0');process.exit(0);}
const total=db.prepare(\"select count(*) c from subtasks s join milestones m on s.milestoneId=m.id where m.learningPathId='\"+pid+\"'\").get().c;
const d=db.prepare(\"select count(*) c from subtasks s join milestones m on s.milestoneId=m.id where m.learningPathId='\"+pid+\"' and s.status='completed'\").get().c;
console.log(d+' '+total);" 2>/dev/null)
    echo "  [$b] attempt $attempt -> $res"
    set -- $res
    if [ "$1" = "$2" ] && [ "$2" != "0" ]; then echo "  [$b] 完成"; break; fi
    node -e "
const fs=require('fs');const env=fs.readFileSync('backend/.env','utf8');
const g=(k)=>{const m=env.match(new RegExp('^'+k+'=(.*)\$','m'));return m?m[1].trim():''};
const B='http://127.0.0.1:3010';const sid=JSON.parse(fs.readFileSync('data/newfeatures-test-2026-09-22/${run}-state.json','utf8')).sessionId;
(async()=>{const lr=await fetch(B+'/api/admin-auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173'},body:JSON.stringify({name:g('INIT_ADMIN_NAME'),password:g('INIT_ADMIN_PASSWORD'),remember:true})});
const ck=(lr.headers.get('set-cookie')||'').match(/wenflow_admin_token=[^;]+/)[0];
const H={'Content-Type':'application/json',Cookie:ck,Origin:'http://localhost:5173'};
const r=await fetch(B+'/api/admin/virtual-learners/sessions/'+sid+'/restart-learning',{method:'POST',headers:H,body:'{}'});
console.log('  restart ->',r.status);})();" 2>&1 | tail -1
    sleep 5
  done
done
echo "ALL REST DONE $(date '+%H:%M:%S')"
