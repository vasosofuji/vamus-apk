// App initialization
window._lyricsOpenedFromPlayer = false;

document.addEventListener('DOMContentLoaded', () => {
    Player.init();
    Router.init();
    updateSidebarPlaylists();
    setupSearchSuggestions();
    setupMobilePlayerExpand();
    setupBackButton();
    setupLyricsContainer();
    
    // Listen for store changes
    Store.on('playlistsChanged', () => {
        updateSidebarPlaylists();
        // Re-render current page if on library/playlist
        if (Router.currentRoute === '/library' || Router.currentRoute.startsWith('/playlist/')) {
            Router.render(Router.currentRoute);
        }
    });
    
    Store.on('trackChanged', () => {
        // Re-render if on a page that shows playing state
        const route = Router.currentRoute;
        if (route === '/liked' || route.startsWith('/playlist/') || route.startsWith('/search')) {
            Router.render(route);
        }
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
    
    fetch(getApiUrl(`/api/lyrics?track=${encodeURIComponent(track)}&artist=${encodeURIComponent(artist)}`))
        .then(r => r.json())
        .then(data => {
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
            container.innerHTML = '<div style="color:var(--text-secondary)">Failed to load lyrics</div>';
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

function showMobilePlayer() {
    const overlay = document.getElementById('mobile-player-overlay');
    if (!overlay || !Store.currentTrack) return;
    
    const track = Store.currentTrack;
    const isPlaying = Store.isPlaying;
    const liked = Store.isLiked(track.id);
    const duration = Player.audio.duration || 0;
    const current = Player.audio.currentTime || 0;
    const pct = duration > 0 ? (current / duration) * 100 : 0;
    
    overlay.style.display = 'flex';
    overlay.innerHTML = `
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
            <img class="mobile-player-art" src="${track.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'">
            
            <div class="mobile-player-info">
                <div class="mobile-player-track-info">
                    <h2>${escapeHtml(track.title || '')}</h2>
                    <p>${escapeHtml(track.channel?.name || '')}</p>
                </div>
                <button class="btn-icon like-btn ${liked ? 'active' : ''}" onclick="toggleLikeCurrent(); showMobilePlayer();">
                    ${liked ? ICONS.heartFilled : ICONS.heart}
                </button>
            </div>
            
            <div class="mobile-player-progress">
                <div class="progress-track" onclick="Player.seekTo(event)">
                    <div class="progress-fill" id="mobile-progress-fill" style="width: ${pct}%"></div>
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
