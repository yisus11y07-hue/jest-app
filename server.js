const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const JWT_SECRET = process.env.JWT_SECRET || 'jest-super-secret-2024';
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ──────────────────────────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
};

// ── REST Routes ──────────────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  try {
    const { username, display_name, password } = req.body;
    if (!username?.trim() || !password?.trim())
      return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

    if (username.length < 3 || username.length > 20)
      return res.status(400).json({ error: 'El usuario debe tener entre 3 y 20 caracteres' });

    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return res.status(400).json({ error: 'Solo letras, números y guion bajo' });

    if (db.getUserByUsername(username))
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });

    const hash = await bcrypt.hash(password, 10);
    const gradients = db.GRADIENTS;
    const gradient = gradients[Math.floor(Math.random() * gradients.length)];

    const user = db.createUser(username, display_name?.trim() || username, hash, gradient);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear cuenta' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = db.getUserByUsername(username);
    if (!user) return res.status(400).json({ error: 'Usuario no encontrado' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Contraseña incorrecta' });

    db.updateLastSeen(user.id);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
      token,
      user: { id: user.id, username: user.username, display_name: user.display_name, gradient: user.gradient }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.get('/api/me', auth, (req, res) => {
  const user = db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(user);
});

app.get('/api/users', auth, (req, res) => {
  const users = db.getAllUsers(req.user.id);
  const online = [...onlineUsers.keys()];
  const result = users.map(u => ({
    ...u,
    online: online.includes(u.id),
    last_message: db.getLastMessage(req.user.id, u.id) || null,
  }));
  // Sort: online first, then by last message date
  result.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    const aTime = a.last_message?.created_at || 0;
    const bTime = b.last_message?.created_at || 0;
    return bTime > aTime ? 1 : -1;
  });
  res.json(result);
});

app.get('/api/messages/:userId', auth, (req, res) => {
  const messages = db.getMessages(req.user.id, parseInt(req.params.userId));
  res.json(messages);
});

app.post('/api/reactions', auth, (req, res) => {
  try {
    const { message_id, emoji } = req.body;
    const reactions = db.toggleReaction(message_id, req.user.id, emoji);

    // Notify both users via socket
    const msg = { message_id, reactions };
    io.to(`user_${req.user.id}`).emit('reaction_update', msg);
    // We'll figure out the other user from the message
    res.json(reactions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al procesar reacción' });
  }
});

app.get('/api/online', auth, (req, res) => {
  res.json([...onlineUsers.keys()]);
});

// ── Socket.io ────────────────────────────────────────────────────────────────
const onlineUsers = new Map(); // userId (number) -> socketId

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No autorizado'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Token inválido'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.user.id;
  onlineUsers.set(userId, socket.id);
  socket.join(`user_${userId}`);

  // Notify all others
  socket.broadcast.emit('user_status', { userId, online: true });

  socket.on('send_message', ({ to, text, mood }) => {
    if (!to || !text?.trim()) return;
    const message = db.createMessage(userId, to, text.trim(), mood || 'normal');

    // Send to recipient
    io.to(`user_${to}`).emit('new_message', message);
    // Confirm to sender
    socket.emit('message_sent', message);
  });

  socket.on('typing_start', ({ to }) => {
    io.to(`user_${to}`).emit('typing', { from: userId });
  });

  socket.on('typing_stop', ({ to }) => {
    io.to(`user_${to}`).emit('stop_typing', { from: userId });
  });

  socket.on('reaction', ({ message_id, emoji, other_user_id }) => {
    const reactions = db.toggleReaction(message_id, userId, emoji);
    const payload = { message_id, reactions };
    socket.emit('reaction_update', payload);
    if (other_user_id) io.to(`user_${other_user_id}`).emit('reaction_update', payload);
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(userId);
    db.updateLastSeen(userId);
    socket.broadcast.emit('user_status', { userId, online: false });
  });
});

// ── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════╗');
  console.log('║          JEST  —  Mensajería        ║');
  console.log('╠════════════════════════════════════╣');
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log('╚════════════════════════════════════╝\n');
  console.log('Abre dos pestañas del navegador,');
  console.log('crea dos cuentas y empieza a chatear.\n');
});
