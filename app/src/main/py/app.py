"""
Vamus Music App - Flask Backend
Serves the SPA frontend and provides API endpoints for music search,
streaming, artist info, albums, lyrics, suggestions, and recommendations.
"""

import os
import json
import re
import urllib.parse

from flask import Flask, jsonify, request, redirect, send_from_directory
import requests as http_requests

# Load .env file manually
try:
    env_path = os.path.join(os.path.dirname(__file__), '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                if '=' in line and not line.strip().startswith('#'):
                    k, v = line.strip().split('=', 1)
                    os.environ[k.strip()] = v.strip()
except Exception as e:
    print("Error loading .env file:", e)

app = Flask(__name__, static_folder='static')

# ---------------------------------------------------------------------------
# Debug log ring buffer (surfaced in the in-app diagnostics panel via
# /api/debug/log). Lets us see what actually happens on-device without adb.
# ---------------------------------------------------------------------------
import collections
import time as _time
import threading as _threading

DEBUG_LOG = collections.deque(maxlen=400)
_debug_lock = _threading.Lock()


def dlog(msg):
    line = '%s %s' % (_time.strftime('%H:%M:%S'), msg)
    with _debug_lock:
        DEBUG_LOG.append(line)
    try:
        print(line)
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PIPED_INSTANCES = [
    'https://api.piped.private.coffee',
    'https://piped.video',
    'https://pipedapi.tokhmi.xyz',
]

INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.jing.rocks',
    'https://yewtu.be',
]

LRCLIB_HEADERS = {'User-Agent': 'VamusMusicPlayer (vamus@example.com)'}

# ---------------------------------------------------------------------------
# Helper functions & Song Fingerprinting
# ---------------------------------------------------------------------------


def normalize_song_title(title):
    """Normalize song titles to prevent slowed/sped-up/remix/reverb duplicates."""
    if not title:
        return ''
    t = title.lower()
    patterns = [
        r'\((?:slowed\s*(?:\+|and|&)?\s*reverb|slowed|reverb)\)',
        r'\[(?:slowed\s*(?:\+|and|&)?\s*reverb|slowed|reverb)\]',
        r'\((?:sped\s*up|speed\s*up|speedup|nightcore|daycore)\)',
        r'\[(?:sped\s*up|speed\s*up|speedup|nightcore|daycore)\]',
        r'\((?:remix|mix|edit|vip|flip|bootleg|dub)\)',
        r'\[(?:remix|mix|edit|vip|flip|bootleg|dub)\]',
        r'\((?:acoustic|live|instrumental|karaoke|unplugged|orchestral)\)',
        r'\[(?:acoustic|live|instrumental|karaoke|unplugged|orchestral)\]',
        r'\((?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|hd|4k)|video|audio|lyrics?)\)',
        r'\[(?:official\s*(?:video|audio|music\s*video|lyric\s*video|visualizer|hd|4k)|video|audio|lyrics?)\]',
        r'\((?:8d\s*audio|8d|3d\s*audio|3d|bass\s*boosted|bassboosted)\)',
        r'\[(?:8d\s*audio|8d|3d\s*audio|3d|bass\s*boosted|bassboosted)\]',
        r'\((?:feat\.?|ft\.?)[^)]*\)',
        r'\[(?:feat\.?|ft\.?)[^\]]*\]',
        r'\b(?:slowed\s*(?:\+|and|&)?\s*reverb|slowed|reverb|sped\s*up|speed\s*up|speedup|nightcore|official\s*audio|official\s*music\s*video|official\s*video|full\s*song|8d\s*audio|8d|bass\s*boosted)\b',
        r'-\s*(?:slowed|sped\s*up|remix|edit|live|acoustic|instrumental|official\s*audio|8d).*$',
        r'\|\s*.*$',
    ]
    for p in patterns:
        t = re.sub(p, ' ', t, flags=re.IGNORECASE)
    t = re.sub(r'[^\w\s]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def get_song_fingerprint(title, artist=''):
    """Generate a clean normalized fingerprint for duplicate variant detection."""
    norm_title = normalize_song_title(title)
    norm_artist = re.sub(r'[^\w\s]', '', (artist or '').lower()).strip()
    if norm_artist and norm_artist in norm_title:
        norm_title = norm_title.replace(norm_artist, '').strip()
    return f"{norm_artist}::{norm_title}" if norm_artist else norm_title


def extract_video_id(url_str):
    """Extract video ID from a URL like /watch?v=xxx or just return the string."""
    if not url_str:
        return ''
    if 'v=' in url_str:
        return url_str.split('v=')[-1].split('&')[0]
    return url_str.split('/')[-1]


def format_duration(seconds):
    """Format seconds into m:ss."""
    if not seconds or seconds <= 0:
        return ''
    minutes = int(seconds) // 60
    secs = int(seconds) % 60
    return f'{minutes}:{secs:02d}'


def map_piped_item(item):
    """Map a Piped search result item to our standard track format."""
    vid = extract_video_id(item.get('url', ''))
    return {
        'id': vid,
        'title': item.get('title', ''),
        'url': f'https://music.youtube.com/watch?v={vid}',
        'thumbnail': item.get('thumbnail', ''),
        'durationRaw': format_duration(item.get('duration', 0)),
        'durationInSec': item.get('duration', 0),
        'artistId': (item.get('uploaderUrl') or '').split('/')[-1] or None,
        'channel': {'name': item.get('uploaderName', 'Unknown Artist')},
    }


# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------


@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization'
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
    return response


@app.route('/api/health')
def api_health():
    return jsonify({'status': 'ok'})



# ---------------------------------------------------------------------------
# SPA / Static routes
# ---------------------------------------------------------------------------


@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')


@app.route('/<path:path>')
def spa_catch_all(path):
    """Serve static files if they exist, otherwise serve index.html for SPA routing."""
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
    static_file = os.path.join(app.static_folder, path)
    if os.path.isfile(static_file):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, 'index.html')


def get_high_res_avatar(url):
    if not url or not isinstance(url, str):
        return ''
    if url.startswith('//'):
        url = 'https:' + url
    if '=' in url and ('googleusercontent.com' in url or 'ggpht.com' in url):
        base = url.split('=')[0]
        return base + '=w800-h800-p-l90-rj'
    return url


def get_high_res_banner(url):
    if not url or not isinstance(url, str):
        return ''
    if url.startswith('//'):
        url = 'https:' + url
    if '=' in url and ('googleusercontent.com' in url or 'ggpht.com' in url):
        base = url.split('=')[0]
        return base + '=w1920-h800-p-l90-rj'
    return url


# ---------------------------------------------------------------------------
# API: Search
# ---------------------------------------------------------------------------


