# 🎵 Vamus — Modern Mobile Music Experience

<p align="center">
  <img src="app/src/main/res/mipmap-xxhdpi/ic_launcher.png" width="96" alt="Vamus Logo" /><br><br>
  <a href="https://github.com/vasosofuji/vamus-apk/raw/main/vamus-latest.apk">
    <img src="https://img.shields.io/badge/📥_Download_Latest_APK-v1.0.18-1DB954?style=for-the-badge&logo=android&logoColor=white" alt="Download Latest APK" />
  </a>
</p>

**Vamus** is a high-performance, feature-rich Android music application designed for seamless playback, rich customization, and instant streaming. Built with a modern web interface, a local Python Flask backend, and native Android Media3 ExoPlayer integration, Vamus provides a fluid, ad-free listening experience.

---

## ✨ Features

- ⚡ **Instant Playback & Zero-Delay Scrubbing**: Powered by an ExoPlayer 250 MB LRU disk cache and backend stream URL pre-fetching, seeking through songs is near-instantaneous.
- 🔁 **Full Queue & Repeat Control**: Interactive play queue with drag-to-reorder, shuffle that never repeats a track within a pass, Repeat One (`'one'`), and Repeat All (`'all'`).
- 👆 **Long-Press Track Menu**: Hold any track for Play, Add to Queue, Like, Add to Playlist, Download for Offline, and Go to Artist.
- 🎨 **Carousel Media Player**: Fullscreen player with swipe carousel gesture controls and pre-loaded album cover artwork previews.
- 🎤 **Synchronized Lyrics**: Real-time lyrics overlay for supported tracks, with a plain-lyrics fallback when no synced version exists.
- ✈️ **Offline Downloads**: Save tracks to device storage for travel and play them with no connection, managed from a dedicated Offline Downloads screen.
- 👉 **Swipe to Queue**: Swipe a track row to the right to drop it straight into the play queue.
- 🖌️ **Custom Themes & Wallpapers**: Six built-in themes (Vamus Dark, OLED Black, Sunset Crimson, Lavender Dream, Emerald Forest, Electric Amber), a full custom color palette with a color wheel, adjustable glassmorphism blur, and custom background wallpapers.
- 📦 **Data Backup & Restore**: One-click JSON Export & Import inside Settings to safeguard your playlists, liked songs, and settings.
- 🤖 **Optional AI Recommendations**: Opt-in Google Gemini API key integration for AI-curated music recommendations based on your listening history.
- 🛠️ **Developer Options**: Opt-in floating diagnostic button (`🐞`) and real-time logging panel for debugging.

---

## 📱 User Guide: How to Use Vamus

### 1. Navigating the App
Use the bottom navigation bar to switch between main views:
- **Home (`/`)**: Browse "Recommended For You", popular playlists, top artists, and recent tracks.
- **Search (`/search`)**: Search for songs, artists, or playlists with instant suggestions and search filters.
- **Library (`/library`)**: Access your Liked Songs, custom Playlists, and Recently Played history.
- **Settings (`/settings`)**: Customize app appearance, playback settings, AI options, server endpoints, and data backups.

### 2. Playback & Media Controls
- **Play / Pause**: Tap the central Play button on the bottom mini-player bar or the full player screen.
- **Next / Previous**: Skip tracks using the control buttons or swipe left/right on the album cover carousel in the full player overlay.
- **Shuffle**: Tap the Shuffle button (`🔀`) to randomly order queue tracks.
- **Repeat Modes**: Tap the Repeat button (`🔁`) to cycle between:
  - **Repeat Off (`none`)**: Plays through the queue once, then triggers auto-radio.
  - **Repeat All (`all`)**: Loops the queue or playlist infinitely.
  - **Repeat One (`one`)**: Replays the current track when it ends. The Next
    button still moves on to the following track.

> [!TIP]
> Starting a song from the middle of a playlist continues with the tracks that
> follow it. Tapping a one-off song (a search result, a recommendation) plays
> just that song without pulling the surrounding list into your queue.

### 3. Creating & Managing Playlists
1. Go to **Library** → **Playlists** → **Create New Playlist**.
2. To add songs: press and hold any track row and choose **Add to Playlist**.
3. Customize playlist cover images, colors, and descriptions anytime.

