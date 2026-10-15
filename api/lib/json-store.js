import fs from 'node:fs';
import path from 'node:path';

const clone = value => structuredClone(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Read a mutable JSON store without mistaking a broken existing file for first boot.
 * Only ENOENT receives the caller's initial value; I/O, parse, and shape errors fail closed.
 */
export function readJsonStore(file, { initial, label = path.basename(file), validate = record } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return clone(initial);
    throw new Error(`${label}: existing store could not be read; refusing to start or overwrite it`, { cause: error });
  }

  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label}: existing store contains invalid JSON; refusing to start or overwrite it`, { cause: error });
  }
  if (!validate(value)) throw new Error(`${label}: existing store has an invalid structure; refusing to start or overwrite it`);
  return value;
}

export const isJsonRecord = record;
