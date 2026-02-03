const archiver = require('archiver');

const BROWSERLESS_URL = 'https://production-sfo.browserless.io/function';
const TINY_SIZES = ['/75x75/', '/60x60/', '/30x30/', '/140x/', '/170x/', '/200x/', '/236x/', '/240x/', '/280x/', '/300x/', '/364x/'];
const MIN_WIDTH = 450;
const MIN_FILE_SIZE = 10240;

function isValidPinterestBoardUrl(url) {
  try {
    const parsed = new URL(url);
    const validHost =
      parsed.hostname === 'www.pinterest.com' ||
      parsed.hostname === 'pinterest.com' ||
      parsed.hostname.endsWith('.pinterest.com');
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    return validHost && pathParts.length >= 2;
  } catch {
    return false;
  }
}

function getExtension(url) {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase().replace(/[^a-z0-9]/g, '');
    return ext || 'jpg';
  } catch {
    return 'jpg';
  }
}

function getExtractScript() {
  const tiny = JSON.stringify(TINY_SIZES);
  const minW = MIN_WIDTH;
  return `export default async function ({ page, context }) {
  const boardUrl = (context.boardUrl || '').replace(/^https?:\\/\\/[^/]+/, 'https://www.pinterest.com');
  await page.goto(boardUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));
  await page.waitForSelector('img', { timeout: 10000 }).catch(() => {});
  try { await page.click('button[aria-label*="Accept"], button[aria-label*="Accetta"]'); } catch {}
  await new Promise(r => setTimeout(r, 1500));
  let prev = 0, attempts = 0;
  while (attempts < 15) {
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await new Promise(r => setTimeout(r, 1500));
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === prev) break;
    prev = h; attempts++;
  }
  const urls = await page.evaluate(({ tiny, minW }) => {
    const s = new Set();
    function add(raw) {
      if (!raw || typeof raw !== 'string') return;
      const m = raw.match(/(https:\\/\\/i\\.pinimg\\.com\\/[^"'\\s\\)\\?]+)/);
      if (!m) return;
      let u = m[1];
      if (tiny.some(t => u.includes(t))) return;
      const dim = u.match(/\\/(\\d+)x(\\d*)\\//);
      if (dim && parseInt(dim[1], 10) < minW) return;
      if (u.includes('/originals/')) s.add(u);
      else s.add(u.replace(/\\/\\d+x\\d*\\//g, '/originals/').replace(/\\/\\d+x\\//g, '/originals/'));
    }
    document.querySelectorAll('img').forEach(i => { add(i.src); add(i.currentSrc); add(i.dataset?.src); add(i.dataset?.lazySrc); if (i.srcset) i.srcset.split(',').forEach(p => add(p.trim().split(/\\s+/)[0])); });
    document.querySelectorAll('[src*="pinimg.com"], [href*="pinimg.com"]').forEach(e => add(e.src || e.href));
    const html = document.documentElement.innerHTML;
    for (const m of html.matchAll(/https:\\/\\/i\\.pinimg\\.com\\/[^"'\\s\\)\\\\]+/g)) add(m[0]);
    return Array.from(s).filter(u => u && u.startsWith('https://'));
  }, { tiny: ${tiny}, minW: ${minW} });
  return { data: { urls }, type: 'application/json' };
}`;
}

async function extractUrls(boardUrl, token) {
  const res = await fetch(`${BROWSERLESS_URL}?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: getExtractScript(), context: { boardUrl } }),
  });
  if (!res.ok) throw new Error(`Browserless: ${res.status}`);
  const json = await res.json();
  return json.data?.urls || json.urls || [];
}

async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://www.pinterest.com/',
      },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MIN_FILE_SIZE ? buf : null;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.BROWSERLESS_API_KEY;
  if (!token) {
    return res.status(503).json({
      error: 'Server not configured. Add BROWSERLESS_API_KEY to Vercel environment variables.',
    });
  }

  const { boardUrl } = req.body || {};

  if (!boardUrl) {
    return res.status(400).json({ error: 'Board URL is required' });
  }

  if (!isValidPinterestBoardUrl(boardUrl)) {
    return res.status(400).json({
      error: 'Invalid Pinterest board URL.',
    });
  }

  try {
    const urls = await extractUrls(boardUrl, token);
    const seen = new Set();
    const images = [];

    for (const url of urls) {
      const key = url.replace(/\?.*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const buf = await downloadImage(url);
      if (buf) images.push({ buffer: buf, ext: getExtension(url) });
    }

    if (images.length === 0) {
      return res.status(502).json({
        error: 'No images could be downloaded. The board may be private or Pinterest may be blocking access.',
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="pinterest-board.zip"');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);
    images.forEach((img, i) => {
      archive.append(img.buffer, { name: `image_${String(i + 1).padStart(4, '0')}.${img.ext}` });
    });
    await archive.finalize();
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        error: err.message || 'Failed to download board.',
      });
    }
  }
}
