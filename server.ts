import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/attendance/server-clock', (_req, res) => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      epochMs: now.getTime(),
      isoTimestamp: now.toISOString(),
      dateStr: `${yyyy}-${mm}-${dd}`,
      timeHHMM: `${hh}:${min}`,
      timeHHMMSS: `${hh}:${min}:${ss}`,
    });
  });

  const tileCache = new Map<string, { buf: Buffer; contentType: string }>();

  app.get('/api/map-tiles/:style/:z/:x/:y', async (req, res) => {
    const rawStyle = req.params.style;
    const style = rawStyle === 'dark' || rawStyle === 'satellite' ? rawStyle : 'streets';
    const z = Number.parseInt(req.params.z, 10);
    const x = Number.parseInt(req.params.x, 10);
    const y = Number.parseInt(req.params.y.replace(/\.png$/i, ''), 10);

    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y) || z < 0 || z > 19) {
      res.status(400).send('Invalid tile coordinates');
      return;
    }
    const maxCoord = 1 << z;
    if (x < 0 || y < 0 || x >= maxCoord || y >= maxCoord) {
      res.status(400).send('Tile coordinates out of bounds');
      return;
    }

    const cacheKey = `${style}/${z}/${x}/${y}`;
    const cached = tileCache.get(cacheKey);
    if (cached) {
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(cached.buf);
      return;
    }

    const upstreams =
      style === 'satellite'
        ? [
            `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
            `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
            `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
          ]
        : [
            `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
            `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`,
          ];

    for (const url of upstreams) {
      try {
        const upstream = await fetch(url, {
          headers: {
            'User-Agent': 'ArchaeologyHRPortal/1.0 (+https://openstreetmap.org)',
            Accept: 'image/png,image/jpeg,image/*;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (!upstream.ok) continue;
        const ctype = upstream.headers.get('content-type') || 'image/png';
        if (!ctype.startsWith('image/')) continue;
        const arrBuf = await upstream.arrayBuffer();
        const buf = Buffer.from(arrBuf);
        if (buf.length < 100) continue;

        if (tileCache.size >= 1200) {
          const oldestKey = tileCache.keys().next().value;
          if (oldestKey) tileCache.delete(oldestKey);
        }
        tileCache.set(cacheKey, { buf, contentType: ctype });

        res.setHeader('Content-Type', ctype);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
        return;
      } catch {
        // Try next tile upstream provider
      }
    }

    // Crisp grid fallback if external CDNs are unreachable
    const bg = style === 'dark' ? '#13161f' : '#ede9df';
    const stroke = style === 'dark' ? '#252a3a' : '#d5cfc0';
    const labelColor = style === 'dark' ? '#5e6680' : '#857d6e';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="${bg}"/>
      <path d="M64 0V256M128 0V256M192 0V256M0 64H256M0 128H256M0 192H256" stroke="${stroke}" stroke-width="1"/>
      <rect width="256" height="256" fill="none" stroke="${stroke}" stroke-width="1.5"/>
      <text x="12" y="22" font-family="monospace" font-size="11" fill="${labelColor}">${z}/${x}/${y}</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(svg);
  });

  app.get('/api/geo/search', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query.length < 2) {
      res.json({ results: [] });
      return;
    }

    try {
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=ar,en&q=${encodeURIComponent(
        query
      )}`;
      const upstream = await fetch(nominatimUrl, {
        headers: {
          'User-Agent': 'ArchaeologyHRPortal/1.0 (+https://openstreetmap.org)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!upstream.ok) {
        res.json({ results: [] });
        return;
      }
      const raw = (await upstream.json()) as Array<{
        display_name?: string;
        lat?: string;
        lon?: string;
      }>;
      const results = (Array.isArray(raw) ? raw : [])
        .map((item) => ({
          displayName: String(item.display_name || ''),
          lat: Number.parseFloat(String(item.lat ?? '')),
          lng: Number.parseFloat(String(item.lon ?? '')),
        }))
        .filter((item) => item.displayName && Number.isFinite(item.lat) && Number.isFinite(item.lng));

      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ results });
    } catch {
      res.json({ results: [] });
    }
  });

  app.get('/api/geo/ip-locate', async (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    const rawIp = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0]
      : req.socket.remoteAddress || '';
    const cleanIp = rawIp.trim().replace(/^::ffff:/, '');

    const isPrivateOrLocal =
      !cleanIp ||
      cleanIp === '::1' ||
      cleanIp.startsWith('127.') ||
      cleanIp.startsWith('10.') ||
      cleanIp.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(cleanIp);

    if (isPrivateOrLocal) {
      res.json({ ok: false, reason: 'local_or_private_ip' });
      return;
    }

    try {
      const upstream = await fetch(`https://ipwho.is/${encodeURIComponent(cleanIp)}`, {
        signal: AbortSignal.timeout(4500),
      });
      if (!upstream.ok) {
        res.json({ ok: false, reason: 'upstream_error' });
        return;
      }
      const data = (await upstream.json()) as {
        success?: boolean;
        latitude?: number;
        longitude?: number;
        city?: string;
        country?: string;
      };
      if (
        data.success !== false &&
        typeof data.latitude === 'number' &&
        typeof data.longitude === 'number' &&
        Number.isFinite(data.latitude) &&
        Number.isFinite(data.longitude)
      ) {
        const labelParts = [data.city, data.country].filter(Boolean);
        res.setHeader('Cache-Control', 'no-store');
        res.json({
          ok: true,
          lat: Number(data.latitude.toFixed(6)),
          lng: Number(data.longitude.toFixed(6)),
          cityLabel: labelParts.length > 0 ? labelParts.join(', ') : undefined,
        });
        return;
      }
      res.json({ ok: false, reason: 'unresolved' });
    } catch {
      res.json({ ok: false, reason: 'timeout' });
    }
  });

  app.post('/api/ai/analyze', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({
        error: 'GEMINI_API_KEY is not configured in environment secrets.',
      });
      return;
    }

    const { prompt, language, summaryContext } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const targetLanguage = language === 'en' ? 'English' : 'Arabic';
      const systemInstruction = `You are a senior HR Operations & Workforce Analyst for the Department of Archaeology (مصلحة الآثار).
Respond strictly in ${targetLanguage}.
Base your analysis strictly on the supplied JSON summary context. Do not invent employees, balances, or dates that are not present in the context.
Keep answers concise, structured with clear headings and bullet points, and actionable for HR leadership.`;

      const contents = `Workforce & Vacation Context:
${JSON.stringify(summaryContext ?? {}, null, 2)}

HR Director Question:
${prompt}`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction,
        },
      });

      res.json({ text: response.text ?? '' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate AI analysis.';
      console.error('Gemini API Error:', err);
      res.status(502).json({ error: message });
    }
  });

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use('/src/assets', express.static(path.resolve(__dirname, 'src/assets')));
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
