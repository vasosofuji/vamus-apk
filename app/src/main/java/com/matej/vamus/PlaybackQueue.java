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

    // Tracks already played, oldest first. Native keeps its own copy so the
    // Previous button on a lock screen or car head unit works without waking
    // the WebView.
    private final List<Track> history = new ArrayList<>();
    private static final int MAX_HISTORY = 100;

    private Track currentTrack;
    private String currentTrackId;
    private String repeat = "none";
    private boolean shuffle;
    private boolean autoplay = true;
    private Track pendingNext;

    private final Random random = new Random();

    /**
     * Mirrors the WebView's view of the queue.
     *
     * Returns false and keeps the existing queue when `currentId` is not the
     * track native is actually playing. The WebView is throttled in the
     * background, so a push can arrive long after it was computed; applying a
     * stale one wholesale used to hand already-played tracks back to native and
     * they played a second time.
     */
    public synchronized boolean setContext(List<Track> upcomingTracks, List<Track> contextTracks,
                                           String currentId, String repeatMode,
                                           boolean shuffleOn, boolean autoplayOn) {
        // Settings are never stale — apply them whatever the queue state.
        repeat = repeatMode != null ? repeatMode : "none";
        shuffle = shuffleOn;
        autoplay = autoplayOn;

        if (currentTrackId != null && currentId != null && !currentTrackId.equals(currentId)) {
            return false;
        }

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
        return true;
    }

    /**
     * Declares which track the WebView just started, so a context push that
     * arrives alongside it is recognised as current rather than stale.
     *
     * `fromHistory` distinguishes a forward move from the Previous button. It
     * matters because history is shared with the lock-screen and car controls:
     * treating a rewind as a forward move recorded the track being left as its
     * own predecessor, and Previous on a head unit then moved *forward*,
     * ping-ponging between two songs.
     */
    public synchronized void setCurrent(String trackId, Track track, boolean fromHistory) {
        if (trackId == null || trackId.isEmpty()) return;

        // Same track: a stream retry or a Repeat One restart. Nothing to record.
        if (trackId.equals(currentTrackId)) {
            if (track != null && !track.streamUrl.isEmpty()) currentTrack = track;
            pendingNext = null;
            return;
        }

        Track leaving = currentTrack;
        if (fromHistory) {
            removeById(history, trackId);
            // The song we just left becomes the next one up again.
            if (leaving != null && indexOf(upcoming, leaving.trackId) < 0) {
                upcoming.add(0, leaving);
            }
        } else {
            pushHistory(leaving);
        }

        currentTrackId = trackId;
        if (track != null && !track.streamUrl.isEmpty()) currentTrack = track;
        else currentTrack = findById(context, trackId);
        removeById(upcoming, trackId);
        pendingNext = null;
    }

    private void pushHistory(Track t) {
        if (t == null) return;
        removeById(history, t.trackId);
        history.add(t);
        while (history.size() > MAX_HISTORY) history.remove(0);
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
        return advance(true);
    }

    /**
     * Manual skip from a notification, lock screen or car head unit.
     *
     * Unlike an auto-advance it never honours Repeat One — pressing Next should
     * move to the following song, not replay the current one.
     */
    public synchronized Result skipNext() {
        if (pendingNext != null && pendingNext.trackId.equals(currentTrackId)) {
            // A Repeat One hint; the user asked to move on.
            pendingNext = null;
        }
        return advance(false);
    }

    /**
     * Manual Previous. Native keeps its own history so this works with the
     * WebView asleep; returns null when there is nothing to go back to and the
     * caller should just restart the current track.
     */
    public synchronized Track skipPrevious() {
        if (history.isEmpty()) return null;
        Track prev = history.remove(history.size() - 1);
        // The track we are leaving becomes the next one up again.
        if (currentTrack != null && !currentTrack.trackId.equals(prev.trackId)
                && indexOf(upcoming, currentTrack.trackId) < 0) {
            upcoming.add(0, currentTrack);
        }
        currentTrack = prev;
        currentTrackId = prev.trackId;
        removeById(upcoming, prev.trackId);
        pendingNext = null;
        return prev;
    }

    private Result advance(boolean honorRepeatOne) {
        Track hint = pendingNext;
        pendingNext = null;

        if (hint != null) {
            // Drop it from the queue as well. Not doing so meant that once the
            // WebView went to sleep the very next native advance popped the same
            // track straight back off the queue and replayed it.
            removeById(upcoming, hint.trackId);
            // Under Repeat One the hint IS the current track, so pushing here
            // unconditionally made the playing song its own predecessor and
            // Previous needed two presses to actually go back.
            if (!hint.trackId.equals(currentTrackId)) pushHistory(currentTrack);
            currentTrack = hint;
            currentTrackId = hint.trackId;
            return new Result(Outcome.TRACK, hint);
        }

        Track pick = computeNext(honorRepeatOne);
        if (pick != null) return new Result(Outcome.TRACK, pick);
        // Respect the user's Autoplay setting. Native used to fetch a radio
        // track unconditionally, so turning Autoplay off still produced a
        // surprise song once the queue ran dry.
        return new Result(autoplay ? Outcome.RADIO : Outcome.STOP, null);
    }

    private Track computeNext(boolean honorRepeatOne) {
        if (honorRepeatOne && "one".equals(repeat)) {
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

        // Same guard as the hint path: a single-track Repeat All context picks
        // the song already playing.
        if (!pick.trackId.equals(currentTrackId)) pushHistory(currentTrack);
        currentTrack = pick;
        currentTrackId = pick.trackId;
        return pick;
    }

    /** Called when native picked a radio track on its own. */
    public synchronized void adoptExternal(Track track) {
        if (track == null) return;
        if (currentTrack != null && !currentTrack.trackId.equals(track.trackId)) {
            pushHistory(currentTrack);
        }
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
