// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9d · "Entra desde 2J Home": shown instead of a session when Búnker's own sign-in is retired for a linked member (PLATFORM_LOGIN_RETIRED).
import { t } from '../lib/i18n.js'
import { LOGIN_RETIRED_TEXT, LOGIN_RETIRED_TITLE, OPEN_HOME } from '../lib/platform-notices.js'

export default function LoginRetiredSheet({ homeUrl, close }) {
  return (
    <div role="dialog" aria-label={t(LOGIN_RETIRED_TITLE)} style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>{t(LOGIN_RETIRED_TITLE)}</h2>
      <p style={{ margin: 0 }}>{t(LOGIN_RETIRED_TEXT)}</p>
      <a className="btn" href={homeUrl} rel="noreferrer">{t(OPEN_HOME)}</a>
      {close ? <button type="button" className="btn ghost" onClick={close}>{t('Close')}</button> : null}
    </div>
  )
}
