// Test-only preload: counts how many state-<uid>.json files the server reads (each one is a decrypt) and publishes the number in DATA_DIR/reads.count.
import fs from 'node:fs';
import path from 'node:path';
const real = fs.readFileSync;
let n = 0;
fs.readFileSync = function (file, ...rest) {
  if (typeof file === 'string' && /state-[^/\\]+\.json$/.test(file)) n++;
  return real.call(this, file, ...rest);
};
const out = path.join(process.env.DATA_DIR || '.', 'reads.count');
setInterval(() => { try { fs.writeFileSync(out, String(n)); } catch { /* ignore */ } }, 50).unref();
