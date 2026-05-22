/*
  ZAWADI DATING APP — BACKEND API
  ================================
  Updated: Special perfect matching for wambuguhkw@gmail.com with you3@example.com & you4@example.com
*/

require('dotenv').config();

// After require('dotenv')
const requiredEnv = ['MONGODB_URI', 'JWT_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missing = requiredEnv.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing environment variables:', missing);
  process.exit(1);
}

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const mongoose   = require('mongoose');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const httpServer = http.createServer(app);

/* ── MIDDLEWARE ─────────────────────────────────────────────── */
const ALLOWED_ORIGINS = [
  'https://maymay.hkw875.workers.dev',
  'https://zawadi.pages.dev',
  'https://zawadi.example.com',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',').map(o => o.trim()) : []),
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV === 'development') {
      return cb(null, true);
    }
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/* ── SOCKET.IO (Real-time chat + WebRTC signaling) ──────────── */
const io = new Server(httpServer, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Map userId → socketId for online presence
const onlineUsers = new Map();

function verifySocketToken(token) {
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
}

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  const decoded = verifySocketToken(token);
  if (!decoded) return next(new Error('Unauthorized'));
  socket.userId = decoded.id;
  next();
});

io.on('connection', (socket) => {
  const uid = socket.userId;
  onlineUsers.set(uid, socket.id);
  socket.join(`user:${uid}`);

  User.findByIdAndUpdate(uid, { lastActive: new Date() }).catch(() => {});

  socket.broadcast.emit('user:online', { userId: uid });

  // Chat & WebRTC handlers (unchanged)
  socket.on('chat:send', async ({ conversationId, text }) => { /* ... */ });
  socket.on('chat:typing', ({ conversationId, isTyping }) => { /* ... */ });
  socket.on('chat:join', (conversationId) => { /* ... */ });
  socket.on('call:offer', ({ targetUserId, offer, conversationId }) => { /* ... */ });
  socket.on('call:answer', ({ targetUserId, answer }) => { /* ... */ });
  socket.on('call:ice', ({ targetUserId, candidate }) => { /* ... */ });
  socket.on('call:end', ({ targetUserId }) => { /* ... */ });
  socket.on('call:reject', ({ targetUserId }) => { /* ... */ });

  socket.on('disconnect', () => {
    onlineUsers.delete(uid);
    socket.broadcast.emit('user:offline', { userId: uid });
    User.findByIdAndUpdate(uid, { lastActive: new Date() }).catch(() => {});
  });
});

/* ── CLOUDINARY CONFIG ──────────────────────────────────────── */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: { folder: 'zawadi-profiles', allowed_formats: ['jpg','jpeg','png','webp'] },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

/* ── MONGODB CONNECTION ─────────────────────────────────────── */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    setTimeout(connectDB, 5000);
  }
};

connectDB();

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Reconnecting...');
  connectDB();
});

/* ════════════════════════════════════════════════════════════
   SCHEMAS (Unchanged)
   ════════════════════════════════════════════════════════════ */
const UserSchema = new mongoose.Schema({ /* ... full schema as before ... */ }, { timestamps: true });
const SwipeSchema = new mongoose.Schema({ /* ... */ });
const MatchSchema = new mongoose.Schema({ /* ... */ });
const MessageSchema = new mongoose.Schema({ /* ... */ });

const User    = mongoose.model('User', UserSchema, 'users');
const Swipe   = mongoose.model('Swipe', SwipeSchema);
const Match   = mongoose.model('Match', MatchSchema);
const Message = mongoose.model('Message', MessageSchema);

/* AUTH MIDDLEWARE */
function auth(req, res, next) { /* ... unchanged ... */ }
function makeToken(userId) { /* ... unchanged ... */ }

/* ROUTES */
app.get('/', (req, res) => res.json({ status: 'Zawadi API running 🌺', version: '1.0.0' }));

/* AUTH ROUTES (unchanged) */
app.post('/api/auth/register', async (req, res) => { /* ... */ });
app.post('/api/auth/login', async (req, res) => { /* ... */ });

app.get('/api/users/me', auth, async (req, res) => { /* ... */ });
app.put('/api/users/me', auth, async (req, res) => { /* ... */ });

app.post('/api/upload', auth, upload.single('photo'), async (req, res) => { /* ... */ });
app.delete('/api/upload', auth, async (req, res) => { /* ... */ });

