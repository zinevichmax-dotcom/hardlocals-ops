import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import multer from 'multer';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4000;

const {
  ANTHROPIC_API_KEY,
  TG_BOT_TOKEN,
  TG_CHANNEL_ID,
  TG_LOCAL_API = 'http://host.docker.internal:8082',
  JWT_SECRET = 'hardlocals-ops-secret-change-me',
  ADMIN_USER = 'admin',
  ADMIN_PASS = 'hardlocals2026',
  VK_ACCESS_TOKEN,
  VK_GROUP_ID,
  UNSPLASH_KEY,
  PEXELS_KEY,
} = process.env;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

// ═══════ DB ═══════
if (!existsSync(join(__dirname, 'data'))) mkdirSync(join(__dirname, 'data'), { recursive: true });
const db = new Database(join(__dirname, 'data', 'ops.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rubric TEXT,
    content TEXT,
    platform TEXT,
    status TEXT DEFAULT 'draft',
    media_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    rubric TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_templates_rubric ON templates(rubric);
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nickname TEXT,
    birthday TEXT,
    bike TEXT,
    notes TEXT,
    photo_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_members_bday ON members(birthday);
`);

// Migration: add photo_path if missing
try {
  const cols = db.prepare("PRAGMA table_info(members)").all();
  if (!cols.find(c => c.name === 'photo_path')) {
    db.exec('ALTER TABLE members ADD COLUMN photo_path TEXT');
    console.log('Migration: added photo_path to members');
  }
} catch (e) { console.error('Migration error:', e.message); }

const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER);
if (!adminExists) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(ADMIN_USER, hash);
  console.log(`Admin user "${ADMIN_USER}" created`);
}

// ═══════ AUTH ═══════
function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username: user.username });
});

app.post('/api/auth/check', auth, (req, res) => {
  res.json({ ok: true, username: req.user.username });
});

// ═══════ CLAUDE PROXY ═══════
app.post('/api/generate', auth, async (req, res) => {
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════ IMAGE SEARCH ═══════
app.post('/api/image-search', auth, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'No query' });

  if (UNSPLASH_KEY) {
    try {
      const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=9&orientation=landscape`, {
        headers: { 'Authorization': `Client-ID ${UNSPLASH_KEY}` },
      });
      const d = await r.json();
      if (d.results && d.results.length > 0) {
        return res.json({
          source: 'unsplash',
          images: d.results.map(x => ({
            url: x.urls.regular,
            thumb: x.urls.small,
            author: x.user.name,
          })),
        });
      }
    } catch (e) { console.error('Unsplash:', e.message); }
  }

  if (PEXELS_KEY) {
    try {
      const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=9&orientation=landscape`, {
        headers: { 'Authorization': PEXELS_KEY },
      });
      const d = await r.json();
      if (d.photos && d.photos.length > 0) {
        return res.json({
          source: 'pexels',
          images: d.photos.map(x => ({
            url: x.src.large,
            thumb: x.src.medium,
            author: x.photographer,
          })),
        });
      }
    } catch (e) { console.error('Pexels:', e.message); }
  }

  res.json({ source: 'none', images: [] });
});

// ═══════ MEDIA UPLOAD ═══════
if (!existsSync(join(__dirname, 'uploads'))) mkdirSync(join(__dirname, 'uploads'), { recursive: true });
const upload = multer({ dest: join(__dirname, 'uploads'), limits: { fileSize: 100 * 1024 * 1024 } });

app.post('/api/upload', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({
    path: `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    size: req.file.size,
    mimetype: req.file.mimetype,
  });
});

app.use('/uploads', express.static(join(__dirname, 'uploads')));

