// App initialization
window._lyricsOpenedFromPlayer = false;

document.addEventListener('DOMContentLoaded', () => {
    applyTheme();
    Player.init();
    Router.init();
    updateSidebarPlaylists();
    setupSearchSuggestions();
    setupFloatingSearchSuggestions();
    setupMobilePlayerExpand();
    setupBackButton();
    setupLyricsContainer();
    setupSwipeToQueue();
    setupLikeButtonLongPress();
    makeScrubber('progress-track', 'progress-fill', 'progress-thumb', 'current-time');
    
    // Listen for store changes
    Store.on('playlistsChanged', () => {
        updateSidebarPlaylists();
        // Re-render current page if on library/playlist
        if (Router.currentRoute === '/library' || Router.currentRoute.startsWith('/playlist/')) {
            Router.render(Router.currentRoute);
        }
    });

    Store.on('queueChanged', () => {
        renderQueue();
    });
    
    Store.on('trackChanged', () => {
        // If mobile player overlay is open, re-render it to update current song name and art
        const overlay = document.getElementById('mobile-player-overlay');
        if (overlay && overlay.style.display === 'flex') {
            showMobilePlayer();
        }
        
        // Simply update playing state class on track rows in DOM
        updateTrackRowsPlayingState();
    });
});

function updateSidebarPlaylists() {
    const list = document.getElementById('sidebar-playlists');
    if (!list) return;
    
    if (Store.playlists.length === 0) {
        list.innerHTML = '<div style="padding:0.5rem 0.75rem;font-size:0.85rem;color:var(--text-muted)">No playlists</div>';
        return;
    }
    
    list.innerHTML = Store.playlists.map(pl => {
        const isActive = Router.currentRoute === `/playlist/${pl.id}`;
        return `<div class="playlist-item ${isActive ? 'active' : ''}" onclick="navigate('/playlist/${pl.id}')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
            <span class="playlist-item-name">${escapeHtml(pl.name)}</span>
        </div>`;
    }).join('');
}

function showCreatePlaylist() {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()">
        <h3>Create Playlist</h3>
        <form onsubmit="event.preventDefault(); createPlaylistFromModal()">
            <input class="modal-input" id="playlist-name-input" placeholder="Playlist name..." autofocus>
            <div class="modal-actions">
                <button type="button" class="modal-btn cancel" onclick="closeModal()">Cancel</button>
                <button type="submit" class="modal-btn create">Create</button>
            </div>
        </form>
    </div>`;
    setTimeout(() => document.getElementById('playlist-name-input')?.focus(), 100);
}

function createPlaylistFromModal() {
    const input = document.getElementById('playlist-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    Store.createPlaylist(name);
    closeModal();
}

function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.style.zIndex = '';
        overlay.innerHTML = '';
    }
}

// Search suggestions
function setupSearchSuggestions() {
    const input = document.getElementById('search-input');
    const dropdown = document.getElementById('suggestions-dropdown');
    if (!input || !dropdown) return;
    
    let timer = null;
    let searchTimer = null;
    let abortController = null;
    
    // Helper to hide dropdown and cancel pending timers/requests
    const hideAndCancel = () => {
        clearTimeout(timer);
        clearTimeout(searchTimer);
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        dropdown.classList.remove('show');
        dropdown.innerHTML = '';
    };
    
    input.addEventListener('input', () => {
        const q = input.value.trim();
        
        clearTimeout(timer);
        if (q.length < 2) {
            dropdown.classList.remove('show');
            dropdown.innerHTML = '';
        } else {
            timer = setTimeout(() => {
                if (abortController) {
                    abortController.abort();
                }
                abortController = new AbortController();
                const signal = abortController.signal;

                fetch(getApiUrl(`/api/suggestions?q=${encodeURIComponent(q)}`), { signal })
                    .then(r => r.json())
                    .then(suggestions => {
                        // Only show suggestions if input is still active/focused
                        if (document.activeElement !== input) {
                            return;
                        }
                        // If input has been cleared since we started the fetch, don't show
                        if (input.value.trim().length < 2) {
                            hideAndCancel();
                            return;
                        }
                        if (!suggestions.length) { 
                            dropdown.classList.remove('show'); 
                            dropdown.innerHTML = '';
                            return; 
                        }
                        dropdown.innerHTML = suggestions.map(s => 
                            `<div class="suggestion-item" onmousedown="event.preventDefault(); selectSuggestion('${escapeHtml(s)}')">${escapeHtml(s)}</div>`
                        ).join('');
                        dropdown.classList.add('show');
                    }).catch(err => {
                        if (err.name === 'AbortError') return;
                        dropdown.classList.remove('show');
                        dropdown.innerHTML = '';
                    });
            }, 250);
        }
    });
    
    input.addEventListener('blur', () => {
        // Small delay to allow onmousedown click handler to fire first
        setTimeout(() => {
            dropdown.classList.remove('show');
            dropdown.innerHTML = '';
        }, 150);
    });
    
    input.addEventListener('focus', () => { 
        const q = input.value.trim();
        if (q.length >= 2 && dropdown.children.length) {
            dropdown.classList.add('show'); 
        } 
    });

    // Dismiss suggestions and blur when user scrolls outside the dropdown
    document.addEventListener('scroll', (e) => {
        if (dropdown.classList.contains('show') && !dropdown.contains(e.target)) {
            hideAndCancel();
            input.blur();
        }
    }, { capture: true, passive: true });

    // Dismiss suggestions and blur when user clicks away outside the input or dropdown
    document.addEventListener('click', (e) => {
        if (dropdown.classList.contains('show') && e.target !== input && !dropdown.contains(e.target)) {
            hideAndCancel();
            input.blur();
        }
    });
    
    // Global helper so suggestion items can invoke it
    window.selectSuggestion = (val) => {
        hideAndCancel();
        input.value = val;
        input.blur();
        navigate(`/search?q=${encodeURIComponent(val)}`);
    };
    
    window.hideSearchSuggestions = hideAndCancel;
}

function handleSearch(event) {
    event.preventDefault();
    const input = document.getElementById('search-input');
    const q = input ? input.value.trim() : '';
    if (q) {
        if (typeof window.hideSearchSuggestions === 'function') {
            window.hideSearchSuggestions();
        }
        if (input) input.blur();
        navigate(`/search?q=${encodeURIComponent(q)}`);
    }
}

// Lyrics
window._lyricsData = [];

function toggleLyrics() {
    const overlay = document.getElementById('lyrics-overlay');
    if (!overlay) return;
    
    if (overlay.style.display === 'none' || !overlay.style.display) {
        if (!Store.currentTrack) return;
        overlay.style.display = 'flex';
        window._userScrollingLyrics = false;
        clearTimeout(window._lyricsScrollTimeout);
        fetchLyrics();
    } else {
        overlay.style.display = 'none';
        window._lyricsData = [];
    }
}

function fetchLyrics() {
    const container = document.getElementById('lyrics-container');
    if (!container || !Store.currentTrack) return;
    
    container.innerHTML = '<div class="page-loader"><div class="spinner"></div></div>';
    
    const track = Store.currentTrack.title || '';
    const artist = Store.currentTrack.channel?.name || '';

    // Cap the wait so a slow/unreachable lyrics provider can't spin forever.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    fetch(getApiUrl(`/api/lyrics?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}`), { signal: controller.signal })
        .then(r => r.json())
        .then(data => {
            clearTimeout(timeoutId);
            if (data.syncedLyrics) {
                window._lyricsData = parseLrc(data.syncedLyrics);
                renderLyricLines();
            } else if (data.plainLyrics) {
                window._lyricsData = [];
                container.innerHTML = data.plainLyrics.split('\n').map(line =>
                    `<div class="lyric-line" style="color:rgba(255,255,255,0.7)">${escapeHtml(line)}</div>`
                ).join('');
            } else {
                window._lyricsData = [];
                container.innerHTML = '<div style="color:var(--text-secondary);font-size:1.2rem">No lyrics available</div>';
            }
        }).catch(() => {
            clearTimeout(timeoutId);
            window._lyricsData = [];
            container.innerHTML = '<div style="color:var(--text-secondary);font-size:1.1rem">Couldn\'t load lyrics. Please try again.</div>';
        });
}

let _lastActiveLyricIdx = -1;

function parseLrc(lrcText) {
    if (!lrcText) return [];
    const lines = [];
    lrcText.split('\n').forEach(line => {
        const timeMatches = [...line.matchAll(/\[(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/g)];
        const text = line.replace(/\[\d{1,2}:\d{1,2}(?:\.\d+)?\]/g, '').trim();
        if (timeMatches.length > 0 && text) {
            timeMatches.forEach(m => {
                const minutes = parseInt(m[1], 10);
                const seconds = parseFloat(m[2]);
                const time = minutes * 60 + seconds;
                lines.push({ time, text });
            });
        }
    });
    lines.sort((a, b) => a.time - b.time);
    return lines;
}

function renderLyricLines() {
    const container = document.getElementById('lyrics-container');
    if (!container) return;
    _lastActiveLyricIdx = -1;
    container.innerHTML = window._lyricsData.map((line, i) => 
        `<div class="lyric-line" id="lyric-${i}" onclick="seekFromLyrics(${line.time})">${escapeHtml(line.text)}</div>`
    ).join('');
}

function updateLyricsHighlight(currentTime) {
    if (!window._lyricsData.length) return;
    let activeIdx = -1;
    for (let i = window._lyricsData.length - 1; i >= 0; i--) {
        if (currentTime >= window._lyricsData[i].time - 0.15) { activeIdx = i; break; }
    }
    if (activeIdx !== _lastActiveLyricIdx) {
        _lastActiveLyricIdx = activeIdx;
        document.querySelectorAll('.lyric-line').forEach((el, i) => {
            el.classList.toggle('active', i === activeIdx);
        });
        if (activeIdx >= 0 && !window._userScrollingLyrics) {
            const el = document.getElementById(`lyric-${activeIdx}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

// Mobile player expand
function setupMobilePlayerExpand() {
    const bar = document.getElementById('player-bar');
    if (!bar) return;
    
    bar.addEventListener('click', (e) => {
        if (window.innerWidth > 600) return;
        if (e.target.closest('button') || e.target.closest('input')) return;
        showMobilePlayer();
    });
}

function _getPrevTrack() {
    if (!Store.currentTrack) return null;
    let curTime = 0;
    if (window.AndroidMediaSession && typeof window.AndroidMediaSession.getCurrentPosition === 'function') {
        curTime = window.AndroidMediaSession.getCurrentPosition() / 1000;
    } else if (Player.audio) {
        curTime = Player.audio.currentTime;
    }
    if (curTime > 3) return Store.currentTrack;
    if (Store.history.length > 0) return Store.history[Store.history.length - 1];
    const idx = Store.queue.findIndex(t => t.id === Store.currentTrack.id);
    if (idx > 0) return Store.queue[idx - 1];
    return null;
}

function _getNextTrack() {
    if (typeof Player !== 'undefined' && Player._resolveNextTrack) {
        const res = Player._resolveNextTrack();
        return res ? res.track : null;
    }
    return null;
}

