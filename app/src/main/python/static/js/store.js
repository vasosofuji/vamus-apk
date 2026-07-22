function getApiUrl(path) {
    if (window.location.protocol === 'file:' || 
        window.location.protocol.startsWith('capacitor') || 
        (window.location.hostname === 'localhost' && window.location.port === '') ||
        (window.location.hostname === '127.0.0.1' && window.location.port === '')) {
        const customBase = localStorage.getItem('apiServerUrl') || 'http://localhost:5000';
        return customBase.replace(/\/$/, '') + path;
    }
    return path;
}

// Data store - replaces React Context/MusicContext
const Store = {
    currentTrack: null,
    queue: [],
    history: [],
    isPlaying: false,
    likedSongs: [],
    playlists: [],
    recentlyPlayed: [],
    shuffle: false,
    repeat: 'none', // 'none' | 'all' | 'one'
    crossfadeEnabled: false,
    crossfadeDuration: 5, // seconds (1-12)
    autoplayEnabled: true, // auto-radio when queue ends
    
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
            // Playback settings
            const cf = localStorage.getItem('crossfadeEnabled');
            if (cf !== null) this.crossfadeEnabled = cf === 'true';
            const cfd = localStorage.getItem('crossfadeDuration');
            if (cfd !== null) this.crossfadeDuration = parseInt(cfd, 10) || 5;
            const ap = localStorage.getItem('autoplayEnabled');
            if (ap !== null) this.autoplayEnabled = ap === 'true';
        } catch(e) { console.error('Failed to load store', e); }
    },
    
    // Save to localStorage
    save() {
        localStorage.setItem('likedSongs', JSON.stringify(this.likedSongs));
        localStorage.setItem('playlists', JSON.stringify(this.playlists));
        localStorage.setItem('recentlyPlayed', JSON.stringify(this.recentlyPlayed));
        localStorage.setItem('crossfadeEnabled', String(this.crossfadeEnabled));
        localStorage.setItem('crossfadeDuration', String(this.crossfadeDuration));
        localStorage.setItem('autoplayEnabled', String(this.autoplayEnabled));
    },
    
    // Liked songs
    isLiked(trackId) {
        return this.likedSongs.some(t => t.id === trackId);
    },
    toggleLike(track) {
        if (this.isLiked(track.id)) {
            this.likedSongs = this.likedSongs.filter(t => t.id !== track.id);
        } else {
            this.likedSongs = [track, ...this.likedSongs];
        }
        this.save();
        this.emit('likedChanged');
        this.emit('playerUpdate');
    },
    
    // Playlists
    createPlaylist(name) {
        const pl = { id: 'pl_' + Date.now(), name, tracks: [], createdAt: Date.now() };
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
    
    // Recently played
    addToRecent(track) {
        this.recentlyPlayed = [track, ...this.recentlyPlayed.filter(t => t.id !== track.id)].slice(0, 30);
        this.save();
    },
};

Store.load();
