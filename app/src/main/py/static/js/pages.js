const ICONS = {
    heart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
    heartFilled: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
    music: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    download: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    downloadCheck: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1DB954" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="20 6 9 17 4 12"/></svg>',
    trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>'
};

async function handleTrackDownloadClick(track, btnEl) {
    if (!track || !track.id) return;
    if (Store.isDownloaded(track.id)) {
        if (confirm(`Remove offline download for "${track.title || 'this track'}"?`)) {
            await Store.deleteDownload(track.id);
            showToast('Download removed', 'info');
            if (typeof Player !== 'undefined' && Player.updatePlayerUI) Player.updatePlayerUI();
            // Only the offline pages actually show download state, and
            // Router.render() jumps the list back to the top — don't do it to
            // someone who is halfway down a search page.
            if (Router.currentRoute === '/downloads' || Router.currentRoute === '/library') {
                Router.render(Router.currentRoute);
            }
        }
        return;
    }
    if (Store.isDownloading(track.id)) return;

    if (btnEl) {
        btnEl.classList.add('downloading');
        btnEl.innerHTML = '<span class="spinner-small" style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite"></span>';
    }
    showToast(`Downloading "${track.title || 'track'}"…`, 'info');
    try {
        const success = await Store.downloadTrack(track);
        if (success) {
            showToast(`Downloaded "${track.title || 'track'}"`, 'success');
        } else {
            showToast(`Download failed for "${track.title || 'track'}"`, 'error');
        }
    } catch (err) {
        console.error('Download click error:', err);
        showToast(`Download failed for "${track.title || 'track'}"`, 'error');
    } finally {
        if (btnEl) {
            btnEl.classList.remove('downloading');
        }
        if (typeof Player !== 'undefined' && Player.updatePlayerUI) Player.updatePlayerUI();
        if (Router.currentRoute === '/downloads' || Router.currentRoute === '/library') {
            Router.render(Router.currentRoute);
        }
    }
}

var FALLBACK_IMG = window.FALLBACK_IMG || "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'><rect width='200' height='200' fill='%231e1b4b'/><circle cx='100' cy='100' r='75' fill='%230f172a'/><circle cx='100' cy='100' r='55' fill='none' stroke='%23334155' stroke-width='3'/><circle cx='100' cy='100' r='35' fill='none' stroke='%23475569' stroke-width='2'/><circle cx='100' cy='100' r='20' fill='%237c3aed'/><circle cx='100' cy='100' r='6' fill='%23ffffff'/></svg>";

function getTrackThumbnail(t) {
    if (!t) return FALLBACK_IMG;
    if (typeof t === 'string' && t.length > 5) {
        return t.startsWith('//') ? 'https:' + t : t;
    }
    let url = t.thumbnail || t.cover || t.image || t.coverImage || t.albumArt || t.album_art || (t.thumbnails && t.thumbnails.length ? (t.thumbnails[t.thumbnails.length - 1].url || t.thumbnails[0].url || t.thumbnails[0]) : '');
    if (!url || typeof url !== 'string' || url.includes('undefined') || url.includes('null')) return FALLBACK_IMG;
    if (url.startsWith('//')) url = 'https:' + url;
    return url;
}

// A second, per-row long-press handler used to live here. It fired at the same
// 450ms as the global one in setup3DTouchMenu(), so a single hold opened two
// stacked menus — and because their buttons don't line up, tapping "Like" on
// the visible card could hit "Download for Offline" on the one underneath.
// setup3DTouchMenu() is now the single owner of the track context menu; the
// right-click path routes into it too.
function attachTrackRowLongPress(container) {
    if (!container) return;
    container.querySelectorAll('.track-row').forEach(row => {
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const track = getRowTrack(row);
            if (track) showTrackContextMenu(track);
        });
    });
}

function showTrackContextMenu(track) {
    if (typeof show3DTouchMenu === 'function') show3DTouchMenu(track);
}

const GENRES = [
    { id: 'techno', name: 'Techno', color: 'linear-gradient(135deg, #00F2FE, #4FACFE)' },
    { id: 'grunge', name: 'Grunge', color: 'linear-gradient(135deg, #434343, #000000)' },
    { id: 'rock', name: 'Rock', color: 'linear-gradient(135deg, #4A00E0, #8E2DE2)' },
    { id: 'hiphop', name: 'Hip Hop', color: 'linear-gradient(135deg, #11998E, #38EF7D)' },
    { id: 'electronic', name: 'Electronic', color: 'linear-gradient(135deg, #2193b0, #6dd5ed)' },
    { id: 'rnb', name: 'R&B', color: 'linear-gradient(135deg, #cc2b5e, #753a88)' },
    { id: 'jazz', name: 'Jazz', color: 'linear-gradient(135deg, #B79891, #94716B)' },
    { id: 'indie', name: 'Indie', color: 'linear-gradient(135deg, #3a7bd5, #3a6073)' },
    { id: 'country', name: 'Country', color: 'linear-gradient(135deg, #f2994a, #f2c94c)' },
    { id: 'metal', name: 'Metal', color: 'linear-gradient(135deg, #4b6cb7, #182848)' },
];

// Rendered track lists live here rather than being serialised into markup.
// Every row used to carry a full JSON copy of its own track *and* of the entire
// list in its onclick, so a 50-track page built ~50x more HTML than it needed
// and scrolling/re-rendering visibly stuttered.
const _trackLists = new Map();
let _trackListSeq = 0;

