import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
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
import HealthIntegrations from './views/HealthIntegrations.jsx'
import Records from './views/Records.jsx'
import { showPendingCelebration } from './sheets.jsx'
import Profile from './views/Profile.jsx'
const Social = lazy(() => import('./views/Social.jsx'))
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
import NotificationWatcher from './components/NotificationWatcher.jsx'
import ConnectedApps from './views/ConnectedApps.jsx'
import Measurements, { SkinfoldsScreen, BodyMeasurementsScreen } from './views/Measurements.jsx'
import Health from './views/Health.jsx'
import Recovery from './views/Recovery.jsx'
import Rank from './views/Rank.jsx'
import Admin from './views/Admin.jsx'
import AdminMembers from './views/AdminMembers.jsx'
import PhysicalProfileWizard from './views/PhysicalProfileWizard.jsx'
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
  const syncStatus = useStore(s => s.syncStatus)
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => {
    applyPrefs(S.theme, S.accent, S.glass, S.glassOpacity, S.glassBlur, S.textScale)
    if (S.theme !== 'system' || !window.matchMedia) return
    // live-follow the OS toggle (e.g. sunset auto dark mode) while on 'system', no reload needed
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyPrefs(S.theme, S.accent, S.glass, S.glassOpacity, S.glassBlur, S.textScale)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [S.theme, S.accent, S.glass, S.glassOpacity, S.glassBlur, S.textScale])
  useEffect(() => { setLang(S.lang || 'es') }, [S.lang])
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
              <Routes>
                <Route path="/trainer" element={<TrainerClients />} />
                <Route path="/trainer/blocks" element={<BlockLibrary />} />
                <Route path="/trainer/blocks/edit/:blockId" element={<BlockEditor />} />
                <Route path="/trainer/guided" element={<GuidedAdmin />} />
                <Route path="/trainer/guided/edit/:id" element={<GuidedEditor />} />
                <Route path="/trainer/:memberId/build/:kind/:id" element={<Constructor />} />
                <Route path="/trainer/:memberId" element={<TrainerClientPlan />} />
                <Route path="/trainer/:memberId/ai" element={<TrainerAIGenerate />} />
                <Route path="/trainer/:memberId/scan" element={<TrainerScanRoutine />} />
                <Route path="/trainer/:memberId/r/:routineId" element={<TrainerRoutineBuilder />} />
                <Route path="/trainer/:memberId/p/:programId" element={<TrainerProgramBuilder />} />
                <Route path="*" element={<Navigate to="/trainer" replace />} />
              </Routes>
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
          {!authed ? <Login /> : needsOnboarding ? <PhysicalProfileWizard /> : (
            <Suspense fallback={<div className="narrow" role="status" style={{ paddingTop: 24 }}>{t('Loading…')}</div>}><Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/p/:id" element={<ProgramEdit />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/train2j" element={<Train2J />} />
              <Route path="/train2j/programs" element={<GuidedProgramCatalog />} />
              <Route path="/train2j/program/:id" element={<GuidedProgramDetail />} />
              <Route path="/train2j/c/:id" element={<Train2JCollection />} />
              <Route path="/train2j/r/:id" element={<Train2JDetail />} />
              <Route path="/stretch" element={<Stretch />} />
              <Route path="/tests" element={<TestSession />} />
              <Route path="/clock" element={<ClockPicker />} />
              <Route path="/clock/:mode" element={<ClockRun />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/social" element={<Social />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/social/preferences" element={<SocialPreferences />} />
              <Route path="/social/profile/:id" element={<SocialProfile />} />
              <Route path="/social/share/:id" element={<SocialShareDetail />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/training" element={<TrainingSettings />} />
              <Route path="/settings/stats" element={<StatsSettings />} />
              <Route path="/settings/rp-volume" element={<RpVolumeCalibration />} />
              <Route path="/stats/rp-volume" element={<RpVolumeStats />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/chat/:id" element={<ChatThread />} />
              <Route path="/connected-apps" element={<ConnectedApps />} />
              <Route path="/measurements" element={<Measurements />} />
              <Route path="/measurements/folds" element={<SkinfoldsScreen />} />
              <Route path="/measurements/body" element={<BodyMeasurementsScreen />} />
              <Route path="/health" element={<Health />} />
              <Route path="/health/integrations" element={<HealthIntegrations />} />
              <Route path="/recovery" element={<Recovery />} />
              <Route path="/rank" element={<Rank />} />
              <Route path="/badges" element={<Badges />} />
              <Route path="/mi2j" element={<Mi2J />} />
              <Route path="/records" element={<Records />} />
              {/* The Coach screens gate themselves on the instance config; the routes exist
                  unconditionally so a deep link from a notification lands somewhere sane
                  rather than on the catch-all. */}
              <Route path="/coach" element={<Coach />} />
              <Route path="/coach/intake" element={<CoachIntake />} />
              <Route path="/coach/proposal" element={<CoachProposal />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="/admin/members" element={user?.admin ? <AdminMembers /> : <Navigate to="/home" replace />} />
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
      {!needsOnboarding && <TabBar />}
      {syncStatus === 'conflict' && <SyncConflictDialog />}
      <RestTimer />
      <ChatWatcher />
      <FriendsWatcher />
      <NotificationWatcher />
      {!needsOnboarding && <InstallPrompt />}
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
