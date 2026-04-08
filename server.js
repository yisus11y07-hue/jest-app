const express=require('express'),http=require('http'),{Server}=require('socket.io');
const bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),path=require('path');
const db=require('./database');
const app=express(),server=http.createServer(app),io=new Server(server,{cors:{origin:'*'}});
const JWT_SECRET=process.env.JWT_SECRET||'jest-secret-2024';
const PORT=process.env.PORT||3000;
app.use(express.json({limit:'20mb'}));
app.use(express.static(path.join(__dirname,'public')));
const auth=(req,res,next)=>{const t=req.headers.authorization?.split(' ')[1];if(!t)return res.status(401).json({error:'No autorizado'});try{req.user=jwt.verify(t,JWT_SECRET);next();}catch{res.status(401).json({error:'Token inválido'});}};
const onlineUsers=new Map();

app.post('/api/register',async(req,res)=>{
  try{
    const{username,display_name,password}=req.body;
    if(!username?.trim()||!password?.trim())return res.status(400).json({error:'Usuario y contraseña requeridos'});
    if(username.length<3||username.length>20)return res.status(400).json({error:'Usuario: 3-20 caracteres'});
    if(!/^[a-zA-Z0-9_]+$/.test(username))return res.status(400).json({error:'Solo letras, números y _'});
    if(db.getUserByUsername(username))return res.status(400).json({error:'Ese usuario ya existe'});
    const hash=await bcrypt.hash(password,10);
    const g=db.GRADIENTS[Math.floor(Math.random()*db.GRADIENTS.length)];
    const user=db.createUser(username,display_name?.trim()||username,hash,g);
    const token=jwt.sign({id:user.id,username:user.username},JWT_SECRET,{expiresIn:'30d'});
    res.json({token,user});
  }catch(e){console.error(e);res.status(500).json({error:'Error al crear cuenta'});}
});
app.post('/api/login',async(req,res)=>{
  try{
    const{username,password}=req.body;
    const user=db.getUserByUsername(username);
    if(!user)return res.status(400).json({error:'Usuario no encontrado'});
    if(!await bcrypt.compare(password,user.password_hash))return res.status(400).json({error:'Contraseña incorrecta'});
    db.updateLastSeen(user.id);
    const token=jwt.sign({id:user.id,username:user.username},JWT_SECRET,{expiresIn:'30d'});
    res.json({token,user:{id:user.id,username:user.username,display_name:user.display_name,gradient:user.gradient,status:user.status||''}});
  }catch(e){res.status(500).json({error:'Error al iniciar sesión'});}
});
app.get('/api/me',auth,(req,res)=>{
  const user=db.getUserById(req.user.id);
  if(!user)return res.status(404).json({error:'No encontrado'});
  res.json(user);
});
app.put('/api/me/password',auth,async(req,res)=>{
  try{
    const{current,newPassword}=req.body;
    if(!current||!newPassword)return res.status(400).json({error:'Faltan datos'});
    if(newPassword.length<4)return res.status(400).json({error:'Mínimo 4 caracteres'});
    const user=db.getUserByIdFull(req.user.id);
    if(!await bcrypt.compare(current,user.password_hash))return res.status(400).json({error:'Contraseña actual incorrecta'});
    db.updatePassword(req.user.id,await bcrypt.hash(newPassword,10));
    res.json({success:true});
  }catch(e){res.status(500).json({error:'Error'});}
});
app.put('/api/me/status',auth,(req,res)=>{
  const{status}=req.body;
  db.updateStatus(req.user.id,status||'');
  io.emit('user_status_update',{userId:req.user.id,status:status||''});
  res.json({success:true});
});
app.get('/api/users',auth,(req,res)=>{
  const users=db.getAllUsers(req.user.id);
  const online=[...onlineUsers.keys()];
  const result=users.map(u=>({...u,online:online.includes(u.id),last_message:db.getLastMessage(req.user.id,u.id)||null}));
  result.sort((a,b)=>{if(a.online!==b.online)return a.online?-1:1;const at=a.last_message?.created_at||0,bt=b.last_message?.created_at||0;return bt>at?1:-1;});
  res.json(result);
});
app.get('/api/messages/:userId',auth,(req,res)=>{res.json(db.getMessages(req.user.id,parseInt(req.params.userId)));});
app.put('/api/messages/:id',auth,(req,res)=>{
  const{text}=req.body;
  if(!text?.trim())return res.status(400).json({error:'Texto vacío'});
  const updated=db.editMessage(parseInt(req.params.id),req.user.id,text.trim());
  if(!updated)return res.status(403).json({error:'No autorizado'});
  io.to(`u_${req.user.id}`).emit('message_edited',updated);
  io.to(`u_${updated.receiver_id}`).emit('message_edited',updated);
  res.json(updated);
});
app.delete('/api/messages/:id',auth,(req,res)=>{
  const result=db.deleteMessage(parseInt(req.params.id),req.user.id);
  if(!result)return res.status(403).json({error:'No autorizado'});
  io.to(`u_${req.user.id}`).emit('message_deleted',{id:result.id});
  io.to(`u_${result.receiver_id}`).emit('message_deleted',{id:result.id});
  res.json({success:true});
});
app.post('/api/reactions',auth,(req,res)=>{
  const{message_id,emoji}=req.body;
  const reactions=db.toggleReaction(message_id,req.user.id,emoji);
  res.json(reactions);
});
app.get('/api/online',auth,(req,res)=>{res.json([...onlineUsers.keys()]);});

io.use((socket,next)=>{
  const t=socket.handshake.auth?.token;
  if(!t)return next(new Error('No autorizado'));
  try{socket.user=jwt.verify(t,JWT_SECRET);next();}catch{next(new Error('Token inválido'));}
});
io.on('connection',socket=>{
  const uid=socket.user.id;
  onlineUsers.set(uid,socket.id);
  socket.join(`u_${uid}`);
  socket.broadcast.emit('user_status',{userId:uid,online:true});
  socket.on('send_message',({to,text,mood})=>{
    if(!to||!text?.trim())return;
    const msg=db.createMessage(uid,to,text.trim(),mood||'normal');
    io.to(`u_${to}`).emit('new_message',msg);
    socket.emit('message_sent',msg);
  });
  socket.on('typing_start',({to})=>io.to(`u_${to}`).emit('typing',{from:uid}));
  socket.on('typing_stop',({to})=>io.to(`u_${to}`).emit('stop_typing',{from:uid}));
  socket.on('reaction',({message_id,emoji,other_user_id})=>{
    const reactions=db.toggleReaction(message_id,uid,emoji);
    const payload={message_id,reactions};
    socket.emit('reaction_update',payload);
    if(other_user_id)io.to(`u_${other_user_id}`).emit('reaction_update',payload);
  });
  socket.on('disconnect',()=>{
    onlineUsers.delete(uid);db.updateLastSeen(uid);
    socket.broadcast.emit('user_status',{userId:uid,online:false});
  });
});
server.listen(PORT,()=>{
  console.log('\n╔════════════════════════════════════╗');
  console.log('║          JEST  —  Mensajería        ║');
  console.log('╠════════════════════════════════════╣');
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log('╚════════════════════════════════════╝\n');
});