function _registerTrackList(tracks, singleTrackQueue) {
    const id = 'tl' + (++_trackListSeq);
    _trackLists.set(id, { tracks, singleTrackQueue });
    // Keep only the few most recent lists so long sessions don't accumulate.
    // A single page can register several (recents + recommendations + AI picks).
    while (_trackLists.size > 12) {
        _trackLists.delete(_trackLists.keys().next().value);
    }
    return id;
}

function getRowTrack(el) {
    const row = el && el.closest ? el.closest('[data-list-id][data-list-idx]') : null;
    if (!row) return null;
    const entry = _trackLists.get(row.getAttribute('data-list-id'));
    if (!entry) return null;
    return entry.tracks[parseInt(row.getAttribute('data-list-idx'), 10)] || null;
}

function playTrackFromList(listId, index) {
    const entry = _trackLists.get(listId);
    if (!entry) return;
    const track = entry.tracks[index];
    if (!track) return;
    // singleTrackQueue: rows from search / recommendation rows shouldn't drag
    // the whole result page into the queue behind them.
    Player.playTrack(track, entry.singleTrackQueue ? [track] : entry.tracks);
}

function toggleRowLike(btn, listId, index) {
    const entry = _trackLists.get(listId);
    const track = entry && entry.tracks[index];
    if (!track) return;
    Store.toggleLike(track);
    const liked = Store.isLiked(track.id);
    btn.classList.toggle('active', liked);
    btn.innerHTML = liked ? ICONS.heartFilled : ICONS.heart;
    if (typeof Player !== 'undefined' && Player.updatePlayerUI) Player.updatePlayerUI();
    if (Router.currentRoute === '/liked') Router.render('/liked');
}

function renderTrackList(tracks, container, options = {}) {
    const { showRemove = false, onRemove = null, singleTrackQueue = false } = options;
    if (!container) return;
    if (!tracks || tracks.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No tracks found</h3></div>';
        return;
    }

    const listId = _registerTrackList(tracks, singleTrackQueue);

    let html = '<div class="track-list">';
    html += `<div class="track-list-header">
        <span class="col-index">#</span>
        <span class="col-title">Title</span>
        <span class="col-artist">Artist</span>
        <span class="col-actions"></span>
        <span class="col-time">${ICONS.clock}</span>
    </div>`;
    html += '<div class="track-list-body">';

    tracks.forEach((track, i) => {
        const isPlaying = Store.currentTrack && Store.currentTrack.id === track.id;
        const liked = Store.isLiked(track.id);
        const artistName = track.channel?.name || track.artist || '';
        const durSec = track.durationInSec || track.duration || 0;
        const formattedDur = track.durationRaw || (durSec > 0 ? formatTime(durSec) : '');
        html += `<div class="track-row ${isPlaying ? 'playing' : ''}" data-list-id="${listId}" data-list-idx="${i}" data-track-id="${escapeAttr(String(track.id || ''))}" data-index="${i + 1}">
            <div class="swipe-bg-queue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Queue</div>
            <div class="track-row-content" onclick="playTrackFromList('${listId}', ${i})">
                <span class="col-index">${isPlaying ? '♫' : (i + 1)}</span>
                <div class="col-title">
                    <img class="row-thumb" src="${escapeAttr(getTrackThumbnail(track))}" onerror="this.onerror=null;this.src=FALLBACK_IMG;" alt="">
                    <div class="row-text-group">
                        <span class="row-name">${escapeHtml(track.title || '')}</span>
                        ${artistName ? `<span class="row-artist-sub">${escapeHtml(artistName)}</span>` : ''}
                    </div>
                </div>
                <div class="col-artist">${escapeHtml(artistName)}</div>
                <div class="col-actions">
                    <button class="btn-icon like-btn ${liked ? 'active' : ''}" onclick="event.stopPropagation(); toggleRowLike(this, '${listId}', ${i})">${liked ? ICONS.heartFilled : ICONS.heart}</button>
                    ${showRemove ? `<button class="btn-icon danger" onclick="event.stopPropagation(); (${onRemove})(${escapeAttr(JSON.stringify(track.id))})">${ICONS.x}</button>` : ''}
                </div>
                <span class="col-time">${formattedDur}</span>
            </div>
        </div>`;
    });

    html += '</div></div>';
    container.innerHTML = html;

    // Attach hold-down / long-press context menu to track rows
    attachTrackRowLongPress(container);

    // Warm stream-URL cache for tracks most likely to be played first
    prefetchStreams(tracks.slice(0, 5).filter(t => t && !Store.isDownloaded(t.id)).map(t => t.id));
}

