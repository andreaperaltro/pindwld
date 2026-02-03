const express = require('express');
const path = require('path');
const archiver = require('archiver');
const { chromium } = require('playwright');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

async function extractImageUrls(boardUrl) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });
    const page = await context.newPage();

    const urlToFetch = boardUrl.replace(/^https?:\/\/[^/]+/, 'https://www.pinterest.com');
    await page.goto(urlToFetch, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await new Promise((r) => setTimeout(r, 3000));

    await page.waitForSelector('img', { timeout: 10000 }).catch(() => {});

    await page.getByRole('button', { name: /accept|accetta|ok|allow|consenti/i }).click({ timeout: 3000 }).catch(() => {});

    await new Promise((r) => setTimeout(r, 1500));

    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrolls = 25;

    while (scrollAttempts < maxScrolls) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        document.documentElement.scrollTop = document.documentElement.scrollHeight;
        const main = document.querySelector('[data-test-id="masonry-container"]') ||
          document.querySelector('main') || document.body;
        if (main.scrollHeight) main.scrollTop = main.scrollHeight;
      });
      await new Promise((r) => setTimeout(r, 2000));

      const newHeight = await page.evaluate(() =>
        Math.max(
          document.body.scrollHeight,
          document.documentElement.scrollHeight,
          document.body.scrollHeight
        )
      );
      if (newHeight === previousHeight) break;
      previousHeight = newHeight;
      scrollAttempts++;
    }

    const imageUrls = await page.evaluate(() => {
      const urls = new Set();
      const tinySizes = ['/75x75/', '/60x60/', '/30x30/', '/140x/', '/170x/', '/200x/', '/236x/', '/240x/', '/280x/', '/300x/', '/364x/'];
      const minWidth = 450;

      function addUrl(raw) {
        if (!raw || typeof raw !== 'string') return;
        const m = raw.match(/(https:\/\/i\.pinimg\.com\/[^"'\s\)\?]+)/);
        if (!m) return;
        let url = m[1];
        if (tinySizes.some((s) => url.includes(s))) return;
        const dimMatch = url.match(/\/(\d+)x(\d*)\//);
        if (dimMatch && parseInt(dimMatch[1], 10) < minWidth) return;
        if (url.includes('/originals/')) {
          urls.add(url);
        } else {
          url = url.replace(/\/\d+x\d*\//g, '/originals/').replace(/\/\d+x\//g, '/originals/');
          urls.add(url);
        }
      }

      document.querySelectorAll('img').forEach((img) => {
        addUrl(img.src);
        addUrl(img.currentSrc);
        addUrl(img.getAttribute('data-src'));
        addUrl(img.getAttribute('data-lazy-src'));
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          srcset.split(',').forEach((part) => {
            const u = part.trim().split(/\s+/)[0];
            addUrl(u);
          });
        }
      });

      document.querySelectorAll('[src*="pinimg.com"], [href*="pinimg.com"], [style*="pinimg.com"]').forEach((el) => {
        addUrl(el.src || el.href || el.getAttribute('style'));
      });

      const html = document.documentElement.innerHTML;
      for (const m of html.matchAll(/https:\/\/i\.pinimg\.com\/[^"'\s\)\\]+/g)) {
        addUrl(m[0]);
      }

      return Array.from(urls);
    });

    const filtered = imageUrls.filter((u) => u && u.startsWith('https://'));
    console.log(`[pindwld] Extracted ${filtered.length} image URLs`);
    const seen = new Set();
    const images = [];

    for (const url of filtered) {
      const key = url.replace(/\?.*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const resp = await context.request.get(url);
        if (resp.ok()) {
          const body = await resp.body();
          if (body && body.length > 10240) {
            images.push({ buffer: Buffer.from(body), ext: getExtension(url) });
          }
        }
      } catch {
        const buf = await downloadImage(url);
        if (buf && buf.length > 10240) images.push({ buffer: buf, ext: getExtension(url) });
      }
    }

    console.log(`[pindwld] Successfully downloaded ${images.length} images`);
    return images;
  } finally {
    await browser.close();
  }
}

async function downloadImage(url, referer = 'https://www.pinterest.com/') {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: referer,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 10240 ? buf : null;
  } catch {
    return null;
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

app.post('/api/download', async (req, res) => {
  const { boardUrl } = req.body;

  if (!boardUrl) {
    return res.status(400).json({ error: 'Board URL is required' });
  }

  if (!isValidPinterestBoardUrl(boardUrl)) {
    return res.status(400).json({
      error: 'Invalid Pinterest board URL. Example: https://www.pinterest.com/username/board-name/',
    });
  }

  try {
    const images = await extractImageUrls(boardUrl);

    if (images.length === 0) {
      return res.status(502).json({
        error: 'No images could be downloaded. The board may be private, empty, or Pinterest may be blocking access.',
      });
    }

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('Archive error:', err);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to create ZIP.' });
    });
    res.attachment('pinterest-board.zip');
    archive.pipe(res);

    images.forEach((img, i) => {
      archive.append(img.buffer, { name: `image_${String(i + 1).padStart(4, '0')}.${img.ext}` });
    });

    await archive.finalize();
  } catch (err) {
    console.error('Download error:', err);
    if (res.headersSent) return;
    const msg =
      err.message?.includes('timeout') ? 'Request timed out. Try again—Pinterest may be slow.'
      : err.message?.includes('Target closed') ? 'Browser closed unexpectedly. Try again.'
      : err.message || 'Failed to download board. The board may be private or Pinterest may be blocking the request.';
    res.status(500).json({ error: msg });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Pinterest Board Downloader running at http://localhost:${PORT}`);
});
