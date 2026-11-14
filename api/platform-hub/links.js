// F9b · Link index between a Platform person and a Training user, unique in BOTH directions.
// Platform is the authority on who is linked to whom (H-73: staff link from Admin, never by e-mail/name/phone). The F9a contract does not tell
// Training when staff create a link, so the first signed SSO redemption for an unlinked Training user ADOPTS it — only when nobody else holds that
// person and the user holds no other live link. Any doubt is a conflict and nothing is linked.

const occupies = link => Boolean(link) && ['pending', 'active'].includes(link.state);

/** @returns {{status:'linked'}|{status:'adopt'}|{status:'conflict', reason:string}} */
export function linkState(db, user, personId) {
  const link = user.platformLink;
  if (occupies(link) || (typeof user.personId === 'string' && user.personId !== personId)) {
    if (link?.state === 'active' && link.personId === personId && user.personId === personId) {
      return personTakenElsewhere(db, user, personId) ? { status: 'conflict', reason: 'person_taken' } : { status: 'linked' };
    }
    return { status: 'conflict', reason: link?.state === 'pending' ? 'pending' : 'other_person' };
  }
  if (personTakenElsewhere(db, user, personId)) return { status: 'conflict', reason: 'person_taken' };
  return { status: 'adopt' };
}

function personTakenElsewhere(db, user, personId) {
  return db.users.some(other => other.id !== user.id && (other.personId === personId || (occupies(other.platformLink) && other.platformLink.personId === personId)));
}
