// SVG icon helpers
const ICONS = {
    heart: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
    heartFilled: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
    music: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

const FALLBACK_IMG = "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='1.5'%3E%3Cpath d='M9 18V5l12-2v13'/%3E%3Ccircle cx='6' cy='18' r='3'/%3E%3Ccircle cx='18' cy='16' r='3'/%3E%3C/svg%3E";

const GENRES = [
    { id: 'pop', name: 'Pop', color: 'linear-gradient(135deg, #FF6B6B, #FF8E53)' },
    { id: 'rock', name: 'Rock', color: 'linear-gradient(135deg, #4A00E0, #8E2DE2)' },
    { id: 'hiphop', name: 'Hip Hop', color: 'linear-gradient(135deg, #11998E, #38EF7D)' },
    { id: 'electronic', name: 'Electronic', color: 'linear-gradient(135deg, #2193b0, #6dd5ed)' },
    { id: 'rnb', name: 'R&B', color: 'linear-gradient(135deg, #cc2b5e, #753a88)' },
    { id: 'jazz', name: 'Jazz', color: 'linear-gradient(135deg, #B79891, #94716B)' },
    { id: 'classical', name: 'Classical', color: 'linear-gradient(135deg, #141E30, #243B55)' },
    { id: 'indie', name: 'Indie', color: 'linear-gradient(135deg, #3a7bd5, #3a6073)' },
    { id: 'country', name: 'Country', color: 'linear-gradient(135deg, #f2994a, #f2c94c)' },
    { id: 'metal', name: 'Metal', color: 'linear-gradient(135deg, #4b6cb7, #182848)' },
];

function renderTrackList(tracks, container, options = {}) {
    const { showIndex = false, showRemove = false, onRemove = null, singleTrackQueue = false } = options;
    if (!tracks || tracks.length === 0) {
        container.innerHTML = '<div class="empty-state"><h3>No tracks found</h3></div>';
        return;
    }
    
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
        html += `<div class="track-row ${isPlaying ? 'playing' : ''} animate-fade-up" style="animation-delay:${i * 0.03}s" data-track="${escapeAttr(JSON.stringify(track))}" data-index="${i + 1}">
            <div class="swipe-bg-queue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:8px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Queue</div>
            <div class="track-row-content" onclick="Player.playTrack(${escapeAttr(JSON.stringify(track))}, ${singleTrackQueue ? `[${escapeAttr(JSON.stringify(track))}]` : `${escapeAttr(JSON.stringify(tracks))}`})">
                <span class="col-index">${isPlaying ? '♫' : (i + 1)}</span>
                <div class="col-title">
                    <img class="row-thumb" src="${track.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'" alt="">
                    <span class="row-name">${escapeHtml(track.title || '')}</span>
                </div>
                <div class="col-artist"><a href="#/artist/${encodeURIComponent(track.artistId || track.channel?.name || '')}" onclick="event.stopPropagation()">${escapeHtml(track.channel?.name || '')}</a></div>
                <div class="col-actions">
                    <button class="btn-icon like-btn ${liked ? 'active' : ''}" onclick="event.stopPropagation(); Store.toggleLike(${escapeAttr(JSON.stringify(track))}); this.classList.toggle('active'); this.innerHTML = Store.isLiked('${track.id}') ? ICONS.heartFilled : ICONS.heart; Player.updatePlayerUI(); if (Router.currentRoute === '/liked') { Router.render('/liked'); }">${liked ? ICONS.heartFilled : ICONS.heart}</button>
                    ${showRemove ? `<button class="btn-icon danger" onclick="event.stopPropagation(); (${onRemove})(${escapeAttr(JSON.stringify(track.id))})">${ICONS.x}</button>` : ''}
                </div>
                <span class="col-time">${track.durationRaw || ''}</span>
            </div>
        </div>`;
    });
    
    html += '</div></div>';
    container.innerHTML = html;
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
            html += `<a class="quick-card playlist-card" href="#/playlist/${pl.id}">
                <div class="quick-card-icon">${ICONS.music}</div>
                <div class="quick-card-text"><span>${escapeHtml(pl.name)}</span><small>${pl.tracks.length} songs</small></div>
            </a>`;
        });
        html += '</div>';
    }
    
    // Recently played
    if (Store.recentlyPlayed.length > 0) {
        html += '<section style="margin-top:2rem"><h2 class="section-title">Recently Played</h2><div class="recent-grid">';
        Store.recentlyPlayed.slice(0, 20).forEach(track => {
            html += `<div class="recent-card" onclick="Player.playTrack(${escapeAttr(JSON.stringify(track))}, [${escapeAttr(JSON.stringify(track))}])">
                <img src="${track.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'" alt="">
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
        <h2 class="section-title">Recommended For You</h2>
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
    
    // Fetch default recommendations async
    const params = new URLSearchParams();
    if (seedIds.length) params.set('seedIds', seedIds.join(','));
    if (uniqueArtists.length) params.set('artistNames', uniqueArtists.join(','));
    fetch(getApiUrl(`/api/home-recommendations?${params.toString()}`))
        .then(r => r.json())
        .then(tracks => {
            const c = document.getElementById('recs-container');
            if (!c) return;
            if (tracks && tracks.length > 0) {
                renderTrackList(tracks, c);
            } else {
                const s = document.getElementById('recs-section');
                if (s) s.remove();
            }
        }).catch(() => {
            const s = document.getElementById('recs-section');
            if (s) s.remove();
        });

    // Fetch AI recs async — only when the user has configured a Gemini key
    if (hasSeeds && geminiKey && uniqueArtists.length > 0) {
        fetch(getApiUrl(`/api/ai-recommend?artistNames=${encodeURIComponent(uniqueArtists.join(','))}&apiKey=${encodeURIComponent(geminiKey)}`))
            .then(r => r.json())
            .then(tracks => {
                const recsContainer = document.getElementById('ai-recs-container');
                if (recsContainer && tracks.length > 0) {
                    renderTrackList(tracks, recsContainer);
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

// ===== SEARCH PAGE =====
function renderSearchPage(container, path) {
    const params = new URLSearchParams(path.includes('?') ? path.split('?')[1] : '');
    const query = params.get('q') || '';
    const type = params.get('type') || 'songs';
    const isCategory = params.get('category') === 'true';
    
    let html = '<div class="animate-fade-up">';
    
    // Mobile search input
    html += `<div style="margin-bottom:1rem;display:none" class="mobile-search-inline">
        <form onsubmit="event.preventDefault(); navigate('/search?q='+encodeURIComponent(document.getElementById('mobile-search-input').value))">
            <input id="mobile-search-input" type="text" value="${escapeHtml(isCategory ? '' : query)}" placeholder="Search songs, artists..." style="width:100%;padding:0.6rem 1rem;background:rgba(255,255,255,0.07);border:1px solid var(--border-color);border-radius:var(--radius-full);color:var(--text-primary);font-size:0.9rem;outline:none">
        </form>
    </div>`;
    
    if (isCategory) {
        html += `<h1 style="margin: 0.5rem 0 1.2rem 0; font-size: 2rem; font-weight: 700; color: var(--text-primary);">${escapeHtml(query)}</h1>`;
    }
    
    // Tabs
    html += '<div class="chip-tabs">';
    html += `<button class="chip ${type === 'songs' ? 'active' : ''}" onclick="navigate('/search?q=${encodeURIComponent(query)}&type=songs${isCategory ? '&category=true' : ''}')">Songs</button>`;
    html += `<button class="chip ${type === 'artists' ? 'active' : ''}" onclick="navigate('/search?q=${encodeURIComponent(query)}&type=artists${isCategory ? '&category=true' : ''}')">Artists</button>`;
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
    
    document.getElementById('search-results').innerHTML = '<div class="page-loader"><div class="spinner"></div></div>';
    
    fetch(getApiUrl(`/api/search?q=${encodeURIComponent(query)}&type=${type}`))
        .then(r => r.json())
        .then(results => {
            const resultsEl = document.getElementById('search-results');
            if (!resultsEl) return;
            
            if (type === 'artists') {
                if (!results.length) {
                    resultsEl.innerHTML = '<div class="empty-state"><h3>No artists found</h3></div>';
                    return;
                }
                let grid = '<div class="card-grid">';
                results.forEach(a => {
                    grid += `<div class="artist-card" onclick="navigate('/artist/${encodeURIComponent(a.id)}')">
                        <img class="artist-card-img" src="${a.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'">
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
            const r = document.getElementById('search-results');
            if (r) r.innerHTML = '<div class="empty-state"><h3>Search failed</h3></div>';
        });
}

