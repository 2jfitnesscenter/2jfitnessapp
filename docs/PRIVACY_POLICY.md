# 2J Fitness — privacy policy

This is the repository copy of the policy shown in the app (Settings → Data → Privacy policy, `frontend/src/views/Privacy.jsx`). It describes what the code does today; it is information for the people whose data is processed, not legal advice, and it does not by itself certify compliance with any law. `frontend/src/views/Privacy.test.jsx` keeps the screen, this file and the code in step.

**Pending items.** Anything still written `LEGAL_TBD_…` is a fact nobody has verified yet. The controller's details were supplied by the owner and live in `frontend/src/lib/legal-controller.js`; the remaining placeholders are listed at the end of this file. Nothing here is a guess.

## 1. Who is responsible

The controller of the personal data processed by this app is JUAN JOSE PEREZ SANCHEZ, tax ID 54088887V, address FRANCISCO LOPEZ SANCHEZ 15, LOCAL, 35250 INGENIO, LAS PALMAS. Privacy contact: 2JFITNESSCENTER@GMAIL.COM. Data protection officer: SIREINSA (dedicated contact channel: LEGAL_TBD_DPO_CONTACT).

2J Fitness is free software (AGPL). Whoever runs a copy of it for their own gym is the controller of the data in that copy.

## 2. Data we process

- **Account:** name, username, avatar, role (member, trainer or admin), sign-in passkeys (public keys only; there are no passwords), active sessions and devices, invitations, recovery links and security events.
- **Training:** profile (birth date, sex, height, goals and preferences), routines, programs, workouts with sets, weights and effort, records and notes.
- **Body and health-related data:** body weight, body composition and test results, readiness and fatigue check-ins, follow-up questionnaires and progress photos, limitations or injuries written for the Coach, and — only if connected — activity, sleep, heart-rate and recovery figures from Health Connect, HealthKit, WHOOP or Strava.
- **Social and messages:** friends, direct messages, posts, comments, challenges, shares and notifications.
- **Staff records:** routines assigned to the member and private professional notes that gym staff write about the follow-up.
- **Technical:** push-notification subscriptions, a sign-in cookie (90 days by default), server logs with identifiers and error codes (never workout, health or message content) and security backups.
- **On the device:** the browser or phone keeps a local copy of the app state and sync journal; the standalone mobile build keeps its data only on the phone. 2J does not encrypt these local copies.

The app has no advertising and no third-party analytics. The detailed storage map (where each category lives, whether it is encrypted at rest, who can read it) is `docs/DATA_MAP.md`.

## 3. Who can see the data

Members see their own data. Trainers have operational access to the training and follow-up of members across the centre; `assignedTrainers` is organizational information, not an access limit. Administrators additionally manage accounts, roles, security and settings. Other members see only what a member chooses to share on Social.

## 4. Why we use it

To run the account and sign in securely; to store and sync training; to let gym staff supervise training and follow-up; to offer optional features the member switches on (Coach and other AI features, social features, connected apps, notifications); to keep the service secure and recoverable (security log, backups); and to answer requests about the data. Data is not sold and not used for advertising.

## 5. Legal basis

The legal basis that applies to each processing is pending validation by the controller's advisor and data protection officer (LEGAL_TBD_LEGAL_BASIS_REVIEW). What follows is the basis currently foreseen, not yet a confirmed legal determination.

- Account, training and service features: foreseen basis — performing the service the member uses (Art. 6(1)(b) GDPR).
- Security log and backups: foreseen basis — the legitimate interest in keeping the service secure and recoverable (Art. 6(1)(f) GDPR).
- Health-related data, body measurements, follow-up and progress photos: foreseen basis — explicit consent (Art. 9(2)(a) GDPR), given when the member enters, connects or uploads them, and withdrawable.
- AI features, connected apps, push notifications and social sharing: foreseen basis — specific consent, asked when they are switched on or used.


## 6. Health-related data

Body measurements, check-ins, follow-up and health-integration data are health-related and are treated with extra care: only the member and gym staff with operational access can see them, they never appear on Social, and the Coach receives only what is listed in section 7. 2J is a training tool: its suggestions are not medical advice and do not replace a doctor or physiotherapist.

