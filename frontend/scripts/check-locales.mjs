#!/usr/bin/env node
// Spanish is the maintained, strict translation catalogue. The other ten translated packs
// predate that policy and have known gaps: report their coverage without making that historic
// debt block unrelated work. CI still fails for malformed packs, non-string values, keys that
// do not exist in Spanish, or a source string used through t('...') that Spanish forgot.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const localesDir = join(root, 'src', 'locales')
const files = readdirSync(localesDir).filter(f => f.endsWith('.js')).sort()
const delayed = new Set(['de', 'fr', 'hi', 'it', 'ko', 'pl', 'pt', 'ru', 'tr', 'zh'])
let failed = false
const fail = message => { failed = true; console.error(message) }

const locales = new Map()
for (const file of files) {
  let dict
  try { ({ default: dict } = await import(pathToFileURL(join(localesDir, file)).href)) }
  catch (error) { fail(`${file}: cannot import (${error.message})`); continue }
  if (!dict || typeof dict !== 'object' || Array.isArray(dict)) { fail(`${file}: default export must be an object`); continue }
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== 'string') fail(`${file}: ${JSON.stringify(key)} must translate to a string`)
  }
  locales.set(file.replace(/\.js$/, ''), dict)
}

const spanish = locales.get('es')
if (!spanish) fail('es.js is required and is the strict reference catalogue')
const reference = new Set(Object.keys(spanish || {}))

// Static t('...')/t("...") calls are the source catalogue. Computed labels must be added to
// es.js explicitly by their feature (and remain covered by the extra-key checks below).
const sourceKeys = new Set()
const walk = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!['locales', 'instr', 'names'].includes(entry.name)) walk(path)
      continue
    }
    if (!/\.(js|jsx)$/.test(entry.name)) continue
    const source = readFileSync(path, 'utf8')
    const pattern = /\bt\(\s*(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g
    for (const match of source.matchAll(pattern)) {
      try { sourceKeys.add(Function(`"use strict";return ${match[1]}${match[2]}${match[1]}`)()) }
      catch { fail(`${path}: could not read translation key near ${match[0].slice(0, 80)}`) }
    }
  }
}
walk(join(root, 'src'))

const missingSpanish = [...sourceKeys].filter(key => !reference.has(key)).sort()
for (const key of missingSpanish) fail(`es.js missing source key: ${JSON.stringify(key)}`)

const report = { generatedAt: new Date().toISOString(), reference: 'es', totalKeys: reference.size, locales: {} }
for (const [lang, dict] of locales) {
  const keys = new Set(Object.keys(dict))
  const extra = [...keys].filter(key => !reference.has(key)).sort()
  for (const key of extra) fail(`${lang}.js has key absent from es.js: ${JSON.stringify(key)}`)
  const missing = [...reference].filter(key => !keys.has(key)).sort()
  const coverage = reference.size ? Number(((reference.size - missing.length) * 100 / reference.size).toFixed(1)) : 100
  report.locales[lang] = { translated: reference.size - missing.length, total: reference.size, coverage, missing }
  const status = missing.length ? `${missing.length} missing` : 'complete'
  console.log(`${lang}: ${reference.size - missing.length}/${reference.size} (${coverage}%) — ${status}`)
  if (missing.length && delayed.has(lang)) console.log(`  ${missing.slice(0, 20).map(JSON.stringify).join(', ')}${missing.length > 20 ? ', …' : ''}`)
  if (missing.length && !delayed.has(lang)) fail(`${lang}.js must be complete`)
}

const reportFile = join(root, 'locale-coverage.json')
writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
console.log(`Coverage report: ${reportFile}`)
if (failed) process.exit(1)
