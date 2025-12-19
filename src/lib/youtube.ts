import youtubeConfigs from '../data/youtubeConfigs.json';

export interface YouTubeChannel {
    id: string;
    title: string;
    description: string;
    thumbnails: { default: { url: string } };
}

export interface YouTubeVideo {
    id: string;
    title: string;
    channelTitle: string;
    channelId: string;
    thumbnails: { default: { url: string } };
}

export interface PollutedVideo {
    id: string;
    name: string; // To match Spotify interface for UI
    title: string;
    channelTitle: string;
    reason: string;
    source: string; // "Subscription" or "Liked Video"
    thumbnails: { default: { url: string } };
    album: { images: { url: string }[] }; // Compatibility for UI
}

export const GOOGLE_CONFIG = {
    clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string) || '',
    redirectUri: window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/callback',
    scopes: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl'
    ]
};

export const getGoogleAuthUrl = () => {
    const params = new URLSearchParams({
        client_id: GOOGLE_CONFIG.clientId,
        redirect_uri: GOOGLE_CONFIG.redirectUri,
        response_type: 'token', // Using Implicit Flow for simplicity in local web app
        scope: GOOGLE_CONFIG.scopes.join(' '),
        state: 'google_auth',
        include_granted_scopes: 'true',
        prompt: 'consent'
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const detectYTPollution = (
    item: { title: string, channelId: string, channelTitle: string, description?: string },
    minAge: number,
    maxAge: number
): string | null => {
    const scopeMapping = [
        { key: 'toddler', min: 0, max: 3 },
        { key: 'kid', min: 4, max: 7 },
        { key: 'preteen', min: 8, max: 12 },
        { key: 'teen', min: 13, max: 100 }
    ];

    const activeScopes = scopeMapping.filter(s =>
        (minAge <= s.max && maxAge >= s.min)
    ).map(s => s.key);

    const mergedChannelIds: string[] = [];
    const mergedKeywords: string[] = [];

    activeScopes.forEach(key => {
        const config = (youtubeConfigs as any)[key];
        if (config) {
            mergedChannelIds.push(...(config.channelIds || []));
            mergedKeywords.push(...(config.keywords || []).map((k: string) => k.toLowerCase()));
        }
    });

    // 1. Channel ID Match
    if (mergedChannelIds.includes(item.channelId)) {
        return `Channel Match: ${item.channelTitle}`;
    }

    // 2. Keyword Match (Title and Description)
    const textToSearch = `${item.title} ${item.description || ''} ${item.channelTitle}`.toLowerCase();
    const keywordMatch = mergedKeywords.find(keyword => textToSearch.includes(keyword));
    if (keywordMatch) return `Keyword: ${keywordMatch}`;

    return null;
};

// Helper function to handle Google API errors with retries
const fetchGoogleWithRetry = async (url: string, options: any, retries = 3): Promise<Response> => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);

            if (response.status === 401) {
                throw new Error('AUTHENTICATION_EXPIRED');
            }

            if (response.status === 429) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            if (!response.ok && response.status >= 500) {
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

export const performYTScan = async (
    accessToken: string,
    minAge: number,
    maxAge: number,
    onProgress?: (stage: string, percent: number) => void
): Promise<{ polluted: PollutedVideo[], scannedCount: number }> => {
    const headers = { Authorization: `Bearer ${accessToken}` };
    let polluted: PollutedVideo[] = [];
    let scannedCount = 0;

    try {
        // 1. Scan Subscriptions
        onProgress?.('Scanning your subscriptions...', 10);
        let subUrl: string | null = 'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet&mine=true&maxResults=50';
        while (subUrl) {
            const res = await fetchGoogleWithRetry(subUrl, { headers });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);

            const items = data.items || [];
            scannedCount += items.length;

            items.forEach((item: any) => {
                const snippet = item.snippet;
                const reason = detectYTPollution({
                    title: snippet.title,
                    channelId: snippet.resourceId.channelId,
                    channelTitle: snippet.title,
                    description: snippet.description
                }, minAge, maxAge);

                if (reason) {
                    polluted.push({
                        id: item.id, // Subscription ID for deletion
                        name: snippet.title,
                        title: snippet.title,
                        channelTitle: snippet.title,
                        reason,
                        source: 'Subscription',
                        thumbnails: snippet.thumbnails,
                        album: { images: [{ url: snippet.thumbnails.default.url }] }
                    });
                }
            });
            subUrl = data.nextPageToken ? `${subUrl}&pageToken=${data.nextPageToken}` : null;
            onProgress?.(`Subscriptions: ${scannedCount} items analyzed`, 30);
        }

        // 2. Scan Liked Videos
        onProgress?.('Scanning liked videos...', 40);
        let likeUrl: string | null = 'https://www.googleapis.com/youtube/v3/videos?part=snippet&myRating=like&maxResults=50';
        while (likeUrl) {
            const res = await fetchGoogleWithRetry(likeUrl, { headers });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);

            const items = data.items || [];
            scannedCount += items.length;

            items.forEach((item: any) => {
                const snippet = item.snippet;
                const reason = detectYTPollution({
                    title: snippet.title,
                    channelId: snippet.channelId,
                    channelTitle: snippet.channelTitle,
                    description: snippet.description
                }, minAge, maxAge);

                if (reason) {
                    polluted.push({
                        id: item.id, // Video ID for un-liking
                        name: snippet.title,
                        title: snippet.title,
                        channelTitle: snippet.channelTitle,
                        reason,
                        source: 'Liked Video',
                        thumbnails: snippet.thumbnails,
                        album: { images: [{ url: snippet.thumbnails.default.url }] }
                    });
                }
            });
            likeUrl = data.nextPageToken ? `https://www.googleapis.com/youtube/v3/videos?part=snippet&myRating=like&maxResults=50&pageToken=${data.nextPageToken}` : null;
            onProgress?.(`Liked Videos: ${scannedCount} total items analyzed`, 70);
        }

        onProgress?.('Scan complete!', 100);
        return { polluted, scannedCount };
    } catch (err) {
        console.error('YT Scan failed:', err);
        throw err;
    }
};

export const performYTQuarantine = async (
    accessToken: string,
    pollutedItems: PollutedVideo[],
    onProgress?: (stage: string, percent: number) => void
): Promise<string | null> => {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
    };

    // 1. Filter out videos that can be added to a playlist (Liked Videos)
    const videosToQuarantine = pollutedItems.filter(item => item.source === 'Liked Video');

    let quarantinePlaylistId: string | null = null;

    // 2. Create Quarantine Playlist if we have videos
    if (videosToQuarantine.length > 0) {
        onProgress?.('Creating YouTube quarantine playlist...', 5);
        try {
            const plRes = await fetchGoogleWithRetry('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    snippet: {
                        title: 'Quarantined by unKidMyFeed',
                        description: 'Moved here to restore your algorithm. Safely isolated videos.'
                    },
                    status: {
                        privacyStatus: 'private'
                    }
                })
            });
            const plData = await plRes.json();
            quarantinePlaylistId = plData.id;
        } catch (err) {
            console.error('Failed to create YT playlist:', err);
            // Continue with un-liking even if playlist creation fails
        }
    }

    const total = pollutedItems.length;
    for (let i = 0; i < total; i++) {
        const item = pollutedItems[i];
        const progress = Math.floor((i / total) * 100);

        try {
            if (item.source === 'Subscription') {
                onProgress?.(`Unsubscribing from ${item.channelTitle}...`, progress);
                await fetchGoogleWithRetry(`https://www.googleapis.com/youtube/v3/subscriptions?id=${item.id}`, {
                    method: 'DELETE',
                    headers
                });
            } else if (item.source === 'Liked Video') {
                // First: Add to quarantine if playlist exists
                if (quarantinePlaylistId) {
                    onProgress?.(`Archiving ${item.title}...`, progress);
                    await fetchGoogleWithRetry('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            snippet: {
                                playlistId: quarantinePlaylistId,
                                resourceId: {
                                    kind: 'youtube#video',
                                    videoId: item.id
                                }
                            }
                        })
                    });
                }

                // Second: Remove Like
                onProgress?.(`Removing like from ${item.title}...`, progress);
                await fetchGoogleWithRetry(`https://www.googleapis.com/youtube/v3/videos/rate?id=${item.id}&rating=none`, {
                    method: 'POST',
                    headers
                });
            }
        } catch (err) {
            console.warn(`Failed to process YT item ${item.id}:`, err);
        }
    }

    onProgress?.('YouTube cleanup complete!', 100);
    return quarantinePlaylistId;
};
