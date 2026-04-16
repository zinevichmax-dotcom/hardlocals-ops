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

// Scheduled posts (calendar)
db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scheduled_date TEXT NOT NULL,
    rubric TEXT NOT NULL,
    title TEXT,
    notes TEXT,
    content TEXT,
    status TEXT DEFAULT 'planned',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_date ON scheduled(scheduled_date);
`);

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
  const rows = db.prepare('SELECT * FROM members WHERE birthday IS NOT NULL').all();
  const today = new Date();
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const todayMD = pad(today.getMonth() + 1) + '-' + pad(today.getDate());
  const in7 = new Date(today.getTime() + 7 * 86400000);
  const in7MD = pad(in7.getMonth() + 1) + '-' + pad(in7.getDate());

  const upcoming = rows.filter(m => {
    if (!m.birthday) return false;
    const parts = m.birthday.split('-');
    if (parts.length < 3) return false;
    const md = parts[1] + '-' + parts[2];
    if (todayMD <= in7MD) {
      return md >= todayMD && md <= in7MD;
    } else {
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

// ═══════ RSS FEED ═══════
const RSS_SOURCES = [
  { name: 'Motor.ru', url: 'https://motor.ru/exports/rss.xml' },
  { name: 'Motogonki', url: 'https://motogonki.ru/rss.xml' },
  { name: '110km', url: 'https://110km.ru/rss/news/' },
  { name: 'RBC Авто', url: 'https://rssexport.rbc.ru/rbcnews/auto/30/full.rss' },
];

let rssCache = { items: [], fetched: 0 };

function parseRSSItem(xml) {
  const get = (tag) => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = xml.match(re);
    if (!m) return null;
    let val = m[1].trim();
    val = val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    val = val.replace(/<[^>]+>/g, '').trim();
    return val;
  };
  const getEnclosure = () => {
    const m = xml.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
    return m ? m[1] : null;
  };
  const getImage = () => {
    const enc = getEnclosure();
    if (enc) return enc;
    const mi = xml.match(/<media:content[^>]*url=["']([^"']+)["']/i);
    if (mi) return mi[1];
    const desc = xml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    if (desc) {
      const imgM = desc[1].match(/<img[^>]*src=["']([^"']+)["']/i);
      if (imgM) return imgM[1];
    }
    return null;
  };
  return {
    title: get('title'),
    link: get('link'),
    description: get('description')?.slice(0, 200),
    pubDate: get('pubDate'),
    image: getImage(),
  };
}

async function fetchRSS() {
  const allItems = [];
  await Promise.all(RSS_SOURCES.map(async (src) => {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return;
      const text = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let m;
      let count = 0;
      while ((m = itemRegex.exec(text)) !== null && count < 10) {
        const item = parseRSSItem(m[1]);
        if (item.title && item.link) {
          allItems.push({ ...item, source: src.name });
          count++;
        }
      }
    } catch (e) { console.error('RSS error', src.name, e.message); }
  }));
  // Sort by date desc
  allItems.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dbb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dbb - da;
  });
  return allItems.slice(0, 30);
}

app.get('/api/rss', auth, async (req, res) => {
  const now = Date.now();
  if (rssCache.items.length > 0 && now - rssCache.fetched < 10 * 60 * 1000) {
    return res.json(rssCache.items);
  }
  const items = await fetchRSS();
  rssCache = { items, fetched: now };
  res.json(items);
});

// ═══════ SCHEDULED POSTS (CALENDAR) ═══════
app.get('/api/scheduled', auth, (req, res) => {
  const { from, to } = req.query;
  let rows;
  if (from && to) {
    rows = db.prepare('SELECT * FROM scheduled WHERE scheduled_date >= ? AND scheduled_date <= ? ORDER BY scheduled_date').all(from, to);
  } else {
    rows = db.prepare('SELECT * FROM scheduled ORDER BY scheduled_date').all();
  }
  res.json(rows);
});

app.post('/api/scheduled', auth, (req, res) => {
  const { scheduled_date, rubric, title, notes, content } = req.body;
  if (!scheduled_date || !rubric) return res.status(400).json({ error: 'scheduled_date and rubric required' });
  const r = db.prepare('INSERT INTO scheduled (scheduled_date, rubric, title, notes, content) VALUES (?, ?, ?, ?, ?)')
    .run(scheduled_date, rubric, title || null, notes || null, content || null);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/scheduled/:id', auth, (req, res) => {
  const { scheduled_date, rubric, title, notes, content, status } = req.body;
  const id = parseInt(req.params.id);
  db.prepare('UPDATE scheduled SET scheduled_date=?, rubric=?, title=?, notes=?, content=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(scheduled_date, rubric, title, notes, content, status || 'planned', id);
  res.json({ ok: true });
});

app.delete('/api/scheduled/:id', auth, (req, res) => {
  db.prepare('DELETE FROM scheduled WHERE id = ?').run(parseInt(req.params.id));
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
  console.log(`\n  Hard Locals Content Ops v6.6 (RSS feed + calendar)`);
  console.log(`  → http://0.0.0.0:${PORT}`);
  console.log(`  → Anthropic: ${ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  console.log(`  → TG Bot: ${TG_BOT_TOKEN ? '✓' : '✗'}`);
  console.log(`  → VK: ${VK_ACCESS_TOKEN ? '✓' : '✗'}`);
  console.log(`  → Unsplash: ${UNSPLASH_KEY ? '✓' : '✗'}`);
  console.log(`  → Pexels: ${PEXELS_KEY ? '✓' : '✗'}\n`);
});
