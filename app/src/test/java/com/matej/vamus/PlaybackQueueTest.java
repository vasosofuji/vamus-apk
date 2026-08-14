package com.matej.vamus;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;

/**
 * Parity tests for the native half of the play queue.
 *
 * PlaybackQueue duplicates the advance logic that player.js runs while the
 * WebView is awake. That duplication is only safe if the two stay in step, so
 * every rule these tests pin down has a matching assertion on the JS side:
 *
 *   Repeat All wrap order  -> Player._contextWrapOrder
 *   Repeat One             -> Player._resolveNextTrack (honorRepeatOne)
 *   exhaustion             -> Player._onPlaybackFinished / auto-radio
 *
 * If you change one implementation, change the other and update both suites.
 */
public class PlaybackQueueTest {

    private static PlaybackQueue.Track t(String id) {
        return new PlaybackQueue.Track(id, "http://x/" + id, "Song " + id, "Artist", "");
    }

    private static List<PlaybackQueue.Track> list(String... ids) {
        List<PlaybackQueue.Track> l = new ArrayList<>();
        for (String id : ids) l.add(t(id));
        return l;
    }

    private static List<String> play(PlaybackQueue q, int times) {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < times; i++) {
            PlaybackQueue.Result r = q.consumeNext();
            out.add(r.track != null ? r.track.trackId : r.outcome.name());
        }
        return out;
    }

    /**
     * The WebView pushes one next-track hint then goes to sleep. The hint must
     * also be dropped from the queue, or the next native advance pops the same
     * track straight back off and replays it.
     */
    @Test
    public void consumedHintIsRemovedFromQueue() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"), "A", "none", false, true);
        q.setPendingNext(t("B"));

        assertEquals(Arrays.asList("B", "C", "D"), play(q, 3));
    }

    @Test
    public void autoplayOffStopsInsteadOfInventingASong() {
        PlaybackQueue off = new PlaybackQueue();
        off.setContext(list(), list("A"), "A", "none", false, false);
        assertEquals(PlaybackQueue.Outcome.STOP, off.consumeNext().outcome);

        PlaybackQueue on = new PlaybackQueue();
        on.setContext(list(), list("A"), "A", "none", false, true);
        assertEquals(PlaybackQueue.Outcome.RADIO, on.consumeNext().outcome);
    }

    /**
     * Repeat All wraps over the whole context, continuing in list order across
     * the loop boundary. Restarting from the top instead would skip the track
     * right after the wrap point on every lap.
     */
    @Test
    public void repeatAllWrapsOverFullContextInOrder() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("D"), list("A", "B", "C", "D"), "C", "all", false, true);
        assertEquals(Arrays.asList("D", "A", "B", "C", "D"), play(q, 5));
    }

    @Test
    public void repeatAllDoesNotWrapOntoTheCurrentTrack() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list(), list("A", "B", "C"), "C", "all", false, true);
        assertEquals("A", q.consumeNext().track.trackId);
    }

    @Test
    public void repeatAllOnASingleTrackContextRepeatsThatTrack() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list(), list("A"), "A", "all", false, true);
        assertEquals(Arrays.asList("A", "A"), play(q, 2));
    }

    /** Repeat One must replay the CURRENT track, never a previously played one. */
    @Test
    public void repeatOneFollowsTheCurrentTrack() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "one", false, true);
        q.setPendingNext(t("A"));
        assertEquals(Arrays.asList("A", "A"), play(q, 2));

        // User skips to C in the app. playUri() reports the new current track
        // first, then JS pushes the matching context; Repeat One follows C.
        q.setCurrent("C", t("C"), false);
        q.setContext(list(), list("A", "B", "C"), "C", "one", false, true);
        assertEquals("C", q.consumeNext().track.trackId);
    }

    @Test
    public void shuffleConsumesEachTrackOncePerPass() {
        PlaybackQueue q = new PlaybackQueue();
        q.seedRandom(42);
        q.setContext(list("B", "C", "D", "E"), list("A", "B", "C", "D", "E"),
                "A", "none", true, true);

        List<String> seen = play(q, 4);
        assertEquals("no duplicates within a pass " + seen, 4, new HashSet<>(seen).size());
        assertEquals(0, q.upcomingSize());
    }

    @Test
    public void queuedTracksPlayInOrderThenHandOverToRadio() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"), "A", "none", false, true);
        assertEquals(Arrays.asList("B", "C", "D"), play(q, 3));
        assertEquals(PlaybackQueue.Outcome.RADIO, q.consumeNext().outcome);
    }

    /** With the WebView awake, native must follow its hints exactly. */
    @Test
    public void hintsFromJsWinAndKeepTheQueueInStep() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"), "A", "none", false, true);

        q.setPendingNext(t("B"));
        assertEquals("B", q.consumeNext().track.trackId);
        assertEquals(Arrays.asList("C", "D"), q.upcomingIds());

        q.setPendingNext(t("C"));
        assertEquals("C", q.consumeNext().track.trackId);
        assertEquals(Arrays.asList("D"), q.upcomingIds());
    }

    /** A radio track native picked itself becomes the current track. */
    @Test
    public void externallyChosenTrackBecomesCurrent() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list(), list("A"), "A", "none", false, true);
        assertEquals(PlaybackQueue.Outcome.RADIO, q.consumeNext().outcome);

        q.adoptExternal(t("R1"));
        assertEquals("R1", q.getCurrentTrackId());

        // Repeat One must now follow the adopted track, not fall back to context.
        q.setContext(list(), list("A"), "R1", "one", false, true);
        PlaybackQueue.Result r = q.consumeNext();
        assertNotNull("repeat-one lost the adopted track", r.track);
        assertEquals("R1", r.track.trackId);
    }

    @Test
    public void emptyContextWithRepeatAllDoesNotLoopForever() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list(), list(), "A", "all", false, false);
        PlaybackQueue.Result r = q.consumeNext();
        assertNull(r.track);
        assertEquals(PlaybackQueue.Outcome.STOP, r.outcome);
    }

    /**
     * The WebView is throttled in the background, so a context push can arrive
     * long after it was computed. Applying a stale one handed already-played
     * tracks back to native and they played a second time — the "songs repeat
     * with the screen off" report.
     */
    @Test
    public void staleContextPushIsIgnored() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"), "A", "none", false, true);

        assertEquals("B", q.consumeNext().track.trackId);
        assertEquals("C", q.consumeNext().track.trackId);   // native is now on C

        // A push computed back when A was playing finally lands.
        boolean applied = q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"),
                "A", "none", false, true);
        assertFalse("stale push must not be applied", applied);

        // B and C must not come back.
        assertEquals("D", q.consumeNext().track.trackId);
        assertEquals(PlaybackQueue.Outcome.RADIO, q.consumeNext().outcome);
    }

    /** A fresh push (current track matches) is applied normally. */
    @Test
    public void currentContextPushIsApplied() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "none", false, true);
        assertEquals("B", q.consumeNext().track.trackId);

        assertTrue(q.setContext(list("C", "X"), list("A", "B", "C", "X"), "B", "none", false, true));
        assertEquals(Arrays.asList("C", "X"), q.upcomingIds());
    }

    /** Settings still apply even when the queue part of a push is stale. */
    @Test
    public void staleContextStillUpdatesSettings() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B"), list("A", "B"), "A", "none", false, true);
        q.consumeNext();                                    // now on B

        q.setContext(list("B"), list("A", "B"), "A", "none", false, /*autoplay*/ false);
        // Queue exhausted; the autoplay=false from the stale push must be honoured.
        assertEquals(PlaybackQueue.Outcome.STOP, q.consumeNext().outcome);
    }

    /** Manual skip from a car head unit must move on, even in Repeat One. */
    @Test
    public void manualSkipIgnoresRepeatOne() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "one", false, true);
        q.setPendingNext(t("A"));                           // the Repeat One hint

        PlaybackQueue.Result r = q.skipNext();
        assertNotNull(r.track);
        assertEquals("B", r.track.trackId);
    }

    /** Previous works natively, without waking the WebView. */
    @Test
    public void previousWalksBackThroughHistory() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"), "A", "none", false, true);
        assertEquals("B", q.consumeNext().track.trackId);
        assertEquals("C", q.consumeNext().track.trackId);

        assertEquals("B", q.skipPrevious().trackId);
        assertEquals("A", q.skipPrevious().trackId);
        assertNull("nothing before the first track", q.skipPrevious());
    }

    /** Going back then forward returns to the track we left, not past it. */
    @Test
    public void previousThenNextIsSymmetric() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C", "D"), list("A", "B", "C", "D"), "A", "none", false, true);
        q.consumeNext();                                    // B
        q.consumeNext();                                    // C
        assertEquals("B", q.skipPrevious().trackId);
        assertEquals("C", q.skipNext().track.trackId);
        assertEquals("D", q.skipNext().track.trackId);
    }

    /** setCurrent marks what the WebView started so a matching push is fresh. */
    @Test
    public void setCurrentMakesTheMatchingPushFresh() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "none", false, true);
        q.consumeNext();                                    // native on B

        // The user taps track C in the app: JS calls playUri then pushes.
        q.setCurrent("C", t("C"), false);
        assertTrue(q.setContext(list(), list("A", "B", "C"), "C", "none", false, true));
        assertEquals("C", q.getCurrentTrackId());
    }

    /**
     * The in-app Previous button routes through setCurrent(fromHistory=true).
     * Treating it as a forward move recorded the track being left as its own
     * predecessor, so Previous on a lock screen or car head unit then moved
     * FORWARD and the two controls ping-ponged between two songs.
     */
    @Test
    public void inAppPreviousDoesNotCorruptNativeHistory() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "none", false, true);
        assertEquals("B", q.consumeNext().track.trackId);   // history = [A]

        // User taps Previous inside the app: JS replays A as a history rewind.
        q.setCurrent("A", t("A"), /*fromHistory*/ true);
        assertEquals("A", q.getCurrentTrackId());

        // A head-unit Previous must now find nothing before A, not jump to B.
        assertNull("Previous went forward", q.skipPrevious());
        // ...and B is queued up again, so Next returns to it.
        assertEquals("B", q.skipNext().track.trackId);
    }

    /** A forward move via setCurrent still records history normally. */
    @Test
    public void inAppForwardPlayRecordsHistory() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "none", false, true);
        q.setCurrent("C", t("C"), /*fromHistory*/ false);
        assertEquals("A", q.skipPrevious().trackId);
    }

    /** Repeat One must not record the playing song as its own predecessor. */
    @Test
    public void repeatOneDoesNotPolluteHistory() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list(), list("X", "A"), "X", "none", false, true);
        q.setCurrent("A", t("A"), false);                   // played X then A
        q.setContext(list(), list("X", "A"), "A", "one", false, true);

        q.setPendingNext(t("A"));                           // repeat-one hint
        assertEquals("A", q.consumeNext().track.trackId);
        assertEquals("A", q.consumeNext().track.trackId);   // loops again

        // One press of Previous must reach X, not the song already playing.
        PlaybackQueue.Track prev = q.skipPrevious();
        assertNotNull(prev);
        assertEquals("X", prev.trackId);
    }

    /** A stream retry re-declares the same track and must change nothing. */
    @Test
    public void repeatedSetCurrentOnSameTrackIsInert() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B"), list("A", "B"), "A", "none", false, true);
        q.setCurrent("B", t("B"), false);                   // history = [A]
        q.setCurrent("B", t("B"), false);                   // retry
        q.setCurrent("B", t("B"), false);                   // retry
        assertEquals("A", q.skipPrevious().trackId);
        assertNull(q.skipPrevious());
    }

    /** A pending hint with no stream URL clears rather than queues an unplayable track. */
    @Test
    public void blankHintIsIgnored() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B"), list("A", "B"), "A", "none", false, true);
        q.setPendingNext(new PlaybackQueue.Track("", "", "", "", ""));
        assertEquals("B", q.consumeNext().track.trackId);
    }

    @Test
    public void duplicateIdsInContextDoNotProduceBackToBackRepeats() {
        PlaybackQueue q = new PlaybackQueue();
        q.setContext(list("B", "C"), list("A", "B", "C"), "A", "all", false, true);
        List<String> played = play(q, 9);
        for (int i = 1; i < played.size(); i++) {
            assertTrue("repeated " + played.get(i) + " back-to-back in " + played,
                    !played.get(i).equals(played.get(i - 1)));
        }
    }
}
