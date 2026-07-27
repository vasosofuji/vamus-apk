package com.matej.vamus;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.cache.CacheDataSource;
import androidx.media3.datasource.cache.LeastRecentlyUsedCacheEvictor;
import androidx.media3.datasource.cache.SimpleCache;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;

/**
 * Audio playback service backed by ExoPlayer (Media3).
 *
 * Why ExoPlayer instead of MediaPlayer:
 *  - YouTube stream URLs are throttled to ~2x realtime. MediaPlayer insists on
 *    buffering ~10s before it starts, so first sound took ~7s. ExoPlayer lets us
 *    start after a 1s buffer (see the LoadControl below).
 *  - ExoPlayer follows http->https redirects itself (setAllowCrossProtocolRedirects),
 *    so we can hand it the local Flask endpoint directly.
 *  - ExoPlayer's getCurrentPosition/getDuration don't corrupt state when called
 *    off the player thread — but they DO require single-threaded access, so the
 *    JS bridge reads cached values updated by a main-thread ticker instead.
 */
@OptIn(markerClass = UnstableApi.class)
public class MediaPlaybackService extends Service {
    private static final int NOTIFICATION_ID = 1001;

    private static final int MAX_SAME_TRACK_RETRIES = 3;
    private static final int MAX_CONSECUTIVE_SKIPS = 6;
    private static final long MIN_PLAYED_MS_FOR_SUCCESS = 5000;
    private static final long RETRY_DELAY_MS = 700;

    private static MediaPlaybackService instance;
    private static SimpleCache downloadCache;

    private synchronized SimpleCache getCache() {
        if (downloadCache == null) {
            try {
                java.io.File cacheDir = new java.io.File(getCacheDir(), "media_cache");
                LeastRecentlyUsedCacheEvictor evictor = new LeastRecentlyUsedCacheEvictor(250 * 1024 * 1024L); // 250 MB LRU disk cache
                downloadCache = new SimpleCache(cacheDir, evictor, new StandaloneDatabaseProvider(this));
            } catch (Exception e) {
                dbg("Failed to initialize SimpleCache: " + e);
            }
        }
        return downloadCache;
    }
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private boolean isForeground = false;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private ExoPlayer player;
    private ExoPlayer crossfadePlayer;
    private Player.Listener crossfadeListener;
    private float currentVolume = 1.0f;

    private long currentTrackStartMs = 0;
    private boolean startReported = false;
    private String currentUrl = null;
    private int sameTrackRetries = 0;
    private int consecutiveSkips = 0;

    // Position/duration are read from the JS bridge on a binder thread; ExoPlayer
    // must only be touched on the main thread, so a main-thread ticker caches
    // these and the bridge returns the cached values.
    private volatile long cachedPositionMs = 0;
    private volatile long cachedDurationMs = 0;
    private Runnable positionTicker;

    // Pending retry/advance runnable so a fresh play() can cancel it precisely
    // (without also cancelling the position ticker).
    private Runnable pendingAction;

    public static MediaPlaybackService getInstance() {
        return instance;
    }

