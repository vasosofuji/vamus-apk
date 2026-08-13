package com.matej.vamus;

import java.util.ArrayList;
import java.util.List;
import java.util.Random;

/**
 * Native mirror of the JS play queue.
 *
 * The WebView is the source of truth while it is awake: after every track
 * change it pushes the upcoming queue, the full context, and a pre-computed
 * "next track" hint. This class only has to take over when the WebView is
 * throttled (screen off / activity backgrounded) and native has to keep
 * advancing on its own.
 *
 * Deliberately free of Android imports so the advance logic can be executed and
 * tested off-device — see app/src/test/java/com/matej/vamus/PlaybackQueueTest.java,
 * which pins down the rules player.js has to match.
 *
 * Callers must push a context with unique track ids; player.js de-duplicates
 * before sending.
 */
public class PlaybackQueue {

    /** Reason there is nothing more to play. */
    public enum Outcome { TRACK, RADIO, STOP }

    public static class Result {
        public final Outcome outcome;
        public final Track track;

        Result(Outcome outcome, Track track) {
            this.outcome = outcome;
            this.track = track;
        }
    }

    public static class Track {
        public final String trackId;
        public final String streamUrl;
        public final String title;
        public final String artist;
        public final String thumbnail;

        public Track(String trackId, String streamUrl, String title, String artist, String thumbnail) {
            this.trackId = trackId == null ? "" : trackId;
            this.streamUrl = streamUrl == null ? "" : streamUrl;
            this.title = title == null ? "" : title;
            this.artist = artist == null ? "" : artist;
            this.thumbnail = thumbnail == null ? "" : thumbnail;
        }
    }

    // Tracks still to play, current excluded. Mirrors Store.queue.
    private final List<Track> upcoming = new ArrayList<>();
    // The full list the queue was built from. Mirrors Store.originalQueue and is
    // what Repeat All wraps back around to. Pushing the *shrinking* upcoming
    // queue here used to make native Repeat All loop over fewer and fewer
    // tracks each time around.
    private final List<Track> context = new ArrayList<>();

    private Track currentTrack;
    private String currentTrackId;
    private String repeat = "none";
    private boolean shuffle;
    private boolean autoplay = true;
    private Track pendingNext;

    private final Random random = new Random();

    public synchronized void setContext(List<Track> upcomingTracks, List<Track> contextTracks,
                                        String currentId, String repeatMode,
                                        boolean shuffleOn, boolean autoplayOn) {
        upcoming.clear();
        if (upcomingTracks != null) upcoming.addAll(upcomingTracks);
        context.clear();
        if (contextTracks != null) context.addAll(contextTracks);

        // The JS queue never contains the track that is playing, so nothing
        // below can refresh currentTrack. Left stale it points at a *previous*
        // song, and Repeat One then replays that instead of the current one.
        if (currentId == null || currentTrack == null || !currentId.equals(currentTrack.trackId)) {
            currentTrack = findById(context, currentId);
        }
        currentTrackId = currentId;
        repeat = repeatMode != null ? repeatMode : "none";
        shuffle = shuffleOn;
        autoplay = autoplayOn;
    }

    /** The next track JS has already decided on. Null/empty url clears it. */
    public synchronized void setPendingNext(Track track) {
        pendingNext = (track == null || track.streamUrl.isEmpty()) ? null : track;
    }

    public synchronized String getCurrentTrackId() {
        return currentTrackId;
    }

    /**
     * Decides what to play when the current track finishes.
     *
     * TRACK — play result.track.
     * RADIO — queue exhausted and autoplay is on; fetch a similar song.
     * STOP  — queue exhausted and autoplay is off; stop cleanly.
     */
    public synchronized Result consumeNext() {
        Track hint = pendingNext;
        pendingNext = null;

        if (hint != null) {
            // Drop it from the queue as well. Not doing so meant that once the
            // WebView went to sleep the very next native advance popped the same
            // track straight back off the queue and replayed it.
            removeById(upcoming, hint.trackId);
            currentTrack = hint;
            currentTrackId = hint.trackId;
            return new Result(Outcome.TRACK, hint);
        }

        Track pick = computeNext();
        if (pick != null) return new Result(Outcome.TRACK, pick);
        // Respect the user's Autoplay setting. Native used to fetch a radio
        // track unconditionally, so turning Autoplay off still produced a
        // surprise song once the queue ran dry.
        return new Result(autoplay ? Outcome.RADIO : Outcome.STOP, null);
    }

    private Track computeNext() {
        if ("one".equals(repeat)) {
            if (currentTrack != null) return currentTrack;
            return findById(context, currentTrackId);
        }

        if (upcoming.isEmpty()) {
            if (!"all".equals(repeat) || context.isEmpty()) return null;
            // Rotate: continue in list order across the loop boundary, ending
            // back on the current track. Simply re-adding the context restarted
            // from the top, which skipped the track after the wrap point on
            // every lap.
            int n = context.size();
            int start = indexOf(context, currentTrackId) + 1;
            for (int k = 0; k < n; k++) upcoming.add(context.get((start + k) % n));
        }

        Track pick;
        if (shuffle) {
            List<Track> others = new ArrayList<>();
            for (Track t : upcoming) {
                if (currentTrackId == null || !currentTrackId.equals(t.trackId)) others.add(t);
            }
            if (others.isEmpty()) others.addAll(upcoming);
            pick = others.get(random.nextInt(others.size()));
            removeById(upcoming, pick.trackId);
        } else {
            pick = upcoming.remove(0);
        }

        currentTrack = pick;
        currentTrackId = pick.trackId;
        return pick;
    }

    /** Called when native picked a radio track on its own. */
    public synchronized void adoptExternal(Track track) {
        if (track == null) return;
        currentTrack = track;
        currentTrackId = track.trackId;
        removeById(upcoming, track.trackId);
    }

    private static void removeById(List<Track> list, String id) {
        int i = indexOf(list, id);
        if (i >= 0) list.remove(i);
    }

    private static int indexOf(List<Track> list, String id) {
        if (id == null) return -1;
        for (int i = 0; i < list.size(); i++) {
            if (id.equals(list.get(i).trackId)) return i;
        }
        return -1;
    }

    private static Track findById(List<Track> list, String id) {
        int i = indexOf(list, id);
        return i < 0 ? null : list.get(i);
    }

    // ---------------------------------------------------------------- testing
    synchronized int upcomingSize() { return upcoming.size(); }

    synchronized List<String> upcomingIds() {
        List<String> ids = new ArrayList<>();
        for (Track t : upcoming) ids.add(t.trackId);
        return ids;
    }

    synchronized void seedRandom(long seed) { random.setSeed(seed); }
}
