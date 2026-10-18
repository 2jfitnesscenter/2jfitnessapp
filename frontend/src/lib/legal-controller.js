// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The ONE place for the facts about the data controller that only the owner can supply. Each
// value stays an explicit LEGAL_TBD_ placeholder until it is confirmed: never invent them, and
// never ship a guess. The privacy screen (views/Privacy.jsx) and docs/PRIVACY_POLICY.md read /
// mirror exactly these fields; once every value is filled in, the "pending confirmation" notice
// on the screen disappears by itself.
//
// Facts about third parties and the server that nobody has verified yet are listed here too, so
// "what is still open" is a single list rather than a search.

export const CONTROLLER = {
  name: 'LEGAL_TBD_CONTROLLER_NAME',           // legal name / razón social of the controller
  taxId: 'LEGAL_TBD_TAX_ID',                   // NIF / CIF
  address: 'LEGAL_TBD_POSTAL_ADDRESS',
  privacyEmail: 'LEGAL_TBD_PRIVACY_EMAIL',     // where rights requests are sent
  dpo: 'LEGAL_TBD_DPO_OR_NOT_APPOINTED'        // data protection officer, or "not appointed"
}

export const VERIFY = {
  serverLocation: 'LEGAL_TBD_SERVER_LOCATION',               // where the VPS physically is, and its provider
  hostingProvider: 'LEGAL_TBD_HOSTING_PROVIDER',
  backupDestination: 'LEGAL_TBD_BACKUP_DESTINATION',         // where the encrypted off-site copy goes, if used
  backupFrequency: 'LEGAL_TBD_BACKUP_FREQUENCY',             // how often the backup job runs (sets the real remote retention span)
  transferSafeguards: 'LEGAL_TBD_TRANSFER_SAFEGUARDS',       // adequacy decision / SCC / DPF per provider
  aiProviderTerms: 'LEGAL_TBD_AI_PROVIDER_TERMS',            // retention / training terms of the configured AI accounts
  legalBasis: 'LEGAL_TBD_LEGAL_BASIS_CONFIRMATION',          // controller confirms the proposed bases
  trainerAiBasis: 'LEGAL_TBD_TRAINER_AI_BASIS',              // trainer-side AI works without the member's Coach consent
  staffNotesAccess: 'LEGAL_TBD_STAFF_NOTES_ACCESS'           // private professional notes are not in the automatic export
}

const isTbd = v => typeof v === 'string' && v.startsWith('LEGAL_TBD_')

/** Every controller field and every unverified fact that is still a placeholder. */
export const pendingItems = () => [...Object.values(CONTROLLER), ...Object.values(VERIFY)].filter(isTbd)
export const controllerPending = () => Object.values(CONTROLLER).some(isTbd)
