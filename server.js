import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES, rewriteImportMap } from './lib/scenes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.get('/health', (_req, res) => {
  res.json({ ok: true, scenes: SCENES });
});

app.use(
  '/vendor/three',
  express.static(path.join(__dirname, 'node_modules', 'three'), {
    maxAge: '1d',
  })
);

app.get('/simple_scene/:fileName', async (req, res, next) => {
  const { fileName } = req.params;
  if (!fileName || !fileName.endsWith('.html') || fileName.includes('..') || fileName.includes('/')) {
    return next();
  }
  const fullPath = path.join(__dirname, 'simple_scene', fileName);
  try {
    const rawHtml = await fs.readFile(fullPath, 'utf-8');
    const localHtml = rewriteImportMap(rawHtml);
    res.type('text/html; charset=utf-8').send(localHtml);
  } catch (err) {
    if (err && err.code === 'ENOENT') return next();
    return next(err);
  }
});

app.use('/simple_scene', express.static(path.join(__dirname, 'simple_scene')));

// Serve production Vite build
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Water Margin RPG server listening on http://${HOST}:${PORT}`);
});