/* UPDATED DISCOVER ENDPOINT WITH PERFECT MATCHING */
app.get('/api/discover', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id);
    if (!me) return res.status(404).json({ error: 'User not found' });

    // SPECIAL PERFECT MATCH LOGIC
    let specialProfiles = [];
    if (me.email === 'wambuguhkw@gmail.com') {
      specialProfiles = await User.find({
        email: { $in: ['you3@example.com', 'you4@example.com'] }
      }).select('-password -email').lean();
    }

    // Get already swiped users
    const swiped = await Swipe.find({ swipedBy: me._id }).distinct('swipedOn');

    const ageMin = me.ageRange?.min ?? 18;
    const ageMax = me.ageRange?.max ?? 99;

    const filter = {
      _id: { $ne: me._id, $nin: swiped },
      age: { $gte: ageMin, $lte: ageMax },
    };

    const myGender = (me.gender || '').toLowerCase();
    const savedPref = (me.interestedIn || '').toLowerCase();

    let genderFilter = savedPref;
    if (!genderFilter || genderFilter === 'everyone') {
      if (myGender === 'man') genderFilter = 'women';
      else if (myGender === 'woman') genderFilter = 'men';
      else genderFilter = 'everyone';
    }

    if (genderFilter === 'women') filter.gender = 'woman';
    else if (genderFilter === 'men') filter.gender = 'man';

    const rawProfiles = await User
      .find(filter)
      .select('-password -email')
      .sort({ lastActive: -1, _id: -1 })
      .limit(100)
      .lean();

    // Scoring algorithm
    const scored = rawProfiles.map(p => {
      let score = 0;
      const myInterests = new Set((me.interests || []).map(i => i.toLowerCase().trim()));
      const theirInterests = (p.interests || []).map(i => i.toLowerCase().trim());
      const sharedCount = theirInterests.filter(i => myInterests.has(i)).length;
      score += Math.min(sharedCount * 10, 46);

      const theyLikeMyGender = p.interestedIn === 'everyone' ||
        (p.interestedIn === 'women' && myGender === 'woman') ||
        (p.interestedIn === 'men' && myGender === 'man');
      if (theyLikeMyGender) score += 47;

      if (p.bio && p.bio.length > 20) score += 1;
      if (p.photos && p.photos.filter(Boolean).length > 0) score += 1;
      if (p.photos && p.photos.filter(Boolean).length >= 3) score += 1;
      if (p.occupation) score += 1;

      const daysSinceActive = (Date.now() - new Date(p.lastActive).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceActive < 1) score += 2;
      else if (daysSinceActive < 7) score += 1;
      else if (daysSinceActive < 30) score += 1;

      if (p.country && me.country && p.country === me.country) score += 1;

      return { ...p, _matchScore: score };
    });

    scored.sort((a, b) => b._matchScore - a._matchScore || Math.random() - 0.5);

    let profiles = scored.slice(0, 50).map(({ _matchScore, ...p }) => p);

    // Inject special perfect matches at the top
    if (specialProfiles.length > 0) {
      profiles = [...specialProfiles, ...profiles.filter(p => 
        !specialProfiles.some(s => s._id.toString() === p._id.toString())
      )];
    }

    if (profiles.length === 0) {
      const fallback = await User
        .find({ _id: { $ne: me._id }, ...(filter.gender ? { gender: filter.gender } : {}) })
        .select('-password -email')
        .sort({ lastActive: -1 })
        .limit(30)
        .lean();
      return res.json({ profiles: fallback });
    }

    res.json({ profiles });
  } catch (e) {
    console.error('Discover error:', e);
    res.status(500).json({ error: 'Failed to load profiles' });
  }
});

/* Remaining routes unchanged */
app.post('/api/swipe', auth, async (req, res) => { /* ... */ });
app.post('/api/users/:id/view', auth, async (req, res) => { /* ... */ });
app.get('/api/matches', auth, async (req, res) => { /* ... */ });
app.get('/api/conversations', auth, async (req, res) => { /* ... */ });
app.get('/api/messages/:conversationId', auth, async (req, res) => { /* ... */ });
app.post('/api/messages', auth, async (req, res) => { /* ... */ });
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => { /* ... */ });

app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

const PORT = process.env.PORT || 5000;

app.use((err, req, res, next) => {
  console.error('🔥 Unhandled Error:', err.stack || err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});

httpServer.listen(PORT, () => console.log(`🌺 Zawadi API + Socket.IO running on port ${PORT}`));
