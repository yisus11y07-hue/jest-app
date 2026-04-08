/**
 * JEST — Database layer (pure JSON, no native deps)
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'jest-data.json');

const GRADIENTS = [
  '#00e5ff,#ff2d78','#a78bfa,#ec4899','#34d399,#06b6d4',
  '#fbbf24,#f97316','#60a5fa,#818cf8','#f472b6,#fb923c',
  '#4ade80,#22d3ee','#e879f9,#a78bfa',
];

let store = { users:[], messages:[], reactions:[], _id:{u:1,m:1,r:1} };

function load() {
  try { if(fs.existsSync(DB_PATH)) store = JSON.parse(fs.readFileSync(DB_PATH,'utf8')); }
  catch(e) { console.error('DB load error, starting fresh'); }
}
function save() {
  try { fs.writeFileSync(DB_PATH, JSON.stringify(store,null,2)); }
  catch(e) { console.error('DB save error:',e.message); }
}

load();
let dirty = false;
setInterval(()=>{ if(dirty){save();dirty=false;} }, 4000);
process.on('exit', save);
process.on('SIGINT',()=>{ save(); process.exit(); });

function nid(t){ const id=store._id[t]; store._id[t]++; dirty=true; return id; }

function getRx(mid){
  const map={};
  store.reactions.filter(r=>r.message_id===mid).forEach(r=>{
    if(!map[r.emoji]) map[r.emoji]={emoji:r.emoji,count:0,user_ids:[]};
    map[r.emoji].count++; map[r.emoji].user_ids.push(r.user_id);
  });
  return Object.values(map).map(e=>({...e,user_ids:e.user_ids.join(',')}));
}
function withRx(msgs){ return msgs.map(m=>({...m,reactions:getRx(m.id)})); }

module.exports = {
  GRADIENTS,
  getUserByUsername(un){ return store.users.find(u=>u.username.toLowerCase()===un.toLowerCase())||null; },
  getUserById(id){ const u=store.users.find(u=>u.id===id); if(!u)return null; const{password_hash:_,...s}=u; return s; },
  createUser(username,display_name,password_hash,gradient){
    const u={id:nid('u'),username,display_name,password_hash,gradient,last_seen:new Date().toISOString(),created_at:new Date().toISOString()};
    store.users.push(u); dirty=true;
    const{password_hash:_,...s}=u; return s;
  },
  updateLastSeen(id){ const u=store.users.find(u=>u.id===id); if(u){u.last_seen=new Date().toISOString();dirty=true;} },
  getAllUsers(eid){ return store.users.filter(u=>u.id!==eid).map(({password_hash:_,...u})=>u).sort((a,b)=>a.display_name.localeCompare(b.display_name)); },
  getMessages(u1,u2){
    const msgs=store.messages.filter(m=>(m.sender_id===u1&&m.receiver_id===u2)||(m.sender_id===u2&&m.receiver_id===u1))
      .sort((a,b)=>a.created_at<b.created_at?-1:1)
      .map(m=>{ const s=store.users.find(u=>u.id===m.sender_id); return{...m,sender_name:s?.display_name||'?',sender_gradient:s?.gradient||''}; });
    return withRx(msgs);
  },
  getLastMessage(u1,u2){
    const msgs=store.messages.filter(m=>(m.sender_id===u1&&m.receiver_id===u2)||(m.sender_id===u2&&m.receiver_id===u1));
    if(!msgs.length)return null;
    return msgs.sort((a,b)=>a.created_at<b.created_at?1:-1)[0];
  },
  createMessage(sender_id,receiver_id,text,mood='normal'){
    const s=store.users.find(u=>u.id===sender_id);
    const msg={id:nid('m'),sender_id,receiver_id,text,mood,created_at:new Date().toISOString()};
    store.messages.push(msg); dirty=true;
    return{...msg,sender_name:s?.display_name||'?',sender_gradient:s?.gradient||'',reactions:[]};
  },
  toggleReaction(message_id,user_id,emoji){
    const idx=store.reactions.findIndex(r=>r.message_id===message_id&&r.user_id===user_id&&r.emoji===emoji);
    if(idx!==-1) store.reactions.splice(idx,1);
    else store.reactions.push({id:nid('r'),message_id,user_id,emoji});
    dirty=true;
    return getRx(message_id);
  },
};
