#!/usr/bin/env node
/* Downloads the cover photos of the official Premium programs from Wikimedia Commons and records where each one comes from.
 *
 *   node scripts/premium/fetch-covers.mjs
 *
 * Every file below was checked by hand on its Commons page: licence (public domain or CC BY 2.0 / CC0 — never NC/ND), no third-party logo as the subject,
 * no book/paid-programme material. Files are served from the app's own assets (frontend/public/premium/covers) so a cover never depends on a third-party
 * hotlink; scripts/premium/covers.json keeps the author, licence and page of each one, and the app shows that credit on the program's sheet.
 * Run it again only to replace an image (edit the title here first). Wikimedia asks for an identifying User-Agent.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = join(root, 'frontend', 'public', 'premium', 'covers')
const UA = { 'User-Agent': '2JFitnessApp-cover-fetch/1.0 (https://github.com/2jfitnesscenter/2jfitnessapp; juanjo.persa@gmail.com)' }

// slug → { file (Commons title), width (download width), alt, focal }
const COVERS = {
  '531': { file: 'Deadlift grip.JPG', width: 1280, focal: { x: 50, y: 55 }, alt: 'Close-up of two hands gripping a knurled barbell before a heavy lift' },
  'texas-method': { file: 'A U.S. Marine with the Camp Pendleton Varsity Powerlifting Team performs a squat during the Military Powerlifting Nationals in Costa Mesa, Calif., July 1, 2011 110701-M-GN937-167.jpg', width: 1280, focal: { x: 50, y: 45 }, alt: 'A powerlifter under the bar in the bottom of a competition squat' },
  'juggernaut-method': { file: 'Seaman performs a deadlift during a power lifting competition. (29740966872).jpg', width: 1280, focal: { x: 50, y: 40 }, alt: 'A strong athlete about to finish a loaded barbell deadlift' },
  'gzcl': { file: 'Woman doing squat workout in gym with barbell.jpg', width: 1280, focal: { x: 55, y: 45 }, alt: 'An athlete squatting with a barbell on her back in a rack' },
  'phul': { file: 'Strong woman performs shoulder press exercise in fitness gym during afternoon workout session.jpg', width: 960, focal: { x: 50, y: 40 }, alt: 'An athletic woman pressing two dumbbells overhead in a gym' },
  'phat': { file: 'Woman standing in front of a dumbbell rack doing bicep curls.jpg', width: 1280, focal: { x: 45, y: 50 }, alt: 'Dumbbell curl in front of a full rack of dumbbells' },
  'dup': { file: 'USMC-110816-F-2786W-005.jpg', width: 1280, focal: { x: 50, y: 55 }, alt: 'Bench press seen from above, bar locked out over the chest' },
  'upper-lower-powerbuilding': { file: 'Attractive sporty woman doing overhead press in gym with barbell.jpg', width: 960, focal: { x: 50, y: 30 }, alt: 'An athlete pressing a loaded barbell overhead' },
  'full-body-hypertrophy': { file: 'Woman in a gym sitting on the floor and doing dumbbell curls.jpg', width: 1280, focal: { x: 50, y: 40 }, alt: 'A focused lifter doing dumbbell curls in a bright gym' },
  '2j-recomposition': { file: 'Strong woman using cable machine for upper body workout in gym.jpg', width: 1280, focal: { x: 55, y: 55 }, alt: 'A lifter pulling a rope on a cable machine' },
  'concurrent-strength-cardio': { file: 'Young blonde woman running on a treadmill in the gym closeup.jpg', width: 1280, focal: { x: 45, y: 40 }, alt: 'An athlete on a treadmill in a gym, with strength equipment around' },
  'full-body-conditioning': { file: 'Scott Webb 2015-06-17 (Unsplash).jpg', width: 1280, focal: { x: 30, y: 50 }, alt: 'An athlete swinging battle ropes in a dark training space' },
}

const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
mkdirSync(outDir, { recursive: true })
const meta = {}
for (const [slug, c] of Object.entries(COVERS)) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&titles=' + encodeURIComponent('File:' + c.file) + '&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=' + c.width + '&format=json'
  const j = await (await fetch(api, { headers: UA })).json()
  const i = Object.values(j.query.pages)[0].imageinfo?.[0]
  if (!i) throw new Error('missing on Commons: ' + c.file)
  const m = i.extmetadata || {}
  const licence = strip(m.LicenseShortName?.value)
  if (!/^(Public domain|CC0|CC BY 2\.0|CC BY 4\.0|CC BY 3\.0)$/i.test(licence)) throw new Error(`${slug}: licence not accepted: ${licence}`)
  const buf = Buffer.from(await (await fetch(i.thumburl, { headers: UA })).arrayBuffer())
  if (buf.length < 20000) throw new Error(slug + ': image too small')
  writeFileSync(join(outDir, slug + '.jpg'), buf)
  const author = strip(m.Artist?.value) || strip(m.Credit?.value)
  meta[slug] = {
    coverImage: `/premium/covers/${slug}.jpg`, coverImageAlt: c.alt, coverFocalPoint: c.focal,
    coverImageSource: i.descriptionurl, coverImageLicense: licence,
    coverImageAttribution: /public domain|cc0/i.test(licence) ? `${author.slice(0, 120)} (${licence}), via Wikimedia Commons` : `${author.slice(0, 120)}, ${licence}, via Wikimedia Commons`,
  }
  console.log(slug.padEnd(28), licence.padEnd(14), (buf.length / 1024).toFixed(0) + ' KB', author.slice(0, 50))
}
writeFileSync(join(root, 'scripts', 'premium', 'covers.json'), JSON.stringify(meta, null, 1) + '\n')
console.log('covers.json written')
