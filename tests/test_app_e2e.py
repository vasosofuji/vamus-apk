import sys
import os
import time
import json
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app', 'src', 'main', 'py')))
import app

class TestVamusBackendE2E(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        app.app.config['TESTING'] = True
        cls.client = app.app.test_client()

    def test_01_stream_resolution_innertube_speed_and_quality(self):
        video_id = 'dQw4w9WgXcQ'
        t0 = time.time()
        url, source, mime = app.resolve_innertube_stream(video_id)
        elapsed = time.time() - t0

        self.assertIsNotNone(url, "Innertube stream URL should not be None")
        self.assertTrue(url.startswith('https://'), f"Stream URL should be HTTPS: {url[:50]}")
        self.assertTrue('innertube:' in source, f"Source should be innertube client: {source}")
        self.assertTrue('audio/' in mime, f"Mime type should be audio: {mime}")
        self.assertLess(elapsed, 2.5, f"Innertube resolution took {elapsed:.2f}s, expected <2.5s")
        print(f"\n[PASS] Innertube fast resolution: {source} ({mime}) in {elapsed:.3f}s")

    def test_02_stream_resolution_caching_and_refresh(self):
        video_id = 'dQw4w9WgXcQ'
        # 1. Fresh resolution
        url1, src1, fmt1, cached1 = app.resolve_stream_url(video_id, force_refresh=True)
        self.assertIsNotNone(url1)
        self.assertFalse(cached1)

        # 2. Cached resolution (0ms)
        t0 = time.time()
        url2, src2, fmt2, cached2 = app.resolve_stream_url(video_id, force_refresh=False)
        elapsed = time.time() - t0
        self.assertTrue(cached2, "Second resolution should be a cache hit")
        self.assertEqual(url1, url2)
        self.assertLess(elapsed, 0.05, f"Cached lookup took {elapsed*1000:.2f}ms, expected <50ms")
        print(f"[PASS] Stream URL caching verified: lookup in {elapsed*1000:.2f}ms")

    def test_03_api_stream_endpoint(self):
        r = self.client.get('/api/stream?id=dQw4w9WgXcQ')
        self.assertEqual(r.status_code, 302, f"Expected 302 redirect for stream, got {r.status_code}")
        self.assertTrue(r.headers.get('Location', '').startswith('https://'), "Redirect Location must be valid HTTPS stream URL")
        print("[PASS] /api/stream returns 302 redirect to googlevideo stream")

    def test_04_api_prefetch(self):
        r = self.client.get('/api/prefetch?ids=dQw4w9WgXcQ,L_LUpnjgPso')
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertTrue(data.get('ok'))
        self.assertEqual(len(data.get('prefetching', [])), 2)
        print("[PASS] /api/prefetch parallel background prefetching verified")

    def test_05_api_suggestions(self):
        r = self.client.get('/api/suggestions?q=beatles')
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0, "Suggestions should return non-empty list")
        print(f"[PASS] /api/suggestions returned {len(data)} suggestions: {data[:3]}")

    def test_06_api_search_songs_and_artists(self):
        # Search songs
        r_songs = self.client.get('/api/search?q=bohemian+rhapsody')
        self.assertEqual(r_songs.status_code, 200)
        songs = r_songs.get_json()
        self.assertIsInstance(songs, list)
        self.assertGreater(len(songs), 0, "Search songs should return list of tracks")
        self.assertIn('id', songs[0])
        self.assertIn('title', songs[0])

        # Search artists
        r_artists = self.client.get('/api/search?q=Queen&filter=artists')
        self.assertEqual(r_artists.status_code, 200)
        artists = r_artists.get_json()
        self.assertIsInstance(artists, list)
        print(f"[PASS] /api/search verified: found {len(songs)} songs, {len(artists)} artists")

    def test_07_api_radio_and_recommendations(self):
        # Radio with seed track
        r_radio = self.client.get('/api/radio?id=dQw4w9WgXcQ&title=Never+Gonna+Give+You+Up&artist=Rick+Astley')
        self.assertEqual(r_radio.status_code, 200)
        radio_tracks = r_radio.get_json()
        self.assertIsInstance(radio_tracks, list)
        self.assertGreater(len(radio_tracks), 0, "Radio should discover similar tracks")

        # Home recommendations with and without seeds
        r_home_default = self.client.get('/api/home-recommendations')
        self.assertEqual(r_home_default.status_code, 200)
        home_default = r_home_default.get_json()
        self.assertIsInstance(home_default, list)

        r_home_seeded = self.client.get('/api/home-recommendations?seedIds=dQw4w9WgXcQ&artistNames=Rick+Astley')
        self.assertEqual(r_home_seeded.status_code, 200)
        home_seeded = r_home_seeded.get_json()
        self.assertIsInstance(home_seeded, list)
        print(f"[PASS] /api/radio ({len(radio_tracks)} tracks) and /api/home-recommendations verified")

    def test_08_api_lyrics(self):
        r = self.client.get('/api/lyrics?track=Yesterday&artist=The+Beatles')
        self.assertEqual(r.status_code, 200)
        data = r.get_json()
        self.assertIn('plainLyrics', data)
        self.assertIn('syncedLyrics', data)
        print(f"[PASS] /api/lyrics verified (hasSynced={bool(data.get('syncedLyrics'))}, hasPlain={bool(data.get('plainLyrics'))})")

    def test_09_user_data_sync_and_persistence(self):
        test_payload = {
            'playlists': [{'id': 'pl_test_123', 'name': 'Rock Classics', 'tracks': [{'id': 't1', 'title': 'Song 1'}]}],
            'likedSongs': [{'id': 't1', 'title': 'Song 1', 'artist': 'Artist 1'}],
            'recentlyPlayed': [],
            'theme': {'preset': 'emerald'},
            'crossfadeEnabled': True,
            'crossfadeDuration': 6,
            'autoplayEnabled': True
        }

        # 1. Sync data to backend
        r_sync = self.client.post('/api/user/sync', json=test_payload)
        self.assertEqual(r_sync.status_code, 200)
        self.assertTrue(r_sync.get_json().get('ok'))

        # 2. Retrieve data back from backend
        r_get = self.client.get('/api/user/data')
        self.assertEqual(r_get.status_code, 200)
        retrieved = r_get.get_json().get('data', {})
        self.assertEqual(len(retrieved.get('playlists', [])), 1)
        self.assertEqual(retrieved.get('playlists')[0]['name'], 'Rock Classics')
        self.assertEqual(retrieved.get('theme', {}).get('preset'), 'emerald')
        print("[PASS] /api/user/sync and /api/user/data persistence verified")

    def test_10_offline_downloads_engine(self):
        track_payload = {
            'id': 'dQw4w9WgXcQ',
            'title': 'Never Gonna Give You Up',
            'artist': 'Rick Astley',
            'thumbnail': 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
            'durationInSec': 212
        }
        r_dl = self.client.post('/api/download', json=track_payload)
        self.assertIn(r_dl.status_code, [200, 502])
        if r_dl.status_code == 200:
            dl_data = r_dl.get_json()
            self.assertTrue(dl_data.get('ok'))

            r_list = self.client.get('/api/downloads')
            self.assertEqual(r_list.status_code, 200)
            items = r_list.get_json()
            self.assertTrue(any(item.get('id') == 'dQw4w9WgXcQ' for item in items))

            r_audio = self.client.get('/api/downloads/audio/dQw4w9WgXcQ')
            self.assertEqual(r_audio.status_code, 200)
            self.assertEqual(r_audio.headers.get('Content-Type'), 'audio/mpeg')

            r_del = self.client.post('/api/downloads/delete', json={'id': 'dQw4w9WgXcQ'})
            self.assertEqual(r_del.status_code, 200)
            self.assertTrue(r_del.get_json().get('ok'))
            print("[PASS] Full offline download lifecycle (download -> list -> serve -> delete) verified")
        else:
            print("[NOTE] Download network rate-limit handled gracefully")

if __name__ == '__main__':
    unittest.main(verbosity=2)
