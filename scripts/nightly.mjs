// Schedules fetch-data once a day with launchd (macOS), so the queue drains inside the
// free tier without anyone running it. launchd, not cron: a job missed while the Mac
// slept runs when it wakes. Output is appended to .cache/nightly.log. The run only
// writes files — commit them when you like.
//
//   npm run nightly -- install [--hour 3] [--budget 9000]
//   npm run nightly -- status
//   npm run nightly -- uninstall
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { DEFAULT_BUDGET } from './open-meteo.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LABEL = 'com.climate-fit.fetch-data'
const PLIST = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const LOG = join(ROOT, '.cache', 'nightly.log')
const domain = `gui/${process.getuid()}`

const {
  values: opts,
  positionals: [cmd],
} = parseArgs({
  allowPositionals: true,
  options: { hour: { type: 'string', default: '3' }, budget: { type: 'string', default: String(DEFAULT_BUDGET) } },
})
const launchctl = (...args) => execFileSync('launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const loaded = () => {
  try {
    launchctl('print', `${domain}/${LABEL}`)
    return true
  } catch {
    return false
  }
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

if (cmd === 'install') {
  const hour = Number(opts.hour)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('--hour must be 0–23')
  // The node that runs this is the one launchd will use: its PATH has no nvm or Homebrew.
  const args = [process.execPath, join(ROOT, 'scripts', 'fetch-data.mjs'), '--budget', opts.budget]
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>${args.map((a) => `<string>${esc(a)}</string>`).join('')}</array>
  <key>WorkingDirectory</key><string>${esc(ROOT)}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>${esc(LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(LOG)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
</dict>
</plist>
`
  await mkdir(dirname(PLIST), { recursive: true })
  await mkdir(dirname(LOG), { recursive: true })
  if (loaded()) launchctl('bootout', `${domain}/${LABEL}`)
  await writeFile(PLIST, plist)
  launchctl('bootstrap', domain, PLIST)
  console.log(
    `installed: fetch-data daily at ${String(hour).padStart(2, '0')}:00, budget ${opts.budget} calls, log ${LOG}`,
  )
} else if (cmd === 'uninstall') {
  if (loaded()) launchctl('bootout', `${domain}/${LABEL}`)
  await rm(PLIST, { force: true })
  console.log('uninstalled')
} else if (cmd === 'status') {
  if (!loaded()) console.log('not installed')
  else {
    const info = launchctl('print', `${domain}/${LABEL}`)
    const field = (k) => info.match(new RegExp(`${k} = (.*)`))?.[1]
    console.log(
      `installed · state ${field('state') ?? '?'} · runs ${field('runs') ?? 0} · last exit ${field('last exit code') ?? '—'}`,
    )
  }
  const log = await readFile(LOG, 'utf8').catch(() => '')
  if (log) console.log(`\n${log.trimEnd().split('\n').slice(-12).join('\n')}`)
} else {
  console.log('usage: npm run nightly -- install [--hour 3] [--budget 9000] | status | uninstall')
  process.exit(1)
}
