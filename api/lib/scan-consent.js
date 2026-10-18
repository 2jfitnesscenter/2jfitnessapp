// Per-action acknowledgement for one-shot AI document scans. This is intentionally not stored:
// the client only sends it after the user accepts the disclosure for the selected file.
export const AI_SCAN_CONSENT = 'external-ai-scan-v1';

export const hasAiScanConsent = body => body?.externalAiConsent === AI_SCAN_CONSENT;
