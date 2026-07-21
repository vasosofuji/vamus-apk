// In-app diagnostics panel.
// Funnels JS errors + key Player events into the Flask /api/debug buffer (which
// also holds the native MediaPlayer + yt-dlp/Piped/Invidious logs), and renders
// them all in one time-ordered on-screen panel. Reproduce the bug, tap the 🐞
// button, screenshot the panel.

window.VamusDebug = {
    _open: false,
    _autoTimer: null,

    // Send a line to the shared Flask buffer so it interleaves with native logs.
    log(msg) {
        try {
            const url = getApiUrl('/api/debug/push?m=' + encodeURIComponent('[js] ' + msg));
            fetch(url).catch(() => {});
        } catch (e) {}
        try { console.log('[VamusDebug]', msg); } catch (e) {}
    },

    async refresh() {
        const pre = document.getElementById('vdbg-pre');
        if (!pre) return;
        try {
            const r = await fetch(getApiUrl('/api/debug/log'));
            const lines = await r.json();
            pre.textContent = (lines || []).join('\n');
            pre.scrollTop = pre.scrollHeight;
        } catch (e) {
            pre.textContent = 'Failed to load log: ' + e;
        }
    },

    async clear() {
        try { await fetch(getApiUrl('/api/debug/clear')); } catch (e) {}
        this.refresh();
    },

    copy() {
        const pre = document.getElementById('vdbg-pre');
        if (!pre) return;
        const text = pre.textContent || '';
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(
                () => this.log('log copied to clipboard'),
                () => {}
            );
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
        }
    },

    toggle() {
        this._open ? this.close() : this.open();
    },

    open() {
        this._open = true;
        document.getElementById('vdbg-panel').style.display = 'flex';
        this.refresh();
        this._autoTimer = setInterval(() => this.refresh(), 1500);
    },

    close() {
        this._open = false;
        document.getElementById('vdbg-panel').style.display = 'none';
        if (this._autoTimer) { clearInterval(this._autoTimer); this._autoTimer = null; }
    },

    _mount() {
        const btn = document.createElement('button');
        btn.id = 'vdbg-btn';
        btn.textContent = '🐞';
        btn.title = 'Debug logs';
        btn.style.cssText =
            'position:fixed;right:12px;bottom:120px;z-index:2147483647;width:44px;height:44px;' +
            'border-radius:50%;border:none;background:#e11;color:#fff;font-size:20px;' +
            'box-shadow:0 2px 8px rgba(0,0,0,.4);opacity:.85';
        btn.onclick = () => this.toggle();

        const panel = document.createElement('div');
        panel.id = 'vdbg-panel';
        panel.style.cssText =
            'display:none;position:fixed;inset:0;z-index:2147483646;background:#0b0b0b;' +
            'flex-direction:column;padding:8px;box-sizing:border-box';
        panel.innerHTML =
            '<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap">' +
              '<button id="vdbg-refresh" style="flex:1;padding:8px;background:#222;color:#fff;border:1px solid #444;border-radius:6px">Refresh</button>' +
              '<button id="vdbg-clear" style="flex:1;padding:8px;background:#222;color:#fff;border:1px solid #444;border-radius:6px">Clear</button>' +
              '<button id="vdbg-copy" style="flex:1;padding:8px;background:#222;color:#fff;border:1px solid #444;border-radius:6px">Copy</button>' +
              '<button id="vdbg-close" style="flex:1;padding:8px;background:#611;color:#fff;border:1px solid #844;border-radius:6px">Close</button>' +
            '</div>' +
            '<pre id="vdbg-pre" style="flex:1;margin:0;overflow:auto;background:#000;color:#0f0;' +
              'font-size:11px;line-height:1.35;padding:8px;border-radius:6px;white-space:pre-wrap;word-break:break-word"></pre>';

        document.body.appendChild(btn);
        document.body.appendChild(panel);

        document.getElementById('vdbg-refresh').onclick = () => this.refresh();
        document.getElementById('vdbg-clear').onclick = () => this.clear();
        document.getElementById('vdbg-copy').onclick = () => this.copy();
        document.getElementById('vdbg-close').onclick = () => this.close();
    },
};

// Global error hooks.
window.addEventListener('error', (e) => {
    VamusDebug.log('window.onerror: ' + (e.message || '') +
        ' @' + (e.filename || '') + ':' + (e.lineno || '') + ':' + (e.colno || ''));
});
window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    VamusDebug.log('unhandledrejection: ' + (r && r.message ? r.message : r));
});

// Wrap key Player methods so we can see what's driving the scroll from the JS
// side (interleaved with the native logs in the same buffer).
(function () {
    function wrap(obj, name, describe) {
        if (!obj || typeof obj[name] !== 'function') return;
        const orig = obj[name];
        obj[name] = function () {
            try { VamusDebug.log(name + '(' + describe(arguments) + ')'); } catch (e) {}
            return orig.apply(this, arguments);
        };
    }
    function tId(t) { return t ? (t.id + ' "' + (t.title || '').slice(0, 30) + '"') : 'null'; }

    if (typeof Player !== 'undefined') {
        wrap(Player, 'playTrack', (a) => tId(a[0]));
        wrap(Player, 'playNext', () => '');
        wrap(Player, '_fetchRadioAndPlay', () => 'radio');
        wrap(Player, '_onNativeAdvanced', (a) => 'id=' + a[0]);
        wrap(Player, '_onPlaybackStalled', () => '');
        wrap(Player, 'onError', () => 'audio-element error');
    }
})();

// Mount the button now if the document is already parsed (scripts at the end of
// <body> can run after DOMContentLoaded has already fired, in which case a
// listener would never run), otherwise wait for it.
(function mountWhenReady() {
    function go() {
        try { VamusDebug._mount(); VamusDebug.log('debug panel mounted'); } catch (e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', go);
    } else {
        go();
    }
})();
