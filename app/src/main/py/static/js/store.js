// Global Fallback Cover Image
window.FALLBACK_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200'><rect width='200' height='200' fill='%231e1b4b'/><circle cx='100' cy='100' r='75' fill='%230f172a'/><circle cx='100' cy='100' r='55' fill='none' stroke='%23334155' stroke-width='3'/><circle cx='100' cy='100' r='35' fill='none' stroke='%23475569' stroke-width='2'/><circle cx='100' cy='100' r='20' fill='%237c3aed'/><circle cx='100' cy='100' r='6' fill='%23ffffff'/></svg>";
var FALLBACK_IMG = window.FALLBACK_IMG;

function isAndroidApp() {
    return window.Capacitor !== undefined ||
           window.AndroidMediaSession !== undefined ||
           window.location.protocol === 'file:' ||
           window.location.protocol.startsWith('capacitor') ||
           window.location.hostname === 'localhost' ||
           window.location.hostname === '127.0.0.1';
}

function getApiUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;

    if (isAndroidApp()) {
        const customBase = localStorage.getItem('apiServerUrl') || 'http://127.0.0.1:5000';
        return customBase.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);
    }
    return path;
}

async function fetchWithRetry(url, options = {}, retries = 5, delayMs = 600) {
    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok || response.status === 404 || response.status === 400) {
                return response;
            }
            if (attempt < retries - 1) {
                await new Promise(res => setTimeout(res, delayMs));
            } else {
                return response;
            }
        } catch (err) {
            if (attempt < retries - 1) {
                await new Promise(res => setTimeout(res, delayMs));
            } else {
                throw err;
            }
        }
    }
}


const THEME_PRESETS = {
    default: {
        name: 'Vamus Dark',
        bgColor: '#121212',
        surfaceColor: '#181818',
        surfaceHover: '#282828',
        primaryColor: '#1DB954',
        primaryHover: '#1ED760',
        textPrimary: '#ffffff',
        textSecondary: '#b3b3b3',
        borderColor: '#282828'
    },
    oled: {
        name: 'OLED Black',
        bgColor: '#000000',
        surfaceColor: '#0a0a0a',
        surfaceHover: '#141414',
        primaryColor: '#1DB954',
        primaryHover: '#1ED760',
        textPrimary: '#ffffff',
        textSecondary: '#888888',
        borderColor: '#1a1a1a'
    },
    sunset: {
        name: 'Sunset Crimson',
        bgColor: '#1a090d',
        surfaceColor: '#2b0f16',
        surfaceHover: '#421721',
        primaryColor: '#ff4b2b',
        primaryHover: '#ff416c',
        textPrimary: '#fff0f2',
        textSecondary: '#d697a3',
        borderColor: '#421721'
    },
    lavender: {
        name: 'Lavender Dream',
        bgColor: '#120d1c',
        surfaceColor: '#1d172e',
        surfaceHover: '#2c2345',
        primaryColor: '#a855f7',
        primaryHover: '#c084fc',
        textPrimary: '#f5f3ff',
        textSecondary: '#a78bfa',
        borderColor: '#2c2345'
    },
    emerald: {
        name: 'Emerald Forest',
        bgColor: '#061712',
        surfaceColor: '#0c261e',
        surfaceHover: '#153d31',
        primaryColor: '#10b981',
        primaryHover: '#34d399',
        textPrimary: '#ecfdf5',
        textSecondary: '#6ee7b7',
        borderColor: '#153d31'
    },
    amber: {
        name: 'Electric Amber',
        bgColor: '#1c150c',
        surfaceColor: '#2e2213',
        surfaceHover: '#45341c',
        primaryColor: '#f59e0b',
        primaryHover: '#fbbf24',
        textPrimary: '#fffbeb',
        textSecondary: '#fcd34d',
        borderColor: '#45341c'
    }
};

