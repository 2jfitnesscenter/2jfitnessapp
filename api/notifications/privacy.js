const CATEGORY = Object.freeze({ routine: 'routines', program: 'routines', pr: 'prs', achievement: 'achievements', workout: 'workouts', challenge: 'challenges' });

// One server-side visibility rule shared by every personal social surface. Historical/public
// content is still bounded by today's privacy choice; friendship is always checked live.
export function canViewSharedContent({ authorId, viewerId, kind, privacy, isFriend }) {
  if (authorId === viewerId) return true;
  const p = privacy || {};
  const category = CATEGORY[kind];
  if (!category || p[category] !== true || p.profile === 'private' || p.activity === 'nobody') return false;
  const friends = !!isFriend?.(authorId, viewerId);
  if (friends) return p.profile !== 'private';
  return p.profile === 'community' && p.activity === 'community';
}

export function canViewProfile({ profileId, viewerId, privacy, isFriend, blocked = false }) {
  if (blocked) return false;
  if (profileId === viewerId) return true;
  const scope = privacy?.profile || 'friends';
  return scope === 'community' || (scope === 'friends' && !!isFriend?.(profileId, viewerId));
}
