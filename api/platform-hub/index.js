import { HUB_PATHS, parseHubEnv } from './config.js';
import { createReceiver } from './receiver.js';
import { createRedeemClient } from './redeem-client.js';
import { createHubServiceRoutes } from './service-routes.js';
import { createHubSettings } from './settings.js';
import { createLinkEndNotifier } from './link-end.js';
import { createLoginRetire } from './login-retire.js';
import { createStepup } from './stepup.js';
import { createStepupRedeemClient } from './stepup-client.js';
import { createHubStaff } from './staff.js';

export { parseHubEnv, HUB_PATHS };

// F9b · Platform (2J Hub) bridge: receiver of Home's form, contract-F9a provisioning and directory, the member's level/notice view and the
// staff-for-a-member gate. Wired from server.js; every route is absent (router 404) while its switch is off.

/** Staff routes that act on ONE member's professional follow-up: the member's `professionalFollowUp` applies (the staff role guard stays inside). */
export const STAFF_FOLLOWUP_WRITES = Object.freeze([
  'POST /api/trainer/followup/start', 'POST /api/trainer/followup/goal', 'POST /api/trainer/followup/note',
  'POST /api/trainer/followup/decision', 'POST /api/trainer/followup/flag', 'POST /api/trainer/followup/analyze',
  'POST /api/trainer/followup/questionnaire/assign',
]);

