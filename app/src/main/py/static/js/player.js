// Image Pre-loading Cache
const _artCache = new Map();
function preloadImage(url) {
    if (!url || _artCache.has(url)) return;
    const img = new Image();
    img.src = url;
    _artCache.set(url, img);
}

function normalizeSongTitle(title) {
    if (!title) return '';
    let t = title.toLowerCase();
    const patterns = [
        /\((?:slowed\s*(?:\+|and|&)?\s*reverb|slowed|reverb)\)/gi,
        /\[(?:slowed\s*(?:\+|and|&)?\s*reverb|slowed|reverb)\]/gi,
        /\((?:sped\s*up|speed\s*up|speedup|nightcore|daycore)\)/gi,
        /\[(?:sped\s*up|speed\s*up|speedup|nightcore|daycore)\]/gi,
        /\((?:remix|mix|edit|vip|flip|bootleg|dub)\)/gi,
        /\[(?:remix|mix|edit|vip|flip|bootleg|dub)\]/gi,
        /\((?:acoustic|live|instrumental|karaoke|unplugged|orchestral)\)/gi,
        /\[(?:acoustic|live|instrumental|karaoke|unplugged|orchestral)\]/gi,
        /\((?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|hd|4k)|video|audio|lyrics?)\)/gi,
        /\[(?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|hd|4k)|video|audio|lyrics?)\]/gi,
        /\((?:8d\s*audio|8d|3d\s*audio|3d|bass\s*boosted|bassboosted)\)/gi,
        /\[(?:8d\s*audio|8d|3d\s*audio|3d|bass\s*boosted|bassboosted)\]/gi,
        /\((?:feat\.?|ft\.?)[^)]*\)/gi,
        /\[(?:feat\.?|ft\.?)[^\]]*\]/gi,
        /\b(?:slowed\s*(?:\+|and|&)?\s*reverb|slowed|reverb|sped\s*up|speed\s*up|speedup|nightcore|official\s*audio|official\s*music\s*video|official\s*video|full\s*song|8d\s*audio|8d|bass\s*boosted)\b/gi,
        /-\s*(?:slowed|sped\s*up|remix|edit|live|acoustic|instrumental|official\s*audio|8d).*$/gi,
        /\|\s*.*$/gi
    ];
    for (const p of patterns) {
        t = t.replace(p, ' ');
    }
    t = t.replace(/[^\w\s]/g, '');
    return t.replace(/\s+/g, ' ').trim();
}

function getSongFingerprint(title, artist) {
    let normTitle = normalizeSongTitle(title);
    const normArtist = ((artist || '')).toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (normArtist && normTitle.includes(normArtist)) {
        normTitle = normTitle.replace(normArtist, '').trim();
    }
    return normArtist ? `${normArtist}::${normTitle}` : normTitle;
}

// Repeat Icons
const REPEAT_ICONS = {
    none: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
    all: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>`,
    one: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/><text x="12" y="14" font-size="8" font-family="'Inter', sans-serif" font-weight="900" fill="currentColor" text-anchor="middle" stroke="none">1</text></svg>`
};

