// F9b · Platform (2J Hub) bridge configuration. Everything is OFF unless explicitly enabled.
// See docs/PLATFORM_HUB_F9B_RECONCILIATION.md for what each switch turns on and in which order.
import { parseServiceAuthKeys } from '../platform-proof/service-auth.js';

const TRUE = /^(1|true)$/i;

/** Contract constants of 2JHub docs/contracts/platform-training-v2.md (F9a). Not the defaults the old preparation used. */
export const HUB_SSO = Object.freeze({
  issuer: '2j-platform',
  audience: '2j-training',
  purpose: 'training-sso',
  destination: 'bunker',
  assurance: 'platform_sso',
});
export const HUB_PATHS = Object.freeze({
  redeem: '/api/internal/platform/v2/training-sso/redeem',
  receiver: '/api/platform/v1/sso/receive',
  level: '/api/platform/v1/me/training-level',
  provision: '/api/platform/v1/provision',
  directory: '/api/internal/platform/v1/training-users',
  // F9c · `${directory}/{trainingUserId}/settings` (GET, PATCH) and Training → Platform end-of-link notice.
  linkEnded: '/api/internal/platform/v2/training-links/ended',
});
/** F9c · Closed list of Training destinations Home may open through SSO (`next` form field). Never a free URL. */
export const HUB_SSO_NEXT = Object.freeze({ account: '/settings#data' });

export function parseHubEnv(env) {
  const bridge = TRUE.test(env.PLATFORM_TRAINING_BRIDGE_ENABLED || '');
  return Object.freeze({
    bridgeEnabled: bridge,
    // The receiver also needs SSO sessions to be allowed at all.
    receiverEnabled: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || ''),
    directoryEnabled: bridge && TRUE.test(env.PLATFORM_DIRECTORY_ENABLED || ''),
    provisioningEnabled: bridge && TRUE.test(env.PLATFORM_PROVISIONING_ENABLED || ''),
    enforcementEnabled: TRUE.test(env.PLATFORM_ENFORCEMENT_ENABLED || ''),
    // F9c: Training settings from 2J Home (signed GET/PATCH), `next` in the SSO form and the end-of-link notice on account erasure.
    settingsEnabled: bridge && TRUE.test(env.PLATFORM_HUB_SETTINGS_ENABLED || ''),
    // Keys Platform uses to call Training (Platform's TRAINING_OUTBOUND_KEY_ID / TRAINING_OUTBOUND_KEY). Dedicated: never the proof keys.
    inboundKeys: parseServiceAuthKeys(env.PLATFORM_HUB_INBOUND_KEYS || ''),
  });
}
