// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9d · "Entra desde 2J Home": shown instead of a session when Búnker's own sign-in is retired for a linked member (PLATFORM_LOGIN_RETIRED).
import { t } from '../lib/i18n.js'
import { LOGIN_RETIRED_TEXT, LOGIN_RETIRED_TITLE, OPEN_ADMIN, OPEN_HOME, STAFF_LOGIN_RETIRED_TEXT, STAFF_LOGIN_RETIRED_TITLE } from '../lib/platform-notices.js'

// F9e: `staff` = a linked staff account (PLATFORM_STAFF_LOGIN_RETIRED): same sheet, sending to 2J Hub Admin.
export default function LoginRetiredSheet({ homeUrl, close, staff = false }) {
  const title = staff ? STAFF_LOGIN_RETIRED_TITLE : LOGIN_RETIRED_TITLE
  return (
    <div role="dialog" aria-label={t(title)} style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>{t(title)}</h2>
      <p style={{ margin: 0 }}>{t(staff ? STAFF_LOGIN_RETIRED_TEXT : LOGIN_RETIRED_TEXT)}</p>
      <a className="btn" href={homeUrl} rel="noreferrer">{t(staff ? OPEN_ADMIN : OPEN_HOME)}</a>
      {close ? <button type="button" className="btn ghost" onClick={close}>{t('Close')}</button> : null}
    </div>
  )
}
