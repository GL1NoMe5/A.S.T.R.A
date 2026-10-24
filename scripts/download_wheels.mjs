// Optional bootstrap helper for networks where uv's binary downloads are slow.
// Downloads only pinned PyPI wheels for CPython 3.12 / Windows x64 and verifies
// each file against the SHA-256 published by PyPI. Not needed for normal setup.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const lock = await fs.readFile(path.join(root, 'requirements.lock.txt'), 'utf8');
const packages = [...lock.matchAll(/^([\w.-]+)==([^\s;]+)$/gm)].map(m => [m[1], m[2]]);
const dest = path.join(root, '.wheelhouse');
await fs.mkdir(dest, {recursive: true});
const tasks = [...packages];
const failures = [];
async function fetchPackage(name, version) {
  const metadata = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
  if (!metadata.ok) throw Error(`${name}: metadata HTTP ${metadata.status}`);
  const info = await metadata.json();
  const wheels = info.urls.filter(x => x.packagetype === 'bdist_wheel');
  const selected = wheels.find(x => /cp312-cp312-win_amd64\.whl$/.test(x.filename)) ||
    wheels.find(x => /cp3(?:[2-9]|10|11|12)-abi3-win_amd64\.whl$/.test(x.filename)) ||
    wheels.find(x => /py3-none-win_amd64\.whl$/.test(x.filename)) ||
    wheels.find(x => /(?:py3|py2\.py3)-none-any\.whl$/.test(x.filename));
  if (!selected) throw Error(`${name}: no compatible Windows wheel`);
  const file = path.join(dest, selected.filename);
  try {
    const existing = await fs.readFile(file);
    if (crypto.createHash('sha256').update(existing).digest('hex') === selected.digests.sha256) return;
  } catch {}
  let bytes;
  if (selected.size > 8 * 1024 * 1024) {
    const chunkSize = 4 * 1024 * 1024;
    const ranges = Array.from({length: Math.ceil(selected.size / chunkSize)}, (_, i) => i);
    const chunks = new Array(ranges.length);
    await Promise.all(Array.from({length: 4}, async () => {
      while (ranges.length) {
        const i = ranges.shift(), start = i * chunkSize;
        const end = Math.min(selected.size - 1, start + chunkSize - 1);
        const partFile = `${file}.part-${i}`;
        try {
          const previous = await fs.readFile(partFile);
          if (previous.length === end - start + 1) chunks[i] = previous;
        } catch {}
        for (let attempt = 0; !chunks[i] && attempt < 4; attempt++) {
          try {
            const response = await fetch(selected.url, {headers: {Range: `bytes=${start}-${end}`}, signal: AbortSignal.timeout(20000)});
            if (response.status !== 206) throw Error(`${name}: range HTTP ${response.status}`);
            const data = Buffer.from(await response.arrayBuffer());
            if (data.length !== end - start + 1) throw Error(`${name}: truncated range`);
            await fs.writeFile(partFile, data);
            chunks[i] = data;
          } catch (error) {
            if (attempt === 3) throw error;
          }
        }
        console.log(`${name} chunk ${i + 1}/${chunks.length}`);
      }
    }));
    bytes = Buffer.concat(chunks);
  } else {
    const response = await fetch(selected.url, {signal: AbortSignal.timeout(180000)});
    if (!response.ok) throw Error(`${name}: wheel HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== selected.digests.sha256) {
    throw Error(`${name}: checksum mismatch`);
  }
  await fs.writeFile(file, bytes);
  for (let i = 0; i < Math.ceil(selected.size / (4 * 1024 * 1024)); i++) {
    await fs.rm(`${file}.part-${i}`, {force: true});
  }
  console.log(`${name} ${version} ${bytes.length}`);
}
await Promise.all(Array.from({length: 6}, async () => {
  while (tasks.length) {
    const pkg = tasks.shift();
    try { await fetchPackage(...pkg); }
    catch (error) { failures.push(String(error)); console.error(String(error)); }
  }
}));
if (failures.length) process.exitCode = 1;