// Player controller
const Player = {
    audio: null,
    progressTimer: null,

    // Crossfade & Radio state
    _crossfadeAudio: null,      // the second audio element used during crossfade
    _isCrossfading: false,      // true while a crossfade transition is in progress
    _crossfadeInterval: null,   // the interval that drives the volume ramp
    _fetchingRadio: false,      // prevents duplicate radio fetches
    _prefetchingRadio: false,   // prevents duplicate auto-radio pre-fetches
    _autoRadioSeedId: null,     // track Store.nextAutoTrack was pre-fetched for
    _playedRadioTrackIds: [],   // ring buffer preventing auto-radio loops
    _playedSongFingerprints: [], // ring buffer preventing duplicate/slowed/sped-up variants
    _shuffleNextId: null,       // sticky shuffle pick (see _resolveNextTrack)
    _errorRetries: 0,           // consecutive stream retries for the same track
    _errorRetryTrackId: null,

    _recordPlayedTrack(trackOrId, optTitle, optArtist) {
        if (!trackOrId) return;
        const id = typeof trackOrId === 'string' ? trackOrId : trackOrId.id;
        const title = (typeof trackOrId === 'object' && trackOrId.title) || optTitle || '';
        const artist = (typeof trackOrId === 'object' && (trackOrId.channel?.name || trackOrId.artist)) || optArtist || '';
        if (id) {
            this._playedRadioTrackIds = [id, ...(this._playedRadioTrackIds || []).filter(x => x !== id)].slice(0, 60);
        }
        if (title) {
            const fp = getSongFingerprint(title, artist);
            if (fp) {
                this._playedSongFingerprints = [fp, ...(this._playedSongFingerprints || []).filter(x => x !== fp)].slice(0, 60);
            }
        }
    },

    // Stream URL for a track, preferring the offline copy when we have one.
    _streamUrlFor(track) {
        if (!track || !track.id) return '';
        return Store.isDownloaded(track.id)
            ? getApiUrl(`/api/downloads/audio/${track.id}`)
            : getApiUrl(`/api/stream?id=${track.id}`);
    },

    init() {
        this.audio = document.getElementById('audio-player');
        this.audio.addEventListener('ended', () => this.onEnded());
        this.audio.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audio.addEventListener('error', (e) => this.onError(e));
        
        this.audio.addEventListener('play', () => {
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri !== 'function') {
                window.AndroidMediaSession.updatePlaybackState(true, Math.round(this.audio.currentTime * 1000));
            }
        });
        this.audio.addEventListener('pause', () => {
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri !== 'function') {
                window.AndroidMediaSession.updatePlaybackState(false, Math.round(this.audio.currentTime * 1000));
            }
        });
        
        // Restore volume from localStorage
        const savedVol = localStorage.getItem('volume');
        if (savedVol !== null) {
            this.audio.volume = parseFloat(savedVol);
            const slider = document.getElementById('volume-slider');
            if (slider) slider.value = Math.round(this.audio.volume * 100);
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.setVolume === 'function') {
                window.AndroidMediaSession.setVolume(parseFloat(savedVol));
            }
        }
        
        // Start progress polling
        this.progressTimer = setInterval(() => this.updateProgress(), 250);
        
        // Initial sync of playback context (like repeat/shuffle restored from localStorage)
        this._pushNextTrackToNative();
    },
    
    // -----------------------------------------------------------------------
    // Determine the next track (shared by playNext, crossfade, and auto-radio)
    // Returns { track } or null if nothing to play.
    //
    // Options:
    //   honorRepeatOne ΓÇö false for a manual skip, so pressing Next in Repeat
    //                    One moves on instead of replaying the same song.
    //   commit         ΓÇö true only for the caller that is actually about to
    //                    play. Everything else (carousel art, native "next
    //                    track" hint, the crossfade poll that runs 4x/second)
    //                    peeks, so resolving must not mutate the queue.
    // -----------------------------------------------------------------------
    _resolveNextTrack(options = {}) {
        const honorRepeatOne = options.honorRepeatOne !== false;
        const commit = options.commit === true;
        if (!Store.currentTrack) return null;

        if (honorRepeatOne && Store.repeat === 'one') {
            return { track: Store.currentTrack };
        }

        const curId = Store.currentTrack.id;
        let upcoming = (Store.queue || []).filter(t => t && t.id && t.id !== curId);

        // Queue exhausted but Repeat All is on ΓÇö wrap around the context.
        if (upcoming.length === 0 && Store.repeat === 'all') {
            const wrap = this._contextWrapOrder(curId);
            if (wrap.length === 0) return null;
            if (commit) this._commitContextWrap(curId);
            upcoming = wrap.filter(t => t.id !== curId);
            // A single-track context: Repeat All behaves like Repeat One.
            if (upcoming.length === 0) return { track: wrap[0] };
        }

        if (upcoming.length === 0) return null;

        if (Store.shuffle) {
            // Stick to one pick until it is actually played. Re-rolling on every
            // peek made the carousel's "next" art, the track pushed to the
            // notification, and the track that really played all disagree.
            let pick = upcoming.find(t => t.id === this._shuffleNextId);
            if (!pick) {
                pick = upcoming[Math.floor(Math.random() * upcoming.length)];
                this._shuffleNextId = pick.id;
            }
            return { track: pick };
        }
        return { track: upcoming[0] };
    },

    // The playback context ΓÇö the list Repeat All wraps around ΓÇö with any
    // duplicate or malformed entries dropped. Store.originalQueue is written
    // from several places, so every reader normalises through here.
    _contextTracks() {
        const seen = new Set();
        return (Store.originalQueue || []).filter(t => {
            if (!t || !t.id || seen.has(t.id)) return false;
            seen.add(t.id);
            return true;
        });
    },

    // Repeat All wrap order: everything after the current track, then back
    // round to and including it. Re-filtering the raw context instead meant the
    // "next" was always whichever track sat at the top of the list, so after one
    // lap playback ping-ponged between the first two entries and the rest of the
    // list was never reached again. Mirrors PlaybackQueue.computeNext().
    _contextWrapOrder(curId) {
        const ctx = this._contextTracks();
        if (ctx.length === 0) return [];
        const i = ctx.findIndex(t => t.id === curId);
        return i >= 0 ? ctx.slice(i + 1).concat(ctx.slice(0, i + 1)) : ctx.slice();
    },

    // Finds the fullest record we hold for a track id. Ordered by how complete
    // the record is, because the loser gets written into Recents: queue and
    // context entries are full API objects, whereas the payload native sends
    // carries no duration. Add new sources to this list rather than to the
    // callers.
    _findKnownTrack(id) {
        if (!id) return null;
        const auto = Store.nextAutoTrack;
        if (auto && auto.id === id) return auto;
        const sources = [Store.queue, Store.originalQueue, Store.history, Store.recentlyPlayed];
        for (const list of sources) {
            const hit = (list || []).find(t => t && t.id === id);
            if (hit) return hit;
        }
        return null;
    },

    // Last resort: build a track from what native told us. Degraded (no
    // duration), so only used when nothing better is on hand.
    _trackFromNativeInfo(info, expectedId) {
        if (!info || !info.id || info.id !== expectedId) return null;
        return {
            id: info.id,
            title: info.title || '',
            thumbnail: info.thumbnail || '',
            channel: { name: info.artist || '' },
            durationInSec: 0,
        };
    },

    // The five fields native needs to describe a track.
    _nativeTrackFields(t) {
        return {
            id: t.id || '',
            streamUrl: this._streamUrlFor(t),
            title: t.title || '',
            artist: (t.channel && t.channel.name) || t.artist || 'Unknown',
            thumbnail: t.thumbnail || '',
        };
    },

    _setNativeNextTrack(t) {
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.setNextTrackInfo === 'function') {
            const n = this._nativeTrackFields(t);
            window.AndroidMediaSession.setNextTrackInfo(n.id, n.streamUrl, n.title, n.artist, n.thumbnail);
        }
    },

    // Mirror the playback context to native so it can keep advancing correctly
    // while this WebView is throttled with the screen off.
    //
    // This runs on every track change, every queue edit and every
    // shuffle/repeat toggle. Serialising a 500-track "Play All" context each
    // time meant ~150KB of JSON built on the UI thread, marshalled across the
    // bridge and re-parsed into objects in Java ΓÇö a frame hitch at exactly the
    // moment the UI is busiest. The context is byte-identical for a whole
    // listening session, so both payloads are compared against the last push
    // and the bridge call is skipped outright when nothing changed.
    _syncPlaybackContextToNative() {
        const ams = window.AndroidMediaSession;
        if (!ams || typeof ams.setPlaybackContext !== 'function') return;

        const curId = (Store.currentTrack && Store.currentTrack.id) || '';
        const upcomingJson = JSON.stringify(
            (Store.queue || [])
                .filter(t => t && t.id && t.id !== curId)
                .map(t => this._nativeTrackFields(t)));
        // The full context, not just what's left: native Repeat All wraps
        // around this. Sending only the shrinking queue made each lap shorter
        // than the last until it looped one track forever.
        const contextJson = JSON.stringify(
            this._contextTracks().map(t => this._nativeTrackFields(t)));
        const repeat = Store.repeat || 'none';
        const shuffle = !!Store.shuffle;
        const autoplay = !!Store.autoplayEnabled;

        const last = this._lastNativeContext;
        if (last && last.upcomingJson === upcomingJson && last.contextJson === contextJson &&
            last.curId === curId && last.repeat === repeat &&
            last.shuffle === shuffle && last.autoplay === autoplay) {
            return;
        }
        const applied = ams.setPlaybackContext(
            upcomingJson, contextJson, curId, repeat, shuffle, autoplay);
        // Native drops the queue from a push whose current track is not the one
        // it is playing. Caching a rejected push as delivered would suppress the
        // retry and silently lose whatever queue edit it carried.
        this._lastNativeContext = applied === false
            ? null
            : { upcomingJson, contextJson, curId, repeat, shuffle, autoplay };
    },

    // Refill an exhausted queue from the context. Both the JS-driven path
    // (_resolveNextTrack) and the native-driven one (_onNativeAdvanced) need
    // this, so the semantics live in one place.
    _commitContextWrap(curId) {
        const wrap = this._contextWrapOrder(curId);
        if (wrap.length === 0) return false;
        Store.queue = wrap;
        Store.emit('queueChanged');
        return true;
    },

    // Applies a new playback context. `newQueue` is the full list the user
    // tapped into; only the tracks *after* the tapped one are up next.
    _applyQueueContext(track, newQueue, fromHistory) {
        if (Array.isArray(newQueue) && newQueue.length > 0) {
            const seen = new Set();
            const dedup = [];
            newQueue.forEach(t => {
                if (t && t.id && !seen.has(t.id)) { seen.add(t.id); dedup.push(t); }
            });
            const idx = dedup.findIndex(t => t.id === track.id);
            // Playing track 5 of a playlist must continue with 6, 7, 8 ΓÇö not
            // jump back to track 1.
            Store.queue = idx >= 0 ? dedup.slice(idx + 1) : dedup.filter(t => t.id !== track.id);
            Store.originalQueue = dedup;
            // Only a real multi-track context (Play All, a playlist, an album)
            // starts a new session. Tapping one search result shouldn't wipe the
            // back-stack.
            if (!fromHistory && dedup.length > 1) Store.history = [];
            return;
        }

        const wasQueued = (Store.queue || []).some(t => t && t.id === track.id);
        Store.queue = (Store.queue || []).filter(t => t && t.id !== track.id);

        if ((Store.originalQueue || []).some(t => t && t.id === track.id)) return;

        if (wasQueued && Store.originalQueue && Store.originalQueue.length > 0) {
            // Manually queued (swipe-to-queue) while a playlist was playing:
            // remember it without throwing away the surrounding context.
            Store.originalQueue = [...Store.originalQueue, track];
            return;
        }

        // The track has nothing to do with the remembered context, so drop it.
        // Otherwise Repeat All resurrects an unrelated old list ΓÇö the classic
        // "my queue suddenly started playing my Liked Songs".
        Store.originalQueue = [track, ...Store.queue];
    },

    playTrack(track, newQueue = null, options = {}) {
        if (!track || !track.id) return;
        // If we're in the middle of a crossfade, clean it up first
        this._cleanupCrossfade();

        if (!options.fromHistory && Store.currentTrack && Store.currentTrack.id !== track.id) {
            // Capped: an unbounded history grows the heap for the whole session.
            Store.history = [...Store.history, Store.currentTrack].slice(-100);
        }

        Store.currentTrack = track;
        Store.isPlaying = true;
        this._recordPlayedTrack(track);
        this._shuffleNextId = null;
        this._errorRetries = 0;
        this._errorRetryTrackId = track.id;

        this._applyQueueContext(track, newQueue, !!options.fromHistory);

        Store.addToRecent(track);
        Store.emit('queueChanged');

        // Sync to native media session
        if (window.AndroidMediaSession) {
            const durMs = Math.round((track.durationInSec || 0) * 1000);
            window.AndroidMediaSession.updateMetadata(track.title || '', track.channel?.name || 'Unknown', track.thumbnail || '', durMs);
            window.AndroidMediaSession.updatePlaybackState(true, 0, durMs);
        }

        const url = this._streamUrlFor(track);

        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
            window.AndroidMediaSession.playUri(url, track.id, !!options.fromHistory, false, 0);
        } else {
            // Set audio source via Flask stream endpoint
            this.audio.src = url;
            // Restore volume in case crossfade had ramped it
            const savedVol = localStorage.getItem('volume');
            this.audio.volume = savedVol !== null ? parseFloat(savedVol) : 1;
            this.audio.play().catch(e => console.error('Play error:', e));
        }
        
        this.showPlayerBar();
        this.updatePlayerUI();
        Store.emit('trackChanged');
        this._pushNextTrackToNative();
    },
    
    // Crossfade-aware version: starts the next track via crossfade instead of hard-cut
    // Crossfade-aware version: starts the next track via crossfade instead of hard-cut
    _playTrackCrossfade(track) {
        if (!track || !track.id) return;
        if (Store.currentTrack && Store.currentTrack.id !== track.id) {
            Store.history = [...Store.history, Store.currentTrack].slice(-100);
        }

        Store.currentTrack = track;
        Store.isPlaying = true;
        // Crossfaded tracks used to skip both of these, so the queue kept
        // showing the song that was already playing and auto-radio could serve
        // it again a few tracks later.
        this._recordPlayedTrack(track.id);
        this._shuffleNextId = null;
        Store.queue = (Store.queue || []).filter(t => t && t.id !== track.id);
        if (!Store.originalQueue || !Store.originalQueue.some(t => t && t.id === track.id)) {
            Store.originalQueue = [track, ...Store.queue];
        }
        // Same Repeat All refill the other two "become the current track" paths
        // do. Crossfade was the one that never got it, so with crossfade on, a
        // looping playlist stopped looping once the queue drained.
        if (Store.queue.length === 0 && Store.repeat === 'all') {
            this._commitContextWrap(track.id);
        }
        Store.addToRecent(track);
        Store.emit('queueChanged');
        this._crossfadeTrackId = track.id;

        // Sync to native media session
        if (window.AndroidMediaSession) {
            const durMs = Math.round((track.durationInSec || 0) * 1000);
            window.AndroidMediaSession.updateMetadata(track.title || '', track.channel?.name || 'Unknown', track.thumbnail || '', durMs);
            window.AndroidMediaSession.updatePlaybackState(true, 0, durMs);
        }

        const url = this._streamUrlFor(track);
        const rawCfDuration = Store.crossfadeDuration || 5;
        const currentDur = (this.audio && this.audio.duration) ? this.audio.duration : 30;
        const effectiveCfDuration = Math.max(1, Math.min(rawCfDuration, currentDur * 0.4));
        
        this._isCrossfading = true;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
            window.AndroidMediaSession.playUri(url, track.id, false, true, Math.round(effectiveCfDuration * 1000));
            setTimeout(() => {
                this._isCrossfading = false;
            }, Math.round(effectiveCfDuration * 1000));
        } else {
            // Clean up any stale crossfade instance first
            if (this._crossfadeInterval) {
                clearInterval(this._crossfadeInterval);
                this._crossfadeInterval = null;
            }
            if (this._crossfadeAudio) {
                try {
                    this._crossfadeAudio.pause();
                    this._crossfadeAudio.src = '';
                } catch(e) {}
                this._crossfadeAudio = null;
            }

            // Create new audio element for incoming track
            this._crossfadeAudio = new Audio();
            this._crossfadeAudio.preload = 'auto';
            this._crossfadeAudio.src = url;
            this._crossfadeAudio.volume = 0;
            
            // Listeners for incoming crossfade audio. `loadedmetadata` matters
            // too: this element is promoted to the primary player once the ramp
            // finishes, and without it the total-time label stops updating.
            this._crossfadeAudio.addEventListener('ended', () => this.onEnded());
            this._crossfadeAudio.addEventListener('error', (e) => this.onError(e));
            this._crossfadeAudio.addEventListener('loadedmetadata', () => this.updateDuration());
            this._crossfadeAudio.addEventListener('play', () => {
                if (window.AndroidMediaSession) {
                    window.AndroidMediaSession.updatePlaybackState(true, Math.round((this._crossfadeAudio || this.audio).currentTime * 1000));
                }
            });
            this._crossfadeAudio.addEventListener('pause', () => {
                if (window.AndroidMediaSession) {
                    window.AndroidMediaSession.updatePlaybackState(false, Math.round((this._crossfadeAudio || this.audio).currentTime * 1000));
                }
            });
            
            // Start volume ramp ONLY once the incoming audio has actually started playing
            let rampStarted = false;
            const startRamp = () => {
                if (rampStarted) return;
                rampStarted = true;
                
                const durationMs = effectiveCfDuration * 1000;
                const steps = 40;
                const interval = Math.max(10, durationMs / steps);
                let step = 0;
                
                const oldAudio = this.audio;
                const savedVol = localStorage.getItem('volume');
                const targetVol = savedVol !== null ? parseFloat(savedVol) : 1;
                const startVol = oldAudio ? oldAudio.volume : targetVol;
                
                this._crossfadeInterval = setInterval(() => {
                    step++;
                    const progress = Math.min(step / steps, 1);
                    // Equal-Power Crossfade curve (constant acoustic energy, no volume dip!)
                    const outVol = Math.cos(progress * Math.PI / 2);
                    const inVol = Math.sin(progress * Math.PI / 2);
                    
                    if (oldAudio) {
                        try { oldAudio.volume = Math.max(0, startVol * outVol); } catch(e) {}
                    }
                    if (this._crossfadeAudio) {
                        try { this._crossfadeAudio.volume = Math.min(1, Math.max(0, targetVol * inVol)); } catch(e) {}
                    }
                    
                    if (step >= steps) {
                        clearInterval(this._crossfadeInterval);
                        this._crossfadeInterval = null;
                        
                        if (oldAudio) {
                            try {
                                oldAudio.pause();
                                oldAudio.src = '';
                            } catch(e) {}
                        }
                        
                        // Promote new crossfade audio to primary audio player
                        if (this._crossfadeAudio) {
                            this.audio = this._crossfadeAudio;
                            this.audio.volume = targetVol;
                            this._crossfadeAudio = null;
                        }
                        this._isCrossfading = false;
                    }
                }, interval);
            };

            this._crossfadeAudio.addEventListener('playing', startRamp, { once: true });
            
            this._crossfadeAudio.play().catch(e => {
                console.error('Crossfade play error:', e);
                this._cleanupCrossfade();
                this.playTrack(track);
            });
        }
        
        this.showPlayerBar();
        this.updatePlayerUI();
        Store.emit('trackChanged');
        this._pushNextTrackToNative();
    },
    
    _cleanupCrossfade() {
        if (this._crossfadeInterval) {
            clearInterval(this._crossfadeInterval);
            this._crossfadeInterval = null;
        }
        if (this._crossfadeAudio) {
            try {
                this._crossfadeAudio.pause();
                this._crossfadeAudio.src = '';
            } catch(e) {}
            this._crossfadeAudio = null;
        }
        this._isCrossfading = false;
        this._crossfadeTrackId = null;
    },
    
    togglePlay() {
        if (!Store.currentTrack) return;
        
        const nextState = !Store.isPlaying;
        Store.isPlaying = nextState;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.pausePlayback === 'function') {
            if (!nextState) {
                window.AndroidMediaSession.pausePlayback();
            } else {
                window.AndroidMediaSession.resumePlayback();
            }
            const curPos = typeof window.AndroidMediaSession.getCurrentPosition === 'function'
                ? window.AndroidMediaSession.getCurrentPosition()
                : 0;
            const curDur = typeof window.AndroidMediaSession.getDuration === 'function'
                ? window.AndroidMediaSession.getDuration()
                : 0;
            window.AndroidMediaSession.updatePlaybackState(nextState, Math.round(curPos), Math.round(curDur));
        } else {
            const active = this._isCrossfading && this._crossfadeAudio ? this._crossfadeAudio : this.audio;
            if (!nextState) {
                active.pause();
            } else {
                active.play().catch(e => console.error('Play error:', e));
            }
            if (window.AndroidMediaSession) {
                const dur = Math.round((active.duration || Store.currentTrack?.durationInSec || 0) * 1000);
                window.AndroidMediaSession.updatePlaybackState(nextState, Math.round(active.currentTime * 1000), dur);
            }
        }
        
        this.updatePlayerUI();
        this.updatePlayButton();
        Store.emit('playerUpdate');
    },
    
    playNext() {
        // A manual skip must move forward even in Repeat One. Honouring it here
        // made the Next button replay the same song, which read as "the song
        // repeats for no reason".
        const next = this._resolveNextTrack({ honorRepeatOne: false, commit: true });
        if (next) {
            // playTrack removes the track from the queue itself.
            this.playTrack(next.track);
            return;
        }

        const auto = Store.nextAutoTrack;
        if (auto && auto.id && auto.id !== (Store.currentTrack && Store.currentTrack.id)) {
            Store.nextAutoTrack = null;
            this._autoRadioSeedId = null;
            this.playTrack(auto);
            return;
        }
        Store.nextAutoTrack = null;

        // Queue is empty ΓÇö manual skip next fetches and plays a similar song immediately
        if (Store.currentTrack && !this._fetchingRadio) {
            this._fetchRadioAndPlay();
        }
    },

    _fetchRadioAndPlay() {
        if (this._fetchingRadio || !Store.currentTrack) return;
        this._fetchingRadio = true;
        
        const track = Store.currentTrack;
        const playedIds = [
            ...(Store.queue || []).map(t => t && t.id),
            ...(Store.history || []).map(t => t && t.id),
            ...(this._playedRadioTrackIds || [])
        ].filter(Boolean);
        if (track && track.id) playedIds.push(track.id);

        const playedFPs = new Set(this._playedSongFingerprints || []);
        if (track && track.title) {
            const curFp = getSongFingerprint(track.title, track.channel?.name || track.artist);
            if (curFp) playedFPs.add(curFp);
        }

        const params = new URLSearchParams({
            id: track.id,
            title: track.title || '',
            artist: track.channel?.name || track.artist || '',
            excludeIds: playedIds.join(','),
        });
        
        fetchWithRetry(getApiUrl(`/api/radio?${params.toString()}`))
            .then(r => r.json())
            .then(tracks => {
                this._fetchingRadio = false;
                if (!tracks || !tracks.length) return;
                
                const existingIds = new Set(playedIds);
                const newTracks = tracks.filter(t => {
                    if (!t || !t.id || existingIds.has(t.id)) return false;
                    const fp = getSongFingerprint(t.title, t.channel?.name || t.artist);
                    if (fp && playedFPs.has(fp)) return false;
                    return true;
                });

                if (newTracks.length > 0) {
                    this.playTrack(newTracks[0]);
                    return;
                }
                // Fall back to anything that isn't currently playing and isn't the seed
                const fallbackTrack = tracks.find(
                    t => t && t.id && t.id !== (Store.currentTrack && Store.currentTrack.id));
                if (fallbackTrack) this.playTrack(fallbackTrack);
            })
            .catch(e => {
                this._fetchingRadio = false;
                console.error('Radio fetch failed:', e);
            });
    },
    
    playPrev(forcePrevious = false) {
        if (!Store.currentTrack) return;
        
        let curTime = 0;
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.getCurrentPosition === 'function') {
            curTime = window.AndroidMediaSession.getCurrentPosition() / 1000;
        } else {
            curTime = this.audio.currentTime;
        }
        
        if (!forcePrevious && curTime > 3) {
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.seekTo === 'function') {
                window.AndroidMediaSession.seekTo(0);
            } else {
                this.audio.currentTime = 0;
            }
            return;
        }
        
        if (Store.history.length > 0) {
            const prev = Store.history[Store.history.length - 1];
            Store.history = Store.history.slice(0, -1);
            // fromHistory: don't push the current track back onto the history
            // stack (that made Previous ping-pong between two songs forever)
            // and don't let the queue be redefined by going backwards.
            const wasCurrent = Store.currentTrack;
            this.playTrack(prev, null, { fromHistory: true });
            if (wasCurrent && wasCurrent.id !== prev.id &&
                !(Store.queue || []).some(t => t && t.id === wasCurrent.id)) {
                // The song we just left becomes the next one up again.
                Store.queue = [wasCurrent, ...(Store.queue || [])];
                Store.emit('queueChanged');
                this._pushNextTrackToNative();
            }
        } else {
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.seekTo === 'function') {
                window.AndroidMediaSession.seekTo(0);
            } else if (this.audio) {
                this.audio.currentTime = 0;
            }
        }
    },

    onEnded() {
        // If we're in a crossfade, the old track ended naturally ΓÇö just clean up
        if (this._isCrossfading) return;

        if (Store.repeat === 'one' && Store.currentTrack) {
            this.updateRepeatUI();
            this._pushNextTrackToNative();
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
                // Use the offline copy when there is one; the old code always
                // hit /api/stream, so Repeat One broke with no connection.
                window.AndroidMediaSession.playUri(this._streamUrlFor(Store.currentTrack), Store.currentTrack.id, false, false, 0);
            } else if (this.audio) {
                this.audio.currentTime = 0;
                this.audio.play().catch(e => console.error('Play error:', e));
            }
            return;
        }
        this.playNext();
    },

    onError(e) {
        console.error('Audio error:', e);
        if (!Store.currentTrack) return;

        // Bounded retries. Re-assigning src fires another `error` event when the
        // stream is genuinely dead, so the old unguarded retry looped on the
        // same track forever instead of moving on.
        if (this._errorRetryTrackId !== Store.currentTrack.id) {
            this._errorRetryTrackId = Store.currentTrack.id;
            this._errorRetries = 0;
        }
        if (this._errorRetries >= 2) {
            this._errorRetries = 0;
            this.playNext();
            return;
        }
        this._errorRetries++;

        const retryUrl = Store.isDownloaded(Store.currentTrack.id)
            ? this._streamUrlFor(Store.currentTrack)
            : getApiUrl(`/api/stream?id=${Store.currentTrack.id}&t=${Date.now()}`);
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
            window.AndroidMediaSession.playUri(retryUrl, Store.currentTrack.id, false, false, 0);
        } else if (this.audio) {
            this.audio.src = retryUrl;
            this.audio.play().catch(() => this.playNext());
        }
    },

    seekTo(event) {
        const rect = event.currentTarget.getBoundingClientRect();
        const pct = (event.clientX - rect.left) / rect.width;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.seekTo === 'function') {
            const duration = window.AndroidMediaSession.getDuration();
            if (duration) {
                window.AndroidMediaSession.seekTo(Math.round(pct * duration));
            }
        } else {
            const active = this._isCrossfading && this._crossfadeAudio ? this._crossfadeAudio : this.audio;
            if (active.duration) {
                active.currentTime = pct * active.duration;
            }
        }
    },
    
    seekToTime(seconds) {
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.seekTo === 'function') {
            window.AndroidMediaSession.seekTo(Math.round(seconds * 1000));
        } else {
            const active = this._isCrossfading && this._crossfadeAudio ? this._crossfadeAudio : this.audio;
            if (active) active.currentTime = seconds;
        }
    },
    
    setVolume(val) {
        const v = val / 100;
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.setVolume === 'function') {
            window.AndroidMediaSession.setVolume(v);
        } else {
            if (this.audio) this.audio.volume = v;
            if (this._crossfadeAudio) this._crossfadeAudio.volume = v;
        }
        localStorage.setItem('volume', String(v));
    },
    
    toggleMute() {
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.setVolume === 'function') {
            // Simple mute toggling
            const savedVol = localStorage.getItem('volume');
            const currentVol = savedVol !== null ? parseFloat(savedVol) : 1;
            if (currentVol > 0) {
                window.AndroidMediaSession.setVolume(0);
                localStorage.setItem('volume', '0');
            } else {
                window.AndroidMediaSession.setVolume(0.5);
                localStorage.setItem('volume', '0.5');
            }
        } else {
            this.audio.muted = !this.audio.muted;
        }
    },
    
    toggleShuffle() {
        Store.shuffle = !Store.shuffle;
        this._shuffleNextId = null;
        Store.save();
        const btn = document.getElementById('shuffle-btn');
        if (btn) btn.classList.toggle('active', Store.shuffle);
        const mobBtn = document.getElementById('mobile-shuffle-btn');
        if (mobBtn) mobBtn.classList.toggle('active', Store.shuffle);
        this._pushNextTrackToNative();
    },
    
    updateRepeatUI() {
        const btn = document.getElementById('repeat-btn');
        if (btn) {
            btn.classList.toggle('active', Store.repeat !== 'none');
            btn.title = `Repeat: ${Store.repeat}`;
            btn.innerHTML = REPEAT_ICONS[Store.repeat];
        }
        
        const mobBtn = document.getElementById('mobile-repeat-btn');
        if (mobBtn) {
            mobBtn.classList.toggle('active', Store.repeat !== 'none');
            mobBtn.title = `Repeat: ${Store.repeat}`;
            mobBtn.innerHTML = REPEAT_ICONS[Store.repeat];
        }
    },
    
    cycleRepeat() {
        const modes = ['none', 'all', 'one'];
        const idx = modes.indexOf(Store.repeat);
        Store.repeat = modes[(idx + 1) % 3];
        Store.save();
        this.updateRepeatUI();
        this._pushNextTrackToNative();
    },

    _pushNextTrackToNative() {
        const next = this._resolveNextTrack();
        if (next && next.track) {
            Store.nextAutoTrack = null;
            this._autoRadioSeedId = null;
            const t = next.track;
            if (t.thumbnail) preloadImage(t.thumbnail);
            this._setNativeNextTrack(t);
        } else if (Store.autoplayEnabled && Store.currentTrack &&
                   !this._prefetchingRadio &&
                   !(Store.nextAutoTrack && this._autoRadioSeedId === Store.currentTrack.id)) {
            const track = Store.currentTrack;
            // This runs on every queue edit, shuffle/repeat toggle and track
            // change. Without the guards above, each one kicked off another
            // 5-retry radio request and whichever landed last silently changed
            // what plays next.
            this._prefetchingRadio = true;
            this._autoRadioSeedId = track.id;

            const playedIds = [
                ...(Store.queue || []).map(t => t && t.id),
                ...(Store.history || []).map(t => t && t.id),
                ...(this._playedRadioTrackIds || [])
            ].filter(Boolean);
            if (track && track.id) playedIds.push(track.id);

            const playedFPs = new Set(this._playedSongFingerprints || []);
            if (track && track.title) {
                const curFp = getSongFingerprint(track.title, track.channel?.name || track.artist);
                if (curFp) playedFPs.add(curFp);
            }

            const params = new URLSearchParams({
                id: track.id,
                title: track.title || '',
                artist: track.channel?.name || track.artist || '',
                excludeIds: playedIds.join(','),
            });
            fetchWithRetry(getApiUrl(`/api/radio?${params.toString()}`))
                .then(r => r.json())
                .then(tracks => {
                    this._prefetchingRadio = false;
                    if (!tracks || !tracks.length) return;
                    // The seed may have changed while the request was in flight.
                    if (!Store.currentTrack || Store.currentTrack.id !== track.id) return;

                    const playedSet = new Set(playedIds);
                    const filteredRadio = tracks.filter(t => {
                        if (!t || !t.id || playedSet.has(t.id)) return false;
                        const fp = getSongFingerprint(t.title, t.channel?.name || t.artist);
                        if (fp && playedFPs.has(fp)) return false;
                        return true;
                    });
                    const firstNew = filteredRadio.length > 0
                        ? filteredRadio[0]
                        : tracks.find(t => t && t.id && t.id !== Store.currentTrack.id);

                    if (!firstNew) return;
                    Store.nextAutoTrack = firstNew;
                    if (firstNew.thumbnail) preloadImage(firstNew.thumbnail);

                    // Pre-fetch stream URL for auto-radio track
                    fetch(getApiUrl('/api/prefetch?ids=' + firstNew.id)).catch(() => {});

                    this._setNativeNextTrack(firstNew);

                    // Update mobile player overlay carousel next slide if open
                    const overlay = document.getElementById('mobile-player-overlay');
                    if (overlay && overlay.style.display === 'flex') {
                        const nextSlide = document.getElementById('art-slide-next');
                        if (nextSlide && firstNew.thumbnail) {
                            nextSlide.innerHTML = `<img src="${escapeAttr(firstNew.thumbnail)}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">`;
                        }
                    }
                })
                .catch(() => { this._prefetchingRadio = false; });
        } else if (!Store.autoplayEnabled || !Store.currentTrack) {
            Store.nextAutoTrack = null;
            this._autoRadioSeedId = null;
            if (window.AndroidMediaSession && typeof window.AndroidMediaSession.setNextTrackInfo === 'function') {
                window.AndroidMediaSession.setNextTrackInfo('', '', '', '', '');
            }
        }

        // Also pre-cache previous track image from history
        if (Store.history && Store.history.length > 0) {
            const prev = Store.history[Store.history.length - 1];
            if (prev && prev.thumbnail) preloadImage(prev.thumbnail);
        }

        this._syncPlaybackContextToNative();

        // Warm the tracks that actually come next. Store.queue already holds
        // only what is still upcoming, so its head is the right thing to warm;
        // when it runs short and Repeat All is on, the wrap-around tracks from
        // the original context are next instead.
        try {
            const curId = Store.currentTrack && Store.currentTrack.id;
            const upcoming = (Store.queue || []).filter(t => t && t.id && t.id !== curId).slice(0, 3);
            if (upcoming.length < 3 && Store.repeat === 'all') {
                const have = new Set(upcoming.map(t => t.id));
                (Store.originalQueue || []).forEach(t => {
                    if (upcoming.length >= 3) return;
                    if (t && t.id && t.id !== curId && !have.has(t.id)) {
                        have.add(t.id);
                        upcoming.push(t);
                    }
                });
            }
            // Downloaded tracks need no stream resolution.
            const ids = upcoming.filter(t => !Store.isDownloaded(t.id)).map(t => t.id);
            if (ids.length > 0) {
                fetch(getApiUrl('/api/prefetch?ids=' + ids.join(','))).catch(() => {});
            }
        } catch (e) {}
    },

    // Native advanced on its own (screen off / JS throttled) ΓÇö mirror it in JS.
    // `info` carries the track native actually started, so a song JS has never
    // seen (native's own radio pick) can still be adopted. Without it JS kept
    // the previous track as "current" and the UI, queue and notification all
    // disagreed about what was playing.
    _onNativeAdvanced(nextTrackId, info) {
        if (!nextTrackId) return;
        if (Store.currentTrack && Store.currentTrack.id === nextTrackId) return;

        const track = this._findKnownTrack(nextTrackId) || this._trackFromNativeInfo(info, nextTrackId);
        if (!track) return;

        if (Store.nextAutoTrack && Store.nextAutoTrack.id === track.id) {
            Store.nextAutoTrack = null;
            this._autoRadioSeedId = null;
        }
        if (Store.currentTrack && Store.currentTrack.id !== track.id) {
            Store.history = [...Store.history, Store.currentTrack].slice(-100);
        }
        Store.queue = (Store.queue || []).filter(t => t && t.id !== track.id);
        Store.currentTrack = track;
        Store.isPlaying = true;
        // Native drives playback through this path, so the Repeat All wrap has
        // to be committed here too ΓÇö peeking alone left Store.queue empty and
        // the list never progressed past its first two tracks.
        if (Store.queue.length === 0 && Store.repeat === 'all') {
            this._commitContextWrap(track.id);
        }
        // Without this the radio ring buffer never learned about tracks native
        // played, so it happily served them again a few songs later.
        this._recordPlayedTrack(track);
        this._shuffleNextId = null;
        Store.addToRecent(track);
        Store.emit('queueChanged');
        this.showPlayerBar();
        this.updatePlayerUI();
        this._pushNextTrackToNative();
        Store.emit('trackChanged');
    },

    // Native went *backwards* (Previous on a notification, lock screen or car
    // head unit). Mirrors _onNativeAdvanced but pops history instead of pushing
    // to it, and puts the track we left back at the head of the queue.
    _onNativeWentBack(trackId, info) {
        if (!trackId) return;
        if (Store.currentTrack && Store.currentTrack.id === trackId) return;

        const track = this._findKnownTrack(trackId) || this._trackFromNativeInfo(info, trackId);
        if (!track) return;

        const leaving = Store.currentTrack;
        Store.history = (Store.history || []).filter(t => t && t.id !== track.id);
        Store.currentTrack = track;
        Store.isPlaying = true;
        this._shuffleNextId = null;
        Store.queue = (Store.queue || []).filter(t => t && t.id !== track.id);
        if (leaving && leaving.id !== track.id &&
            !Store.queue.some(t => t && t.id === leaving.id)) {
            Store.queue = [leaving, ...Store.queue];
        }
        Store.addToRecent(track);
        Store.emit('queueChanged');
        this.showPlayerBar();
        this.updatePlayerUI();
        this._pushNextTrackToNative();
        Store.emit('trackChanged');
    },

    // Native handled a play/pause from outside the app; just mirror the state.
    _onNativePlaybackToggled(isPlaying) {
        Store.isPlaying = !!isPlaying;
        this.updatePlayButton();
        this.updatePlayerUI();
        Store.emit('playerUpdate');
    },

    // Native ran out of queue with Autoplay off. Settle into a paused state at
    // the end of the last track instead of leaving the UI claiming it's playing.
    _onPlaybackFinished() {
        Store.isPlaying = false;
        Store.nextAutoTrack = null;
        this._autoRadioSeedId = null;
        if (window.AndroidMediaSession &&
            typeof window.AndroidMediaSession.updatePlaybackState === 'function') {
            // Report where playback actually stopped. Sending 0 snapped the
            // lock-screen scrubber to the start, and the next progress tick
            // snapped it straight back to the end.
            const pos = typeof window.AndroidMediaSession.getCurrentPosition === 'function'
                ? Math.round(window.AndroidMediaSession.getCurrentPosition())
                : 0;
            window.AndroidMediaSession.updatePlaybackState(false, pos);
        }
        this.updatePlayButton();
        this.updatePlayerUI();
        Store.emit('playerUpdate');
    },

    _onPlaybackStalled() {
        Store.isPlaying = false;
        this._fetchingRadio = false;
        if (window.AndroidMediaSession &&
            typeof window.AndroidMediaSession.updatePlaybackState === 'function') {
            window.AndroidMediaSession.updatePlaybackState(false, 0);
        }
        this.updatePlayButton();
    },
    
    updateProgress() {
        if (!Store.currentTrack) return;
        
        let current = 0;
        let duration = 0;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.getCurrentPosition === 'function') {
            current = window.AndroidMediaSession.getCurrentPosition() / 1000;
            duration = window.AndroidMediaSession.getDuration() / 1000;
            // Transport controls can pause or resume while this timer is
            // throttled, so trust the player over our own last-known flag ΓÇö
            // otherwise the first tick after waking pushed a stale state and
            // the notification flipped back to the wrong icon.
            if (typeof window.AndroidMediaSession.isPlayingNative === 'function') {
                const reallyPlaying = window.AndroidMediaSession.isPlayingNative();
                if (reallyPlaying !== Store.isPlaying) {
                    Store.isPlaying = reallyPlaying;
                    this.updatePlayButton();
                }
            }
        } else {
            if (!this.audio) return;
            const active = this._isCrossfading && this._crossfadeAudio ? this._crossfadeAudio : this.audio;
            current = active.currentTime || 0;
            duration = active.duration || 0;
        }
        
        if (duration <= 0 && Store.currentTrack && Store.currentTrack.durationInSec) {
            duration = Store.currentTrack.durationInSec;
        }

        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.updatePlaybackState === 'function') {
            const posMs = Math.round(current * 1000);
            const durMs = Math.round(duration * 1000);
            window.AndroidMediaSession.updatePlaybackState(Store.isPlaying, posMs, durMs);
        }
        
        if (window._isScrubbing) return;
        
        const pct = duration > 0 ? (current / duration) * 100 : 0;
        
        const fill = document.getElementById('progress-fill');
        if (fill) fill.style.width = pct + '%';
        const thumb = document.getElementById('progress-thumb');
        if (thumb) thumb.style.left = pct + '%';
        
        const miniFill = document.getElementById('mini-progress-fill');
        if (miniFill) miniFill.style.width = pct + '%';
        
        const curEl = document.getElementById('current-time');
        if (curEl) curEl.textContent = formatTime(current);
        
        const totEl = document.getElementById('total-time');
        if (totEl && duration > 0) totEl.textContent = formatTime(duration);
        
        // Update mobile player progress too if visible
        const mobFill = document.getElementById('mobile-progress-fill');
        if (mobFill) mobFill.style.width = pct + '%';
        const mobThumb = document.getElementById('mobile-progress-thumb');
        if (mobThumb) mobThumb.style.left = pct + '%';
        const mobCur = document.getElementById('mobile-current-time');
        if (mobCur) mobCur.textContent = formatTime(current);
        const mobTot = document.getElementById('mobile-total-time');
        if (mobTot && duration > 0) mobTot.textContent = formatTime(duration);
        
        // Update lyrics if visible
        if (window._lyricsData && window._lyricsData.length > 0) {
            updateLyricsHighlight(current);
        }
        
        // --- Crossfade trigger ---
        // Check if we should start crossfading into the next track
        if (Store.crossfadeEnabled && !this._isCrossfading && duration > 0) {
            const remaining = duration - current;
            const cfDuration = Store.crossfadeDuration || 5;
            const effectiveCfDuration = Math.max(1, Math.min(cfDuration, duration * 0.4));
            
            // Trigger when remaining time enters the effective crossfade window and song is past 50%
            if (remaining > 0 && remaining <= effectiveCfDuration && current > duration * 0.5) {
                // Don't crossfade if repeat-one (it restarts the same track)
                if (Store.repeat === 'one') return;
                
                const next = this._resolveNextTrack({ commit: true });
                if (next && next.track.id !== Store.currentTrack.id) {
                    if (this._crossfadeTrackId !== next.track.id) {
                        this._playTrackCrossfade(next.track);
                    }
                    // A queued track exists ΓÇö never fall through to radio.
                    return;
                }

                // Queue is empty: crossfade into a pre-fetched radio track, or
                // fetch one now.
                const auto = Store.nextAutoTrack;
                if (auto && auto.id && auto.id !== Store.currentTrack.id) {
                    if (this._crossfadeTrackId !== auto.id) {
                        Store.nextAutoTrack = null;
                        this._autoRadioSeedId = null;
                        this._playTrackCrossfade(auto);
                    }
                    return;
                }

                if (Store.autoplayEnabled && !this._fetchingRadio) {
                    this._fetchingRadio = true;
                    const track = Store.currentTrack;
                    const playedIds = [
                        ...(Store.queue || []).map(t => t && t.id),
                        ...(this._playedRadioTrackIds || []),
                        Store.currentTrack.id
                    ].filter(Boolean);

                    const playedFPs = new Set(this._playedSongFingerprints || []);
                    if (track && track.title) {
                        const curFp = getSongFingerprint(track.title, track.channel?.name || track.artist);
                        if (curFp) playedFPs.add(curFp);
                    }

                    const params = new URLSearchParams({
                        id: track.id,
                        title: track.title || '',
                        artist: track.channel?.name || track.artist || '',
                        excludeIds: playedIds.join(','),
                    });
                    fetchWithRetry(getApiUrl(`/api/radio?${params.toString()}`))
                        .then(r => r.json())
                        .then(tracks => {
                            this._fetchingRadio = false;
                            if (!tracks || !tracks.length) return;
                            if (!Store.currentTrack || Store.currentTrack.id !== track.id) return;
                            const existingIds = new Set(playedIds);
                            const firstNew = tracks.find(t => {
                                if (!t || !t.id || existingIds.has(t.id)) return false;
                                const fp = getSongFingerprint(t.title, t.channel?.name || t.artist);
                                if (fp && playedFPs.has(fp)) return false;
                                return true;
                            }) || tracks.find(t => t && t.id && t.id !== Store.currentTrack.id);
                            if (firstNew && this._crossfadeTrackId !== firstNew.id) {
                                this._playTrackCrossfade(firstNew);
                            }
                        })
                        .catch(e => {
                            this._fetchingRadio = false;
                            console.error('Radio fetch for crossfade failed:', e);
                        });
                }
            }
        }
    },
    
    updateDuration() {
        const totEl = document.getElementById('total-time');
        if (totEl && this.audio.duration) totEl.textContent = formatTime(this.audio.duration);
    },
    
    showPlayerBar() {
        const bar = document.getElementById('player-bar');
        if (!bar || !Store.currentTrack) return;

        const isSettings = (typeof Router !== 'undefined' && Router.currentRoute && (Router.currentRoute === '/settings' || Router.currentRoute.startsWith('/settings'))) || document.body.classList.contains('page-settings');
        const isMobilePlayerOpen = document.body.classList.contains('mobile-player-open');

        if (isSettings || isMobilePlayerOpen) {
            bar.style.display = 'none';
            return;
        }

        bar.style.display = 'flex';
        const app = document.getElementById('app');
        if (app) app.classList.add('has-player');
    },
    
    updatePlayerUI() {
        const track = Store.currentTrack;
        if (!track) return;
        
        // Trigger animation on song change
        const infoPanel = document.getElementById('player-track-info');
        if (infoPanel && this._lastTrackId !== track.id) {
            this._lastTrackId = track.id;
            infoPanel.classList.remove('animate-song-change');
            void infoPanel.offsetWidth; // trigger reflow
            infoPanel.classList.add('animate-song-change');
        }
        
        const thumb = document.getElementById('player-thumb');
        const name = document.getElementById('player-track-name');
        const artist = document.getElementById('player-track-artist');
        const likeBtn = document.getElementById('player-like-btn');
        
        if (thumb) {
            thumb.src = typeof getTrackThumbnail === 'function' ? getTrackThumbnail(track) : (track.thumbnail || '');
            thumb.onerror = function() { this.onerror = null; if (typeof FALLBACK_IMG !== 'undefined') this.src = FALLBACK_IMG; };
        }
        if (name) name.textContent = track.title || '';
        if (artist) artist.textContent = track.channel?.name || '';
        if (likeBtn) {
            likeBtn.innerHTML = Store.isLiked(track.id)
                ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>'
                : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
            likeBtn.classList.toggle('active', Store.isLiked(track.id));
        }
        
        // Sync repeat button icons
        this.updateRepeatUI();
        
        // Sync shuffle button active state
        const sBtn = document.getElementById('shuffle-btn');
        if (sBtn) {
            sBtn.classList.toggle('active', Store.shuffle);
        }
        
        this.updatePlayButton();
        
        // Sync mobile player overlay if open
        if (typeof updateMobilePlayerUI === 'function') {
            updateMobilePlayerUI();
        }
        
        // Update page title
        document.title = track.title ? `${track.title} - Vamus` : 'Vamus';
    },
    
    updatePlayButton() {
        const playIcon = document.getElementById('play-icon');
        const pauseIcon = document.getElementById('pause-icon');
        if (playIcon && pauseIcon) {
            playIcon.style.display = Store.isPlaying ? 'none' : 'block';
            pauseIcon.style.display = Store.isPlaying ? 'block' : 'none';
        }
        // Mobile play button
        const mobPlay = document.getElementById('mobile-play-icon');
        const mobPause = document.getElementById('mobile-pause-icon');
        if (mobPlay && mobPause) {
            mobPlay.style.display = Store.isPlaying ? 'none' : 'block';
            mobPause.style.display = Store.isPlaying ? 'block' : 'none';
        }
    },
};

// Global helpers
function formatTime(sec) {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// Global player functions called from HTML
function togglePlay() { Player.togglePlay(); }
function playNext() { Player.playNext(); }
function playPrev(forcePrevious = false) { Player.playPrev(forcePrevious); }
function seekTo(event) { Player.seekTo(event); }
function setVolume(val) { Player.setVolume(val); }
function toggleMute() { Player.toggleMute(); }
function toggleShuffle() { Player.toggleShuffle(); }
function cycleRepeat() { Player.cycleRepeat(); }
function toggleLikeCurrent() {
    if (Store.currentTrack) {
        Store.toggleLike(Store.currentTrack);
        Player.updatePlayerUI();
    }
}

