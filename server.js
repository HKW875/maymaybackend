/*
  ZAWADI DATING APP — BACKEND API
  ================================
  Stack:  Node.js + Express + MongoDB (Mongoose) + JWT
  Deploy: Push to GitHub → connect repo on Render.com
          Set env vars on Render dashboard (see .env.example)
  
  Endpoints:
    POST /api/auth/register
    POST /api/auth/login
    GET  /api/discover
    POST /api/swipe
    GET  /api/matches
    GET  /api/conversations
    POST /api/messages
    GET  /api/messages/:conversationId
    PUT  /api/users/me
    GET  /api/users/me
    POST /api/upload
*/

require('dotenv').config();

// After require('dotenv')
const requiredEnv = ['MONGODB_URI', 'JWT_SECRET', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
const missing = requiredEnv.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing environment variables:', missing);
  process.exit(1); // Fail fast in dev
}
const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();


/* ── MIDDLEWARE ─────────────────────────────────────────────── */
app.use(cors({
  origin: [
    'https://maymay.hkw875.workers.dev',
    'https://zawadi.pages.dev',         // your Cloudflare Pages domain
    'https://zawadi.example.com',       // custom domain (update this)
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));

app.options('*', cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5 MB

/* ── MONGODB CONNECTION ─────────────────────────────────────── */

// Better MongoDB connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    // Optional: retry logic
    setTimeout(connectDB, 5000);
  }
};

connectDB();

// Handle disconnection
mongoose.connection.on('disconnected', () => {
  console.log('MongoDB disconnected. Reconnecting...');
  connectDB();
});

/* ════════════════════════════════════════════════════════════
   SCHEMAS
   ════════════════════════════════════════════════════════════ */

const UserSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:     { type: String, required: true },
  age:          { type: Number, required: true, min: 18 },
  gender:       { type: String, enum: ['woman','man','nonbinary'], required: true },
  country:      { type: String, required: true },
  location:     { type: String, default: '' },
  bio:          { type: String, default: '', maxlength: 500 },
  occupation:   { type: String, default: '' },
  interests:    [String],
  photos:       [String],           // Cloudinary URLs
  interestedIn: { type: String, enum: ['women','men','everyone'], default: 'everyone' },
  ageRange:     { min: { type: Number, default: 18 }, max: { type: Number, default: 55 } },
  maxDistance:  { type: Number, default: 100 },
  isPremium:    { type: Boolean, default: false },
  premiumUntil: Date,
  boosts:       { type: Number, default: 0 },
  superLikes:   { type: Number, default: 1 },
  verified:     { type: Boolean, default: false },
  lastActive:   { type: Date, default: Date.now },
  stats: {
    likes:   { type: Number, default: 0 },
    matches: { type: Number, default: 0 },
    views:   { type: Number, default: 0 },
  },
}, { timestamps: true });

UserSchema.pre('save', async function() {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
});

UserSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

UserSchema.methods.toPublic = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.email;
  return obj;
};

const SwipeSchema = new mongoose.Schema({
  swipedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  swipedOn:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  direction: { type: String, enum: ['left','right','super'], required: true },
}, { timestamps: true });
SwipeSchema.index({ swipedBy: 1, swipedOn: 1 }, { unique: true });

