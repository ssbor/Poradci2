// tools/build-obce-suggest.js
// Generates a lightweight municipality suggestions list for fast autocomplete.
// Node 20+, ESM ("type": "module" in package.json)

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const IN_FILE = path.join(ROOT, 'public', 'data', 'obce_centroids.json');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'obce_suggest.json');

const FORCE =
  process.env.FORCE_OBCE_SUGGEST_BUILD === '1' ||
  process.env.FORCE_OBCE_SUGGEST_BUILD === 'true' ||
  process.env.FORCE_OBCE_BUILD === '1' ||
  process.env.FORCE_OBCE_BUILD === 'true';

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function normalizeName(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]+/g, '')
    .replace(/\s+/g, ' ');
}

async function main() {
  if (!exists(IN_FILE)) {
    throw new Error(`[obce-suggest] missing input: ${IN_FILE}`);
  }

  if (exists(OUT_FILE) && !FORCE) {
    console.log('[obce-suggest] obce_suggest.json exists; skipping (set FORCE_OBCE_SUGGEST_BUILD=1 to rebuild)');
    return;
  }

  const raw = await fsp.readFile(IN_FILE, 'utf-8');
  const js = JSON.parse(raw);

  const byKey = js?.byKey && typeof js.byKey === 'object' ? js.byKey : null;
  if (!byKey) throw new Error('[obce-suggest] invalid input: missing byKey');

  const items = [];
  for (const [key, v] of Object.entries(byKey)) {
    const name = String(v?.n || '').trim();
    if (!name) continue;
    items.push({
      key,
      name,
      nameKey: normalizeName(name),
      kraj: String(v?.k || '').trim(),
      okresName: String(v?.on || '').trim(),
      t: String(v?.t || '').trim(),
      parent: String(v?.p || '').trim()
    });
  }

  const out = {
    built_at: new Date().toISOString(),
    source: js?.source || null,
    count: items.length,
    items
  };

  await fsp.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fsp.writeFile(OUT_FILE, JSON.stringify(out));
  console.log(`[obce-suggest] wrote ${OUT_FILE} (count=${items.length})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