// Ask the backend to pre-resolve stream URLs. Ids already requested this
// session are skipped so scrolling/re-rendering can't spam the resolver.
const _prefetchedIds = new Set();
function prefetchStreams(ids) {
    try {
        const fresh = (ids || []).filter(id => id && !_prefetchedIds.has(id));
        if (fresh.length === 0) return;
        fresh.forEach(id => _prefetchedIds.add(id));
        fetch(getApiUrl('/api/prefetch?ids=' + fresh.join(','))).catch(() => {});
    } catch (e) {}
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ===== HOME PAGE =====
function renderHomePage(container) {
    const h = new Date().getHours();
    const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    
    let html = `<div class="animate-fade-up">`;
    html += `<h1 class="home-greeting">${greeting}</h1>`;
    
    // Quick picks
    if (Store.likedSongs.length > 0 || Store.playlists.length > 0) {
        html += '<div class="quick-row">';
        if (Store.likedSongs.length > 0) {
            html += `<a class="quick-card liked-card" href="#/liked">
                <div class="quick-card-icon">${ICONS.heartFilled}</div>
                <div class="quick-card-text"><span>Liked Songs</span><small>${Store.likedSongs.length} songs</small></div>
            </a>`;
        }
        Store.playlists.forEach(pl => {
            const coverBg = pl.coverImage
                ? `background-image:url('${pl.coverImage}');background-size:cover;background-position:center;`
                : (pl.customBgColor ? `background:linear-gradient(135deg,${pl.customBgColor},#7c3aed);` : '');
            const coverContent = pl.coverImage ? '' : ICONS.music;
            html += `<a class="quick-card playlist-card" href="#/playlist/${pl.id}">
                <div class="quick-card-icon" style="${coverBg}">${coverContent}</div>
                <div class="quick-card-text"><span>${escapeHtml(pl.name)}</span><small>${pl.tracks.length} songs</small></div>
            </a>`;
        });
        html += '</div>';
    }
    
    // Recently played
    if (Store.recentlyPlayed.length > 0) {
        // Registered like a track list so long-press opens the same context
        // menu here as it does on a normal row (and the card stops carrying two
        // inline JSON copies of its track).
        const recent = Store.recentlyPlayed.slice(0, 20);
        const recentListId = _registerTrackList(recent, true);
        html += '<section style="margin-top:2rem"><h2 class="section-title">Recently Played</h2><div class="recent-grid">';
        recent.forEach((track, i) => {
            html += `<div class="recent-card" data-list-id="${recentListId}" data-list-idx="${i}" data-track-id="${escapeAttr(String(track.id || ''))}" onclick="playTrackFromList('${recentListId}', ${i})">
                <img src="${escapeAttr(getTrackThumbnail(track))}" onerror="this.onerror=null;this.src=FALLBACK_IMG;" alt="">
                <span class="recent-title">${escapeHtml(track.title || '')}</span>
                <span class="recent-artist">${escapeHtml(track.channel?.name || '')}</span>
            </div>`;
        });
        html += '</div></section>';
    }
    
    // Recommendations — seeded from user listening history + library, or default trending music for new users
    const seedTracks = [...Store.recentlyPlayed, ...Store.likedSongs];
    const seedIds = [...new Set(seedTracks.map(t => t.id).filter(Boolean))].slice(0, 5);
    const uniqueArtists = [...new Set(seedTracks.map(t => t.channel?.name).filter(Boolean))].slice(0, 5);
    const hasSeeds = seedIds.length > 0 || uniqueArtists.length > 0;
    const geminiKey = (localStorage.getItem('geminiApiKey') || '').trim();

    html += `<section style="margin-top:2rem" id="recs-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem">
            <h2 class="section-title" style="margin:0">Recommended For You</h2>
            <button class="btn-icon" title="Refresh Recommendations" onclick="refreshHomeRecommendations()" style="width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,0.06);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-secondary)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67"/></svg>
            </button>
        </div>
        <div id="recs-container"><div class="page-loader"><div class="spinner"></div><span>Finding songs you'll love...</span></div></div>
    </section>`;

    if (hasSeeds && geminiKey) {
        html += `<section style="margin-top:2rem" id="ai-recs-section">
            <h2 class="section-title">AI Picks For You</h2>
            <div id="ai-recs-container"><div class="page-loader"><div class="spinner"></div><span>Analyzing your taste...</span></div></div>
        </section>`;
    }
    
    // Genres
    html += '<section style="margin-top:2rem"><h2 class="section-title">Explore Genres</h2><div class="genre-grid">';
    GENRES.forEach(g => {
        html += `<div class="genre-card" style="background:${g.color}" onclick="navigate('/search?q=${encodeURIComponent(g.name)}&category=true')">${g.name}</div>`;
    });
    html += '</div></section>';
    
    // Empty state
    if (Store.recentlyPlayed.length === 0) {
        html += `<div class="empty-state" style="margin-top:2rem">
            ${ICONS.music}
            <h3>Welcome to Vamus</h3>
            <p>Search for songs and artists to get started</p>
        </div>`;
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    // Load recommendations (cached or fresh)
    loadHomeRecommendations();

    // Fetch AI recs async — only when the user has configured a Gemini key
    if (hasSeeds && geminiKey && uniqueArtists.length > 0) {
        fetchWithRetry(getApiUrl(`/api/ai-recommend?artistNames=${encodeURIComponent(uniqueArtists.join(','))}&apiKey=${encodeURIComponent(geminiKey)}`))
            .then(r => r.json())
            .then(tracks => {
                const recsContainer = document.getElementById('ai-recs-container');
                if (recsContainer && tracks.length > 0) {
                    renderTrackList(tracks, recsContainer, { singleTrackQueue: true });
                } else {
                    const s = document.getElementById('ai-recs-section');
                    if (s) s.remove();
                }
            }).catch(() => {
                const s = document.getElementById('ai-recs-section');
                if (s) s.remove();
            });
    }
}

window._cachedHomeRecs = null;

function refreshHomeRecommendations() {
    window._cachedHomeRecs = null;
    const c = document.getElementById('recs-container');
    if (c) {
        c.innerHTML = '<div class="page-loader"><div class="spinner"></div><span>Refreshing recommendations...</span></div>';
    }
    loadHomeRecommendations();
}

function loadHomeRecommendations() {
    const c = document.getElementById('recs-container');
    if (!c) return;

    if (window._cachedHomeRecs && window._cachedHomeRecs.length > 0) {
        renderTrackList(window._cachedHomeRecs, c, { singleTrackQueue: true, hideDownload: true });
        return;
    }

    const seedTracks = [...Store.recentlyPlayed, ...Store.likedSongs];
    const seedIds = [...new Set(seedTracks.map(t => t.id).filter(Boolean))].slice(0, 5);
    const uniqueArtists = [...new Set(seedTracks.map(t => t.channel?.name).filter(Boolean))].slice(0, 5);

    const params = new URLSearchParams();
    if (seedIds.length) params.set('seedIds', seedIds.join(','));
    if (uniqueArtists.length) params.set('artistNames', uniqueArtists.join(','));

    fetchWithRetry(getApiUrl(`/api/home-recommendations?${params.toString()}`))
        .then(r => r.json())
        .then(tracks => {
            const container = document.getElementById('recs-container');
            if (!container) return;
            if (tracks && tracks.length > 0) {
                window._cachedHomeRecs = tracks;
                renderTrackList(tracks, container, { singleTrackQueue: true, hideDownload: true });
            } else {
                fetchFallbackHomeRecommendations(container);
            }
        }).catch(() => {
            const container = document.getElementById('recs-container');
            if (container) fetchFallbackHomeRecommendations(container);
        });
}

function fetchFallbackHomeRecommendations(container) {
    if (!container) return;
    fetchWithRetry(getApiUrl('/api/search?q=top+hits&type=songs'))
        .then(r => r.json())
        .then(tracks => {
            if (tracks && tracks.length > 0) {
                window._cachedHomeRecs = tracks.slice(0, 15);
                renderTrackList(tracks.slice(0, 15), container, { singleTrackQueue: true, hideDownload: true });
            } else {
                const s = document.getElementById('recs-section');
                if (s) s.remove();
            }
        }).catch(() => {
            const s = document.getElementById('recs-section');
            if (s) s.remove();
        });
}

// ===== SEARCH PAGE =====
function handleSearchPageSubmit() {
    const input = document.getElementById('search-page-input');
    const q = input ? input.value.trim() : '';
    if (!q) return;
    const activeType = window.location.hash.includes('type=artists') ? 'artists' : 'songs';
    navigate(`/search?q=${encodeURIComponent(q)}&type=${activeType}`);
}

function handleSearchPageInput(e) {
    const val = e.target.value;
    const clearBtn = document.getElementById('search-page-clear-btn');
    if (clearBtn) clearBtn.classList.toggle('show', val.length > 0);
}

function clearSearchPageInput() {
    const input = document.getElementById('search-page-input');
    if (input) input.value = '';
    const clearBtn = document.getElementById('search-page-clear-btn');
    if (clearBtn) clearBtn.classList.remove('show');
    const activeType = window.location.hash.includes('type=artists') ? 'artists' : 'songs';
    navigate(`/search?type=${activeType}`);
}

function renderSearchPage(container, path) {
    const params = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
    const query = params.get('q') || '';
    const type = params.get('type') || 'songs';
    const isCategory = params.get('category') === 'true';
    
    let html = '<div class="animate-fade-up">';
    
    // Search page bar (prominently rendered on all devices)
    html += `<div class="search-page-bar">
        <form onsubmit="event.preventDefault(); handleSearchPageSubmit();">
            <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <input id="search-page-input" type="text" value="${escapeHtml(isCategory ? '' : query)}" placeholder="Search songs, artists..." autocomplete="off" oninput="handleSearchPageInput(event)">
            <button id="search-page-clear-btn" type="button" class="search-page-clear-btn ${query ? 'show' : ''}" onclick="clearSearchPageInput()">✕</button>
        </form>
    </div>`;
    
    if (isCategory) {
        html += `<h1 style="margin: 0.5rem 0 1.2rem 0; font-size: 2rem; font-weight: 700; color: var(--text-primary);">${escapeHtml(query)}</h1>`;
    }
    
    // Tabs
    html += '<div class="chip-tabs">';
    html += `<button class="chip ${type === 'songs' ? 'active' : ''}" onclick="navigate('/search?q=${encodeURIComponent(document.getElementById('search-page-input')?.value || query)}&type=songs${isCategory ? '&category=true' : ''}')">Songs</button>`;
    html += `<button class="chip ${type === 'artists' ? 'active' : ''}" onclick="navigate('/search?q=${encodeURIComponent(document.getElementById('search-page-input')?.value || query)}&type=artists${isCategory ? '&category=true' : ''}')">Artists</button>`;
    html += '</div>';
    
    html += '<div id="search-results"></div>';
    html += '</div>';
    container.innerHTML = html;

    
    // Sync search input
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = isCategory ? '' : query;
    }
    
    // Sync global floating search input
    const floatingSearchInput = document.getElementById('floating-search-input');
    if (floatingSearchInput) {
        floatingSearchInput.value = isCategory ? '' : query;
        const clearBtn = document.getElementById('floating-search-clear-btn');
        if (clearBtn) {
            clearBtn.classList.toggle('show', floatingSearchInput.value.length > 0);
        }
    }
    
    if (!query) {
        document.getElementById('search-results').innerHTML = '<div class="empty-state"><h3>Search for music</h3><p>Find songs, artists, and more</p></div>';
        return;
    }
    
    window._searchCache = window._searchCache || new Map();
    const cacheKey = `${type}:${query.toLowerCase().trim()}`;
    const resultsEl = document.getElementById('search-results');

    const displaySearchResults = (results) => {
        if (!resultsEl) return;
        if (type === 'artists') {
            if (!results || !results.length) {
                resultsEl.innerHTML = '<div class="empty-state"><h3>No artists found</h3></div>';
                return;
            }
            let grid = '<div class="card-grid">';
            results.forEach(a => {
                grid += `<div class="artist-card" onclick="navigate('/artist/${encodeURIComponent(a.id)}')">
                    <img class="artist-card-img" src="${getTrackThumbnail(a)}" onerror="this.onerror=null;this.src=FALLBACK_IMG">
                    <div class="artist-card-name">${escapeHtml(a.name)}</div>
                    <div class="artist-card-type">Artist</div>
                </div>`;
            });
            grid += '</div>';
            resultsEl.innerHTML = grid;
        } else {
            renderTrackList(results, resultsEl, { singleTrackQueue: true, hideDownload: true });
        }
    };

    if (window._searchCache.has(cacheKey)) {
        displaySearchResults(window._searchCache.get(cacheKey));
    } else {
        resultsEl.innerHTML = '<div class="page-loader"><div class="spinner"></div></div>';
    }
    
    fetchWithRetry(getApiUrl(`/api/search?q=${encodeURIComponent(query)}&type=${type}`))
        .then(r => r.json())
        .then(results => {
            window._searchCache.set(cacheKey, results);
            displaySearchResults(results);
        }).catch(() => {
            if (!window._searchCache.has(cacheKey) && resultsEl) {
                resultsEl.innerHTML = '<div class="empty-state"><h3>Search failed</h3></div>';
            }
        });
}

// ===== LIBRARY PAGE =====
function renderLibraryPage(container) {
    let html = '<div class="animate-fade-up">';
    html += '<div class="page-header"><h1 class="home-greeting">Your Library</h1></div>';
    
    // Offline Downloads quick banner
    html += `<div class="settings-menu-card" onclick="navigate('/downloads')" style="margin-bottom:2rem;background:linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.05));border:1px solid rgba(16,185,129,0.3);cursor:pointer">
        <div class="settings-menu-icon" style="color:#10b981;display:flex;align-items:center;justify-content:center">${ICONS.download}</div>
        <div class="settings-menu-info">
            <div class="settings-menu-title" style="font-size:1.1rem;font-weight:700">Downloaded Songs (Offline Travels)</div>
            <div class="settings-menu-desc">${Store.downloadedTracks.length} songs downloaded for offline listening</div>
        </div>
        <div style="font-size:1.2rem;color:var(--text-muted)">→</div>
    </div>`;

    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem">
        <h2 class="section-title" style="margin:0">Playlists</h2>
        ${Store.playlists.length > 0 ? `<button class="action-btn primary" onclick="showCreatePlaylist()">+ Create Playlist</button>` : ''}
    </div>`;
    
    if (Store.playlists.length === 0) {
        html += `<div class="empty-state">
            ${ICONS.music}
            <h3>No playlists yet</h3>
            <p>Create your first playlist</p>
            <button class="action-btn primary" onclick="showCreatePlaylist()">Create Playlist</button>
        </div>`;
    } else {
        html += '<div class="card-grid playlist-grid">';
        Store.playlists.forEach(pl => {
            const coverBg = pl.coverImage
                ? `background-image:url('${pl.coverImage}');background-size:cover;background-position:center;`
                : `background:linear-gradient(135deg,${pl.customBgColor || '#4c1d95'},#7c3aed);`;
            const coverContent = pl.coverImage ? '' : ICONS.music;
            html += `<div class="album-card" onclick="navigate('/playlist/${pl.id}')" style="position:relative">
                <div class="playlist-card-cover" style="${coverBg}">${coverContent}</div>
                <div class="album-card-name">${escapeHtml(pl.name)}</div>
                <div class="album-card-type">${pl.tracks.length} songs</div>
            </div>`;
        });
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
}

