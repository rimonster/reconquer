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
        'user-library-modify',
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

// Helper function to handle API errors with retries
const fetchWithRetry = async (url: string, options: any, retries = 3): Promise<Response> => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            if (response.status === 429) {
                // Rate limited - wait and retry
                const retryAfter = parseInt(response.headers.get('Retry-After') || '2', 10);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
                continue;
            }

            if (response.status === 401) {
                throw new Error('AUTHENTICATION_EXPIRED');
            }

            if (!response.ok && response.status >= 500) {
                // Server error - retry
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                    continue;
                }
            }

            return response;
        } catch (error: any) {
            if (error.message === 'AUTHENTICATION_EXPIRED') throw error;
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    throw new Error('Max retries reached');
};


export const checkTokenValidity = async (accessToken: string): Promise<boolean> => {
    try {
        const response = await fetch('https://api.spotify.com/v1/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        return response.ok;
    } catch {
        return false;
    }
};

export const performFullScan = async (
    accessToken: string,
    minAge: number,
    maxAge: number,
    removalSettings: { favorites: boolean, createdPlaylists: boolean, collaborativePlaylists: boolean },
    onProgress?: (stage: string, percent: number) => void
): Promise<{ polluted: PollutedItem[], scannedCount: number }> => {
    try {
        const headers = { Authorization: `Bearer ${accessToken}` };

        // 0. Get user profile to identify owned playlists
        const userRes = await fetch('https://api.spotify.com/v1/me', { headers });
        const userData = await userRes.json();
        const userId = userData.id;

        // NOTE: We do NOT scan History/Top Picks because they are READ-ONLY in Spotify's API
        // They cannot be deleted, only viewed. Including them would show tracks that can't be removed.
        // Users should unlike songs and remove from playlists to affect the algorithm.

        let allTracksRaw: any[] = [];

        // Only fetch and include favorites if the checkbox is checked
        if (removalSettings.favorites) {
            onProgress?.('Scanning your favorite songs...', 5);
            let likedUrl: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50';
            while (likedUrl) {
                const likedRes = await fetchWithRetry(likedUrl, { headers });
                const likedData = await likedRes.json();
                allTracksRaw.push(...(likedData.items || []).map((item: any) => ({ ...item.track, _source: 'Favorites' })));
                likedUrl = likedData.next;
            }
            onProgress?.('Favorite songs scanned', 15);
        }

        let scannedPlaylists: any[] = [];
        if (removalSettings.createdPlaylists || removalSettings.collaborativePlaylists) {
            // Fetch ALL user playlists with pagination
            onProgress?.('Loading your playlists...', 35);
            let playlistUrl: string | null = 'https://api.spotify.com/v1/me/playlists?limit=50';
            while (playlistUrl) {
                const plRes = await fetchWithRetry(playlistUrl, { headers });
                const plData = await plRes.json();

                // Filter based on specific user settings
                const owned = (plData.items || []).filter((pl: any) => {
                    const isOwner = pl.owner.id === userId;
                    const isCollab = pl.collaborative;

                    if (isOwner && removalSettings.createdPlaylists) return true;
                    if (isCollab && removalSettings.collaborativePlaylists) return true;
                    return false;
                });

                scannedPlaylists.push(...owned);
                playlistUrl = plData.next;
            }

            // Scan ALL playlists
            onProgress?.(`Scanning ${scannedPlaylists.length} playlists...`, 40);
            for (let i = 0; i < scannedPlaylists.length; i++) {
                const pl = scannedPlaylists[i];
                const playlistProgress = 40 + Math.floor((i / scannedPlaylists.length) * 30);
                onProgress?.(`Scanning playlist: ${pl.name}`, playlistProgress);

                let trackUrl: string | null = `https://api.spotify.com/v1/playlists/${pl.id}/tracks?limit=50`;
                while (trackUrl) {
                    const res = await fetchWithRetry(trackUrl, { headers });
                    const data = await res.json();
                    (data.items || []).forEach((item: any) => {
                        if (item.track) allTracksRaw.push({ ...item.track, _source: `Playlist: ${pl.name.slice(0, 15)}...`, _playlistId: pl.id });
                    });
                    trackUrl = data.next;
                }
            }
            onProgress?.('All playlists scanned', 70);
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

        onProgress?.('Analyzing artist genres...', 75);
        const allScannedArtistIds = Array.from(new Set([
            ...uniqueTracks.flatMap(t => t.artists.map((a: { id: string }) => a.id))
        ]));

        const artistGenresMap: Record<string, string[]> = {};
        const totalBatches = Math.ceil(allScannedArtistIds.length / 50);
        for (let i = 0; i < allScannedArtistIds.length; i += 50) {
            const batch = allScannedArtistIds.slice(i, i + 50);
            const batchNum = Math.floor(i / 50) + 1;
            onProgress?.(`Fetching artist data (${batchNum}/${totalBatches})...`, 75 + Math.floor((batchNum / totalBatches) * 15));
            const artistResponse = await fetchWithRetry(`https://api.spotify.com/v1/artists?ids=${batch.join(',')}`, { headers });
            const artistData = await artistResponse.json();
            (artistData.artists || []).forEach((artist: any) => {
                // Some artists may be null if the ID is invalid or artist was removed
                if (artist && artist.id) {
                    artistGenresMap[artist.id] = artist.genres || [];
                }
            });
        }

        onProgress?.('Detecting polluted tracks...', 90);
        const polluted: PollutedItem[] = [];
        for (const track of uniqueTracks) {
            const trackGenres = track.artists.flatMap((a: { id: string }) => artistGenresMap[a.id] || []);
            const reason = detectPollution(track, trackGenres, minAge, maxAge);
            if (reason) {
                polluted.push({ ...track, reason, source: track._sources.join(', ') } as PollutedItem);
            }
        }

        onProgress?.('Scan complete!', 100);

        return { polluted, scannedCount };
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
    removalSettings: { favorites: boolean, createdPlaylists: boolean, collaborativePlaylists: boolean },
    onProgress?: (stage: string, percent: number) => void
): Promise<string> => {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };

    // 1. Get user profile
    onProgress?.('Getting user profile...', 5);
    const userRes = await fetch('https://api.spotify.com/v1/me', { headers });
    const userData = await userRes.json();
    const userId = userData.id;

    // 2. Create Quarantine Playlist
    onProgress?.('Creating quarantine playlist...', 10);
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
    onProgress?.('Adding tracks to quarantine...', 20);
    const trackUris = pollutedItems.map(item => item.uri);
    const totalQuarantineBatches = Math.ceil(trackUris.length / 100);
    for (let i = 0; i < trackUris.length; i += 100) {
        const batch = trackUris.slice(i, i + 100);
        const batchNum = Math.floor(i / 100) + 1;
        onProgress?.(`Adding batch ${batchNum}/${totalQuarantineBatches} to quarantine...`, 20 + Math.floor((batchNum / totalQuarantineBatches) * 20));
        await fetch(`https://api.spotify.com/v1/playlists/${quarantineId}/tracks`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ uris: batch })
        });
    }

    // 4. Remove from Favorites (STRICT: Only remove if found in Favorites)
    if (removalSettings.favorites) {
        onProgress?.('Removing from favorites...', 45);

        // We only remove from Favorites if the item was actually found there during scan.
        // Note: 'Top Picks' and 'History' are read-only in Spotify's API and cannot be "deleted".
        const likedIds = pollutedItems
            .filter(item => item.source.includes('Favorites'))
            .map(item => item.id);

        if (likedIds.length > 0) {
            const totalFavBatches = Math.ceil(likedIds.length / 50);
            for (let i = 0; i < likedIds.length; i += 50) {
                const batch = likedIds.slice(i, i + 50);
                const batchNum = Math.floor(i / 50) + 1;
                onProgress?.(`Removing favorites batch ${batchNum}/${totalFavBatches}...`, 45 + Math.floor((batchNum / totalFavBatches) * 25));
                await fetch(`https://api.spotify.com/v1/me/tracks?ids=${batch.join(',')}`, {
                    method: 'DELETE',
                    headers
                });
            }
        }
    }

    // 5. Remove from Playlists (FIXED: proper async handling with Promise.all)
    if (removalSettings.createdPlaylists || removalSettings.collaborativePlaylists) {
        onProgress?.('Removing from playlists...', 70);
        // Group tracks by playlist ID for efficient batch removal
        const playlistTrackMap = new Map<string, string[]>();

        pollutedItems.forEach((item: any) => {
            if (item._playlistIds && item._playlistIds.length > 0) {
                item._playlistIds.forEach((plId: string) => {
                    if (!playlistTrackMap.has(plId)) {
                        playlistTrackMap.set(plId, []);
                    }
                    playlistTrackMap.get(plId)!.push(item.uri);
                });
            }
        });

        const playlistIds = Array.from(playlistTrackMap.keys());
        const totalPlaylists = playlistIds.length;

        // Process all playlists with proper async handling
        const removalPromises: Promise<void>[] = [];

        for (let i = 0; i < playlistIds.length; i++) {
            const plId = playlistIds[i];
            const trackUris = playlistTrackMap.get(plId) || [];

            onProgress?.(`Removing from playlist ${i + 1}/${totalPlaylists}...`, 70 + Math.floor((i / totalPlaylists) * 25));

            // Remove tracks in batches of 100 (Spotify API limit)
            for (let j = 0; j < trackUris.length; j += 100) {
                const batch = trackUris.slice(j, j + 100);
                const promise = fetch(`https://api.spotify.com/v1/playlists/${plId}/tracks`, {
                    method: 'DELETE',
                    headers,
                    body: JSON.stringify({
                        tracks: batch.map(uri => ({ uri }))
                    })
                }).then(response => {
                    if (!response.ok) {
                        console.warn(`Failed to remove tracks from playlist ${plId}:`, response.status);
                    }
                });
                removalPromises.push(promise);
            }
        }

        // Wait for ALL removal operations to complete
        await Promise.all(removalPromises);
    }

    onProgress?.('Quarantine complete!', 100);
    return quarantineId;
};