export function createPlatformHub({ hub, integrationConfig, db, saveDb, secEvent, json, readBody, readSession, newSsoSession, integration, isEnvAdmin, isStaff = () => true, isAdmin = () => false, changeRole = null, revokeSsoStaffSessions = () => {}, envAdminIds = [], rateLimit, store, generateUsername, legacyProvision, readState, writeState, notifications, dataDir, fetchImpl = globalThis.fetch, now = Date.now }) {
  const redeem = createRedeemClient({ client: integrationConfig.client, fetchImpl, now });
  const receive = createReceiver({ hub, homeUrl: integrationConfig.homeUrl, db, saveDb, secEvent, readSession, newSsoSession, capabilities: integration.capabilities, isEnvAdmin, rateLimit, redeem, now });
  // F9c: nothing of this exists (no routes, no outbox file, no timers) unless PLATFORM_HUB_SETTINGS_ENABLED (with the bridge) is on.
  const settings = hub.settingsEnabled ? createHubSettings({ db, saveDb, secEvent, json, readState, writeState, notifications, now }) : null;
  const linkEnd = hub.settingsEnabled && dataDir ? createLinkEndNotifier({ client: integrationConfig.client, dataDir, secEvent, saveDb, fetchImpl, now }) : null;
  // F9e: nothing (no route, no timer, governs → false) unless PLATFORM_HUB_STAFF_ROLES_ENABLED with the bridge and the SSO receiver.
  const staff = createHubStaff({
    hub, client: integrationConfig.client, db, saveDb, secEvent, json, readSession, newSsoSession, isEnvAdmin, isAdmin, isTrainer: isStaff,
    changeRole, revokeSsoStaffSessions, envAdminIds, store, rateLimit, fetchImpl, now,
  });
  // F9d: inert (appliesTo → false) unless PLATFORM_LOGIN_RETIRED, the SSO receiver and PLATFORM_HOME_URL are all set.
  // F9e: for staff, inert unless PLATFORM_STAFF_LOGIN_RETIRED, the staff roles switch and PLATFORM_ADMIN_URL are all set.
  const loginRetire = createLoginRetire({ hub, homeUrl: integrationConfig.homeUrl, isStaff, isEnvAdmin, isAdmin, staff, secEvent, saveDb, json });
  // F9d-2: inert (no route, admits → false) unless PLATFORM_HUB_STEPUP_ENABLED with the bridge and the SSO receiver.
  const stepup = createStepup({
    hub, db, saveDb, secEvent, readSession, receiver: receive, rateLimit, isStaff, isEnvAdmin, now,
    redeemStepup: createStepupRedeemClient({ client: integrationConfig.client, fetchImpl, now }),
  });
  const service = createHubServiceRoutes({ hub, db, saveDb, secEvent, json, store, generateUsername, isEnvAdmin, legacyProvision, settings, now });

  /** What the member's own screen needs: level, notice (H-79.1) and, for an SSO session, where "Volver a Home" goes. Never computed here. */
  async function level(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
    const sso = user.authLevel === 'sso';
    // F9d-2: only while the step-up switch is on, the live grant of THIS session (purpose + until when); absent otherwise (F9d-identical).
    const grant = hub.stepupEnabled ? { stepUp: stepup.stepUp.view(req, user) } : {};
    const base = { v: 1, sso, homeUrl: sso ? integrationConfig.homeUrl : null, ...grant };
    if (!user.personId || user.platformLink?.state !== 'active') return json(res, 200, { ...base, linked: false, level: null, accessState: null, notice: null });
    let view = null;
    try { view = await integration.capabilities.evaluate(user, { mode: integration.modeOf(user) === 'legacy' ? 'shadow' : integration.modeOf(user) }); } catch { view = null; }
    if (!view) return json(res, 200, { ...base, linked: true, level: null, accessState: null, notice: null });
    const notice = view.accessState === 'provisional' ? 'PAYMENT_PENDING' : view.level === 'blocked' && view.reasonCode === 'ADMIN_SUSPENDED' ? 'SUSPENDED' : null;
    return json(res, 200, { ...base, linked: true, level: view.level, accessState: view.accessState ?? null, verified: view.verified === true, notice });
  }

  const routes = {
    ...service.routes,
    ...staff.directoryRoutes,
    ...staff.routes,
    ...(hub.receiverEnabled ? { [`POST ${HUB_PATHS.receiver}`]: receive } : {}),
    ...(hub.stepupEnabled ? { [`POST ${HUB_PATHS.stepupReceiver}`]: stepup.receive } : {}),
    ...(hub.bridgeEnabled ? { [`GET ${HUB_PATHS.level}`]: level } : {}),
  };

  /**
   * With PLATFORM_ENFORCEMENT_ENABLED, staff follow-up writes for a member also need THAT member's `professionalFollowUp` (decision of the
   * preparation doc, groups E/F). The staff member's own capabilities are never consulted and the handler keeps its role guard. Legacy members
   * are untouched; shadow members only log (memberGate).
   */
  function wrapStaffForMember(table) {
    if (!hub.enforcementEnabled) return table;
    for (const key of STAFF_FOLLOWUP_WRITES) {
      const handler = table[key];
      if (!handler) continue;
      table[key] = async (req, res) => {
        let body;
        try { body = await readBody(req); } catch { return json(res, 400, { error: 'petición inválida' }); }
        const member = typeof body?.id === 'string' ? db.users.find(candidate => candidate.id === body.id) : null;
        if (member && integration.modeOf(member) !== 'legacy') {
          const verdict = await integration.memberGate(member, ['professionalFollowUp']);
          if (!verdict.allowed) return json(res, 403, { error: 'el socio no tiene seguimiento profesional en su plan', code: 'member_capability_required', capabilities: ['professionalFollowUp'], reasonCode: verdict.reasonCode });
        }
        return handler(req, res);
      };
    }
    return table;
  }

  /**
   * F9c · Account erasure (lib/account-erasure.js, unchanged). `before` is called with the member BEFORE erasing (captures the link), `after`
   * once the erasure succeeded: it drops the hub's own records that name the account and queues the end-of-link notice for Platform.
   * Neither can block, fail or undo the erasure.
   */
  const erasure = {
    before(user) {
      if (!hub.settingsEnabled || !user) return null;
      const linked = user.platformLink?.state === 'active' && user.personId && user.platformLink.personId === user.personId;
      return { uid: user.id, personId: linked ? user.personId : null };
    },
    after(subject) {
      if (!subject?.uid) return;
      try {
        const records = db.platformHubProvisioning || {};
        for (const [key, record] of Object.entries(records)) if (record?.trainingUserId === subject.uid) delete records[key];
        settings?.forget(subject.uid);
        saveDb();
      } catch { /* residue cleanup must never fail the erasure */ }
      if (subject.personId) linkEnd?.enqueue({ personId: subject.personId, trainingUserId: subject.uid });
    },
  };

  return {
    routes,
    resolve: service.resolve,
    erasure,
    linkEnd,
    loginRetire,
    staff,
    stepUp: stepup.stepUp,
    wrapStaffForMember,
    /** Added to GET /api/config only while the bridge is on, so the public config stays byte-identical when it is off. */
    publicConfig: () => (hub.bridgeEnabled ? { platformBridge: true } : {}),
  };
}
