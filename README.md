# Vamus — Modern Mobile Music Experience

Vamus is a sleek, feature-rich music application for Android built with modern Web technologies, Python backend services, and Capacitor Android runtime integration.

<p align="center">
  <img src="app/src/main/res/mipmap-xxhdpi/ic_launcher.png" width="96" alt="Vamus Logo" />
</p>

---

## Key Features

- **Personalized Recommendations**: Dynamic "Recommended For You" music feed based on listening history and saved playlists.
- **Optional AI Music Discovery**: Integrated Google Gemini API support for AI-driven recommendations tailored to your taste.
- **Full Playback Engine**: Background playback support, interactive queue management, real-time lyrics overlay, audio controls, and rich media notifications.
- **Offline & Local Customization**: Custom wallpaper themes, user library storage, search suggestions, and playlists saved locally on device.
- **Modern Responsive Design**: Smooth glassmorphism interface with dark mode theme support.

---

## Project Architecture

```
android/
├── app/
│   └── src/
│       └── main/
│           ├── java/com/matej/vamus/   # Native Android Services (MediaPlayback, MainActivity)
│           ├── python/                  # Backend Python application logic & services
│           │   ├── static/              # Front-end UI (HTML, CSS, JS routing & components)
│           │   └── app.py               # Main Python app module
│           └── res/                     # Scaled Android drawable & launcher assets
└── dist/                                # Build output documentation
```

---

## Building & Running

### Prerequisites

- Android SDK (API Level 24+)
- JDK 17+
- Gradle (managed via `./gradlew`)

### Build Debug APK

```bash
./gradlew :app:assembleDebug
```

The compiled APK will be generated at:
`app/build/outputs/apk/debug/app-debug.apk`

---

## License & Usage

Distributed under standard terms. See repository file headers for individual component notes.