## 7. Artificial intelligence

AI acts only when the member or a member of staff asks for it, and the screen tells the user when AI is involved. What it returns is a proposal: nothing is applied without the member or the professional reviewing it, and it is not medical advice. Without AI the app still works: progression, swaps and the Intelligence suggestions are calculated by the app itself.

| Function | Who starts it | Provider | What it receives | Consent |
|---|---|---|---|---|
| Coach: plan, review, explanations | the member | the configured provider: Anthropic Claude, OpenAI Codex, Google Gemini or OpenAI | a pseudonymous identifier, language and units, gym equipment, the plan, recent logged sets, effort and records (up to 12 weeks), weigh-ins and goal, the intake the member writes (goal, days, limitations, likes, notes), age, sex and height | specific Coach consent, revocable; turning it off discards what the Coach holds |
| Routine drafts | a trainer | Anthropic Claude | the member's current routines and programs and the trainer's brief (for example goal, experience, days per week); no workout history, profile, name or measurements | the member's separate consent to **Staff AI tools** (Settings → Data), not the Coach consent; checked by the server before anything is built or sent, and again when the job starts |
| Follow-up analysis | a trainer | Anthropic Claude | compact calculated facts about the follow-up, without names, identifiers or notes; labelled as written by AI | the same Staff AI tools consent; without it only the calculated analysis is shown |
| Scans: body-composition report, routine sheet, machine photo | the member (or staff for a member) | Google Gemini | the selected file, for that scan only | per-file confirmation (`external-ai-scan-v1`), enforced again by the API; cancelling reads and sends nothing |
| Import matching | the member importing a CSV | Google Gemini | exercise names from the file and 2J library names | optional feature |

**Never sent to AI:** health, activity, heart-rate and sleep data; WHOOP and Strava data; body-composition values and measurement tests; workout session notes; progress photos; messages, social and community content; the member's name and account identifier; credentials and push data.

The scan flow does not keep the file or the result: the member reviews the extracted values and saves them through the normal flow. What a provider does with data after receiving it depends on its own terms and 2J cannot delete it (LEGAL_TBD_AI_PROVIDER_TERMS).

## 8. External providers

| Provider | Used for | Receives | Optional? | Consent | Outside the EEA? |
|---|---|---|---|---|---|
| Google (Gemini API) | scans, import matching, Coach if set to Gemini | the file or text of that request | yes | per scan file; Coach consent | may involve it |
| Anthropic (Claude) | routine drafts and follow-up analysis by staff; Coach if set to Claude | see section 7 | yes | Coach consent for the Coach | may involve it |
| OpenAI | Coach only, if set to OpenAI or Codex | Coach data, section 7 | yes | Coach consent | may involve it |
| WHOOP | recovery, sleep, cycles, workouts, profile (read) | OAuth token kept on the server | yes | member authorizes in WHOOP | — |
| Strava | creates an activity per finished workout | name, start time, duration, total volume; token kept on the server | yes | member authorizes in Strava | — |
| Push services of the browser / phone vendor | notifications | notification text, device push address | yes | browser or phone permission | may involve it |
| Google Fonts | the web app's typeface | IP address, browser details | no (web version) | — | may involve it |
| jsDelivr | exercise images and animations in the standalone mobile build | IP address | no (mobile build) | — | — |
| Contabo (hosting) and the HTTPS certificate authority | running the service; backup copies are made on the server and within the hosting provider's infrastructure (no independent external backup provider) | the stored data | no | — | LEGAL_TBD_SERVER_LOCATION |

Health Connect and HealthKit are read on the device with the operating system's permission; 2J does not pass that data to anyone else. `Privacy.test.jsx` fails if the source starts talking to an outside host that this list does not cover.

## 9. International transfers

Some providers above may process data outside the European Economic Area. The legal safeguard for each (adequacy decision, standard contractual clauses or similar) has not been verified (LEGAL_TBD_TRANSFER_SAFEGUARDS), and the location of the hosting server is LEGAL_TBD_SERVER_LOCATION.

## 10. How long we keep it

