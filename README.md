# 🎵 Vamus — Modern Mobile Music Experience

<p align="center">
  <img src="app/src/main/res/mipmap-xxhdpi/ic_launcher.png" width="96" alt="Vamus Logo" />
</p>

**Vamus** is a high-performance, feature-rich Android music application designed for seamless playback, rich customization, and instant streaming. Built with a modern web interface, a local Python Flask backend, and native Android Media3 ExoPlayer integration, Vamus provides a fluid, ad-free listening experience.

---

## ✨ Features

- ⚡ **Instant Playback & Zero-Delay Scrubbing**: Powered by an ExoPlayer 250 MB LRU disk cache and backend stream URL pre-fetching, seeking through songs is near-instantaneous.
- 🔁 **Full Queue & Repeat Control**: Support for interactive play queues, intelligent shuffle (consumes queue items without duplicates), Repeat One (`'one'`), and Repeat All (`'all'`).
- 🎨 **Carousel Media Player**: Fullscreen player with swipe carousel gesture controls and pre-loaded album cover artwork previews.
- 🎤 **Synchronized Lyrics**: Real-time lyrics overlay for supported tracks.
- 🖌️ **Custom Themes & Wallpapers**: Personalized themes (Electric Amber, Cyberpunk Neon, Emerald, Spotify Dark), custom color pickers, adjustable glassmorphism blur, and custom background wallpapers.
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
  - **Repeat One (`one`)**: Continuously replays the current track until toggled off.

### 3. Creating & Managing Playlists
1. Go to **Library** $\rightarrow$ **Playlists** $\rightarrow$ **Create New Playlist**.
2. To add songs: tap the `⋮` menu on any track card or row and select **Add to Playlist**.
3. Customize playlist cover images, colors, and descriptions anytime.

### 4. Backing Up & Restoring Your Data
To ensure you never lose your playlists or liked songs:
1. Go to **Settings** $\rightarrow$ **Data Management & Danger Zone**.
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
3. Increment `versionCode` in `app/build.gradle` (e.g. `versionCode 1` $\rightarrow$ `versionCode 2`).
4. Install the new APK over the existing app. Android will preserve all your playlists, history, and settings in-place!

---

## 🏗️ Project Architecture

```
android/
├── app/
│   └── src/
│       └── main/
│           ├── java/com/matej/vamus/   # Native Android Services (ExoPlayer MediaPlaybackService, MainActivity)
│           ├── python/                  # Backend Python application logic & Flask APIs
│           │   ├── static/              # Web Frontend (HTML, CSS, JS routing, Store, & Player)
│           │   └── app.py               # Main Python app module
│           └── res/                     # Scaled Android drawable & launcher assets
└── build.gradle                         # Gradle app dependencies & Python configuration
```

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
