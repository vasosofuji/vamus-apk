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
    overlay.style.display = 'none';
    overlay.innerHTML = '';
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
        
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            if (q) {
                navigate(`/search?q=${encodeURIComponent(q)}`);
            } else {
                if (window.location.hash.startsWith('#/search')) {
                    navigate('/search');
                }
            }
        }, 400);
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

function parseLrc(lrcText) {
    const lines = [];
    lrcText.split('\n').forEach(line => {
        const match = line.match(/\[(\d+):(\d+\.?\d*)\](.*)/);
        if (match) {
            const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
            const text = match[3].trim();
            if (text) lines.push({ time, text });
        }
    });
    return lines;
}

function renderLyricLines() {
    const container = document.getElementById('lyrics-container');
    if (!container) return;
    container.innerHTML = window._lyricsData.map((line, i) => 
        `<div class="lyric-line" id="lyric-${i}" onclick="seekFromLyrics(${line.time})">${escapeHtml(line.text)}</div>`
    ).join('');
}

function updateLyricsHighlight(currentTime) {
    if (!window._lyricsData.length) return;
    let activeIdx = -1;
    for (let i = window._lyricsData.length - 1; i >= 0; i--) {
        if (currentTime >= window._lyricsData[i].time) { activeIdx = i; break; }
    }
    document.querySelectorAll('.lyric-line').forEach((el, i) => {
        el.classList.toggle('active', i === activeIdx);
    });
    if (activeIdx >= 0 && !window._userScrollingLyrics) {
        const el = document.getElementById(`lyric-${activeIdx}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                playPrev();
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
        bgImg.style.backgroundImage = `url('${track.thumbnail || FALLBACK_IMG}')`;
    }

    const prevTrack = _getPrevTrack();
    const nextTrack = _getNextTrack();
    const artUrl = track.thumbnail || FALLBACK_IMG;
    const prevArtUrl = prevTrack ? (prevTrack.thumbnail || FALLBACK_IMG) : '';
    const nextArtUrl = nextTrack ? (nextTrack.thumbnail || FALLBACK_IMG) : '';

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
        slideCurrent.innerHTML = `<img src="${artUrl}" onerror="this.src='${FALLBACK_IMG}'">`;
    }
    if (slidePrev) {
        slidePrev.style.transform = 'translateX(-110%) scale(0.88)';
        slidePrev.style.opacity = '0.5';
        slidePrev.innerHTML = prevArtUrl ? `<img src="${prevArtUrl}" onerror="this.src='${FALLBACK_IMG}'">` : '';
    }
    if (slideNext) {
        slideNext.style.transform = 'translateX(110%) scale(0.88)';
        slideNext.style.opacity = '0.5';
        slideNext.innerHTML = nextArtUrl ? `<img src="${nextArtUrl}" onerror="this.src='${FALLBACK_IMG}'">` : '';
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
                    <p id="mobile-track-artist">${escapeHtml(track.channel?.name || '')}</p>
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
    Store.queue = [...Store.queue, track];
    Store.emit('queueChanged');
    showToast(`Added to Queue`);
    Player._pushNextTrackToNative();
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
    
    let html = `
        <div class="queue-header">
            <h2>Play Queue</h2>
            ${Store.queue.length > 0 ? `<button class="clear-queue-btn" onclick="clearPlayerQueue()">Clear All</button>` : ''}
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
    
    if (Store.queue.length === 0) {
        html += `<div class="empty-state"><p style="color:var(--text-secondary)">Queue is empty</p></div>`;
    } else {
        html += `<div class="queue-list">`;
        Store.queue.forEach((track, i) => {
            html += `
                <div class="queue-item">
                    <img class="queue-item-thumb" src="${track.thumbnail || FALLBACK_IMG}">
                    <div class="queue-item-info" onclick="playQueueTrack(${i})">
                        <div class="queue-item-title">${escapeHtml(track.title)}</div>
                        <div class="queue-item-artist">${escapeHtml(track.channel?.name || '')}</div>
                    </div>
                    <div class="queue-item-actions">
                        <button class="queue-action-btn" onclick="moveQueueItem(${i}, -1)" ${i === 0 ? 'disabled' : ''}>↑</button>
                        <button class="queue-action-btn" onclick="moveQueueItem(${i}, 1)" ${i === Store.queue.length - 1 ? 'disabled' : ''}>↓</button>
                        <button class="queue-action-btn remove" onclick="removeQueueItem(${i})">✕</button>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
    }
    html += `</div>`;
    container.innerHTML = html;
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
    const track = Store.queue[index];
    const newQueue = Store.queue.slice(index);
    Player.playTrack(track, newQueue);
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
                    <span style="font-size: 0.8rem; color: var(--text-muted);">${pl.tracks.length} songs</span>
                </div>
                <span class="playlist-check-indicator" style="font-size: 1.1rem; color: ${hasSong ? '#a78bfa' : 'transparent'};">✓</span>
            </div>`;
        });
        playlistsHtml += '</div>';
        playlistsHtml += `<button class="action-btn secondary" style="width: 100%; margin-top: 8px;" onclick="event.stopPropagation(); showCreatePlaylistAndThenAdd(${escapeAttr(JSON.stringify(track))})">+ Create New Playlist</button>`;
    }
    
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
    const indicator = el.querySelector('.playlist-check-indicator');
    
    if (hasSong) {
        Store.removeFromPlaylist(playlistId, track.id);
        if (indicator) indicator.style.color = 'transparent';
        showToast(`Removed from ${pl.name}`);
    } else {
        Store.addToPlaylist(playlistId, track);
        if (indicator) indicator.style.color = '#a78bfa';
        showToast(`Added to ${pl.name}`);
    }
}

function showCreatePlaylistAndThenAdd(track) {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()">
        <h3>Create Playlist</h3>
        <form onsubmit="event.preventDefault(); createPlaylistAndAddSong(${escapeAttr(JSON.stringify(track))})">
            <input class="modal-input" id="playlist-name-input" placeholder="Playlist name..." autofocus>
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
    if (!name) return;
    
    const plId = Store.createPlaylist(name);
    Store.addToPlaylist(plId, track);
    
    closeModal();
    showToast(`Created & added to ${name}`);
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

    const layer = document.getElementById('app-wallpaper-layer');
    const overlay = document.getElementById('app-wallpaper-overlay');
    if (layer && overlay) {
        if (theme.wallpaperData) {
            layer.style.display = 'block';
            layer.style.backgroundImage = `url('${theme.wallpaperData}')`;
            layer.style.filter = `blur(${theme.wallpaperBlur || 0}px)`;
            overlay.style.backgroundColor = `rgba(0, 0, 0, ${(theme.wallpaperOpacity !== undefined ? theme.wallpaperOpacity : 50) / 100})`;
        } else {
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

    if (Router.currentRoute === '/settings') {
        Router.render('/settings');
    }
    showToast(`Applied ${preset.name} theme`);
}

function updateCustomColor(key, hex) {
    Store.theme[key] = hex;
    Store.theme.preset = 'custom';
    Store.save();
    applyTheme();
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
        wallpaperData: '',
        wallpaperBlur: 20,
        wallpaperOpacity: 50
    };
    Store.save();
    applyTheme();
    if (Router.currentRoute === '/settings') {
        Router.render('/settings');
    }
    showToast('Reset theme to default');
}

function handleWallpaperUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        Store.theme.wallpaperData = base64;
        Store.save();
        applyTheme();
        if (Router.currentRoute === '/settings') {
            Router.render('/settings');
        }
        showToast('Wallpaper applied!');
    };
    reader.readAsDataURL(file);
}

function removeWallpaper() {
    Store.theme.wallpaperData = '';
    Store.save();
    applyTheme();
    if (Router.currentRoute === '/settings') {
        Router.render('/settings');
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
   PER-PLAYLIST CUSTOMIZER MODAL
   ============================================= */
function openPlaylistCustomizerModal(playlistId) {
    const pl = Store.playlists.find(p => p.id === playlistId);
    if (!pl) return;

    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;

    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="modal-box" onclick="event.stopPropagation()" style="max-width:440px">
        <h3>🎨 Customize "${escapeHtml(pl.name)}"</h3>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem">Upload custom cover art, header banner, or choose accent colors for this playlist.</p>
        
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:1.2rem">
            <div>
                <label style="font-size:0.85rem;font-weight:600;color:var(--text-primary);display:block;margin-bottom:4px">Playlist Cover Art</label>
                <div style="display:flex;align-items:center;gap:10px">
                    ${pl.coverImage ? `<img src="${pl.coverImage}" style="width:48px;height:48px;border-radius:8px;object-fit:cover">` : '<div style="width:48px;height:48px;border-radius:8px;background:var(--surface-hover);display:flex;align-items:center;justify-content:center;color:var(--text-secondary)">🎵</div>'}
                    <button class="action-btn secondary" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="document.getElementById('pl-cover-file-input').click()">Upload Cover</button>
                    ${pl.coverImage ? `<button class="action-btn danger" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="removePlaylistImage('${pl.id}', 'coverImage')">Remove</button>` : ''}
                </div>
                <input type="file" id="pl-cover-file-input" accept="image/*" style="display:none" onchange="handlePlaylistFileChange(event, '${pl.id}', 'coverImage')">
            </div>

            <div>
                <label style="font-size:0.85rem;font-weight:600;color:var(--text-primary);display:block;margin-bottom:4px">Playlist Header Banner</label>
                <div style="display:flex;align-items:center;gap:10px">
                    ${pl.bannerImage ? `<img src="${pl.bannerImage}" style="width:72px;height:36px;border-radius:6px;object-fit:cover">` : '<div style="width:72px;height:36px;border-radius:6px;background:var(--surface-hover);display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:0.75rem">Banner</div>'}
                    <button class="action-btn secondary" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="document.getElementById('pl-banner-file-input').click()">Upload Banner</button>
                    ${pl.bannerImage ? `<button class="action-btn danger" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="removePlaylistImage('${pl.id}', 'bannerImage')">Remove</button>` : ''}
                </div>
                <input type="file" id="pl-banner-file-input" accept="image/*" style="display:none" onchange="handlePlaylistFileChange(event, '${pl.id}', 'bannerImage')">
            </div>

            <div>
                <label style="font-size:0.85rem;font-weight:600;color:var(--text-primary);display:block;margin-bottom:4px">Header Accent Color</label>
                <div style="display:flex;align-items:center;gap:10px">
                    <input type="color" id="pl-custom-bg-color" value="${pl.customBgColor || '#4c1d95'}" class="color-input-swatch">
                    <span style="font-size:0.85rem;color:var(--text-secondary)">Pick Header Color</span>
                    ${pl.customBgColor ? `<button class="action-btn secondary" style="padding:0.3rem 0.6rem;font-size:0.75rem" onclick="removePlaylistImage('${pl.id}', 'customBgColor')">Reset</button>` : ''}
                </div>
            </div>
        </div>

        <div class="modal-actions">
            <button class="modal-btn cancel" onclick="closeModal()">Done</button>
            <button class="modal-btn create" onclick="savePlaylistColorCustomization('${pl.id}')">Save Changes</button>
        </div>
    </div>`;
}

function handlePlaylistFileChange(event, playlistId, field) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        Store.updatePlaylistCustomization(playlistId, { [field]: base64 });
        openPlaylistCustomizerModal(playlistId);
        if (Router.currentRoute.startsWith('/playlist/')) {
            Router.render(Router.currentRoute);
        }
        showToast('Playlist customization updated!');
    };
    reader.readAsDataURL(file);
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
