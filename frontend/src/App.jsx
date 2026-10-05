import { api } from './lib/api.js'
import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS, LIQUID_GLASS } from './lib/format.js'
import { setLang, useLang, t } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import SyncIndicator from './components/SyncIndicator.jsx'
import RestTimer from './components/RestTimer.jsx'
import HealthOnboardingGate from './components/HealthOnboarding.jsx'
import ChatWatcher from './components/ChatWatcher.jsx'
import FriendsWatcher from './components/FriendsWatcher.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'
import SyncConflictDialog from './components/SyncConflictDialog.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import ProgramEdit from './views/ProgramEdit.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stretch from './views/Stretch.jsx'
import TestSession from './views/TestSession.jsx'
import ClockPicker from './views/Clock.jsx'
import ClockRun from './views/ClockRun.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Settings from './views/Settings.jsx'
import TrainingSettings from './views/TrainingSettings.jsx'
import StatsSettings from './views/StatsSettings.jsx'
import RpVolumeCalibration from './views/RpVolumeCalibration.jsx'
import RpVolumeStats from './views/RpVolumeStats.jsx'
import Bunker from './views/Bunker.jsx'
import BunkerLaunch from './views/BunkerLaunch.jsx'
import BunkerAdminPage from './views/BunkerAdminPage.jsx'
import Badges from './views/Badges.jsx'
import Mi2J from './views/Mi2J.jsx'
import Seguimiento from './views/Seguimiento.jsx'
import AdminAttention from './views/AdminAttention.jsx'
import HealthIntegrations from './views/HealthIntegrations.jsx'
import Records from './views/Records.jsx'
import { showPendingCelebration, autoFinishInactiveWorkout } from './sheets.jsx'
import Profile from './views/Profile.jsx'
const Social = lazy(() => import('./views/Social.jsx'))
// Entrena con 2J Studio (admins): loaded only when an admin opens it.
const ProgramEditor = lazy(() => import('./views/trainer/studio/ProgramEditor.jsx'))
const LibraryQuality = lazy(() => import('./views/trainer/studio/LibraryQuality.jsx'))
const GuidedProgramCatalog = lazy(() => import('./views/GuidedPrograms.jsx').then(m => ({ default: m.GuidedProgramCatalog })))
const GuidedProgramDetail = lazy(() => import('./views/GuidedPrograms.jsx').then(m => ({ default: m.GuidedProgramDetail })))
const Friends = lazy(() => import('./views/Friends.jsx'))
const Chat = lazy(() => import('./views/Chat.jsx'))
const ChatThread = lazy(() => import('./views/ChatThread.jsx'))
const Notifications = lazy(() => import('./views/Notifications.jsx'))
const SocialPreferences = lazy(() => import('./views/SocialPreferences.jsx'))
const SocialProfile = lazy(() => import('./views/SocialProfile.jsx'))
const SocialShareDetail = lazy(() => import('./views/SocialShareDetail.jsx'))
const SocialReports = lazy(() => import('./views/SocialReports.jsx'))
const AdminNews = lazy(() => import('./views/AdminNews.jsx'))
const AdminFeatures = lazy(() => import('./views/AdminFeatures.jsx'))
const AdminAI = lazy(() => import('./views/AdminAI.jsx'))
import NotificationWatcher from './components/NotificationWatcher.jsx'
import ConnectedApps from './views/ConnectedApps.jsx'
import Measurements, { SkinfoldsScreen, BodyMeasurementsScreen } from './views/Measurements.jsx'
import Health from './views/Health.jsx'
import Recovery from './views/Recovery.jsx'
import Rank from './views/Rank.jsx'
import Admin from './views/Admin.jsx'
import AdminMembers from './views/AdminMembers.jsx'
import PhysicalProfileWizard from './views/PhysicalProfileWizard.jsx'
import ExperienceSetup from './views/ExperienceSetup.jsx'
import TrainingPriorities from './views/TrainingPriorities.jsx'
import { uxOn } from './lib/features.js'
import Coach from './views/Coach.jsx'
import CoachIntake from './views/CoachIntake.jsx'
import CoachProposal from './views/CoachProposal.jsx'
import TrainerClients from './views/trainer/TrainerClients.jsx'
import TrainerClientPlan from './views/trainer/TrainerClientPlan.jsx'
import TrainerRoutineBuilder from './views/trainer/TrainerRoutineBuilder.jsx'
import TrainerProgramBuilder from './views/trainer/TrainerProgramBuilder.jsx'
import TrainerAIGenerate from './views/trainer/TrainerAIGenerate.jsx'
import TrainerScanRoutine from './views/trainer/TrainerScanRoutine.jsx'
import Constructor from './views/trainer/Constructor.jsx'
import BlockLibrary, { BlockEditor } from './views/trainer/BlockLibrary.jsx'
import GuidedAdmin, { GuidedEditor } from './views/trainer/GuidedAdmin.jsx'
import Train2J, { Train2JCollection, Train2JDetail } from './views/Train2J.jsx'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// 'system' (the default for new profiles) follows the device's own setting; 'dark'/'light'
// are an explicit, sticky override once the user picks one in Settings.
const systemPrefersLight = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
const resolveTheme = theme => (theme === 'light' || theme === 'dark') ? theme : (systemPrefersLight() ? 'light' : 'dark')