@app.route('/api/search')
def api_search():
    q = request.args.get('q', '').strip()
    search_type = request.args.get('type', 'songs')

    if not q:
        return jsonify({'error': 'Query parameter q is required'}), 400

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()

        if search_type == 'artists':
            mapped = []
            seen_names = set()
            seen_ids = set()

            # 1. Search general query to capture exact artist matches & albums
            try:
                gen_results = yt.search(q)
                for r in gen_results:
                    if r.get('resultType') == 'artist':
                        name = r.get('artist') or r.get('title') or ''
                        bid = r.get('browseId') or name
                        if name and name.lower() not in seen_names:
                            seen_names.add(name.lower())
                            if bid: seen_ids.add(bid)
                            raw_thumb = r.get('thumbnails')[-1].get('url') if r.get('thumbnails') else ''
                            mapped.append({
                                'id': bid,
                                'name': name,
                                'thumbnail': get_high_res_avatar(raw_thumb),
                                'type': 'artist',
                            })
            except Exception:
                pass

            # 2. Extract artists from top song matches (essential for Cyrillic/indie artists)
            try:
                song_results = yt.search(q, filter='songs')[:15]
                for song in song_results:
                    for a in song.get('artists', []):
                        name = a.get('name')
                        bid = a.get('id') or name
                        if name and name.lower() not in seen_names:
                            seen_names.add(name.lower())
                            if bid: seen_ids.add(bid)
                            raw_thumb = song.get('thumbnails')[-1].get('url') if song.get('thumbnails') else ''
                            mapped.append({
                                'id': bid,
                                'name': name,
                                'thumbnail': get_high_res_avatar(raw_thumb),
                                'type': 'artist',
                            })
            except Exception:
                pass

            # 3. Standard artists filter search
            try:
                results = yt.search(q, filter='artists')
                for a in results:
                    name = a.get('artist') or a.get('title') or ''
                    bid = a.get('browseId') or name
                    if name and name.lower() not in seen_names:
                        seen_names.add(name.lower())
                        if bid: seen_ids.add(bid)
                        raw_thumb = a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else ''
                        mapped.append({
                            'id': bid,
                            'name': name,
                            'thumbnail': get_high_res_avatar(raw_thumb),
                            'type': 'artist',
                        })
            except Exception:
                pass

            # Rank: exact match first, then prefix match, then substring, then others
            q_clean = q.lower().strip()
            def _artist_rank(item):
                n = (item.get('name') or '').lower().strip()
                if n == q_clean:
                    return 0
                if n.startswith(q_clean):
                    return 1
                if q_clean in n:
                    return 2
                return 3

            mapped.sort(key=_artist_rank)
            return jsonify(mapped)

        else:  # songs
            queries = [q, f'{q} audio', f'{q} official']
            seen_ids = set()
            mapped = []

            for query in queries:
                try:
                    results = yt.search(query, filter='songs')
                    for song in results:
                        vid = song.get('videoId')
                        if vid and vid not in seen_ids:
                            seen_ids.add(vid)
                            artists = song.get('artists', [])
                            artist_name = artists[0].get('name') if artists else 'Unknown Artist'
                            artist_id = artists[0].get('id') if artists else None
                            mapped.append({
                                'id': vid,
                                'title': song.get('title'),
                                'url': f'https://music.youtube.com/watch?v={vid}',
                                'thumbnail': song.get('thumbnails')[-1].get('url') if song.get('thumbnails') else '',
                                'durationRaw': song.get('duration') or '',
                                'durationInSec': song.get('duration_seconds') or 0,
                                'views': song.get('views') or '',
                                'artistId': artist_id,
                                'channel': {'name': artist_name}
                            })
                except Exception as e_q:
                    print(f"Search query '{query}' failed:", e_q)
                    continue
            return jsonify(mapped)

    except Exception as e:
        print("ytmusicapi search failed, falling back to Piped:", e)
        try:
            if search_type == 'artists':
                resp = http_requests.get(
                    'https://api.piped.private.coffee/search',
                    params={'q': q, 'filter': 'music_artists'},
                    timeout=10,
                )
                resp.raise_for_status()
                data = resp.json()
                items = data.get('items', [])
                results = []
                for item in items:
                    results.append({
                        'id': (item.get('url') or '').split('/')[-1],
                        'name': item.get('name', ''),
                        'thumbnail': item.get('thumbnail', ''),
                        'type': 'artist',
                    })
                return jsonify(results)

            else:  # songs
                queries = [q, f'{q} audio', f'{q} official']
                seen_ids = set()
                results = []
                for query in queries:
                    try:
                        resp = http_requests.get(
                            'https://api.piped.private.coffee/search',
                            params={'q': query, 'filter': 'music_songs'},
                            timeout=10,
                        )
                        resp.raise_for_status()
                        data = resp.json()
                        for item in data.get('items', []):
                            vid = extract_video_id(item.get('url', ''))
                            if vid and vid not in seen_ids:
                                seen_ids.add(vid)
                                results.append(map_piped_item(item))
                    except Exception:
                        continue
                return jsonify(results)
        except Exception as e2:
            return jsonify({'error': str(e2)}), 500


class YtDlpLogger(object):
    def debug(self, msg):
        pass
    def warning(self, msg):
        pass
    def error(self, msg):
        pass


# ---------------------------------------------------------------------------
# Stream URL Cache & Pre-resolution Engine
# ---------------------------------------------------------------------------
STREAM_URL_CACHE = {}
_stream_cache_lock = _threading.Lock()


def get_cached_stream_url(video_id):
    with _stream_cache_lock:
        entry = STREAM_URL_CACHE.get(video_id)
        if entry:
            if _time.time() < entry['expires']:
                return entry['url'], entry['source'], entry['fmt']
            else:
                del STREAM_URL_CACHE[video_id]
    return None, None, None


def set_cached_stream_url(video_id, stream_url, source, fmt, ttl=12600):
    with _stream_cache_lock:
        if len(STREAM_URL_CACHE) > 500:
            oldest_key = min(STREAM_URL_CACHE.keys(), key=lambda k: STREAM_URL_CACHE[k]['expires'])
            del STREAM_URL_CACHE[oldest_key]
        STREAM_URL_CACHE[video_id] = {
            'url': stream_url,
            'source': source,
            'fmt': fmt,
            'expires': _time.time() + ttl
        }


INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player'

# Innertube clients tried in order, fastest/most reliable first. Each entry is
# (label, client context, extra HTTP headers). The IOS client returns direct,
# unthrottled googlevideo audio URLs that honour HTTP Range requests, which is
# what makes instant seeking work. ANDROID_VR is kept as a secondary because it
# needs no special headers, but note it commonly answers LOGIN_REQUIRED
# ("Sign in to confirm you're not a bot") — when that happens we fall through.
INNERTUBE_CLIENTS = [
    (
        'ios',
        {
            'clientName': 'IOS',
            'clientVersion': '20.10.4',
            'deviceMake': 'Apple',
            'deviceModel': 'iPhone16,2',
            'osName': 'iPhone',
            'osVersion': '18.3.2.22D82',
            'hl': 'en',
            'gl': 'US',
        },
        {
            'User-Agent': 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
            'Content-Type': 'application/json',
        },
    ),
    (
        'android_vr',
        {
            'clientName': 'ANDROID_VR',
            'clientVersion': '1.54.19',
            'deviceMake': 'Oculus',
            'deviceModel': 'Quest 2',
            'osName': 'Android',
            'osVersion': '10',
            'hl': 'en',
            'gl': 'US',
        },
        {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Quest 2) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/15.0.0.0.22.280300652 SamsungBrowser/4.0 Chrome/89.0.4389.116 VR Safari/537.36',
            'Content-Type': 'application/json',
        },
    ),
    (
        'web_remix',
        {
            'clientName': 'WEB_REMIX',
            'clientVersion': '1.20250101.01.00',
            'hl': 'en',
            'gl': 'US',
        },
        {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
            'Referer': 'https://music.youtube.com/',
            'Content-Type': 'application/json',
        },
    ),
    (
        'tv_embedded',
        {
            'clientName': 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
            'clientVersion': '2.0',
            'hl': 'en',
            'gl': 'US',
        },
        {
            'User-Agent': 'Mozilla/5.0 (PlayStation 4 3.11) AppleWebKit/537.78 (KHTML, like Gecko) WebKit/0.0.0',
            'Referer': 'https://www.youtube.com/embed/',
            'Content-Type': 'application/json',
        },
    ),
]


def resolve_innertube_stream(video_id):
    """Direct Innertube resolution (~0.2-0.6s), avoiding a much slower yt-dlp call.

    Returns (url, source, mime) or (None, None, None) if every client failed.
    """
    for label, client, headers in INNERTUBE_CLIENTS:
        try:
            payload = {'context': {'client': client}, 'videoId': video_id}
            resp = http_requests.post(
                INNERTUBE_URL, json=payload, headers=headers, timeout=5)
            if resp.status_code != 200:
                dlog('  innertube:%s HTTP %s' % (label, resp.status_code))
                continue

            data = resp.json()
            status = data.get('playabilityStatus', {}).get('status')
            streaming = data.get('streamingData', {})
            formats = streaming.get('adaptiveFormats', []) + streaming.get('formats', [])
            audio_streams = [
                f for f in formats
                if (f.get('mimeType', '').startswith('audio/') or f.get('audioQuality') or f.get('audioSampleRate'))
                and f.get('url')
            ]
            if not audio_streams:
                dlog('  innertube:%s no-audio status=%s' % (label, status))
                continue

            def _sort_key(f):
                is_m4a = 'm4a' in f.get('mimeType', '') or 'mp4' in f.get('mimeType', '') or 'aac' in f.get('mimeType', '')
                bitrate = int(f.get('bitrate', 0) or 0)
                audio_sample_rate = int(f.get('audioSampleRate', 0) or 0)
                # Prioritize maximum bitrate and sampling rate for high-fidelity audio
                return (bitrate, audio_sample_rate, 1 if is_m4a else 0)

            audio_streams.sort(key=_sort_key, reverse=True)
            chosen = audio_streams[0]
            chosen_url = chosen.get('url')

            # Validate that stream URL is reachable and does not return 403 Forbidden
            try:
                chk = http_requests.get(
                    chosen_url,
                    headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile)'},
                    stream=True,
                    timeout=2.0
                )
                if chk.status_code != 200:
                    dlog('  innertube:%s stream check failed HTTP %s' % (label, chk.status_code))
                    continue
            except Exception as e_chk:
                dlog('  innertube:%s stream check error: %s' % (label, e_chk))
                continue

            return (chosen_url, 'innertube:%s' % label,
                    chosen.get('mimeType', 'audio/mp4'))
        except Exception as e:
            dlog('  innertube:%s FAIL: %s' % (label, str(e)[:120]))
    return None, None, None


_ytdlp_singleton = None
_ytdlp_lock = _threading.Lock()


def get_ytdlp_instance():
    global _ytdlp_singleton
    with _ytdlp_lock:
        if _ytdlp_singleton is None:
            try:
                import yt_dlp
                ydl_opts = {
                    'format': '140/251/18/bestaudio/best',
                    'logger': YtDlpLogger(),
                    'quiet': True,
                    'no_warnings': True,
                    'no_playlist': True,
                    'skip_download': True,
                    'nocheckcertificate': True,
                    'socket_timeout': 6,
                    'extractor_args': {
                        'youtube': {'player_client': ['android']}
                    },
                }
                _ytdlp_singleton = yt_dlp.YoutubeDL(ydl_opts)
            except Exception as e:
                dlog('get_ytdlp_instance error: %s' % str(e)[:120])
        return _ytdlp_singleton


