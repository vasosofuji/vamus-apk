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
    private Bitmap currentArtwork = null;
    private Notification lastNotification;

    // Pre-computed next-track info pushed from JS. The service consumes this
    // when the current track ends so autoplay works even if the WebView JS
    // is throttled (screen off / activity backgrounded).
    private volatile MediaPlaybackService.NextTrackInfo pendingNextTrack;

    // Full native mirror of the JS queue so native can keep advancing while
    // the WebView JS is throttled.
    private final java.util.List<MediaPlaybackService.NextTrackInfo> nativeQueue = new java.util.ArrayList<>();
    private volatile String nativeCurrentTrackId = null;
    private volatile String nativeRepeat = "none"; // "none" | "all" | "one"
    private volatile boolean nativeShuffle = false;

    public Notification getLastNotification() {
        return lastNotification;
    }

    public MediaPlaybackService.NextTrackInfo consumeNextTrackInfo() {
        MediaPlaybackService.NextTrackInfo n = pendingNextTrack;
        pendingNextTrack = null;
        if (n != null) return n;
        // Fall back to computing from the native queue mirror.
        return computeNextFromNativeQueue();
    }

    private synchronized MediaPlaybackService.NextTrackInfo computeNextFromNativeQueue() {
        if (nativeQueue.isEmpty() || nativeCurrentTrackId == null) return null;

        if ("one".equals(nativeRepeat)) {
            for (MediaPlaybackService.NextTrackInfo t : nativeQueue) {
                if (nativeCurrentTrackId.equals(t.trackId)) return t;
            }
            return null;
        }

        if (nativeShuffle) {
            java.util.List<MediaPlaybackService.NextTrackInfo> others = new java.util.ArrayList<>();
            for (MediaPlaybackService.NextTrackInfo t : nativeQueue) {
                if (!nativeCurrentTrackId.equals(t.trackId)) others.add(t);
            }
            if (others.isEmpty()) return null;
            MediaPlaybackService.NextTrackInfo pick = others.get(
                    new java.util.Random().nextInt(others.size()));
            nativeCurrentTrackId = pick.trackId;
            return pick;
        }

        int idx = -1;
        for (int i = 0; i < nativeQueue.size(); i++) {
            if (nativeCurrentTrackId.equals(nativeQueue.get(i).trackId)) {
                idx = i; break;
            }
        }
        if (idx < 0) return null;
        if (idx < nativeQueue.size() - 1) {
            MediaPlaybackService.NextTrackInfo pick = nativeQueue.get(idx + 1);
            nativeCurrentTrackId = pick.trackId;
            return pick;
        }
        if ("all".equals(nativeRepeat)) {
            MediaPlaybackService.NextTrackInfo pick = nativeQueue.get(0);
            nativeCurrentTrackId = pick.trackId;
            return pick;
        }
        return null;
    }

    public synchronized void setNativeQueue(String queueJson, String currentTrackId,
                                            String repeat, boolean shuffle) {
        nativeQueue.clear();
        nativeCurrentTrackId = currentTrackId;
        nativeRepeat = repeat != null ? repeat : "none";
        nativeShuffle = shuffle;
        if (queueJson == null || queueJson.isEmpty()) return;
        try {
            org.json.JSONArray arr = new org.json.JSONArray(queueJson);
            for (int i = 0; i < arr.length(); i++) {
                org.json.JSONObject o = arr.getJSONObject(i);
                nativeQueue.add(new MediaPlaybackService.NextTrackInfo(
                        o.optString("id", ""),
                        o.optString("streamUrl", ""),
                        o.optString("title", ""),
                        o.optString("artist", ""),
                        o.optString("thumbnail", "")
                ));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public static MainActivity getInstance() {
        return instance;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        instance = this;
        super.onCreate(savedInstanceState);

        if (!Python.isStarted()) {
            Python.start(new AndroidPlatform(this));
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    Python py = Python.getInstance();
                    py.getModule("app").get("app").callAttr("run", "127.0.0.1", 5000, false);
                } catch (Exception e) {
                    e.printStackTrace();
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

    private void handleIntentAction(Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String action = intent.getAction();
        if ("ACTION_PLAY_PAUSE".equals(action)) {
            triggerJsEvent("togglePlay()");
        } else if ("ACTION_PREV".equals(action)) {
            triggerJsEvent("playPrev()");
        } else if ("ACTION_NEXT".equals(action)) {
            triggerJsEvent("playNext()");
        }
    }

    private void setupMediaSession() {
        mediaSession = new MediaSession(this, "VamusMediaSession");
        stateBuilder = new PlaybackState.Builder()
                .setActions(
                        PlaybackState.ACTION_PLAY |
                        PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE |
                        PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS
                );
        // Initialize with a real STATE so the first notification we build is
        // valid enough for FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK on Android 14+.
        stateBuilder.setState(PlaybackState.STATE_PAUSED, 0, 0f);
        mediaSession.setPlaybackState(stateBuilder.build());

        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { triggerJsEvent("togglePlay()"); }
            @Override public void onPause() { triggerJsEvent("togglePlay()"); }
            @Override public void onSkipToNext() { triggerJsEvent("playNext()"); }
            @Override public void onSkipToPrevious() { triggerJsEvent("playPrev()"); }
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
                runOnUiThread(new Runnable() {
                    @Override public void run() { updateNativeMetadata(title, artist, thumbUrl); }
                });
            }

            @JavascriptInterface
            public void updatePlaybackState(final boolean isPlaying, final long positionMs) {
                runOnUiThread(new Runnable() {
                    @Override public void run() { updateNativePlaybackState(isPlaying, positionMs); }
                });
            }

            @JavascriptInterface
            public void playUri(final String url, final boolean isCrossfade, final int crossfadeDurationMs) {
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
             * Pre-computed next track info pushed from JS so the native
             * completion handler can advance without a JS round-trip.
             * Called with (null, null, null, null, null) to clear.
             */
            @JavascriptInterface
            public void setNextTrackInfo(final String trackId, final String streamUrl,
                                        final String title, final String artist,
                                        final String thumbnail) {
                if (streamUrl == null || streamUrl.isEmpty()) {
                    pendingNextTrack = null;
                } else {
                    pendingNextTrack = new MediaPlaybackService.NextTrackInfo(
                            trackId, streamUrl, title, artist, thumbnail);
                }
            }

            /**
             * Pushes the full playback context (queue + current index + repeat
             * mode + shuffle) so native can keep advancing on its own for as
             * many tracks as the queue holds, even while the WebView JS is
             * frozen (screen off). `queueJson` is a JSON array of tracks
             * with fields {id, title, artist, thumbnail, streamUrl}.
             */
            @JavascriptInterface
            public void setPlaybackContext(final String queueJson,
                                          final String currentTrackId,
                                          final String repeat,
                                          final boolean shuffle) {
                setNativeQueue(queueJson, currentTrackId, repeat, shuffle);
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

    private void updateNativePlaybackState(boolean isPlaying, long positionMs) {
        if (mediaSession == null || stateBuilder == null) return;
        int state = isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        stateBuilder.setState(state, positionMs, isPlaying ? 1.0f : 0.0f);
        mediaSession.setPlaybackState(stateBuilder.build());

        showOrUpdateNotification(isPlaying);
    }

    private void updateNativeMetadata(final String title, final String artist, final String thumbUrl) {
        if (mediaSession == null) return;
        currentTitle = title != null ? title : "";
        currentArtist = artist != null ? artist : "";
        currentThumbUrl = thumbUrl != null ? thumbUrl : "";
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
    public void applyPendingNextMetadata(final MediaPlaybackService.NextTrackInfo next) {
        if (next == null) return;
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                updateNativeMetadata(next.title, next.artist, next.thumbnail);
                updateNativePlaybackState(true, 0);
            }
        });
    }

    private void setMetadataOnSession() {
        if (mediaSession == null) return;
        MediaMetadata.Builder metaBuilder = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist);

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

    private void showOrUpdateNotification(boolean isPlaying) {
        if (mediaSession == null) return;

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
        Intent intent = new Intent(this, MainActivity.class);
        intent.setAction(action);
        return PendingIntent.getActivity(
                this, action.hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
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