// glassOpacity/glassBlur are friendly 0-100 dials (Settings' sliders).
// --glass-solid (0..1) is how much of each element's own normal, fully-opaque colour shows
// through — every glass rule in index.css is built as "a faint tinted sheen, blended toward
// that element's real flat colour by --glass-solid", so at 100 a panel is pixel-identical to
// the non-glass look (fully legible, never stuck translucent no matter how high the slider
// goes) and at 0 it's as see-through as the effect gets. --glass-sheen/--glass-edge are the
// highlight/border alphas, which fade out over the same range so a "opaque" glass panel
// doesn't keep a diagonal shine baked into what is now just a normal solid surface.
const glassBlurPx = v => Math.round(6 + (Math.max(0, Math.min(100, v)) / 100) * 28)

function applyPrefs(theme, accent, glass, glassOpacity, glassBlur, textScale) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  de.classList.toggle('glass-on', !!glass)
  const solid = Math.max(0, Math.min(100, glassOpacity)) / 100
  de.style.setProperty('--glass-solid', solid.toFixed(3))
  de.style.setProperty('--glass-sheen', (0.16 * (1 - solid)).toFixed(3))
  de.style.setProperty('--glass-edge', (0.05 + (1 - solid) * 0.15).toFixed(3))
  de.style.setProperty('--glass-blur', glassBlurPx(glassBlur) + 'px')
  // Every font-size in index.css is written as calc(Npx * var(--text-scale,1)) — this is the
  // one place that multiplier is set, from Settings → Appearance → Text size.
  de.style.setProperty('--text-scale', (Number(textScale) || 1).toFixed(3))
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  useEffect(() => {
    const check = () => { autoFinishInactiveWorkout().catch(() => {}) }
    const reconnect = () => {
      const active = useStore.getState().S.active
      if (active?.lastActivityAt) api('/api/active/activity', { method: 'POST', body: JSON.stringify({ id: active.id, at: active.lastActivityAt }) }).catch(() => {})
      check()
    }
    check()
    const timer = setInterval(check, 30000)
    window.addEventListener('online', reconnect)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(timer); window.removeEventListener('online', reconnect); document.removeEventListener('visibilitychange', check) }
  }, [])
  const syncStatus = useStore(s => s.syncStatus)
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => {
    applyPrefs(S.theme, S.accent, LIQUID_GLASS.on, LIQUID_GLASS.opacity, LIQUID_GLASS.blur, S.textScale)
    if (S.theme !== 'system' || !window.matchMedia) return
    // live-follow the OS toggle (e.g. sunset auto dark mode) while on 'system', no reload needed
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyPrefs(S.theme, S.accent, LIQUID_GLASS.on, LIQUID_GLASS.opacity, LIQUID_GLASS.blur, S.textScale)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [S.theme, S.accent, S.textScale])
  useEffect(() => { setLang(S.lang || 'es') }, [S.lang])
  // Health energy reconciliation for workouts finished earlier (no-op without a native shell or consent).
  useEffect(() => {
    if (!user?.id) return
    const id = setTimeout(() => { import('./lib/energy-reconcile.js').then(m => m.runEnergyReconcile({ getState: useStore.getState, update: useStore.getState().update })).catch(() => {}) }, 5000)
    return () => clearTimeout(id)
  }, [user?.id])
  useEffect(() => { document.documentElement.lang = S.lang || 'es' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  // Every hook runs before the trainer panel's early return below: an in-app navigation from
  // /home to /trainer must render the same hooks, or React throws and the shell goes blank.
  // Profile wizard once, right after registering, instead of Login.jsx's old single-sheet form.
  // A profile that already has data (existing accounts from before this existed, or one restored
  // from a backup) is never gated on it, even if `onboarded` itself was never set.
  const hasPhysicalData = S.height || S.birthDate || S.workouts.length > 0
  const needsOnboarding = !!user && !S.onboarded && !hasPhysicalData
  // Right after the physical-profile wizard a brand-new profile sees the short visual setup of what it wants from 2J.
  const needsUxSetup = !!user && !needsOnboarding && S.uxSetup === true
  // Mi 2J: what the last workout earned but this device never got to show (the app was closed
  // on the summary) — shown once, from local data, whether or not there's a connection.
  useEffect(() => {
    if (!ready || !authed || needsOnboarding || S.active || loc.pathname.startsWith('/trainer')) return
    const tm = setTimeout(showPendingCelebration, 700)
    return () => clearTimeout(tm)
  }, [ready, authed, needsOnboarding, loc.pathname])
  // The trainer panel is a separate desktop-oriented surface — its own routes, none of the
  // mobile chrome (TabBar/RestTimer/ChatWatcher/FriendsWatcher mean nothing on a screen a
  // trainer is using to build a client's routine), reusing the same session/API and the shared
  // Modals/Toast so sheets like the exercise picker still work.
  if (loc.pathname.startsWith('/trainer')) {
    return (
      <>
        <div id="trainer-app" key={loc.pathname}>
          <ErrorBoundary>
            {!authed ? <Login /> : !user?.trainer ? <Navigate to="/home" replace /> : (
              <Suspense fallback={<div className="narrow" role="status" style={{ paddingTop: 24 }}>{t('Loading…')}</div>}><Routes>
                <Route path="/trainer" element={<TrainerClients />} />
                <Route path="/trainer/blocks" element={<BlockLibrary />} />
                <Route path="/trainer/blocks/edit/:blockId" element={<BlockEditor />} />
                <Route path="/trainer/guided" element={<GuidedAdmin />} />
                <Route path="/trainer/guided/edit/:id" element={<GuidedEditor />} />
                <Route path="/trainer/guided/program/:id" element={user?.admin ? <ProgramEditor /> : <Navigate to="/trainer/guided" replace />} />
                <Route path="/trainer/library-quality" element={user?.admin ? <LibraryQuality /> : <Navigate to="/trainer" replace />} />
                <Route path="/trainer/:memberId/build/:kind/:id" element={<Constructor />} />
                <Route path="/trainer/:memberId" element={<TrainerClientPlan />} />
                <Route path="/trainer/:memberId/ai" element={<TrainerAIGenerate />} />
                <Route path="/trainer/:memberId/scan" element={<TrainerScanRoutine />} />
                <Route path="/trainer/:memberId/r/:routineId" element={<TrainerRoutineBuilder />} />
                <Route path="/trainer/:memberId/p/:programId" element={<TrainerProgramBuilder />} />
                <Route path="*" element={<Navigate to="/trainer" replace />} />
              </Routes></Suspense>
            )}
          </ErrorBoundary>
        </div>
        <Modals />
        <Toast />
      </>
    )
  }

  // The Bunker kiosk runs on a shared, gym-owned screen — nobody "logs into" that device
  // itself, members check in with their own PIN once the page is already up, so this is the
  // one route in the whole app that skips the authed gate entirely (no Login, no TabBar, no
  // guest bypass to think about). It owns its own full-bleed layout. The shared swap selector
  // uses Modals/Toast; training panels themselves remain independent.
  if (loc.pathname === '/bunker') return <><Bunker /><Modals /><Toast /></>
  if (loc.pathname === '/bunker/launch') return <BunkerLaunch />

  // A genuinely brand-new profile only — one with no real data at all yet — sees the Physical
  if (!ready && !authed) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}>
        <Icon name="dumbbell" />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      {/* outside the route-keyed #app so its offline → synced state survives navigation */}
      {authed && <SyncIndicator />}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : needsOnboarding ? <PhysicalProfileWizard /> : needsUxSetup ? <ExperienceSetup mode="onboarding" /> : (
            <Suspense fallback={<div className="narrow" role="status" style={{ paddingTop: 24 }}>{t('Loading…')}</div>}><Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/p/:id" element={<ProgramEdit />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/train2j" element={<Feat k="train2j"><Train2J /></Feat>} />
              <Route path="/train2j/programs" element={<Feat k="train2j"><GuidedProgramCatalog /></Feat>} />
              <Route path="/train2j/program/:id" element={<Feat k="train2j"><GuidedProgramDetail /></Feat>} />
              <Route path="/train2j/c/:id" element={<Feat k="train2j"><Train2JCollection /></Feat>} />
              <Route path="/train2j/r/:id" element={<Feat k="train2j"><Train2JDetail /></Feat>} />
              <Route path="/stretch" element={<Stretch />} />
              <Route path="/tests" element={<TestSession />} />
              <Route path="/clock" element={<ClockPicker />} />
              <Route path="/clock/:mode" element={<ClockRun />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/social" element={<Feat k="social"><Social /></Feat>} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/social/preferences" element={<Feat k="social"><SocialPreferences /></Feat>} />
              <Route path="/social/profile/:id" element={<Feat k="social"><SocialProfile /></Feat>} />
              <Route path="/social/share/:id" element={<Feat k="social"><SocialShareDetail /></Feat>} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/training" element={<TrainingSettings />} />
              <Route path="/settings/stats" element={<StatsSettings />} />
              <Route path="/settings/experience" element={<ExperienceSetup />} />
              <Route path="/settings/rp-volume" element={<Feat k="volume"><RpVolumeCalibration /></Feat>} />
              <Route path="/stats/rp-volume" element={<Feat k="volume"><RpVolumeStats /></Feat>} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/profile/priorities" element={<TrainingPriorities />} />
              <Route path="/friends" element={<Feat k="friends"><Friends /></Feat>} />
              <Route path="/chat" element={<Feat k="chat"><Chat /></Feat>} />
              <Route path="/chat/:id" element={<Feat k="chat"><ChatThread /></Feat>} />
              <Route path="/connected-apps" element={<ConnectedApps />} />
              <Route path="/measurements" element={<Feat k="bioimpedance"><Measurements /></Feat>} />
              <Route path="/measurements/folds" element={<Feat k="bioimpedance"><SkinfoldsScreen /></Feat>} />
              <Route path="/measurements/body" element={<Feat k="bioimpedance"><BodyMeasurementsScreen /></Feat>} />
              <Route path="/health" element={<Feat k="health"><Health /></Feat>} />
              <Route path="/health/integrations" element={<Feat k="health"><HealthIntegrations /></Feat>} />
              <Route path="/recovery" element={<Feat k="recovery"><Recovery /></Feat>} />
              <Route path="/rank" element={<Rank />} />
              <Route path="/badges" element={<Badges />} />
              <Route path="/mi2j" element={<Mi2J />} />
              <Route path="/seguimiento" element={<Seguimiento />} />
              <Route path="/records" element={<Records />} />
              {/* The Coach screens gate themselves on the instance config; the routes exist
                  unconditionally so a deep link from a notification lands somewhere sane
                  rather than on the catch-all. */}
              <Route path="/coach" element={<Coach />} />
              <Route path="/coach/intake" element={<CoachIntake />} />
              <Route path="/coach/proposal" element={<CoachProposal />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to={user?.trainer ? '/trainer' : '/home'} replace />} />
              <Route path="/admin/members" element={user?.admin ? <AdminMembers /> : <Navigate to="/home" replace />} />
              <Route path="/admin/attention" element={user?.admin ? <AdminAttention /> : <Navigate to="/home" replace />} />
              <Route path="/admin/ai" element={user?.admin ? <AdminAI /> : <Navigate to="/home" replace />} />
              <Route path="/admin/features" element={user?.admin ? <AdminFeatures /> : <Navigate to="/home" replace />} />
              <Route path="/admin/news" element={user?.admin ? <AdminNews /> : <Navigate to="/home" replace />} />
              <Route path="/admin/social-reports" element={user?.admin ? <SocialReports /> : <Navigate to="/home" replace />} />
              <Route path="/admin/bunker" element={(user?.admin || user?.trainer) ? <BunkerAdminPage /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes></Suspense>
          )}
        </ErrorBoundary>
      </div>
      {/* Hidden during the Physical Profile wizard — a tab bar would just be a way to skip past
          it without using its own "Skip for now" (which, unlike navigating away, marks
          onboarded so the wizard doesn't reappear). */}
      <HealthOnboardingGate ready={ready} authed={!!user} blocked={needsOnboarding || needsUxSetup || !!S.active} />
      {!needsOnboarding && !needsUxSetup && <TabBar />}
      {syncStatus === 'conflict' && <SyncConflictDialog />}
      <RestTimer />
      <ChatWatcher />
      <FriendsWatcher />
      <NotificationWatcher />
      {!needsOnboarding && !needsUxSetup && <InstallPrompt />}
      <Modals />
      <Toast />
    </>
  )
}

// A route that exists only while its feature is on for this member (admin allows it AND the member did not turn it off).
function Feat({ k, children }) {
  const S = useStore(s => s.S)
  useStore(s => s.features)
  return uxOn(S, k) ? children : <Navigate to="/home" replace />
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
