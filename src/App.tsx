import React, { useState, useEffect, useMemo } from 'react';
import { Music, Zap, CreditCard, ChevronRight, ShieldCheck, CheckSquare, Square, Youtube, Loader2, ExternalLink, ChevronDown, ChevronUp, User, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PollutedItem } from './lib/spotify';
import type { PollutedVideo } from './lib/youtube';

type Step = 'intro' | 'setup' | 'connect' | 'scan' | 'result' | 'payment' | 'review' | 'quarantine' | 'done';

const App: React.FC = () => {
  const [step, setStep] = useState<Step>('intro');
  const [minAge, setMinAge] = useState<number>(0);
  const [maxAge, setMaxAge] = useState<number>(10);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('spotify_access_token'));
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [quarantinePlaylistId, setQuarantinePlaylistId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState({ stage: '', percent: 0 });
  const [pollutedTracks, setPollutedTracks] = useState<PollutedItem[]>([]);
  const [pollutedVideos, setPollutedVideos] = useState<PollutedVideo[]>([]);

  // Selection logic for review
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(new Set());

  // Removal Options
  const [removalSettings, setRemovalSettings] = useState({
    createdPlaylists: true,
    collaborativePlaylists: true,
    favorites: true,
    history: true
  });

  useEffect(() => {
    const handleAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (code && (window.location.pathname.includes('/callback') || window.location.search.includes('code='))) {
        try {
          const { getToken } = await import('./lib/spotify');
          const token = await getToken(code);
          if (token) {
            setAccessToken(token);
            localStorage.setItem('spotify_access_token', token);
            setStep('scan');
            window.history.replaceState({}, document.title, window.location.pathname.replace('/callback', ''));
          }
        } catch (err) {
          console.error('Token exchange failed:', err);
        }
      }
    };
    handleAuthCallback();
  }, []);

  const totalPollutedItems = pollutedTracks.length + pollutedVideos.length;

  useEffect(() => {
    const runRealScan = async () => {
      if (step === 'scan') {
        if (!accessToken) {
          setStep('connect');
          return;
        }

        try {
          const { performFullScan } = await import('./lib/spotify');
          const { polluted, scannedCount: totalScanned } = await performFullScan(
            accessToken,
            minAge,
            maxAge,
            removalSettings,
            (stage, percent) => setScanProgress({ stage, percent })
          );

          setPollutedTracks(polluted);
          setScannedCount(totalScanned);
          setSelectedTrackIds(new Set(polluted.map(t => t.id)));
          setPollutedVideos([]);
          setStep('result');
        } catch (err) {
          localStorage.removeItem('spotify_access_token');
          setStep('connect');
        }
      }
    };
    runRealScan();
  }, [step, accessToken, minAge, maxAge]);

  const handleQuarantine = async () => {
    if (!accessToken || selectedTrackIds.size === 0) return;

    setStep('quarantine');
    const tracksToClean = pollutedTracks.filter(t => selectedTrackIds.has(t.id));

    try {
      const { performQuarantine } = await import('./lib/spotify');
      const playlistId = await performQuarantine(
        accessToken,
        tracksToClean,
        removalSettings,
        (stage, percent) => setScanProgress({ stage, percent })
      );
      setQuarantinePlaylistId(playlistId);
      setStep('done');
    } catch (err) {
      alert('Failed to perform quarantine. Please try again.');
      setStep('review');
    }
  };

  const handleSpotifyLogin = async () => {
    const { getAuthUrl } = await import('./lib/spotify');
    const authUrl = await getAuthUrl();
    window.location.href = authUrl;
  };

  // Grouped tracks for review screen
  const tracksByArtist = useMemo(() => {
    const groups: Record<string, { artistName: string, tracks: PollutedItem[] }> = {};
    pollutedTracks.forEach(track => {
      const primaryArtist = track.artists[0];
      if (!groups[primaryArtist.id]) {
        groups[primaryArtist.id] = { artistName: primaryArtist.name, tracks: [] };
      }
      groups[primaryArtist.id].tracks.push(track);
    });
    return Object.entries(groups).map(([id, data]) => ({ id, ...data }));
  }, [pollutedTracks]);

  const toggleArtist = (_artistId: string, trackIds: string[]) => {
    const next = new Set(selectedTrackIds);
    const allSelected = trackIds.every(id => next.has(id));
    if (allSelected) {
      trackIds.forEach(id => next.delete(id));
    } else {
      trackIds.forEach(id => next.add(id));
    }
    setSelectedTrackIds(next);
  };

  const toggleTrack = (trackId: string) => {
    const next = new Set(selectedTrackIds);
    if (next.has(trackId)) next.delete(trackId);
    else next.add(trackId);
    setSelectedTrackIds(next);
  };

  const toggleExpand = (artistId: string) => {
    const next = new Set(expandedArtists);
    if (next.has(artistId)) next.delete(artistId);
    else next.add(artistId);
    setExpandedArtists(next);
  };

  return (
    <div className="container animate-fade-in">
      <header style={{ textAlign: 'center', marginBottom: '2.5rem', marginTop: '1.5rem' }}>
        <img src="logo.png" alt="unKidMyFeed Logo" style={{ width: '120px', height: '120px', marginBottom: '1rem', filter: 'drop-shadow(0 0 20px rgba(29, 185, 84, 0.3))' }} />
        <h1 style={{ fontSize: '2.8rem', background: 'linear-gradient(to right, #1DB954, #FFFFFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.05em', fontWeight: '800' }}>unKidMyFeed</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', fontWeight: '500' }}>Bring your true taste back.</p>
      </header>

      <main className="glass" style={{ padding: '2.5rem', maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: '2.2rem', marginBottom: '1.2rem' }}>Miss the old you?</h2>
              <p style={{ marginBottom: '2.5rem', color: 'var(--text-secondary)', lineHeight: '1.8' }}>
                Reclaim your music profile by identifying and isolating the youth influence from your core algorithm.
              </p>
              <button onClick={() => setStep('setup')} style={{ padding: '1.2rem 3.5rem', borderRadius: '100px', background: 'white', color: 'black', fontWeight: '800' }}>
                Reclaim My Feed <ChevronRight size={20} style={{ verticalAlign: 'middle' }} />
              </button>
            </motion.div>
          )}

          {step === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <h2 style={{ fontSize: '1.8rem', marginBottom: '2rem' }}>Configure Cleanup</h2>
              <div style={{ marginBottom: '2.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <label style={{ color: 'var(--text-secondary)', fontWeight: 'bold' }}>Target Ages:</label>
                  <span style={{ color: '#1DB954', fontWeight: 'bold' }}>{minAge} — {maxAge}</span>
                </div>
                {/* Sliders simplified for space */}
                <input type="range" min="0" max="18" value={minAge} onChange={(e) => setMinAge(Math.min(maxAge - 1, parseInt(e.target.value)))} style={{ width: '100%' }} />
                <input type="range" min="0" max="18" value={maxAge} onChange={(e) => setMaxAge(Math.max(minAge + 1, parseInt(e.target.value)))} style={{ width: '100%' }} />
              </div>

              <div style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Cleanup Strategy:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {[
                    { key: 'favorites', label: 'Un-like Songs (Favorites)', icon: <Music size={18} /> },
                    { key: 'createdPlaylists', label: 'My Created Playlists', icon: <User size={18} /> },
                    { key: 'collaborativePlaylists', label: 'My Collaborative Playlists', icon: <Users size={18} /> },
                    { key: 'history', label: 'Clear History (Taste Profile Cache)', icon: <Zap size={18} /> }
                  ].map(s => (
                    <div key={s.key} onClick={() => setRemovalSettings({ ...removalSettings, [s.key]: !(removalSettings as any)[s.key] })} style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '0.8rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                      {(removalSettings as any)[s.key] ? <CheckSquare size={20} color="#1DB954" /> : <Square size={20} color="gray" />}
                      {s.icon} <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <button onClick={() => setStep('connect')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold' }}>Continue to Connect</button>
            </motion.div>
          )}

          {step === 'connect' && (
            <motion.div key="connect" style={{ textAlign: 'center' }}>
              <h2 style={{ marginBottom: '2rem' }}>Connect Your Sources</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="glass" style={{ padding: '2rem' }}>
                  <Music size={40} color="#1DB954" style={{ margin: '0 auto 1rem' }} />
                  <h3>Spotify</h3>
                  <button onClick={handleSpotifyLogin} style={{ marginTop: '1rem', width: '100%', background: '#1DB954', color: 'white', padding: '0.8rem', borderRadius: '100px' }}>
                    {accessToken ? 'Connected' : 'Connect'}
                  </button>
                </div>
                <div className="glass" style={{ padding: '2rem', opacity: 0.5 }}>
                  <Youtube size={40} color="#666" style={{ margin: '0 auto 1rem' }} />
                  <h3>YouTube</h3>
                  <button disabled style={{ marginTop: '1rem', width: '100%', background: '#333', color: '#666', padding: '0.8rem', borderRadius: '100px' }}>Coming Soon</button>
                </div>
              </div>
              <button disabled={!accessToken} onClick={() => setStep('scan')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: accessToken ? 'white' : '#333', color: accessToken ? 'black' : 'gray' }}>Run Scan</button>
            </motion.div>
          )}

          {step === 'scan' && (
            <motion.div key="scan" style={{ textAlign: 'center', padding: '3rem' }}>
              <div style={{ position: 'relative', width: '100px', height: '100px', margin: '0 auto 2rem' }}>
                <svg viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
                  <motion.circle cx="50" cy="50" r="45" fill="none" stroke="#1DB954" strokeWidth="5" strokeDasharray="283" animate={{ strokeDashoffset: 283 - (283 * scanProgress.percent) / 100 }} />
                </svg>
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold' }}>{scanProgress.percent}%</div>
              </div>
              <h3>{scanProgress.stage || 'Analyzing...'}</h3>
            </motion.div>
          )}

          {step === 'result' && (
            <motion.div key="result">
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h3 style={{ color: '#FF0000', fontSize: '1.5rem' }}>{totalPollutedItems} Polluted Items Found</h3>
                <p style={{ color: 'var(--text-secondary)' }}>Analyzed {scannedCount} items from your profile</p>
              </div>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {pollutedTracks.slice(0, 50).map((t, i) => (
                  <div key={i} className="polluted-item">
                    <img src={t.album.images[0]?.url} alt="" style={{ width: 40, height: 40, borderRadius: 4 }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{t.name}</p>
                      <p style={{ fontSize: '0.7rem', color: '#FF0000' }}>{t.reason}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => setStep('payment')} style={{ width: '100%', padding: '1.2rem', marginTop: '2rem', borderRadius: '12px', background: 'linear-gradient(45deg, #1DB954, #FF0000)', color: 'white', fontWeight: 'bold' }}>
                Purge for $5
              </button>
            </motion.div>
          )}

          {step === 'payment' && (
            <motion.div key="payment" style={{ textAlign: 'center' }}>
              <CreditCard size={64} style={{ marginBottom: '2rem' }} />
              <h2>Ready to Purge</h2>
              <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)' }}>Restore your algorithm by isolating youth content.</p>
              <button onClick={() => setStep('review')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold' }}>Pay via Stripe</button>
            </motion.div>
          )}

          {step === 'review' && (
            <motion.div key="review">
              <h3 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Final Item Selection</h3>
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '2rem', fontSize: '0.9rem' }}>Uncheck any items you want to keep in your profile.</p>

              <div style={{ maxHeight: '450px', overflowY: 'auto', paddingRight: '1rem' }}>
                {tracksByArtist.map(group => {
                  const isExpanded = expandedArtists.has(group.id);
                  const selectedCount = group.tracks.filter(t => selectedTrackIds.has(t.id)).length;
                  const allSelected = selectedCount === group.tracks.length;

                  return (
                    <div key={group.id} style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', padding: '1rem', cursor: 'pointer' }}>
                        <div onClick={(e) => { e.stopPropagation(); toggleArtist(group.id, group.tracks.map(t => t.id)); }}>
                          {allSelected ? <CheckSquare size={20} color="#1DB954" /> : selectedCount > 0 ? <CheckSquare size={20} color="#666" /> : <Square size={20} color="gray" />}
                        </div>
                        <div style={{ flex: 1, marginLeft: '1rem' }} onClick={() => toggleExpand(group.id)}>
                          <p style={{ fontWeight: 'bold' }}>{group.artistName}</p>
                          <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{selectedCount} of {group.tracks.length} tracks selected</p>
                        </div>
                        <div onClick={() => toggleExpand(group.id)}>
                          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                      </div>

                      {isExpanded && (
                        <div style={{ padding: '0 1rem 1rem 3rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                          {group.tracks.map(track => (
                            <div key={track.id} onClick={() => toggleTrack(track.id)} style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer' }}>
                              {selectedTrackIds.has(track.id) ? <CheckSquare size={16} color="#1DB954" /> : <Square size={16} color="gray" />}
                              <span style={{ fontSize: '0.85rem' }}>{track.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                onClick={handleQuarantine}
                className="btn-primary"
                style={{ width: '100%', marginTop: '2rem', padding: '1.2rem', borderRadius: '12px', background: '#1DB954', color: 'white', fontWeight: 'bold' }}
              >
                Perform Quarantine ({selectedTrackIds.size} items)
              </button>
            </motion.div>
          )}

          {step === 'quarantine' && (
            <motion.div key="quarantine" style={{ textAlign: 'center', padding: '3rem' }}>
              <Loader2 className="animate-spin" size={64} style={{ margin: '0 auto 2rem' }} />
              <h3>{scanProgress.stage || 'Moving items to quarantine...'}</h3>
              <p>{scanProgress.percent}% Complete</p>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" style={{ textAlign: 'center' }}>
              <ShieldCheck size={80} color="#1DB954" style={{ margin: '2rem auto' }} />
              <h2>Purge Complete!</h2>
              {quarantinePlaylistId && (
                <a href={`https://open.spotify.com/playlist/${quarantinePlaylistId}`} target="_blank" rel="noopener noreferrer" className="glass" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.5rem', marginTop: '2rem', textDecoration: 'none' }}>
                  <Music color="#1DB954" />
                  <div style={{ textAlign: 'left' }}>
                    <p style={{ fontWeight: 'bold' }}>View Quarantine</p>
                    <p style={{ fontSize: '0.8rem', color: 'gray' }}>Safe isolated playlist</p>
                  </div>
                  <ExternalLink size={20} style={{ marginLeft: 'auto' }} />
                </a>
              )}
              <button onClick={() => window.location.reload()} style={{ marginTop: '2rem', color: '#1DB954', background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>Start New Cleanup</button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <style>{`
        .polluted-item { display: flex; align-items: center; gap: 1rem; padding: 0.8rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(255,255,255,0.05); }
        .animate-spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default App;
