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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  // ---- second wave (hidden programs; the admin publishes them) ----
  'linear-5x5': { file: 'Heidemarie Couch, CIV (5) (14321535058).jpg', width: 1200, focal: { x: 55, y: 55 }, alt: 'Black-and-white close-up of an athlete loading a plate onto a barbell' },
  'heavy-light-medium': { file: 'MWR GWOT.JPEG', width: 1200, focal: { x: 55, y: 45 }, alt: 'A lifter pressing a loaded barbell on the bench with a spotter' },
  'conjugate-strength': { file: 'MCAS Iwakuni Women’s Power Lifting (9352356).jpg', width: 1200, focal: { x: 45, y: 55 }, alt: 'A powerlifter benching between rack uprights with plates in the foreground' },
  'block-periodization-strength': { file: 'IMCOM Powerlifting Championship (8148602).jpg', width: 1280, focal: { x: 50, y: 50 }, alt: 'A powerlifter at the bottom of a competition squat with spotters' },
  'dup-powerbuilding': { file: 'Sporty girl posing in gym on weigh rack.jpg', width: 1280, focal: { x: 55, y: 45 }, alt: 'An athlete leaning on a rack of dumbbells in a gym' },
  'ppl-powerbuilding': { file: 'Young man using a leg press machine at the gym.jpg', width: 900, focal: { x: 45, y: 50 }, alt: 'Feet on the plate of a leg press machine' },
  'high-frequency-strength': { file: 'The Soviet Union 1964 CPA 3074 stamp (1964 Summer Olympics, Tokyo. Weightlifting. Clean and jerk).jpg', width: 1126, focal: { x: 50, y: 50 }, alt: 'Vintage stamp illustration of a weightlifter in the clean and jerk' },
  'hst-style-hypertrophy': { file: 'Strength training (Unsplash).jpg', width: 1280, focal: { x: 50, y: 40 }, alt: 'An athlete in front of a gym mirror with a rack of dumbbells' },
  'bfr-hypertrophy': { file: 'Girl playing weights with legs on the exercise machine.jpg', width: 1280, focal: { x: 40, y: 50 }, alt: 'Legs pressing against a leg press plate in a gym' },
  'polarized-endurance': { file: 'Runner in Stainburn Forest (Unsplash).jpg', width: 1280, focal: { x: 62, y: 45 }, alt: 'A runner on a gravel road under a wide blue sky' },
  'threshold-builder': { file: 'Runners in a race, Vieux-Limoilou.jpg', width: 1280, focal: { x: 45, y: 40 }, alt: 'Runners at a steady pace in a road race' },
  'aerobic-base-intervals': { file: 'Cycling in the countryside (Unsplash).jpg', width: 1280, focal: { x: 62, y: 60 }, alt: 'A cyclist riding on an empty road through hills at dusk' },
  'functional-fitness-engine': { file: 'Airborne Burpee.jpg', width: 1280, focal: { x: 50, y: 40 }, alt: 'An athlete jumping at the top of a burpee while others do push-ups' },
  'fitness-race-prep': { file: 'Obstacle race 1.jpg', width: 1280, focal: { x: 45, y: 45 }, alt: 'A participant crawling through sand in an obstacle race' },
  'fitness-race-advanced': { file: 'Running up "insult hill" (6985646263).jpg', width: 1280, focal: { x: 50, y: 60 }, alt: 'Runners charging up a grassy hill in a city park' },
  'strength-zone2-cut': { file: 'Woman doing push-up on yogi mat in the forest with sunset background - 51525476019.jpg', width: 1280, focal: { x: 55, y: 55 }, alt: 'An athlete holding a plank on a mat in a forest at sunset' },
  'metabolic-resistance-progression': { file: 'Girl doing push-ups from the side.jpg', width: 1280, focal: { x: 55, y: 55 }, alt: 'An athlete doing push-ups outdoors on a mat' },
  'entrena-tus-oposiciones': { file: 'Flickr - DVIDSHUB - RIMPAC 2012 international swim meet (Image 8 of 13).jpg', width: 1200, focal: { x: 50, y: 40 }, alt: 'A swimmer in goggles mid-stroke in a pool' },
}

const strip = h => String(h || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
mkdirSync(outDir, { recursive: true })
const metaFile = join(root, 'scripts', 'premium', 'covers.json')
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : {}
const force = process.argv.includes('--force')
for (const [slug, c] of Object.entries(COVERS)) {
  if (meta[slug] && existsSync(join(outDir, slug + '.jpg')) && !force) continue   // already downloaded: --force replaces it
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
writeFileSync(metaFile, JSON.stringify(meta, null, 1) + '\n')
console.log('covers.json written')
