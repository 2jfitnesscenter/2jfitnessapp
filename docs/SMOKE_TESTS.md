# Pre-deploy smoke tests (CSP and web-tier changes)

The enforced Content-Security-Policy is in `web/nginx.conf` and the web image must be rebuilt for it to apply. After a deploy, on `https://app.2jfitnesscenter.com`
with DevTools → Console open (any "Refused to …" / "violates the following Content Security Policy" line is a failure). Roll back with the runner if anything below fails.

| # | Check | Pass when |
|---|---|---|
| 1 | Response headers (`curl -sI https://app.2jfitnesscenter.com/`) | `Content-Security-Policy`, `Permissions-Policy`, HSTS, nosniff, X-Frame-Options, Referrer-Policy present |
| 2 | Login with passkey (browser) and create-profile screen | passkey sheet opens, login succeeds, no CSP errors |
| 3 | Exercise images and GIFs (Library → any exercise; start a workout) | still shows, GIF animates, tap toggles to still |
| 4 | Google Fonts (Sora headline on Home/Progress) | headline renders in Sora; fonts.googleapis.com / fonts.gstatic.com allowed |
| 5 | Share an image (finish a workout → Share; Progress → 2J Story → Share/Save) | PNG generated and shared/downloaded |
| 6 | PDF / print export (Library → routine → export/print) | print window opens with content (blob: frame allowed) |
| 7 | PWA / service worker | `Application → Service Workers` active; reload offline shows the app shell; update of a new build applies after closing tabs |
| 8 | Web Push (Settings → Notifications → enable → send test) | notification arrives; clicking it opens the app |
| 9 | Heart-rate strap (Chrome Android, optional) | Bluetooth permission prompt works (`bluetooth=(self)`) |
| 10 | Android bridge (installed APK): login with passkey, Settings → Health connects, a workout is exported | works as before (the shell loads this same origin) |
| 11 | Chat: open a thread, send a message, reload (after deploy the first boot converts `chat.json`) | history intact; `data/chat.json` no longer starts with `{` |
| 12 | Settings → Export my data downloads a JSON; (on a throw-away account) Delete my account asks username + passkey | export has content; deletion removes the profile and signs out |
| 13 | Trainer AI on a member WITHOUT Coach consent | refused with the consent message, nothing sent |