// ===== LIBRARY PAGE =====
function renderLibraryPage(container) {
    let html = '<div class="animate-fade-up">';
    html += '<div class="page-header"><h1>Your Library</h1></div>';
    
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
        html += '<div class="card-grid">';
        Store.playlists.forEach(pl => {
            html += `<div class="album-card" onclick="navigate('/playlist/${pl.id}')" style="position:relative">
                <div style="width:100%;aspect-ratio:1;background:linear-gradient(135deg,#4c1d95,#7c3aed);border-radius:var(--radius-sm);display:flex;align-items:center;justify-content:center;margin-bottom:0.5rem">${ICONS.music}</div>
                <div class="album-card-name">${escapeHtml(pl.name)}</div>
                <div class="album-card-type">${pl.tracks.length} songs</div>
            </div>`;
        });
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
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
    
    html += '<div class="hero-actions">';
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
    
    fetch(getApiUrl(`/api/artist?id=${encodeURIComponent(id)}`))
        .then(r => r.json())
        .then(artist => {
            if (artist.error) {
                container.innerHTML = `<div class="empty-state"><h3>${escapeHtml(artist.error)}</h3></div>`;
                return;
            }
            
            const thumb = artist.thumbnails?.[artist.thumbnails.length - 1]?.url || artist.thumbnails?.[0]?.url || '';
            let html = '<div class="animate-fade-up">';
            
            // Hero
            html += `<div class="hero-section artist-hero" style="background-image:url('${thumb}')">
                <div class="hero-overlay"></div>
                <div class="hero-info">
                    <h1>${escapeHtml(artist.name || '')}</h1>
                </div>
            </div>`;
            
            // Actions
            if (artist.songs && artist.songs.length > 0) {
                html += '<div class="hero-actions">';
                html += `<button class="action-btn primary" onclick="Player.playTrack(window._artistSongs[0], window._artistSongs)">▶ Play</button>`;
                html += `<button class="action-btn secondary" onclick="Player.playTrack(window._artistSongs[Math.floor(Math.random()*window._artistSongs.length)], window._artistSongs)">⤮ Shuffle</button>`;
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
                        <img class="album-card-img" src="${a.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'">
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
                        <img class="album-card-img" src="${a.thumbnail || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'">
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
    
    fetch(getApiUrl(`/api/album?id=${encodeURIComponent(id)}`))
        .then(r => r.json())
        .then(album => {
            if (album.error) {
                container.innerHTML = `<div class="empty-state"><h3>${escapeHtml(album.error)}</h3></div>`;
                return;
            }
            
            const thumb = album.thumbnails?.[album.thumbnails.length - 1]?.url || album.thumbnails?.[0]?.url || '';
            let html = '<div class="animate-fade-up">';
            
            html += `<div class="hero-section album-hero">
                <img class="hero-art" src="${thumb || FALLBACK_IMG}" onerror="this.src='${FALLBACK_IMG}'">
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
    const geminiKey = localStorage.getItem('geminiApiKey') || '';
    const apiServerUrl = localStorage.getItem('apiServerUrl') || 'http://localhost:5000';
    
    let html = '<div class="animate-fade-up">';
    html += '<div class="page-header"><h1>Settings</h1></div>';

    // Theme & Appearance Settings
    html += `<div class="settings-section">
        <h3>🎨 Theme & Appearance</h3>
        <p>Choose a color preset or build your own custom theme palette.</p>
        
        <div style="font-weight:600;font-size:0.9rem;margin-top:0.8rem;color:var(--text-primary)">Color Presets</div>
        <div class="theme-preset-grid">`;
    Object.keys(THEME_PRESETS).forEach(key => {
        const p = THEME_PRESETS[key];
        const isActive = Store.theme.preset === key;
        html += `<div class="theme-preset-card ${isActive ? 'active' : ''}" onclick="applyThemePreset('${key}')">
            <div class="preset-preview-dots">
                <div class="preset-dot" style="background:${p.bgColor}"></div>
                <div class="preset-dot" style="background:${p.surfaceColor}"></div>
                <div class="preset-dot" style="background:${p.primaryColor}"></div>
            </div>
            <div class="theme-preset-name">${escapeHtml(p.name)}</div>
        </div>`;
    });
    html += `</div>

        <div style="font-weight:600;font-size:0.9rem;margin-top:1.2rem;color:var(--text-primary)">Custom Colors</div>
        <div class="color-picker-grid">
            <div class="color-picker-item">
                <label>Primary Accent</label>
                <input type="color" class="color-input-swatch" value="${Store.theme.primaryColor}" onchange="updateCustomColor('primaryColor', this.value); updateCustomColor('primaryHover', this.value);">
            </div>
            <div class="color-picker-item">
                <label>Background</label>
                <input type="color" class="color-input-swatch" value="${Store.theme.bgColor}" onchange="updateCustomColor('bgColor', this.value)">
            </div>
            <div class="color-picker-item">
                <label>Surface / Card</label>
                <input type="color" class="color-input-swatch" value="${Store.theme.surfaceColor}" onchange="updateCustomColor('surfaceColor', this.value); updateCustomColor('surfaceHover', this.value);">
            </div>
            <div class="color-picker-item">
                <label>Text Primary</label>
                <input type="color" class="color-input-swatch" value="${Store.theme.textPrimary}" onchange="updateCustomColor('textPrimary', this.value)">
            </div>
            <div class="color-picker-item">
                <label>Text Secondary</label>
                <input type="color" class="color-input-swatch" value="${Store.theme.textSecondary}" onchange="updateCustomColor('textSecondary', this.value)">
            </div>
            <div class="color-picker-item">
                <label>Border Color</label>
                <input type="color" class="color-input-swatch" value="${Store.theme.borderColor}" onchange="updateCustomColor('borderColor', this.value)">
            </div>
        </div>

        <div style="margin-top:1rem">
            <button class="action-btn secondary" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="resetThemeToDefault()">Reset Theme to Default</button>
        </div>

        <hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:1.5rem 0">

        <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary)">Custom App Wallpaper</div>
        <p>Upload a custom background wallpaper image for the entire app.</p>
        <div style="display:flex;align-items:center;gap:10px;margin-top:0.75rem;margin-bottom:1rem">
            <button class="action-btn primary" style="padding:0.4rem 0.9rem;font-size:0.85rem" onclick="document.getElementById('app-wallpaper-file-input').click()">Upload Wallpaper</button>
            ${Store.theme.wallpaperData ? `<button class="action-btn danger" style="padding:0.4rem 0.9rem;font-size:0.85rem" onclick="removeWallpaper()">Remove Wallpaper</button>` : ''}
            <input type="file" id="app-wallpaper-file-input" accept="image/*" style="display:none" onchange="handleWallpaperUpload(event)">
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
    </div>`;
    
    // Gemini API Key
    html += `<div class="settings-section">
        <h3>🤖 Gemini API Key <span style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);vertical-align:middle">Optional</span></h3>
        <p>Vamus already recommends music based on your playlists and listening history — no key needed. Add your own Google Gemini API key to also get an extra AI-powered "AI Picks For You" row on the home screen.</p>
        <input class="settings-input" type="password" id="gemini-key-input" value="${escapeHtml(geminiKey)}" placeholder="Enter API key...">
        <br><button class="action-btn primary" style="margin-top:0.5rem" onclick="saveGeminiKey()">Save Key</button>
        <span id="gemini-save-msg" style="margin-left:0.75rem;color:var(--success-color);font-size:0.85rem"></span>
    </div>`;
    
    // API Server URL
    html += `<div class="settings-section">
        <h3>🔗 API Server URL</h3>
        <p>Set the base URL of your Python Flask server. Useful when running local Python in Termux or on a PC.</p>
        <input class="settings-input" type="text" id="api-server-url-input" value="${escapeHtml(apiServerUrl)}" placeholder="http://localhost:5000">
        <br><button class="action-btn primary" style="margin-top:0.5rem" onclick="saveApiServerUrl()">Save Server URL</button>
        <span id="api-server-save-msg" style="margin-left:0.75rem;color:var(--success-color);font-size:0.85rem"></span>
    </div>`;
    
    // Playback Settings
    html += `<div class="settings-section">
        <h3>🎵 Playback</h3>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
            <div>
                <div style="font-weight:600;color:var(--text-primary)">Autoplay</div>
                <div style="font-size:0.82rem;color:var(--text-secondary)">Automatically play similar songs when your queue ends</div>
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
    </div>`;
    
    // About
    html += `<div class="settings-section">
        <h3>ℹ️ About</h3>
        <p>Vamus — Ad-free music streaming</p>
        <p>Version 1.0.0 (Flask Android)</p>
    </div>`;
    
    // Danger Zone
    html += `<div class="settings-section" style="border-color:rgba(239,68,68,0.3)">
        <h3 style="color:var(--danger-color)">⚠️ Danger Zone</h3>
        <p>Clear all saved data including liked songs, playlists, and history.</p>
        <button class="action-btn danger" onclick="if(confirm('Clear all data? This cannot be undone.')){localStorage.clear();location.reload()}">Clear All Data</button>
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
