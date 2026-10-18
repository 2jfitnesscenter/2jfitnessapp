// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The ONE place for the facts about the data controller. The values below were supplied by the
// owner. Anything nobody has verified yet stays an explicit LEGAL_TBD_ placeholder: never invent
// it and never ship a guess. The privacy screen (views/Privacy.jsx) and docs/PRIVACY_POLICY.md
// read / mirror exactly these fields; the "still being verified" notice on the screen shows only
// while at least one LEGAL_TBD_ remains in this file.

export const CONTROLLER = {
  name: 'JUAN JOSE PEREZ SANCHEZ',
  taxId: '54088887V',
  address: 'FRANCISCO LOPEZ SANCHEZ 15, LOCAL, 35250 INGENIO, LAS PALMAS',
  privacyEmail: '2JFITNESSCENTER@GMAIL.COM',
  dpo: 'SIREINSA',
  hosting: 'Contabo'
}

// Facts that are still being verified. Remove an entry (and its mention in the text) only when
// the real value is known.
export const VERIFY = {
  legalBasis: 'LEGAL_TBD_LEGAL_BASIS_REVIEW',           // the specific legal basis per processing, pending validation by the advisor / DPO (SIREINSA)
  dpoContact: 'LEGAL_TBD_DPO_CONTACT',                 // a dedicated SIREINSA channel, if it has one different from the privacy email
  serverLocation: 'LEGAL_TBD_SERVER_LOCATION',         // where the hosting provider's server physically is
  backupFrequency: 'LEGAL_TBD_BACKUP_FREQUENCY',       // only if an automated schedule really exists
  backupRetention: 'LEGAL_TBD_BACKUP_RETENTION',       // how long backup copies are kept
  transferSafeguards: 'LEGAL_TBD_TRANSFER_SAFEGUARDS', // adequacy decision / SCC / DPF per provider, once provider, location and terms are verified
  aiProviderTerms: 'LEGAL_TBD_AI_PROVIDER_TERMS'       // retention / training terms / DPA of the real AI provider accounts
}

const isTbd = v => typeof v === 'string' && v.startsWith('LEGAL_TBD_')

/** Every field of this file that is still a placeholder. */
export const pendingItems = () => [...Object.values(CONTROLLER), ...Object.values(VERIFY)].filter(isTbd)
export const hasPendingLegalItems = () => pendingItems().length > 0