def resolve_stream_url(video_id, force_refresh=False):
    if not video_id:
        return None, None, None, False

    if not force_refresh:
        cached_url, source, chosen_fmt = get_cached_stream_url(video_id)
        if cached_url:
            return cached_url, source, chosen_fmt, True

    dlog('STREAM resolve req id=%s (force_refresh=%s)' % (video_id, force_refresh))
    stream_url = source = chosen_fmt = None

    # Tier 1: Fast yt-dlp android client resolution (~1.0-1.5s)
    try:
        t0 = _time.time()
        ydl = get_ytdlp_instance()
        if ydl:
            info = ydl.extract_info(
                f'https://www.youtube.com/watch?v={video_id}',
                download=False,
            )
            url = info.get('url')
            if url:
                try:
                    chk = http_requests.get(
                        url,
                        headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile)'},
                        stream=True,
                        timeout=3.0
                    )
                    if chk.status_code == 200:
                        chosen_fmt = '%s/%s/%s' % (
                            info.get('format_id'), info.get('ext'),
                            info.get('acodec'))
                        source = 'yt-dlp:android'
                        dlog('  yt-dlp android OK fmt=%s %.2fs' % (
                            chosen_fmt, _time.time() - t0))
                        stream_url = url
                    else:
                        dlog('  yt-dlp android stream check failed HTTP %s' % chk.status_code)
                except Exception as e_chk:
                    dlog('  yt-dlp android stream check error: %s' % str(e_chk)[:120])
    except Exception as e:
        dlog('  yt-dlp primary error: %s' % str(e)[:120])

    # Tier 2: Direct Innertube Resolution with reachability check (~0.2-0.6s)
    if not stream_url:
        try:
            t0 = _time.time()
            stream_url, source, chosen_fmt = resolve_innertube_stream(video_id)
            if stream_url:
                dlog('  innertube OK via %s (%.2fs)' % (source, _time.time() - t0))
        except Exception as e:
            dlog('  innertube error: %s' % str(e)[:120])

    # Tier 3: Fallback yt-dlp client sets
    if not stream_url:
        ytdlp_client_sets = [
            ['android', 'android_creator'],
            ['tv_embedded'],
            ['web'],
        ]

        try:
            import yt_dlp
            for client_set in ytdlp_client_sets:
                t0 = _time.time()
                try:
                    ydl_opts = {
                        'format': '140/251/18/bestaudio/best',
                        'logger': YtDlpLogger(),
                        'quiet': True,
                        'no_warnings': True,
                        'no_playlist': True,
                        'skip_download': True,
                        'nocheckcertificate': True,
                        'socket_timeout': 6,
                        'extractor_args': {
                            'youtube': {'player_client': client_set}
                        },
                    }
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl_fb:
                        info = ydl_fb.extract_info(
                            f'https://www.youtube.com/watch?v={video_id}',
                            download=False,
                        )
                        url = info.get('url')
                        if url:
                            chk = http_requests.get(
                                url,
                                headers={'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Mobile)'},
                                stream=True,
                                timeout=3.0
                            )
                            if chk.status_code == 200:
                                chosen_fmt = '%s/%s/%s' % (
                                    info.get('format_id'), info.get('ext'),
                                    info.get('acodec'))
                                source = 'yt-dlp:%s' % client_set[0]
                                dlog('  yt-dlp %s OK fmt=%s %.2fs' % (
                                    client_set[0], chosen_fmt, _time.time() - t0))
                                stream_url = url
                                break
                except Exception as e:
                    dlog('  yt-dlp %s FAIL %.2fs: %s' % (
                        client_set[0], _time.time() - t0, str(e)[:120]))
                    continue
        except Exception as e:
            dlog('  yt-dlp fallback unavailable: %s' % str(e)[:120])

    # Tier 3: Piped instances fallback
    if not stream_url:
        for instance in PIPED_INSTANCES:
            try:
                resp = http_requests.get(
                    f'{instance}/streams/{video_id}', timeout=6
                )
                if resp.status_code == 200:
                    data = resp.json()
                    audio_streams = [
                        s for s in data.get('audioStreams', [])
                        if s.get('mimeType', '').startswith('audio/')
                    ]
                    if audio_streams:
                        def _piped_key(s):
                            is_mp4 = 'mp4' in s.get('mimeType', '') or 'm4a' in s.get('mimeType', '')
                            return (s.get('bitrate', 0), 1 if is_mp4 else 0)
                        audio_streams.sort(key=_piped_key, reverse=True)
                        stream_url = audio_streams[0].get('url')
                        if stream_url:
                            source = 'piped:%s' % instance.split('//')[-1]
                            chosen_fmt = audio_streams[0].get('mimeType')
                            break
            except Exception:
                continue

    # Tier 4: Invidious instances fallback
    if not stream_url:
        for instance in INVIDIOUS_INSTANCES:
            try:
                resp = http_requests.get(
                    f'{instance}/api/v1/videos/{video_id}', timeout=6
                )
                if resp.status_code == 200:
                    data = resp.json()
                    adaptive = data.get('adaptiveFormats', [])
                    audio_formats = [
                        f for f in adaptive
                        if f.get('type', '').startswith('audio/')
                    ]
                    if audio_formats:
                        def _inv_key(f):
                            is_mp4 = 'mp4' in f.get('type', '') or 'm4a' in f.get('type', '')
                            return (int(f.get('bitrate', 0) or 0), 1 if is_mp4 else 0)
                        audio_formats.sort(key=_inv_key, reverse=True)
                        stream_url = audio_formats[0].get('url')
                        if stream_url:
                            source = 'invidious:%s' % instance.split('//')[-1]
                            chosen_fmt = audio_formats[0].get('type')
                            break
            except Exception:
                continue

    if stream_url:
        set_cached_stream_url(video_id, stream_url, source, chosen_fmt)
        return stream_url, source, chosen_fmt, False

    return None, None, None, False


@app.route('/api/stream')
def api_stream():
    video_id = request.args.get('id', '').strip()
    refresh = request.args.get('refresh') == '1' or request.args.get('nocache') == '1'
    if not video_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    stream_url, source, chosen_fmt, is_hit = resolve_stream_url(video_id, force_refresh=refresh)

    if stream_url:
        try:
            host = urllib.parse.urlparse(stream_url).netloc
        except Exception:
            host = '?'
        dlog('STREAM ok id=%s via %s fmt=%s host=%s cached=%s' % (
            video_id, source, chosen_fmt, host, is_hit))
        response = redirect(stream_url, code=302)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response

    dlog('STREAM FAIL id=%s (no source)' % video_id)
    return jsonify({'error': 'Could not find audio stream'}), 502


@app.route('/api/prefetch')
def api_prefetch():
    video_ids = request.args.get('ids', '').split(',')
    clean_ids = [vid.strip() for vid in video_ids if vid.strip()][:5]
    if not clean_ids:
        return jsonify({'ok': False, 'message': 'No valid ids'}), 400

    def _bg_prefetch(vid):
        try:
            resolve_stream_url(vid)
        except Exception as e:
            dlog('prefetch error id=%s: %s' % (vid, e))

    # Resolve in parallel: sequential warming would take ~1s per track, which
    # defeats the point when the user taps the 3rd item straight away.
    for vid in clean_ids:
        _threading.Thread(target=_bg_prefetch, args=(vid,), daemon=True).start()
    return jsonify({'ok': True, 'prefetching': clean_ids})


@app.route('/api/debug/log')
def api_debug_log():
    with _debug_lock:
        return jsonify(list(DEBUG_LOG))


@app.route('/api/debug/clear')
def api_debug_clear():
    with _debug_lock:
        DEBUG_LOG.clear()
    return jsonify({'ok': True})


@app.route('/api/debug/push', methods=['GET', 'POST'])
def api_debug_push():
    # Lets the native/JS layers funnel their own log lines into the same
    # buffer so the panel shows one unified, time-ordered stream.
    msg = request.args.get('m', '') or (request.get_data(as_text=True) or '')
    if msg:
        dlog(msg[:300])
    return jsonify({'ok': True})


# ---------------------------------------------------------------------------
# API: Artist
# ---------------------------------------------------------------------------