function setupMobilePlayerSwipe() {
    const container = document.getElementById('mobile-player-art-container');
    const track = document.getElementById('mobile-player-carousel-track');
    const slideCurrent = document.getElementById('art-slide-current');
    const slidePrev = document.getElementById('art-slide-prev');
    const slideNext = document.getElementById('art-slide-next');
    if (!container || !track) return;

    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let isDragging = false;
    let isHorizontal = false;
    let containerWidth = container.offsetWidth || 320;
    let hasPrev = false;
    let hasNext = false;

    function onPointerDown(e) {
        if (e.target.closest('button')) return;
        const pointer = e.touches ? e.touches[0] : e;
        startX = pointer.clientX;
        startY = pointer.clientY;
        deltaX = 0;
        isDragging = true;
        isHorizontal = false;
        containerWidth = container.offsetWidth || 320;
        hasPrev = !!_getPrevTrack();
        hasNext = !!_getNextTrack();
        track.classList.remove('animating');
    }

    function onPointerMove(e) {
        if (!isDragging) return;
        const pointer = e.touches ? e.touches[0] : e;
        const currentX = pointer.clientX;
        const currentY = pointer.clientY;
        const dx = currentX - startX;
        const dy = currentY - startY;

        if (!isHorizontal) {
            if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) {
                isHorizontal = true;
            } else if (Math.abs(dy) > 10) {
                isDragging = false;
                return;
            }
        }

        if (!isHorizontal) return;

        if (e.cancelable) e.preventDefault();

        deltaX = dx;

        if (deltaX < 0 && !hasNext) {
            deltaX = deltaX * 0.3;
        } else if (deltaX > 0 && !hasPrev) {
            deltaX = deltaX * 0.3;
        }

        track.style.transform = `translateX(${deltaX}px)`;

        const ratio = Math.abs(deltaX) / containerWidth;
        if (slideCurrent) {
            slideCurrent.style.transform = `scale(${Math.max(0.85, 1 - ratio * 0.15)})`;
            slideCurrent.style.opacity = Math.max(0.4, 1 - ratio * 0.6);
        }

        if (deltaX < 0 && slideNext) {
            slideNext.style.opacity = Math.min(1, 0.5 + ratio * 0.5);
            slideNext.style.transform = `translateX(calc(110% + ${deltaX}px)) scale(${Math.min(1, 0.88 + ratio * 0.12)})`;
        } else if (deltaX > 0 && slidePrev) {
            slidePrev.style.opacity = Math.min(1, 0.5 + ratio * 0.5);
            slidePrev.style.transform = `translateX(calc(-110% + ${deltaX}px)) scale(${Math.min(1, 0.88 + ratio * 0.12)})`;
        }
    }

    function onPointerEnd() {
        if (!isDragging) return;
        isDragging = false;
        track.classList.add('animating');

        const threshold = containerWidth * 0.22;
        if (deltaX < -threshold && hasNext) {
            track.style.transform = 'translateX(-110%)';
            if (slideCurrent) slideCurrent.style.opacity = '0.3';
            if (slideNext) {
                slideNext.style.opacity = '1';
                slideNext.style.transform = 'translateX(0) scale(1)';
            }
            setTimeout(() => {
                playNext();
            }, 180);
        } else if (deltaX > threshold && hasPrev) {
            track.style.transform = 'translateX(110%)';
            if (slideCurrent) slideCurrent.style.opacity = '0.3';
            if (slidePrev) {
                slidePrev.style.opacity = '1';
                slidePrev.style.transform = 'translateX(0) scale(1)';
            }
            setTimeout(() => {
                playPrev(true);
            }, 180);
        } else {
            track.style.transform = 'translateX(0px)';
            if (slideCurrent) {
                slideCurrent.style.transform = 'translateX(0) scale(1)';
                slideCurrent.style.opacity = '1';
            }
            if (slidePrev) {
                slidePrev.style.transform = 'translateX(-110%) scale(0.88)';
                slidePrev.style.opacity = '0.5';
            }
            if (slideNext) {
                slideNext.style.transform = 'translateX(110%) scale(0.88)';
                slideNext.style.opacity = '0.5';
            }
        }
    }

    container.addEventListener('touchstart', onPointerDown, { passive: true });
    container.addEventListener('touchmove', onPointerMove, { passive: false });
    container.addEventListener('touchend', onPointerEnd, { passive: true });
    container.addEventListener('touchcancel', onPointerEnd, { passive: true });

    container.addEventListener('mousedown', onPointerDown);
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerEnd);
}

function updateMobilePlayerUI() {
    const overlay = document.getElementById('mobile-player-overlay');
    if (!overlay || overlay.style.display === 'none' || !Store.currentTrack) return;

    const track = Store.currentTrack;
    const bgImg = document.getElementById('mobile-player-bg-image');
    if (bgImg) {
        bgImg.style.backgroundImage = `url('${getTrackThumbnail(track)}')`;
    }

    const prevTrack = _getPrevTrack();
    const nextTrack = _getNextTrack();
    const artUrl = getTrackThumbnail(track);
    const prevArtUrl = prevTrack ? getTrackThumbnail(prevTrack) : '';
    const nextArtUrl = nextTrack ? getTrackThumbnail(nextTrack) : '';

    const slideCurrent = document.getElementById('art-slide-current');
    const slidePrev = document.getElementById('art-slide-prev');
    const slideNext = document.getElementById('art-slide-next');
    const carouselTrack = document.getElementById('mobile-player-carousel-track');

    if (carouselTrack) {
        carouselTrack.classList.remove('animating');
        carouselTrack.style.transform = 'translateX(0px)';
    }

    if (slideCurrent) {
        slideCurrent.style.transform = 'translateX(0) scale(1)';
        slideCurrent.style.opacity = '1';
        slideCurrent.innerHTML = `<img src="${artUrl}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">`;
    }
    if (slidePrev) {
        slidePrev.style.transform = 'translateX(-110%) scale(0.88)';
        slidePrev.style.opacity = '0.5';
        slidePrev.innerHTML = prevArtUrl ? `<img src="${prevArtUrl}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">` : '';
    }
    if (slideNext) {
        slideNext.style.transform = 'translateX(110%) scale(0.88)';
        slideNext.style.opacity = '0.5';
        slideNext.innerHTML = nextArtUrl ? `<img src="${nextArtUrl}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">` : '';
    }

    const titleEl = document.getElementById('mobile-track-title');
    const artistEl = document.getElementById('mobile-track-artist');
    if (titleEl) titleEl.textContent = track.title || '';
    if (artistEl) artistEl.textContent = track.channel?.name || '';

    const infoWrapper = document.getElementById('mobile-track-info-wrapper');
    if (infoWrapper) {
        infoWrapper.classList.remove('animate-song-change');
        void infoWrapper.offsetWidth;
        infoWrapper.classList.add('animate-song-change');
    }

    const likeBtn = document.getElementById('mobile-like-btn');
    if (likeBtn) {
        const liked = Store.isLiked(track.id);
        likeBtn.classList.toggle('active', liked);
        likeBtn.innerHTML = liked ? ICONS.heartFilled : ICONS.heart;
    }
}

function showMobilePlayer() {
    const overlay = document.getElementById('mobile-player-overlay');
    if (!overlay || !Store.currentTrack) return;
    
    const track = Store.currentTrack;
    const isPlaying = Store.isPlaying;
    const liked = Store.isLiked(track.id);
    const duration = Player.audio ? (Player.audio.duration || 0) : 0;
    const current = Player.audio ? (Player.audio.currentTime || 0) : 0;
    const pct = duration > 0 ? (current / duration) * 100 : 0;
    
    const prevTrack = _getPrevTrack();
    const nextTrack = _getNextTrack();
    const artUrl = track.thumbnail || FALLBACK_IMG;
    const prevArtUrl = prevTrack ? (prevTrack.thumbnail || FALLBACK_IMG) : '';
    const nextArtUrl = nextTrack ? (nextTrack.thumbnail || FALLBACK_IMG) : '';

    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="mobile-player-bg" id="mobile-player-bg">
            <div class="mobile-player-bg-image" id="mobile-player-bg-image" style="background-image: url('${artUrl}')"></div>
            <div class="mobile-player-bg-gradient"></div>
        </div>

        <div class="mobile-player-header">
            <button class="btn-icon" onclick="document.getElementById('mobile-player-overlay').style.display='none'">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <span class="mobile-player-title">Now Playing</span>
            <button class="btn-icon" onclick="openMobileMenu(event)">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
            </button>
        </div>
        
        <div class="mobile-player-content">
            <div class="mobile-player-art-container" id="mobile-player-art-container">
                <div class="mobile-player-carousel-track" id="mobile-player-carousel-track">
                    <div class="mobile-player-art-slide slide-prev" id="art-slide-prev">
                        ${prevArtUrl ? `<img src="${prevArtUrl}" onerror="this.src='${FALLBACK_IMG}'">` : ''}
                    </div>
                    <div class="mobile-player-art-slide slide-current" id="art-slide-current">
                        <img src="${artUrl}" onerror="this.src='${FALLBACK_IMG}'">
                    </div>
                    <div class="mobile-player-art-slide slide-next" id="art-slide-next">
                        ${nextArtUrl ? `<img src="${nextArtUrl}" onerror="this.src='${FALLBACK_IMG}'">` : ''}
                    </div>
                </div>
            </div>
            
            <div class="mobile-player-info">
                <div class="mobile-player-track-info animate-song-change" id="mobile-track-info-wrapper">
                    <h2 id="mobile-track-title">${escapeHtml(track.title || '')}</h2>
                    <p id="mobile-track-artist" class="clickable-artist" onclick="navigateToCurrentArtist(event)">${escapeHtml(track.channel?.name || '')}</p>
                </div>
                <button class="btn-icon like-btn ${liked ? 'active' : ''}" id="mobile-like-btn" onclick="toggleLikeCurrent(); updateMobilePlayerUI();">
                    ${liked ? ICONS.heartFilled : ICONS.heart}
                </button>
            </div>
            
            <div class="mobile-player-progress">
                <div class="progress-track" id="mobile-progress-track">
                    <div class="progress-fill" id="mobile-progress-fill" style="width: ${pct}%"></div>
                    <div class="progress-thumb" id="mobile-progress-thumb" style="left: ${pct}%"></div>
                </div>
                <div class="mobile-time-labels">
                    <span id="mobile-current-time">${formatTime(current)}</span>
                    <span id="mobile-total-time">${formatTime(duration)}</span>
                </div>
            </div>
            
            <div class="mobile-player-controls">
                <button class="btn-icon ${Store.shuffle ? 'active' : ''}" id="mobile-shuffle-btn" onclick="toggleShuffle()">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
                </button>
                <button class="btn-icon" onclick="playPrev()">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="19 20 9 12 19 4"/><line x1="5" y1="19" x2="5" y2="5" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <button class="play-btn large" onclick="togglePlay()">
                    <svg id="mobile-play-icon" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? 'display:none' : ''}"><polygon points="5 3 19 12 5 21"/></svg>
                    <svg id="mobile-pause-icon" width="28" height="28" viewBox="0 0 24 24" fill="currentColor" style="${isPlaying ? '' : 'display:none'}"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                </button>
                <button class="btn-icon" onclick="playNext()">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 4 15 12 5 20"/><line x1="19" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2"/></svg>
                </button>
                <button class="btn-icon ${Store.repeat !== 'none' ? 'active' : ''}" id="mobile-repeat-btn" onclick="cycleRepeat()">
                    ${REPEAT_ICONS[Store.repeat]}
                </button>
            </div>
            
            <div class="mobile-player-footer">
                <button class="btn-icon" onclick="toggleLyrics()">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
                </button>
            </div>
        </div>
    `;
    
    setTimeout(() => {
        makeScrubber('mobile-progress-track', 'mobile-progress-fill', 'mobile-progress-thumb', 'mobile-current-time');
        setupMobilePlayerSwipe();
    }, 50);
}

function navigateToCurrentArtist(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const track = Store.currentTrack;
    if (!track) return;

    const overlay = document.getElementById('mobile-player-overlay');
    if (overlay) overlay.style.display = 'none';

    const artistId = track.channel?.id || track.artistId || track.channel?.name || track.artist;
    if (artistId) {
        Router.navigate('/artist/' + encodeURIComponent(artistId));
    }
}

function openMobileMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const track = Store.currentTrack;
    if (!track) return;
    
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '3000'; // above fullscreen player (z-index 2000)
    
    let html = `<div class="modal-box" onclick="event.stopPropagation()">
        <!-- Handle for bottom drawer -->
        <div class="drawer-handle" style="width: 40px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 0 auto 20px;"></div>
        
        <!-- Track Mini Header -->
        <div style="display:flex; align-items:center; gap: 16px; margin-bottom: 20px; text-align: left;">
            <img src="${track.thumbnail || FALLBACK_IMG}" style="width: 52px; height: 52px; border-radius: 6px; object-fit: cover; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
            <div style="min-width: 0; flex: 1;">
                <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${escapeHtml(track.title)}</h3>
                <p style="font-size: 0.85rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 0;">${escapeHtml(track.channel?.name || '')}</p>
            </div>
        </div>
        
        <div style="display:flex;flex-direction:column;gap:0.75rem;">`;
    
    // Always show "Add to Playlist" section header
    html += `<p style="font-size:0.8rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;font-weight:600;">Add to Playlist</p>`;
    
    if (Store.playlists.length > 0) {
        Store.playlists.forEach(pl => {
            const hasSong = pl.tracks.some(t => t.id === track.id);
            html += `<button class="action-btn secondary" style="justify-content:flex-start;width:100%;height:48px;border-radius:12px;font-size:0.95rem;font-weight:500;" onclick="togglePlaylistSong('${pl.id}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 12px; color: ${hasSong ? 'var(--primary-color)' : 'var(--text-secondary)'};"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                ${hasSong ? '✓' : '+'} ${escapeHtml(pl.name)}
            </button>`;
        });
    }
    
    // Always offer the option to create a new playlist
    html += `<button class="action-btn primary" style="width:100%;height:48px;border-radius:12px;font-size:0.95rem;font-weight:600;justify-content:center;" onclick="closeModal(); promptCreatePlaylistAndAdd()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Create New Playlist
    </button>`;
    
    html += `
            <button class="modal-btn cancel" style="margin-top:0.5rem;width:100%;height:48px;border-radius:24px;font-size:0.95rem;font-weight:600;" onclick="closeModal()">Cancel</button>
        </div>
    </div>`;
    
    overlay.innerHTML = html;
}

function togglePlaylistSong(playlistId) {
    const pl = Store.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const track = Store.currentTrack;
    if (!track) return;
    const hasSong = pl.tracks.some(t => t.id === track.id);
    if (hasSong) {
        Store.removeFromPlaylist(playlistId, track.id);
    } else {
        Store.addToPlaylist(playlistId, track);
    }
    closeModal();
}

function promptCreatePlaylistAndAdd() {
    const overlay = document.getElementById('modal-overlay');
    overlay.style.display = 'flex';
    overlay.style.zIndex = '3000';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()">
        <h3>Create Playlist</h3>
        <form onsubmit="event.preventDefault(); createPlaylistAndAddTrack()">
            <input class="modal-input" id="new-playlist-input" placeholder="Playlist name..." autofocus>
            <div class="modal-actions">
                <button type="button" class="modal-btn cancel" onclick="closeModal()">Cancel</button>
                <button type="submit" class="modal-btn create">Create</button>
            </div>
        </form>
    </div>`;
    setTimeout(() => document.getElementById('new-playlist-input')?.focus(), 100);
}

