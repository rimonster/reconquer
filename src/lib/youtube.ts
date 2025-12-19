/**
 * YouTube Strike Logic
 * Handles watch history analysis, pattern recognition, and signal overloading.
 */

export interface YouTubeActivity {
    id: string;
    snippet: {
        title: string;
        description: string;
        thumbnails: { default: { url: string } };
        resourceId?: { videoId: string };
    };
}

export interface PollutedVideo extends YouTubeActivity {
    reason: string;
}

const KID_KEYWORDS_YT = [
    "unboxing", "minecraft", "elsa", "challenge", "roblox",
    "ryan's world", "mrbeast kids", "toddler", "nursery rhymes",
    "toy review", "play doh", "surprise egg", "poking"
];

/**
 * Detects if a YouTube activity is pollution.
 */
export const detectYTPollution = (activity: YouTubeActivity): PollutedVideo | null => {
    const titleLower = activity.snippet.title.toLowerCase();

    const keywordMatch = KID_KEYWORDS_YT.find(keyword => titleLower.includes(keyword));
    if (keywordMatch) {
        return { ...activity, reason: `Keyword: ${keywordMatch}` };
    }

    // Check description if title doesn't match
    const descLower = activity.snippet.description.toLowerCase();
    const descMatch = KID_KEYWORDS_YT.find(keyword => descLower.includes(keyword));
    if (descMatch) {
        return { ...activity, reason: `In Description: ${descMatch}` };
    }

    return null;
};

/**
 * Signal Overloading Interests
 * Used to re-weight the home page with parent's interests.
 */
export const PARENT_INTERESTS = [
    "Deep Tech Documentaries",
    "Mechanical Keyboards Review",
    "Fine Dining Cooking",
    "Investment Strategy 2024",
    "Sci-Fi Movie Theory"
];

export const GOOGLE_CONFIG = {
    clientId: '', // To be filled by user
    scopes: [
        'https://www.googleapis.com/auth/youtube.readonly',
        'https://www.googleapis.com/auth/youtube.force-ssl' // Needed for deletion
    ]
};
