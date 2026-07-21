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
    'https://pipedapi.kavin.rocks',
]

INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://invidious.jing.rocks',
    'https://yewtu.be',
]

LRCLIB_HEADERS = {'User-Agent': 'VamusMusicPlayer (vamus@example.com)'}

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


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
            results = yt.search(q, filter='artists')
            mapped = []
            for a in results:
                mapped.append({
                    'id': a.get('browseId'),
                    'name': a.get('artist') or a.get('title') or '',
                    'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
                    'type': 'artist',
                })
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


@app.route('/api/stream')
def api_stream():
    video_id = request.args.get('id', '').strip()
    if not video_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    stream_url = None
    source = None
    chosen_fmt = None
    dlog('STREAM req id=%s' % video_id)

    # Try yt-dlp first. Two things matter a great deal here:
    #
    #  1. Player client. The default "web" client gets bot-blocked on
    #     residential/mobile IPs (i.e. on the phone) and also hands back URLs
    #     that need signature deciphering. The "android_music" client evades the
    #     block and returns URLs bound to THIS device's IP, so they play from the
    #     phone. We fall through android_music -> android -> web.
    #
    #  2. Codec/container. "bestaudio" picks itag 251 (Opus in WebM), which
    #     Android's MediaPlayer streams unreliably — it will start a track then
    #     drop it mid-play. Itag 140 (m4a / AAC) streams rock-solid, so we force
    #     it. Each client is paired with a format string that prefers AAC.
    #
    # Also pass the full watch URL (not a bare id) so extraction is reliable.
    ytdlp_configs = [
        (['android_music'], '140/bestaudio[ext=m4a]/bestaudio'),
        (['android'], 'bestaudio[ext=m4a]/140/18/bestaudio'),
        (['web'], 'bestaudio[ext=m4a]/140/bestaudio/best'),
    ]
    try:
        import yt_dlp
        for clients, fmt in ytdlp_configs:
            t0 = _time.time()
            try:
                ydl_opts = {
                    'format': fmt,
                    'logger': YtDlpLogger(),
                    'quiet': True,
                    'no_warnings': True,
                    'extractor_args': {
                        'youtube': {'player_client': clients}
                    },
                }
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(
                        f'https://www.youtube.com/watch?v={video_id}',
                        download=False,
                    )
                    stream_url = info.get('url')
                    if stream_url:
                        chosen_fmt = '%s/%s/%s' % (
                            info.get('format_id'), info.get('ext'),
                            info.get('acodec'))
                        source = 'yt-dlp:%s' % clients[0]
                        dlog('  yt-dlp %s OK fmt=%s %.1fs' % (
                            clients[0], chosen_fmt, _time.time() - t0))
                        break
                    else:
                        dlog('  yt-dlp %s no-url %.1fs' % (
                            clients[0], _time.time() - t0))
            except Exception as e:
                dlog('  yt-dlp %s FAIL %.1fs: %s' % (
                    clients[0], _time.time() - t0, str(e)[:120]))
                continue
    except Exception as e:
        dlog('  yt-dlp unavailable: %s' % str(e)[:120])

    # Try Piped instances as fallback
    if not stream_url:
        for instance in PIPED_INSTANCES:
            try:
                resp = http_requests.get(
                    f'{instance}/streams/{video_id}', timeout=8
                )
                resp.raise_for_status()
                data = resp.json()
                audio_streams = data.get('audioStreams', [])
                audio_streams = [
                    s for s in audio_streams
                    if s.get('mimeType', '').startswith('audio/')
                ]
                if audio_streams:
                    # Prefer AAC/m4a over Opus/WebM (MediaPlayer streams AAC
                    # reliably), then by bitrate.
                    def _piped_key(s):
                        is_mp4 = 'mp4' in s.get('mimeType', '')
                        return (1 if is_mp4 else 0, s.get('bitrate', 0))
                    audio_streams.sort(key=_piped_key, reverse=True)
                    stream_url = audio_streams[0].get('url')
                    if stream_url:
                        source = 'piped:%s' % instance.split('//')[-1]
                        chosen_fmt = audio_streams[0].get('mimeType')
                        dlog('  piped OK %s %s' % (instance, chosen_fmt))
                        break
            except Exception as e:
                dlog('  piped FAIL %s: %s' % (instance, str(e)[:80]))
                continue

    # Try Invidious instances as second fallback
    if not stream_url:
        for instance in INVIDIOUS_INSTANCES:
            try:
                resp = http_requests.get(
                    f'{instance}/api/v1/videos/{video_id}', timeout=8
                )
                resp.raise_for_status()
                data = resp.json()
                adaptive = data.get('adaptiveFormats', [])
                audio_formats = [
                    f for f in adaptive
                    if f.get('type', '').startswith('audio/')
                ]
                if audio_formats:
                    # Prefer AAC/m4a over Opus/WebM, then by bitrate.
                    def _inv_key(f):
                        is_mp4 = 'mp4' in f.get('type', '')
                        return (1 if is_mp4 else 0, int(f.get('bitrate', 0) or 0))
                    audio_formats.sort(key=_inv_key, reverse=True)
                    stream_url = audio_formats[0].get('url')
                    if stream_url:
                        source = 'invidious:%s' % instance.split('//')[-1]
                        chosen_fmt = audio_formats[0].get('type')
                        dlog('  invidious OK %s %s' % (instance, chosen_fmt))
                        break
            except Exception as e:
                dlog('  invidious FAIL %s: %s' % (instance, str(e)[:80]))
                continue

    if stream_url:
        try:
            host = urllib.parse.urlparse(stream_url).netloc
        except Exception:
            host = '?'
        dlog('STREAM ok id=%s via %s fmt=%s host=%s' % (
            video_id, source, chosen_fmt, host))
        response = redirect(stream_url, code=302)
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        return response

    dlog('STREAM FAIL id=%s (no source)' % video_id)
    return jsonify({'error': 'Could not find audio stream'}), 502


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
    if not artist_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()

        c_id = artist_id
        if not artist_id.startswith('UC') and not artist_id.startswith('MP'):
            search_results = yt.search(artist_id, filter='artists')
            if not search_results:
                return jsonify({'error': 'Artist not found'}), 404
            c_id = search_results[0].get('browseId')

        artist = yt.get_artist(c_id)

        songs = []
        raw_songs = artist.get('songs', {}).get('results', [])
        for s in raw_songs[:30]:
            songs.append({
                'id': s.get('videoId'),
                'title': s.get('title'),
                'url': f"https://music.youtube.com/watch?v={s.get('videoId')}",
                'thumbnail': s.get('thumbnails')[-1].get('url') if s.get('thumbnails') else '',
                'durationRaw': s.get('duration') or '',
                'durationInSec': s.get('duration_seconds') or 0,
                'artistId': c_id,
                'channel': {'name': artist.get('name', 'Unknown')}
            })

        top_albums = []
        raw_albums = artist.get('albums', {}).get('results', [])
        for a in raw_albums[:10]:
            top_albums.append({
                'id': a.get('browseId'),
                'name': a.get('title'),
                'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
                'year': a.get('year') or '',
                'type': 'Album'
            })

        singles = []
        raw_singles = artist.get('singles', {}).get('results', [])
        for a in raw_singles[:10]:
            singles.append({
                'id': a.get('browseId'),
                'name': a.get('title'),
                'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
                'year': a.get('year') or '',
                'type': 'Single'
            })

        return jsonify({
            'id': c_id,
            'name': artist.get('name'),
            'thumbnails': artist.get('thumbnails') or [],
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

    try:
        # Step 1: Exact match
        try:
            resp = http_requests.get(
                'https://lrclib.net/api/get',
                params={'track_name': track, 'artist_name': artist},
                headers=LRCLIB_HEADERS,
                timeout=8,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get('syncedLyrics'):
                    return jsonify({
                        'syncedLyrics': data.get('syncedLyrics'),
                        'plainLyrics': data.get('plainLyrics'),
                    })
        except Exception:
            pass

        # Step 2: Search track + artist
        try:
            resp = http_requests.get(
                'https://lrclib.net/api/search',
                params={'q': f'{track} {artist}'},
                headers=LRCLIB_HEADERS,
                timeout=8,
            )
            if resp.status_code == 200:
                results = resp.json()
                for item in results:
                    if item.get('syncedLyrics'):
                        return jsonify({
                            'syncedLyrics': item.get('syncedLyrics'),
                            'plainLyrics': item.get('plainLyrics'),
                        })
        except Exception:
            pass

        # Step 3: Search track only
        try:
            resp = http_requests.get(
                'https://lrclib.net/api/search',
                params={'q': track},
                headers=LRCLIB_HEADERS,
                timeout=8,
            )
            if resp.status_code == 200:
                results = resp.json()
                for item in results:
                    if item.get('syncedLyrics'):
                        return jsonify({
                            'syncedLyrics': item.get('syncedLyrics'),
                            'plainLyrics': item.get('plainLyrics'),
                        })
        except Exception:
            pass

        # Nothing found
        return jsonify({'syncedLyrics': None, 'plainLyrics': None})

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
                            'thumbnail': a.get('thumbnails')[-1].get('url') if a.get('thumbnails') else '',
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
    which returns tracks that match the genre and style of the seed track.
    Falls back to a Piped search when ytmusicapi is unavailable.
    """
    video_id = request.args.get('id', '').strip()
    title = request.args.get('title', '').strip()
    artist = request.args.get('artist', '').strip()

    if not video_id:
        return jsonify({'error': 'Query parameter id is required'}), 400

    # --- Primary: ytmusicapi watch playlist (best quality matches) ---
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        watch = yt.get_watch_playlist(videoId=video_id, limit=15)
        tracks_raw = watch.get('tracks', [])

        results = []
        seen_ids = {video_id}  # exclude the seed track
        for t in tracks_raw:
            vid = t.get('videoId')
            if not vid or vid in seen_ids:
                continue
            seen_ids.add(vid)
            artists = t.get('artists', [])
            artist_name = artists[0].get('name') if artists else 'Unknown Artist'
            artist_id = artists[0].get('id') if artists else None
            results.append({
                'id': vid,
                'title': t.get('title', ''),
                'url': f'https://music.youtube.com/watch?v={vid}',
                'thumbnail': (t.get('thumbnail', [{}])[-1].get('url', '')
                              if isinstance(t.get('thumbnail'), list)
                              else (t.get('thumbnail', {}).get('url', '')
                                    if isinstance(t.get('thumbnail'), dict)
                                    else '')),
                'durationRaw': t.get('length', '') or '',
                'durationInSec': t.get('duration_seconds') or 0,
                'artistId': artist_id,
                'channel': {'name': artist_name},
            })
            if len(results) >= 10:
                break

        if results:
            return jsonify(results)
    except Exception as e:
        print("ytmusicapi radio failed, falling back to Piped:", e)

    # --- Fallback: Piped search for similar music ---
    results = []
    seen_ids = {video_id}
    queries = []
    if artist and title:
        queries.append(f'{artist} {title} mix')
        queries.append(f'{artist} songs')
    elif title:
        queries.append(f'{title} similar songs')
    elif artist:
        queries.append(f'{artist} songs')

    for query in queries:
        try:
            resp = http_requests.get(
                'https://api.piped.private.coffee/search',
                params={'q': query, 'filter': 'music_songs'},
                timeout=10,
            )
            resp.raise_for_status()
            items = resp.json().get('items', [])
            for item in items:
                vid = extract_video_id(item.get('url', ''))
                if vid and vid not in seen_ids and item.get('duration', 0) > 0:
                    seen_ids.add(vid)
                    results.append(map_piped_item(item))
                    if len(results) >= 10:
                        break
        except Exception:
            continue
        if len(results) >= 10:
            break

    return jsonify(results)


# ---------------------------------------------------------------------------
# API: AI Recommend
# ---------------------------------------------------------------------------


def _basic_recommendations_fallback(artist_names):
    """Fallback when no Gemini API key is available: search for similar artists
    and grab their top song from relatedStreams."""
    results = []
    seen_ids = set()

    for name in artist_names[:3]:
        try:
            resp = http_requests.get(
                'https://api.piped.private.coffee/search',
                params={'q': name, 'filter': 'channels'},
                timeout=10,
            )
            resp.raise_for_status()
            channels = resp.json().get('items', [])
            for ch in channels[:2]:
                ch_id = (ch.get('url') or '').split('/')[-1]
                if not ch_id or ch_id in seen_ids:
                    continue
                seen_ids.add(ch_id)
                try:
                    ch_resp = http_requests.get(
                        f'https://api.piped.private.coffee/channel/{ch_id}',
                        timeout=10,
                    )
                    ch_resp.raise_for_status()
                    ch_data = ch_resp.json()
                    streams = ch_data.get('relatedStreams', [])
                    added_song = False
                    for s in streams:
                        if s.get('duration', 0) > 0:
                            song = map_piped_item(s)
                            if song['id'] not in {r['id'] for r in results}:
                                results.append(song)
                                added_song = True
                            break
                    if not added_song:
                        # Fallback: search for songs by this artist name directly
                        search_resp = http_requests.get(
                            'https://api.piped.private.coffee/search',
                            params={'q': ch_data.get('name', name), 'filter': 'music_songs'},
                            timeout=10,
                        )
                        if search_resp.status_code == 200:
                            search_items = search_resp.json().get('items', [])
                            for s in search_items[:3]:
                                if s.get('duration', 0) > 0:
                                    song = map_piped_item(s)
                                    if song['id'] not in {r['id'] for r in results}:
                                        results.append(song)
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
    Music's own radio algorithm (get_watch_playlist). Falls back to Piped artist
    searches. Requires no Gemini key — this is what powers recommendations for
    every user out of the box.
    """
    import random

    seed_ids_raw = request.args.get('seedIds', '').strip()
    artist_names_raw = request.args.get('artistNames', '').strip()

    seed_ids = [s.strip() for s in seed_ids_raw.split(',') if s.strip()][:5]
    artist_names = [n.strip() for n in artist_names_raw.split(',') if n.strip()][:5]

    if not seed_ids and not artist_names:
        return jsonify([])

    results = []
    seen_ids = set(seed_ids)

    # --- Primary: YT Music radio seeded by the user's recent/liked tracks ---
    try:
        from ytmusicapi import YTMusic
        yt = YTMusic()
        for vid in seed_ids:
            if len(results) >= 20:
                break
            try:
                watch = yt.get_watch_playlist(videoId=vid, limit=8)
            except Exception:
                continue
            for t in watch.get('tracks', []):
                tvid = t.get('videoId')
                if not tvid or tvid in seen_ids:
                    continue
                seen_ids.add(tvid)
                artists = t.get('artists', [])
                artist_name = artists[0].get('name') if artists else 'Unknown Artist'
                artist_id = artists[0].get('id') if artists else None
                thumb = ''
                th = t.get('thumbnail')
                if isinstance(th, list) and th:
                    thumb = th[-1].get('url', '')
                elif isinstance(th, dict):
                    thumb = th.get('url', '')
                results.append({
                    'id': tvid,
                    'title': t.get('title', ''),
                    'url': f'https://music.youtube.com/watch?v={tvid}',
                    'thumbnail': thumb,
                    'durationRaw': t.get('length', '') or '',
                    'durationInSec': t.get('duration_seconds') or 0,
                    'artistId': artist_id,
                    'channel': {'name': artist_name},
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
                    resp = http_requests.get(
                        'https://api.piped.private.coffee/search',
                        params={'q': query, 'filter': 'music_songs'},
                        timeout=10,
                    )
                    resp.raise_for_status()
                    items = resp.json().get('items', [])
                except Exception:
                    continue
                for item in items:
                    vid = extract_video_id(item.get('url', ''))
                    if vid and vid not in seen_ids and item.get('duration', 0) > 0:
                        seen_ids.add(vid)
                        results.append(map_piped_item(item))
                        if len(results) >= 20:
                            break
                if len(results) >= 20:
                    break

    # Reshuffle so the feed feels fresh on each visit (like YT Music's home).
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
    # environment. When neither exists, AI recommendations are simply off — the
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
# Run
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