// ===== DOWNLOADED SONGS PAGE =====
function renderDownloadedPage(container) {
    let html = '<div class="animate-fade-up">';
    
    // Hero
    html += `<div class="hero-section" style="background:linear-gradient(135deg, #059669, #10b981);display:flex;align-items:center;gap:1.5rem;padding:2.5rem 2rem;border-radius:16px;margin-bottom:2rem">
        <div class="hero-icon" style="width:96px;height:96px;border-radius:16px;background:rgba(255,255,255,0.18);display:flex;align-items:center;justify-content:center;color:#fff">
            ${ICONS.download}
        </div>
        <div class="hero-info">
            <h1 style="margin:0.25rem 0;font-size:2.2rem;font-weight:800">Downloaded Songs</h1>
            <p class="hero-meta" style="margin:0;opacity:0.9">${Store.downloadedTracks.length} songs</p>
        </div>
    </div>`;
    
    if (Store.downloadedTracks.length > 0) {
        html += '<div class="hero-actions" style="display:flex;gap:1rem;margin-bottom:1.5rem">';
        html += `<button class="action-btn primary" onclick="Player.playTrack(Store.downloadedTracks[0], Store.downloadedTracks)">▶ Play All</button>`;
        html += `<button class="action-btn secondary" onclick="Player.playTrack(Store.downloadedTracks[Math.floor(Math.random()*Store.downloadedTracks.length)], Store.downloadedTracks)">🔀 Shuffle</button>`;
        html += '</div>';
        html += '<div id="downloaded-tracks"></div>';
    } else {
        html += `<div class="empty-state">
            ${ICONS.download}
            <h3>No downloaded songs yet</h3>
            <p>Downloaded songs will appear here</p>
        </div>`;
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    if (Store.downloadedTracks.length > 0) {
        renderTrackList(Store.downloadedTracks, document.getElementById('downloaded-tracks'), {
            showRemove: true,
            onRemove: `(function(id){ Store.deleteDownload(id).then(() => { showToast('Download removed', 'info'); Router.render('/downloads'); }); })`
        });
    }
}

// ===== LIKED SONGS PAGE =====
function renderLikedPage(container) {
    let html = '<div class="animate-fade-up">';
    
    // Hero
    html += `<div class="hero-section liked-hero">
        <div class="hero-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        </div>
        <div class="hero-info">
            <h1>Liked Songs</h1>
            <p class="hero-meta">${Store.likedSongs.length} songs</p>
        </div>
    </div>`;
    
    if (Store.likedSongs.length > 0) {
        html += '<div class="hero-actions">';
        html += `<button class="action-btn primary" onclick="Player.playTrack(Store.likedSongs[0], Store.likedSongs)">▶ Play All</button>`;
        html += '</div>';
        html += '<div id="liked-tracks"></div>';
    } else {
        html += '<div class="empty-state"><h3>No liked songs yet</h3><p>Tap the heart on any song to save it here</p></div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    if (Store.likedSongs.length > 0) {
        renderTrackList(Store.likedSongs, document.getElementById('liked-tracks'), {
            showRemove: true,
            onRemove: `(function(id){ Store.toggleLike({id:id}); Router.render(Router.currentRoute); Player.updatePlayerUI(); })`
        });
    }
}

// ===== PLAYLIST PAGE =====
function renderPlaylistPage(container, id) {
    const pl = Store.playlists.find(p => p.id === id);
    if (!pl) {
        container.innerHTML = '<div class="empty-state"><h3>Playlist not found</h3></div>';
        return;
    }
    
    let html = '<div class="animate-fade-up">';
    
    const heroBgStyle = pl.bannerImage
        ? `background-image:url('${pl.bannerImage}');background-size:cover;background-position:center;`
        : (pl.customBgColor ? `background:linear-gradient(135deg, ${pl.customBgColor}, rgba(0,0,0,0.8));` : 'background:linear-gradient(135deg,#4c1d95,#7c3aed);');

    html += `<div class="hero-section playlist-hero ${pl.bannerImage ? 'custom-hero' : ''}" style="${heroBgStyle}">
        ${pl.bannerImage ? `<div class="playlist-banner-bg" style="background-image:url('${pl.bannerImage}')"></div>` : ''}
        ${pl.coverImage
            ? `<img src="${pl.coverImage}" class="playlist-custom-cover-img">`
            : `<div class="hero-icon" style="background:linear-gradient(135deg,#4c1d95,#7c3aed);z-index:1">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
               </div>`
        }
        <div class="hero-info" style="z-index:1">
            <div class="hero-type">Playlist</div>
            <h1>${escapeHtml(pl.name)}</h1>
            <p class="hero-meta">${pl.tracks.length} songs</p>
        </div>
    </div>`;
    
    html += '<div class="hero-actions playlist-actions-row">';
    if (pl.tracks.length > 0) {
        html += `<button class="action-btn primary" onclick="Player.playTrack(Store.playlists.find(p=>p.id==='${pl.id}').tracks[0], Store.playlists.find(p=>p.id==='${pl.id}').tracks)">▶ Play All</button>`;
    }
    html += `<button class="action-btn secondary" onclick="openPlaylistCustomizerModal('${pl.id}')">🎨 Customize</button>`;
    html += `<button class="action-btn danger" onclick="if(confirm('Delete this playlist?')){Store.deletePlaylist('${pl.id}');navigate('/library')}">Delete</button>`;
    html += '</div>';
    
    html += '<div id="playlist-tracks"></div>';
    html += '</div>';
    container.innerHTML = html;
    
    if (pl.tracks.length > 0) {
        renderTrackList(pl.tracks, document.getElementById('playlist-tracks'), {
            showIndex: true,
            showRemove: true,
            onRemove: `(function(id){ Store.removeFromPlaylist('${pl.id}', id); Router.render(Router.currentRoute); })`
        });
    } else {
        document.getElementById('playlist-tracks').innerHTML = '<div class="empty-state"><h3>No songs yet</h3><p>Search for songs and add them to this playlist</p></div>';
    }
}

// ===== ARTIST PAGE =====
function renderArtistPage(container, id) {
    container.innerHTML = '<div class="page-loader"><div class="spinner"></div><span>Loading artist...</span></div>';
    
    fetchWithRetry(getApiUrl(`/api/artist?id=${encodeURIComponent(id)}`))
        .then(r => r.json())
        .then(artist => {
            if (artist.error) {
                container.innerHTML = `<div class="empty-state"><h3>${escapeHtml(artist.error)}</h3></div>`;
                return;
            }
            
            const thumb = artist.thumbnails?.[artist.thumbnails.length - 1]?.url || artist.thumbnails?.[0]?.url || artist.thumbnail || artist.image || '';
            const bgThumb = artist.thumbnails?.[0]?.url || thumb;
            let html = '<div class="animate-fade-up">';
            
            // Hero
            html += `<div class="hero-section artist-hero" style="background-image:url('${bgThumb}');position:relative;overflow:hidden;padding:2.5rem 2rem;border-radius:16px;margin-bottom:1.5rem">
                <div class="hero-overlay" style="position:absolute;inset:0;background:linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.85));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)"></div>
                <div class="hero-info" style="position:relative;z-index:2;display:flex;align-items:center;gap:1.5rem">
                    <img class="artist-profile-avatar" src="${thumb || FALLBACK_IMG}" onerror="this.onerror=null;this.src=FALLBACK_IMG;" alt="${escapeHtml(artist.name || '')}" style="width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,0.25);box-shadow:0 8px 24px rgba(0,0,0,0.6);flex-shrink:0">
                    <div>
                        <div class="hero-type" style="font-size:0.85rem;text-transform:uppercase;letter-spacing:1px;font-weight:700;opacity:0.85">Artist</div>
                        <h1 style="margin:0.25rem 0;font-size:2.4rem;font-weight:800">${escapeHtml(artist.name || '')}</h1>
                    </div>
                </div>
            </div>`;
            
            // Actions
            if (artist.songs && artist.songs.length > 0) {
                html += '<div class="hero-actions">';
                html += `<button class="action-btn primary" onclick="Player.playTrack(window._artistSongs[0], window._artistSongs)">▶ Play</button>`;
                html += `<button class="action-btn secondary" onclick="Player.playTrack(window._artistSongs[Math.floor(Math.random()*window._artistSongs.length)], window._artistSongs)">🔀 Shuffle</button>`;
                html += '</div>';
            }
            
            // Songs
            if (artist.songs && artist.songs.length > 0) {
                html += '<section><h2 class="section-title">Popular Songs</h2><div id="artist-tracks"></div></section>';
            }
            
            // Albums
            if (artist.topAlbums && artist.topAlbums.length > 0) {
                html += '<section style="margin-top:2rem"><h2 class="section-title">Albums</h2><div class="card-grid">';
                artist.topAlbums.forEach(a => {
                    html += `<div class="album-card" onclick="navigate('/album/${encodeURIComponent(a.id)}')">
                        <img class="album-card-img" src="${a.thumbnail || FALLBACK_IMG}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">
                        <div class="album-card-name">${escapeHtml(a.name || '')}</div>
                        <div class="album-card-type">${a.year || 'Album'}</div>
                    </div>`;
                });
                html += '</div></section>';
            }
            
            // Singles
            if (artist.singles && artist.singles.length > 0) {
                html += '<section style="margin-top:2rem"><h2 class="section-title">Singles & EPs</h2><div class="card-grid">';
                artist.singles.forEach(a => {
                    html += `<div class="album-card" onclick="navigate('/album/${encodeURIComponent(a.id)}')">
                        <img class="album-card-img" src="${a.thumbnail || FALLBACK_IMG}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">
                        <div class="album-card-name">${escapeHtml(a.name || '')}</div>
                        <div class="album-card-type">${a.year || 'Single'}</div>
                    </div>`;
                });
                html += '</div></section>';
            }
            
            html += '</div>';
            container.innerHTML = html;
            
            // Render track list separately to handle onclick bindings
            if (artist.songs && artist.songs.length > 0) {
                window._artistSongs = artist.songs;
                renderTrackList(artist.songs, document.getElementById('artist-tracks'));
            }
        }).catch(e => {
            container.innerHTML = `<div class="empty-state"><h3>Failed to load artist</h3><p>${e.message}</p></div>`;
        });
}

// ===== ALBUM PAGE =====
function renderAlbumPage(container, id) {
    container.innerHTML = '<div class="page-loader"><div class="spinner"></div><span>Loading album...</span></div>';
    
    fetchWithRetry(getApiUrl(`/api/album?id=${encodeURIComponent(id)}`))
        .then(r => r.json())
        .then(album => {
            if (album.error) {
                container.innerHTML = `<div class="empty-state"><h3>${escapeHtml(album.error)}</h3></div>`;
                return;
            }
            
            const thumb = album.thumbnails?.[album.thumbnails.length - 1]?.url || album.thumbnails?.[0]?.url || '';
            let html = '<div class="animate-fade-up">';
            
            html += `<div class="hero-section album-hero">
                <img class="hero-art" src="${thumb || FALLBACK_IMG}" onerror="this.onerror=null;this.src=FALLBACK_IMG;">
                <div class="hero-info">
                    <div class="hero-type">${escapeHtml(album.type || 'Album')}</div>
                    <h1>${escapeHtml(album.name || '')}</h1>
                    <p class="hero-meta">
                        ${album.artist?.name ? `<a href="#/artist/${encodeURIComponent(album.artist.artistId || album.artist.name || '')}">${escapeHtml(album.artist.name)}</a>` : ''}
                        ${album.year ? ` • ${album.year}` : ''}
                        ${album.songs ? ` • ${album.songs.length} songs` : ''}
                    </p>
                </div>
            </div>`;
            
            if (album.songs && album.songs.length > 0) {
                html += '<div class="hero-actions">';
                html += `<button class="action-btn primary" onclick="Player.playTrack(window._albumSongs[0], window._albumSongs)">▶ Play All</button>`;
                html += '</div>';
                html += '<div id="album-tracks"></div>';
            }
            
            html += '</div>';
            container.innerHTML = html;
            
            if (album.songs && album.songs.length > 0) {
                window._albumSongs = album.songs;
                renderTrackList(album.songs, document.getElementById('album-tracks'), { showIndex: true });
            }
        }).catch(e => {
            container.innerHTML = `<div class="empty-state"><h3>Failed to load album</h3><p>${e.message}</p></div>`;
        });
}

// ===== SETTINGS PAGE =====
function renderSettingsPage(container) {
    let html = '<div class="animate-fade-up">';
    html += `<div class="page-header" style="display:flex;align-items:center;gap:12px;margin-bottom:1.5rem">
        <button class="btn-icon back-btn" onclick="history.back()" title="Go Back" style="width:40px;height:40px;min-width:40px;min-height:40px;aspect-ratio:1/1;flex-shrink:0;padding:0;border-radius:50%;background:rgba(255,255,255,0.08);border:1px solid var(--border-color);display:inline-flex;align-items:center;justify-content:center;color:var(--text-primary);cursor:pointer">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div>
            <h1 style="margin:0;font-size:1.8rem;font-weight:700">Settings</h1>
            <p style="margin:2px 0 0 0;font-size:0.88rem;color:var(--text-secondary)">Customize app appearance, audio preferences, and API connections.</p>
        </div>
    </div>`;
    
    html += `<div class="settings-menu-grid">
        <div class="settings-menu-card" onclick="openAppearanceModal()">
            <div class="settings-menu-icon">🎨</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title">Appearance & Customization</div>
                <div class="settings-menu-desc">Themes, custom color pickers, and background wallpapers.</div>
            </div>
        </div>

        <div class="settings-menu-card" onclick="openAiRecommendationsModal()">
            <div class="settings-menu-icon">🤖</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title">AI Recommendations</div>
                <div class="settings-menu-desc">Set Google Gemini API key for extra AI picks.</div>
            </div>
        </div>

        <div class="settings-menu-card" onclick="openPlaybackSettingsModal()">
            <div class="settings-menu-icon">🎵</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title">Playback & Audio</div>
                <div class="settings-menu-desc">Autoplay and crossfade transition duration.</div>
            </div>
        </div>

        <div class="settings-menu-card" onclick="openServerUrlModal()">
            <div class="settings-menu-icon">🔗</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title">Server & API URL</div>
                <div class="settings-menu-desc">Configure Flask backend endpoint.</div>
            </div>
        </div>

        <div class="settings-menu-card" onclick="openDeveloperOptionsModal()">
            <div class="settings-menu-icon">🛠️</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title">Developer Options</div>
                <div class="settings-menu-desc">Enable on-screen diagnostic logging panel & debug tools.</div>
            </div>
        </div>

        <div class="settings-menu-card" onclick="openAboutModal()">
            <div class="settings-menu-icon">ℹ️</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title">About Vamus</div>
                <div class="settings-menu-desc">Version details and ad-free music streaming info.</div>
            </div>
        </div>

        <div class="settings-menu-card" style="border-color:rgba(239,68,68,0.3)" onclick="openDangerZoneModal()">
            <div class="settings-menu-icon" style="background:rgba(239,68,68,0.1);color:var(--danger-color)">⚠️</div>
            <div class="settings-menu-info">
                <div class="settings-menu-title" style="color:var(--danger-color)">Danger Zone</div>
                <div class="settings-menu-desc">Clear saved data, playlists, and app cache.</div>
            </div>
        </div>
    </div>`;

    html += '</div>';
    container.innerHTML = html;
}

function saveGeminiKey() {
    const key = document.getElementById('gemini-key-input').value.trim();
    localStorage.setItem('geminiApiKey', key);
    const msg = document.getElementById('gemini-save-msg');
    if (msg) { msg.textContent = '✓ Saved!'; setTimeout(() => msg.textContent = '', 2000); }
}

function saveApiServerUrl() {
    const url = document.getElementById('api-server-url-input').value.trim();
    localStorage.setItem('apiServerUrl', url);
    const msg = document.getElementById('api-server-save-msg');
    if (msg) { msg.textContent = '✓ Saved!'; setTimeout(() => msg.textContent = '', 2000); }
}

function toggleAutoplay() {
    Store.autoplayEnabled = document.getElementById('autoplay-toggle').checked;
    Store.save();
}

function toggleCrossfade() {
    Store.crossfadeEnabled = document.getElementById('crossfade-toggle').checked;
    Store.save();
    const section = document.getElementById('crossfade-duration-section');
    if (section) {
        section.style.opacity = Store.crossfadeEnabled ? '1' : '0.4';
        section.style.pointerEvents = Store.crossfadeEnabled ? 'auto' : 'none';
    }
}

function updateCrossfadeDuration(val) {
    Store.crossfadeDuration = parseInt(val, 10);
    Store.save();
    const label = document.getElementById('crossfade-duration-label');
    if (label) label.textContent = val + 's';
}
