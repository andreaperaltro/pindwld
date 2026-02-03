const archiver = require('archiver');

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

function addUrl(urls, raw) {
  if (!raw || typeof raw !== 'string') return;
  const m = raw.match(/(https:\/\/i\.pinimg\.com\/[^"'\s\)\?]+)/);
  if (!m) return;
  let url = m[1];
  if (TINY_SIZES.some((s) => url.includes(s))) return;
  const dimMatch = url.match(/\/(\d+)x(\d*)\//);
  if (dimMatch && parseInt(dimMatch[1], 10) < MIN_WIDTH) return;
  if (url.includes('/originals/')) {
    urls.add(url);
  } else {
    url = url.replace(/\/\d+x\d*\//g, '/originals/').replace(/\/\d+x\//g, '/originals/');
    urls.add(url);
  }
}

function extractUrlsFromHtml(html) {
  const urls = new Set();
  for (const m of html.matchAll(/https:\/\/i\.pinimg\.com\/[^"'\s\)\\]+/g)) {
    addUrl(urls, m[0]);
  }
  const jsonMatches = html.matchAll(/"url"\s*:\s*"(https:\/\/i\.pinimg\.com\/[^"]+)"/g);
  for (const m of jsonMatches) addUrl(urls, m[1]);
  const origMatches = html.matchAll(/"(https:\/\/i\.pinimg\.com\/originals\/[^"]+)"/g);
  for (const m of origMatches) addUrl(urls, m[1]);
  return Array.from(urls).filter((u) => u && u.startsWith('https://'));
}

async function extractUrls(boardUrl) {
  const url = boardUrl.replace(/^https?:\/\/[^/]+/, 'https://www.pinterest.com');
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Failed to fetch board (${res.status})`);
  const html = await res.text();
  return extractUrlsFromHtml(html);
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
    const urls = await extractUrls(boardUrl);
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
        error: 'No images found. Pinterest loads boards with JavaScript—use the local version (npm start) or Railway for full support.',
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
};
