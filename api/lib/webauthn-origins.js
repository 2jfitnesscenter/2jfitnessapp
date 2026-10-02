// Origins accepted when verifying a WebAuthn response (register / login / recover).
//
// The web app signs with the page origin (ORIGIN, e.g. https://app.2jfitnesscenter.com). The Android shell
// (Capacitor WebView + Credential Manager) signs with "android:apk-key-hash:<base64url SHA-256 of the app's
// signing certificate>" instead. Only EXACT, pre-approved values are accepted: no wildcards and no "any
// android:apk-key-hash". rpID is unchanged and is still checked separately by the library.
//
// To add the RELEASE keystore later, keep the debug hash and append the release one, either here or without a
// code change through ANDROID_APK_KEY_HASHES (comma-separated base64url hashes):
//   keytool -list -v -keystore <release.jks>  → SHA256 (colon hex) → base64url of those 32 bytes
//   e.g. node -e "console.log(Buffer.from('0C:BB:...'.replace(/:/g,''),'hex').toString('base64url'))"
export const ANDROID_APK_KEY_HASHES = [
  'DLu_bybBDIMjVCyTrrPmGUTSkkZWCvidpoU2D3qDXqw',   // debug keystore, com.twojfitnesscenter.app
];
const HASH_SHAPE = /^[A-Za-z0-9_-]{43}$/;           // base64url of exactly 32 bytes, no padding

export const androidOrigin = hash => 'android:apk-key-hash:' + hash;

/** [web origin, ...android origins]; malformed hashes (wildcards, wrong length) are ignored. */
export function expectedOrigins(webOrigin, extraHashes = process.env.ANDROID_APK_KEY_HASHES || '') {
  const extra = String(extraHashes).split(',').map(s => s.trim()).filter(Boolean);
  const hashes = [...new Set([...ANDROID_APK_KEY_HASHES, ...extra])].filter(h => HASH_SHAPE.test(h));
  return [webOrigin, ...hashes.map(androidOrigin)];
}
