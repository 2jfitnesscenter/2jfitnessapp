import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import ProgramEdit from './views/ProgramEdit.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import TestSession from './views/TestSession.jsx'
import ClockPicker from './views/Clock.jsx'
import ClockRun from './views/ClockRun.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Social from './views/Social.jsx'
import Settings from './views/Settings.jsx'
import Profile from './views/Profile.jsx'
import Friends from './views/Friends.jsx'
import Chat from './views/Chat.jsx'
import ChatThread from './views/ChatThread.jsx'
import ConnectedApps from './views/ConnectedApps.jsx'
import Measurements from './views/Measurements.jsx'
import Recovery from './views/Recovery.jsx'
import Admin from './views/Admin.jsx'
import PhysicalProfileWizard from './views/PhysicalProfileWizard.jsx'
import Coach from './views/Coach.jsx'
import CoachIntake from './views/CoachIntake.jsx'
import CoachProposal from './views/CoachProposal.jsx'

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// 'system' (the default for new profiles) follows the device's own setting; 'dark'/'light'
// are an explicit, sticky override once the user picks one in Settings.
const systemPrefersLight = () => window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
const resolveTheme = theme => (theme === 'light' || theme === 'dark') ? theme : (systemPrefersLight() ? 'light' : 'dark')

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => {
    applyPrefs(S.theme, S.accent)
    if (S.theme !== 'system' || !window.matchMedia) return
    // live-follow the OS toggle (e.g. sunset auto dark mode) while on 'system', no reload needed
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyPrefs(S.theme, S.accent)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || 'es') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang || 'es' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  // A genuinely brand-new profile only — one with no real data at all yet — sees the Physical
  // Profile wizard once, right after registering, instead of Login.jsx's old single-sheet form.
  // A profile that already has data (existing accounts from before this existed, or one restored
  // from a backup) is never gated on it, even if `onboarded` itself was never set.
  const hasPhysicalData = S.height || S.birthDate || S.workouts.length > 0
  const needsOnboarding = !!user && !S.onboarded && !hasPhysicalData
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
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {!authed ? <Login /> : needsOnboarding ? <PhysicalProfileWizard /> : (
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/p/:id" element={<ProgramEdit />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/tests" element={<TestSession />} />
              <Route path="/clock" element={<ClockPicker />} />
              <Route path="/clock/:mode" element={<ClockRun />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/history" element={<History />} />
              <Route path="/social" element={<Social />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/friends" element={<Friends />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/chat/:id" element={<ChatThread />} />
              <Route path="/connected-apps" element={<ConnectedApps />} />
              <Route path="/measurements" element={<Measurements />} />
              <Route path="/recovery" element={<Recovery />} />
              {/* The Coach screens gate themselves on the instance config; the routes exist
                  unconditionally so a deep link from a notification lands somewhere sane
                  rather than on the catch-all. */}
              <Route path="/coach" element={<Coach />} />
              <Route path="/coach/intake" element={<CoachIntake />} />
              <Route path="/coach/proposal" element={<CoachProposal />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </ErrorBoundary>
      </div>
      {/* Hidden during the Physical Profile wizard — a tab bar would just be a way to skip past
          it without using its own "Skip for now" (which, unlike navigating away, marks
          onboarded so the wizard doesn't reappear). */}
      {!needsOnboarding && <TabBar />}
      <RestTimer />
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
