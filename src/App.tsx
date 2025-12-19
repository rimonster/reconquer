import React, { useState, useEffect, useMemo } from 'react';
import { Music, CreditCard, ChevronRight, ShieldCheck, CheckSquare, Square, Youtube, Loader2, ExternalLink, ChevronDown, ChevronUp, User, Users } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { storage as spotifyStorage, getToken, getAuthUrl, checkTokenValidity, performFullScan, performQuarantine } from './lib/spotify';
import type { PollutedItem } from './lib/spotify';
import { getGoogleAuthUrl, performYTScan, performYTQuarantine } from './lib/youtube';
import type { PollutedVideo } from './lib/youtube';

// Use unified storage
const storage = spotifyStorage;

type Step = 'intro' | 'setup' | 'connect' | 'scan' | 'result' | 'payment' | 'review' | 'quarantine' | 'done' | 'privacy' | 'help';

const App: React.FC = () => {
  const [step, setStep] = useState<Step>(() => {
    const path = window.location.pathname;
    if (path.endsWith('/privacy')) return 'privacy';
    if (path.endsWith('/help')) return 'help';
    return 'intro';
  });
  const [minAge, setMinAge] = useState<number>(() => Number(storage.getItem('minAge')) || 0);
  const [maxAge, setMaxAge] = useState<number>(() => Number(storage.getItem('maxAge')) || 20);
  const [accessToken, setAccessToken] = useState<string | null>(storage.getItem('spotify_access_token'));
  const [ytAccessToken, setYtAccessToken] = useState<string | null>(storage.getItem('youtube_access_token'));
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [ytScannedCount, setYtScannedCount] = useState<number>(0);
  const [quarantinePlaylistId, setQuarantinePlaylistId] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState({ stage: '', percent: 0 });
  const [pollutedTracks, setPollutedTracks] = useState<PollutedItem[]>([]);
  const [pollutedVideos, setPollutedVideos] = useState<PollutedVideo[]>([]);

  // Selection logic for review
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());
  const [expandedArtists, setExpandedArtists] = useState<Set<string>>(new Set());

  // Removal Options
  const [removalSettings, setRemovalSettings] = useState(() => {
    const saved = storage.getItem('removal_settings');
    return saved ? JSON.parse(saved) : {
      createdPlaylists: true,
      collaborativePlaylists: true,
      favorites: true
    };
  });

  useEffect(() => {
    const handleAuthCallback = async () => {
      // 1. Spotify Auth (Query Params)
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const state = urlParams.get('state');
      const error = urlParams.get('error');

      // 2. Google/YouTube Auth (Hash Fragment)
      const hash = window.location.hash.substring(1);
      const hashParams = new URLSearchParams(hash);
      const googleToken = hashParams.get('access_token');
      const isGoogleAuth = hashParams.get('state') === 'google_auth' || window.location.hash.includes('access_token=');

      if (error) {
        console.error('Auth error:', error);
        alert('Connection was cancelled or denied.');
        setStep('connect');
        window.history.replaceState({}, document.title, window.location.pathname.replace('/callback', ''));
        return;
      }

      // Handle Spotify
      if (code && (window.location.pathname.includes('/callback') || window.location.search.includes('code='))) {
        try {
          const token = await getToken(code, state);
          if (token) {
            setAccessToken(token);
            storage.setItem('spotify_access_token', token);
            restorePreAuthSettings();
            finalizeAuthRedirect();
          }
        } catch (err: any) {
          console.error('Spotify token exchange failed:', err);
          alert(`Spotify connection failed: ${err.message || 'Please try again'}`);
          setStep('connect');
        }
      }

      // Handle Google
      if (googleToken && isGoogleAuth) {
        setYtAccessToken(googleToken);
        storage.setItem('youtube_access_token', googleToken);
        restorePreAuthSettings();
        finalizeAuthRedirect();
        window.location.hash = ''; // Clear hash
      }
    };

    const restorePreAuthSettings = () => {
      const savedSettings = storage.getItem('pre_auth_settings');
      if (savedSettings) {
        try {
          const { minAge: savedMin, maxAge: savedMax, removalSettings: savedRemoval } = JSON.parse(savedSettings);
          setMinAge(savedMin);
          setMaxAge(savedMax);
          setRemovalSettings(savedRemoval);
          storage.removeItem('pre_auth_settings');
        } catch (e) {
          console.warn('Failed to restore pre-auth settings:', e);
        }
      }
    };

    const finalizeAuthRedirect = () => {
      const intendedStep = storage.getItem('pre_auth_step') || 'connect';
      storage.removeItem('pre_auth_step');
      setStep(intendedStep as Step);
      window.history.replaceState({}, document.title, window.location.pathname.replace('/callback', ''));
    };

    handleAuthCallback();

    // Periodic check for token validity
    const checkAuth = async () => {
      if (accessToken) {
        const isValid = await checkTokenValidity(accessToken);
        if (!isValid) {
          setAccessToken(null);
          storage.removeItem('spotify_access_token');
        }
      }
    };

    if (accessToken) {
      checkAuth();
    }
  }, [accessToken]);

  // Persist settings
  useEffect(() => {
    storage.setItem('minAge', minAge.toString());
    storage.setItem('maxAge', maxAge.toString());
    storage.setItem('removal_settings', JSON.stringify(removalSettings));
  }, [minAge, maxAge, removalSettings]);

  const totalPollutedItems = pollutedTracks.length + pollutedVideos.length;

  useEffect(() => {
    const runRealScan = async () => {
      if (step === 'scan') {
        if (!accessToken && !ytAccessToken) {
          setStep('connect');
          return;
        }

        try {
          setPollutedTracks([]);
          setPollutedVideos([]);
          setScannedCount(0);
          setYtScannedCount(0);

          // 1. Scan Spotify if connected
          if (accessToken) {
            setScanProgress({ stage: 'Starting Spotify scan...', percent: 0 });
            const { polluted, scannedCount: sCount } = await performFullScan(
              accessToken,
              minAge,
              maxAge,
              removalSettings,
              (stage, percent) => setScanProgress({ stage: `Spotify: ${stage}`, percent: percent / 2 })
            );
            setScannedCount(sCount);
            setPollutedTracks(polluted);
            setSelectedTrackIds(new Set(polluted.map(t => t.id)));
          }

          // 2. Scan YouTube if connected
          if (ytAccessToken) {
            setScanProgress({ stage: 'Starting YouTube scan...', percent: 50 });
            const { polluted: ytPolluted, scannedCount: yCount } = await performYTScan(
              ytAccessToken,
              minAge,
              maxAge,
              (stage, percent) => setScanProgress({ stage: `YouTube: ${stage}`, percent: 50 + (percent / 2) })
            );
            setYtScannedCount(yCount);
            setPollutedVideos(ytPolluted);
            setSelectedVideoIds(new Set(ytPolluted.map(v => v.id)));
          }

          setStep('result');
        } catch (err: any) {
          const isAuthErr = err.message === 'AUTHENTICATION_EXPIRED' || err.status === 401;
          if (isAuthErr) {
            alert('Your session has expired. Please re-connect.');
            setStep('connect');
          } else {
            console.error('Scan failed:', err);
            alert(`Scan failed: ${err.message || 'Unknown error'}`);
            setStep('setup');
          }
        }
      }
    };
    runRealScan();
  }, [step, accessToken, ytAccessToken, minAge, maxAge]);

  const handleQuarantine = async () => {
    if ((!accessToken && !ytAccessToken) || (selectedTrackIds.size === 0 && selectedVideoIds.size === 0)) return;

    setStep('quarantine');

    try {
      // 1. Spotify Quarantine
      if (accessToken && selectedTrackIds.size > 0) {
        const tracksToClean = pollutedTracks.filter(t => selectedTrackIds.has(t.id));
        const playlistId = await performQuarantine(
          accessToken,
          tracksToClean,
          removalSettings,
          (stage, percent) => setScanProgress({ stage: `Spotify: ${stage}`, percent: percent / 2 })
        );
        setQuarantinePlaylistId(playlistId);
      }

      // 2. YouTube Quarantine
      if (ytAccessToken && selectedVideoIds.size > 0) {
        const videosToClean = pollutedVideos.filter(v => selectedVideoIds.has(v.id));
        await performYTQuarantine(
          ytAccessToken,
          videosToClean,
          (stage, percent) => setScanProgress({ stage: `YouTube: ${stage}`, percent: 50 + (percent / 2) })
        );
      }

      setStep('done');
    } catch (err: any) {
      alert(`Failed to perform quarantine: ${err.message || 'Network error'}. Please try again.`);
      setStep('review');
    }
  };

  const handleSpotifyLogin = async () => {
    storage.setItem('pre_auth_step', 'connect');
    storage.setItem('pre_auth_settings', JSON.stringify({ minAge, maxAge, removalSettings }));
    window.location.href = await getAuthUrl();
  };

  const handleGoogleLogin = async () => {
    storage.setItem('pre_auth_step', 'connect');
    storage.setItem('pre_auth_settings', JSON.stringify({ minAge, maxAge, removalSettings }));
    window.location.href = getGoogleAuthUrl();
  };

  const handleLogout = () => {
    setAccessToken(null);
    setYtAccessToken(null);
    storage.removeItem('spotify_access_token');
    storage.removeItem('youtube_access_token');
    setStep('connect');
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

  // Sync URL with privacy/help steps
  useEffect(() => {
    if (step === 'privacy') {
      window.history.pushState({ step: 'privacy' }, '', '/privacy');
    } else if (step === 'help') {
      window.history.pushState({ step: 'help' }, '', '/help');
    } else if (step === 'intro' && (window.location.pathname === '/privacy' || window.location.pathname === '/help')) {
      window.history.pushState({ step: 'intro' }, '', '/');
    }
  }, [step]);


  return (
    <div className="container animate-fade-in" style={{ position: 'relative' }}>
      <div className="hero-glow" />

      <header style={{ textAlign: 'center', marginBottom: '4rem', marginTop: '2rem' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 1rem', background: 'rgba(29, 185, 84, 0.1)', borderRadius: '100px', border: '1px solid rgba(29, 185, 84, 0.2)', marginBottom: '1.5rem' }}>
          <ShieldCheck size={14} color="#1DB954" />
          <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#1DB954', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI-Powered Feed Restoration</span>
        </div>
        <h1 className="text-gradient" style={{ fontSize: 'clamp(2.5rem, 8vw, 4.5rem)', lineHeight: '1', marginBottom: '1rem' }}>unKidMyFeed</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: 'clamp(1rem, 3vw, 1.4rem)', fontWeight: '500', maxWidth: '600px', margin: '0 auto' }}>
          Reclaim your algorithm from the sandbox. Bring your <span style={{ color: 'white' }}>true taste</span> back.
        </p>
      </header>

      <main className="glass" style={{ padding: '0', maxWidth: '900px', margin: '0 auto', position: 'relative', overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', height: '350px', marginBottom: '2rem', overflow: 'hidden' }}>
                <img
                  src="hero.png"
                  alt="Pure Music Experience"
                  className="animate-float"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scale(1.1)' }}
                />
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 60%, rgba(2, 2, 2, 0.8) 100%)' }} />
              </div>

              <div style={{ padding: '0 3rem 3.5rem' }}>
                <h2 style={{ fontSize: '2.2rem', marginBottom: '1.2rem', fontWeight: '900' }}>Miss the <span style={{ color: '#1DB954' }}>old you</span>?</h2>
                <p style={{ marginBottom: '2.5rem', color: 'var(--text-secondary)', lineHeight: '1.8', fontSize: '1.1rem', maxWidth: '500px', margin: '0 auto 2.5rem' }}>
                  Your libraries have been hijacked by kids' content. We scan, identify, and quarantine the noise so your algorithm can focus on you again.
                </p>
                <button
                  onClick={() => setStep('setup')}
                  className="btn-glow"
                  style={{ padding: '1.2rem 3.5rem', borderRadius: '100px', background: 'white', color: 'black', fontSize: '1.1rem', fontWeight: '800', boxShadow: '0 10px 30px rgba(255,255,255,0.1)' }}
                >
                  Reclaim My Feed <ChevronRight size={20} style={{ verticalAlign: 'middle', marginLeft: '0.5rem' }} />
                </button>

                <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginTop: '3rem', opacity: 0.4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <ShieldCheck size={16} /> <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>SAFE & SECURE</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: accessToken ? '#1DB954' : 'inherit' }}>
                    <Music size={16} /> <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>SPOTIFY READY</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: ytAccessToken ? '#FF0000' : 'inherit' }}>
                    <Youtube size={16} /> <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>YOUTUBE READY</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ padding: '2.5rem' }}>
              <h2 style={{ fontSize: '1.8rem', marginBottom: '2rem' }}>Configure Cleanup</h2>
              <div style={{ marginBottom: '2.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <label style={{ color: 'var(--text-secondary)', fontWeight: 'bold' }}>Target Ages:</label>
                  <span style={{ color: '#1DB954', fontWeight: 'bold' }}>{minAge} — {maxAge}</span>
                </div>

                <div style={{ position: 'relative', height: '40px', display: 'flex', alignItems: 'center', margin: '1rem 0' }}>
                  {/* Track background */}
                  <div style={{ position: 'absolute', width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }} />

                  {/* Active range track */}
                  <div style={{
                    position: 'absolute',
                    left: `${(minAge / 20) * 100}%`,
                    width: `${((maxAge - minAge) / 20) * 100}%`,
                    height: '6px',
                    background: '#1DB954',
                    borderRadius: '3px'
                  }} />

                  {/* Invisible sliders for interaction */}
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={minAge}
                    onChange={(e) => setMinAge(Math.min(maxAge - 1, parseInt(e.target.value)))}
                    style={{
                      position: 'absolute',
                      width: '100%',
                      pointerEvents: 'none',
                      WebkitAppearance: 'none',
                      background: 'none'
                    }}
                    className="dual-range-input min"
                  />
                  <input
                    type="range"
                    min="0"
                    max="20"
                    value={maxAge}
                    onChange={(e) => setMaxAge(Math.max(minAge + 1, parseInt(e.target.value)))}
                    style={{
                      position: 'absolute',
                      width: '100%',
                      pointerEvents: 'none',
                      WebkitAppearance: 'none',
                      background: 'none'
                    }}
                    className="dual-range-input max"
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.3)', fontSize: '0.7rem' }}>
                  <span>0y</span>
                  <span>5y</span>
                  <span>10y</span>
                  <span>15y</span>
                  <span>20y</span>
                </div>
              </div>

              <div style={{ marginBottom: '2rem' }}>
                <label style={{ display: 'block', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>What to Clean:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  {[
                    { key: 'favorites', label: 'Un-like Songs (Favorites)', icon: <Music size={18} /> },
                    { key: 'createdPlaylists', label: 'My Created Playlists', icon: <User size={18} /> },
                    { key: 'collaborativePlaylists', label: 'My Collaborative Playlists', icon: <Users size={18} /> }
                  ].map(s => (
                    <div key={s.key} onClick={() => setRemovalSettings({ ...removalSettings, [s.key]: !(removalSettings as any)[s.key] })} style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '0.8rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                      {(removalSettings as any)[s.key] ? <CheckSquare size={20} color="#1DB954" /> : <Square size={20} color="gray" />}
                      {s.icon} <span>{s.label}</span>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', lineHeight: '1.5', padding: '0.8rem', background: 'rgba(29, 185, 84, 0.05)', borderRadius: '8px', borderLeft: '3px solid #1DB954' }}>
                  <strong style={{ color: '#1DB954' }}>Note:</strong> History and Top Picks cannot be deleted via Spotify's API. Removing tracks from your Favorites and Playlists will naturally update your algorithm over time.
                </p>
              </div>
              <button onClick={() => setStep('connect')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold' }}>Continue to Connect</button>
            </motion.div>
          )}

          {step === 'connect' && (
            <motion.div key="connect" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ textAlign: 'center', padding: '2.5rem' }}>
              <h2 style={{ marginBottom: '2rem' }}>Connect Your Sources</h2>

              {/* Mobile debugging info */}
              {!accessToken && (
                <div style={{ marginBottom: '1rem', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)' }}>
                  💡 Mobile tip: Use Safari/Chrome browser for best results
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="glass" style={{ padding: '2rem' }}>
                  <Music size={40} color="#1DB954" style={{ margin: '0 auto 1rem' }} />
                  <h3>Spotify</h3>
                  {accessToken ? (
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ background: 'rgba(29, 185, 84, 0.1)', color: '#1DB954', padding: '0.8rem', borderRadius: '100px', fontSize: '0.9rem', fontWeight: 'bold' }}>✓ Connected</div>
                      <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: 'none', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>Logout</button>
                    </div>
                  ) : (
                    <button onClick={handleSpotifyLogin} style={{ marginTop: '1rem', width: '100%', background: '#1DB954', color: 'white', padding: '0.8rem', borderRadius: '100px', fontWeight: 'bold' }}>
                      Connect
                    </button>
                  )}
                </div>
                <div className="glass" style={{ padding: '2rem' }}>
                  <Youtube size={40} color="#FF0000" style={{ margin: '0 auto 1rem' }} />
                  <h3>YouTube</h3>
                  {ytAccessToken ? (
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ background: 'rgba(255, 0, 0, 0.1)', color: '#FF0000', padding: '0.8rem', borderRadius: '100px', fontSize: '0.9rem', fontWeight: 'bold' }}>✓ Connected</div>
                      <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.5)', border: 'none', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>Logout</button>
                    </div>
                  ) : (
                    <button onClick={handleGoogleLogin} style={{ marginTop: '1rem', width: '100', background: '#FF0000', color: 'white', padding: '0.8rem', borderRadius: '100px', fontWeight: 'bold' }}>
                      Connect
                    </button>
                  )}
                </div>
              </div>

              <button disabled={!accessToken && !ytAccessToken} onClick={() => setStep('scan')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: (accessToken || ytAccessToken) ? 'white' : '#333', color: (accessToken || ytAccessToken) ? 'black' : 'gray' }}>Run Scan</button>
            </motion.div>
          )}

          {step === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center', padding: '3rem' }}>
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
            <motion.div key="result" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} style={{ padding: '2.5rem' }}>
              <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                <h3 style={{ color: totalPollutedItems === 0 ? '#1DB954' : '#FF0000', fontSize: '1.5rem' }}>
                  {totalPollutedItems === 0 ? '🎉 Clean Profile!' : `${totalPollutedItems} Polluted Items Found`}
                </h3>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {totalPollutedItems === 0
                    ? `Your profile is clean! No youth content detected in ${scannedCount + ytScannedCount} analyzed items.`
                    : `Analyzed ${scannedCount + ytScannedCount} items from your connected accounts`
                  }
                </p>
              </div>

              {totalPollutedItems > 0 ? (
                <>
                  <div style={{ maxHeight: '450px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                    {/* Combined Spotify and YouTube Results */}
                    {Object.entries({
                      Spotify: pollutedTracks,
                      YouTube: pollutedVideos
                    }).map(([sourceType, items]) => items.length > 0 && (
                      <div key={sourceType} style={{ marginBottom: '2rem' }}>
                        <h4 style={{
                          fontSize: '1rem',
                          color: sourceType === 'Spotify' ? '#1DB954' : '#FF0000',
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                          marginBottom: '1rem',
                          borderBottom: '1px solid rgba(255,255,255,0.1)',
                          paddingBottom: '0.5rem',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {sourceType === 'Spotify' ? <Music size={16} /> : <Youtube size={16} />}
                            <span>{sourceType}</span>
                          </div>
                          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{items.length} items found</span>
                        </h4>
                        {items.slice(0, 50).map((t, i) => {
                          const imageUrl = sourceType === 'YouTube'
                            ? (t as PollutedVideo).thumbnails?.default?.url
                            : (t as PollutedItem).album?.images[0]?.url;

                          return (
                            <div key={i} className="polluted-item" style={{ background: 'none', border: 'none', padding: '0.4rem 0' }}>
                              <img src={imageUrl} alt="" style={{ width: 32, height: 32, borderRadius: 4 }} />
                              <div style={{ flex: 1 }}>
                                <p style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{t.name}</p>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                  <p style={{ fontSize: '0.7rem', color: '#FF0000' }}>{t.reason}</p>
                                  <p style={{ fontSize: '0.6rem', opacity: 0.4 }}>{(t as any).source}</p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {items.length > 50 && (
                          <p style={{ fontSize: '0.7rem', color: 'gray', textAlign: 'center', marginTop: '0.5rem' }}>+ {items.length - 50} more items recorded</p>
                        )}
                      </div>
                    ))}
                  </div>

                  <button onClick={() => setStep('payment')} style={{ width: '100%', padding: '1.2rem', marginTop: '2rem', borderRadius: '12px', background: 'linear-gradient(45deg, #1DB954, #FF0000)', color: 'white', fontWeight: 'bold' }}>
                    Purge for $5
                  </button>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(29, 185, 84, 0.05)', borderRadius: '12px', border: '1px solid rgba(29, 185, 84, 0.2)' }}>
                  <ShieldCheck size={80} color="#1DB954" style={{ margin: '0 auto 2rem' }} />
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem', lineHeight: '1.6' }}>
                    Your {removalSettings.favorites && removalSettings.createdPlaylists && removalSettings.collaborativePlaylists
                      ? 'favorites and playlists are'
                      : removalSettings.favorites
                        ? 'favorites are'
                        : 'playlists are'} free from detected youth content for ages {minAge}–{maxAge}.
                    Keep enjoying your music!
                  </p>
                  <button onClick={() => setStep('setup')} style={{ padding: '1rem 2rem', borderRadius: '100px', background: 'rgba(29, 185, 84, 0.1)', color: '#1DB954', border: '1px solid #1DB954', fontWeight: 'bold', cursor: 'pointer' }}>
                    Run Another Scan
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {step === 'payment' && (
            <motion.div key="payment" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} style={{ textAlign: 'center', padding: '2.5rem' }}>
              <CreditCard size={64} style={{ marginBottom: '2rem', color: '#1DB954' }} />
              <h2>Ready to Purge</h2>
              <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)' }}>Restore your algorithm by isolating youth content.</p>
              <button onClick={() => setStep('review')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold' }}>Pay via Stripe</button>
            </motion.div>
          )}

          {step === 'review' && (
            <motion.div key="review" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} style={{ padding: '2.5rem' }}>
              <h3 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Final Item Selection</h3>
              <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '2rem', fontSize: '0.9rem' }}>Uncheck any items you want to keep in your profile.</p>

              <div style={{ maxHeight: '450px', overflowY: 'auto', paddingRight: '1rem' }}>
                {/* Spotify Artists */}
                {tracksByArtist.length > 0 && <h4 style={{ color: '#1DB954', fontSize: '0.8rem', textTransform: 'uppercase', marginBottom: '1rem' }}>Spotify Artists</h4>}
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

                {/* YouTube Channels/Videos */}
                {pollutedVideos.length > 0 && <h4 style={{ color: '#FF0000', fontSize: '0.8rem', textTransform: 'uppercase', marginTop: '2rem', marginBottom: '1rem' }}>YouTube Content</h4>}
                {pollutedVideos.map(video => (
                  <div key={video.id} onClick={() => {
                    const next = new Set(selectedVideoIds);
                    if (next.has(video.id)) next.delete(video.id);
                    else next.add(video.id);
                    setSelectedVideoIds(next);
                  }} style={{ marginBottom: '0.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', padding: '1rem', cursor: 'pointer' }}>
                    {selectedVideoIds.has(video.id) ? <CheckSquare size={20} color="#FF0000" /> : <Square size={20} color="gray" />}
                    <img src={video.thumbnails.default.url} style={{ width: 40, height: 30, objectFit: 'cover', borderRadius: 4, marginLeft: '1rem' }} />
                    <div style={{ flex: 1, marginLeft: '1rem' }}>
                      <p style={{ fontWeight: 'bold', fontSize: '0.85rem' }}>{video.title}</p>
                      <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{video.channelTitle} • {video.source}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleQuarantine}
                className="btn-glow"
                style={{ width: '100%', marginTop: '2rem', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold' }}
              >
                Perform Quarantine ({selectedTrackIds.size + selectedVideoIds.size} items)
              </button>
            </motion.div>
          )}

          {step === 'quarantine' && (
            <motion.div key="quarantine" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center', padding: '3rem' }}>
              <Loader2 className="animate-spin" size={64} style={{ margin: '0 auto 2rem', color: '#1DB954' }} />
              <h3>{scanProgress.stage || 'Moving items to quarantine...'}</h3>
              <p>{scanProgress.percent}% Complete</p>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} style={{ textAlign: 'center', padding: '2.5rem' }}>
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

          {step === 'privacy' && (
            <motion.div key="privacy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} style={{ padding: '2.5rem' }}>
              <button onClick={() => setStep('intro')} style={{ background: 'none', border: 'none', color: '#1DB954', cursor: 'pointer', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back
              </button>
              <h2 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Privacy Policy</h2>
              <div style={{ color: 'var(--text-secondary)', lineHeight: '1.6', textAlign: 'left' }}>
                <p style={{ marginBottom: '1rem' }}>Last updated: December 19, 2025</p>
                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>1. Information We Collect</h3>
                <p>unKidMyFeed only accesses your Spotify and YouTube data after you provide explicit permission via OAuth. We analyze your library, playlists, subscriptions, and likes to identify content based on the age filters you specify.</p>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>2. How We Use Your Data</h3>
                <p>We use this access solely to:</p>
                <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
                  <li>Identify "kid-polluted" tracks and videos in your profiles.</li>
                  <li>Remove these items from your favorites, playlists, or likes as requested.</li>
                  <li>Unsubscribe from child-oriented YouTube channels.</li>
                  <li>Create "Quarantine" playlists for the removed items.</li>
                </ul>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>3. Data Storage</h3>
                <p>We do not store your library data, listening history, or personal information on our servers. All analysis happens in your browser and via direct API calls to Spotify/Google. Your access tokens are stored locally on your device in your browser's storage.</p>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>4. Security</h3>
                <p>We use industry-standard OAuth2 protocols for authentication. We never see or store your Spotify/Google passwords.</p>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>5. Contact Us</h3>
                <p>If you have any questions about this Privacy Policy, please contact us at: <a href="mailto:unkid@thelaughingbag.com" style={{ color: '#1DB954' }}>unkid@thelaughingbag.com</a></p>
              </div>
            </motion.div>
          )}

          {step === 'help' && (
            <motion.div key="help" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} style={{ padding: '2.5rem' }}>
              <button onClick={() => setStep('intro')} style={{ background: 'none', border: 'none', color: '#1DB954', cursor: 'pointer', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back
              </button>
              <h2 style={{ fontSize: '2rem', marginBottom: '1.5rem' }}>Help / Support</h2>
              <div style={{ color: 'var(--text-secondary)', lineHeight: '1.6', textAlign: 'left' }}>
                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>What do we do with your access?</h3>
                <p>When you connect your Spotify or YouTube account, you are granting unKidMyFeed permission to read your library and modify your content. We use this to:</p>
                <ul style={{ marginLeft: '1.5rem', marginBottom: '1rem' }}>
                  <li><strong>Scan:</strong> We analyze your likes, playlists, and subscriptions to find content that matches kid-oriented filters.</li>
                  <li><strong>Clean:</strong> If you choose to "Purge," we automate the process of un-liking videos, un-subscribing from channels, and removing songs from your active library.</li>
                  <li><strong>Quarantine:</strong> We move these items to separate, dedicated "Quarantined" playlists so they aren't lost, but are removed from your active algorithmic influence.</li>
                </ul>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Why is YouTube different?</h3>
                <p>YouTube's algorithm is heavily driven by <strong>Watch History</strong>. While we can remove Likes and Subscriptions, Google's API does not allow external apps to delete items from your Watch History. To fully restore your YouTube feed, we recommend manually clearing your Watch History in the YouTube settings after our process is complete.</p>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Will this mess up my account?</h3>
                <p>No. We only touch the items you approve during the "Review" step. We never delete your account or change your profile settings. We only modify the library items (likes/playlists/subs) that you explicitly select for removal.</p>

                <h3 style={{ color: 'white', marginTop: '1.5rem', marginBottom: '0.5rem' }}>Need more help?</h3>
                <p>If you encounter any issues or have specific questions about how unKidMyFeed works, please reach out to our support team at: <a href="mailto:unkid@thelaughingbag.com" style={{ color: '#1DB954' }}>unkid@thelaughingbag.com</a></p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {step !== 'scan' && step !== 'quarantine' && (
        <footer style={{ marginTop: '3rem', padding: '2rem', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '1rem' }}>
            <button onClick={() => setStep('help')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.9rem' }}>Help & Support</button>
            <button onClick={() => setStep('privacy')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.9rem' }}>Privacy Policy</button>
          </div>
          <p style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.8rem' }}>&copy; 2025 unKidMyFeed. All rights reserved.</p>
        </footer>
      )}

      <style>{`
        .polluted-item { display: flex; align-items: center; gap: 1rem; padding: 0.8rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(255,255,255,0.05); }
        .animate-spin { animation: spin 2s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .dual-range-input {
          cursor: pointer;
        }
        .dual-range-input::-webkit-slider-thumb {
          pointer-events: auto;
          -webkit-appearance: none;
          height: 18px;
          width: 18px;
          border-radius: 50%;
          background: white;
          border: 2px solid #1DB954;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
          margin-top: -6px; /* Specific adjustment for dual display */
        }
        .dual-range-input.min::-webkit-slider-thumb {
          z-index: 2;
        }
        .dual-range-input.max::-webkit-slider-thumb {
          z-index: 1;
        }
      `}</style>
    </div>
  );
};

export default App;