// ═══════ TELEGRAM POSTING ═══════
app.post('/api/post/telegram', auth, async (req, res) => {
  if (!TG_BOT_TOKEN) return res.status(500).json({ error: 'TG_BOT_TOKEN not configured' });
  if (!TG_CHANNEL_ID) return res.status(500).json({ error: 'TG_CHANNEL_ID not configured' });

  const { text, media_path, rubric } = req.body;
  const apiBase = `${TG_LOCAL_API}/bot${TG_BOT_TOKEN}`;

  console.log('[TG] Post request:', { text_length: text?.length, has_media: !!media_path, media_path });

  try {
    let result;
    if (media_path && existsSync(join(__dirname, media_path.replace(/^\//, '')))) {
      const filePath = join(__dirname, media_path.replace(/^\//, ''));
      console.log('[TG] Sending with media:', filePath);
      const formData = new FormData();
      formData.append('chat_id', TG_CHANNEL_ID);
      formData.append('caption', text);
      formData.append('parse_mode', 'HTML');

      const fileBuffer = readFileSync(filePath);
      const blob = new Blob([fileBuffer]);

      if (media_path.match(/\.(mp4|mov|avi|webm)$/i)) {
        formData.append('video', blob, 'video.mp4');
        result = await fetch(`${apiBase}/sendVideo`, { method: 'POST', body: formData });
      } else {
        formData.append('photo', blob, 'photo.jpg');
        result = await fetch(`${apiBase}/sendPhoto`, { method: 'POST', body: formData });
      }
    } else {
      if (media_path) console.log('[TG] media_path provided but file not found:', media_path);
      console.log('[TG] Sending as text only');
      result = await fetch(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHANNEL_ID,
          text: text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });
    }

    const data = await result.json();
    console.log('[TG] Response:', data.ok ? 'OK' : data.description);
    if (data.ok) {
      db.prepare('INSERT INTO posts (rubric, content, platform, status, media_path) VALUES (?, ?, ?, ?, ?)').run(
        rubric || 'unknown', text, 'telegram', 'sent', media_path || null
      );
      res.json({ ok: true, message_id: data.result?.message_id });
    } else {
      res.status(400).json({ error: data.description || 'TG API error' });
    }
  } catch (e) {
    console.error('[TG] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ═══════ VK POSTING ═══════
app.post('/api/post/vk', auth, async (req, res) => {
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID) return res.status(500).json({ error: 'VK not configured' });
  const { text, rubric } = req.body;
  try {
    const params = new URLSearchParams({
      owner_id: `-${VK_GROUP_ID}`,
      from_group: '1',
      message: text,
      access_token: VK_ACCESS_TOKEN,
      v: '5.199',
    });
    const result = await fetch(`https://api.vk.com/method/wall.post?${params}`);
    const data = await result.json();
    if (data.response) {
      db.prepare('INSERT INTO posts (rubric, content, platform, status) VALUES (?, ?, ?, ?)').run(
        rubric || 'unknown', text, 'vk', 'sent'
      );
      res.json({ ok: true, post_id: data.response.post_id });
    } else {
      res.status(400).json({ error: data.error?.error_msg || 'VK API error' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════ TEMPLATES ═══════
app.get('/api/templates', auth, (req, res) => {
  const { rubric } = req.query;
  let rows;
  if (rubric) {
    rows = db.prepare('SELECT * FROM templates WHERE rubric = ? ORDER BY updated_at DESC').all(rubric);
  } else {
    rows = db.prepare('SELECT * FROM templates ORDER BY rubric, updated_at DESC').all();
  }
  res.json(rows);
});

app.post('/api/templates', auth, (req, res) => {
  const { name, rubric, content } = req.body;
  if (!name || !rubric || !content) return res.status(400).json({ error: 'name, rubric, content required' });
  const result = db.prepare('INSERT INTO templates (name, rubric, content) VALUES (?, ?, ?)').run(name, rubric, content);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/templates/:id', auth, (req, res) => {
  const { name, content } = req.body;
  const id = parseInt(req.params.id);
  db.prepare('UPDATE templates SET name = ?, content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, content, id);
  res.json({ ok: true });
});

app.delete('/api/templates/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ═══════ MEMBERS ═══════
app.get('/api/members', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM members ORDER BY name').all();
  res.json(rows);
});

app.get('/api/members/upcoming-birthdays', auth, (req, res) => {
  // Members whose birthday is within the next 7 days (comparing month-day)
  const rows = db.prepare('SELECT * FROM members WHERE birthday IS NOT NULL').all();
  const today = new Date();
  const todayMD = (today.getMonth() + 1).toString().padStart(2, '0') + '-' + today.getDate().toString().padStart(2, '0');
  const in7 = new Date(today.getTime() + 7 * 86400000);
  const in7MD = (in7.getMonth() + 1).toString().padStart(2, '0') + '-' + in7.getDate().toString().padStart(2, '0');

  const upcoming = rows.filter(m => {
    if (!m.birthday) return false;
    // birthday stored as YYYY-MM-DD, extract MM-DD
    const md = m.birthday.slice(5);
    if (todayMD <= in7MD) {
      return md >= todayMD && md <= in7MD;
    } else {
      // year boundary
      return md >= todayMD || md <= in7MD;
    }
  });
  res.json(upcoming);
});

app.post('/api/members', auth, (req, res) => {
  const { name, nickname, birthday, bike, notes, photo_path } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const result = db.prepare('INSERT INTO members (name, nickname, birthday, bike, notes, photo_path) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, nickname || null, birthday || null, bike || null, notes || null, photo_path || null);
  res.json({ ok: true, id: result.lastInsertRowid });
});

app.put('/api/members/:id', auth, (req, res) => {
  const { name, nickname, birthday, bike, notes, photo_path } = req.body;
  const id = parseInt(req.params.id);
  db.prepare('UPDATE members SET name = ?, nickname = ?, birthday = ?, bike = ?, notes = ?, photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(name, nickname || null, birthday || null, bike || null, notes || null, photo_path || null, id);
  res.json({ ok: true });
});

app.delete('/api/members/:id', auth, (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ═══════ HISTORY ═══════
app.get('/api/posts', auth, (req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100').all();
  res.json(posts);
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Hard Locals Content Ops v6.3 (member photos)`);
  console.log(`  → http://0.0.0.0:${PORT}`);
  console.log(`  → Anthropic: ${ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  console.log(`  → TG Bot: ${TG_BOT_TOKEN ? '✓' : '✗'}`);
  console.log(`  → VK: ${VK_ACCESS_TOKEN ? '✓' : '✗'}`);
  console.log(`  → Unsplash: ${UNSPLASH_KEY ? '✓' : '✗'}`);
  console.log(`  → Pexels: ${PEXELS_KEY ? '✓' : '✗'}\n`);
});
