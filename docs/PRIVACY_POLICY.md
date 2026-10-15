# 2J Fitness — privacy and data use

This document describes the current technical behavior of this self-hosted 2J Fitness application. It is an operational disclosure, not legal advice and not a determination of the legal basis, controller/processor roles, or retention duties applicable to a particular gym.

## Information and storage

The service processes account details, training plans and history, body measurements, follow-up records, social features, notifications, authentication/session records, and service configuration needed to provide the app. The server stores per-user synced state using the existing encrypted state-store mechanism; other service stores such as the account database and Social/Community stores follow their existing storage formats. The app does not claim that every server-side file is encrypted.

Some app flows also read activity and recovery data from Health Connect/HealthKit with operating-system permission, and may connect to WHOOP or Strava through their existing integrations. Health/native data are not sent to Coach AI or Social. Users can enter body measurements; a scan can extract values from a report, but the scan itself does not save them. The user or authorized staff must separately review and save values through the app's existing measurement workflow.

The web client keeps app state in browser storage and Sync V2 journal/recovery data locally. The standalone mobile build also writes `opengym-state.json` to the app's private device-data directory. These client-side copies are not encrypted by 2J itself. Users should protect access to their devices and browser profiles.

## Access

Members can access their own account and training data. Trainers have centre-wide operational access to member training and follow-up workflows; `assignedTrainers` is organizational metadata and does not restrict this access. Account roles, staff administration, security/operations, secrets, and sensitive global settings remain admin-only. Social visibility and sharing use their separate controls.

## AI and uploaded scan files

Coach, Trainer AI, and Auxiliary AI are separate features with separate access/configuration boundaries. The member-facing Coach can be configured for Anthropic Claude, OpenAI Codex, Google Gemini, or OpenAI; the trainer-panel AI currently uses Claude and follows its existing member-consent gate. With Coach consent, its minimized training context and permitted measurements can be sent to the selected provider. Community conversations and Health Connect/HealthKit data are excluded from that Coach payload.

Auxiliary AI uses Google Gemini for supported one-shot tasks. Before a selected body-composition report, routine document, or machine photo is read by the scan flow and sent to Gemini, the user must confirm a disclosure for that file. The API independently rejects scan requests without that per-action consent. The file is sent for that scan and the scan endpoint does not add the file or returned values to account storage. The caller can review extracted results and separately choose whether to save them through existing app flows. Cancelling the confirmation leaves the file unread and unsent by the scan flow. Do not submit a file that you do not want processed by Google Gemini.

The auxiliary-AI credential is stored using its existing encrypted server configuration. Operational job logs keep bounded status/counter information rather than scan prompt or file content.

## Health, deletion, and retention

Health Connect and HealthKit integrations read data on the device only after operating-system permission. WHOOP and Strava use their existing connected-account flows. Health, activity and recovery data are not sent to Coach AI or Social by the current app flows.

Members can export or delete their account through Settings. Deletion removes account-linked device sessions and anonymizes linked security-event records while retaining anonymous event/time/action facts for the security audit trail. Other account data is removed through the existing erasure flow. Existing operational backups may retain an earlier copy until their configured expiry; restoring such a backup can restore previously deleted data.

The application does not declare a universal retention period for all gym records. Active account data remains according to the configured service and account lifecycle; logs and backups use their separately configured limits.
