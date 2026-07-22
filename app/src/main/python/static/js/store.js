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
            // Playback settings
            const cf = localStorage.getItem('crossfadeEnabled');
            if (cf !== null) this.crossfadeEnabled = cf === 'true';
            const cfd = localStorage.getItem('crossfadeDuration');
            if (cfd !== null) this.crossfadeDuration = parseInt(cfd, 10) || 5;
            const ap = localStorage.getItem('autoplayEnabled');
            if (ap !== null) this.autoplayEnabled = ap === 'true';

            // Theme customization
            const savedTheme = localStorage.getItem('vamus_theme_config');
            if (savedTheme) {
                try {
                    this.theme = { ...this.theme, ...JSON.parse(savedTheme) };
                } catch(e) {}
            }
        } catch(e) { console.error('Failed to load store', e); }
    },
    
    // Save to localStorage
    save() {
        try { localStorage.setItem('likedSongs', JSON.stringify(this.likedSongs)); } catch(e) { console.error('Error saving likedSongs', e); }
        try { localStorage.setItem('playlists', JSON.stringify(this.playlists)); } catch(e) { console.error('Error saving playlists', e); }
        try { localStorage.setItem('recentlyPlayed', JSON.stringify(this.recentlyPlayed)); } catch(e) { console.error('Error saving recentlyPlayed', e); }
        try { localStorage.setItem('crossfadeEnabled', String(this.crossfadeEnabled)); } catch(e) {}
        try { localStorage.setItem('crossfadeDuration', String(this.crossfadeDuration)); } catch(e) {}
        try { localStorage.setItem('autoplayEnabled', String(this.autoplayEnabled)); } catch(e) {}
        try { localStorage.setItem('vamus_theme_config', JSON.stringify(this.theme)); } catch(e) { console.error('Error saving vamus_theme_config', e); }
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
    
    // Recently played
    addToRecent(track) {
        this.recentlyPlayed = [track, ...this.recentlyPlayed.filter(t => t.id !== track.id)].slice(0, 30);
        this.save();
    },
};

Store.load();
