// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The member's own, SEPARATE consent for the AI tools that gym staff use with their data
 * ("Staff AI tools": routine drafts and follow-up analysis, sent to an external AI provider).
 * It is not the Coach consent (S.coach.consent): the Coach is the member using AI on their own
 * behalf; this one lets staff do it. Lives in the member's synced state as a top-level key,
 * `S.staffAi = { consent: { agreedAt, version } }`, written only by the member's own app
 * (Settings → Data → Staff AI tools) and checked by the server before ANY data is built or sent.
 */
export const STAFF_AI_CONSENT_VERSION = 1;

export const hasStaffAiConsent = S =>
  !!S?.staffAi?.consent?.agreedAt && S.staffAi.consent.version === STAFF_AI_CONSENT_VERSION;
