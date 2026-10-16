// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Legal & credits — opened from Settings' footer, next to the version history. Who made what
// (the original openGym project and this fork), the license and where to read it and get the
// source, third parties, and the trademark note. The same facts live in NOTICE.md, AUTHORS.md,
// THIRD_PARTY_NOTICES.md and TRADEMARKS.md; keep them in step.
import { t } from '../lib/i18n.js'

export const SOURCE_URL = 'https://github.com/2jfitnesscenter/2jfitnessapp'
export const UPSTREAM_URL = 'https://github.com/DuarteSantos8/openGym'
export const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'

const Link = ({ href, children }) =>
  <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--acc)' }}>{children}</a>
const H = ({ children }) => <div className="tt" style={{ fontWeight: 700, margin: '16px 0 4px' }}>{children}</div>

export function LegalSheet() {
  return <>
    <h3>{t('Legal & credits')}</h3>
    <div className="small" style={{ lineHeight: 1.6 }}>
      <div className="tt" style={{ fontWeight: 700 }}>2J Fitness Center App</div>
      <div className="dim">{t('Development and fork modifications: {0}', 'Juan Jose Perez Sanchez — 2J Fitness Center')}</div>
      <div className="dim">Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center</div>

      <H>{t('Based on openGym')}</H>
      <div className="dim">openGym — Copyright (C) 2026 Duarte Santos · <Link href={UPSTREAM_URL}>github.com/DuarteSantos8/openGym</Link></div>
      <div className="dim">{t('Includes the AI Coach first added in Alex Costa’s fork of openGym, and contributions from the openGym community.')}</div>

      <H>{t('License')}</H>
      <div className="dim">{t('Free software under the GNU Affero General Public License v3.0 or later (AGPL). You may use, study, share and modify it; whoever offers a modified version over a network must offer its source code under the same license.')}</div>
      <div style={{ marginTop: 6 }}>
        <Link href={LICENSE_URL}>{t('Read the license (AGPL v3)')}</Link><br />
        <Link href={SOURCE_URL}>{t('Source code and legal notices')}</Link>
      </div>

      <H>{t('Third parties')}</H>
      <ul className="dim" style={{ margin: 0, paddingLeft: 18 }}>
        <li>{t('Exercise records and non-media instructions: hasaneyldrm/exercises-dataset, MIT.')}</li>
        <li>{t('Exercise images and animations: © Gym visual; display is enabled by project-owner decision. This does not establish a 2J licence or ownership; see the provenance inventory.')}</li>
        <li>{t('Body diagram geometry: MuscleMap by Melih Colpan (MIT).')}</li>
        <li>{t('Open-source libraries such as React, React Router, Zustand and Vite, each under its own license.')}</li>
      </ul>

      <H>{t('Privacy')}</H>
      <div className="dim">{t('2J stores account, training, follow-up and service data needed to run the app. Members can export or delete their account from Settings. Account erasure removes device sessions and anonymizes linked security-event records; operational backups can retain prior copies until their configured expiry.')}</div>
      <div className="dim" style={{ marginTop: 6 }}>{t('In the self-hosted web app, synced state and service records are held on the 2J server; the browser also keeps local app state and Sync V2 recovery/journal data. The standalone mobile build keeps a private app-data copy on the device. These local copies are not encrypted by 2J itself.')}</div>
      <div className="dim" style={{ marginTop: 6 }}>{t('Trainers can access operational training and follow-up information for members across the centre. assignedTrainers is organizational metadata, not an access restriction. Account roles, staff, security and sensitive global settings remain admin-only.')}</div>
      <div className="dim" style={{ marginTop: 6 }}>{t('Coach and trainer AI use their separate consent and access flows. Coach providers configurable in this app are Anthropic Claude, OpenAI Codex, Google Gemini and OpenAI; the trainer panel currently uses Claude. A selected body-composition report, routine or machine photo is sent to Google Gemini only after you confirm the notice for that file. It is processed for that scan and is not added to your account by the scan flow; do not upload a file you do not want processed by that provider.')}</div>
      <div className="dim" style={{ marginTop: 6 }}>{t('With separate Coach consent, the Coach may send its configured, minimized training context and permitted measurements to the selected provider. Body-composition scan files and Health Connect/HealthKit data are excluded from that Coach payload.')}</div>
      <div className="dim" style={{ marginTop: 6 }}>{t('Health Connect and HealthKit data are read on device only with operating-system permission; WHOOP and Strava use their existing connected-account flows. Health, activity and recovery data are excluded from Coach AI and are not exposed to Social. Social sharing is controlled separately by the sharing choices in the app.')}</div>
      <div className="dim" style={{ marginTop: 6 }}>{t('This notice describes the current technical behavior of 2J Fitness. It is not legal advice or a determination of the legal basis or retention duties that apply to your organization.')}</div>

      <H>{t('Trademarks')}</H>
      <div className="dim">{t('The 2J Fitness Center name and the 2J logo identify 2J Fitness Center. The software license does not grant permission to use them; the code itself remains free under the AGPL.')}</div>
    </div>
  </>
}
