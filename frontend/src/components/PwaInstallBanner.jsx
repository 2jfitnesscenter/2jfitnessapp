import { t } from '../lib/i18n.js'

export default function PwaInstallBanner({ mode, instructionsOpen = false, onInstall, onHowToInstall, onNowNot, onCloseInstructions }) {
  if (!mode) return null
  return <section id="pwa-install-prompt" className="card pwa-install-banner" aria-label={t('Install 2J Fitness')}>
    <span className="install-i" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg>
    </span>
    <div className="pwa-install-copy">
      <h2>{t('Install 2J Fitness')}</h2>
      <p>{t('Access it faster from your phone and use it like an app.')}</p>
      {mode === 'guide' && instructionsOpen && <div id="pwa-install-instructions" className="pwa-install-instructions" aria-live="polite">
        <p>{t('To add 2J Fitness to your Home Screen:')}</p>
        <ol>
          <li>{t("Tap Safari's Share button.")}</li>
          <li>{t('Choose Add to Home Screen.')}</li>
          <li>{t('Confirm Add.')}</li>
        </ol>
        <button type="button" className="btn plain sm" onClick={onCloseInstructions}>{t('Got it')}</button>
      </div>}
    </div>
    <div className="pwa-install-actions">
      {mode === 'prompt'
        ? <button type="button" className="btn primary sm" onClick={onInstall}>{t('Install')}</button>
        : <button type="button" className="btn primary sm" aria-expanded={instructionsOpen} aria-controls="pwa-install-instructions" onClick={onHowToInstall}>{t('How to install')}</button>}
      <button type="button" className="btn plain sm" onClick={onNowNot}>{t('Not now')}</button>
    </div>
  </section>
}
