import React, { useState, useEffect } from 'react';
import { Music, Trash2, Zap, CreditCard, ChevronRight, ShieldCheck, CheckSquare, Square, Youtube } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PollutedItem } from './lib/spotify';
import type { PollutedVideo } from './lib/youtube';

type Step = 'intro' | 'setup' | 'connect' | 'scan' | 'result' | 'payment' | 'done';

const App: React.FC = () => {
  const [step, setStep] = useState<Step>('intro');
  const [minAge, setMinAge] = useState<number>(0);
  const [maxAge, setMaxAge] = useState<number>(10);
  const [accessToken, setAccessToken] = useState<string | null>(localStorage.getItem('spotify_access_token'));
  const [scannedCount, setScannedCount] = useState<number>(0);
  const [auditedFavorites, setAuditedFavorites] = useState<any[]>([]);
  const [showAudit, setShowAudit] = useState(false);

  // Removal Options
  const [removalSettings, setRemovalSettings] = useState({
    playlists: true,
    favorites: true,
    history: true
  });

  useEffect(() => {
    const handleAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      const error = urlParams.get('error');

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
          alert('Spotify Authentication failed.');
        }
      } else if (error) {
        alert('Spotify access denied.');
      }
    };
    handleAuthCallback();
  }, []);

  const [pollutedTracks, setPollutedTracks] = useState<PollutedItem[]>([]);
  const [pollutedVideos, setPollutedVideos] = useState<PollutedVideo[]>([]);
  const totalPollutedItems = pollutedTracks.length + pollutedVideos.length;

  const nextStep = () => {
    if (step === 'intro') setStep('setup');
    else if (step === 'setup') setStep('connect');
    else if (step === 'connect') setStep('scan');
    else if (step === 'result') setStep('payment');
  };

  useEffect(() => {
    const runRealScan = async () => {
      if (step === 'scan') {
        if (!accessToken) {
          setStep('connect');
          return;
        }

        try {
          const { performFullScan } = await import('./lib/spotify');
          const { polluted, scannedCount: totalScanned, favoritesAudit } = await performFullScan(accessToken, minAge, maxAge, removalSettings);

          setPollutedTracks(polluted);
          setScannedCount(totalScanned);
          setAuditedFavorites(favoritesAudit || []);
          setPollutedVideos([]);
          setStep('result');
        } catch (err) {
          console.error('Real scan failed:', err);
          setAccessToken(null);
          localStorage.removeItem('spotify_access_token');
          setStep('connect');
        }
      }
    };
    runRealScan();
  }, [step, accessToken, minAge, maxAge]);

  const handleSpotifyLogin = async () => {
    const { getAuthUrl } = await import('./lib/spotify');
    const authUrl = await getAuthUrl();
    window.location.href = authUrl;
  };

  const getActiveScopes = () => {
    const scopeMapping = [
      { key: 'toddler', min: 0, max: 3, label: 'Toddler' },
      { key: 'kid', min: 4, max: 7, label: 'Kid' },
      { key: 'preteen', min: 8, max: 12, label: 'Pre-Teen' },
      { key: 'teen', min: 13, max: 100, label: 'Teen' }
    ];
    return scopeMapping.filter(s => (minAge <= s.max && maxAge >= s.min));
  };

  return (
    <div className="container animate-fade-in">
      <header style={{ textAlign: 'center', marginBottom: '2.5rem', marginTop: '1.5rem' }}>
        <img
          src="logo.png"
          alt="unKidMyFeed Logo"
          style={{ width: '120px', height: '120px', marginBottom: '1rem', filter: 'drop-shadow(0 0 20px rgba(29, 185, 84, 0.3))' }}
        />
        <h1 style={{
          fontSize: '2.8rem',
          marginBottom: '0.2rem',
          background: 'linear-gradient(to right, #1DB954, #FFFFFF)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          letterSpacing: '-0.05em',
          fontWeight: '800'
        }}>
          unKidMyFeed
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', fontWeight: '500' }}>
          Bring your true taste back.
        </p>
      </header>

      <main className="glass" style={{ padding: '2.5rem', maxWidth: '800px', margin: '0 auto', position: 'relative' }}>
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: '2.2rem', marginBottom: '1.2rem', color: 'white' }}>Miss the old you?</h2>
              <p style={{ marginBottom: '2.5rem', color: 'var(--text-secondary)', lineHeight: '1.8', fontSize: '1.1rem' }}>
                Your Spotify suggestions don't have to be based on <span style={{ color: '#1DB954', fontWeight: 'bold' }}>Cocomelon</span>, <span style={{ color: '#1DB954', fontWeight: 'bold' }}>Blippi</span>, or <span style={{ color: '#1DB954', fontWeight: 'bold' }}>Kidz Bop</span> anymore. <br />
                We help you reclaim your music profile by identifying and isolating the youth influence from your core algorithm.
              </p>
              <button onClick={nextStep} style={{ padding: '1.2rem 3.5rem', fontSize: '1.1rem', borderRadius: '100px', background: 'white', color: 'black', fontWeight: '800', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                Reclaim My Feed <ChevronRight size={20} style={{ verticalAlign: 'middle' }} />
              </button>
            </motion.div>
          )}

          {step === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
              <h2 style={{ fontSize: '1.8rem', marginBottom: '2rem' }}>Configure Search Range</h2>

              <div style={{ marginBottom: '3.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <label style={{ color: 'var(--text-secondary)', fontWeight: 'bold' }}>Select Age Demographic:</label>
                  <span style={{ color: '#1DB954', fontWeight: 'bold', fontSize: '1.2rem' }}>Ages {minAge} — {maxAge}</span>
                </div>

                <div style={{ position: 'relative', height: '40px', padding: '10px 0' }}>
                  <div style={{ position: 'absolute', height: '6px', width: '100%', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', top: '17px' }}></div>
                  <div style={{
                    position: 'absolute',
                    height: '6px',
                    background: '#1DB954',
                    borderRadius: '3px',
                    top: '17px',
                    left: `${(minAge / 18) * 100}%`,
                    right: `${100 - (maxAge / 18) * 100}%`
                  }}></div>
                  <input
                    type="range" min="0" max="18" value={minAge}
                    onChange={(e) => setMinAge(Math.min(maxAge - 1, parseInt(e.target.value)))}
                    className="dual-range"
                    style={{ position: 'absolute', width: '100%', top: '0', pointerEvents: 'none', appearance: 'none', background: 'transparent' }}
                  />
                  <input
                    type="range" min="0" max="18" value={maxAge}
                    onChange={(e) => setMaxAge(Math.max(minAge + 1, parseInt(e.target.value)))}
                    className="dual-range"
                    style={{ position: 'absolute', width: '100%', top: '0', pointerEvents: 'none', appearance: 'none', background: 'transparent' }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  <span>Toddler</span>
                  <span>Kid</span>
                  <span>Pre-Teen</span>
                  <span>Teen</span>
                </div>

                <div style={{ marginTop: '2rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {getActiveScopes().map(scope => (
                    <span key={scope.key} style={{ padding: '0.4rem 1rem', background: 'rgba(29, 185, 84, 0.1)', color: '#1DB954', borderRadius: '100px', fontSize: '0.8rem', border: '1px solid rgba(29, 185, 84, 0.2)' }}>
                      {scope.label} Artists Included
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: '2.5rem' }}>
                <label style={{ display: 'block', marginBottom: '1rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Cleanup Strategy:</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {[
                    { key: 'favorites', label: 'Un-like Songs from Flagged Artists' },
                    { key: 'playlists', label: 'Purge Artists from my Playlists' },
                    { key: 'history', label: 'Exclude Flagged Artists from Taste Profile' }
                  ].map(setting => (
                    <div
                      key={setting.key}
                      onClick={() => setRemovalSettings({ ...removalSettings, [setting.key]: !(removalSettings as any)[setting.key] })}
                      style={{ display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', padding: '0.5rem' }}
                    >
                      {(removalSettings as any)[setting.key] ? <CheckSquare size={20} color="#1DB954" /> : <Square size={20} color="gray" />}
                      <span style={{ color: (removalSettings as any)[setting.key] ? 'white' : 'gray' }}>{setting.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button onClick={nextStep} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold' }}>
                Confirm Identification Range
              </button>
            </motion.div>
          )}

          {step === 'connect' && (
            <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h2 style={{ fontSize: '1.8rem', marginBottom: '2rem', textAlign: 'center' }}>Connect Sources</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                <div className="glass" style={{ padding: '2rem', textAlign: 'center', borderColor: '#1DB954' }}>
                  <Music size={48} color="#1DB954" style={{ margin: '0 auto 1rem' }} />
                  <h3>Spotify</h3>
                  <button onClick={handleSpotifyLogin} style={{ marginTop: '1.5rem', padding: '0.8rem 2rem', borderRadius: '100px', background: '#1DB954', color: 'white', fontWeight: 'bold', width: '100%' }}>
                    {accessToken ? 'Connected' : 'Login'}
                  </button>
                </div>
                <div className="glass" style={{ padding: '2rem', textAlign: 'center', background: 'rgba(255,255,255,0.02)', position: 'relative' }}>
                  <Youtube size={48} color="#666" style={{ margin: '0 auto 1rem' }} />
                  <h3 style={{ color: '#666' }}>YouTube</h3>
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%) rotate(-15deg)',
                    background: '#FF0000',
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    textTransform: 'uppercase'
                  }}>Coming Soon</div>
                  <button disabled style={{ marginTop: '1.5rem', padding: '0.8rem 2rem', borderRadius: '100px', background: '#333', color: '#666', width: '100%' }}>
                    Disabled
                  </button>
                </div>
              </div>
              <button
                onClick={nextStep}
                disabled={!accessToken}
                style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: accessToken ? 'white' : '#333', color: accessToken ? 'black' : 'gray', fontWeight: 'bold' }}
              >
                Reclaim My History
              </button>
            </motion.div>
          )}

          {step === 'scan' && (
            <motion.div key="scan" style={{ textAlign: 'center', padding: '4rem' }}>
              <Zap size={64} className="animate-pulse" color="#1DB954" style={{ marginBottom: '2rem' }} />
              <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>Bringing the old you back...</h2>
              <p style={{ color: 'var(--text-secondary)' }}>Comparing your history against our curated youth artist database.</p>
            </motion.div>
          )}

          {step === 'result' && (
            <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="glass" style={{ padding: '2rem', marginBottom: '2rem', background: 'rgba(255, 0, 0, 0.05)', textAlign: 'center' }}>
                <h3 style={{ color: '#FF0000', marginBottom: '1rem' }}>ALGORITHM CLEANUP REPORT</h3>
                <div style={{ position: 'relative', height: '100px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (totalPollutedItems / Math.max(1, scannedCount)) * 100)}%` }}
                    style={{ height: '24px', background: 'linear-gradient(90deg, #1DB954, #FF0000)', borderRadius: '12px' }}
                  />
                  <span style={{ position: 'absolute', fontWeight: '900', fontSize: '2rem' }}>
                    {scannedCount > 0 ? Math.round((totalPollutedItems / scannedCount) * 100) : 0}% OVERLAP
                  </span>
                </div>
                <p style={{ marginTop: '1rem', color: 'var(--text-secondary)' }}>We identified {totalPollutedItems} items that are masking your true taste.</p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <button
                  onClick={() => setShowAudit(false)}
                  style={{ padding: '0.5rem 0', fontSize: '0.8rem', color: !showAudit ? '#1DB954' : 'gray', background: 'none', border: 'none', borderBottom: !showAudit ? '2px solid #1DB954' : 'none', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  POLLUTED ITEMS
                </button>
                <button
                  onClick={() => setShowAudit(true)}
                  style={{ padding: '0.5rem 0', fontSize: '0.8rem', color: showAudit ? '#1DB954' : 'gray', background: 'none', border: 'none', borderBottom: showAudit ? '2px solid #1DB954' : 'none', fontWeight: 'bold', cursor: 'pointer' }}
                >
                  FAVORITES AUDIT
                </button>
              </div>

              <div style={{ maxHeight: '350px', overflowY: 'auto', marginBottom: '2rem', paddingRight: '0.5rem' }}>
                {!showAudit ? (
                  pollutedTracks.map((item, i) => (
                    <div key={i} className="polluted-item">
                      <img src={item.album?.images[0]?.url} alt="art" />
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{item.name}</p>
                        <p style={{ fontSize: '0.7rem', color: '#FF0000' }}>{item.reason} — <span style={{ color: '#1DB954' }}>{item.source}</span></p>
                      </div>
                      <Trash2 size={16} color="#FF0000" />
                    </div>
                  ))
                ) : (
                  auditedFavorites.map((item, i) => (
                    <div key={i} className="polluted-item" style={{ borderColor: 'rgba(255,255,255,0.05)' }}>
                      <img src={item.album?.images[0]?.url} alt="art" />
                      <div style={{ flex: 1 }}>
                        <p style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{item.name}</p>
                        <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{item.artists.map((a: any) => a.name).join(', ')}</p>
                      </div>
                      <ShieldCheck size={16} color="#1DB954" />
                    </div>
                  ))
                )}
              </div>

              <button onClick={nextStep} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'linear-gradient(45deg, #1DB954, #FF0000)', color: 'white', fontWeight: 'bold' }}>
                Purge All for $5
              </button>
            </motion.div>
          )}

          {step === 'payment' && (
            <motion.div key="payment" style={{ textAlign: 'center' }}>
              <CreditCard size={64} style={{ marginBottom: '2rem' }} />
              <h2>Finalize the Reclaim</h2>
              <p style={{ marginBottom: '2rem', color: 'var(--text-secondary)' }}>We'll identify and isolate all artists in the select age demographics.</p>
              <button onClick={() => setStep('done')} style={{ width: '100%', padding: '1.2rem', borderRadius: '12px', background: 'white', color: 'black', fontWeight: 'bold', marginBottom: '1rem' }}>Pay via Stripe</button>
              <button onClick={() => setStep('done')} style={{ width: '100%', background: 'transparent', color: 'var(--text-secondary)', textDecoration: 'underline' }}>Free Dry Run (Isolated)</button>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" style={{ textAlign: 'center' }}>
              <ShieldCheck size={80} color="#1DB954" style={{ margin: '3rem auto' }} />
              <h2>Your Feed is Yours Again.</h2>
              <p style={{ color: 'var(--text-secondary)' }}>We have isolated the youth influence from your core algorithm.</p>
              <button onClick={() => setStep('intro')} style={{ marginTop: '2rem', color: '#1DB954', textDecoration: 'underline' }}>Start Over</button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer style={{ textAlign: 'center', marginTop: '4rem', color: 'var(--text-secondary)', fontSize: '0.7rem' }}>
        unKidMyFeed v2.7 • Reclaim Your True Taste
      </footer>

      {/* Styles for the dual range slider */}
      <style>{`
        .dual-range {
          pointer-events: none;
        }
        .dual-range::-webkit-slider-thumb {
          pointer-events: auto;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #1DB954;
          cursor: pointer;
          border: 2px solid white;
        }
        .polluted-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: rgba(255,255,255,0.05);
          border-radius: 12px;
          margin-bottom: 0.8rem;
          border: 1px solid var(--glass-border);
        }
        .polluted-item img {
          width: 50px;
          height: 50px;
          border-radius: 8px;
          object-fit: cover;
        }
      `}</style>
    </div>
  );
};

export default App;
