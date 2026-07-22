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
            topBar.style.display = (path === '/search' || path.startsWith('/search?')) ? 'block' : 'none';
        }

        const floatingSearch = document.getElementById('floating-search-container');
        if (floatingSearch) {
            if (path === '/search' || path.startsWith('/search?')) {
                floatingSearch.style.display = 'none';
                if (typeof collapseFloatingSearch === 'function') {
                    collapseFloatingSearch();
                }
            } else {
                floatingSearch.style.display = 'flex';
            }
        }
        
        content.classList.add('page-transitioning');
        
        setTimeout(() => {
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

            requestAnimationFrame(() => {
                content.classList.remove('page-transitioning');
            });

            const mainContent = document.querySelector('.main-content');
            if (mainContent) mainContent.scrollTop = 0;
        }, 50);
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