- Account, training, body and follow-up data: until the member deletes the account or resets their data; no automatic expiry.
- Messages: until either participant's account is deleted (both lose the conversation).
- Notifications: latest 100 per person (5,000 in total); shares and reports: latest 5,000.
- Security events: bounded log of the latest 3,000; staff-access audit: the latest 1,000.
- Coach proposals not decided on expire after 14 days; scans keep nothing.
- Sign-in sessions: 90 days by default, or until sign-out everywhere.
- Backups: technical copies made on the server and within the hosting provider's infrastructure are not kept indefinitely; how often they are made (LEGAL_TBD_BACKUP_FREQUENCY) and how long they are kept (LEGAL_TBD_BACKUP_RETENTION) are still being verified.

## 11. Rights and how to exercise them

Access, rectification, erasure, restriction, portability and objection; withdrawal of any consent at any time; complaint to the data protection authority (in Spain, the AEPD).

- **Export** — Settings → Data → *Export my data*: one file with the account, synced state, follow-up answers, messages, friends, community posts, notifications, shares and Bunker PIN. It leaves out passkey keys and provider tokens, other people's text, the image files of progress photos (only their descriptions) and the private professional notes of staff. Access to those notes can be requested by writing to 2JFITNESSCENTER@GMAIL.COM; the answer may be limited when that is needed to protect the rights of other people, protected internal information or other legal limits.
- **Rectification** — edit the profile, measurements and plan in the app; staff can correct measurements and routines for the member; anything else by request.
- **Erasure** — Settings → Account → *Delete my account*; details in `docs/ACCOUNT_ERASURE.md`. Removed: account, passkeys, push subscriptions, recovery links, synced state, follow-up answers and progress photos, messages, friends, notifications, shares, Bunker PIN, community posts and comments, goals, challenges created, Coach record and uploaded images. Security events keep only anonymous facts (event, time, action). **What can remain:** copies in backups until they expire — restoring an old backup could bring back deleted data. Trainer and admin accounts cannot be deleted from the app; the gym administrator does it.
- **Connected apps** — deleting the account removes the WHOOP and Strava tokens kept here; the permission granted stays in those apps until revoked there, and activities already created in Strava stay in Strava. AI providers keep nothing that 2J can delete, because 2J stores no copy of what it sent.
- **Withdrawing consent** — turn the Coach off in the Coach; withdraw Staff AI tools in Settings → Data; do not confirm a scan; disconnect WHOOP or Strava in Settings (and revoke them in those apps); turn notifications off in Settings; withdraw Health Connect or HealthKit in the phone settings; change sharing choices in Social. Withdrawing does not affect what happened before.

## 12. Contact

To exercise any right or ask about the data: 2JFITNESSCENTER@GMAIL.COM. Requests are answered within one month, as the GDPR requires.

## Still being verified (`LEGAL_TBD_…`)

| Placeholder | What is needed |
|---|---|
| LEGAL_TBD_LEGAL_BASIS_REVIEW | validation by the advisor / DPO (SIREINSA) of the specific legal basis of each processing, and of whether any legal duty to keep membership records applies |
| LEGAL_TBD_DPO_CONTACT | a dedicated contact channel of SIREINSA, if it has one different from the privacy email |
| LEGAL_TBD_SERVER_LOCATION | where the Contabo server that hosts the app physically is |
| LEGAL_TBD_BACKUP_FREQUENCY | how often backup copies are made, only if an automated schedule really exists |
| LEGAL_TBD_BACKUP_RETENTION | how long backup copies are kept |
| LEGAL_TBD_TRANSFER_SAFEGUARDS | the transfer mechanism for each provider that may process outside the EEA, once provider, location and terms are verified |
| LEGAL_TBD_AI_PROVIDER_TERMS | the retention / training terms and data-processing agreements of the real AI provider accounts |

Decisions already taken and applied: trainer-side AI needs the member's separate Staff AI tools consent and sends nothing without it; staff's private professional notes stay out of the automatic export and are available on request to 2JFITNESSCENTER@GMAIL.COM, with the limits stated in section 11.

Open, handled separately: the web app loads its typeface from Google Fonts (an IP address reaches Google). Self-hosting the font is a separate micro-change.
