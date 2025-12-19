/**
 * Spotify Logic with Age Scopes and Source Tracking
 */
import ageConfigs from '../data/ageConfigs.json';

export interface SpotifyTrack {
    id: string;
    name: string;
    artists: { name: string; id: string }[];
    album: { name: string; images: { url: string }[] };
    uri: string;
}

export interface PollutedItem extends SpotifyTrack {
    reason: string;
    genre?: string;
    source: string; // "History", "Liked Songs", "Top Tracks", etc.
}

export const SPOTIFY_CONFIG = {
    clientId: (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string) || '',
    redirectUri: window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/callback',
    scopes: [
        'user-read-recently-played',
        'user-top-read',
        'user-library-read',
        'playlist-read-private',
        'playlist-read-collaborative',
        'playlist-modify-public',
        'playlist-modify-private'
    ]
};

// --- PKCE UTILS ---

function generateRandomString(length: number) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier: string) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(digest))))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export const getAuthUrl = async () => {
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem('spotify_code_verifier', verifier);
    const params = new URLSearchParams({
        client_id: SPOTIFY_CONFIG.clientId,
        response_type: 'code',
        redirect_uri: SPOTIFY_CONFIG.redirectUri,
        scope: SPOTIFY_CONFIG.scopes.join(' '),
        code_challenge_method: 'S256',
        code_challenge: challenge,
        show_dialog: 'true'
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
};

export const getToken = async (code: string) => {
    const codeVerifier = localStorage.getItem('spotify_code_verifier');
    if (!codeVerifier) throw new Error('Missing code verifier');
    const params = new URLSearchParams({
        client_id: SPOTIFY_CONFIG.clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: SPOTIFY_CONFIG.redirectUri,
        code_verifier: codeVerifier,
    });
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data.access_token;
};

// --- CORE LOGIC ---

/**
 * Detects pollution based on an age range.
 * STRICT: Only Artist IDs (Codes) and Musical Styles (Genres).
 */
export const detectPollution = (track: SpotifyTrack, artistGenres: string[], minAge: number, maxAge: number): string | null => {
    const scopeMapping = [
        { key: 'toddler', min: 0, max: 3 },
        { key: 'kid', min: 4, max: 7 },
        { key: 'preteen', min: 8, max: 12 },
        { key: 'teen', min: 13, max: 100 }
    ];

    const activeScopes = scopeMapping.filter(s =>
        (minAge <= s.max && maxAge >= s.min)
    ).map(s => s.key);

    const mergedArtistIds: string[] = [];
    const mergedGenres: string[] = [];

    activeScopes.forEach(key => {
        const config = (ageConfigs as any)[key];
        if (config) {
            mergedArtistIds.push(...(config.artistIds || []));
            mergedGenres.push(...(config.genres || []).map((g: string) => g.toLowerCase()));
        }
    });

    // 1. EXACT ARTIST ID MATCH (The priority)
    for (const trackArtist of track.artists) {
        if (mergedArtistIds.includes(trackArtist.id)) {
            return `Artist Code Match: ${trackArtist.name}`;
        }
    }

    // 2. MUSICAL STYLE (GENRE) MATCH
    const genreMatch = artistGenres.find(genre =>
        mergedGenres.some(g => genre.toLowerCase().includes(g.toLowerCase()))
    );
    if (genreMatch) return `Musical Style: ${genreMatch}`;

    return null;
};

export const performFullScan = async (
    accessToken: string,
    minAge: number,
    maxAge: number,
    removalSettings: { favorites: boolean, playlists: boolean, history: boolean }
): Promise<{ polluted: PollutedItem[], scannedCount: number, favoritesAudit: any[] }> => {
    try {
        const headers = { Authorization: `Bearer ${accessToken}` };

        // Fetch favorites for audit
        const likedRes = await fetch('https://api.spotify.com/v1/me/tracks?limit=50', { headers });
        const likedData = await likedRes.json();
        const favoritesAuditRaw = (likedData.items || []).map((item: any) => ({ ...item.track, _source: 'Favorites' }));

        const fetchPromises: Promise<any>[] = [];
        if (removalSettings.history) {
            fetchPromises.push(fetch('https://api.spotify.com/v1/me/player/recently-played?limit=50', { headers }).then(r => r.json()));
            fetchPromises.push(fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=short_term', { headers }).then(r => r.json()));
            fetchPromises.push(fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term', { headers }).then(r => r.json()));
            fetchPromises.push(fetch('https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=long_term', { headers }).then(r => r.json()));
        }

        if (removalSettings.playlists) {
            fetchPromises.push(fetch('https://api.spotify.com/v1/me/playlists?limit=20', { headers }).then(r => r.json()));
        }

        const results = await Promise.all(fetchPromises);
        let allTracksRaw: any[] = [];

        // Only include favorites in the pollution list if removal is checked
        if (removalSettings.favorites) {
            allTracksRaw.push(...favoritesAuditRaw);
        }

        let index = 0;
        if (removalSettings.history) {
            const recent = (results[index++]?.items || []).map((item: any) => ({ ...item.track, _source: 'History' }));
            const topS = (results[index++]?.items || []).map((t: any) => ({ ...t, _source: 'Top Picks' }));
            const topM = (results[index++]?.items || []).map((t: any) => ({ ...t, _source: 'Top Picks' }));
            const topL = (results[index++]?.items || []).map((t: any) => ({ ...t, _source: 'Top Picks' }));
            allTracksRaw.push(...recent, ...topS, ...topM, ...topL);
        }

        let scannedPlaylists: any[] = [];
        if (removalSettings.playlists) {
            scannedPlaylists = results[index++]?.items || [];
            for (const pl of scannedPlaylists.slice(0, 5)) {
                const res = await fetch(`https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50`, { headers });
                const data = await res.json();
                (data.items || []).forEach((item: any) => {
                    if (item.track) allTracksRaw.push({ ...item.track, _source: `Playlist: ${pl.name.slice(0, 15)}...`, _playlistId: pl.id });
                });
            }
        }

        const trackMap = new Map<string, { track: any, sources: Set<string>, playlistIds: Set<string> }>();
        allTracksRaw.forEach((t: any) => {
            if (!t || !t.id) return;
            if (!trackMap.has(t.id)) trackMap.set(t.id, { track: t, sources: new Set(), playlistIds: new Set() });
            trackMap.get(t.id)!.sources.add(t._source);
            if (t._playlistId) trackMap.get(t.id)!.playlistIds.add(t._playlistId);
        });

        const uniqueTracks = Array.from(trackMap.values()).map(entry => ({
            ...entry.track,
            _sources: Array.from(entry.sources),
            _playlistIds: Array.from(entry.playlistIds)
        }));

        const scannedCount = uniqueTracks.length;

        // Batch Genres for ALL tracks (including audit favorites just in case)
        const allScannedArtistIds = Array.from(new Set([
            ...uniqueTracks.flatMap(t => t.artists.map((a: { id: string }) => a.id)),
            ...favoritesAuditRaw.flatMap((t: any) => t.artists.map((a: { id: string }) => a.id))
        ]));

        const artistGenresMap: Record<string, string[]> = {};
        for (let i = 0; i < allScannedArtistIds.length; i += 50) {
            const batch = allScannedArtistIds.slice(i, i + 50);
            const artistResponse = await fetch(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, { headers });
            const artistData = await artistResponse.json();
            (artistData.artists || []).forEach((artist: any) => {
                artistGenresMap[artist.id] = artist.genres || [];
            });
        }

        const polluted: PollutedItem[] = [];
        for (const track of uniqueTracks) {
            const trackGenres = track.artists.flatMap((a: { id: string }) => artistGenresMap[a.id] || []);
            const reason = detectPollution(track, trackGenres, minAge, maxAge);
            if (reason) {
                polluted.push({ ...track, reason, source: track._sources.join(', ') } as PollutedItem);
            }
        }

        // Audit view
        const favoritesAudit = favoritesAuditRaw.map((track: any) => {
            const trackGenres = track.artists.flatMap((a: { id: string }) => artistGenresMap[a.id] || []);
            const reason = detectPollution(track, trackGenres, minAge, maxAge);
            return { ...track, _isPolluted: !!reason, _reason: reason };
        });

        return { polluted, scannedCount, favoritesAudit };
    } catch (error) {
        console.error('Scan failed:', error);
        throw error;
    }
};

/**
 * Performs actual cleanup: creates quarantine playlist and removes tracks.
 */
export const performQuarantine = async (
    accessToken: string,
    pollutedItems: PollutedItem[],
    removalSettings: { favorites: boolean, playlists: boolean, history: boolean }
): Promise<string> => {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };

    // 1. Get user profile
    const userRes = await fetch('https://api.spotify.com/v1/me', { headers });
    const userData = await userRes.json();
    const userId = userData.id;

    // 2. Create Quarantine Playlist
    const plRes = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            name: 'Quarantined by unKidMyFeed',
            description: 'Moved here to restore your algorithm. Safely isolated.',
            public: false
        })
    });
    const playlist = await plRes.json();
    const quarantineId = playlist.id;

    // 3. Add ALL polluted items to Quarantine (in batches of 100)
    const trackUris = pollutedItems.map(item => item.uri);
    for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        await fetch(`https://api.spotify.com/v1/playlists/${quarantineId}/tracks`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ uris: batch })
        });
    }

    // 4. Remove from Favorites
    if (removalSettings.favorites) {
        const likedIds = pollutedItems
            .filter(item => item.source.includes('Favorites'))
            .map(item => item.id);

        for (let i = 0; i < likedIds.length; i += 50) {
            const batch = likedIds.slice(i, i + 50);
            await fetch(`https://api.spotify.com/v1/me/tracks?ids=${batch.join(',')}`, {
                method: 'DELETE',
                headers
            });
        }
    }

    // 5. Remove from Playlists
    if (removalSettings.playlists) {
        // This requires tracking which tracks belong to which playlist during scan
        // For now, if _playlistIds was captured:
        pollutedItems.forEach(async (item: any) => {
            if (item._playlistIds) {
                for (const plId of item._playlistIds) {
                    await fetch(`https://api.spotify.com/v1/playlists/${plId}/tracks`, {
                        method: 'DELETE',
                        headers,
                        body: JSON.stringify({ tracks: [{ uri: item.uri }] })
                    });
                }
            }
        });
    }

    return quarantineId;
};