// Data store - replaces React Context/MusicContext
const Store = {
    currentTrack: null,
    queue: [],
    originalQueue: [],
    history: [],
    isPlaying: false,
    likedSongs: [],
    playlists: [],
    recentlyPlayed: [],
    downloadedTracks: [],
    downloadingIds: new Set(),
    shuffle: false,
    repeat: 'none', // 'none' | 'all' | 'one'
    crossfadeEnabled: false,
    crossfadeDuration: 5, // seconds (1-12)
    autoplayEnabled: true, // auto-radio when queue ends
    developerOptionsEnabled: false, // on-screen debug logging panel toggle

    // App-wide Customization Theme
    theme: {
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
    },
    
    // Event system for reactivity
    _listeners: {},
    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    },
    emit(event, data) {
        (this._listeners[event] || []).forEach(fn => fn(data));
    },
    
    // Load from localStorage
    load() {
        try {
            this.likedSongs = JSON.parse(localStorage.getItem('likedSongs') || '[]');
            this.playlists = JSON.parse(localStorage.getItem('playlists') || '[]');
            this.recentlyPlayed = JSON.parse(localStorage.getItem('recentlyPlayed') || '[]');
            this.downloadedTracks = JSON.parse(localStorage.getItem('downloadedTracks') || '[]');
            // Playback settings
            const cf = localStorage.getItem('crossfadeEnabled');
            if (cf !== null) this.crossfadeEnabled = cf === 'true';
            const cfd = localStorage.getItem('crossfadeDuration');
            if (cfd !== null) this.crossfadeDuration = parseInt(cfd, 10) || 5;
            const ap = localStorage.getItem('autoplayEnabled');
            if (ap !== null) this.autoplayEnabled = ap === 'true';
            const sh = localStorage.getItem('shuffle');
            if (sh !== null) this.shuffle = sh === 'true';
            const rep = localStorage.getItem('repeat');
            if (rep !== null) this.repeat = rep;
            const dev = localStorage.getItem('developerOptionsEnabled');
            if (dev !== null) this.developerOptionsEnabled = dev === 'true';

            // Theme customization
            const savedTheme = localStorage.getItem('vamus_theme_config');
            if (savedTheme) {
                try {
                    this.theme = { ...this.theme, ...JSON.parse(savedTheme) };
                } catch(e) {}
            }
        } catch(e) {
            console.error('Failed to load store from localStorage', e);
        }

        // Persistent Backend Data Auto-Restore & Sync
        this._syncWithBackend();
    },

    async _syncWithBackend() {
        try {
            // Retry: this runs while store.js is still parsing, and MainActivity
            // starts the Flask server on a background thread. A plain fetch lost
            // the race on a cold start, so a fresh install never restored the
            // user's playlists and liked songs from the backend file.
            const resp = await fetchWithRetry(getApiUrl('/api/user/data'));
            if (!resp || !resp.ok) return;
            const res = await resp.json();
            if (res.ok && res.data) {
                const bData = res.data;
                let restored = false;
                
                // If localStorage was cleared or missing items, recover from persistent file
                if ((!this.playlists || this.playlists.length === 0) && bData.playlists && bData.playlists.length > 0) {
                    this.playlists = bData.playlists;
                    restored = true;
                }
                if ((!this.likedSongs || this.likedSongs.length === 0) && bData.likedSongs && bData.likedSongs.length > 0) {
                    this.likedSongs = bData.likedSongs;
                    restored = true;
                }
                if (bData.theme && (!localStorage.getItem('vamus_theme_config') || Object.keys(bData.theme).length > 0)) {
                    this.theme = { ...this.theme, ...bData.theme };
                    restored = true;
                }
                
                if (restored) {
                    this.save();
                    this.emit('playlistsChanged');
                    this.emit('likedChanged');
                    this.emit('themeChanged');
                } else {
                    // Sync current state to backend file
                    this._persistToBackend();
                }
            }
        } catch(e) {
            console.warn('Backend user data sync note:', e);
        }
    },

    _persistToBackend() {
        if (this._syncTimer) clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => {
            const payload = {
                playlists: this.playlists,
                likedSongs: this.likedSongs,
                recentlyPlayed: this.recentlyPlayed,
                downloadedTracks: this.downloadedTracks,
                theme: this.theme,
                crossfadeEnabled: this.crossfadeEnabled,
                crossfadeDuration: this.crossfadeDuration,
                autoplayEnabled: this.autoplayEnabled
            };
            fetch(getApiUrl('/api/user/sync'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(() => {});
        }, 1000);
    },

    // Save to localStorage + persistent backend file
    save() {
        try { localStorage.setItem('likedSongs', JSON.stringify(this.likedSongs)); } catch(e) { console.error('Error saving likedSongs', e); }
        try { localStorage.setItem('playlists', JSON.stringify(this.playlists)); } catch(e) { console.error('Error saving playlists', e); }
        try { localStorage.setItem('recentlyPlayed', JSON.stringify(this.recentlyPlayed)); } catch(e) { console.error('Error saving recentlyPlayed', e); }
        try { localStorage.setItem('downloadedTracks', JSON.stringify(this.downloadedTracks)); } catch(e) { console.error('Error saving downloadedTracks', e); }
        try { localStorage.setItem('crossfadeEnabled', String(this.crossfadeEnabled)); } catch(e) {}
        try { localStorage.setItem('crossfadeDuration', String(this.crossfadeDuration)); } catch(e) {}
        try { localStorage.setItem('autoplayEnabled', String(this.autoplayEnabled)); } catch(e) {}
        try { localStorage.setItem('shuffle', String(this.shuffle)); } catch(e) {}
        try { localStorage.setItem('repeat', String(this.repeat)); } catch(e) {}
        try { localStorage.setItem('developerOptionsEnabled', String(this.developerOptionsEnabled)); } catch(e) {}
        try { localStorage.setItem('vamus_theme_config', JSON.stringify(this.theme)); } catch(e) { console.error('Error saving vamus_theme_config', e); }
        this._persistToBackend();
    },
    
    // id lookups for likedSongs / downloadedTracks.
    //
    // Both were linear `.some()` scans, and both are called per rendered row
    // and once per track when the queue is mirrored to native ΓÇö so a large
    // library turned every render and every track change into tens of
    // thousands of string comparisons. The index rebuilds itself whenever the
    // array is replaced or changes length, so callers can keep assigning these
    // lists freely without remembering to invalidate anything.
    _idIndex(key) {
        const list = this[key] || [];
        const cache = this._idCaches || (this._idCaches = {});
        const hit = cache[key];
        if (hit && hit.src === list && hit.len === list.length) return hit.ids;
        const ids = new Set();
        for (const t of list) if (t && t.id) ids.add(t.id);
        cache[key] = { src: list, len: list.length, ids };
        return ids;
    },

    // Liked songs
    isLiked(trackId) {
        return this._idIndex('likedSongs').has(trackId);
    },
    toggleLike(track) {
        if (!track || !track.id) return;
        if (this.isLiked(track.id)) {
            this.likedSongs = this.likedSongs.filter(t => t.id !== track.id);
        } else {
            // Guard against half-built stubs (e.g. the {id} passed by the
            // Liked page's remove button) ever landing in the library.
            if (!track.title) return;
            this.likedSongs = [track, ...this.likedSongs];
        }
        this.save();
        this.emit('likedChanged');
        this.emit('playerUpdate');
    },
    
    // Playlists
    createPlaylist(name) {
        const pl = { id: 'pl_' + Date.now(), name, tracks: [], createdAt: Date.now(), coverImage: '', bannerImage: '', customBgColor: '' };
        this.playlists = [...this.playlists, pl];
        this.save();
        this.emit('playlistsChanged');
        return pl.id;
    },
    deletePlaylist(id) {
        this.playlists = this.playlists.filter(p => p.id !== id);
        this.save();
        this.emit('playlistsChanged');
    },
    addToPlaylist(playlistId, track) {
        this.playlists = this.playlists.map(p => {
            if (p.id !== playlistId) return p;
            if (p.tracks.some(t => t.id === track.id)) return p;
            return { ...p, tracks: [...p.tracks, track] };
        });
        this.save();
        this.emit('playlistsChanged');
    },
    removeFromPlaylist(playlistId, trackId) {
        this.playlists = this.playlists.map(p => {
            if (p.id !== playlistId) return p;
            return { ...p, tracks: p.tracks.filter(t => t.id !== trackId) };
        });
        this.save();
        this.emit('playlistsChanged');
    },
    updatePlaylistCustomization(playlistId, customData) {
        this.playlists = this.playlists.map(p => {
            if (p.id !== playlistId) return p;
            return { ...p, ...customData };
        });
        this.save();
        this.emit('playlistsChanged');
    },
    
    // Offline Downloads
    async loadDownloads() {
        try {
            // Same cold-start race as _syncWithBackend: without retrying, the
            // offline library looked empty until the app was reopened.
            const resp = await fetchWithRetry(getApiUrl('/api/downloads'));
            if (resp && resp.ok) {
                const list = await resp.json();
                this.downloadedTracks = Array.isArray(list) ? list : [];
                this.emit('downloadsChanged');
                // The offline page and the download badges are drawn from this.
                if (typeof Router !== 'undefined' && Router.currentRoute === '/downloads') {
                    Router.render('/downloads');
                }
            }
        } catch(e) {
            console.warn('Failed to load downloaded tracks:', e);
        }
    },
    isDownloaded(trackId) {
        return this._idIndex('downloadedTracks').has(trackId);
    },
    isDownloading(trackId) {
        return this.downloadingIds.has(trackId);
    },
    async downloadTrack(track) {
        if (!track || !track.id) return false;
        if (this.isDownloaded(track.id)) return true;
        if (this.isDownloading(track.id)) return false;

        this.downloadingIds.add(track.id);
        this.emit('downloadsChanged');

        try {
            const payload = {
                id: track.id,
                title: track.title || 'Unknown Track',
                artist: (track.channel && track.channel.name) || track.artist || 'Unknown Artist',
                thumbnail: typeof getTrackThumbnail === 'function' ? getTrackThumbnail(track) : (track.thumbnail || ''),
                durationInSec: track.durationInSec || 0
            };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000);

            const resp = await fetch(getApiUrl('/api/download'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            const data = await resp.json();
            if (data.ok && data.track) {
                const existingIdx = this.downloadedTracks.findIndex(t => t.id === track.id);
                if (existingIdx >= 0) {
                    // In-place swap of an entry with the same id, so the id set
                    // _idIndex caches is unchanged and needs no invalidation.
                    this.downloadedTracks[existingIdx] = data.track;
                } else {
                    this.downloadedTracks = [data.track, ...this.downloadedTracks];
                }
                this.save();
                return true;
            }
            return false;
        } catch(e) {
            console.error('Download track error:', e);
            return false;
        } finally {
            this.downloadingIds.delete(track.id);
            this.emit('downloadsChanged');
        }
    },
    async deleteDownload(trackId) {
        if (!trackId) return false;
        try {
            await fetch(getApiUrl('/api/downloads/delete'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: trackId })
            });
            this.downloadedTracks = this.downloadedTracks.filter(t => t.id !== trackId);
            this.save();
            this.emit('downloadsChanged');
            return true;
        } catch(e) {
            console.error('Delete download error:', e);
            return false;
        }
    },

    // Recently played
    addToRecent(track) {
        this.recentlyPlayed = [track, ...this.recentlyPlayed.filter(t => t.id !== track.id)].slice(0, 30);
        this.save();
    },
};

Store.load();
Store.loadDownloads();
