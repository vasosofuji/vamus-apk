package com.matej.vamus;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.JavascriptInterface;

import com.chaquo.python.Python;
import com.chaquo.python.android.AndroidPlatform;
import com.getcapacitor.BridgeActivity;

import java.io.InputStream;
import java.net.URL;

public class MainActivity extends BridgeActivity {
    private static MainActivity instance;
    private MediaSession mediaSession;
    private PlaybackState.Builder stateBuilder;
    private NotificationManager notificationManager;
    private final String CHANNEL_ID = "vamus_media_channel";
    private final int NOTIFICATION_ID = 1001;

    private String currentTitle = "";
    private String currentArtist = "";
    private String currentThumbUrl = "";
    private long currentDurationMs = 0;
    private Bitmap currentArtwork = null;
    private Notification lastNotification;

    // Native mirror of the JS queue, so playback keeps advancing correctly
    // while the WebView JS is throttled (screen off / activity backgrounded).
    // The advance logic lives in PlaybackQueue so it can be tested off-device.
    private final PlaybackQueue playbackQueue = new PlaybackQueue();

    public Notification getLastNotification() {
        return lastNotification;
    }

    public PlaybackQueue getPlaybackQueue() {
        return playbackQueue;
    }

    public PlaybackQueue.Result consumeNextTrackInfo() {
        return playbackQueue.consumeNext();
    }

    /** Pushes a playback state from native (transport controls) to the session. */
    public void publishPlaybackState(final boolean isPlaying, final long posMs, final long durMs) {
        runOnUiThread(new Runnable() {
            @Override public void run() { updateNativePlaybackState(isPlaying, posMs, durMs); }
        });
    }

