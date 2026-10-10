# Social & sharing V2

Nothing here replaces an existing system. Friends, chat, the community, marks, challenges, the moderation queue and the share cards stay as they were; this
closes the holes an audit of production (`a0f3a94`) found and makes the most useful flow — sending a routine to a friend — work end to end.

## 1. ACL and privacy (server-side)

| What | Rule |
|---|---|
| Blocks | A block cuts every social read and write in both directions (rating, comments, topics, board, challenges, goals, marks, shares, chat). Admins still see everything, to moderate. |
| Ratings | `rate` needs the post to be visible to the caller (same rule as the list); otherwise it answers 404 like an unknown id. |
| Goals | The author sees their own. An exercise goal follows the "records" privacy like a mark. **Body weight is health data: only accepted friends who may see the profile ever receive it.** |
| Challenges | List, detail, join and the leaderboard hide a blocked author and blocked participants. |
| Topics / board / mark comments | Reading, commenting and the comments themselves respect blocks. |
| Support threads | Only the member, an admin, or a trainer assigned to that member (`assignedTrainers`) reach a support thread; notifications go to the same people. |
| Admin switches | `social`, `chat`, `friends` and `challenges` (which also covers goals) are enforced by the API (403 `feature_off`). Privacy preferences and notifications stay reachable. A chat share needs `chat` and `friends`. |

## 2. Private routine / program shares

A routine or program is sent to **one friend** from the routine or program screen ("Send to a friend"); nothing is published first. The server stores a
**cleaned snapshot** (`api/lib/share-snapshot.js`) with the share in `social-sharing.json`: the plan content only — exercise id, sets, reps / time / cardio,
weight, progression, superset group, and the custom exercises it uses — plus safe metadata (title, goal, level, duration, origin, sender label). Notes, history and
every unknown field are dropped. The receiver keeps what was sent even if the sender changes or deletes the original (no live reference).
A routine already published to the community goes the same way (the server builds the snapshot from the post).

- Open to the sender and the one recipient only, and only while the friendship is alive and nobody blocked anybody. The author's category toggles govern what is visible *without* an explicit send; a private send is the explicit act.
- Idempotent per request key; reuse of a key for other content is refused (409).
- The recipient can **set it aside** (`POST /api/social/shares/discard`): the chat message stays, the sender is not told.
- Notification: the existing `share` type (programs included), respecting preferences; deep link to the conversation.

## 3. Receiving

`/social/share/:id` is one screen: who sent it, title, goal, level, duration (a program shows one workout's length), the exercises (a program: its routines, collapsible),
whether it fits the active gym profile (the helper every other screen uses; the sender's custom exercises are left out of the check) and what equipment is missing.
Choices: **Save** (independent copy in `S.routines` / `S.programs`, marked `fromShare { shareId, senderId, senderLabel, createdAt }`), **Start** (from the saved copy;
a program opens its page) and **Not now**. A mismatch never blocks saving or starting. A saved copy remembers where it came from and nothing else: no sync, no versions.

## 4. Chat efficiency

| Before | After |
|---|---|
| every `GET /api/chat/messages` rewrote and re-encrypted `chat.json` | read state is stored as "read up to the newest message" and written only when that moves |
| every poll returned the whole thread | `?after=<last message id>&rev=<n>` returns only what is new; an unknown cursor, or a moderation removal (`rev` moves), returns the whole thread once |

Measured on a 26-message thread: full 6 898 B, idle poll 297 B (−96 %), one new message 426 B; twelve repeated polls wrote `chat.json` zero times. Polling intervals unchanged (4 s open, 15 s background); no websockets.

## 5. Limits (per person, in memory)

| Action | Allowance |
|---|---|
| Friend requests | 15 / hour (found or not); after a refusal, 24 h before asking the same person again (withdrawing your own request is not a refusal) |
| Username lookups | 20 / 10 min |
| Chat messages | 20 / 30 s and 300 / hour; new support threads 5 / hour |
| Comments | 10 / min and 120 / hour; new topics 10 / hour |
| Shares | 30 / hour |
| Reports | 10 / hour |

Normal use never meets them. A username lookup still answers found / not found (the add-friend flow needs it); the limit is what stops it being walked.

## 6. Moderation

- Removing someone else's content (resolving a report, or staff deleting it directly) writes one `content_removed` security event (author, actor, kind, id, general reason; never the words) and sends the author a notice that cannot be switched off and does not name the reporter. Removing your own content leaves nothing.
- New report targets: a **chat message** (by the other person, or by the member in a support thread) and a **comment** (marks, topics, board). A removed message stays as a marker. No appeals.

## 7. Share cards

Program card of its own; the community card exports as the original, 9:16 (270×480) or 1:1 (270×270), measured from the rendered card so nothing is clipped; a shared workout can add duration, volume, records and cardio — only when ticked, computed by the server from the workout. The image card for a workout keeps its existing content.
**Never** in a share: body weight, measurements, health, bioimpedance, notes, check-ins, Coach, medical data (tests assert it on shares, chat bubbles, feeds and snapshots).

## Not touched
Challenges / marks / goals beyond privacy and blocks, reactions, attachments, realtime, algorithmic feed, Sync V2, Shared Staff, Coach, Training Quality, Library, Health.
Comments still do not notify (a test states it).