function createPlaylistAndAddTrack() {
    const input = document.getElementById('new-playlist-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    Store.createPlaylist(name);
    // Find the newly created playlist and add the track
    const newPl = Store.playlists[Store.playlists.length - 1];
    const track = Store.currentTrack;
    if (newPl && track) {
        Store.addToPlaylist(newPl.id, track);
    }
    closeModal();
}

// Back button handling — close overlays first, then navigate back in hash history
function setupBackButton() {
    document.addEventListener('backbutton', handleBackButton, false);
    // Also handle the browser-level popstate for WebView back
    window.addEventListener('popstate', function(e) {
        // popstate fires after the URL changed, so we just let the hashchange handler do its job
    });
}

function handleBackButton() {
    // Priority 1: close modal
    const modal = document.getElementById('modal-overlay');
    if (modal && modal.style.display !== 'none' && modal.style.display !== '') {
        closeModal();
        return;
    }
    // Priority 2: close lyrics overlay
    const lyrics = document.getElementById('lyrics-overlay');
    if (lyrics && lyrics.style.display !== 'none' && lyrics.style.display !== '') {
        toggleLyrics();
        return;
    }
    // Priority 2.5: close queue overlay
    const queue = document.getElementById('queue-overlay');
    if (queue && queue.style.display !== 'none' && queue.style.display !== '') {
        toggleQueue();
        return;
    }
    // Priority 3: close fullscreen mobile player
    const mobilePlayer = document.getElementById('mobile-player-overlay');
    if (mobilePlayer && mobilePlayer.style.display !== 'none' && mobilePlayer.style.display !== '') {
        mobilePlayer.style.display = 'none';
        return;
    }
    // Priority 4: navigate back in hash history, or exit app if at root
    const isRoot = window.location.hash === '' || window.location.hash === '#/';
    if (isRoot) {
        if (window.AndroidMediaSession && typeof window.AndroidMediaSession.exitApp === 'function') {
            window.AndroidMediaSession.exitApp();
        }
    } else {
        if (window.history.length > 1) {
            window.history.back();
        } else {
            navigate('/');
        }
    }
}

function setupLyricsContainer() {
    const container = document.getElementById('lyrics-container');
    if (!container) return;
    
    window._userScrollingLyrics = false;
    window._lyricsScrollTimeout = null;
    
    const handleScrollInteract = () => {
        window._userScrollingLyrics = true;
        clearTimeout(window._lyricsScrollTimeout);
        window._lyricsScrollTimeout = setTimeout(() => {
            window._userScrollingLyrics = false;
        }, 3000);
    };
    
    container.addEventListener('wheel', handleScrollInteract, { passive: true });
    container.addEventListener('touchmove', handleScrollInteract, { passive: true });
    container.addEventListener('pointerdown', handleScrollInteract, { passive: true });
}

function seekFromLyrics(seconds) {
    window._userScrollingLyrics = false;
    clearTimeout(window._lyricsScrollTimeout);
    Player.seekToTime(seconds);
}

function setupSwipeToQueue() {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwiping = false;
    let activeRowContent = null;
    let activeTrackData = null;
    let swipeBg = null;
    
    // Reset a row's swipe visuals back to resting state.
    const resetSwipe = (content, bg, animate) => {
        if (!content) return;
        content.style.transition = animate ? 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
        content.style.transform = 'translateX(0px)';
        if (bg) bg.style.opacity = '0';
    };

    document.addEventListener('touchstart', (e) => {
        const row = e.target.closest('.track-row');
        if (!row) return;

        activeRowContent = row.querySelector('.track-row-content');
        if (!activeRowContent) return;

        activeTrackData = JSON.parse(row.getAttribute('data-track') || 'null');
        swipeBg = row.querySelector('.swipe-bg-queue');

        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        isSwiping = false;
        activeRowContent.style.transition = 'none';
        // Start hidden — only reveal the "Queue" background while actually swiping.
        if (swipeBg) swipeBg.style.opacity = '0';
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
        if (!activeRowContent) return;

        const diffX = e.touches[0].clientX - startX;
        const diffY = e.touches[0].clientY - startY;

        if (!isSwiping) {
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
                isSwiping = true;
            } else if (Math.abs(diffY) > Math.abs(diffX)) {
                // Vertical scroll — abandon the swipe and clear any reveal.
                if (swipeBg) swipeBg.style.opacity = '0';
                activeRowContent = null;
                return;
            }
        }

        if (isSwiping) {
            // Swipe RIGHT to add to queue.
            if (diffX > 0) {
                if (e.cancelable) e.preventDefault();
                let dragX = diffX;
                if (dragX > 150) {
                    dragX = 150 + (dragX - 150) * 0.2;
                }
                activeRowContent.style.transform = `translateX(${dragX}px)`;
                if (swipeBg) {
                    const ratio = Math.min(diffX / 80, 1);
                    swipeBg.style.opacity = ratio.toString();
                }
            } else {
                activeRowContent.style.transform = 'translateX(0px)';
                if (swipeBg) swipeBg.style.opacity = '0';
            }
        }
    }, { passive: false });

    document.addEventListener('touchend', (e) => {
        if (!activeRowContent) return;

        const diffX = e.changedTouches[0].clientX - startX;
        // Capture locals so the delayed reset isn't clobbered by a new gesture.
        const content = activeRowContent;
        const bg = swipeBg;
        const track = activeTrackData;

        if (isSwiping && diffX > 80 && track) {
            content.style.transition = 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';
            content.style.transform = 'translateX(100%)';
            if (bg) bg.style.opacity = '0';
            addToPlayerQueue(track);
            setTimeout(() => resetSwipe(content, bg, false), 300);
        } else {
            resetSwipe(content, bg, true);
        }

        activeRowContent = null;
        activeTrackData = null;
        swipeBg = null;
    }, { passive: true });
}

function addToPlayerQueue(track) {
    if (!Store.currentTrack || !Store.isPlaying) {
        Player.playTrack(track);
        showToast(`Playing ${track.title || 'song'}`);
    } else {
        // Prevent duplicate entries
        Store.queue = (Store.queue || []).filter(t => t.id !== track.id);
        if (Store.currentTrack && Store.currentTrack.id === track.id) {
            showToast(`Already playing ${track.title || 'song'}`);
            return;
        }
        Store.queue = [...Store.queue, track];
        Store.emit('queueChanged');
        showToast(`Added to Queue`);
        Player._pushNextTrackToNative();
    }
}

function showToast(message) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(window._toastTimeout);
    window._toastTimeout = setTimeout(() => {
        el.classList.remove('show');
    }, 2000);
}

function toggleQueue() {
    const overlay = document.getElementById('queue-overlay');
    if (!overlay) return;
    
    if (overlay.style.display === 'none' || !overlay.style.display) {
        overlay.style.display = 'flex';
        renderQueue();
    } else {
        overlay.style.display = 'none';
    }
}