const MatchSchema = new mongoose.Schema({
  users:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  lastMessage:  { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  lastActivity: { type: Date, default: Date.now },
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
  sender:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:         { type: String, required: true, maxlength: 2000 },
  read:         { type: Boolean, default: false },
}, { timestamps: true });

const User    = mongoose.model('User', UserSchema, 'users'); // stored in datingapp.users
const Swipe   = mongoose.model('Swipe', SwipeSchema);
const Match   = mongoose.model('Match', MatchSchema);
const Message = mongoose.model('Message', MessageSchema);

/* ════════════════════════════════════════════════════════════
   AUTH MIDDLEWARE
   ════════════════════════════════════════════════════════════ */
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function makeToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

/* ════════════════════════════════════════════════════════════
   ROUTES
   ════════════════════════════════════════════════════════════ */

/* ── HEALTH CHECK ── */
app.get('/', (req, res) => res.json({ status: 'Zawadi API running 🌺', version: '1.0.0' }));

/* ─────────────────────────────────────────────────────────────
   AUTH
   ───────────────────────────────────────────────────────────── */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, age, gender, country } = req.body;
    if (!name || !email || !password || !age || !gender || !country)
      return res.status(400).json({ error: 'All fields required' });
    if (age < 18)
      return res.status(400).json({ error: 'Must be 18 or older' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (await User.findOne({ email }))
      return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({ name, email, password, age, gender, country });
    const token = makeToken(user._id);
    res.status(201).json({ token, user: user.toPublic() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Invalid credentials' });
    user.lastActive = Date.now();
    await user.save();
    const token = makeToken(user._id);
    res.json({ token, user: user.toPublic() });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   USER PROFILE
   ───────────────────────────────────────────────────────────── */
app.get('/api/users/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/users/me', auth, async (req, res) => {
  try {
    const allowed = ['name','age','location','bio','occupation','interests','interestedIn','ageRange','maxDistance'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true }).select('-password');
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   PHOTO UPLOAD
   ───────────────────────────────────────────────────────────── */
app.post('/api/upload', auth, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = req.file.path;
    await User.findByIdAndUpdate(req.user.id, { $push: { photos: url } });
    res.json({ url });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete('/api/upload', auth, async (req, res) => {
  try {
    const { url } = req.body;
    await User.findByIdAndUpdate(req.user.id, { $pull: { photos: url } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   DISCOVER
   ───────────────────────────────────────────────────────────── */
app.get('/api/discover', auth, async (req, res) => {
  try {
    const me = await User.findById(req.user.id);
    if (!me) return res.status(404).json({ error: 'User not found' });

    // IDs already swiped
    const swiped = await Swipe.find({ swipedBy: me._id }).distinct('swipedOn');

    const filter = {
      _id:    { $ne: me._id, $nin: swiped },
      age:    { $gte: me.ageRange.min, $lte: me.ageRange.max },
    };

    if (me.interestedIn === 'women')  filter.gender = 'woman';
    if (me.interestedIn === 'men')    filter.gender = 'man';

    const profiles = await User
      .find(filter)
      .select('-password -email')
      .limit(20)
      .lean();

    res.json({ profiles });
  } catch (e) {
    console.error('Discover error:', e);
    res.status(500).json({ error: 'Failed to load profiles' });
  }
  }
});

/* ─────────────────────────────────────────────────────────────
   SWIPE
   ───────────────────────────────────────────────────────────── */
app.post('/api/swipe', auth, async (req, res) => {
  try {
    const { targetId, direction } = req.body;
    if (!targetId || !direction) return res.status(400).json({ error: 'Missing fields' });

    // Record swipe (ignore duplicates)
    try {
      await Swipe.create({ swipedBy: req.user.id, swipedOn: targetId, direction });
    } catch (e) {
      if (e.code !== 11000) throw e; // duplicate key is fine
    }

    let match = false;
    if (direction === 'right' || direction === 'super') {
      // Check if target liked back
      const theirSwipe = await Swipe.findOne({ swipedBy: targetId, swipedOn: req.user.id, direction: { $in: ['right','super'] } });
      if (theirSwipe) {
        // Create match if it doesn't exist
        const existing = await Match.findOne({ users: { $all: [req.user.id, targetId] } });
        if (!existing) {
          await Match.create({ users: [req.user.id, targetId] });
          // Increment stats
          await User.updateOne({ _id: req.user.id }, { $inc: { 'stats.matches': 1 } });
          await User.updateOne({ _id: targetId },    { $inc: { 'stats.matches': 1 } });
        }
        match = true;
      }
      // Increment likes on target
      await User.updateOne({ _id: targetId }, { $inc: { 'stats.likes': 1 } });
    }
    res.json({ match });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   MATCHES
   ───────────────────────────────────────────────────────────── */
app.get('/api/matches', auth, async (req, res) => {
  try {
    const matches = await Match
      .find({ users: req.user.id })
      .populate('users', '-password -email')
      .populate({ path: 'lastMessage', select: 'text createdAt' })
      .sort({ lastActivity: -1 })
      .lean();

    const formatted = matches.map(m => {
      const other = m.users.find(u => u._id.toString() !== req.user.id);
      return {
        _id:         m._id,
        userId:      other?._id,
        name:        other?.name,
        age:         other?.age,
        location:    other?.location,
        photos:      other?.photos || [],
        lastMessage: m.lastMessage?.text || '',
        time:        m.lastActivity,
        online:      false,
      };
    });

    res.json({ matches: formatted });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   MESSAGES
   ───────────────────────────────────────────────────────────── */
app.get('/api/conversations', auth, async (req, res) => {
  try {
    const convos = await Match
      .find({ users: req.user.id })
      .populate('users', 'name age photos')
      .populate({ path: 'lastMessage', select: 'text createdAt sender' })
      .sort({ lastActivity: -1 })
      .lean();
    res.json({ conversations: convos });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/messages/:conversationId', auth, async (req, res) => {
  try {
    const match = await Match.findOne({ _id: req.params.conversationId, users: req.user.id });
    if (!match) return res.status(403).json({ error: 'Access denied' });
    const messages = await Message.find({ conversation: match._id }).sort({ createdAt: 1 }).lean();
    // Mark as read
    await Message.updateMany({ conversation: match._id, sender: { $ne: req.user.id }, read: false }, { read: true });
    res.json({ messages });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages', auth, async (req, res) => {
  try {
    const { conversationId, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Message required' });

    const match = await Match.findOne({ _id: conversationId, users: req.user.id });
    if (!match) return res.status(403).json({ error: 'Not part of this conversation' });

    const message = await Message.create({ conversation: match._id, sender: req.user.id, text: text.trim() });
    match.lastMessage = message._id;
    match.lastActivity = Date.now();
    await match.save();

    res.status(201).json({ message });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

/* ─────────────────────────────────────────────────────────────
   PREMIUM / SUBSCRIPTION (Stripe webhook placeholder)
   ───────────────────────────────────────────────────────────── */
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify Stripe signature and handle subscription events
  // Reference: https://stripe.com/docs/webhooks
  res.json({ received: true });
});

/* ─────────────────────────────────────────────────────────────
   404
   ───────────────────────────────────────────────────────────── */
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

/* ─────────────────────────────────────────────────────────────
   START
   ───────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;

// Global error handler (must be last, before listen)
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled Error:', err.stack || err);
  res.status(500).json({ 
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined 
  });
});
app.listen(PORT, () => console.log(`🌺 Zawadi API running on port ${PORT}`));