    private static java.util.List<PlaybackQueue.Track> parseTracks(String json) {
        java.util.List<PlaybackQueue.Track> out = new java.util.ArrayList<>();
        if (json == null || json.isEmpty()) return out;
        try {
            org.json.JSONArray arr = new org.json.JSONArray(json);
            for (int i = 0; i < arr.length(); i++) {
                org.json.JSONObject o = arr.getJSONObject(i);
                String id = o.optString("id", "");
                if (id.isEmpty()) continue;
                out.add(new PlaybackQueue.Track(
                        id,
                        o.optString("streamUrl", ""),
                        o.optString("title", ""),
                        o.optString("artist", ""),
                        o.optString("thumbnail", "")
                ));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return out;
    }

    public static MainActivity getInstance() {
        return instance;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        instance = this;
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            android.view.Window window = getWindow();
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                window.setNavigationBarContrastEnforced(false);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            );
        }

        if (bridge != null && bridge.getWebView() != null) {
            android.webkit.WebSettings webSettings = bridge.getWebView().getSettings();
            webSettings.setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            webSettings.setDomStorageEnabled(true);
            webSettings.setAllowFileAccess(true);
            webSettings.setAllowContentAccess(true);
        }

        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Python py = Python.getInstance();
                    py.getModule("app").callAttr("start_server", "127.0.0.1", 5000);
                } catch (Exception e) {
                    android.util.Log.e("VamusPython", "Failed to start Python server", e);
                }
            }
        }).start();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 101);
            }
        }

        setupMediaSession();

        handleIntentAction(getIntent());

        getOnBackPressedDispatcher().addCallback(this, new androidx.activity.OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                triggerJsEvent("if (typeof handleBackButton === 'function') { handleBackButton(); } else { window.history.back(); }");
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntentAction(intent);
    }

    /**
     * Transport actions are handled by MediaPlaybackService now, so nothing
     * here reacts to them. Kept as the hook for any future launch intents.
     */
    private void handleIntentAction(Intent intent) {
        // no-op
    }

    private void setupMediaSession() {
        mediaSession = new MediaSession(this, "VamusMediaSession");
        stateBuilder = new PlaybackState.Builder()
                .setActions(
                        PlaybackState.ACTION_PLAY |
                        PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE |
                        PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS |
                        PlaybackState.ACTION_SEEK_TO
                );
        // Initialize with a real STATE so the first notification we build is
        // valid enough for FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK on Android 14+.
        stateBuilder.setState(PlaybackState.STATE_PAUSED, 0, 0f);
        mediaSession.setPlaybackState(stateBuilder.build());

        mediaSession.setCallback(new MediaSession.Callback() {
            // Lock screen, Bluetooth and car head units land here. These must
            // act on the player directly: routing them into the WebView meant
            // they silently did nothing whenever it was throttled, then all
            // fired at once when the app came back to the foreground.
            @Override public void onPlay() { transport("ACTION_PLAY_PAUSE"); }
            @Override public void onPause() { transport("ACTION_PLAY_PAUSE"); }
            @Override public void onSkipToNext() { transport("ACTION_NEXT"); }
            @Override public void onSkipToPrevious() { transport("ACTION_PREV"); }
            @Override public void onStop() {
                MediaPlaybackService svc = MediaPlaybackService.getInstance();
                if (svc != null) svc.pausePlayback();
            }
            @Override public void onSeekTo(long pos) {
                // Seek natively only. Forwarding this into the WebView issued a
                // second identical seek, and while the WebView is throttled the
                // forwarded call could land after the track had auto-advanced
                // and drag the *new* track to the old position. JS reads the
                // position back from native on its own ticker anyway.
                MediaPlaybackService svc = MediaPlaybackService.getInstance();
                if (svc != null) svc.seekTo((int) pos);
            }
        });

        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setActive(true);

        notificationManager = (NotificationManager) getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Media Control",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("System Media Notification Controls");
            notificationManager.createNotificationChannel(channel);
        }

        this.bridge.getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void updateMetadata(final String title, final String artist, final String thumbUrl) {
                updateMetadata(title, artist, thumbUrl, 0);
            }

            @JavascriptInterface
            public void updateMetadata(final String title, final String artist, final String thumbUrl, final long durationMs) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { updateNativeMetadata(title, artist, thumbUrl, durationMs); }
                });
            }

            @JavascriptInterface
            public void updatePlaybackState(final boolean isPlaying, final long positionMs) {
                updatePlaybackState(isPlaying, positionMs, 0);
            }

            @JavascriptInterface
            public void updatePlaybackState(final boolean isPlaying, final long positionMs, final long durationMs) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { updateNativePlaybackState(isPlaying, positionMs, durationMs); }
                });
            }

            @JavascriptInterface
            public void playUri(final String url, final String trackId,
                                final boolean fromHistory,
                                final boolean isCrossfade, final int crossfadeDurationMs) {
                // Record which track the WebView just started, and whether this
                // was a forward move or the Previous button. Without this,
                // native could not tell a fresh context push from a stale one
                // that had been sitting in the queue while the app slept, and
                // a rewind corrupted the history the car controls share.
                playbackQueue.setCurrent(trackId, null, fromHistory);
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        // Ensure the service exists as a foreground service before we try
                        // to play. On the first tap, the service instance may still be
                        // null; scheduling the play until it comes up avoids a silent
                        // no-op or a 5-second-startForeground crash.
                        ensureServiceStarted(new Runnable() {
                            @Override
                            public void run() {
                                MediaPlaybackService svc = MediaPlaybackService.getInstance();
                                if (svc != null) {
                                    svc.play(url, isCrossfade, crossfadeDurationMs);
                                }
                            }
                        });
                    }
                });
            }

            @JavascriptInterface
            public void pausePlayback() {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        MediaPlaybackService svc = MediaPlaybackService.getInstance();
                        if (svc != null) svc.pausePlayback();
                    }
                });
            }

            @JavascriptInterface
            public void resumePlayback() {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        MediaPlaybackService svc = MediaPlaybackService.getInstance();
                        if (svc != null) svc.resumePlayback();
                    }
                });
            }

            @JavascriptInterface
            public void seekTo(final int positionMs) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        MediaPlaybackService svc = MediaPlaybackService.getInstance();
                        if (svc != null) svc.seekTo(positionMs);
                    }
                });
            }

            @JavascriptInterface
            public void setVolume(final float volume) {
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        MediaPlaybackService svc = MediaPlaybackService.getInstance();
                        if (svc != null) svc.setVolume(volume);
                    }
                });
            }

            @JavascriptInterface
            public int getCurrentPosition() {
                MediaPlaybackService svc = MediaPlaybackService.getInstance();
                return svc != null ? svc.getCurrentPosition() : 0;
            }

            @JavascriptInterface
            public int getDuration() {
                MediaPlaybackService svc = MediaPlaybackService.getInstance();
                return svc != null ? svc.getDuration() : 0;
            }

            /**
             * Whether audio is actually playing. Transport controls can change
             * this while the WebView is asleep, so JS reconciles against it
             * rather than trusting its own last-known flag.
             */
            @JavascriptInterface
            public boolean isPlayingNative() {
                MediaPlaybackService svc = MediaPlaybackService.getInstance();
                return svc != null && svc.isPlayingNow();
            }

            /**
             * Pre-computed next track info pushed from JS so the native
             * completion handler can advance without a JS round-trip.
             * Called with (null, null, null, null, null) to clear.
             */
            @JavascriptInterface
            public void setNextTrackInfo(final String trackId, final String streamUrl,
                                        final String title, final String artist,
                                        final String thumbnail) {
                // setPendingNext treats a blank stream URL as "clear".
                playbackQueue.setPendingNext(new PlaybackQueue.Track(
                        trackId, streamUrl, title, artist, thumbnail));
            }

            /**
             * Pushes the full playback context so native can keep advancing on
             * its own even while the WebView JS is frozen (screen off).
             *
             * `queueJson`   — tracks still to play, current excluded.
             * `contextJson` — the complete list the queue came from. Repeat All
             *                 wraps around this; passing only the shrinking
             *                 upcoming queue made each lap shorter than the last
             *                 until it looped a single track forever.
             * `autoplay`    — mirrors the user's Autoplay setting, so native
             *                 stops instead of inventing a song when it is off.
             *
             * Both arrays are JSON: {id, title, artist, thumbnail, streamUrl}.
             */
            @JavascriptInterface
            public boolean setPlaybackContext(final String queueJson,
                                              final String contextJson,
                                              final String currentTrackId,
                                              final String repeat,
                                              final boolean shuffle,
                                              final boolean autoplay) {
                // Returns false when the push was stale and the queue part was
                // dropped, so JS knows not to remember it as delivered.
                return playbackQueue.setContext(parseTracks(queueJson), parseTracks(contextJson),
                        currentTrackId, repeat, shuffle, autoplay);
            }

            /** Real installed version, so About can stop hardcoding one. */
            @JavascriptInterface
            public String getAppVersion() {
                try {
                    android.content.pm.PackageInfo pi =
                            getPackageManager().getPackageInfo(getPackageName(), 0);
                    long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                            ? pi.getLongVersionCode() : pi.versionCode;
                    return pi.versionName + " (" + code + ")";
                } catch (Exception e) {
                    return "";
                }
            }

            @JavascriptInterface
            public void exitApp() {
                runOnUiThread(new Runnable() {
                    @Override public void run() { finish(); }
                });
            }
        }, "AndroidMediaSession");
    }

    /**
     * Ensures the MediaPlaybackService is created and promoted to foreground
     * before running `then`. If the service instance already exists, `then`
     * runs immediately. Otherwise we startForegroundService with the current
     * media notification and poll (on the UI thread) until it comes up.
     */
    private void ensureServiceStarted(final Runnable then) {
        if (MediaPlaybackService.getInstance() != null) {
            promoteServiceForeground();
            then.run();
            return;
        }

        // Make sure we have a valid MediaStyle notification to promote with.
        Notification notification = buildNotification(true);
        this.lastNotification = notification;

        Intent serviceIntent = new Intent(this, MediaPlaybackService.class);
        serviceIntent.setAction("START_FOREGROUND");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Poll for the service instance for up to ~2 seconds, then run `then`.
        pollForService(then, 20);
    }

    private void pollForService(final Runnable then, final int attemptsLeft) {
        MediaPlaybackService svc = MediaPlaybackService.getInstance();
        if (svc != null) {
            promoteServiceForeground();
            then.run();
            return;
        }
        if (attemptsLeft <= 0) {
            // Give up gracefully — running then anyway will safely no-op.
            then.run();
            return;
        }
        this.bridge.getWebView().postDelayed(new Runnable() {
            @Override public void run() { pollForService(then, attemptsLeft - 1); }
        }, 100);
    }

    private void promoteServiceForeground() {
        MediaPlaybackService svc = MediaPlaybackService.getInstance();
        if (svc == null) return;
        if (lastNotification == null) {
            lastNotification = buildNotification(true);
        }
        svc.promoteToForeground(lastNotification);
    }

    public void triggerJsEvent(final String jsCode) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (bridge != null && bridge.getWebView() != null) {
                    try {
                        bridge.getWebView().evaluateJavascript(jsCode, null);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            }
        });
    }

    public void updateNativeDuration(final long durationMs) {
        if (durationMs <= 0 || durationMs == currentDurationMs) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                currentDurationMs = durationMs;
                setMetadataOnSession();
            }
        });
    }

    private void updateNativePlaybackState(boolean isPlaying, long positionMs) {
        updateNativePlaybackState(isPlaying, positionMs, 0);
    }

    private void updateNativePlaybackState(boolean isPlaying, long positionMs, long durationMs) {
        if (mediaSession == null || stateBuilder == null) return;
        if (durationMs > 0 && durationMs != currentDurationMs) {
            currentDurationMs = durationMs;
            setMetadataOnSession();
        }
        int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        stateBuilder.setState(state, positionMs, isPlaying ? 1.0f : 0.0f, SystemClock.elapsedRealtime());
        mediaSession.setPlaybackState(stateBuilder.build());

        showOrUpdateNotification(isPlaying);
    }

    private void updateNativeMetadata(final String title, final String artist, final String thumbUrl) {
        updateNativeMetadata(title, artist, thumbUrl, 0);
    }

    private void updateNativeMetadata(final String title, final String artist, final String thumbUrl, final long durationMs) {
        if (mediaSession == null) return;
        currentTitle = title != null ? title : "";
        currentArtist = artist != null ? artist : "";
        currentThumbUrl = thumbUrl != null ? thumbUrl : "";
        if (durationMs > 0) {
            currentDurationMs = durationMs;
        } else {
            currentDurationMs = 0;
        }
        currentArtwork = null;

        setMetadataOnSession();
        final boolean isPlaying = stateBuilder != null
                && stateBuilder.build().getState() == PlaybackState.STATE_PLAYING;
        showOrUpdateNotification(isPlaying);

        if (thumbUrl != null && (thumbUrl.startsWith("http://") || thumbUrl.startsWith("https://"))) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        InputStream in = new URL(thumbUrl).openStream();
                        final Bitmap bmp = BitmapFactory.decodeStream(in);
                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                currentArtwork = bmp;
                                setMetadataOnSession();
                                showOrUpdateNotification(isPlaying);
                            }
                        });
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            }).start();
        }
    }

    /**
     * Applies metadata for a next track that native selected on its own
     * (screen-off autoplay path). Also drives the notification/mediaSession
     * so lock-screen controls immediately show the right thing.
     */
    public void applyPendingNextMetadata(final PlaybackQueue.Track next) {
        if (next == null) return;
        playbackQueue.adoptExternal(next);
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                updateNativeMetadata(next.title, next.artist, next.thumbnail, 0);
                updateNativePlaybackState(true, 0, 0);
            }
        });
    }

    private void setMetadataOnSession() {
        if (mediaSession == null) return;
        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist);

        long dur = currentDurationMs;
        if (dur <= 0) {
            MediaPlaybackService svc = MediaPlaybackService.getInstance();
            if (svc != null) {
                dur = svc.getDuration();
            }
        }
        if (dur > 0) {
            metaBuilder.putLong(MediaMetadata.METADATA_KEY_DURATION, dur);
        }

        if (currentArtwork != null) {
            metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, currentArtwork);
        }
        mediaSession.setMetadata(metaBuilder.build());
    }

    private Notification buildNotification(boolean isPlaying) {
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Action prevAction = new Notification.Action.Builder(
                android.R.drawable.ic_media_previous, "Previous",
                createPlaybackPendingIntent("ACTION_PREV")
        ).build();

        Notification.Action playPauseAction = new Notification.Action.Builder(
                isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                isPlaying ? "Pause" : "Play",
                createPlaybackPendingIntent("ACTION_PLAY_PAUSE")
        ).build();

        Notification.Action nextAction = new Notification.Action.Builder(
                android.R.drawable.ic_media_next, "Next",
                createPlaybackPendingIntent("ACTION_NEXT")
        ).build();

        Notification.Builder builder = new Notification.Builder(this)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .addAction(prevAction)
                .addAction(playPauseAction)
                .addAction(nextAction)
                .setStyle(new Notification.MediaStyle()
                        .setShowActionsInCompactView(0, 1, 2)
                        .setMediaSession(mediaSession.getSessionToken()))
                .setContentTitle(currentTitle.isEmpty() ? "Vamus" : currentTitle)
                .setContentText(currentArtist)
                .setContentIntent(pendingIntent)
                .setOngoing(isPlaying);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(CHANNEL_ID);
        }

        if (currentArtwork != null) {
            builder.setLargeIcon(currentArtwork);
        }

        return builder.build();
    }

    // Identity of whatever the posted notification currently shows. JS pushes a
    // playback-state update every 250ms; rebuilding + re-posting the
    // notification on each one burned battery and made the media control
    // visibly flicker. Position lives in the PlaybackState (which we still
    // update every tick and which is cheap), not in the notification.
    private String lastNotificationKey = null;

    private void showOrUpdateNotification(boolean isPlaying) {
        if (mediaSession == null) return;

        String key = isPlaying + "|" + currentTitle + "|" + currentArtist
                + "|" + (currentArtwork != null);
        MediaPlaybackService svcCheck = MediaPlaybackService.getInstance();
        boolean needsForegroundPromotion = isPlaying && (svcCheck == null || !svcCheck.isForegroundActive());
        if (key.equals(lastNotificationKey) && !needsForegroundPromotion) {
            return;
        }
        lastNotificationKey = key;

        Notification notification = buildNotification(isPlaying);
        this.lastNotification = notification;

        MediaPlaybackService svc = MediaPlaybackService.getInstance();

        if (isPlaying) {
            if (svc == null) {
                // Service isn't up yet — start it as a foreground service. The
                // ensureServiceStarted path (called from playUri) usually beats
                // us to it, but if updatePlaybackState is called on its own we
                // still want the notification live.
                Intent serviceIntent = new Intent(this, MediaPlaybackService.class);
                serviceIntent.setAction("START_FOREGROUND");
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(serviceIntent);
                    } else {
                        startService(serviceIntent);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            } else {
                svc.promoteToForeground(notification);
            }
        }
        // When !isPlaying we deliberately DO NOT start or restart the service.
        // Just push the updated (paused) notification via NotificationManager.

        try {
            notificationManager.notify(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private PendingIntent createPlaybackPendingIntent(String action) {
        Intent intent = new Intent(this, MediaPlaybackService.class);
        intent.setAction(action);
        // getService, not getActivity: these are transport buttons, and an
        // Activity PendingIntent brought the whole app to the foreground every
        // time the user tapped Next on the notification.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return PendingIntent.getForegroundService(
                    this, action.hashCode(), intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        return PendingIntent.getService(
                this, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Forwards a transport action to the playback service. */
    private void transport(String action) {
        MediaPlaybackService svc = MediaPlaybackService.getInstance();
        if (svc == null) return;
        switch (action) {
            case "ACTION_NEXT": svc.skipToNext(); break;
            case "ACTION_PREV": svc.skipToPrevious(); break;
            default: svc.togglePlayPause(); break;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().evaluateJavascript(
                    "if (typeof handleBackButton === 'function') { handleBackButton(); } else { window.history.back(); }",
                    null
            );
        } else {
            super.onBackPressed();
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
        }
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }

        try {
            Intent serviceIntent = new Intent(this, MediaPlaybackService.class);
            serviceIntent.setAction("STOP_FOREGROUND");
            startService(serviceIntent);
        } catch (Exception e) {
            e.printStackTrace();
        }

        super.onDestroy();
    }
}
