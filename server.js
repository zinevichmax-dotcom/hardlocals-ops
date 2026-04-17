import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import multer from 'multer';
import { readFileSync, existsSync, mkdirSync, unlinkSync, statSync, writeFileSync } from 'fs';
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
  VK_ALBUM_ID,
  UNSPLASH_KEY,
  PEXELS_KEY,
} = process.env;

app.use(express.json({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

// ═══════ ROUTES DATABASE (10 маршрутов сезона 2026) ═══════
const ROUTES = [
  { n: 1, name: 'Открытие мотосезона', date: null, dateTbd: 'Май 2026 (tbd)', km: null, days: 1, desc: 'Большой клубный OpenAir в Москве. Мотоциклы, громкий звук, диджей, музыка и танцы. Бар, напитки, бургеры, шоу-программа и вступительные речи. Точка старта сезона 2026.' },
  { n: 2, name: 'Оптина Пустынь', date: '2026-05-16', km: 260, days: 2, desc: '260 километров, чтобы сбавить обороты. Дорога, после которой хочется говорить тише и думать глубже. Место, где скорость остаётся за воротами, а ты возвращаешься к себе.' },
  { n: 3, name: 'Санкт-Петербург', date: '2026-06-12', km: 700, days: 3, desc: '700 километров чистого хода. Набережные, мосты, Финский залив и пустые утренние улицы. Город, который мотоциклист чувствует иначе. Питер — это дорога, ритм и свобода без суеты.' },
  { n: 4, name: 'Burning Wheels', date: '2026-06-27', km: 170, days: 1, desc: '170 километров к Волге. Жаркая дорога, пляж, вечер и свои рядом. Фестиваль, где важны не афиши, а ощущение, что ты на своём месте. Лето начинается здесь.' },
  { n: 5, name: 'Суздаль', date: '2026-07-10', km: 250, days: 3, desc: '250 километров и другой темп жизни. Блюз, моторы и древний город. Музыка под открытым небом, дорога как часть ритуала. Классика сезона Hard Locals.' },
  { n: 6, name: 'Нилова Пустынь', date: '2026-08-01', km: 400, days: 2, desc: '400 километров от города и шума. Остров, вода, лес и монастырь над горизонтом. Поездка, где дорога — не цель, а путь внутрь. Для тех, кто понимает ценность уединения.' },
  { n: 7, name: 'Нижний Новгород', date: '2026-08-14', km: 450, days: 3, desc: '450 километров красивой трассы. Город силы, рек и закатов. Волга, Ока и масштаб, который чувствуешь физически. Поездка, после которой хочется ехать дальше.' },
  { n: 8, name: 'Biker Brothers Festival', date: '2026-08-22', km: 50, days: 2, desc: 'Всего 50 километров. Минимум формальностей — максимум своих. Музыка, движение, атмосфера дороги. Фестиваль не про мотоциклы, а про людей, которые на них ездят.' },
  { n: 9, name: 'Кострома', date: '2026-09-05', km: 350, days: 2, desc: '350 километров спокойного хода. История, вода и тишина. Город, где не торопятся и умеют слушать. Точка перезагрузки перед осенью.' },
  { n: 10, name: 'Крым', date: '2026-09-21', km: null, days: 7, desc: 'Не тур. Не отпуск. Мотопаломничество. Серпантин, море, горы и бесконечная дорога. Крым нельзя проехать — его нужно прожить на мотоцикле.' },
];

// Helper: format Date as YYYY-MM-DD in LOCAL timezone (respects TZ env)
function fmtLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function getNextRoute() {
  const today = fmtLocal(new Date());
  const future = ROUTES.filter(r => r.date && r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  return future[0] || ROUTES.filter(r => r.date).pop() || ROUTES[0];
}

function getRouteForWeek(weekDate) {
  const wStart = new Date(weekDate);
  const wEnd = new Date(wStart); wEnd.setDate(wEnd.getDate() + 21);
  const upcoming = ROUTES.filter(r => r.date && r.date >= weekDate && r.date <= fmtLocal(wEnd)).sort((a, b) => a.date.localeCompare(b.date));
  return upcoming[0] || getNextRoute();
}

function getSeasonProgress(dateStr) {
  const nextR = getNextRoute();
  return ROUTES.map(r => ({
    ...r,
    done: r.date ? r.date < dateStr : false,
    next: r === nextR,
  }));
}

// ═══════ SHOP ITEMS (мерч с hardlocals.club/shop) ═══════
const SHOP_ITEMS = [
  { name: 'Бейсболка с сеткой', price: 4500, oldPrice: 5000, desc: 'Размер регулируемый', sale: true },
  { name: 'Худи ездовая', price: 7500, oldPrice: 8500, desc: 'Плотная, тёплая, не продувается', sale: true },
  { name: 'Худи тонкая', price: 6000, oldPrice: 6500, desc: 'Идеально для летних вечеров', sale: true },
  { name: 'Футболка чёрная', price: 4000, oldPrice: 4500, desc: 'Хлопок, суппортовое лого на груди и спине', sale: true },
  { name: 'Свитшот', price: 5000, oldPrice: 5500, desc: 'Лого на всю грудь и по рукавам', sale: true },
  { name: 'Лонгслив', price: 5000, oldPrice: 5500, desc: 'Тонкий, лого во всю спину и по рукавам', sale: true },
  { name: 'Футболка белая', price: 4000, oldPrice: 4500, desc: '', sale: true },
  { name: 'Бафф', price: 1500, oldPrice: 1800, desc: 'One size', sale: true },
  { name: 'Рамка мото', price: 600, desc: 'Для мотоцикла' },
  { name: 'Рамка автомобильная', price: 1200, desc: 'Не забудь — на машину нужно 2 шт.' },
  { name: 'Джерси ездовая', price: 4000, desc: 'Мерч для выезда в колонне' },
  { name: 'Шапка для бани', price: 1000, desc: 'На стиле можно быть не только на байке' },
  { name: 'Стикеры', price: 400, desc: 'На бак, на шлем, на крыло, на двери' },
  { name: 'Шапка', price: 3500, desc: 'One size' },
];

function getRandomShopItems(n) {
  const shuffled = [...SHOP_ITEMS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

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
  CREATE TABLE IF NOT EXISTS humor_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT,
    source_url TEXT,
    text TEXT,
    media_url TEXT,
    media_path TEXT,
    media_type TEXT DEFAULT 'image',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_humor_status ON humor_queue(status);
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
    items TEXT,
    status TEXT DEFAULT 'planned',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_date ON scheduled(scheduled_date);
`);

// Migration: add items column
try {
  const cols = db.prepare("PRAGMA table_info(scheduled)").all();
  if (!cols.find(c => c.name === 'items')) {
    db.exec('ALTER TABLE scheduled ADD COLUMN items TEXT');
    console.log('Migration: added items to scheduled');
  }
  if (!cols.find(c => c.name === 'scheduled_time')) {
    db.exec("ALTER TABLE scheduled ADD COLUMN scheduled_time TEXT DEFAULT '10:00'");
    console.log('Migration: added scheduled_time to scheduled');
  }
  if (!cols.find(c => c.name === 'media_path')) {
    db.exec('ALTER TABLE scheduled ADD COLUMN media_path TEXT');
    console.log('Migration: added media_path to scheduled');
  }
} catch (e) { console.error('Migration error:', e.message); }

// ═══════ AUTO-SCHEDULER (CRON) ═══════
// Checks every 5 minutes for posts with status='ready' and scheduled_date+time <= now
async function runScheduler() {
  const now = new Date();
  // Use local time (respects TZ env var)
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const da = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${mo}-${da}`;
  const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  const readyPosts = db.prepare(`
    SELECT * FROM scheduled
    WHERE status = 'ready'
    AND (scheduled_date < ? OR (scheduled_date = ? AND scheduled_time <= ?))
  `).all(todayStr, todayStr, timeStr);

  if (readyPosts.length === 0) return;
  console.log(`[SCHEDULER] ${todayStr} ${timeStr} — Found ${readyPosts.length} posts to publish`);

  for (const post of readyPosts) {
    try {
      db.prepare("UPDATE scheduled SET status = 'sending' WHERE id = ?").run(post.id);
      const text = post.content;
      if (!text) {
        db.prepare("UPDATE scheduled SET status = 'error', notes = ? WHERE id = ?").run('Нет текста поста', post.id);
        continue;
      }

      const apiBase = `${TG_LOCAL_API}/bot${TG_BOT_TOKEN}`;
      const mediaPaths = post.media_path ? post.media_path.split(',').filter(Boolean) : [];
      let ok = false;
      let msgId = null;

      if (mediaPaths.length === 0) {
        // Text only
        const result = await fetch(`${apiBase}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TG_CHANNEL_ID, text, parse_mode: 'HTML', disable_web_page_preview: false }),
        });
        const data = await result.json();
        ok = data.ok;
        msgId = data.result?.message_id;
        if (!ok) console.error('[SCHEDULER] TG error:', data.description);
      } else if (mediaPaths.length === 1) {
        // Single media
        const p = mediaPaths[0];
        const filePath = join(__dirname, p.replace(/^\//, ''));
        if (!existsSync(filePath)) { console.error('[SCHEDULER] File not found:', p); ok = false; }
        else {
          const isVideo = p.match(/\.(mp4|mov|avi|webm)$/i);
          const fd = new FormData();
          fd.append('chat_id', TG_CHANNEL_ID);
          fd.append('caption', text);
          fd.append('parse_mode', 'HTML');
          fd.append(isVideo ? 'video' : 'photo', new Blob([readFileSync(filePath)]), isVideo ? 'video.mp4' : 'photo.jpg');
          const result = await fetch(`${apiBase}/${isVideo ? 'sendVideo' : 'sendPhoto'}`, { method: 'POST', body: fd });
          const data = await result.json();
          ok = data.ok;
          msgId = data.result?.message_id;
          if (!ok) console.error('[SCHEDULER] TG media error:', data.description);
        }
      } else {
        // Media group
        const fd = new FormData();
        fd.append('chat_id', TG_CHANNEL_ID);
        const mediaArr = [];
        mediaPaths.forEach((p, i) => {
          const filePath = join(__dirname, p.replace(/^\//, ''));
          if (!existsSync(filePath)) return;
          const isVideo = p.match(/\.(mp4|mov|avi|webm)$/i);
          fd.append(`file${i}`, new Blob([readFileSync(filePath)]), isVideo ? `video${i}.mp4` : `photo${i}.jpg`);
          const item = { type: isVideo ? 'video' : 'photo', media: `attach://file${i}` };
          if (i === 0 && text) { item.caption = text; item.parse_mode = 'HTML'; }
          mediaArr.push(item);
        });
        fd.append('media', JSON.stringify(mediaArr));
        const result = await fetch(`${apiBase}/sendMediaGroup`, { method: 'POST', body: fd });
        const data = await result.json();
        ok = data.ok;
        if (!ok) console.error('[SCHEDULER] TG group error:', data.description);
      }

      if (ok) {
        db.prepare("UPDATE scheduled SET status = 'sent', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
        db.prepare('INSERT INTO posts (rubric, content, platform, status, media_path) VALUES (?, ?, ?, ?, ?)').run(
          post.rubric || 'unknown', text, 'telegram', 'sent', post.media_path || null
        );
        console.log(`[SCHEDULER] Published #${post.id}: "${post.title || post.rubric}"`);
      } else {
        db.prepare("UPDATE scheduled SET status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(post.id);
      }
    } catch (e) {
      console.error(`[SCHEDULER] Error publishing #${post.id}:`, e.message);
      db.prepare("UPDATE scheduled SET status = 'error', notes = ? WHERE id = ?").run(e.message, post.id);
    }
  }
}

// Run scheduler every 5 minutes
setInterval(runScheduler, 5 * 60 * 1000);
// Also run once on startup after 30 seconds
setTimeout(runScheduler, 30 * 1000);

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

// Download video from URL via yt-dlp (YouTube, Rutube, Vimeo, Instagram, etc.)
app.post('/api/media/download-url', auth, async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'URL required' });
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Invalid URL' });

  const { spawn } = await import('child_process');
  const filename = `ytdlp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const filePath = join(__dirname, 'uploads', filename);

  console.log('[YT-DLP] Download:', url);

  // yt-dlp with limits: max 720p, max 100MB, mp4 format for compatibility
  const cookiesPath = join(__dirname, 'cookies.txt');
  let hasCookies = false;
  try { hasCookies = existsSync(cookiesPath) && statSync(cookiesPath).isFile() && statSync(cookiesPath).size > 100; } catch {}
  if (hasCookies) console.log('[YT-DLP] Using cookies.txt');

  const args = [
    '--no-playlist',
    '--max-filesize', '100m',
    '--format', 'best[height<=720][ext=mp4]/best[height<=720]/best',
    '--merge-output-format', 'mp4',
    '-o', filePath,
  ];
  if (hasCookies) args.push('--cookies', cookiesPath);
  args.push(url);

  const proc = spawn('yt-dlp', args);
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d.toString() });
  proc.stdout.on('data', (d) => { console.log('[YT-DLP]', d.toString().trim()) });

  const exitCode = await new Promise((resolve) => proc.on('close', resolve));

  if (exitCode !== 0 && !existsSync(filePath)) {
    console.error('[YT-DLP] Failed:', stderr);
    return res.status(400).json({ error: 'Не удалось скачать видео: ' + (stderr.split('\n').filter(l => l.includes('ERROR')).pop() || 'unknown error').slice(0, 200) });
  }

  if (exitCode !== 0 && existsSync(filePath)) {
    console.log('[YT-DLP] Non-zero exit but file exists, treating as success');
  }

  if (!existsSync(filePath)) {
    return res.status(400).json({ error: 'Файл не создан' });
  }

  const stats = statSync(filePath);
  console.log('[YT-DLP] Saved:', filePath, Math.round(stats.size / 1024), 'KB');
  res.json({
    path: `/uploads/${filename}`,
    originalName: url.split('/').pop() || 'video.mp4',
    size: stats.size,
    mimetype: 'video/mp4',
  });
});

app.use('/uploads', express.static(join(__dirname, 'uploads')));

// ═══════ TELEGRAM POSTING ═══════
app.post('/api/post/telegram', auth, async (req, res) => {
  if (!TG_BOT_TOKEN) return res.status(500).json({ error: 'TG_BOT_TOKEN not configured' });
  if (!TG_CHANNEL_ID) return res.status(500).json({ error: 'TG_CHANNEL_ID not configured' });

  const { text, media_path, media_paths, rubric } = req.body;
  const apiBase = `${TG_LOCAL_API}/bot${TG_BOT_TOKEN}`;

  // Normalize media: accept either single path or array
  let paths = [];
  if (Array.isArray(media_paths) && media_paths.length > 0) paths = media_paths;
  else if (media_path) paths = [media_path];

  // Validate files exist
  paths = paths.filter(p => existsSync(join(__dirname, p.replace(/^\//, ''))));

  console.log('[TG] Post request:', { text_length: text?.length, media_count: paths.length });

  const TG_CAPTION_LIMIT = 1024;
  try {
    if (paths.length === 0) {
      // Text only
      console.log('[TG] Sending as text only');
      const result = await fetch(`${apiBase}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TG_CHANNEL_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false,
        }),
      });
      const data = await result.json();
      console.log('[TG] Response:', data.ok ? 'OK' : data.description);
      if (data.ok) {
        db.prepare('INSERT INTO posts (rubric, content, platform, status, media_path) VALUES (?, ?, ?, ?, ?)').run(
          rubric || 'unknown', text, 'telegram', 'sent', null
        );
        return res.json({ ok: true, message_id: data.result?.message_id });
      }
      return res.status(400).json({ error: data.description || 'TG API error' });
    }

    if (text && text.length > TG_CAPTION_LIMIT) {
      console.log('[TG] Rejected: caption', text.length, '> limit', TG_CAPTION_LIMIT);
      return res.status(400).json({ error: `Пост слишком длинный для отправки с медиа: ${text.length}/${TG_CAPTION_LIMIT} символов. Сократи текст или открепи медиа.` });
    }

    if (paths.length === 1) {
      // Single photo/video
      const p = paths[0];
      const filePath = join(__dirname, p.replace(/^\//, ''));
      const isVideo = p.match(/\.(mp4|mov|avi|webm)$/i);
      console.log('[TG] Sending single', isVideo ? 'video' : 'photo', filePath);
      const fd = new FormData();
      fd.append('chat_id', TG_CHANNEL_ID);
      fd.append('caption', text || '');
      fd.append('parse_mode', 'HTML');
      const blob = new Blob([readFileSync(filePath)]);
      if (isVideo) {
        fd.append('video', blob, 'video.mp4');
      } else {
        fd.append('photo', blob, 'photo.jpg');
      }
      const result = await fetch(`${apiBase}/${isVideo ? 'sendVideo' : 'sendPhoto'}`, { method: 'POST', body: fd });
      const data = await result.json();
      console.log('[TG] Response:', data.ok ? 'OK' : data.description);
      if (data.ok) {
        db.prepare('INSERT INTO posts (rubric, content, platform, status, media_path) VALUES (?, ?, ?, ?, ?)').run(
          rubric || 'unknown', text, 'telegram', 'sent', p
        );
        return res.json({ ok: true, message_id: data.result?.message_id });
      }
      return res.status(400).json({ error: data.description || 'TG API error' });
    }

    // Multiple media → sendMediaGroup (max 10 per group)
    if (paths.length > 10) {
      return res.status(400).json({ error: 'Максимум 10 медиа в карусели' });
    }
    console.log('[TG] Sending media group, count:', paths.length);
    const fd = new FormData();
    fd.append('chat_id', TG_CHANNEL_ID);
    const mediaArr = [];
    paths.forEach((p, i) => {
      const isVideo = p.match(/\.(mp4|mov|avi|webm)$/i);
      const attachName = `file${i}`;
      const fileName = isVideo ? `video${i}.mp4` : `photo${i}.jpg`;
      const blob = new Blob([readFileSync(join(__dirname, p.replace(/^\//, '')))]);
      fd.append(attachName, blob, fileName);
      const mediaItem = {
        type: isVideo ? 'video' : 'photo',
        media: `attach://${attachName}`,
      };
      // Caption only on first item
      if (i === 0 && text) {
        mediaItem.caption = text;
        mediaItem.parse_mode = 'HTML';
      }
      mediaArr.push(mediaItem);
    });
    fd.append('media', JSON.stringify(mediaArr));
    const result = await fetch(`${apiBase}/sendMediaGroup`, { method: 'POST', body: fd });
    const data = await result.json();
    console.log('[TG] Group response:', data.ok ? 'OK' : data.description);
    if (data.ok) {
      db.prepare('INSERT INTO posts (rubric, content, platform, status, media_path) VALUES (?, ?, ?, ?, ?)').run(
        rubric || 'unknown', text, 'telegram', 'sent', paths.join(',')
      );
      return res.json({ ok: true, message_ids: (data.result || []).map(m => m.message_id) });
    }
    return res.status(400).json({ error: data.description || 'TG API error' });
  } catch (e) {
    console.error('[TG] Error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// ═══════ VK POSTING ═══════

// Upload photo via album (album ID must be set in VK_ALBUM_ID env var)
async function vkUploadPhoto(filePath) {
  if (!VK_ALBUM_ID) throw new Error('VK_ALBUM_ID не задан в .env. Создай альбом в группе и укажи его ID.');
  const albumId = VK_ALBUM_ID;

  // 1. Get upload server for album
  const uploadServerRes = await fetch(
    `https://api.vk.com/method/photos.getUploadServer?group_id=${VK_GROUP_ID}&album_id=${albumId}&access_token=${VK_ACCESS_TOKEN}&v=5.199`
  );
  const uploadServer = await uploadServerRes.json();
  if (!uploadServer.response) throw new Error('VK getUploadServer: ' + (uploadServer.error?.error_msg || 'unknown'));

  // 2. Upload file (field name for album = file1)
  const fd = new FormData();
  const buf = readFileSync(filePath);
  fd.append('file1', new Blob([buf]), 'photo.jpg');
  const uploadRes = await fetch(uploadServer.response.upload_url, { method: 'POST', body: fd });
  const uploaded = await uploadRes.json();
  if (!uploaded.photos_list) throw new Error('VK upload: no photos_list in response');

  // 3. Save
  const saveParams = new URLSearchParams({
    group_id: VK_GROUP_ID,
    album_id: String(albumId),
    server: String(uploaded.server),
    photos_list: uploaded.photos_list,
    hash: uploaded.hash,
    access_token: VK_ACCESS_TOKEN,
    v: '5.199',
  });
  if (uploaded.aid) saveParams.set('aid', String(uploaded.aid));
  const saveRes = await fetch(`https://api.vk.com/method/photos.save?${saveParams}`);
  const saved = await saveRes.json();
  if (!saved.response || !saved.response[0]) throw new Error('VK photos.save: ' + (saved.error?.error_msg || 'unknown'));
  const p = saved.response[0];
  return `photo${p.owner_id}_${p.id}`;
}

// Helper: upload video to VK and return "video{owner_id}_{video_id}"
async function vkUploadVideo(filePath, name) {
  const saveRes = await fetch(
    `https://api.vk.com/method/video.save?group_id=${VK_GROUP_ID}&name=${encodeURIComponent(name || 'video')}&access_token=${VK_ACCESS_TOKEN}&v=5.199`
  );
  const saved = await saveRes.json();
  if (!saved.response) throw new Error('VK video.save: ' + (saved.error?.error_msg || 'unknown'));

  const fd = new FormData();
  const buf = readFileSync(filePath);
  fd.append('video_file', new Blob([buf]), name || 'video.mp4');
  const uploadRes = await fetch(saved.response.upload_url, { method: 'POST', body: fd });
  const uploaded = await uploadRes.json();
  if (uploaded.error) throw new Error('VK video upload: ' + JSON.stringify(uploaded.error));
  return `video${saved.response.owner_id}_${saved.response.video_id}`;
}

app.post('/api/post/vk', auth, async (req, res) => {
  if (!VK_ACCESS_TOKEN || !VK_GROUP_ID) return res.status(500).json({ error: 'VK not configured' });
  const { text, media_path, media_paths, rubric } = req.body;

  // Normalize paths
  let paths = [];
  if (Array.isArray(media_paths) && media_paths.length > 0) paths = media_paths;
  else if (media_path) paths = [media_path];
  paths = paths.filter(p => existsSync(join(__dirname, p.replace(/^\//, ''))));

  console.log('[VK] Post request:', { text_length: text?.length, media_count: paths.length });

  try {
    // Upload media to VK
    const attachments = [];
    for (const p of paths) {
      const filePath = join(__dirname, p.replace(/^\//, ''));
      const isVideo = p.match(/\.(mp4|mov|avi|webm)$/i);
      try {
        const att = isVideo
          ? await vkUploadVideo(filePath, p.split('/').pop())
          : await vkUploadPhoto(filePath);
        attachments.push(att);
        console.log('[VK] Uploaded', att);
      } catch (e) {
        console.error('[VK] Upload error for', p, e.message);
        return res.status(400).json({ error: `Ошибка загрузки медиа в VK: ${e.message}` });
      }
    }

    // Post to wall
    const params = new URLSearchParams({
      owner_id: `-${VK_GROUP_ID}`,
      from_group: '1',
      message: text || '',
      access_token: VK_ACCESS_TOKEN,
      v: '5.199',
    });
    if (attachments.length > 0) params.set('attachments', attachments.join(','));

    const result = await fetch(`https://api.vk.com/method/wall.post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    const data = await result.json();
    if (data.response) {
      db.prepare('INSERT INTO posts (rubric, content, platform, status, media_path) VALUES (?, ?, ?, ?, ?)').run(
        rubric || 'unknown', text, 'vk', 'sent', paths.join(',') || null
      );
      console.log('[VK] Posted', data.response.post_id);
      return res.json({ ok: true, post_id: data.response.post_id });
    } else {
      console.error('[VK] API error:', data.error);
      return res.status(400).json({ error: data.error?.error_msg || 'VK API error' });
    }
  } catch (e) {
    console.error('[VK] Error:', e);
    return res.status(500).json({ error: e.message });
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
  { name: 'Motogonki MotoGP', url: 'https://www.motogonki.ru/feed/motogonki_motogp.xml', motoOnly: true },
  { name: 'Motor.ru', url: 'https://motor.ru/exports/rss.xml', motoOnly: false },
  { name: '110km', url: 'https://110km.ru/rss/news/', motoOnly: false },
];

let rssCache = { items: [], fetched: 0 };

function parseRSSItem(xml) {
  const get = (tag) => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = xml.match(re);
    if (!m) return null;
    let val = m[1].trim();
    val = val.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return val;
  };
  const getPlain = (tag) => {
    const val = get(tag);
    if (!val) return null;
    return val.replace(/<[^>]+>/g, '').trim();
  };
  const getImage = () => {
    const enc = xml.match(/<enclosure[^>]*url=["']([^"']+)["']/i);
    if (enc) return enc[1];
    const media = xml.match(/<media:content[^>]*url=["']([^"']+)["']/i);
    if (media) return media[1];
    const descFull = xml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    if (descFull) {
      const imgM = descFull[1].match(/<img[^>]*src=["']([^"']+)["']/i);
      if (imgM) return imgM[1];
    }
    const contentFull = xml.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
    if (contentFull) {
      const imgM = contentFull[1].match(/<img[^>]*src=["']([^"']+)["']/i);
      if (imgM) return imgM[1];
    }
    return null;
  };
  return {
    title: getPlain('title'),
    link: getPlain('link'),
    description: (getPlain('description') || '').slice(0, 200),
    pubDate: getPlain('pubDate') || getPlain('pubdate'),
    image: getImage(),
  };
}

async function fetchRSS() {
  const allItems = [];
  await Promise.all(RSS_SOURCES.map(async (src) => {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { console.error('RSS', src.name, 'status', res.status); return; }
      const text = await res.text();
      const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
      let m;
      let count = 0;
      while ((m = itemRegex.exec(text)) !== null && count < 20) {
        const item = parseRSSItem(m[1]);
        if (item.title && item.link) {
          allItems.push({ ...item, source: src.name, motoOnly: src.motoOnly });
          count++;
        }
      }
      console.log('RSS', src.name, count, 'items');
    } catch (e) { console.error('RSS error', src.name, e.message); }
  }));

  const EXCLUDE_STRONG = [
    'haval', 'хавал', 'tank ', 'chery', 'черри', 'geely', 'джили',
    'lada', 'лада', 'kia ', 'toyota', 'тойота', 'mazda', 'мазда',
    'кроссовер', 'седан', 'хэтчбек', 'хетчбек', 'внедорожник',
    'премиум-седан', 'спорткар', 'суперкар', 'пикап', 'minivan',
  ];
  const MOTO_HINTS = [
    'мото', 'мотоцик', 'байк', 'байкер', 'эндуро', 'скутер', 'чоппер', 'круизер',
    'harley', 'ducati', 'kawasaki', 'yamaha', 'motorrad', 'ktm', 'triumph',
    'aprilia', 'motogp', 'dakar', 'superbike', 'motorcycle', 'motorbike',
    'суперкросс', 'мотокросс', 'мотогонк', 'сбирайдер', 'bmw r', 'bmw g', 'bmw f',
  ];

  const filtered = allItems.filter(item => {
    if (item.motoOnly) return true;
    const h = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
    const hasMoto = MOTO_HINTS.some(kw => h.includes(kw));
    const hasCar = EXCLUDE_STRONG.some(kw => h.includes(kw));
    if (hasCar && !hasMoto) return false;
    return hasMoto;
  });

  filtered.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dbb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dbb - da;
  });
  return filtered.slice(0, 40);
}

// Bikepost HTML scraper
async function fetchBikepost() {
  try {
    const res = await fetch('https://bikepost.ru/blog/moto_news/', { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const html = await res.text();
    const items = [];
    const linkRegex = /<a\s+href="(https:\/\/bikepost\.ru\/blog\/moto_news\/\d+\/[^"]+\.html)"[^>]*>([^<]+)<\/a>/gi;
    const seen = new Set();
    let m;
    while ((m = linkRegex.exec(html)) !== null && items.length < 10) {
      const url = m[1];
      if (seen.has(url)) continue;
      seen.add(url);
      const title = m[2].replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&nbsp;/g, ' ').trim();
      if (title.length < 15) continue;
      items.push({
        title,
        link: url,
        description: '',
        pubDate: null,
        image: null,
        source: 'Bikepost',
      });
    }
    console.log('Bikepost scrape', items.length, 'items');
    return items;
  } catch (e) {
    console.error('Bikepost error', e.message);
    return [];
  }
}

// Telegram public channels
const TG_CHANNELS = ['bikepostru', 'hardlocals', 'motonewsru', 'motobratia'];

async function fetchTelegramChannels() {
  const items = [];
  await Promise.all(TG_CHANNELS.map(async (ch) => {
    try {
      const res = await fetch(`https://t.me/s/${ch}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) { console.log('TG', ch, 'status', res.status); return; }
      const html = await res.text();

      // Extract messages: each message is wrapped in tgme_widget_message_wrap
      const msgRegex = /<div class="tgme_widget_message_wrap[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
      // Simpler: find each message by the message bubble
      const bubbleRegex = /<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"[^>]*>([\s\S]*?)(?=<div class="tgme_widget_message[^"]*"[^>]*data-post=|<\/section>)/gi;
      let m;
      let count = 0;
      while ((m = bubbleRegex.exec(html)) !== null && count < 5) {
        const dataPost = m[1];
        const body = m[2];
        // Extract text
        const textMatch = body.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        let text = '';
        if (textMatch) {
          text = textMatch[1].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
            .replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ').trim();
        }
        // Extract image
        let image = null;
        const imgMatch = body.match(/tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\(['"]([^'"]+)['"]/i);
        if (imgMatch) image = imgMatch[1];
        // Extract date
        const dateMatch = body.match(/datetime="([^"]+)"/i);
        const pubDate = dateMatch ? dateMatch[1] : null;

        if (text && text.length > 20) {
          items.push({
            title: text.slice(0, 120) + (text.length > 120 ? '...' : ''),
            description: text.slice(0, 300),
            link: `https://t.me/${dataPost}`,
            pubDate,
            image,
            source: `TG: @${ch}`,
          });
          count++;
        }
      }
      console.log('TG', ch, count, 'posts');
    } catch (e) { console.error('TG error', ch, e.message); }
  }));
  return items;
}

app.get('/api/rss', auth, async (req, res) => {
  const now = Date.now();
  if (rssCache.items.length > 0 && now - rssCache.fetched < 10 * 60 * 1000) {
    return res.json(rssCache.items);
  }
  const [rssItems, bikepostItems, tgItems] = await Promise.all([
    fetchRSS(),
    fetchBikepost(),
    fetchTelegramChannels(),
  ]);
  const merged = [...rssItems, ...bikepostItems, ...tgItems];
  merged.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const dbb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return dbb - da;
  });
  rssCache = { items: merged.slice(0, 60), fetched: now };
  res.json(rssCache.items);
});

app.post('/api/rss/refresh', auth, async (req, res) => {
  rssCache = { items: [], fetched: 0 };
  res.json({ ok: true });
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
  const { scheduled_date, rubric, title, notes, content, items } = req.body;
  if (!scheduled_date || !rubric) return res.status(400).json({ error: 'scheduled_date and rubric required' });
  const r = db.prepare('INSERT INTO scheduled (scheduled_date, rubric, title, notes, content, items) VALUES (?, ?, ?, ?, ?, ?)')
    .run(scheduled_date, rubric, title || null, notes || null, content || null, items ? JSON.stringify(items) : null);
  res.json({ ok: true, id: r.lastInsertRowid });
});

app.put('/api/scheduled/:id', auth, (req, res) => {
  const { scheduled_date, scheduled_time, rubric, title, notes, content, items, status, media_path } = req.body;
  const id = parseInt(req.params.id);
  db.prepare('UPDATE scheduled SET scheduled_date=?, scheduled_time=?, rubric=?, title=?, notes=?, content=?, items=?, status=?, media_path=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .run(scheduled_date, scheduled_time || '10:00', rubric, title, notes, content, items ? JSON.stringify(items) : null, status || 'planned', media_path || null, id);
  res.json({ ok: true });
});

// Return list of URLs currently present in any non-sent scheduled post
app.get('/api/scheduled/collected-urls', auth, (req, res) => {
  const rows = db.prepare("SELECT items FROM scheduled WHERE status != 'sent' AND items IS NOT NULL").all();
  const urls = new Set();
  for (const row of rows) {
    try {
      const items = JSON.parse(row.items);
      for (const it of items) {
        if (it && it.link) urls.add(it.link);
      }
    } catch (e) {}
  }
  res.json(Array.from(urls));
});

// Add an item (news link) to a scheduled post
app.post('/api/scheduled/:id/items', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const row = db.prepare('SELECT items FROM scheduled WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  let items = [];
  try { items = row.items ? JSON.parse(row.items) : []; } catch { items = []; }
  items.push(req.body);
  db.prepare('UPDATE scheduled SET items=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(items), id);
  res.json({ ok: true, items });
});

app.delete('/api/scheduled/:id', auth, (req, res) => {
  db.prepare('DELETE FROM scheduled WHERE id = ?').run(parseInt(req.params.id));
  res.json({ ok: true });
});

// Save generated content back to a scheduled draft (also supports date move for drag-drop)
app.post('/api/scheduled/:id/content', auth, (req, res) => {
  const id = parseInt(req.params.id);
  const { content, media_path, scheduled_date, status } = req.body;
  if (scheduled_date) {
    db.prepare('UPDATE scheduled SET scheduled_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(scheduled_date, id);
  }
  if (content !== undefined) {
    db.prepare('UPDATE scheduled SET content = ?, media_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(content || null, media_path || null, id);
  }
  if (status) {
    db.prepare('UPDATE scheduled SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  }
  res.json({ ok: true });
});

// Generate weekly content plan
app.post('/api/scheduled/generate-week', auth, async (req, res) => {
  const { week_start } = req.body; // YYYY-MM-DD of Monday
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  // Gather context
  const startDate = new Date(week_start + 'T00:00:00');
  const endDate = new Date(startDate); endDate.setDate(endDate.getDate() + 6);
  const fmt = fmtLocal;

  // 1. Upcoming birthdays this week
  const allMembers = db.prepare('SELECT * FROM members').all();
  console.log(`[PLAN] Members: ${allMembers.length}, with bday: ${allMembers.filter(m=>m.birthday).length}`);
  const weekBdays = allMembers.filter(m => {
    if (!m.birthday) return false;
    const bday = m.birthday.slice(5); // MM-DD
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate); d.setDate(d.getDate() + i);
      const check = (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
      if (bday === check) { console.log(`[PLAN] Birthday match: ${m.name} on ${check}`); return true; }
    }
    return false;
  });
  console.log(`[PLAN] Week birthdays: ${weekBdays.length}`);

  // 2. Recent posts (to avoid repetition)
  const recentPosts = db.prepare(`
    SELECT rubric, COUNT(*) as n FROM posts
    WHERE created_at >= datetime('now', '-14 days')
    GROUP BY rubric
  `).all();
  const recentMap = {};
  recentPosts.forEach(r => { recentMap[r.rubric] = r.n });

  // 3. Already scheduled this week
  const existingScheduled = db.prepare(
    'SELECT * FROM scheduled WHERE scheduled_date >= ? AND scheduled_date <= ?'
  ).all(fmt(startDate), fmt(endDate));

  // 4. Season opening date
  const seasonDate = '2026-05-23';
  const daysToSeason = Math.ceil((new Date(seasonDate) - startDate) / (1000 * 60 * 60 * 24));

  // Build plan slots (only for today and future)
  const slots = [];
  const days = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
  const nowLocal = new Date();
  const todayStr = nowLocal.getFullYear() + '-' + String(nowLocal.getMonth()+1).padStart(2,'0') + '-' + String(nowLocal.getDate()).padStart(2,'0');

  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate); d.setDate(d.getDate() + i);
    const dateStr = fmt(d);
    const dayIdx = (d.getDay() + 6) % 7; // 0=Mon...6=Sun
    const dayName = days[dayIdx];

    // Skip past days
    if (dateStr < todayStr) continue;

    // Check if birthday this day
    const bdayToday = weekBdays.filter(m => {
      const bday = m.birthday.slice(5);
      const check = (d.getMonth() + 1).toString().padStart(2, '0') + '-' + d.getDate().toString().padStart(2, '0');
      return bday === check;
    });

    if (bdayToday.length > 0) {
      bdayToday.forEach(m => {
        slots.push({ date: dateStr, time: '10:00', rubric: 'birthday', title: `ДР: ${m.name || m.nickname}`, auto_context: `Имя: ${m.name}, прозвище: ${m.nickname}, байк: ${m.bike || '?'}` });
      });
    }

    // Daily humor
    slots.push({ date: dateStr, time: '12:00', rubric: 'humor', title: `Юмор ${dayName}`, auto_context: 'мото юмор, мем, смешное видео' });

    // Weekly rubrics: assigned to preferred day, or first available if preferred is past

    if (dayIdx === 0) slots.push({ date: dateStr, time: '11:00', rubric: 'moto_news', title: 'Дайджест мотоновостей', auto_context: 'еженедельный дайджест' });
    if (dayIdx === 1) slots.push({ date: dateStr, time: '10:00', rubric: 'kind_reminder', title: 'Напоминание о безопасности', auto_context: '' });
    if (dayIdx === 2) {
      const route = getRouteForWeek(dateStr);
      slots.push({ date: dateStr, time: '11:00', rubric: 'route_series', title: `Маршрут №${route.n}: ${route.name}`, auto_context: `Маршрут №${route.n}: ${route.name}, дата: ${route.date}, ${route.km ? route.km + ' км' : ''}, ${route.days} дн. Описание: ${route.desc}` });
    }
    if (dayIdx === 3) {
      const weekNum = Math.ceil((d.getTime() - new Date('2026-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000));
      slots.push({ date: dateStr, time: '10:00', rubric: weekNum % 4 === 0 ? 'values' : 'cross_promo', title: weekNum % 4 === 0 ? 'Наши ценности' : 'Наши соцсети', auto_context: '' });
    }
    if (dayIdx === 4) {
      const weekNum = Math.ceil((d.getTime() - new Date('2026-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000));
      slots.push({ date: dateStr, time: '10:00', rubric: weekNum % 2 === 0 ? 'merch' : 'riddle', title: weekNum % 2 === 0 ? 'Мерч' : 'Шарада', auto_context: '' });
    }
    if (dayIdx === 5) slots.push({ date: dateStr, time: '11:00', rubric: 'trip_announce', title: 'Анонс поездки', auto_context: '' });
    if (dayIdx === 6) {
      const progress = getSeasonProgress(dateStr);
      const progressStr = progress.map(r => `${r.done ? '✅' : r.next ? '👉' : '⬜'} ${r.n}. ${r.name} — ${r.date || r.dateTbd || 'tbd'}${r.km ? ', ' + r.km + ' км' : ''}`).join('\n');
      slots.push({ date: dateStr, time: '11:00', rubric: 'season_calendar', title: 'Календарь сезона', auto_context: progressStr });
    }

    // Countdown to next route (on first day of generated week, if within 4 weeks)
    if (dayIdx === 0 || (dateStr === todayStr)) {
      const nextRoute = getNextRoute();
      const daysToRoute = Math.ceil((new Date(nextRoute.date) - d) / (86400000));
      if (daysToRoute > 0 && daysToRoute <= 28) {
        slots.push({ date: dateStr, time: '09:00', rubric: 'season_opening', title: `${nextRoute.name} через ${daysToRoute} дней!`, auto_context: `Следующий маршрут: №${nextRoute.n} ${nextRoute.name}, дата: ${nextRoute.date}, ${nextRoute.km ? nextRoute.km + ' км' : ''}, ${nextRoute.days} дн. Осталось ${daysToRoute} дней. Описание: ${nextRoute.desc}` });
      }
    }
  }

  // Second pass: check which weekly rubrics were missed (their day was in the past)
  // and assign them to the first available future day
  const weeklyRubrics = ['moto_news', 'kind_reminder', 'route_series', 'cross_promo', 'values', 'merch', 'riddle', 'trip_announce', 'season_calendar'];
  const assignedRubrics = new Set(slots.map(s => s.rubric));
  // For alternating pairs: if either is assigned, both are "covered"
  const hasCrossOrValues = assignedRubrics.has('cross_promo') || assignedRubrics.has('values');
  const hasMerchOrRiddle = assignedRubrics.has('merch') || assignedRubrics.has('riddle');
  const missedRubrics = weeklyRubrics.filter(r => {
    if (r === 'cross_promo' || r === 'values') return !hasCrossOrValues;
    if (r === 'merch' || r === 'riddle') return !hasMerchOrRiddle;
    return !assignedRubrics.has(r);
  });
  // Deduplicate alternating pairs
  const seenPairs = new Set();
  const uniqueMissed = missedRubrics.filter(r => {
    if (r === 'values' && seenPairs.has('cross_promo')) return false;
    if (r === 'cross_promo') seenPairs.add('cross_promo');
    if (r === 'riddle' && seenPairs.has('merch')) return false;
    if (r === 'merch') seenPairs.add('merch');
    return true;
  });
  
  if (uniqueMissed.length > 0) {
    // Find first future date that still has TIME available (not today if late)
    const futureDates = [...new Set(slots.map(s => s.date))].sort();
    const nowH = new Date().getHours();
    let fallbackDate = futureDates.find(d => d > todayStr) || futureDates[0];
    // If only today is available and it's past 18:00, use tomorrow
    if (fallbackDate === todayStr && nowH >= 18) {
      const tmrw = new Date(); tmrw.setDate(tmrw.getDate() + 1);
      fallbackDate = tmrw.getFullYear() + '-' + String(tmrw.getMonth()+1).padStart(2,'0') + '-' + String(tmrw.getDate()).padStart(2,'0');
    }
    const missedLabels = {
      'moto_news': 'Дайджест мотоновостей',
      'kind_reminder': 'Напоминание о безопасности', 
      'route_series': 'Маршрут серии',
      'cross_promo': 'Наши соцсети',
      'values': 'Наши ценности',
      'merch': 'Мерч',
      'riddle': 'Шарада',
      'trip_announce': 'Анонс поездки',
      'season_calendar': 'Календарь сезона',
    };
    for (const rubric of uniqueMissed) {
      slots.push({ date: fallbackDate, time: '10:00', rubric, title: missedLabels[rubric] || rubric, auto_context: '' });
      console.log(`[PLAN] Missed rubric "${rubric}" → assigned to ${fallbackDate}`);
    }
  }

  // Filter out slots that already have a scheduled post on the same date+rubric
  const existingKeys = new Set(existingScheduled.map(s => s.scheduled_date + '|' + s.rubric));
  const newSlots = slots.filter(s => !existingKeys.has(s.date + '|' + s.rubric));

  // Distribute times: ensure 2h gap between posts on the same day
  const slotsByDate = {};
  for (const s of newSlots) {
    if (!slotsByDate[s.date]) slotsByDate[s.date] = [];
    slotsByDate[s.date].push(s);
  }
  // Also account for existing posts on these dates
  for (const ex of existingScheduled) {
    if (!slotsByDate[ex.scheduled_date]) slotsByDate[ex.scheduled_date] = [];
    slotsByDate[ex.scheduled_date].push({ time: ex.scheduled_time || '10:00', _existing: true });
  }
  const START_HOUR = 9;
  const GAP_HOURS = 2;
  for (const date of Object.keys(slotsByDate)) {
    const daySlots = slotsByDate[date];
    const existingTimes = daySlots.filter(s => s._existing).map(s => parseInt(s.time));
    let nextHour = START_HOUR;
    for (const s of daySlots) {
      if (s._existing) continue;
      // Find next available hour that doesn't conflict with existing
      while (existingTimes.some(h => Math.abs(h - nextHour) < GAP_HOURS)) {
        nextHour += GAP_HOURS;
      }
      if (nextHour > 21) nextHour = 21; // Don't post after 21:00
      s.time = (nextHour < 10 ? '0' : '') + nextHour + ':00';
      existingTimes.push(nextHour);
      nextHour += GAP_HOURS;
    }
  }

  // Filter out slots in the past (today's past hours)
  const nowHour = new Date().getHours();
  const nowTime = String(nowHour).padStart(2, '0') + ':' + String(new Date().getMinutes()).padStart(2, '0');
  const finalSlots = newSlots.filter(s => {
    if (s.date === todayStr && s.time <= nowTime) return false;
    return true;
  });

  // Auto-attach member photo for birthday posts
  for (const slot of finalSlots) {
    if (slot.rubric === 'birthday') {
      const name = (slot.title || '').replace('ДР: ', '');
      const member = allMembers.find(m => m.name === name || m.nickname === name);
      if (member && member.photo_path) {
        slot.media_path = member.photo_path;
      }
    }
  }

  // Insert all as drafts
  const insertStmt = db.prepare(
    'INSERT INTO scheduled (scheduled_date, scheduled_time, rubric, title, notes, content, media_path, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const inserted = [];
  for (const slot of finalSlots) {
    const r = insertStmt.run(slot.date, slot.time, slot.rubric, slot.title, slot.auto_context || '', null, slot.media_path || null, 'draft');
    inserted.push({ id: r.lastInsertRowid, ...slot });
  }

  console.log(`[PLAN] Generated ${inserted.length} drafts for week ${week_start}`);

  // Force-check: ensure ALL birthdays this week have a scheduled post
  const allScheduledNow = db.prepare('SELECT * FROM scheduled WHERE scheduled_date >= ? AND scheduled_date <= ?').all(fmt(startDate), fmt(endDate));
  const bdayScheduled = new Set(allScheduledNow.filter(s => s.rubric === 'birthday').map(s => s.title));
  
  for (const m of weekBdays) {
    const bdayTitle = `ДР: ${m.name || m.nickname}`;
    if (!bdayScheduled.has(bdayTitle)) {
      // Find the date for this birthday
      const bday = m.birthday.slice(5); // MM-DD
      for (let i = 0; i < 7; i++) {
        const dd = new Date(startDate); dd.setDate(dd.getDate() + i);
        const check = (dd.getMonth() + 1).toString().padStart(2, '0') + '-' + dd.getDate().toString().padStart(2, '0');
        if (bday === check) {
          const bdayDate = fmt(dd);
          const r = insertStmt.run(bdayDate, '10:00', 'birthday', bdayTitle, `Имя: ${m.name}, прозвище: ${m.nickname}, байк: ${m.bike || '?'}`, null, m.photo_path || null, 'draft');
          inserted.push({ id: r.lastInsertRowid, date: bdayDate, rubric: 'birthday', title: bdayTitle });
          console.log(`[PLAN] Force-added birthday: ${bdayTitle} on ${bdayDate}`);
          break;
        }
      }
    }
  }

  res.json({ ok: true, count: inserted.length, slots: inserted });
});

// Batch-generate content for all empty drafts in a date range
app.post('/api/scheduled/batch-generate', auth, async (req, res) => {
  const { week_start } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });

  const endDate = new Date(week_start + 'T00:00:00');
  endDate.setDate(endDate.getDate() + 6);
  const endStr = fmtLocal(endDate);

  const drafts = db.prepare(`
    SELECT * FROM scheduled
    WHERE scheduled_date >= ? AND scheduled_date <= ?
    AND status = 'draft'
    AND (content IS NULL OR content = '')
    ORDER BY scheduled_date, scheduled_time
  `).all(week_start, endStr);

  if (drafts.length === 0) return res.json({ ok: true, count: 0, message: 'Все черновики уже заполнены' });

  console.log(`[BATCH] Generating content for ${drafts.length} drafts`);
  const members = db.prepare('SELECT * FROM members').all();
  let generated = 0;
  const errors = [];

  for (const draft of drafts) {
    try {
      let prompt = '';
      const dayOfWeek = ['вс','пн','вт','ср','чт','пт','сб'][new Date(draft.scheduled_date + 'T12:00:00').getDay()];
      const daysToSeason = Math.ceil((new Date('2026-05-23') - new Date(draft.scheduled_date)) / (86400000));

      switch (draft.rubric) {
        case 'birthday': {
          const name = (draft.title || '').replace('ДР: ', '');
          const m = members.find(x => x.name === name || x.nickname === name);
          prompt = `Пост-поздравление ДР участника мотоклуба Hard Locals. Имя: ${name}${m ? ', байк: ' + (m.bike || '?') : ''}. 3-5 предложений, тёплый, с мото-метафорами, на "ты".`;
          break;
        }
        case 'humor':
          prompt = `Короткий мото-юмор для TG (${dayOfWeek}). 1-2 предложения, ирония, дружеский тон, 1-2 emoji.`;
          break;
        case 'kind_reminder':
          prompt = 'Напоминание о безопасности. Одна тема (экипировка/скорость/ТО/погода/усталость). 3-4 предложения, забота не нотация.';
          break;
        case 'cross_promo':
          prompt = 'Напоминание о соцсетях: TG t.me/hardlocals, VK vk.com/hardlocals.russia, Insta @hardlocals, сайт hardlocals.club. 2-3 предложения.';
          break;
        case 'merch': {
          const items = getRandomShopItems(3);
          const itemsStr = items.map(it => `• ${it.name} — ${it.price}₽${it.sale && it.oldPrice ? ' (старая цена ' + it.oldPrice + '₽, используй <s>' + it.oldPrice + '₽</s> в посте)' : ''}${it.desc ? '. ' + it.desc : ''}`).join('\n');
          prompt = `Пост про мерч Hard Locals. Продвигай конкретные товары:\n${itemsStr}\n\nТребования к формату:\n1. Заголовок жирный через <b>\n2. Каждый товар на отдельной строке: <b>название</b> — цена. Если есть скидка, зачеркни старую цену через <s>старая</s> и рядом новую\n3. Краткое описание товара (1 фраза)\n4. Финал: две ссылки\n   - Каталог: <a href="https://hardlocals.club/shop#order">Смотреть каталог</a>\n   - Заказ: <a href="https://t.me/casual_pumpkin">Заказать в Telegram</a>\n\nСтиль: не про понты, а про своих. Коротко. 5-7 строк макс.`;
          break;
        }
        case 'values':
          prompt = 'Ценности/философия клуба. Одна тема (братство/свобода/дорога/уважение). 4-6 предложений, глубоко без пафоса.';
          break;
        case 'riddle':
          prompt = 'Мото-шарада. Загадка 2-3 строки + ответ в <tg-spoiler>ответ</tg-spoiler>.';
          break;
        case 'season_opening': {
          const ctx = draft.notes || draft.title || '';
          const nextR = getNextRoute();
          prompt = `Пост-напоминание о ближайшем маршруте Hard Locals: №${nextR.n} ${nextR.name}, дата ${nextR.date}. ${nextR.km ? nextR.km + ' км.' : ''} ${nextR.desc}\nКонтекст: ${ctx}\n3-4 предложения, энергия, обратный отсчёт, призыв.`;
          break;
        }
        case 'route_series': {
          const routeCtx = draft.notes || draft.title || '';
          const routeNum = routeCtx.match(/№(\d+)/);
          const route = routeNum ? ROUTES.find(r => r.n === parseInt(routeNum[1])) : getNextRoute();
          if (route) {
            prompt = `Анонс маршрута №${route.n}: ${route.name}. Дата: ${route.date}. ${route.km ? route.km + ' км.' : ''} ${route.days} дн. Описание: ${route.desc}\nСделай пост-анонс: заголовок, 4-6 предложений с деталями маршрута, призыв присоединиться. Используй данные маршрута.`;
          } else {
            prompt = 'Анонс мотомаршрута выходного дня из Москвы. 4-6 предложений.';
          }
          break;
        }
        case 'trip_announce': {
          const nextR = getNextRoute();
          prompt = `Анонс ближайшей поездки Hard Locals: №${nextR.n} ${nextR.name}, дата ${nextR.date}. ${nextR.km ? nextR.km + ' км.' : ''} ${nextR.desc}\nФормат: дата, маршрут, время сбора, что взять. 4-5 предложений, призыв присоединиться.`;
          break;
        }
        case 'season_calendar': {
          const progress = getSeasonProgress(draft.scheduled_date);
          const progressStr = progress.map(r => `${r.done ? '✅' : r.next ? '👉' : '⬜'} ${r.n}. ${r.name} — ${r.date || r.dateTbd || 'tbd'}${r.km ? ', ' + r.km + ' км' : ''}`).join('\n');
          prompt = `Пост "Календарь сезона Hard Locals 2026". Вот прогресс:\n${progressStr}\n\nСделай пост: вступление (1-2 предложения), список маршрутов с эмодзи (✅ пройден, 👉 следующий, ⬜ впереди), призыв. HTML для TG.`;
          break;
        }
        case 'moto_news':
          prompt = 'Дайджест 3-4 мотоновости. Каждая: emoji + <b>заголовок</b> + 1-2 предложения. Финал: ссылка на канал t.me/hardlocals.';
          break;
        default:
          prompt = `Пост для рубрики "${draft.rubric}". Тема: ${draft.title || 'на выбор'}. ${draft.notes || ''}. 3-5 предложений.`;
      }

      const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          system: 'Ты копирайтер мотоклуба Hard Locals (Москва). Коротко, по-мужски, на "ты". HTML для Telegram (<b>, <i>, <a href>). Без markdown. Без хэштегов.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await apiRes.json();
      let text = '';
      if (data.content) { for (const c of data.content) { if (c.type === 'text') text += c.text; } }
      text = text.trim();

      if (text) {
        db.prepare('UPDATE scheduled SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(text, draft.id);
        generated++;
        console.log(`[BATCH] #${draft.id} ${draft.rubric}: ${text.length} chars`);
      } else {
        errors.push({ id: draft.id, rubric: draft.rubric, error: 'Empty' });
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`[BATCH] Error #${draft.id}:`, e.message);
      errors.push({ id: draft.id, rubric: draft.rubric, error: e.message });
    }
  }

  console.log(`[BATCH] Done: ${generated}/${drafts.length}`);
  res.json({ ok: true, count: generated, total: drafts.length, errors });
});

// Approve all drafts with content for a week
app.post('/api/scheduled/approve-all', auth, (req, res) => {
  const { week_start } = req.body;
  if (!week_start) return res.status(400).json({ error: 'week_start required' });
  const endDate = new Date(week_start + 'T00:00:00');
  endDate.setDate(endDate.getDate() + 6);
  const endStr = fmtLocal(endDate);

  const result = db.prepare(`
    UPDATE scheduled SET status = 'ready', updated_at = CURRENT_TIMESTAMP
    WHERE scheduled_date >= ? AND scheduled_date <= ?
    AND status = 'draft'
    AND content IS NOT NULL AND content != ''
  `).run(week_start, endStr);

  console.log(`[APPROVE] ${result.changes} drafts → ready`);
  res.json({ ok: true, count: result.changes });
});

// Manual scheduler trigger
app.post('/api/scheduled/run-now', auth, async (req, res) => {
  console.log('[SCHEDULER] Manual trigger');
  await runScheduler();
  res.json({ ok: true });
});

// ═══════ ROUTES API ═══════
app.get('/api/routes', auth, (req, res) => {
  const progress = getSeasonProgress(fmtLocal(new Date()));
  res.json(progress);
});

// ═══════ SHOP API ═══════
app.get('/api/shop', auth, (req, res) => {
  res.json(SHOP_ITEMS);
});

// ═══════ HUMOR QUEUE ═══════
const HUMOR_CHANNELS = ['motomoskva_pro', 'moto_tm', 'bikepostru', 'motobratia'];
const HUMOR_SUBREDDITS = ['motorcyclememes', 'CalamariRaceTeam'];
const HUMOR_BROWSE_LINKS = [
  { name: 'r/motorcyclememes', url: 'https://www.reddit.com/r/motorcyclememes/hot/' },
  { name: 'r/CalamariRaceTeam', url: 'https://www.reddit.com/r/CalamariRaceTeam/hot/' },
  { name: 'МотоМосква TG', url: 'https://t.me/s/motomoskva_pro' },
  { name: '9GAG moto', url: 'https://9gag.com/search?query=motorcycle+meme' },
  { name: 'Pikabu мото', url: 'https://pikabu.ru/tag/мото/hot' },
];

async function scrapeHumorChannels() {
  console.log('[HUMOR] Scraping TG channels + Reddit RSS');
  const existing = new Set(db.prepare("SELECT source_url FROM humor_queue").all().map(r => r.source_url));
  let added = 0;

  // TG channels
  for (const ch of HUMOR_CHANNELS) {
    try {
      const res = await fetch(`https://t.me/s/${ch}`, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } });
      if (!res.ok) { console.log('[HUMOR] TG', ch, 'status', res.status); continue; }
      const html = await res.text();

      const msgRegex = /data-post="([^"]+)"[\s\S]*?<div class="tgme_widget_message_bubble">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
      let m;
      while ((m = msgRegex.exec(html)) !== null && added < 40) {
        const postId = m[1];
        const bubble = m[2];
        const sourceUrl = `https://t.me/${postId}`;
        if (existing.has(sourceUrl)) continue;

        let mediaUrl = null;
        let mediaType = 'image';
        const imgMatch = bubble.match(/background-image:url\('([^']+)'\)/);
        if (imgMatch) mediaUrl = imgMatch[1];
        const vidMatch = bubble.match(/<video[^>]+src="([^"]+)"/);
        if (vidMatch) { mediaUrl = vidMatch[1]; mediaType = 'video'; }
        if (!mediaUrl) {
          const photoWrap = bubble.match(/class="tgme_widget_message_photo_wrap"[^>]*style="[^"]*background-image:url\('([^']+)'\)/);
          if (photoWrap) mediaUrl = photoWrap[1];
        }
        if (!mediaUrl) continue;

        let text = '';
        const textMatch = bubble.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        if (textMatch) text = textMatch[1].replace(/<br\s*\/?>/g, '\n').replace(/<[^>]*>/g, '').trim();

        db.prepare('INSERT INTO humor_queue (source, source_url, text, media_url, media_type, status) VALUES (?, ?, ?, ?, ?, ?)')
          .run('tg:' + ch, sourceUrl, text || null, mediaUrl, mediaType, 'pending');
        existing.add(sourceUrl);
        added++;
      }
      console.log('[HUMOR] TG', ch, 'done');
    } catch (e) {
      console.error('[HUMOR] TG', ch, 'error:', e.message);
    }
  }

  // Reddit via RSS (bypasses 403 block on JSON API)
  for (const sub of HUMOR_SUBREDDITS) {
    try {
      const res = await fetch(`https://old.reddit.com/r/${sub}/hot/.json?limit=25&raw_json=1`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
      });
      if (!res.ok) {
        console.log('[HUMOR] Reddit', sub, 'JSON status', res.status, '- trying RSS...');
        // Fallback to RSS
        const rssRes = await fetch(`https://www.reddit.com/r/${sub}/hot.rss?limit=20`, {
          signal: AbortSignal.timeout(10000),
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        if (!rssRes.ok) { console.log('[HUMOR] Reddit RSS', sub, 'status', rssRes.status); continue; }
        const rssText = await rssRes.text();
        // Parse RSS for image links
        const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
        let em;
        while ((em = entryRegex.exec(rssText)) !== null && added < 50) {
          const entry = em[1];
          const linkMatch = entry.match(/<link href="([^"]+)"/);
          const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
          if (!linkMatch) continue;
          const sourceUrl = linkMatch[1];
          if (existing.has(sourceUrl)) continue;
          // Find image in content
          const imgInContent = entry.match(/href="(https:\/\/i\.redd\.it\/[^"]+)"/);
          const imgInContent2 = entry.match(/src="(https:\/\/preview\.redd\.it\/[^"?]+)/);
          const mediaUrl = imgInContent ? imgInContent[1] : (imgInContent2 ? imgInContent2[1] : null);
          if (!mediaUrl) continue;
          const text = titleMatch ? titleMatch[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>') : '';
          db.prepare('INSERT INTO humor_queue (source, source_url, text, media_url, media_type, status) VALUES (?, ?, ?, ?, ?, ?)')
            .run('reddit:' + sub, sourceUrl, text, mediaUrl, 'image', 'pending');
          existing.add(sourceUrl);
          added++;
        }
        console.log('[HUMOR] Reddit RSS', sub, 'done');
        continue;
      }
      const data = await res.json();
      const posts = data?.data?.children || [];

      for (const post of posts) {
        const p = post.data;
        if (!p || p.is_self) continue;
        const sourceUrl = `https://reddit.com${p.permalink}`;
        if (existing.has(sourceUrl)) continue;

        let mediaUrl = null;
        let mediaType = 'image';
        if (p.url && p.url.match(/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i)) mediaUrl = p.url;
        else if (p.url && p.url.includes('i.redd.it')) mediaUrl = p.url;
        else if (p.is_video && p.media?.reddit_video?.fallback_url) { mediaUrl = p.media.reddit_video.fallback_url; mediaType = 'video'; }
        else if (p.url && p.url.includes('imgur.com') && !p.url.includes('/a/')) mediaUrl = p.url.replace(/\/?$/, '.jpg');
        if (!mediaUrl) continue;

        db.prepare('INSERT INTO humor_queue (source, source_url, text, media_url, media_type, status) VALUES (?, ?, ?, ?, ?, ?)')
          .run('reddit:' + sub, sourceUrl, p.title || '', mediaUrl, mediaType, 'pending');
        existing.add(sourceUrl);
        added++;
        if (added >= 50) break;
      }
      console.log('[HUMOR] Reddit JSON', sub, 'done');
    } catch (e) {
      console.error('[HUMOR] Reddit', sub, 'error:', e.message);
    }
  }

  console.log(`[HUMOR] Total added: ${added}`);
  return added;
}

// Download media from URL to uploads/
async function downloadHumorMedia(item) {
  if (item.media_path) return item.media_path; // Already downloaded
  if (!item.media_url) return null;

  try {
    const ext = item.media_type === 'video' ? 'mp4' : 'jpg';
    const filename = `humor-${item.id}-${Date.now()}.${ext}`;
    const filePath = join(__dirname, 'uploads', filename);

    const res = await fetch(item.media_url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filePath, buffer);

    const path = `/uploads/${filename}`;
    db.prepare('UPDATE humor_queue SET media_path = ? WHERE id = ?').run(path, item.id);
    console.log(`[HUMOR] Downloaded media for #${item.id}: ${Math.round(buffer.length / 1024)}KB`);
    return path;
  } catch (e) {
    console.error(`[HUMOR] Download failed #${item.id}:`, e.message);
    return null;
  }
}

app.get('/api/humor-queue', auth, (req, res) => {
  const items = db.prepare("SELECT * FROM humor_queue WHERE status = 'pending' ORDER BY created_at DESC LIMIT 50").all();
  res.json(items);
});

app.get('/api/humor-links', auth, (req, res) => {
  res.json(HUMOR_BROWSE_LINKS);
});

// Manual import: operator pastes image/video URL
app.post('/api/humor-queue/import', auth, async (req, res) => {
  const { url, text } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const isVideo = url.match(/\.(mp4|webm|mov)(\?.*)?$/i);
  const mediaType = isVideo ? 'video' : 'image';

  // Download media
  try {
    const ext = isVideo ? 'mp4' : 'jpg';
    const filename = `humor-import-${Date.now()}.${ext}`;
    const filePath = join(__dirname, 'uploads', filename);
    const fetchRes = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } });
    if (!fetchRes.ok) return res.status(400).json({ error: 'Не удалось скачать: ' + fetchRes.status });
    const buffer = Buffer.from(await fetchRes.arrayBuffer());
    writeFileSync(filePath, buffer);
    const mediaPath = `/uploads/${filename}`;

    db.prepare('INSERT INTO humor_queue (source, source_url, text, media_url, media_path, media_type, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('import', url, text || null, url, mediaPath, mediaType, 'pending');

    console.log(`[HUMOR] Imported: ${Math.round(buffer.length / 1024)}KB`);
    res.json({ ok: true, path: mediaPath });
  } catch (e) {
    res.status(400).json({ error: 'Ошибка: ' + e.message });
  }
});

app.post('/api/humor-queue/refresh', auth, async (req, res) => {
  const added = await scrapeHumorChannels();
  res.json({ ok: true, added });
});

app.post('/api/humor-queue/:id/approve', auth, async (req, res) => {
  const id = parseInt(req.params.id);
  const item = db.prepare('SELECT * FROM humor_queue WHERE id = ?').get(id);
  if (!item) return res.status(404).json({ error: 'Not found' });

  // Download media if not yet
  const mediaPath = await downloadHumorMedia(item);

  // Find next available humor slot or create one
  const { scheduled_date, scheduled_time } = req.body;
  let date = scheduled_date || fmtLocal(new Date());
  let time = scheduled_time || '12:00';

  // Create scheduled post
  const caption = item.text || '😏';
  const r = db.prepare('INSERT INTO scheduled (scheduled_date, scheduled_time, rubric, title, notes, content, media_path, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(date, time, 'humor', 'Мото юмор', item.source, caption, mediaPath, 'draft');

  db.prepare("UPDATE humor_queue SET status = 'approved' WHERE id = ?").run(id);
  res.json({ ok: true, scheduled_id: r.lastInsertRowid });
});

app.post('/api/humor-queue/:id/reject', auth, (req, res) => {
  db.prepare("UPDATE humor_queue SET status = 'rejected' WHERE id = ?").run(parseInt(req.params.id));
  res.json({ ok: true });
});

// ═══════ HISTORY ═══════
app.get('/api/posts', auth, (req, res) => {
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100').all();
  res.json(posts);
});

// Statistics: aggregate posts by period/rubric/platform
app.all('/api/stats', auth, (req, res) => {
  const totalRow = db.prepare("SELECT COUNT(*) as n FROM posts WHERE status = 'sent'").get();
  const total = totalRow?.n || 0;

  // Last 7 days daily count
  const daily = db.prepare(`
    SELECT DATE(created_at) as day, COUNT(*) as n
    FROM posts
    WHERE status = 'sent' AND created_at >= datetime('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY day ASC
  `).all();

  // By rubric (last 30 days)
  const byRubric = db.prepare(`
    SELECT rubric, COUNT(*) as n
    FROM posts
    WHERE status = 'sent' AND created_at >= datetime('now', '-30 days')
    GROUP BY rubric
    ORDER BY n DESC
  `).all();

  // By platform (last 30 days)
  const byPlatform = db.prepare(`
    SELECT platform, COUNT(*) as n
    FROM posts
    WHERE status = 'sent' AND created_at >= datetime('now', '-30 days')
    GROUP BY platform
  `).all();

  // With/without media (last 30 days)
  const withMediaRow = db.prepare(`
    SELECT
      SUM(CASE WHEN media_path IS NOT NULL AND media_path != '' THEN 1 ELSE 0 END) as with_media,
      SUM(CASE WHEN media_path IS NULL OR media_path = '' THEN 1 ELSE 0 END) as text_only
    FROM posts
    WHERE status = 'sent' AND created_at >= datetime('now', '-30 days')
  `).get();

  // This week vs last week
  const weekCounts = db.prepare(`
    SELECT
      SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as this_week,
      SUM(CASE WHEN created_at >= datetime('now', '-14 days') AND created_at < datetime('now', '-7 days') THEN 1 ELSE 0 END) as last_week
    FROM posts
    WHERE status = 'sent'
  `).get();

  res.json({
    total,
    this_week: weekCounts?.this_week || 0,
    last_week: weekCounts?.last_week || 0,
    daily,
    by_rubric: byRubric,
    by_platform: byPlatform,
    with_media: withMediaRow?.with_media || 0,
    text_only: withMediaRow?.text_only || 0,
  });
});

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Hard Locals Content Ops v10.5 (auto-approve from editor + meme browser)`);
  console.log(`  → http://0.0.0.0:${PORT}`);
  console.log(`  → Anthropic: ${ANTHROPIC_API_KEY ? '✓' : '✗'}`);
  console.log(`  → TG Bot: ${TG_BOT_TOKEN ? '✓' : '✗'}`);
  console.log(`  → VK: ${VK_ACCESS_TOKEN ? '✓' : '✗'}${VK_ALBUM_ID ? ' (album: ' + VK_ALBUM_ID + ')' : ' (no album)'}`);
  console.log(`  → Unsplash: ${UNSPLASH_KEY ? '✓' : '✗'}`);
  console.log(`  → Pexels: ${PEXELS_KEY ? '✓' : '✗'}`);
  console.log(`  → TZ: ${process.env.TZ || 'UTC (add TZ=Europe/Moscow to .env!)'}`);
  const nowLocal = new Date();
  console.log(`  → Server time: ${nowLocal.toLocaleString('ru-RU')}\n`);
});
