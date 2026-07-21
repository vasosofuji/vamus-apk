// Hash-based SPA router
const Router = {
    currentRoute: '/',
    
    init() {
        window.addEventListener('hashchange', () => this.handleRoute());
        this.handleRoute();
    },
    
    handleRoute() {
        const hash = window.location.hash.slice(1) || '/';
        this.currentRoute = hash;
        this.updateActiveNav();
        this.render(hash);
    },
    
    render(path) {
        const content = document.getElementById('page-content');
        if (!content) return;
        
        const topBar = document.getElementById('top-bar');
        if (topBar) {
            if (path === '/search' || path.startsWith('/search?')) {
                topBar.style.display = 'block';
            } else {
                topBar.style.display = 'none';
            }
        }
        
        // Parse route
        if (path === '/' || path === '') {
            renderHomePage(content);
        } else if (path === '/search' || path.startsWith('/search?')) {
            renderSearchPage(content, path);
        } else if (path === '/library') {
            renderLibraryPage(content);
        } else if (path === '/liked') {
            renderLikedPage(content);
        } else if (path === '/settings') {
            renderSettingsPage(content);
        } else if (path.startsWith('/artist/')) {
            const id = path.split('/artist/')[1];
            renderArtistPage(content, decodeURIComponent(id));
        } else if (path.startsWith('/album/')) {
            const id = path.split('/album/')[1];
            renderAlbumPage(content, decodeURIComponent(id));
        } else if (path.startsWith('/playlist/')) {
            const id = path.split('/playlist/')[1];
            renderPlaylistPage(content, decodeURIComponent(id));
        } else {
            content.innerHTML = '<div class="empty-state"><h3>Page not found</h3></div>';
        }
        
        // Scroll to top
        document.querySelector('.main-content').scrollTop = 0;
    },
    
    updateActiveNav() {
        const path = this.currentRoute;
        // Sidebar nav
        document.querySelectorAll('.nav-item').forEach(item => {
            const route = item.dataset.route;
            item.classList.toggle('active', 
                route === path || (route === '/search' && path.startsWith('/search'))
            );
        });
        // Bottom nav  
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            const route = item.dataset.route;
            item.classList.toggle('active',
                route === path || (route === '/search' && path.startsWith('/search'))
            );
        });
    }
};

function navigate(path) {
    window.location.hash = path;
}
