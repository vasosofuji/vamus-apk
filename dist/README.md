# Vamus — Prebuilt APK

**File:** `vamus-1.0-debug.apk` (versionName 1.0, versionCode 1)

## About this build
- Debug build, signed with the standard Android debug key — installable by
  sideloading (enable "Install unknown apps" for your browser/file manager).
- ABIs: `arm64-v8a` (most phones) and `x86_64` (emulators).
- **No API keys or secrets are bundled.** The `.env` used in development is
  excluded from the packaged Python assets.

## AI recommendations are optional
Out of the box the home screen shows **Recommended For You**, built from your
own playlists and listening history — no account or API key required.

If you want the extra **AI Picks For You** row, add your own Google Gemini API
key under **Settings → Gemini API Key**. The key is stored only on your device
and sent only to Google's API from your device.

## Rebuilding
```
./gradlew :app:assembleDebug
```
Output: `app/build/outputs/apk/debug/app-debug.apk`.