### 4. Track Actions (Long Press)
Press and hold any track row or Recently Played card to open its context menu:
**Play Song**, **Add to Queue**, **Like Song**, **Add to Playlist**,
**Download for Offline**, and **Go to Artist** where available.

### 5. Backing Up & Restoring Your Data
To ensure you never lose your playlists or liked songs:
1. Go to **Settings** → **Data Management & Danger Zone**.
2. Tap **📥 Export Backup** to download a `vamus_backup_YYYY-MM-DD.json` file.
3. Tap **📤 Import Backup** anytime to restore your data on any device or clean installation.

---

## 🛠️ Building & Installation

### Prerequisites
- **Android SDK**: API Level 24+ (Android 7.0+)
- **JDK**: Java Development Kit 17+
- **Gradle**: Managed automatically via `./gradlew`

### Building the Debug APK

Run the following command in your terminal:

```bash
./gradlew :app:assembleDebug
```

The compiled APK will be generated at:
`app/build/outputs/apk/debug/app-debug.apk`

### Updating the App Without Losing Data
When installing an updated APK over an existing version on your Android device:
1. Keep the `applicationId` (`com.matej.vamus`) identical in `app/build.gradle`.
2. Build the update APK with the same signing key/keystore.
3. Increment `versionCode` in `app/build.gradle` (e.g. `versionCode 1` → `versionCode 2`).
4. Install the new APK over the existing app. Android will preserve all your playlists, history, and settings in-place!

---

## 🏗️ Project Architecture

```
android/
├── app/
│   └── src/
│       └── main/
│           ├── assets/public/           # Web frontend the WebView actually loads (build copy, gitignored)
│           ├── java/com/matej/vamus/    # Native Android services (ExoPlayer MediaPlaybackService, MainActivity)
│           ├── python/                  # Backend Python application logic & Flask APIs
│           │   ├── static/              # Tracked copy of the web frontend (HTML, CSS, JS, Store, Player)
│           │   └── app.py               # Main Python app module
│           └── res/                     # Scaled Android drawable & launcher assets
└── build.gradle                         # Gradle app dependencies & Python configuration
```

> [!NOTE]
> **The frontend lives in two places.** Capacitor serves the UI from `assets/public/`
> (gitignored build copy), while `python/static/` is the version tracked in git and
> bundled with the Flask backend. Editing only one of them is the most common way to
> make a change that appears to do nothing — keep both in sync.

At runtime `MainActivity` starts the Flask app via Chaquopy on `127.0.0.1:5000`, which
serves the API; audio playback is handled natively by Media3 ExoPlayer.

---

## ⚖️ Legal Disclaimer & Copyright Notice

> [!IMPORTANT]
> **Please read the following legal terms carefully before using or distributing Vamus.**

### 1. Non-Commercial & Educational Purpose Only
Vamus is an open-source software project created strictly for **personal, non-commercial, and educational purposes**. It is not designed, intended, or licensed to generate revenue, display commercial advertising, or engage in commercial distribution of media.

### 2. No Content Hosting or Media Storage
Vamus does **not** host, store, archive, transmit, upload, or re-broadcast any copyrighted music, audio files, or video streams on its servers or within the repository. All search results, stream links, and metadata are indexed dynamically from publicly accessible third-party APIs and public web platforms.

### 3. Fair Use & Third-Party Indexing
All media indexing, stream playback, and metadata retrieval functions within Vamus operate as a client-side interface tool for user convenience. Users are solely responsible for compliance with local copyright laws and third-party terms of service applicable in their jurisdiction.

### 4. Trademark Attributions
- **YouTube** and **YouTube Music** are registered trademarks of **Google LLC** (a subsidiary of **Alphabet Inc.**).
- **Google Gemini** is a trademark of **Google LLC**.
- Vamus is an independent open-source project and is **not** affiliated with, sponsored by, endorsed by, or associated with Google LLC, Alphabet Inc., or any of their subsidiaries or partners.

### 5. Notice & Takedown Policy (DMCA)
If you are a copyright owner or an agent thereof and believe that any metadata indexing or link within this project infringes upon your copyright rights, please submit a formal notification to the repository maintainer. Upon receipt of valid notice, appropriate action will be taken promptly.
