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

    // Crossfade state
    _crossfadeAudio: null,      // the second audio element used during crossfade
    _isCrossfading: false,      // true while a crossfade transition is in progress
    _crossfadeInterval: null,   // the interval that drives the volume ramp
    _fetchingRadio: false,      // prevents duplicate radio fetches
    
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
    // Returns { track } or null if nothing to play
    // -----------------------------------------------------------------------
    _resolveNextTrack() {
        if (!Store.currentTrack) return null;
        
        if (Store.shuffle) {
            const others = Store.queue.filter(t => t.id !== Store.currentTrack.id);
            if (others.length > 0) {
                return { track: others[Math.floor(Math.random() * others.length)] };
            }
            return null;
        }
        
        const idx = Store.queue.findIndex(t => t.id === Store.currentTrack.id);
        if (idx < Store.queue.length - 1) {
            return { track: Store.queue[idx + 1] };
        } else if (Store.repeat === 'all' && Store.queue.length > 0) {
            return { track: Store.queue[0] };
        }
        
        return null; // end of queue
    },
    
    playTrack(track, newQueue = null) {
        // If we're in the middle of a crossfade, clean it up first
        this._cleanupCrossfade();

        if (Store.currentTrack && Store.currentTrack.id !== track.id) {
            Store.history = [...Store.history, Store.currentTrack];
        }

        Store.currentTrack = track;
        Store.isPlaying = true;
        if (newQueue) {
            Store.queue = newQueue;
            Store.history = [];
        }
        Store.addToRecent(track);

        // Sync to native media session. Order matters: set metadata + playback
        // state BEFORE playUri so the notification the service promotes to
        // foreground already has the right title/artist/MediaSession token.
        if (window.AndroidMediaSession) {
            window.AndroidMediaSession.updateMetadata(track.title || '', track.channel?.name || 'Unknown', track.thumbnail || '');
            window.AndroidMediaSession.updatePlaybackState(true, 0);
        }

        const url = getApiUrl(`/api/stream?id=${track.id}`);

        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
            window.AndroidMediaSession.playUri(url, false, 0);
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

        // Push the next-up track to native so autoplay works when the screen
        // is off and the WebView JS is throttled.
        this._pushNextTrackToNative();
    },

    // Compute the next track (respecting shuffle/repeat) and hand its stream
    // URL + metadata to the native layer. On track-completion, the native
    // MediaPlayer will play this directly without needing to call back into JS.
    _pushNextTrackToNative() {
        if (!window.AndroidMediaSession) return;

        if (typeof window.AndroidMediaSession.setNextTrackInfo === 'function') {
            const next = this._resolveNextTrack();
            if (!next || !next.track) {
                window.AndroidMediaSession.setNextTrackInfo('', '', '', '', '');
            } else {
                const t = next.track;
                const url = getApiUrl(`/api/stream?id=${t.id}`);
                window.AndroidMediaSession.setNextTrackInfo(
                    t.id || '',
                    url,
                    t.title || '',
                    (t.channel && t.channel.name) || 'Unknown',
                    t.thumbnail || ''
                );
            }
        }

        // Also push the full queue so native can keep advancing indefinitely
        // when the WebView JS is throttled (screen off).
        if (typeof window.AndroidMediaSession.setPlaybackContext === 'function') {
            const mapped = (Store.queue || []).map(t => ({
                id: t.id || '',
                title: t.title || '',
                artist: (t.channel && t.channel.name) || 'Unknown',
                thumbnail: t.thumbnail || '',
                streamUrl: getApiUrl(`/api/stream?id=${t.id}`),
            }));
            window.AndroidMediaSession.setPlaybackContext(
                JSON.stringify(mapped),
                (Store.currentTrack && Store.currentTrack.id) || '',
                Store.repeat || 'none',
                !!Store.shuffle
            );
        }
    },

    // Called from native code (see MediaPlaybackService.handleTrackEnded) after
    // the native player has already advanced to the next track on its own.
    // We reconcile Store + UI without re-triggering playback. Deliberately do
    // NOT re-push the queue: native is authoritative here (it has been
    // advancing while JS was frozen and may already be several tracks ahead
    // of the events being replayed).
    _onNativeAdvanced(nextTrackId) {
        if (!nextTrackId) return;
        const track = Store.queue.find(t => t.id === nextTrackId);
        if (!track) return;
        if (Store.currentTrack && Store.currentTrack.id !== track.id) {
            Store.history = [...Store.history, Store.currentTrack];
        }
        Store.currentTrack = track;
        Store.isPlaying = true;
        Store.addToRecent(track);
        this.showPlayerBar();
        this.updatePlayerUI();
        Store.emit('trackChanged');
    },

    // Called from native (MediaPlaybackService.onPlaybackStalled) when too many
    // tracks in a row failed to play and it stopped trying. Reflect a paused
    // state so the user sees playback stopped rather than an endless skip.
    _onPlaybackStalled() {
        Store.isPlaying = false;
        this._fetchingRadio = false;
        if (window.AndroidMediaSession &&
            typeof window.AndroidMediaSession.updatePlaybackState === 'function') {
            window.AndroidMediaSession.updatePlaybackState(false, 0);
        }
        this.updatePlayButton();
    },

    // Crossfade-aware version: starts the next track via crossfade instead of hard-cut
    _playTrackCrossfade(track) {
        if (Store.currentTrack && Store.currentTrack.id !== track.id) {
            Store.history = [...Store.history, Store.currentTrack];
        }
        
        Store.currentTrack = track;
        Store.isPlaying = true;
        Store.addToRecent(track);
        
        // Sync to native media session
        if (window.AndroidMediaSession) {
            window.AndroidMediaSession.updateMetadata(track.title || '', track.channel?.name || 'Unknown', track.thumbnail || '');
            window.AndroidMediaSession.updatePlaybackState(true, 0);
        }
        
        const url = getApiUrl(`/api/stream?id=${track.id}`);
        const cfDuration = Store.crossfadeDuration;
        
        this._isCrossfading = true;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
            window.AndroidMediaSession.playUri(url, true, cfDuration * 1000);
            setTimeout(() => {
                this._isCrossfading = false;
            }, cfDuration * 1000);
        } else {
            // Create new audio element for the incoming track
            this._crossfadeAudio = new Audio();
            this._crossfadeAudio.preload = 'auto';
            this._crossfadeAudio.src = url;
            this._crossfadeAudio.volume = 0;
            
            // Copy ended / error listeners to the new element
            this._crossfadeAudio.addEventListener('ended', () => this.onEnded());
            this._crossfadeAudio.addEventListener('error', (e) => this.onError(e));
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
            
            this._crossfadeAudio.play().catch(e => console.error('Crossfade play error:', e));
            
            // Start the volume ramp
            const duration = cfDuration * 1000; // ms
            const steps = 40; // number of volume steps
            const interval = duration / steps;
            let step = 0;
            
            const oldAudio = this.audio;
            const savedVol = localStorage.getItem('volume');
            const targetVol = savedVol !== null ? parseFloat(savedVol) : 1;
            const startVol = oldAudio.volume;
            
            this._crossfadeInterval = setInterval(() => {
                step++;
                const progress = Math.min(step / steps, 1);
                // Smoothstep ease curve for natural-sounding fade
                const ease = progress * progress * (3 - 2 * progress);
                
                oldAudio.volume = Math.max(0, startVol * (1 - ease));
                if (this._crossfadeAudio) {
                    this._crossfadeAudio.volume = targetVol * ease;
                }
                
                if (step >= steps) {
                    // Transition complete: swap audio elements
                    clearInterval(this._crossfadeInterval);
                    this._crossfadeInterval = null;
                    
                    oldAudio.pause();
                    oldAudio.src = '';
                    
                    // Promote the new audio to primary
                    this.audio = this._crossfadeAudio;
                    this._crossfadeAudio = null;
                    this._isCrossfading = false;
                }
            }, interval);
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
            this._crossfadeAudio.pause();
            this._crossfadeAudio.src = '';
            this._crossfadeAudio = null;
        }
        this._isCrossfading = false;
    },
    
    togglePlay() {
        if (!Store.currentTrack) return;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.pausePlayback === 'function') {
            if (Store.isPlaying) {
                window.AndroidMediaSession.pausePlayback();
            } else {
                window.AndroidMediaSession.resumePlayback();
            }
            Store.isPlaying = !Store.isPlaying;
            window.AndroidMediaSession.updatePlaybackState(Store.isPlaying, Math.round(window.AndroidMediaSession.getCurrentPosition()));
        } else {
            const active = this._isCrossfading && this._crossfadeAudio ? this._crossfadeAudio : this.audio;
            if (Store.isPlaying) {
                active.pause();
            } else {
                active.play().catch(e => console.error('Play error:', e));
            }
            Store.isPlaying = !Store.isPlaying;
            if (window.AndroidMediaSession) {
                window.AndroidMediaSession.updatePlaybackState(Store.isPlaying, Math.round(active.currentTime * 1000));
            }
        }
        
        this.updatePlayButton();
    },
    
    playNext() {
        const next = this._resolveNextTrack();
        if (next) {
            this.playTrack(next.track);
            return;
        }
        
        // Queue exhausted — try auto-radio if enabled
        if (Store.autoplayEnabled && Store.currentTrack && !this._fetchingRadio) {
            this._fetchRadioAndPlay();
        }
    },
    
    _fetchRadioAndPlay() {
        if (this._fetchingRadio) return;
        this._fetchingRadio = true;
        
        const track = Store.currentTrack;
        const params = new URLSearchParams({
            id: track.id,
            title: track.title || '',
            artist: track.channel?.name || '',
        });
        
        fetch(getApiUrl(`/api/radio?${params.toString()}`))
            .then(r => r.json())
            .then(tracks => {
                this._fetchingRadio = false;
                if (!tracks || !tracks.length) return;
                
                // Filter out tracks already in the current queue
                const existingIds = new Set(Store.queue.map(t => t.id));
                existingIds.add(Store.currentTrack?.id);
                const newTracks = tracks.filter(t => !existingIds.has(t.id));
                
                if (newTracks.length === 0) return;
                
                // Append to queue and play the first new track
                Store.queue = [...Store.queue, ...newTracks];
                this.playTrack(newTracks[0]);
            })
            .catch(e => {
                this._fetchingRadio = false;
                console.error('Radio fetch failed:', e);
            });
    },
    
    playPrev() {
        if (!Store.currentTrack) return;
        
        let curTime = 0;
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.getCurrentPosition === 'function') {
            curTime = window.AndroidMediaSession.getCurrentPosition() / 1000;
        } else {
            curTime = this.audio.currentTime;
        }
        
        if (curTime > 3) {
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
            this.playTrack(prev, Store.queue);
        } else {
            const idx = Store.queue.findIndex(t => t.id === Store.currentTrack.id);
            if (idx > 0) this.playTrack(Store.queue[idx - 1]);
        }
    },
    
    onEnded() {
        // If we're in a crossfade, the old track ended naturally — just clean up
        if (this._isCrossfading) return;
        
        if (Store.repeat === 'one') {
            this.audio.currentTime = 0;
            this.audio.play();
            return;
        }
        this.playNext();
    },
    
    onError(e) {
        console.error('Audio error, trying Piped fallback...');
        if (!Store.currentTrack) return;
        // Try Piped directly as fallback
        fetch(`https://api.piped.private.coffee/streams/${Store.currentTrack.id}`)
            .then(r => r.json())
            .then(data => {
                const streams = (data.audioStreams || [])
                    .filter(s => s.mimeType && s.mimeType.startsWith('audio/'))
                    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                if (streams.length > 0) {
                    const url = streams[0].url;
                    if (window.AndroidMediaSession && typeof window.AndroidMediaSession.playUri === 'function') {
                        window.AndroidMediaSession.playUri(url, false, 0);
                    } else {
                        this.audio.src = url;
                        this.audio.play().catch(() => {});
                    }
                }
            }).catch(() => {
                console.error('Piped fallback also failed');
            });
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
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.setVolume === 'function') {
            window.AndroidMediaSession.setVolume(val / 100);
        } else {
            this.audio.volume = val / 100;
        }
        localStorage.setItem('volume', String(val / 100));
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
        const btn = document.getElementById('shuffle-btn');
        if (btn) btn.classList.toggle('active', Store.shuffle);
        const mobBtn = document.getElementById('mobile-shuffle-btn');
        if (mobBtn) mobBtn.classList.toggle('active', Store.shuffle);
        this._pushNextTrackToNative();
    },

    cycleRepeat() {
        const modes = ['none', 'all', 'one'];
        const idx = modes.indexOf(Store.repeat);
        Store.repeat = modes[(idx + 1) % 3];
        this._pushNextTrackToNative();
        
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
    
    updateProgress() {
        if (!Store.currentTrack) return;
        
        let current = 0;
        let duration = 0;
        
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.getCurrentPosition === 'function') {
            current = window.AndroidMediaSession.getCurrentPosition() / 1000;
            duration = window.AndroidMediaSession.getDuration() / 1000;
        } else {
            if (!this.audio) return;
            const active = this._isCrossfading && this._crossfadeAudio ? this._crossfadeAudio : this.audio;
            current = active.currentTime || 0;
            duration = active.duration || 0;
        }
        
        const pct = duration > 0 ? (current / duration) * 100 : 0;
        
        const fill = document.getElementById('progress-fill');
        if (fill) fill.style.width = pct + '%';
        
        const miniFill = document.getElementById('mini-progress-fill');
        if (miniFill) miniFill.style.width = pct + '%';
        
        const curEl = document.getElementById('current-time');
        if (curEl) curEl.textContent = formatTime(current);
        
        const totEl = document.getElementById('total-time');
        if (totEl && duration > 0) totEl.textContent = formatTime(duration);
        
        // Update mobile player progress too if visible
        const mobFill = document.getElementById('mobile-progress-fill');
        if (mobFill) mobFill.style.width = pct + '%';
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
            const cfDuration = Store.crossfadeDuration;
            
            // Only trigger if we have enough remaining time and we're past at least 50%
            if (remaining > 0 && remaining <= cfDuration && current > duration * 0.5) {
                // Don't crossfade if repeat-one (it restarts the same track)
                if (Store.repeat === 'one') return;
                
                const next = this._resolveNextTrack();
                if (next) {
                    this._playTrackCrossfade(next.track);
                } else if (Store.autoplayEnabled && Store.currentTrack && !this._fetchingRadio) {
                    // Fetch radio tracks and crossfade into the first one
                    this._fetchingRadio = true;
                    const track = Store.currentTrack;
                    const params = new URLSearchParams({
                        id: track.id,
                        title: track.title || '',
                        artist: track.channel?.name || '',
                    });
                    fetch(getApiUrl(`/api/radio?${params.toString()}`))
                        .then(r => r.json())
                        .then(tracks => {
                            this._fetchingRadio = false;
                            if (!tracks || !tracks.length) return;
                            const existingIds = new Set(Store.queue.map(t => t.id));
                            existingIds.add(Store.currentTrack?.id);
                            const newTracks = tracks.filter(t => !existingIds.has(t.id));
                            if (newTracks.length === 0) return;
                            Store.queue = [...Store.queue, ...newTracks];
                            if (!this._isCrossfading) {
                                this._playTrackCrossfade(newTracks[0]);
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
        if (bar) bar.style.display = 'flex';
        const app = document.getElementById('app');
        if (app) app.classList.add('has-player');
    },
    
    updatePlayerUI() {
        const track = Store.currentTrack;
        if (!track) return;
        
        // Trigger animation on song change
        const infoPanel = document.getElementById('player-track-info');
        if (infoPanel) {
            infoPanel.classList.remove('animate-song-change');
            void infoPanel.offsetWidth; // trigger reflow
            infoPanel.classList.add('animate-song-change');
        }
        
        const thumb = document.getElementById('player-thumb');
        const name = document.getElementById('player-track-name');
        const artist = document.getElementById('player-track-artist');
        const likeBtn = document.getElementById('player-like-btn');
        
        if (thumb) thumb.src = track.thumbnail || '';
        if (name) name.textContent = track.title || '';
        if (artist) artist.textContent = track.channel?.name || '';
        if (likeBtn) {
            likeBtn.innerHTML = Store.isLiked(track.id)
                ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>'
                : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
            likeBtn.classList.toggle('active', Store.isLiked(track.id));
        }
        
        // Sync repeat button icons
        const rBtn = document.getElementById('repeat-btn');
        if (rBtn) {
            rBtn.classList.toggle('active', Store.repeat !== 'none');
            rBtn.innerHTML = REPEAT_ICONS[Store.repeat];
        }
        
        // Sync shuffle button active state
        const sBtn = document.getElementById('shuffle-btn');
        if (sBtn) {
            sBtn.classList.toggle('active', Store.shuffle);
        }
        
        this.updatePlayButton();
        
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
function playPrev() { Player.playPrev(); }
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