function renderQueue() {
    const container = document.getElementById('queue-container');
    if (!container) return;
    
    // Explicit user queue excluding currently playing track
    const nextUpList = (Store.queue || []).filter(t => t.id !== (Store.currentTrack ? Store.currentTrack.id : ''));
    
    let html = `
        <div class="queue-header">
            <h2>Play Queue</h2>
            ${nextUpList.length > 0 ? `<button class="clear-queue-btn" onclick="clearPlayerQueue()">Clear All</button>` : ''}
        </div>
    `;
    
    // Now Playing
    if (Store.currentTrack) {
        html += `
            <div class="queue-section">
                <h3>Now Playing</h3>
                <div class="queue-item playing">
                    <img class="queue-item-thumb" src="${Store.currentTrack.thumbnail || FALLBACK_IMG}">
                    <div class="queue-item-info">
                        <div class="queue-item-title">${escapeHtml(Store.currentTrack.title)}</div>
                        <div class="queue-item-artist">${escapeHtml(Store.currentTrack.channel?.name || '')}</div>
                    </div>
                    <span class="queue-playing-icon">♫</span>
                </div>
            </div>
        `;
    }
    
    // Next Up
    html += `<div class="queue-section">
        <h3>Next Up</h3>
    `;
    
    if (nextUpList.length === 0) {
        html += `<div class="empty-state">
            <p style="color:var(--text-secondary)">Queue is empty</p>
            <p style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">Similar songs will auto-play when your song ends</p>
        </div>`;
    } else {
        html += `<div class="queue-list" id="queue-drag-list">`;
        nextUpList.forEach((track, i) => {
            html += `
                <div class="queue-item draggable" data-queue-index="${i}" draggable="true" style="user-select:none;-webkit-user-select:none;">
                    <div class="queue-drag-handle" style="cursor:grab; padding: 0 8px 0 2px; color: var(--text-muted); font-size: 1.2rem; font-weight: 700; flex-shrink: 0; touch-action: none;">⋮⋮</div>
                    <img class="queue-item-thumb" src="${track.thumbnail || FALLBACK_IMG}">
                    <div class="queue-item-info" onclick="playQueueTrack(${i})">
                        <div class="queue-item-title">${escapeHtml(track.title)}</div>
                        <div class="queue-item-artist">${escapeHtml(track.channel?.name || '')}</div>
                    </div>
                    <div class="queue-item-actions">
                        <button class="queue-action-btn remove" onclick="removeQueueItem(${i})">✕</button>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
    setupQueueDragAndDrop();
}

let _draggedQueueIndex = null;

function setupQueueDragAndDrop() {
    const list = document.getElementById('queue-drag-list');
    if (!list) return;
    
    const items = list.querySelectorAll('.queue-item.draggable');
    
    items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
            _draggedQueueIndex = parseInt(item.getAttribute('data-queue-index'), 10);
            item.style.opacity = '0.4';
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.style.opacity = '1';
            items.forEach(el => el.style.borderTop = 'none');
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            item.style.borderTop = '2px solid var(--primary-color)';
        });

        item.addEventListener('dragleave', () => {
            item.style.borderTop = 'none';
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.style.borderTop = 'none';
            const dropIndex = parseInt(item.getAttribute('data-queue-index'), 10);
            if (_draggedQueueIndex !== null && _draggedQueueIndex !== dropIndex) {
                reorderQueueItems(_draggedQueueIndex, dropIndex);
            }
            _draggedQueueIndex = null;
        });

        // Touch Drag & Drop support for Android mobile screens
        const handle = item.querySelector('.queue-drag-handle');
        if (handle) {
            let touchStartY = 0;
            let touchIndex = -1;
            
            handle.addEventListener('touchstart', (e) => {
                touchIndex = parseInt(item.getAttribute('data-queue-index'), 10);
                touchStartY = e.touches[0].clientY;
                item.style.opacity = '0.5';
            }, { passive: true });

            handle.addEventListener('touchmove', (e) => {
                const currentY = e.touches[0].clientY;
                const targetEl = document.elementFromPoint(e.touches[0].clientX, currentY);
                const targetItem = targetEl ? targetEl.closest('.queue-item.draggable') : null;
                items.forEach(el => el.style.borderTop = 'none');
                if (targetItem) {
                    targetItem.style.borderTop = '2px solid var(--primary-color)';
                }
            }, { passive: true });

            handle.addEventListener('touchend', (e) => {
                item.style.opacity = '1';
                items.forEach(el => el.style.borderTop = 'none');
                const lastTouch = e.changedTouches[0];
                const targetEl = document.elementFromPoint(lastTouch.clientX, lastTouch.clientY);
                const targetItem = targetEl ? targetEl.closest('.queue-item.draggable') : null;
                if (targetItem && touchIndex !== -1) {
                    const dropIndex = parseInt(targetItem.getAttribute('data-queue-index'), 10);
                    if (touchIndex !== dropIndex) {
                        reorderQueueItems(touchIndex, dropIndex);
                    }
                }
                touchIndex = -1;
            });
        }
    });
}

function reorderQueueItems(fromIndex, toIndex) {
    if (!Store.queue || fromIndex < 0 || toIndex < 0) return;
    const moved = Store.queue.splice(fromIndex, 1)[0];
    if (moved) {
        Store.queue.splice(toIndex, 0, moved);
        Store.emit('queueChanged');
        renderQueue();
        Player._pushNextTrackToNative();
    }
}

function clearPlayerQueue() {
    Store.queue = [];
    Store.emit('queueChanged');
    renderQueue();
    Player._pushNextTrackToNative();
}

function moveQueueItem(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= Store.queue.length) return;
    
    const temp = Store.queue[index];
    Store.queue[index] = Store.queue[targetIndex];
    Store.queue[targetIndex] = temp;
    
    Store.emit('queueChanged');
    renderQueue();
    Player._pushNextTrackToNative();
}

function removeQueueItem(index) {
    Store.queue = Store.queue.filter((_, i) => i !== index);
    Store.emit('queueChanged');
    renderQueue();
    Player._pushNextTrackToNative();
}

function playQueueTrack(index) {
    const nextUpList = (Store.queue || []).filter(t => t.id !== (Store.currentTrack ? Store.currentTrack.id : ''));
    const track = nextUpList[index];
    if (track) {
        Player.playTrack(track);
    }
    toggleQueue();
}

function updateTrackRowsPlayingState() {
    const rows = document.querySelectorAll('.track-row');
    rows.forEach((row) => {
        const trackDataAttr = row.getAttribute('data-track');
        if (!trackDataAttr) return;
        try {
            const track = JSON.parse(trackDataAttr);
            const isPlaying = Store.currentTrack && Store.currentTrack.id === track.id;
            
            row.classList.toggle('playing', isPlaying);
            
            const idxEl = row.querySelector('.col-index');
            if (idxEl) {
                if (isPlaying) {
                    idxEl.textContent = '♫';
                } else {
                    const origIdx = row.getAttribute('data-index') || '1';
                    idxEl.textContent = origIdx;
                }
            }
        } catch (e) {
            console.error('Error updating row playing state:', e);
        }
    });
}

/* Floating Search Widget Controllers */
let floatingSuggestionsTimer = null;
let floatingSearchTimer = null;
let floatingAbortController = null;

function setupFloatingSearchSuggestions() {
    const input = document.getElementById('floating-search-input');
    const dropdown = document.getElementById('floating-suggestions-dropdown');
    if (!input || !dropdown) return;

    const hideAndCancel = () => {
        clearTimeout(floatingSuggestionsTimer);
        clearTimeout(floatingSearchTimer);
        if (floatingAbortController) {
            floatingAbortController.abort();
            floatingAbortController = null;
        }
        dropdown.classList.remove('show');
        dropdown.innerHTML = '';
    };

    input.addEventListener('input', () => {
        const q = input.value.trim();
        const clearBtn = document.getElementById('floating-search-clear-btn');
        if (clearBtn) {
            clearBtn.classList.toggle('show', q.length > 0);
        }

        clearTimeout(floatingSuggestionsTimer);
        if (q.length < 2) {
            dropdown.classList.remove('show');
            dropdown.innerHTML = '';
        } else {
            floatingSuggestionsTimer = setTimeout(() => {
                if (floatingAbortController) {
                    floatingAbortController.abort();
                }
                floatingAbortController = new AbortController();
                const signal = floatingAbortController.signal;

                fetch(getApiUrl(`/api/suggestions?q=${encodeURIComponent(q)}`), { signal })
                    .then(r => r.json())
                    .then(suggestions => {
                        if (document.activeElement !== input) return;
                        if (input.value.trim().length < 2) {
                            hideAndCancel();
                            return;
                        }
                        if (!suggestions || !suggestions.length) {
                            dropdown.classList.remove('show');
                            dropdown.innerHTML = '';
                            return;
                        }
                        dropdown.innerHTML = suggestions.map(s =>
                            `<div class="suggestion-item" onmousedown="event.preventDefault(); selectFloatingSuggestion('${escapeHtml(s)}')">${escapeHtml(s)}</div>`
                        ).join('');
                        dropdown.classList.add('show');
                    }).catch(err => {
                        if (err.name === 'AbortError') return;
                        dropdown.classList.remove('show');
                        dropdown.innerHTML = '';
                    });
            }, 250);
        }

        clearTimeout(floatingSearchTimer);
        floatingSearchTimer = setTimeout(() => {
            if (q) {
                navigate(`/search?q=${encodeURIComponent(q)}`);
            }
        }, 400);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            dropdown.classList.remove('show');
            dropdown.innerHTML = '';
        }, 150);
    });

    input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 2 && dropdown.children.length) {
            dropdown.classList.add('show');
        }
    });

    window.selectFloatingSuggestion = (val) => {
        hideAndCancel();
        input.value = val;
        input.blur();
        collapseFloatingSearch();
        navigate(`/search?q=${encodeURIComponent(val)}`);
    };

    window.hideFloatingSearchSuggestions = hideAndCancel;
}

function toggleFloatingSearch(event) {
    if (event) event.stopPropagation();
    const container = document.getElementById('floating-search-container');
    const input = document.getElementById('floating-search-input');
    if (!container || !input) return;
    
    if (container.classList.contains('expanded')) {
        const query = input.value.trim();
        if (query) {
            performFloatingSearch();
        } else {
            collapseFloatingSearch();
        }
    } else {
        container.classList.add('expanded');
        setTimeout(() => input.focus(), 120);
        
        document.addEventListener('click', handleFloatingSearchClickAway);
        
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.addEventListener('scroll', collapseFloatingSearch, { passive: true });
        }
    }
}

function collapseFloatingSearch() {
    const container = document.getElementById('floating-search-container');
    const input = document.getElementById('floating-search-input');
    if (container && container.classList.contains('expanded')) {
        container.classList.remove('expanded');
        if (input) input.blur();
        if (typeof window.hideFloatingSearchSuggestions === 'function') {
            window.hideFloatingSearchSuggestions();
        }
        document.removeEventListener('click', handleFloatingSearchClickAway);
        
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.removeEventListener('scroll', collapseFloatingSearch);
        }
    }
}

function handleFloatingSearchClickAway(event) {
    const container = document.getElementById('floating-search-container');
    if (container && !container.contains(event.target)) {
        collapseFloatingSearch();
    }
}

function handleFloatingSearchInput(event) {
    // Handled in setupFloatingSearchSuggestions input listener
}

function clearFloatingSearch(event) {
    if (event) event.stopPropagation();
    const input = document.getElementById('floating-search-input');
    const clearBtn = document.getElementById('floating-search-clear-btn');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (clearBtn) {
        clearBtn.classList.remove('show');
    }
    if (typeof window.hideFloatingSearchSuggestions === 'function') {
        window.hideFloatingSearchSuggestions();
    }
}

function performFloatingSearch() {
    const input = document.getElementById('floating-search-input');
    if (!input) return;
    const query = input.value.trim();
    if (query) {
        if (typeof window.hideFloatingSearchSuggestions === 'function') {
            window.hideFloatingSearchSuggestions();
        }
        input.blur();
        collapseFloatingSearch();
        navigate('/search?q=' + encodeURIComponent(query));
    }
}

// Scrubber playhead dragging logic

// Popup Search Modal Overlay Logic
window._popupSearchType = 'songs';
window._popupSearchTimer = null;

function openPopupSearch(event) {
    if (event) event.stopPropagation();
    const overlay = document.getElementById('popup-search-overlay');
    const input = document.getElementById('popup-search-input');
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 80);
    }
}

function closePopupSearch() {
    const overlay = document.getElementById('popup-search-overlay');
    if (overlay) overlay.style.display = 'none';
}

function clearPopupSearch() {
    const input = document.getElementById('popup-search-input');
    const clearBtn = document.getElementById('popup-search-clear-btn');
    if (input) {
        input.value = '';
        input.focus();
    }
    if (clearBtn) clearBtn.classList.remove('show');
    const resultsEl = document.getElementById('popup-search-results');
    if (resultsEl) {
        resultsEl.innerHTML = '<div class="empty-state"><h3>Quick Search</h3><p>Type to find songs and artists</p></div>';
    }
}

function switchPopupSearchType(type) {
    window._popupSearchType = type;
    document.getElementById('popup-chip-songs')?.classList.toggle('active', type === 'songs');
    document.getElementById('popup-chip-artists')?.classList.toggle('active', type === 'artists');
    performPopupSearch();
}

function handlePopupSearchInput() {
    const input = document.getElementById('popup-search-input');
    const clearBtn = document.getElementById('popup-search-clear-btn');
    if (!input) return;
    const q = input.value.trim();
    if (clearBtn) clearBtn.classList.toggle('show', q.length > 0);
    
    clearTimeout(window._popupSearchTimer);
    if (q.length >= 2) {
        window._popupSearchTimer = setTimeout(() => {
            performPopupSearch();
        }, 200);
    }
}

function performPopupSearch() {
    const input = document.getElementById('popup-search-input');
    const resultsEl = document.getElementById('popup-search-results');
    if (!input || !resultsEl) return;
    const query = input.value.trim();
    if (!query) {
        resultsEl.innerHTML = '<div class="empty-state"><h3>Quick Search</h3><p>Type to find songs and artists</p></div>';
        return;
    }
    
    const type = window._popupSearchType || 'songs';
    resultsEl.innerHTML = '<div class="page-loader"><div class="spinner"></div></div>';
    
    fetch(getApiUrl(`/api/search?q=${encodeURIComponent(query)}&type=${type}`))
        .then(r => r.json())
        .then(results => {
            if (!results || !results.length) {
                resultsEl.innerHTML = `<div class="empty-state"><h3>No ${type} found</h3></div>`;
                return;
            }
            if (type === 'artists') {
                let grid = '<div class="card-grid">';
                results.forEach(a => {
                    grid += `<div class="artist-card" onclick="closePopupSearch(); navigate('/artist/${encodeURIComponent(a.id)}')">
                        <img class="artist-card-img" src="${getTrackThumbnail(a)}" onerror="this.onerror=null;this.src=FALLBACK_IMG">
                        <div class="artist-card-name">${escapeHtml(a.name)}</div>
                        <div class="artist-card-type">Artist</div>
                    </div>`;
                });
                grid += '</div>';
                resultsEl.innerHTML = grid;
            } else {
                renderTrackList(results, resultsEl, { singleTrackQueue: true });
            }
        }).catch(() => {
            resultsEl.innerHTML = '<div class="empty-state"><h3>Search failed</h3></div>';
        });
}

window._isScrubbing = false;

window.seekToMs = function(pos) {
    if (typeof Player !== 'undefined') {
        Player.seekToTime(pos / 1000);
    }
};

function makeScrubber(trackId, fillId, thumbId, currentTextId) {
    const track = document.getElementById(trackId);
    if (!track) return;
    
    let isDragging = false;
    
    const getPercent = (clientX) => {
        const rect = track.getBoundingClientRect();
        const val = (clientX - rect.left) / rect.width;
        return Math.max(0, Math.min(1, val));
    };
    
    const updateUI = (pct) => {
        const fill = document.getElementById(fillId);
        const thumb = document.getElementById(thumbId);
        if (fill) fill.style.width = (pct * 100) + '%';
        if (thumb) thumb.style.left = (pct * 100) + '%';
        
        const duration = window.AndroidMediaSession && typeof window.AndroidMediaSession.getDuration === 'function'
            ? window.AndroidMediaSession.getDuration() / 1000
            : Player.audio.duration || 0;
            
        const curText = document.getElementById(currentTextId);
        if (curText && duration > 0) {
            curText.textContent = formatTime(pct * duration);
        }
    };
    
    const start = (clientX) => {
        isDragging = true;
        window._isScrubbing = true;
        track.classList.add('scrubbing');
        const pct = getPercent(clientX);
        updateUI(pct);
    };
    
    const move = (clientX) => {
        if (!isDragging) return;
        const pct = getPercent(clientX);
        updateUI(pct);
    };
    
    const end = (clientX) => {
        if (!isDragging) return;
        isDragging = false;
        window._isScrubbing = false;
        track.classList.remove('scrubbing');
        
        const pct = getPercent(clientX);
        const duration = window.AndroidMediaSession && typeof window.AndroidMediaSession.getDuration === 'function'
            ? window.AndroidMediaSession.getDuration() / 1000
            : Player.audio.duration || 0;
            
        if (duration > 0) {
            Player.seekToTime(pct * duration);
        }
    };
    
    // Mouse Events
    track.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        start(e.clientX);
        
        const onMouseMove = (moveEvent) => move(moveEvent.clientX);
        const onMouseUp = (upEvent) => {
            end(upEvent.clientX);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
    
    // Touch Events
    track.addEventListener('touchstart', (e) => {
        start(e.touches[0].clientX);
    }, { passive: true });
    
    track.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        move(e.touches[0].clientX);
    }, { passive: true });
    
    track.addEventListener('touchend', (e) => {
        if (!isDragging) return;
        end(e.changedTouches[0].clientX);
    });
}

// Like Button Long Press & Add to Playlist Modal
let longPressTimer = null;
let longPressTriggered = false;
// Timestamp until which the next click on a like button should be swallowed
// (the click that would otherwise fire right after a long-press activates).
let suppressLikeClickUntil = 0;

function setupLikeButtonLongPress() {
    const cancelPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    const startPress = (e) => {
        const btn = e.target.closest('.like-btn');
        if (!btn) return;

        cancelPress();
        longPressTriggered = false;

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            longPressTriggered = true;
            // Swallow only the like-button click that immediately follows.
            suppressLikeClickUntil = Date.now() + 800;
            if (navigator.vibrate) {
                navigator.vibrate(50);
            }
            triggerPlaylistPopupForButton(btn);
        }, 600);
    };

    const endPress = (e) => {
        cancelPress();
        // If a long press fired, prevent the trailing tap from toggling like.
        if (longPressTriggered && e.cancelable) {
            e.preventDefault();
        }
        longPressTriggered = false;
    };

    window.addEventListener('mousedown', startPress, { passive: true });
    window.addEventListener('touchstart', startPress, { passive: true });
    window.addEventListener('mouseup', endPress);
    window.addEventListener('touchend', endPress);
    window.addEventListener('touchcancel', cancelPress, { passive: true });
    window.addEventListener('touchmove', cancelPress, { passive: true });

    // Only suppress the follow-up click on the like button itself, and only
    // briefly. Clicks on the playlist popup (or anything else) are untouched.
    window.addEventListener('click', (e) => {
        if (e.target.closest('.like-btn') && Date.now() < suppressLikeClickUntil) {
            e.preventDefault();
            e.stopPropagation();
        }
        suppressLikeClickUntil = 0;
    }, true);
}

function triggerPlaylistPopupForButton(btn) {
    const row = btn.closest('.track-row');
    let track = null;
    if (row) {
        const trackData = row.getAttribute('data-track');
        if (trackData) {
            try {
                track = JSON.parse(trackData);
            } catch (e) {
                console.error("Failed to parse data-track JSON", e);
            }
        }
    }
    
    if (!track) {
        track = Store.currentTrack;
    }
    
    if (track) {
        showAddToPlaylistModal(track);
    } else {
        showToast("No active track found to add to playlist");
    }
}

function showAddToPlaylistModal(track) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    
    let playlistsHtml = '';
    if (Store.playlists.length === 0) {
        playlistsHtml = `<div class="empty-state" style="padding: 1rem 0;">
            <p style="margin-bottom: 1rem; color: var(--text-muted);">You don't have any playlists yet.</p>
            <button class="action-btn primary" onclick="event.stopPropagation(); showCreatePlaylistAndThenAdd(${escapeAttr(JSON.stringify(track))})">+ Create Playlist</button>
        </div>`;
    } else {
        playlistsHtml = '<div class="modal-playlists-list" style="max-height: 250px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; margin: 12px 0;">';
        Store.playlists.forEach(pl => {
            const hasSong = pl.tracks.some(t => t.id === track.id);
            playlistsHtml += `<div class="modal-playlist-item" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; background: rgba(255,255,255,0.05); border-radius: var(--radius-sm); cursor: pointer;" onclick="event.stopPropagation(); toggleSongInPlaylist('${pl.id}', ${escapeAttr(JSON.stringify(track))}, this)">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-weight: 500; font-size: 0.95rem; color: var(--text-primary);">${escapeHtml(pl.name)}</span>
                    <span class="pl-count-sub" style="font-size: 0.8rem; color: var(--text-muted); transition: transform 0.2s ease;">${pl.tracks.length} songs</span>
                </div>
                <span class="playlist-check-indicator" style="font-size: 1.1rem; color: ${hasSong ? '#a78bfa' : 'transparent'};">✓</span>
            </div>`;
        });
        playlistsHtml += '</div>';
        playlistsHtml += `<button class="action-btn secondary" style="width: 100%; margin-top: 8px;" onclick="event.stopPropagation(); showCreatePlaylistAndThenAdd(${escapeAttr(JSON.stringify(track))})">+ Create New Playlist</button>`;
    }
    
    overlay.style.zIndex = '3000';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width: 340px; width: 90%; text-align: left;">
        <h3 style="margin-top: 0; margin-bottom: 12px;">Add to Playlist</h3>
        <div style="display: flex; align-items: center; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
            <img src="${track.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'" style="width: 48px; height: 48px; border-radius: var(--radius-xs); object-fit: cover;">
            <div style="display: flex; flex-direction: column; overflow: hidden; white-space: nowrap;">
                <span style="font-weight: 600; font-size: 0.95rem; text-overflow: ellipsis; overflow: hidden; color: var(--text-primary);">${escapeHtml(track.title || '')}</span>
                <span style="font-size: 0.8rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden;">${escapeHtml(track.channel?.name || '')}</span>
            </div>
        </div>
        ${playlistsHtml}
        <div class="modal-actions" style="margin-top: 16px; justify-content: flex-end;">
            <button class="modal-btn cancel" onclick="closeModal()">Close</button>
        </div>
    </div>`;
}
function toggleSongInPlaylist(playlistId, track, el) {
    const pl = Store.playlists.find(p => p.id === playlistId);
    if (!pl) return;
    const hasSong = pl.tracks.some(t => t.id === track.id);
    const indicator = el ? el.querySelector('.playlist-check-indicator') : null;
    const countEl = el ? el.querySelector('.pl-count-sub') : null;
    
    if (hasSong) {
        Store.removeFromPlaylist(playlistId, track.id);
        if (indicator) {
            indicator.style.color = 'transparent';
            indicator.style.transform = 'scale(0.8)';
            setTimeout(() => indicator.style.transform = 'scale(1)', 200);
        }
        if (countEl) {
            countEl.textContent = `${pl.tracks.length} songs`;
            countEl.style.transform = 'scale(1.15)';
            setTimeout(() => countEl.style.transform = 'scale(1)', 200);
        }
        showToast(`Removed from ${pl.name}`);
    } else {
        Store.addToPlaylist(playlistId, track);
        if (indicator) {
            indicator.style.color = '#a78bfa';
            indicator.style.transform = 'scale(1.3)';
            setTimeout(() => indicator.style.transform = 'scale(1)', 200);
        }
        if (countEl) {
            countEl.textContent = `${pl.tracks.length} songs`;
            countEl.style.transform = 'scale(1.15)';
            setTimeout(() => countEl.style.transform = 'scale(1)', 200);
        }
        showToast(`Added to ${pl.name}`);
    }
}

function handleCreatePlaylistSubmit() {
    const input = document.getElementById('new-playlist-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) return;

    try {
        const plId = Store.createPlaylist(name);
        closeModal();
        showToast(`Created playlist "${name}"`);
        if (Router.currentRoute === '/library') {
            Router.render('/library');
        }
    } catch(e) {
        console.error('Failed to create playlist:', e);
        showToast('Failed to create playlist');
    }
}

function showCreatePlaylistAndThenAdd(track) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.style.zIndex = '3000';
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()">
        <h3>Create Playlist</h3>
        <form onsubmit="event.preventDefault(); createPlaylistAndAddSong(${escapeAttr(JSON.stringify(track))})">
            <input class="modal-input" id="playlist-name-input" placeholder="Playlist name..." autofocus required>
            <div class="modal-actions">
                <button type="button" class="modal-btn cancel" onclick="showAddToPlaylistModal(${escapeAttr(JSON.stringify(track))})">Back</button>
                <button type="submit" class="modal-btn create">Create & Add</button>
            </div>
        </form>
    </div>`;
    setTimeout(() => document.getElementById('playlist-name-input')?.focus(), 100);
}

function createPlaylistAndAddSong(track) {
    const input = document.getElementById('playlist-name-input');
    const name = input ? input.value.trim() : '';
    if (!name) {
        showToast('Please enter a playlist name');
        return;
    }
    
    try {
        const plId = Store.createPlaylist(name);
        if (track) {
            Store.addToPlaylist(plId, track);
            showToast(`Created "${name}" & added song`);
        } else {
            showToast(`Created playlist "${name}"`);
        }
        closeModal();
        if (Router.currentRoute === '/library') {
            Router.render('/library');
        }
    } catch(e) {
        console.error('Failed to create playlist:', e);
        showToast('Error creating playlist');
    }
}

/* Image compression helper to prevent localStorage quota exceptions */
function compressImageFile(file, maxWidth = 1000, maxHeight = 1000, quality = 0.75) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error("No file provided"));
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth || height > maxHeight) {
                    if (width / height > maxWidth / maxHeight) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    } else {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }
                
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                
                const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                resolve(compressedBase64);
            };
            img.onerror = () => reject(new Error("Failed to load image"));
            img.src = e.target.result;
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
    });
}

/* =============================================
   DYNAMIC THEME & WALLPAPER ENGINE
   ============================================= */
function applyTheme(config) {
    const theme = config || Store.theme;
    const root = document.documentElement;

    root.style.setProperty('--bg-color', theme.bgColor || '#121212');
    root.style.setProperty('--surface-color', theme.surfaceColor || '#181818');
    root.style.setProperty('--surface-hover', theme.surfaceHover || '#282828');
    root.style.setProperty('--primary-color', theme.primaryColor || '#1DB954');
    root.style.setProperty('--primary-hover', theme.primaryHover || '#1ED760');
    root.style.setProperty('--text-primary', theme.textPrimary || '#ffffff');
    root.style.setProperty('--text-secondary', theme.textSecondary || '#b3b3b3');
    root.style.setProperty('--border-color', theme.borderColor || '#282828');

    // Glassmorphism Mode logic
    const glassMode = theme.glassMode || 'none';
    const glassBlur = theme.glassBlur !== undefined ? theme.glassBlur : 16;
    const glassOpacity = theme.glassOpacity !== undefined ? theme.glassOpacity : 15;

    root.style.setProperty('--glass-blur', `${glassBlur}px`);
    root.style.setProperty('--glass-opacity', `${glassOpacity / 100}`);

    if (glassMode !== 'none') {
        document.body.classList.add('glass-mode');
        document.body.setAttribute('data-glass-mode', glassMode);
        
        let opacityVal = glassOpacity / 100;
        if (glassMode === 'subtle') opacityVal = Math.min(opacityVal, 0.20);
        if (glassMode === 'frosted') opacityVal = Math.min(opacityVal, 0.35);
        if (glassMode === 'clear') opacityVal = Math.max(opacityVal, 0.06);

        root.style.setProperty('--surface-glass-bg', `rgba(255, 255, 255, ${opacityVal})`);
        root.style.setProperty('--surface-glass-hover', `rgba(255, 255, 255, ${opacityVal + 0.1})`);
        root.style.setProperty('--sidebar-glass-bg', `rgba(18, 18, 18, ${Math.max(opacityVal, 0.3)})`);
    } else {
        document.body.classList.remove('glass-mode');
        document.body.removeAttribute('data-glass-mode');
    }

    const layer = document.getElementById('app-wallpaper-layer');
    const overlay = document.getElementById('app-wallpaper-overlay');
    if (layer && overlay) {
        if (theme.wallpaperData) {
            document.body.classList.add('has-wallpaper');
            layer.style.display = 'block';
            layer.style.backgroundImage = `url('${theme.wallpaperData}')`;
            layer.style.filter = `blur(${theme.wallpaperBlur !== undefined ? theme.wallpaperBlur : 0}px)`;
            overlay.style.backgroundColor = `rgba(0, 0, 0, ${(theme.wallpaperOpacity !== undefined ? theme.wallpaperOpacity : 50) / 100})`;
        } else {
            document.body.classList.remove('has-wallpaper');
            layer.style.display = 'none';
            layer.style.backgroundImage = '';
        }
    }
}

function applyThemePreset(presetKey) {
    const preset = THEME_PRESETS[presetKey];
    if (!preset) return;

    Store.theme = {
        ...Store.theme,
        preset: presetKey,
        bgColor: preset.bgColor,
        surfaceColor: preset.surfaceColor,
        surfaceHover: preset.surfaceHover,
        primaryColor: preset.primaryColor,
        primaryHover: preset.primaryHover,
        textPrimary: preset.textPrimary,
        textSecondary: preset.textSecondary,
        borderColor: preset.borderColor
    };
    Store.save();
    applyTheme();

    document.querySelectorAll('.theme-preset-card').forEach(card => {
        const key = card.getAttribute('data-preset-key');
        if (key) {
            card.classList.toggle('active', key === presetKey);
        }
    });

    syncCustomColorInputsInDom();
    showToast(`Applied ${preset.name} theme`);
}

function updateGlassMode(mode) {
    Store.theme.glassMode = mode;
    Store.save();
    applyTheme();
    if (document.getElementById('appearance-modal-box')) {
        openAppearanceModal();
    }
    showToast(`UI Style: ${mode === 'none' ? 'Solid' : mode.charAt(0).toUpperCase() + mode.slice(1) + ' Glass'}`);
}

function updateGlassBlur(val) {
    Store.theme.glassBlur = parseInt(val, 10);
    Store.save();
    applyTheme();
    const label = document.getElementById('glass-blur-label');
    if (label) label.textContent = `${val}px`;
}

function updateGlassOpacity(val) {
    Store.theme.glassOpacity = parseInt(val, 10);
    Store.save();
    applyTheme();
    const label = document.getElementById('glass-opacity-label');
    if (label) label.textContent = `${val}%`;
}

function updateCustomColor(key, hex) {
    if (!hex) return;
    Store.theme[key] = hex;
    Store.theme.preset = 'custom';
    Store.save();
    applyTheme();

    const input = document.getElementById(`color-picker-${key}`);
    const hexInput = document.getElementById(`color-hex-${key}`);
    const badge = document.getElementById(`color-badge-${key}`);
    if (input && !hex.startsWith('rgba') && hex !== 'transparent') input.value = hex;
    if (hexInput) hexInput.value = hex.toUpperCase();
    if (badge) badge.style.background = hex;

    document.querySelectorAll(`.pill-${key}`).forEach(pill => {
        pill.classList.toggle('active-pill', pill.getAttribute('data-hex') === hex);
    });
}

function syncCustomColorInputsInDom() {
    const keys = ['primaryColor', 'bgColor', 'surfaceColor', 'textPrimary', 'textSecondary', 'borderColor'];
    keys.forEach(k => {
        const input = document.getElementById(`color-picker-${k}`);
        const hexInput = document.getElementById(`color-hex-${k}`);
        const badge = document.getElementById(`color-badge-${k}`);
        const val = Store.theme[k];
        if (input && val && !val.startsWith('rgba') && val !== 'transparent') input.value = val;
        if (hexInput && val) hexInput.value = val.toUpperCase();
        if (badge && val) badge.style.background = val;
    });
}

function resetThemeToDefault() {
    Store.theme = {
        preset: 'default',
        bgColor: '#121212',
        surfaceColor: '#181818',
        surfaceHover: '#282828',
        primaryColor: '#1DB954',
        primaryHover: '#1ED760',
        textPrimary: '#ffffff',
        textSecondary: '#b3b3b3',
        borderColor: '#282828',
        glassMode: 'none',
        glassBlur: 16,
        glassOpacity: 15,
        wallpaperData: '',
        wallpaperBlur: 20,
        wallpaperOpacity: 50
    };
    Store.save();
    applyTheme();
    if (document.getElementById('appearance-modal-box')) {
        openAppearanceModal();
    }
    showToast('Reset theme to default');
}

function handleWallpaperUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    showToast('Processing wallpaper...');

    compressImageFile(file, 1280, 720, 0.75).then(base64 => {
        Store.theme.wallpaperData = base64;
        Store.save();
        applyTheme();
        if (document.getElementById('appearance-modal-box')) {
            openAppearanceModal();
        }
        showToast('Wallpaper applied!');
    }).catch(e => {
        console.error('Wallpaper processing failed:', e);
        showToast('Failed to process image');
    });
}

function removeWallpaper() {
    Store.theme.wallpaperData = '';
    Store.save();
    applyTheme();
    if (document.getElementById('appearance-modal-box')) {
        openAppearanceModal();
    }
    showToast('Wallpaper removed');
}

function updateWallpaperBlur(val) {
    Store.theme.wallpaperBlur = parseInt(val, 10);
    Store.save();
    applyTheme();
    const label = document.getElementById('wallpaper-blur-label');
    if (label) label.textContent = `${val}px`;
}

function updateWallpaperOpacity(val) {
    Store.theme.wallpaperOpacity = parseInt(val, 10);
    Store.save();
    applyTheme();
    const label = document.getElementById('wallpaper-opacity-label');
    if (label) label.textContent = `${val}%`;
}

/* =============================================
   SETTINGS POPUP MODALS
   ============================================= */
function openAppearanceModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    
    let presetsHtml = '';
    Object.keys(THEME_PRESETS).forEach(key => {
        const p = THEME_PRESETS[key];
        const isActive = Store.theme.preset === key;
        presetsHtml += `<div class="theme-preset-card ${isActive ? 'active' : ''}" data-preset-key="${key}" onclick="applyThemePreset('${key}')">
            <div class="preset-preview-dots">
                <div class="preset-dot" style="background:${p.bgColor}"></div>
                <div class="preset-dot" style="background:${p.surfaceColor}"></div>
                <div class="preset-dot" style="background:${p.primaryColor}"></div>
            </div>
            <div class="theme-preset-name">${escapeHtml(p.name)}</div>
        </div>`;
    });

    const colorItems = [
        { key: 'primaryColor', label: 'Primary Accent', presets: ['#1DB954', '#00F2FE', '#FF007F', '#a855f7', '#f59e0b', '#ef4444', '#ffffff', '#10b981'] },
        { key: 'bgColor', label: 'App Background', presets: ['#121212', '#000000', '#0d021a', '#1a090d', '#120d1c', '#061712', '#1c150c', 'rgba(18,18,18,0.65)'] },
        { key: 'surfaceColor', label: 'Card Surface', presets: ['#181818', '#0a0a0a', '#1a0533', '#2b0f16', 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.4)', '#282828', 'transparent'] },
        { key: 'textPrimary', label: 'Primary Text', presets: ['#ffffff', '#00ffff', '#fff0f2', '#f5f3ff', '#ecfdf5', '#fffbeb', '#e2e8f0', '#10b981'] },
        { key: 'textSecondary', label: 'Secondary Text', presets: ['#b3b3b3', '#888888', '#b967ff', '#d697a3', '#a78bfa', '#6ee7b7', '#fcd34d', '#94a3b8'] },
        { key: 'borderColor', label: 'Border Color', presets: ['#282828', '#1a1a1a', '#ff007f', '#421721', 'rgba(255,255,255,0.12)', 'transparent', '#334155', '#475569'] }
    ];

    let colorCardsHtml = '';
    colorItems.forEach(item => {
        const val = Store.theme[item.key] || '#ffffff';
        const isPickerVal = (!val.startsWith('rgba') && val !== 'transparent') ? val : '#121212';

        let pillsHtml = '';
        item.presets.forEach(pColor => {
            const isPillActive = val.toLowerCase() === pColor.toLowerCase();
            const pillStyle = pColor === 'transparent' 
                ? 'background:linear-gradient(135deg, rgba(255,255,255,0.3), rgba(0,0,0,0.5));border:1px dashed #fff;'
                : `background:${pColor};`;
            pillsHtml += `<div class="preset-pill pill-${item.key} ${isPillActive ? 'active-pill' : ''}" data-hex="${pColor}" style="${pillStyle}" title="${pColor}" onclick="updateCustomColor('${item.key}', '${pColor}')"></div>`;
        });

        colorCardsHtml += `
            <div class="custom-color-card">
                <div class="custom-color-card-top">
                    <div class="custom-color-card-title">
                        <div class="color-preview-badge" id="color-badge-${item.key}" style="background:${val}"></div>
                        <span>${item.label}</span>
                    </div>
                    <div class="custom-color-inputs">
                        <input type="text" id="color-hex-${item.key}" class="custom-hex-input" value="${val.toUpperCase()}" onchange="updateCustomColor('${item.key}', this.value)">
                        <div class="color-picker-button-wrapper" title="Open Color Wheel">
                            <button class="action-btn secondary" style="padding:0.25rem 0.5rem;font-size:0.75rem;border-radius:var(--radius-full)" onclick="openColorWheelModal('${item.key}', '${val}')">Wheel 🎨</button>
                        </div>
                    </div>
                </div>
                <div class="color-preset-pills">
                    ${pillsHtml}
                </div>
            </div>
        `;
    });

    const glassMode = Store.theme.glassMode || 'none';

    overlay.innerHTML = `<div class="modal-box" id="appearance-modal-box" onclick="event.stopPropagation()" style="max-width:580px;max-height:88vh;overflow-y:auto;padding:1.5rem 1.8rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="margin:0;font-size:1.2rem">🎨 Appearance & Customization</h3>
            <button class="action-btn secondary" style="padding:0.3rem 0.7rem;font-size:0.85rem" onclick="closeModal()">✕</button>
        </div>

        <!-- GLASSMORPHISM & TRANSLUCENCY OPTIONS -->
        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:var(--radius-md);padding:14px;margin-bottom:1.2rem">
            <div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:0.95rem;color:var(--text-primary);margin-bottom:4px">
                <span>✨ Glassmorphism & Translucency Style</span>
            </div>
            <p style="font-size:0.82rem;color:var(--text-secondary);margin:0 0 10px 0">Makes app cards, sidebar, and controls translucent frosted glass so your wallpaper & custom background shine through!</p>
            
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
                <button class="chip ${glassMode === 'none' ? 'active' : ''}" style="${glassMode === 'none' ? 'background:var(--primary-color);color:#000;border-color:var(--primary-color);' : ''}" onclick="updateGlassMode('none')">Solid (Off)</button>
                <button class="chip ${glassMode === 'subtle' ? 'active' : ''}" style="${glassMode === 'subtle' ? 'background:var(--primary-color);color:#000;border-color:var(--primary-color);' : ''}" onclick="updateGlassMode('subtle')">Subtle Glass</button>
                <button class="chip ${glassMode === 'frosted' ? 'active' : ''}" style="${glassMode === 'frosted' ? 'background:var(--primary-color);color:#000;border-color:var(--primary-color);' : ''}" onclick="updateGlassMode('frosted')">Frosted Glass</button>
                <button class="chip ${glassMode === 'clear' ? 'active' : ''}" style="${glassMode === 'clear' ? 'background:var(--primary-color);color:#000;border-color:var(--primary-color);' : ''}" onclick="updateGlassMode('clear')">Ultra Clear</button>
            </div>

            ${glassMode !== 'none' ? `
                <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
                    <div>
                        <div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--text-primary);margin-bottom:2px">
                            <span>Frosted Glass Blur</span>
                            <span id="glass-blur-label" style="font-weight:600;color:var(--primary-color)">${Store.theme.glassBlur || 16}px</span>
                        </div>
                        <input type="range" class="settings-range" min="4" max="32" value="${Store.theme.glassBlur || 16}" oninput="updateGlassBlur(this.value)" style="width:100%">
                    </div>
                    <div>
                        <div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--text-primary);margin-bottom:2px">
                            <span>Glass Surface Opacity</span>
                            <span id="glass-opacity-label" style="font-weight:600;color:var(--primary-color)">${Store.theme.glassOpacity || 15}%</span>
                        </div>
                        <input type="range" class="settings-range" min="5" max="60" value="${Store.theme.glassOpacity || 15}" oninput="updateGlassOpacity(this.value)" style="width:100%">
                    </div>
                </div>
            ` : ''}
        </div>

        <div style="font-weight:600;font-size:0.95rem;margin-top:0.4rem;color:var(--text-primary)">Color Theme Presets</div>
        <div class="theme-preset-grid">
            ${presetsHtml}
        </div>

        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:1.2rem 0">

        <div style="display:flex;justify-content:space-between;align-items:center">
            <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">Custom Color Palette</div>
            <button class="action-btn secondary" style="padding:0.25rem 0.6rem;font-size:0.75rem" onclick="resetThemeToDefault()">Reset Palette</button>
        </div>
        <p style="font-size:0.82rem;color:var(--text-secondary);margin:4px 0 10px 0">Tap any preset pill, type a hex code, or click the color wheel to customize.</p>
        
        <div class="custom-color-grid">
            ${colorCardsHtml}
        </div>

        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:1.2rem 0">

        <div style="font-weight:600;font-size:0.95rem;color:var(--text-primary)">Custom Background Wallpaper</div>
        <p style="font-size:0.82rem;color:var(--text-secondary);margin-top:4px">Upload a photo to use as a full background wallpaper for the app.</p>
        
        <div style="display:flex;align-items:center;gap:10px;margin-top:0.75rem;margin-bottom:1rem">
            <button class="action-btn primary" style="padding:0.4rem 0.9rem;font-size:0.85rem" onclick="document.getElementById('modal-wallpaper-file-input').click()">Upload Wallpaper</button>
            ${Store.theme.wallpaperData ? `<button class="action-btn danger" style="padding:0.4rem 0.9rem;font-size:0.85rem" onclick="removeWallpaper()">Remove Wallpaper</button>` : ''}
            <input type="file" id="modal-wallpaper-file-input" accept="image/*" style="display:none" onchange="handleWallpaperUpload(event)">
        </div>

        ${Store.theme.wallpaperData ? `
            <div style="margin-bottom:0.75rem">
                <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-primary);margin-bottom:4px">
                    <span>Wallpaper Blur</span>
                    <span id="wallpaper-blur-label" style="font-weight:600;color:var(--primary-color)">${Store.theme.wallpaperBlur || 0}px</span>
                </div>
                <input type="range" class="settings-range" min="0" max="40" value="${Store.theme.wallpaperBlur || 0}" oninput="updateWallpaperBlur(this.value)" style="width:100%">
            </div>
            <div>
                <div style="display:flex;justify-content:space-between;font-size:0.85rem;color:var(--text-primary);margin-bottom:4px">
                    <span>Dark Overlay (Dimming)</span>
                    <span id="wallpaper-opacity-label" style="font-weight:600;color:var(--primary-color)">${Store.theme.wallpaperOpacity !== undefined ? Store.theme.wallpaperOpacity : 50}%</span>
                </div>
                <input type="range" class="settings-range" min="10" max="90" value="${Store.theme.wallpaperOpacity !== undefined ? Store.theme.wallpaperOpacity : 50}" oninput="updateWallpaperOpacity(this.value)" style="width:100%">
            </div>
        ` : ''}

        <div class="modal-actions" style="margin-top:1.5rem">
            <button class="modal-btn create" onclick="closeModal()">Done</button>
        </div>
    </div>`;
}

function openAiRecommendationsModal() {
    const key = localStorage.getItem('geminiApiKey') || '';
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:440px">
        <h3>🤖 AI Music Recommendations</h3>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem">Vamus automatically recommends music based on your listening history. Enter your Google Gemini API key to also get an extra AI-powered "AI Picks For You" row on the home screen.</p>
        
        <input class="modal-input" type="password" id="gemini-key-input" value="${escapeHtml(key)}" placeholder="Enter Gemini API key...">
        <div id="gemini-save-msg" style="color:var(--success-color);font-size:0.85rem;margin-top:4px;min-height:20px"></div>

        <div class="modal-actions">
            <button class="modal-btn cancel" onclick="closeModal()">Cancel</button>
            <button class="modal-btn create" onclick="saveGeminiKey()">Save Key</button>
        </div>
    </div>`;
}

function openPlaybackSettingsModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:440px">
        <h3>🎵 Playback & Audio Settings</h3>
        
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:1rem;margin-bottom:1rem">
            <div>
                <div style="font-weight:600;color:var(--text-primary)">Autoplay</div>
                <div style="font-size:0.82rem;color:var(--text-secondary)">Automatically play similar songs when queue ends</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="autoplay-toggle" ${Store.autoplayEnabled ? 'checked' : ''} onchange="toggleAutoplay()">
                <span class="toggle-slider"></span>
            </label>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
            <div>
                <div style="font-weight:600;color:var(--text-primary)">Crossfade</div>
                <div style="font-size:0.82rem;color:var(--text-secondary)">Smoothly blend between songs like YT Music</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="crossfade-toggle" ${Store.crossfadeEnabled ? 'checked' : ''} onchange="toggleCrossfade()">
                <span class="toggle-slider"></span>
            </label>
        </div>

        <div id="crossfade-duration-section" style="margin-top:0.5rem;${Store.crossfadeEnabled ? '' : 'opacity:0.4;pointer-events:none;'}">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
                <span style="font-size:0.9rem;color:var(--text-primary)">Crossfade Duration</span>
                <span id="crossfade-duration-label" style="font-size:0.9rem;color:var(--primary-color);font-weight:600">${Store.crossfadeDuration}s</span>
            </div>
            <input type="range" class="settings-range" id="crossfade-duration-slider" min="1" max="12" value="${Store.crossfadeDuration}" oninput="updateCrossfadeDuration(this.value)" style="width:100%">
        </div>

        <div class="modal-actions" style="margin-top:1.5rem">
            <button class="modal-btn create" onclick="closeModal()">Done</button>
        </div>
    </div>`;
}

function openServerUrlModal() {
    const url = localStorage.getItem('apiServerUrl') || 'http://localhost:5000';
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:440px">
        <h3>🔗 Server & API Base URL</h3>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem">Set the base URL of your Python Flask server endpoint (e.g. when running local Python in Termux or on a PC).</p>
        
        <input class="modal-input" type="text" id="api-server-url-input" value="${escapeHtml(url)}" placeholder="http://localhost:5000">
        <div id="api-server-save-msg" style="color:var(--success-color);font-size:0.85rem;margin-top:4px;min-height:20px"></div>

        <div class="modal-actions">
            <button class="modal-btn cancel" onclick="closeModal()">Cancel</button>
            <button class="modal-btn create" onclick="saveApiServerUrl()">Save Server URL</button>
        </div>
    </div>`;
}

function openAboutModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:400px">
        <h3>ℹ️ About Vamus</h3>
        <p style="font-size:0.9rem;color:var(--text-primary);margin-top:0.75rem">Vamus — Ad-free music streaming & audio player</p>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.25rem">Version 1.0.0 (Flask + ExoPlayer + Capacitor)</p>
        <p style="font-size:0.82rem;color:var(--text-muted);margin-top:0.75rem">Powered by ExoPlayer, YouTube Music API, and custom theme engines.</p>

        <div class="modal-actions" style="margin-top:1.5rem">
            <button class="modal-btn create" onclick="closeModal()">Close</button>
        </div>
    </div>`;
}

function openDangerZoneModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:420px;border-color:rgba(239,68,68,0.4)">
        <h3 style="color:var(--danger-color)">⚠️ Danger Zone</h3>
        <p style="font-size:0.88rem;color:var(--text-primary);margin-top:0.75rem">Clear all saved local data including liked songs, playlists, custom themes, wallpapers, and playback history?</p>
        <p style="font-size:0.82rem;color:var(--danger-color);margin-top:0.25rem">This action cannot be undone.</p>

        <div class="modal-actions" style="margin-top:1.5rem">
            <button class="modal-btn cancel" onclick="closeModal()">Cancel</button>
            <button class="modal-btn danger" style="background:var(--danger-color);color:white" onclick="localStorage.clear();location.reload()">Clear All Data</button>
        </div>
    </div>`;
}
function openPlaylistCustomizerModal(playlistId) {
    const pl = Store.playlists.find(p => p.id === playlistId);
    if (!pl) return;

    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    const bgVal = pl.customBgColor || '#4c1d95';

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:460px;padding:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem">
            <h3 style="margin:0;font-size:1.15rem;color:var(--text-primary)">🎨 Customize "${escapeHtml(pl.name)}"</h3>
            <button class="action-btn secondary" style="padding:0.3rem 0.6rem;font-size:0.8rem" onclick="closeModal()">✕</button>
        </div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem">Personalize your playlist cover art, header banner image, or accent colors.</p>

        <!-- Live Preview Header Banner -->
        <div id="pl-modal-banner-preview" style="height:90px;border-radius:var(--radius-md);margin-bottom:1.2rem;position:relative;overflow:hidden;display:flex;align-items:center;padding:1rem;background:${pl.bannerImage ? `url('${pl.bannerImage}') center/cover` : (bgVal === 'transparent' ? 'rgba(255,255,255,0.06)' : bgVal)}">
            <div style="position:absolute;inset:0;background:linear-gradient(transparent, rgba(0,0,0,0.5));pointer-events:none"></div>
            <div style="position:relative;z-index:1;display:flex;align-items:center;gap:12px">
                <img id="pl-modal-cover-preview" src="${pl.coverImage || (pl.tracks && pl.tracks[0] ? getTrackThumbnail(pl.tracks[0]) : FALLBACK_IMG)}" onerror="this.onerror=null;this.src=FALLBACK_IMG;" style="width:52px;height:52px;border-radius:var(--radius-sm);object-fit:cover;box-shadow:0 4px 12px rgba(0,0,0,0.4)">
                <div>
                    <div style="font-weight:700;font-size:1.1rem;color:#ffffff;text-shadow:0 2px 4px rgba(0,0,0,0.6)">${escapeHtml(pl.name)}</div>
                    <div style="font-size:0.8rem;color:rgba(255,255,255,0.8)">${pl.tracks.length} tracks</div>
                </div>
            </div>
        </div>
        
        <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:1.2rem">
            <!-- Cover Art Row -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:var(--radius-md);padding:12px">
                <label style="font-size:0.85rem;font-weight:600;color:var(--text-primary);display:block;margin-bottom:6px">Playlist Cover Photo</label>
                <div style="display:flex;align-items:center;gap:10px">
                    <button class="action-btn primary" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="document.getElementById('pl-cover-file-input').click()">Upload Cover</button>
                    ${pl.coverImage ? `<button class="action-btn danger" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="removePlaylistImage('${pl.id}', 'coverImage')">Remove</button>` : ''}
                </div>
                <input type="file" id="pl-cover-file-input" accept="image/*" style="display:none" onchange="handlePlaylistFileChange(event, '${pl.id}', 'coverImage')">
            </div>

            <!-- Header Banner Row -->
            <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:var(--radius-md);padding:12px">
                <label style="font-size:0.85rem;font-weight:600;color:var(--text-primary);display:block;margin-bottom:6px">Header Banner Image</label>
                <div style="display:flex;align-items:center;gap:10px">
                    <button class="action-btn primary" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="document.getElementById('pl-banner-file-input').click()">Upload Banner</button>
                    ${pl.bannerImage ? `<button class="action-btn danger" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="removePlaylistImage('${pl.id}', 'bannerImage')">Remove</button>` : ''}
                </div>
                <input type="file" id="pl-banner-file-input" accept="image/*" style="display:none" onchange="handlePlaylistFileChange(event, '${pl.id}', 'bannerImage')">
            </div>
        </div>

        <div class="modal-actions" style="margin-top:1.2rem">
            <button class="modal-btn cancel" onclick="closeModal()">Close</button>
            <button class="modal-btn create" onclick="savePlaylistColorCustomization('${pl.id}')">Save Changes</button>
        </div>
    </div>`;
}

function handlePlaylistFileChange(event, playlistId, field) {
    const file = event.target.files?.[0];
    if (!file) return;
    showToast('Processing image...');

    const maxW = field === 'coverImage' ? 500 : 1000;
    const maxH = field === 'coverImage' ? 500 : 400;

    compressImageFile(file, maxW, maxH, 0.8).then(base64 => {
        Store.updatePlaylistCustomization(playlistId, { [field]: base64 });
        openPlaylistCustomizerModal(playlistId);
        if (Router.currentRoute.startsWith('/playlist/')) {
            Router.render(Router.currentRoute);
        }
        showToast('Playlist image updated!');
    }).catch(e => {
        console.error('Playlist image processing failed:', e);
        showToast('Failed to process image');
    });
}

function removePlaylistImage(playlistId, field) {
    Store.updatePlaylistCustomization(playlistId, { [field]: '' });
    openPlaylistCustomizerModal(playlistId);
    if (Router.currentRoute.startsWith('/playlist/')) {
        Router.render(Router.currentRoute);
    }
    showToast('Customization removed');
}

function savePlaylistColorCustomization(playlistId) {
    const input = document.getElementById('pl-custom-bg-color');
    if (input) {
        Store.updatePlaylistCustomization(playlistId, { customBgColor: input.value });
    }
    closeModal();
    if (Router.currentRoute.startsWith('/playlist/')) {
        Router.render(Router.currentRoute);
    }
    showToast('Saved playlist customization!');
}

// Interactive Color Wheel Picker Modal
function openColorWheelModal(colorKey, currentVal) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    
    let activeColor = (currentVal && currentVal.startsWith('#')) ? currentVal : '#1DB954';

    overlay.style.display = 'flex';
    overlay.style.zIndex = '3200';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:380px;text-align:center;padding:1.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
            <h3 style="margin:0;font-size:1.1rem;color:var(--text-primary)">🎨 Select Color</h3>
            <button class="action-btn secondary" style="padding:0.2rem 0.5rem;font-size:0.8rem" onclick="openAppearanceModal()">✕</button>
        </div>

        <div style="position:relative;width:220px;height:220px;margin:0 auto 1.2rem auto">
            <canvas id="color-wheel-canvas" width="220" height="220" style="border-radius:50%;cursor:crosshair;touch-action:none;box-shadow:0 8px 24px rgba(0,0,0,0.5)"></canvas>
            <div id="color-wheel-center-badge" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;border:3px solid #ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.4);background:${activeColor}"></div>
        </div>

        <div style="display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:1.2rem">
            <span style="font-size:0.85rem;color:var(--text-secondary)">Hex:</span>
            <input type="text" id="color-wheel-hex-input" value="${activeColor.toUpperCase()}" style="width:110px;padding:0.4rem 0.6rem;background:rgba(255,255,255,0.08);border:1px solid var(--border-color);border-radius:var(--radius-sm);color:var(--text-primary);font-family:monospace;font-size:0.95rem;text-align:center;outline:none">
        </div>

        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:1.4rem">
            <div class="preset-pill" style="background:#1DB954" onclick="selectColorWheelHex('${colorKey}', '#1DB954')"></div>
            <div class="preset-pill" style="background:#00F2FE" onclick="selectColorWheelHex('${colorKey}', '#00F2FE')"></div>
            <div class="preset-pill" style="background:#a855f7" onclick="selectColorWheelHex('${colorKey}', '#a855f7')"></div>
            <div class="preset-pill" style="background:#ef4444" onclick="selectColorWheelHex('${colorKey}', '#ef4444')"></div>
            <div class="preset-pill" style="background:#f59e0b" onclick="selectColorWheelHex('${colorKey}', '#f59e0b')"></div>
            <div class="preset-pill" style="background:#ffffff" onclick="selectColorWheelHex('${colorKey}', '#ffffff')"></div>
            <div class="preset-pill" style="background:#121212" onclick="selectColorWheelHex('${colorKey}', '#121212')"></div>
        </div>

        <div class="modal-actions" style="justify-content:center">
            <button class="modal-btn cancel" onclick="openAppearanceModal()">Cancel</button>
            <button class="modal-btn create" onclick="saveColorWheelSelection('${colorKey}')">Apply Color</button>
        </div>
    </div>`;

    setTimeout(() => {
        initColorWheelCanvas(colorKey, activeColor);
    }, 50);
}

function initColorWheelCanvas(colorKey, startColor) {
    const canvas = document.getElementById('color-wheel-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const radius = canvas.width / 2;

    for (let x = -radius; x < radius; x++) {
        for (let y = -radius; y < radius; y++) {
            const distance = Math.sqrt(x * x + y * y);
            if (distance <= radius) {
                const angle = Math.atan2(y, x);
                const hue = ((angle * (180 / Math.PI)) + 360) % 360;
                const saturation = Math.min(100, (distance / radius) * 100);
                ctx.fillStyle = `hsl(${hue}, ${saturation}%, 50%)`;
                ctx.fillRect(x + radius, y + radius, 1, 1);
            }
        }
    }

    const pickColor = (e) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const x = clientX - rect.left - radius;
        const y = clientY - rect.top - radius;
        const distance = Math.sqrt(x * x + y * y);
        if (distance <= radius) {
            const angle = Math.atan2(y, x);
            const hue = ((angle * (180 / Math.PI)) + 360) % 360;
            const saturation = Math.min(100, (distance / radius) * 100);
            const hex = hslToHex(hue, saturation, 50);
            selectColorWheelHex(colorKey, hex);
        }
    };

    let isDragging = false;
    canvas.onmousedown = (e) => { isDragging = true; pickColor(e); };
    canvas.onmousemove = (e) => { if (isDragging) pickColor(e); };
    window.onmouseup = () => { isDragging = false; };

    canvas.ontouchstart = (e) => { isDragging = true; pickColor(e); };
    canvas.ontouchmove = (e) => { if (isDragging) pickColor(e); };
    window.ontouchend = () => { isDragging = false; };
}

function selectColorWheelHex(colorKey, hex) {
    const badge = document.getElementById('color-wheel-center-badge');
    const input = document.getElementById('color-wheel-hex-input');
    if (badge) badge.style.background = hex;
    if (input) input.value = hex.toUpperCase();
    Store.theme[colorKey] = hex;
}

function saveColorWheelSelection(colorKey) {
    const input = document.getElementById('color-wheel-hex-input');
    if (input && input.value) {
        updateCustomColor(colorKey, input.value.trim());
    }
    openAppearanceModal();
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}