    // ----------------------------------------------------------------- logging
    static void dbg(final String msg) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String u = "http://127.0.0.1:5000/api/debug/push?m="
                            + java.net.URLEncoder.encode("[native] " + msg, "UTF-8");
                    java.net.HttpURLConnection c =
                            (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
                    c.setConnectTimeout(2000);
                    c.setReadTimeout(2000);
                    c.getResponseCode();
                    c.disconnect();
                } catch (Exception ignored) {}
            }
        }).start();
    }

    private static String shortId(String url) {
        if (url == null) return "null";
        int i = url.indexOf("id=");
        if (i >= 0) {
            String s = url.substring(i + 3);
            int amp = s.indexOf('&');
            return amp >= 0 ? s.substring(0, amp) : s;
        }
        return url.substring(0, Math.min(40, url.length()));
    }

    // -------------------------------------------------------------- lifecycle
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Vamus::PlaybackWakeLock");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }

        WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
        if (wifiManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Vamus::PlaybackWifiLock");
            } else {
                wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL, "Vamus::PlaybackWifiLock");
            }
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureForeground();
        if (intent != null && "STOP_FOREGROUND".equals(intent.getAction())) {
            stopSelfSafely();
        }
        return START_STICKY;
    }

    public void promoteToForeground(Notification notification) {
        if (notification == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
            isForeground = true;
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    private void ensureForeground() {
        if (isForeground) return;
        MainActivity activity = MainActivity.getInstance();
        Notification notification = activity != null ? activity.getLastNotification() : null;
        if (notification == null) {
            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                builder = new Notification.Builder(this, "vamus_media_channel");
            } else {
                builder = new Notification.Builder(this);
            }
            builder.setContentTitle("Vamus")
                    .setContentText("Loading playback...")
                    .setSmallIcon(android.R.drawable.ic_media_play)
                    .setOngoing(true);
            notification = builder.build();
        }
        promoteToForeground(notification);
    }

    private void stopSelfSafely() {
        mainHandler.removeCallbacksAndMessages(null);
        pendingAction = null;
        positionTicker = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        releasePlayers();
        currentUrl = null;
        sameTrackRetries = 0;
        consecutiveSkips = 0;
        currentTrackStartMs = 0;
        isForeground = false;
        stopSelf();
    }

    // ----------------------------------------------------------- ExoPlayer
    private ExoPlayer buildPlayer() {
        // Fast playback startup (1000ms buffer) and fast re-buffering on seek (300ms buffer instead of 2000ms).
        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        /* minBufferMs= */ 15000,
                        /* maxBufferMs= */ 60000,
                        /* bufferForPlaybackMs= */ 1000,
                        /* bufferForPlaybackAfterRebufferMs= */ 300)
                .build();

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000)
                .setUserAgent("Mozilla/5.0");

        SimpleCache cache = getCache();
        androidx.media3.datasource.DataSource.Factory dataSourceFactory;
        if (cache != null) {
            dataSourceFactory = new CacheDataSource.Factory()
                    .setCache(cache)
                    .setUpstreamDataSourceFactory(http)
                    .setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
        } else {
            dataSourceFactory = http;
        }

        ExoPlayer p = new ExoPlayer.Builder(this)
                .setLoadControl(loadControl)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(dataSourceFactory))
                .build();
        p.setSeekParameters(SeekParameters.CLOSEST_SYNC);
        p.setVolume(currentVolume);
        return p;
    }

    private final Player.Listener mainListener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_READY) {
                if (!startReported) {
                    startReported = true;
                    currentTrackStartMs = System.currentTimeMillis();
                    long dur = player != null ? player.getDuration() : 0;
                    dbg("PREPARED -> playing (dur=" + (dur == C.TIME_UNSET ? -1 : dur) + "ms)");
                }
            } else if (state == Player.STATE_ENDED) {
                dbg("onCompletion");
                onTrackFinished(false);
            }
        }

        @Override
        public void onPlayerError(PlaybackException error) {
            dbg("ExoPlayer error: " + error.getErrorCodeName() + " (" + error.errorCode + ") "
                    + (error.getMessage() != null ? error.getMessage() : ""));
            onTrackFinished(true);
        }
    };

    /** Entry point called from JS/native. Always runs on the main thread. */
    public void play(final String url, final boolean isCrossfade, final int crossfadeDurationMs) {
        if (Looper.myLooper() != Looper.getMainLooper()) {
            mainHandler.post(new Runnable() {
                @Override public void run() { play(url, isCrossfade, crossfadeDurationMs); }
            });
            return;
        }

        // Cancel any pending retry/advance so it can't clobber this fresh play.
        if (pendingAction != null) {
            mainHandler.removeCallbacks(pendingAction);
            pendingAction = null;
        }

        if (url != null && !url.equals(currentUrl)) {
            sameTrackRetries = 0;
        }
        currentUrl = url;
        dbg("play id=" + shortId(url) + " cf=" + isCrossfade);

        if (isCrossfade && player != null && crossfadeDurationMs > 0) {
            startCrossfade(url, crossfadeDurationMs);
        } else {
            startPlayback(url);
        }
    }

    private void startPlayback(String url) {
        releasePlayers();
        startReported = false;
        cachedPositionMs = 0;
        cachedDurationMs = 0;
        try {
            player = buildPlayer();
            player.addListener(mainListener);
            player.setMediaItem(MediaItem.fromUri(url));
            player.setPlayWhenReady(true);
            player.prepare();
            startPositionTicker();
        } catch (Exception e) {
            dbg("startPlayback EXCEPTION: " + e);
            onTrackFinished(true);
        }
    }

    private void startCrossfade(final String url, final int durMs) {
        try {
            // The outgoing player should no longer drive auto-advance.
            if (player != null) player.removeListener(mainListener);

            releaseCrossfade();
            crossfadePlayer = buildPlayer();
            crossfadePlayer.setVolume(0f);
            crossfadeListener = new Player.Listener() {
                boolean ramping = false;
                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY && !ramping) {
                        ramping = true;
                        startReported = true;
                        currentTrackStartMs = System.currentTimeMillis();
                        dbg("crossfade PREPARED -> ramping");
                        rampCrossfade(durMs);
                    }
                }
                @Override
                public void onPlayerError(PlaybackException error) {
                    dbg("crossfade error: " + error.getErrorCodeName());
                    onTrackFinished(true);
                }
            };
            crossfadePlayer.addListener(crossfadeListener);
            crossfadePlayer.setMediaItem(MediaItem.fromUri(url));
            crossfadePlayer.setPlayWhenReady(true);
            crossfadePlayer.prepare();
        } catch (Exception e) {
            dbg("startCrossfade EXCEPTION: " + e);
            startPlayback(url);
        }
    }

    private void rampCrossfade(final int durMs) {
        final int steps = 40;
        final int interval = Math.max(10, durMs / steps);
        final float target = currentVolume;
        final int[] step = {0};
        final Runnable ramp = new Runnable() {
            @Override
            public void run() {
                step[0]++;
                float progress = Math.min(1f, (float) step[0] / steps);
                // Equal-Power Crossfade curve: constant acoustic energy (no volume dip!)
                float outVol = (float) Math.cos(progress * Math.PI / 2.0);
                float inVol = (float) Math.sin(progress * Math.PI / 2.0);
                try {
                    if (player != null) player.setVolume(target * outVol);
                    if (crossfadePlayer != null) crossfadePlayer.setVolume(target * inVol);
                } catch (Exception ignored) {}

                if (step[0] >= steps) {
                    // Promote the incoming player to primary.
                    ExoPlayer old = player;
                    player = crossfadePlayer;
                    crossfadePlayer = null;
                    if (old != null) {
                        try { old.release(); } catch (Exception ignored) {}
                    }
                    if (player != null) {
                        // Swap the temporary crossfade listener for the main one
                        // so later completion/errors are handled exactly once.
                        if (crossfadeListener != null) {
                            try { player.removeListener(crossfadeListener); } catch (Exception ignored) {}
                        }
                        try { player.setVolume(target); } catch (Exception ignored) {}
                        player.addListener(mainListener);
                    }
                    crossfadeListener = null;
                    startPositionTicker();
                } else {
                    mainHandler.postDelayed(this, interval);
                }
            }
        };
        mainHandler.postDelayed(ramp, interval);
    }

    private void startPositionTicker() {
        stopPositionTicker();
        positionTicker = new Runnable() {
            @Override
            public void run() {
                try {
                    if (player != null) {
                        long pos = player.getCurrentPosition();
                        long dur = player.getDuration();
                        cachedPositionMs = pos < 0 ? 0 : pos;
                        long validDur = (dur == C.TIME_UNSET || dur < 0) ? 0 : dur;
                        if (validDur > 0 && validDur != cachedDurationMs) {
                            cachedDurationMs = validDur;
                            MainActivity activity = MainActivity.getInstance();
                            if (activity != null) {
                                activity.updateNativeDuration(validDur);
                            }
                        }
                    }
                } catch (Exception ignored) {}
                mainHandler.postDelayed(this, 250);
            }
        };
        mainHandler.post(positionTicker);
    }

    private void stopPositionTicker() {
        if (positionTicker != null) {
            mainHandler.removeCallbacks(positionTicker);
            positionTicker = null;
        }
    }

    // --------------------------------------------------------- advance / retry
    private void onTrackFinished(final boolean isError) {
        long played = currentTrackStartMs > 0
                ? (System.currentTimeMillis() - currentTrackStartMs)
                : 0;
        currentTrackStartMs = 0;

        boolean reallyPlayed = !isError && played >= MIN_PLAYED_MS_FOR_SUCCESS;
        dbg("finished isError=" + isError + " played=" + played + "ms"
                + " reallyPlayed=" + reallyPlayed
                + " sameRetry=" + sameTrackRetries + " skips=" + consecutiveSkips);

        if (reallyPlayed) {
            consecutiveSkips = 0;
            sameTrackRetries = 0;
            advanceToNext();
            return;
        }

        if (currentUrl != null && sameTrackRetries < MAX_SAME_TRACK_RETRIES) {
            sameTrackRetries++;
            final String url = currentUrl;
            scheduleAction(new Runnable() {
                @Override public void run() { startPlayback(url); }
            });
            return;
        }

        sameTrackRetries = 0;
        consecutiveSkips++;
        if (consecutiveSkips > MAX_CONSECUTIVE_SKIPS) {
            consecutiveSkips = 0;
            onPlaybackStalled();
            return;
        }

        scheduleAction(new Runnable() {
            @Override public void run() { advanceToNext(); }
        });
    }

    private void scheduleAction(Runnable r) {
        pendingAction = r;
        mainHandler.postDelayed(r, RETRY_DELAY_MS);
    }

    private void advanceToNext() {
        MainActivity activity = MainActivity.getInstance();
        if (activity != null) {
            NextTrackInfo next = activity.consumeNextTrackInfo();
            if (next != null && next.streamUrl != null && !next.streamUrl.isEmpty()) {
                dbg("advance -> native nextId=" + next.trackId);
                activity.applyPendingNextMetadata(next);
                startPlayback(next.streamUrl);
                activity.triggerJsEvent("if (typeof Player !== 'undefined') { Player._onNativeAdvanced && Player._onNativeAdvanced(" + jsonQuote(next.trackId) + "); }");
                return;
            }
        }

        // When queue is empty and WebView JS may be frozen (screen off doze mode),
        // native Java background thread fetches the next radio track directly over HTTP!
        dbg("advance -> no pre-fetched native next, fetching radio in native Java background thread");
        fetchRadioAndPlayNatively();
    }

    private void fetchRadioAndPlayNatively() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    if (currentUrl == null) return;
                    String shortIdStr = shortId(currentUrl);
                    String u = "http://127.0.0.1:5000/api/radio?id=" + java.net.URLEncoder.encode(shortIdStr, "UTF-8");
                    java.net.HttpURLConnection conn = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
                    conn.setConnectTimeout(4000);
                    conn.setReadTimeout(4000);
                    if (conn.getResponseCode() == 200) {
                        java.io.InputStream is = conn.getInputStream();
                        java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(is, "UTF-8"));
                        StringBuilder sb = new StringBuilder();
                        String line;
                        while ((line = reader.readLine()) != null) sb.append(line);
                        reader.close();

                        org.json.JSONArray arr = new org.json.JSONArray(sb.toString());
                        if (arr.length() > 0) {
                            org.json.JSONObject obj = arr.getJSONObject(0);
                            final String nextId = obj.optString("id");
                            final String title = obj.optString("title", "");
                            final String artist = obj.optJSONObject("channel") != null ? obj.optJSONObject("channel").optString("name", "") : obj.optString("artist", "");
                            final String thumb = obj.optString("thumbnail", "");
                            final String streamUrl = "http://127.0.0.1:5000/api/stream?id=" + nextId;

                            mainHandler.post(new Runnable() {
                                @Override
                                public void run() {
                                    dbg("native radio advance -> id=" + nextId);
                                    MainActivity activity = MainActivity.getInstance();
                                    if (activity != null) {
                                        activity.applyPendingNextMetadata(new NextTrackInfo(nextId, streamUrl, title, artist, thumb));
                                        activity.triggerJsEvent("if (typeof Player !== 'undefined') { Player._onNativeAdvanced && Player._onNativeAdvanced(" + jsonQuote(nextId) + "); }");
                                    }
                                    startPlayback(streamUrl);
                                }
                            });
                            return;
                        }
                    }
                } catch (Exception e) {
                    dbg("fetchRadioAndPlayNatively EXCEPTION: " + e);
                }

                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        MainActivity activity = MainActivity.getInstance();
                        if (activity != null) activity.triggerJsEvent("playNext()");
                    }
                });
            }
        }).start();
    }


    private void onPlaybackStalled() {
        dbg("STALLED (too many consecutive failures) — stopping");
        MainActivity activity = MainActivity.getInstance();
        if (activity == null) return;
        activity.triggerJsEvent(
                "if (typeof Player !== 'undefined' && Player._onPlaybackStalled) { Player._onPlaybackStalled(); }");
    }

    // ----------------------------------------------------------- transport
    public void pausePlayback() {
        runOnPlayer(new Runnable() {
            @Override public void run() {
                if (player != null) player.setPlayWhenReady(false);
                if (crossfadePlayer != null) crossfadePlayer.setPlayWhenReady(false);
            }
        });
    }

    public void resumePlayback() {
        runOnPlayer(new Runnable() {
            @Override public void run() {
                if (player != null) player.setPlayWhenReady(true);
                if (crossfadePlayer != null) crossfadePlayer.setPlayWhenReady(true);
            }
        });
    }

    public void seekTo(final int positionMs) {
        runOnPlayer(new Runnable() {
            @Override public void run() {
                if (player != null) {
                    try { player.seekTo(positionMs); } catch (Exception ignored) {}
                }
            }
        });
    }

    public void setVolume(final float vol) {
        currentVolume = vol;
        runOnPlayer(new Runnable() {
            @Override public void run() {
                try { if (player != null) player.setVolume(vol); } catch (Exception ignored) {}
            }
        });
    }

    /** ExoPlayer must be touched on the main thread; hop there if needed. */
    private void runOnPlayer(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) r.run();
        else mainHandler.post(r);
    }

    // Bridge reads (called off-main): return cached values only.
    public int getCurrentPosition() {
        return (int) cachedPositionMs;
    }

    public int getDuration() {
        return (int) cachedDurationMs;
    }

    // ----------------------------------------------------------- cleanup
    private void releaseCrossfade() {
        if (crossfadePlayer != null) {
            try {
                crossfadePlayer.release();
            } catch (Exception ignored) {}
            crossfadePlayer = null;
        }
    }

    private void releasePlayers() {
        stopPositionTicker();
        if (player != null) {
            try {
                player.removeListener(mainListener);
                player.release();
            } catch (Exception ignored) {}
            player = null;
        }
        releaseCrossfade();
    }

    @Override
    public void onDestroy() {
        releasePlayers();
        if (wakeLock != null && wakeLock.isHeld()) {
            try { wakeLock.release(); } catch (Exception ignored) {}
        }
        if (wifiLock != null && wifiLock.isHeld()) {
            try { wifiLock.release(); } catch (Exception ignored) {}
        }
        instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private static String jsonQuote(String s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': sb.append("\\\\"); break;
                case '"': sb.append("\\\""); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        sb.append("\"");
        return sb.toString();
    }

    /** Simple container for a pre-computed next track. */
    public static class NextTrackInfo {
        public final String trackId;
        public final String streamUrl;
        public final String title;
        public final String artist;
        public final String thumbnail;

        public NextTrackInfo(String trackId, String streamUrl, String title, String artist, String thumbnail) {
            this.trackId = trackId;
            this.streamUrl = streamUrl;
            this.title = title;
            this.artist = artist;
            this.thumbnail = thumbnail;
        }
    }
}