@app.route('/api/artist')
def api_artist():
    artist_id = request.args.get('id', '').strip()
    # The client knows the artist's display name from the track it navigated
    # from. Passing it lets us recover when the id turns out not to be a
    # YouTube Music artist channel (see below).
    hint_name = request.args.get('name', '').strip()
    view_all = request.args.get('all') == '1'
    if not artist_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()

        c_id = artist_id
        artist_data = None
        # Avatar taken from an artist *search* hit. Search results carry the real
        # channel avatar for practically every artist, whereas get_artist only
        # works for official YouTube Music artist channels — so this is the
        # picture we fall back to before ever resorting to album art.
        search_avatar = ''

        is_channel_id = artist_id.startswith('UC') or artist_id.startswith('MP')

        # If artist_id is a channel ID (starts with UC or MP)
        if is_channel_id:
            try:
                artist_data = yt.get_artist(artist_id)
            except Exception as e:
                # Very common: the id came from a plain YouTube uploader channel
                # (the Piped/Invidious path builds artistId from uploaderUrl),
                # which has no musicImmersiveHeaderRenderer. Previously this left
                # the whole response empty — no name, no avatar, no songs.
                dlog(f"yt.get_artist({artist_id}) error: {e}")
                artist_data = None

        # Resolve by name whenever the id lookup gave us nothing. This used to be
        # skipped for UC/MP ids, which is exactly when it is needed most.
        if not artist_data:
            query_name = hint_name or ('' if is_channel_id else artist_id)
            if query_name:
                try:
                    search_results = yt.search(query_name, filter='artists')
                    q_norm = query_name.lower().strip()
                    matched = None
                    for a in search_results:
                        a_name = (a.get('artist') or a.get('title') or '').lower().strip()
                        if q_norm == a_name or q_norm in a_name or a_name in q_norm:
                            matched = a
                            break
                    if matched is None and search_results:
                        matched = search_results[0]
                    if matched:
                        if matched.get('thumbnails'):
                            search_avatar = matched.get('thumbnails')[-1].get('url') or ''
                        matched_id = matched.get('browseId')
                        if matched_id:
                            c_id = matched_id
                            try:
                                artist_data = yt.get_artist(c_id)
                            except Exception as e_inner:
                                dlog(f"yt.get_artist({c_id}) after name match failed: {e_inner}")
                                artist_data = None
                except Exception as e:
                    dlog(f"yt search/get_artist fallback error: {e}")

        songs = []
        top_albums = []
        singles = []
        # Never fall back to the raw id here: for a channel id that would put
        # "UCnazznLA4ddeaHZoFXR8FfQ" in the page title and, worse, use it as the
        # query for the supplementary song search further down.
        artist_name = hint_name or ('' if is_channel_id else artist_id)
        avatar_url = ''
        banner_url = ''

        if artist_data:
            artist_name = artist_data.get('name') or artist_name
            if artist_data.get('thumbnails'):
                raw_thumb = artist_data.get('thumbnails')[-1].get('url')
                avatar_url = get_high_res_avatar(raw_thumb)
                banner_url = get_high_res_banner(raw_thumb)

            raw_songs = artist_data.get('songs', {}).get('results', [])
            for s in raw_songs:
                songs.append({
                    'id': s.get('videoId'),
                    'title': s.get('title'),
                    'url': f"https://music.youtube.com/watch?v={s.get('videoId')}",
                    'thumbnail': s.get('thumbnails')[-1].get('url') if s.get('thumbnails') else '',
                    'durationRaw': s.get('duration') or '',
                    'durationInSec': s.get('duration_seconds') or 0,
                    'views': s.get('views') or '',
                    'artistId': c_id,
                    'channel': {'name': artist_name}
                })

            raw_albums = artist_data.get('albums', {}).get('results', [])
            for a in raw_albums[:10]:
                top_albums.append({
                    'id': a.get('browseId'),
                    'name': a.get('title'),
                    'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
                    'year': a.get('year') or '',
                    'type': 'Album'
                })

            raw_singles = artist_data.get('singles', {}).get('results', [])
            for a in raw_singles[:10]:
                singles.append({
                    'id': a.get('browseId'),
                    'name': a.get('title'),
                    'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
                    'year': a.get('year') or '',
                    'type': 'Single'
                })

        # Extra songs & albums search (for indie artists, Cyrillic names, or when user clicks 'View All Music')
        if len(songs) < 5 or view_all or not artist_data:
            try:
                # Searching songs for a raw "UC..." id returns nothing useful, so
                # only fall back to the id when it is actually a name.
                search_query = artist_name or ('' if is_channel_id else artist_id)
                if not search_query:
                    raise ValueError('no usable artist name to search songs for')
                extra_songs = yt.search(search_query, filter='songs')
                seen_vids = {s['id'] for s in songs}
                for s in extra_songs:
                    vid = s.get('videoId')
                    if not vid or vid in seen_vids:
                        continue
                    artists = [art.get('name', '') for art in s.get('artists', [])]
                    if not artists or any(search_query.lower() in art.lower() for art in artists) or search_query.lower() in s.get('title', '').lower():
                        seen_vids.add(vid)
                        thumb = s.get('thumbnails')[-1].get('url') if s.get('thumbnails') else ''
                        if not avatar_url and thumb:
                            avatar_url = get_high_res_avatar(thumb)
                            banner_url = get_high_res_banner(thumb)
                        s_artist_name = s.get('artists', [{}])[0].get('name') if s.get('artists') else artist_name
                        songs.append({
                            'id': vid,
                            'title': s.get('title'),
                            'url': f"https://music.youtube.com/watch?v={vid}",
                            'thumbnail': thumb,
                            'durationRaw': s.get('duration') or '',
                            'durationInSec': s.get('duration_seconds') or 0,
                            'views': s.get('views') or '',
                            'artistId': c_id,
                            'channel': {'name': s_artist_name or artist_name}
                        })
            except Exception as e_extra:
                dlog(f"Extra artist songs query failed: {e_extra}")

        # Prefer a real channel avatar over album art. Search results carry one
        # for nearly every artist, including the ones get_artist can't parse;
        # without this step anyone short of an official artist channel got their
        # album cover (or nothing) shown as their profile picture.
        if not avatar_url and not search_avatar and artist_name:
            try:
                for a in yt.search(artist_name, filter='artists'):
                    a_name = (a.get('artist') or a.get('title') or '').lower().strip()
                    n_norm = artist_name.lower().strip()
                    if (n_norm == a_name or n_norm in a_name or a_name in n_norm) and a.get('thumbnails'):
                        search_avatar = a.get('thumbnails')[-1].get('url') or ''
                        break
            except Exception as e_av:
                dlog(f"artist avatar search failed: {e_av}")

        if not avatar_url and search_avatar:
            avatar_url = get_high_res_avatar(search_avatar)
            banner_url = get_high_res_banner(search_avatar)

        # Last resort only: the top song's cover art.
        if not avatar_url and songs:
            avatar_url = get_high_res_avatar(songs[0].get('thumbnail'))
            banner_url = get_high_res_banner(songs[0].get('thumbnail'))

        # If still no albums and no artist_data, try searching albums
        if not top_albums:
            try:
                album_results = yt.search(artist_name, filter='albums')
                for a in album_results[:8]:
                    top_albums.append({
                        'id': a.get('browseId'),
                        'name': a.get('title'),
                        'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
                        'year': a.get('year') or '',
                        'type': 'Album'
                    })
            except Exception:
                pass

        if not songs and not top_albums and not singles:
            return jsonify({'error': 'Artist not found or has no songs'}), 404

        return jsonify({
            'id': c_id,
            'name': artist_name or hint_name or 'Unknown Artist',
            'avatar': avatar_url,
            'banner': banner_url,
            'thumbnail': avatar_url,
            'thumbnails': [{'url': banner_url}, {'url': avatar_url}] if (banner_url or avatar_url) else [],
            'songs': songs,
            'topAlbums': top_albums,
            'singles': singles,
        })

    except Exception as e:
        print("ytmusicapi artist fetch failed, falling back to legacy:", e)
        # LEGACY/Piped FALLBACK
        songs = []
        artist_name = ''
        avatar_url = ''
        c_id = artist_id

        try:
            channel_data = None
            if artist_id.startswith('UC') or artist_id.startswith('MP'):
                resp = http_requests.get(
                    f'https://api.piped.private.coffee/channel/{artist_id}',
                    timeout=10,
                )
                if resp.status_code == 200:
                    channel_data = resp.json()
            else:
                resp = http_requests.get(
                    'https://api.piped.private.coffee/search',
                    params={'q': artist_id, 'filter': 'channels'},
                    timeout=10,
                )
                if resp.status_code == 200:
                    items = resp.json().get('items', [])
                    if items:
                        channel_url = items[0].get('url', '')
                        c_id = channel_url.split('/')[-1]
                        resp2 = http_requests.get(
                            f'https://api.piped.private.coffee/channel/{c_id}',
                            timeout=10,
                        )
                        if resp2.status_code == 200:
                            channel_data = resp2.json()

            if channel_data:
                artist_name = channel_data.get('name', '')
                avatar_url = channel_data.get('avatarUrl', '')
                c_id = channel_data.get('id', c_id)
                related = channel_data.get('relatedStreams', [])
                for item in related:
                    if item.get('duration', 0) > 0 and len(songs) < 30:
                        songs.append(map_piped_item(item))
        except Exception as e_piped:
            print("Piped artist fetch failed:", e_piped)

        if not songs:
            try:
                import yt_dlp
                url = f"https://www.youtube.com/channel/{c_id}"
                ydl_opts = {
                    'extract_flat': True,
                    'quiet': True,
                    'logger': YtDlpLogger(),
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    raw_title = info.get('title', '') or artist_id
                    artist_name = raw_title.replace('Uploads from ', '').replace(' - Topic', '')
                    thumbnails = info.get('thumbnails', [])
                    if thumbnails:
                        avatar_url = thumbnails[-1].get('url', '')
                    for entry in info.get('entries', []):
                        if not entry or len(songs) >= 30:
                            continue
                        vid = entry.get('id', '')
                        duration = entry.get('duration', 0)
                        songs.append({
                            'id': vid,
                            'title': entry.get('title', ''),
                            'url': f'https://music.youtube.com/watch?v={vid}',
                            'thumbnail': entry.get('thumbnails', [{}])[-1].get('url', '') if entry.get('thumbnails') else '',
                            'durationRaw': format_duration(duration),
                            'durationInSec': duration,
                            'artistId': c_id,
                            'channel': {'name': artist_name}
                        })
            except Exception as e_ytdl:
                print("yt-dlp artist fetch failed:", e_ytdl)

        if not songs and not artist_name:
            return jsonify({'error': 'Artist not found or has no songs'}), 404

        return jsonify({
            'id': c_id,
            'name': artist_name,
            'thumbnails': [{'url': avatar_url}] if avatar_url else [],
            'songs': songs,
            'topAlbums': [],
            'singles': [],
        })


# ---------------------------------------------------------------------------
# API: Album
# ---------------------------------------------------------------------------


@app.route('/api/album')
def api_album():
    album_id = request.args.get('id', '').strip()
    if not album_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()

        album = yt.get_album(album_id)

        songs = []
        raw_tracks = album.get('tracks', [])
        for t in raw_tracks:
            t_artists = t.get('artists', [])
            artist_name = t_artists[0].get('name') if t_artists else album.get('artist', {}).get('name', 'Unknown Artist')
            artist_id = t_artists[0].get('id') if t_artists else album.get('artist', {}).get('id')
            songs.append({
                'id': t.get('videoId'),
                'title': t.get('title'),
                'url': f"https://music.youtube.com/watch?v={t.get('videoId')}",
                'thumbnail': t.get('thumbnails')[-1].get('url') if t.get('thumbnails') else (album.get('thumbnails')[-1].get('url') if album.get('thumbnails') else ''),
                'durationRaw': t.get('duration') or '',
                'durationInSec': t.get('duration_seconds') or 0,
                'artistId': artist_id,
                'channel': {'name': artist_name}
            })

        artist_obj = album.get('artists', [{}])[0] if album.get('artists') else {}
        if not artist_obj:
            artist_obj = {'name': album.get('artist', 'Unknown Artist')}

        return jsonify({
            'id': album_id,
            'name': album.get('title'),
            'thumbnails': album.get('thumbnails') or [],
            'year': album.get('year') or '',
            'type': album.get('type') or 'Album',
            'artist': {'name': artist_obj.get('name') or 'Unknown Artist', 'artistId': artist_obj.get('id')},
            'songs': songs,
        })

    except Exception as e:
        print("ytmusicapi album fetch failed, falling back to legacy:", e)
        # LEGACY/Piped FALLBACK
        songs = []
        album_name = ''
        thumbnail_url = ''
        uploader_name = ''

        try:
            resp = http_requests.get(
                f'https://api.piped.private.coffee/playlists/{album_id}',
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                related = data.get('relatedStreams', [])
                songs = [map_piped_item(item) for item in related if item.get('duration', 0) > 0]
                album_name = data.get('name', '')
                thumbnail_url = data.get('thumbnailUrl', '')
                uploader_name = data.get('uploader', '')
        except Exception as e_piped:
            print("Piped album fetch failed:", e_piped)

        if not songs:
            try:
                import yt_dlp
                if album_id.startswith('http'):
                    url = album_id
                else:
                    url = f"https://www.youtube.com/playlist?list={album_id}"
                ydl_opts = {
                    'extract_flat': True,
                    'quiet': True,
                    'logger': YtDlpLogger(),
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    album_name = info.get('title', '') or album_name
                    thumbnails = info.get('thumbnails', [])
                    if thumbnails:
                        thumbnail_url = thumbnails[-1].get('url', '')
                    uploader_name = info.get('uploader', '') or uploader_name
                    for entry in info.get('entries', []):
                        if not entry:
                            continue
                        vid = entry.get('id', '')
                        duration = entry.get('duration', 0)
                        songs.append({
                            'id': vid,
                            'title': entry.get('title', ''),
                            'url': f'https://music.youtube.com/watch?v={vid}',
                            'thumbnail': entry.get('thumbnails', [{}])[-1].get('url', '') if entry.get('thumbnails') else '',
                            'durationRaw': format_duration(duration),
                            'durationInSec': duration,
                            'artistId': entry.get('channel_id') or None,
                            'channel': {'name': entry.get('channel', 'Unknown Artist')}
                        })
            except Exception as e_ytdl:
                print("yt-dlp album fetch failed:", e_ytdl)

        if not songs:
            return jsonify({'error': 'Failed to fetch album or album is empty'}), 404

        return jsonify({
            'id': album_id,
            'name': album_name,
            'thumbnails': [{'url': thumbnail_url}] if thumbnail_url else [],
            'year': '',
            'type': 'Album',
            'artist': {'name': uploader_name},
            'songs': songs,
        })


# ---------------------------------------------------------------------------
# API: Lyrics
# ---------------------------------------------------------------------------


@app.route('/api/lyrics')
def api_lyrics():
    track = request.args.get('track', '').strip()
    artist = request.args.get('artist', '').strip()

    if not track or not artist:
        return jsonify({'error': 'Query parameters track and artist are required'}), 400

    synced = None
    plain = None

    try:
        # Step 1: lrclib exact match ΓÇö best source, provides time-synced lyrics.
        try:
            resp = http_requests.get(
                'https://lrclib.net/api/get',
                params={'track_name': track, 'artist_name': artist},
                headers=LRCLIB_HEADERS,
                timeout=6,
            )
            if resp.status_code == 200:
                data = resp.json()
                synced = data.get('syncedLyrics') or synced
                plain = data.get('plainLyrics') or plain
        except Exception:
            pass

        # Step 2: keyless fallback for plain lyrics (lyrics.ovh). Keeps lyrics
        # working when lrclib is down or has no match, and returns quickly.
        if not synced and not plain:
            try:
                resp = http_requests.get(
                    'https://api.lyrics.ovh/v1/%s/%s' % (
                        urllib.parse.quote(artist), urllib.parse.quote(track)),
                    timeout=6,
                )
                if resp.status_code == 200:
                    plain = resp.json().get('lyrics') or plain
            except Exception:
                pass

        # Step 3: lrclib search as a last resort (looser match) for songs whose
        # exact title/artist didn't hit above.
        if not synced and not plain:
            try:
                resp = http_requests.get(
                    'https://lrclib.net/api/search',
                    params={'q': f'{track} {artist}'},
                    headers=LRCLIB_HEADERS,
                    timeout=6,
                )
                if resp.status_code == 200:
                    for item in resp.json():
                        if item.get('syncedLyrics'):
                            synced = item.get('syncedLyrics')
                            plain = item.get('plainLyrics') or plain
                            break
                        if not plain and item.get('plainLyrics'):
                            plain = item.get('plainLyrics')
            except Exception:
                pass

        return jsonify({'syncedLyrics': synced, 'plainLyrics': plain})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ---------------------------------------------------------------------------
# API: Suggestions
# ---------------------------------------------------------------------------


@app.route('/api/suggestions')
def api_suggestions():
    q = request.args.get('q', '').strip()
    if len(q) < 2:
        return jsonify([])

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        suggestions = yt.get_search_suggestions(q)
        return jsonify(suggestions[:8])
    except Exception as e:
        print("ytmusicapi suggestions failed, falling back to Piped:", e)
        try:
            resp = http_requests.get(
                'https://api.piped.private.coffee/suggestions',
                params={'query': q},
                timeout=8,
            )
            resp.raise_for_status()
            data = resp.json()
            return jsonify(data[:8])
        except Exception as e2:
            return jsonify({'error': str(e2)}), 500


# ---------------------------------------------------------------------------
# API: Recommendations
# ---------------------------------------------------------------------------


@app.route('/api/recommendations')
def api_recommendations():
    artist_names_raw = request.args.get('artistNames', '').strip()
    if not artist_names_raw:
        return jsonify([])

    artist_names = [n.strip() for n in artist_names_raw.split(',') if n.strip()]
    artist_names = artist_names[:5]
    input_names_lower = {n.lower() for n in artist_names}

    seen_ids = set()
    results = []

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()

        for name in artist_names:
            try:
                search_results = yt.search(name, filter='artists')
                for a in search_results[:3]:
                    ch_id = a.get('browseId')
                    ch_name = a.get('artist') or a.get('title') or ''
                    if (
                        ch_id
                        and ch_id not in seen_ids
                        and ch_name.lower() not in input_names_lower
                    ):
                        seen_ids.add(ch_id)
                        results.append({
                            'id': ch_id,
                            'name': ch_name,
                            'thumbnail': get_high_res_avatar(a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else ''),
                            'type': 'artist',
                        })
                    if len(results) >= 10:
                        break
            except Exception:
                continue
            if len(results) >= 10:
                break

        return jsonify(results[:10])

    except Exception as e:
        print("ytmusicapi recommendations failed, falling back to Piped:", e)
        # Piped fallback
        seen_ids = set()
        results = []
        for name in artist_names:
            try:
                resp = http_requests.get(
                    'https://api.piped.private.coffee/search',
                    params={'q': name, 'filter': 'channels'},
                    timeout=10,
                )
                resp.raise_for_status()
                data = resp.json()
                for item in data.get('items', []):
                    ch_name = item.get('name', '')
                    ch_id = (item.get('url') or '').split('/')[-1]
                    if (
                        ch_id
                        and ch_id not in seen_ids
                        and ch_name.lower() not in input_names_lower
                    ):
                        seen_ids.add(ch_id)
                        results.append({
                            'id': ch_id,
                            'name': ch_name,
                            'thumbnail': item.get('thumbnail', ''),
                            'type': 'artist',
                        })
                    if len(results) >= 10:
                        break
            except Exception:
                continue
            if len(results) >= 10:
                break
        return jsonify(results[:10])


# ---------------------------------------------------------------------------
# API: Radio (auto-play similar tracks)
# ---------------------------------------------------------------------------


@app.route('/api/radio')
def api_radio():
    """Return ~10 genre/style-similar tracks for continuous autoplay.

    Uses ytmusicapi's get_watch_playlist (YT Music's own radio algorithm)
    which returns tracks matching the exact theme and genre of the seed track.
    Applies strict song fingerprinting and title normalization to guarantee
    NO slowed, sped-up, remix, or duplicate versions of the seed song
    or any recently played songs are ever served.
    """
    video_id = (request.args.get('id') or request.args.get('videoId') or '').strip()
    title = request.args.get('title', '').strip()
    artist = request.args.get('artist', '').strip()
    exclude_ids_raw = request.args.get('excludeIds', '').strip()
    exclude_titles_raw = request.args.get('excludeTitles', '').strip()

    if not video_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    seen_ids = set()
    if video_id:
        seen_ids.add(video_id)
    if exclude_ids_raw:
        for x in exclude_ids_raw.split(','):
            if x.strip():
                seen_ids.add(x.strip())

    seen_fingerprints = set()
    if title:
        seed_fp = get_song_fingerprint(title, artist)
        if seed_fp:
            seen_fingerprints.add(seed_fp)
        norm_title = normalize_song_title(title)
        if norm_title:
            seen_fingerprints.add(norm_title)

    if exclude_titles_raw:
        for xt in exclude_titles_raw.split('|'):
            xt = xt.strip()
            if xt:
                fp = get_song_fingerprint(xt)
                if fp:
                    seen_fingerprints.add(fp)
                nt = normalize_song_title(xt)
                if nt:
                    seen_fingerprints.add(nt)

    results = []

    # --- Primary: ytmusicapi watch playlist (true YT Music Radio algorithm) ---
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        watch = yt.get_watch_playlist(videoId=video_id, limit=25)
        tracks_raw = watch.get('tracks', [])

        for t in tracks_raw:
            vid = t.get('videoId')
            if not vid or vid in seen_ids:
                continue

            t_title = t.get('title', '') or ''
            t_artists = t.get('artists', [])
            t_artist = t_artists[0].get('name') if t_artists else 'Unknown Artist'
            t_artist_id = t_artists[0].get('id') if t_artists else None

            # Deduplication by smart fingerprint
            t_fp = get_song_fingerprint(t_title, t_artist)
            t_norm = normalize_song_title(t_title)
            if t_fp in seen_fingerprints or t_norm in seen_fingerprints:
                continue

            seen_ids.add(vid)
            if t_fp:
                seen_fingerprints.add(t_fp)
            if t_norm:
                seen_fingerprints.add(t_norm)

            thumb = ''
            th = t.get('thumbnail')
            if isinstance(th, list) and th:
                thumb = th[-1].get('url', '')
            elif isinstance(th, dict):
                thumb = th.get('url', '')

            results.append({
                'id': vid,
                'title': t_title,
                'url': f'https://music.youtube.com/watch?v={vid}',
                'thumbnail': thumb,
                'durationRaw': t.get('length', '') or '',
                'durationInSec': t.get('duration_seconds') or 0,
                'artistId': t_artist_id,
                'channel': {'name': t_artist},
            })
            if len(results) >= 12:
                break

        if len(results) >= 5:
            return jsonify(results[:10])
    except Exception as e:
        print("ytmusicapi radio failed, falling back to thematic search:", e)

    # --- Themed Fallback: search for genre/artist mix ---
    queries = []
    if artist:
        queries.append(f'{artist} mix')
        queries.append(f'{artist} songs')
    if title and artist:
        queries.append(f'{artist} similar songs')
    elif title:
        queries.append(f'{title} similar songs')

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        for q in queries:
            if len(results) >= 10:
                break
            try:
                search_res = yt.search(q, filter='songs')
                for song in search_res:
                    vid = song.get('videoId')
                    if not vid or vid in seen_ids:
                        continue
                    s_title = song.get('title', '')
                    s_artists = song.get('artists', [])
                    s_artist = s_artists[0].get('name') if s_artists else 'Unknown Artist'
                    s_id = s_artists[0].get('id') if s_artists else None

                    s_fp = get_song_fingerprint(s_title, s_artist)
                    s_norm = normalize_song_title(s_title)
                    if s_fp in seen_fingerprints or s_norm in seen_fingerprints:
                        continue

                    seen_ids.add(vid)
                    if s_fp:
                        seen_fingerprints.add(s_fp)
                    if s_norm:
                        seen_fingerprints.add(s_norm)

                    results.append({
                        'id': vid,
                        'title': s_title,
                        'url': f'https://music.youtube.com/watch?v={vid}',
                        'thumbnail': song.get('thumbnails')[-1].get('url') if song.get('thumbnails') else '',
                        'durationRaw': song.get('duration') or '',
                        'durationInSec': song.get('duration_seconds') or 0,
                        'artistId': s_id,
                        'channel': {'name': s_artist}
                    })
                    if len(results) >= 10:
                        break
            except Exception:
                continue
    except Exception:
        pass

    # Piped search fallback if still empty
    if len(results) < 5:
        for q in queries:
            if len(results) >= 10:
                break
            try:
                for instance in PIPED_INSTANCES:
                    try:
                        resp = http_requests.get(
                            f'{instance}/search',
                            params={'q': q, 'filter': 'music_songs'},
                            timeout=6,
                        )
                        if resp.status_code == 200:
                            items = resp.json().get('items', [])
                            for item in items:
                                vid = extract_video_id(item.get('url', ''))
                                if vid and vid not in seen_ids and item.get('duration', 0) > 0:
                                    item_title = item.get('title', '')
                                    item_artist = item.get('uploaderName', '')
                                    i_fp = get_song_fingerprint(item_title, item_artist)
                                    i_norm = normalize_song_title(item_title)
                                    if i_fp in seen_fingerprints or i_norm in seen_fingerprints:
                                        continue
                                    seen_ids.add(vid)
                                    if i_fp:
                                        seen_fingerprints.add(i_fp)
                                    if i_norm:
                                        seen_fingerprints.add(i_norm)
                                    results.append(map_piped_item(item))
                                    if len(results) >= 10:
                                        break
                            if len(results) >= 5:
                                break
                    except Exception:
                        continue
            except Exception:
                continue

    return jsonify(results[:10])


# ---------------------------------------------------------------------------
# API: AI Recommend
# ---------------------------------------------------------------------------


def _basic_recommendations_fallback(artist_names):
    """Fallback when no Gemini API key is available: search for similar artists
    and grab their top song from relatedStreams."""
    results = []
    seen_ids = set()
    seen_fingerprints = set()

    for name in artist_names[:3]:
        try:
            for instance in PIPED_INSTANCES:
                try:
                    resp = http_requests.get(
                        f'{instance}/search',
                        params={'q': name, 'filter': 'channels'},
                        timeout=6,
                    )
                    if resp.status_code == 200:
                        channels = resp.json().get('items', [])
                        for ch in channels[:2]:
                            ch_id = (ch.get('url') or '').split('/')[-1]
                            if not ch_id or ch_id in seen_ids:
                                continue
                            seen_ids.add(ch_id)
                            try:
                                ch_resp = http_requests.get(
                                    f'{instance}/channel/{ch_id}',
                                    timeout=6,
                                )
                                if ch_resp.status_code == 200:
                                    ch_data = ch_resp.json()
                                    streams = ch_data.get('relatedStreams', [])
                                    for s in streams:
                                        if s.get('duration', 0) > 0:
                                            song = map_piped_item(s)
                                            s_fp = get_song_fingerprint(song['title'], song.get('channel', {}).get('name', ''))
                                            if s_fp not in seen_fingerprints and song['id'] not in {r['id'] for r in results}:
                                                seen_fingerprints.add(s_fp)
                                                results.append(song)
                                                break
                            except Exception:
                                continue
                        if results:
                            break
                except Exception:
                    continue
        except Exception:
            continue

    return results


@app.route('/api/home-recommendations')
def api_home_recommendations():
    """Default, no-API-key recommendations for the home "For You" feed.

    Mirrors how YouTube Music builds its home feed: seed off the tracks the user
    has actually played and liked, then pull genre/style-similar songs from YT
    Music's own radio algorithm (get_watch_playlist). Deduplicates variants so no
    duplicate/slowed/sped-up songs appear.
    """
    import random

    seed_ids_raw = request.args.get('seedIds', '').strip()
    artist_names_raw = request.args.get('artistNames', '').strip()

    seed_ids = [s.strip() for s in seed_ids_raw.split(',') if s.strip()][:5]
    artist_names = [n.strip() for n in artist_names_raw.split(',') if n.strip()][:5]

    results = []
    seen_ids = set(seed_ids)
    seen_fingerprints = set()

    if not seed_ids and not artist_names:
        # Default / initial app launch recommendations: search top trending music hits
        try:
            from ytmusicapi import YTMusic
            yt = YTMusic()
            for kw in ('Top Hits', 'Trending Music', 'Pop Music'):
                if len(results) >= 20:
                    break
                try:
                    search_res = yt.search(kw, filter='songs')
                    for song in search_res:
                        vid = song.get('videoId')
                        if not vid or vid in seen_ids:
                            continue
                        s_title = song.get('title', '')
                        s_artists = song.get('artists', [])
                        s_artist = s_artists[0].get('name') if s_artists else 'Unknown Artist'
                        s_fp = get_song_fingerprint(s_title, s_artist)
                        if s_fp in seen_fingerprints:
                            continue

                        seen_ids.add(vid)
                        if s_fp:
                            seen_fingerprints.add(s_fp)

                        thumb = song.get('thumbnails')[-1].get('url') if song.get('thumbnails') else ''
                        results.append({
                            'id': vid,
                            'title': s_title,
                            'url': f'https://music.youtube.com/watch?v={vid}',
                            'thumbnail': thumb,
                            'durationRaw': song.get('duration') or '',
                            'durationInSec': song.get('duration_seconds') or 0,
                            'artistId': s_artists[0].get('id') if s_artists else None,
                            'channel': {'name': s_artist},
                        })
                        if len(results) >= 20:
                            break
                except Exception as e_kw:
                    print(f"ytmusicapi default search for '{kw}' failed:", e_kw)
                    continue
        except Exception as e:
            print("ytmusicapi default recommendations failed:", e)

        # Fallback to Piped search if needed
        if len(results) < 8:
            for query in ('top music hits', 'popular songs'):
                if len(results) >= 20:
                    break
                try:
                    for instance in PIPED_INSTANCES:
                        try:
                            resp = http_requests.get(
                                f'{instance}/search',
                                params={'q': query, 'filter': 'music_songs'},
                                timeout=6,
                            )
                            if resp.status_code == 200:
                                for item in resp.json().get('items', []):
                                    vid = extract_video_id(item.get('url', ''))
                                    if vid and vid not in seen_ids and item.get('duration', 0) > 0:
                                        item_title = item.get('title', '')
                                        item_artist = item.get('uploaderName', '')
                                        i_fp = get_song_fingerprint(item_title, item_artist)
                                        if i_fp in seen_fingerprints:
                                            continue
                                        seen_ids.add(vid)
                                        if i_fp:
                                            seen_fingerprints.add(i_fp)
                                        results.append(map_piped_item(item))
                                        if len(results) >= 20:
                                            break
                                if len(results) >= 10:
                                    break
                        except Exception:
                            continue
                except Exception as e_p:
                    print("Piped fallback failed:", e_p)
                    continue

        random.shuffle(results)
        return jsonify(results[:20])

    # --- Primary: YT Music radio seeded by the user's recent/liked tracks ---
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        for vid in seed_ids:
            if len(results) >= 20:
                break
            try:
                watch = yt.get_watch_playlist(videoId=vid, limit=10)
            except Exception:
                continue
            for t in watch.get('tracks', []):
                tvid = t.get('videoId')
                if not tvid or tvid in seen_ids:
                    continue

                t_title = t.get('title', '') or ''
                t_artists = t.get('artists', [])
                t_artist = t_artists[0].get('name') if t_artists else 'Unknown Artist'
                t_fp = get_song_fingerprint(t_title, t_artist)
                if t_fp in seen_fingerprints:
                    continue

                seen_ids.add(tvid)
                if t_fp:
                    seen_fingerprints.add(t_fp)

                thumb = ''
                th = t.get('thumbnail')
                if isinstance(th, list) and th:
                    thumb = th[-1].get('url', '')
                elif isinstance(th, dict):
                    thumb = th.get('url', '')
                results.append({
                    'id': tvid,
                    'title': t_title,
                    'url': f'https://music.youtube.com/watch?v={tvid}',
                    'thumbnail': thumb,
                    'durationRaw': t.get('length', '') or '',
                    'durationInSec': t.get('duration_seconds') or 0,
                    'artistId': t_artists[0].get('id') if t_artists else None,
                    'channel': {'name': t_artist},
                })
                if len(results) >= 20:
                    break
    except Exception as e:
        print("ytmusicapi home recommendations failed, falling back to Piped:", e)

    # --- Fallback / top-up: Piped searches based on favourite artists ---
    if len(results) < 8 and artist_names:
        for name in artist_names:
            if len(results) >= 20:
                break
            for query in (f'{name} mix', f'{name} songs'):
                try:
                    for instance in PIPED_INSTANCES:
                        try:
                            resp = http_requests.get(
                                f'{instance}/search',
                                params={'q': query, 'filter': 'music_songs'},
                                timeout=6,
                            )
                            if resp.status_code == 200:
                                items = resp.json().get('items', [])
                                for item in items:
                                    vid = extract_video_id(item.get('url', ''))
                                    if vid and vid not in seen_ids and item.get('duration', 0) > 0:
                                        item_title = item.get('title', '')
                                        item_artist = item.get('uploaderName', '')
                                        i_fp = get_song_fingerprint(item_title, item_artist)
                                        if i_fp in seen_fingerprints:
                                            continue
                                        seen_ids.add(vid)
                                        if i_fp:
                                            seen_fingerprints.add(i_fp)
                                        results.append(map_piped_item(item))
                                        if len(results) >= 20:
                                            break
                                if len(results) >= 10:
                                    break
                        except Exception:
                            continue
                except Exception:
                    continue

    random.shuffle(results)
    return jsonify(results[:20])


@app.route('/api/ai-recommend')
def api_ai_recommend():
    artist_names_raw = request.args.get('artistNames', '').strip()
    if not artist_names_raw:
        return jsonify([])

    artist_names = [n.strip() for n in artist_names_raw.split(',') if n.strip()]

    # Prefer the user's own key (entered in Settings and passed by the client).
    # Fall back to a server-side key only if one is configured in the
    # environment. When neither exists, AI recommendations are simply off ΓÇö the
    # default /api/home-recommendations feed covers everyone without a key.
    api_key = request.args.get('apiKey', '').strip() or os.environ.get('GEMINI_API_KEY', '').strip()

    if not api_key:
        return jsonify([])

    try:
        prompt = (
            f"Based on these artists: {', '.join(artist_names)}, "
            "recommend 20 songs by different artists that a fan would enjoy. "
            "Return ONLY a JSON array where each item has 'artist' and 'song' keys. "
            "No markdown, no explanation, just the JSON array."
        )

        gemini_resp = http_requests.post(
            f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}',
            json={
                'contents': [{'parts': [{'text': prompt}]}],
            },
            timeout=30,
        )
        gemini_resp.raise_for_status()
        gemini_data = gemini_resp.json()

        text = (
            gemini_data.get('candidates', [{}])[0]
            .get('content', {})
            .get('parts', [{}])[0]
            .get('text', '[]')
        )

        # Strip markdown code fences if present
        text = re.sub(r'^```(?:json)?\s*', '', text.strip())
        text = re.sub(r'\s*```$', '', text.strip())

        recommendations = json.loads(text)
        results = []
        seen_ids = set()

        for rec in recommendations:
            artist = rec.get('artist', '')
            song = rec.get('song', '')
            if not artist or not song:
                continue
            try:
                search_q = f'{song} {artist}'
                resp = http_requests.get(
                    'https://api.piped.private.coffee/search',
                    params={'q': search_q, 'filter': 'music_songs'},
                    timeout=8,
                )
                resp.raise_for_status()
                items = resp.json().get('items', [])
                if items:
                    mapped = map_piped_item(items[0])
                    if mapped['id'] and mapped['id'] not in seen_ids:
                        seen_ids.add(mapped['id'])
                        results.append(mapped)
            except Exception:
                continue

        return jsonify(results)

    except Exception as e:
        # Fall back to basic recommendations on any error
        results = _basic_recommendations_fallback(artist_names)
        return jsonify(results)


# ---------------------------------------------------------------------------
# Persistent User Data Backup & Restore Endpoints
# Saves user playlists, liked songs, recently played, and custom theme config
# to internal disk storage to survive WebView updates, scheme changes, and cache wipes.
# ---------------------------------------------------------------------------
def _get_user_data_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_dir, 'vamus_user_data.json')

@app.route('/api/user/data', methods=['GET'])
def api_get_user_data():
    path = _get_user_data_path()
    if os.path.exists(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify({'ok': True, 'data': data})
        except Exception as e:
            dlog(f"USER DATA read error: {e}")
    return jsonify({'ok': True, 'data': {}})

@app.route('/api/user/sync', methods=['POST'])
def api_sync_user_data():
    try:
        data = request.get_json(force=True) or {}
        path = _get_user_data_path()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        dlog(f"USER DATA saved to disk: {len(data.get('playlists', []))} playlists, {len(data.get('likedSongs', []))} liked songs")
        return jsonify({'ok': True})
    except Exception as e:
        dlog(f"USER DATA save error: {e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


# ---------------------------------------------------------------------------
# Offline Music Downloads Engine
# Downloads tracks to local storage so users can play them offline on travels.
# Includes metadata registry, streaming file server, public export, and deletion.
# ---------------------------------------------------------------------------
DOWNLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
os.makedirs(DOWNLOADS_DIR, exist_ok=True)
DOWNLOADS_META_PATH = os.path.join(DOWNLOADS_DIR, 'metadata.json')
_downloads_lock = _threading.Lock()


def _load_downloads_metadata():
    with _downloads_lock:
        if os.path.exists(DOWNLOADS_META_PATH):
            try:
                with open(DOWNLOADS_META_PATH, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}


def _save_downloads_metadata(meta):
    with _downloads_lock:
        try:
            with open(DOWNLOADS_META_PATH, 'w', encoding='utf-8') as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)
        except Exception as e:
            dlog(f"DOWNLOADS META save error: {e}")


@app.route('/api/downloads', methods=['GET'])
def api_get_downloads():
    meta = _load_downloads_metadata()
    valid_list = []
    for vid, track_info in list(meta.items()):
        filepath = os.path.join(DOWNLOADS_DIR, f"{vid}.mp3")
        if os.path.exists(filepath):
            valid_list.append(track_info)
    return jsonify(valid_list)


@app.route('/api/downloads/audio/<video_id>')
def api_serve_downloaded_audio(video_id):
    clean_id = re.sub(r'[^a-zA-Z0-9_-]', '', video_id)
    filename = f"{clean_id}.mp3"
    filepath = os.path.join(DOWNLOADS_DIR, filename)
    if os.path.exists(filepath):
        return send_from_directory(DOWNLOADS_DIR, filename, mimetype='audio/mpeg')
    return jsonify({'error': 'File not found'}), 404


@app.route('/api/download', methods=['GET', 'POST'])
def api_download_track():
    body = request.get_json(silent=True) or {}
    video_id = (request.args.get('id') or body.get('id') or '').strip()
    title = (request.args.get('title') or body.get('title') or 'Unknown Track').strip()
    artist = (request.args.get('artist') or body.get('artist') or 'Unknown Artist').strip()
    thumbnail = (request.args.get('thumbnail') or body.get('thumbnail') or '').strip()
    duration = int(request.args.get('durationInSec') or body.get('durationInSec') or 0)

    if not video_id:
        return jsonify({'ok': False, 'error': 'Missing track id'}), 400

    clean_id = re.sub(r'[^a-zA-Z0-9_-]', '', video_id)
    filename = f"{clean_id}.mp3"
    filepath = os.path.join(DOWNLOADS_DIR, filename)

    if os.path.exists(filepath) and os.path.getsize(filepath) > 10000:
        meta = _load_downloads_metadata()
        track_info = meta.get(clean_id) or {
            'id': clean_id,
            'title': title,
            'artist': artist,
            'channel': {'name': artist},
            'thumbnail': thumbnail,
            'durationInSec': duration,
            'offlineUrl': f'/api/downloads/audio/{clean_id}',
            'fileSize': os.path.getsize(filepath),
            'downloadedAt': _time.time()
        }
        if clean_id not in meta:
            meta[clean_id] = track_info
            _save_downloads_metadata(meta)
        return jsonify({'ok': True, 'message': 'Already downloaded', 'track': track_info})

    dlog(f"DOWNLOAD start id={clean_id} title='{title}'")

    # 1. Resolve stream URL
    stream_url, source, chosen_fmt, _ = resolve_stream_url(clean_id)
    if not stream_url:
        dlog(f"DOWNLOAD FAIL id={clean_id} (could not resolve stream URL)")
        return jsonify({'ok': False, 'error': 'Could not resolve audio stream URL'}), 502

    # 2. Download audio stream to file
    download_success = False
    written_bytes = 0
    temp_path = os.path.join(DOWNLOADS_DIR, f"{clean_id}_{int(_time.time()*1000)}.tmp")

    try:
        req = http_requests.get(stream_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, stream=True, timeout=30, allow_redirects=True)
        if req.status_code == 200:
            with open(temp_path, 'wb') as f:
                for chunk in req.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
                        written_bytes += len(chunk)
                f.flush()
            if written_bytes > 5000:
                download_success = True
        try:
            req.close()
        except Exception:
            pass
    except Exception as e:
        dlog(f"DOWNLOAD requests stream error: {e}")

    if not download_success:
        try:
            import urllib.request
            req_obj = urllib.request.Request(stream_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req_obj, timeout=30) as resp:
                with open(temp_path, 'wb') as f:
                    written_bytes = 0
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
                        written_bytes += len(chunk)
                    f.flush()
            if written_bytes > 5000:
                download_success = True
        except Exception as e:
            dlog(f"DOWNLOAD urllib stream error: {e}")

    if not download_success or written_bytes < 5000:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
            dlog(f"DOWNLOAD FAIL id={clean_id} written_bytes={written_bytes}")
        return jsonify({'ok': False, 'error': 'Downloaded audio file is invalid'}), 502

    try:
        import shutil
        if os.path.exists(filepath):
            try:
                os.remove(filepath)
            except Exception:
                pass
        shutil.move(temp_path, filepath)

        # Try copying to Android public Music/Downloads folder if accessible
        try:
            pub_dir = '/storage/emulated/0/Download/Vamus'
            os.makedirs(pub_dir, exist_ok=True)
            safe_name = re.sub(r'[\\/*?:"<>|]', '', f"{artist} - {title}.mp3")
            pub_path = os.path.join(pub_dir, safe_name)
            shutil.copyfile(filepath, pub_path)
            dlog(f"DOWNLOAD copied to public storage: {pub_path}")
        except Exception:
            pass

        meta = _load_downloads_metadata()
        track_info = {
            'id': clean_id,
            'title': title,
            'artist': artist,
            'channel': {'name': artist},
            'thumbnail': thumbnail,
            'durationInSec': duration,
            'offlineUrl': f'/api/downloads/audio/{clean_id}',
            'fileSize': written_bytes,
            'downloadedAt': _time.time()
        }
        meta[clean_id] = track_info
        _save_downloads_metadata(meta)

        dlog(f"DOWNLOAD OK id={clean_id} size={written_bytes} bytes")
        return jsonify({'ok': True, 'message': 'Download successful', 'track': track_info})

    except Exception as e:
        dlog(f"DOWNLOAD FAIL id={clean_id} err={e}")
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/api/downloads/delete', methods=['POST'])
def api_delete_download():
    body = request.get_json(silent=True) or {}
    video_id = (body.get('id') or request.args.get('id') or '').strip()
    if not video_id:
        return jsonify({'ok': False, 'error': 'Missing track id'}), 400

    clean_id = re.sub(r'[^a-zA-Z0-9_-]', '', video_id)
    filename = f"{clean_id}.mp3"
    filepath = os.path.join(DOWNLOADS_DIR, filename)

    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception as e:
            dlog(f"DOWNLOAD delete file error: {e}")

    meta = _load_downloads_metadata()
    if clean_id in meta:
        del meta[clean_id]
        _save_downloads_metadata(meta)

    dlog(f"DOWNLOAD DELETED id={clean_id}")
    return jsonify({'ok': True, 'message': 'Download removed'})


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

def start_server(host='127.0.0.1', port=5000):
    """Starts the Flask server safely for Chaquopy on Android."""
    try:
        # Pre-warm yt-dlp extractor in background thread so the first song plays instantly
        _threading.Thread(target=get_ytdlp_instance, daemon=True).start()
        dlog(f"Starting Python Flask server on {host}:{port}...")
        from werkzeug.serving import run_simple
        run_simple(host, int(port), app, threaded=True, use_reloader=False, use_debugger=False)
    except Exception as e:
        import traceback
        err_msg = f"Flask server startup error: {e}\n{traceback.format_exc()}"
        dlog(err_msg)
        print(err_msg)


if __name__ == '__main__':
    start_server(host='0.0.0.0', port=5000)

