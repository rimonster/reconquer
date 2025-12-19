# unKidMyFeed

**Bring your true taste back.**

unKidMyFeed is a web application that helps parents reclaim their Spotify music profile from children's content contamination. If your Spotify recommendations have been taken over by Cocomelon, Blippi, or Kidz Bop, this tool identifies and safely quarantines those tracks to restore your algorithm.

## Features

- **Age-Based Detection**: Configure age ranges (Toddler, Kid, Pre-Teen, Teen) to target specific content
- **Comprehensive Scanning**: Analyzes ALL your:
  - Liked/Favorite songs
  - Playlists
  - Recently played history
  - Top tracks (short, medium, long-term)
- **Smart Detection**: Uses 200+ curated artist IDs and genre matching across 4 age demographics
- **Safe Quarantine**: Creates a private "Quarantined by unKidMyFeed" playlist to isolate flagged tracks
- **Customizable Cleanup**: Choose which sources to clean (favorites, playlists, listening history)
- **Beautiful UI**: Modern glass-morphism design with smooth animations

## How It Works

1. **Configure**: Set the age range of content you want to remove (0-18 years)
2. **Connect**: Login with your Spotify account (OAuth 2.0 with PKCE)
3. **Scan**: The app analyzes your entire music library against a curated database
4. **Review**: See all flagged tracks with pollution percentage
5. **Quarantine**: Safely isolate contaminated tracks in a new playlist
6. **Restore**: Your Spotify algorithm begins recommending music based on your actual taste

## Tech Stack

- **React 19.2** - Modern UI framework
- **TypeScript 5.9** - Type safety with strict mode
- **Vite 7.2** - Fast bundler with HMR
- **Framer Motion** - Smooth animations
- **Spotify Web API** - OAuth 2.0/PKCE authentication

## Setup

### Prerequisites

- Node.js 18+ and npm
- A Spotify account
- Spotify Developer App credentials

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd reconquer
```

2. Install dependencies:
```bash
npm install
```

3. Create a Spotify App:
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Create a new app
   - Add redirect URI: `http://localhost:5173/callback` (for development)
   - Copy your Client ID

4. Configure environment variables:
```bash
# Create .env file
cp .env.example .env

# Edit .env and add your Spotify Client ID
VITE_SPOTIFY_CLIENT_ID=your_client_id_here
```

5. Run development server:
```bash
npm run dev
```

6. Open [http://localhost:5173](http://localhost:5173) in your browser

### Production Build

```bash
npm run build
```

The built files will be in the `dist/` directory.

## Project Structure

```
src/
├── App.tsx              # Main application component & UI flow
├── main.tsx             # React entry point
├── lib/
│   ├── spotify.ts       # Spotify API integration & detection logic
│   └── youtube.ts       # YouTube integration (coming soon)
├── data/
│   └── ageConfigs.json  # Age-based artist/genre database
└── assets/              # Images and static files
```

## Configuration

### Age Demographics

The app uses 4 age-based categories:
- **Toddler (0-3)**: Cocomelon, Super Simple Songs, Blippi
- **Kid (4-7)**: Kidz Bop, Disney, kids' movie soundtracks
- **Pre-Teen (8-12)**: Teen pop, gaming music
- **Teen (13-18+)**: Young adult content

### Removal Settings

Configure what gets cleaned:
- **Un-like Songs**: Remove from favorites/liked songs
- **Purge from Playlists**: Identify in playlists (quarantine only, not deleted)
- **Exclude from Taste Profile**: Remove from listening history influence

## How Detection Works

1. **Exact Artist ID Match** (Priority): Matches against 200+ curated Spotify artist IDs
2. **Genre/Style Match**: Analyzes artist genres for children's music patterns
3. **Source Tracking**: Tracks where contamination appears (playlists, history, favorites)

## Privacy & Security

- OAuth 2.0 with PKCE for secure Spotify authentication
- All processing happens client-side (no backend server)
- Access tokens stored in localStorage (consider upgrading to sessionStorage)
- No user data is stored or transmitted to third parties
- Open source - audit the code yourself

## Limitations

- Currently only supports Spotify (YouTube integration planned)
- Scans all playlists and favorites (may take time for large libraries)
- Detection based on curated artist database (may have false positives/negatives)
- No undo feature after quarantine (playlist remains accessible)

## Future Features

- YouTube Music integration
- Machine learning for better detection
- Undo/restore functionality
- Playlist-specific scanning
- Export scan results
- Community-contributed artist database

## Contributing

Contributions welcome! Areas for improvement:
- Add test coverage (currently 0%)
- Improve detection algorithm
- Better error handling
- Rate limiting protection
- Token refresh implementation

## License

MIT License - See LICENSE file for details

## Troubleshooting

**"Authentication failed"**
- Verify your Spotify Client ID in `.env`
- Check redirect URI matches your Spotify app settings
- Clear localStorage and try again

**"Scan taking too long"**
- Large libraries (1000+ playlists) may take several minutes
- Check browser console for API errors
- Spotify may rate limit - wait and retry

**"Tracks not removed from playlists"**
- The app now only quarantines tracks, it doesn't delete them from playlists
- You can manually remove tracks from playlists if desired
- All flagged tracks are safely stored in the quarantine playlist

## Version History

- **v3.1** - Current: Removed audit layer, quarantine-only mode
- **v3.0** - Full automated cleanup with favorites/playlist removal
- **v2.0** - Age-based detection system
- **v1.0** - Initial release

---

Built with love by parents who miss their music recommendations.
