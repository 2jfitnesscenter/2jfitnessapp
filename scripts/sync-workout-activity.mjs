import fs from 'node:fs';
const source = new URL('../frontend/src/lib/workout-activity.js', import.meta.url);
const target = new URL('../api/lib/workout-activity.js', import.meta.url);
const text = fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== text) throw new Error('Workout activity model out of sync');
} else fs.writeFileSync(target, text);
console.log('WORKOUT_ACTIVITY_MODEL=OK');
