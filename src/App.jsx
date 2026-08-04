import React, { useState, useEffect, useMemo } from 'react';
import WordList from './components/WordList';
import Flashcards from './components/Flashcards';
import ClozePractice from './components/ClozePractice';
import ReorderPractice from './components/ReorderPractice';
import SentenceCreator from './components/SentenceCreator';
import DictationPractice from './components/DictationPractice';
import MyList from './components/MyList';
import Stats from './components/Stats';
import './index.css';

function App() {
  const [vocabData, setVocabData] = useState({ nouns: [], verbs: [], adjectives: [], connectors: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('explorer');
  const [reviews, setReviews] = useState([]);
  const [fontScale, setFontScale] = useState(() => {
    const saved = localStorage.getItem('b1_font_scale');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [selectedVoiceName, setSelectedVoiceName] = useState(() => {
    return localStorage.getItem('b1_selected_voice') || '';
  });
  const [voices, setVoices] = useState([]);
  const [speechRate, setSpeechRate] = useState(() => {
    const saved = localStorage.getItem('b1_speech_rate');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [speechPitch, setSpeechPitch] = useState(() => {
    const saved = localStorage.getItem('b1_speech_pitch');
    return saved ? parseFloat(saved) : 1.0;
  });
  const [showSpeechSettings, setShowSpeechSettings] = useState(false);
  const [myList, setMyList] = useState(() => {
    const saved = localStorage.getItem('b1_my_list');
    return saved ? JSON.parse(saved) : [];
  });

  const [syncCode, setSyncCode] = useState(() => localStorage.getItem('b1_sync_code') || '');
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'syncing' | 'success' | 'error'
  const [syncError, setSyncError] = useState('');

  const syncWithCloud = async (codeVal, forceList) => {
    if (!codeVal || codeVal.trim().length < 3) return;
    setSyncStatus('syncing');
    try {
      const cleanCode = codeVal.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const res = await fetch(`/api/sync?code=${cleanCode}&t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (!res.ok) throw new Error(await res.text());
      const cloudList = await res.json();
      
      // Merge local and cloud lists without duplicates
      const listToUse = forceList || myList;
      const mergedMap = new Map();
      
      if (Array.isArray(cloudList)) {
        cloudList.forEach(item => {
          if (item && item.word) mergedMap.set(item.word.toLowerCase(), item);
        });
      }
      
      if (Array.isArray(listToUse)) {
        listToUse.forEach(item => {
          if (item && item.word) mergedMap.set(item.word.toLowerCase(), item);
        });
      }
      
      const mergedList = Array.from(mergedMap.values());
      setMyList(mergedList);
      
      // Upload merged list back to cloud
      const postRes = await fetch(`/api/sync?code=${cleanCode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedList),
        cache: 'no-store'
      });
      if (!postRes.ok) throw new Error(await postRes.text());
      
      setSyncStatus('success');
      setSyncError('');
    } catch (err) {
      console.error("Cloud Sync Error:", err);
      setSyncStatus('error');
      setSyncError(err.message || 'Sync failed');
    }
  };

  // Initial cloud sync on load
  useEffect(() => {
    if (syncCode) {
      syncWithCloud(syncCode);
    }
  }, []);

  // Save list to local storage and sync to cloud if code is set
  useEffect(() => {
    localStorage.setItem('b1_my_list', JSON.stringify(myList));
    
    if (syncCode && syncStatus !== 'syncing') {
      const cleanCode = syncCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
      const uploadList = async () => {
        try {
          await fetch(`/api/sync?code=${cleanCode}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(myList),
            cache: 'no-store'
          });
        } catch (err) {
          console.error("Failed to auto-upload to cloud:", err);
        }
      };
      uploadList();
    }
  }, [myList, syncCode]);

  const handleToggleMyList = (wordItem) => {
    const exists = myList.some(item => item.word.toLowerCase() === wordItem.word.toLowerCase());
    if (exists) {
      setMyList(myList.filter(item => item.word.toLowerCase() !== wordItem.word.toLowerCase()));
    } else {
      setMyList([...myList, {
        word: wordItem.word,
        meaning: wordItem.meaning,
        category: wordItem.category || 'nouns',
        conjugation: wordItem.conjugation || '',
        examples: wordItem.examples || [],
        isCustom: wordItem.isCustom || false
      }]);
    }
  };

  const handleImportMyList = (importedList) => {
    setMyList(prevList => {
      const mergedMap = new Map();
      prevList.forEach(item => mergedMap.set(item.word.toLowerCase(), item));
      importedList.forEach(item => {
        if (item && item.word) {
          mergedMap.set(item.word.toLowerCase(), {
            word: item.word,
            meaning: item.meaning || '',
            category: item.category || 'nouns',
            conjugation: item.conjugation || '',
            examples: item.examples || [],
            isCustom: item.isCustom || false
          });
        }
      });
      return Array.from(mergedMap.values());
    });
  };

  // Double-click selection popover states
  const [doubleClickedText, setDoubleClickedText] = useState('');
  const [doubleClickPosition, setDoubleClickPosition] = useState({ x: 0, y: 0 });
  const [quickMeaning, setQuickMeaning] = useState('');
  const [quickCategory, setQuickCategory] = useState('nouns');

  // Reset fields on new double click selection
  useEffect(() => {
    if (doubleClickedText) {
      setQuickMeaning('');
      setQuickCategory('nouns');
    }
  }, [doubleClickedText]);

  // Global listener for double clicks to select words
  useEffect(() => {
    const handleDblClick = (e) => {
      // Ignore double-clicks inside input, select, textarea elements
      const targetTag = e.target.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') {
        return;
      }
      
      const selection = window.getSelection().toString().trim();
      // Allow only valid short word/phrases (1-3 words, no numbers, length > 1)
      if (selection && selection.length > 1 && !/\d/.test(selection) && selection.split(/\s+/).length <= 3) {
        setDoubleClickedText(selection);
        setDoubleClickPosition({ x: e.clientX, y: e.clientY });
      }
    };
    window.addEventListener('dblclick', handleDblClick);
    return () => window.removeEventListener('dblclick', handleDblClick);
  }, []);

  // Global click outside listener to close the popup
  useEffect(() => {
    const handleClickOutside = (e) => {
      const popover = document.getElementById('double-click-popover');
      if (popover && !popover.contains(e.target)) {
        setDoubleClickedText('');
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Look up if double clicked word matches any official B1 vocabulary item
  const matchedWordInfo = useMemo(() => {
    if (!doubleClickedText) return null;
    const cleanQuery = doubleClickedText.toLowerCase().replace(/[^a-zäöüß]/g, '').trim();
    if (!cleanQuery) return null;

    const categories = ['nouns', 'verbs', 'adjectives', 'connectors'];
    for (let cat of categories) {
      const match = (vocabData[cat] || []).find(item => {
        // Strip out leading articles/reflexive markers for matches
        const cleanWord = item.word.toLowerCase()
          .replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
          .replace(/\(.*\)/g, '')
          .replace(/,.*$/, '')
          .trim();
        return cleanWord === cleanQuery || item.word.toLowerCase() === cleanQuery || cleanWord.includes(cleanQuery);
      });
      if (match) {
        return { ...match, category: cat };
      }
    }
    return null;
  }, [doubleClickedText, vocabData]);

  // Save custom word from popover
  const handleQuickSave = (e) => {
    e.preventDefault();
    if (!doubleClickedText.trim() || !quickMeaning.trim()) return;

    const customItem = {
      word: doubleClickedText.trim(),
      meaning: quickMeaning.trim(),
      category: quickCategory,
      conjugation: '',
      examples: [],
      isCustom: true
    };

    handleToggleMyList(customItem);

    setDoubleClickedText('');
    setQuickMeaning('');
    setQuickCategory('nouns');
  };

  useEffect(() => {
    localStorage.setItem('b1_font_scale', fontScale.toString());
  }, [fontScale]);

  useEffect(() => {
    const loadVoices = () => {
      if ('speechSynthesis' in window) {
        const allVoices = window.speechSynthesis.getVoices();
        const german = allVoices.filter(v => v.lang.startsWith('de') || v.lang.includes('DE'));
        setVoices(german);

        // Pick default if none selected
        if (german.length > 0 && !localStorage.getItem('b1_selected_voice')) {
          const preferred = german.find(v => v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('siri') || v.name.toLowerCase().includes('neural') || v.name.toLowerCase().includes('anna')) || german[0];
          setSelectedVoiceName(preferred.name);
          localStorage.setItem('b1_selected_voice', preferred.name);
        }
      }
    };
    loadVoices();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  useEffect(() => {
    if (selectedVoiceName) {
      localStorage.setItem('b1_selected_voice', selectedVoiceName);
    }
  }, [selectedVoiceName]);

  useEffect(() => {
    localStorage.setItem('b1_speech_rate', speechRate.toString());
  }, [speechRate]);

  useEffect(() => {
    localStorage.setItem('b1_speech_pitch', speechPitch.toString());
  }, [speechPitch]);

  // Expose global speech helper
  useEffect(() => {
    window.speakGerman = (text) => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Stop current speech instantly
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'de-DE';
        utterance.rate = speechRate;
        utterance.pitch = speechPitch;

        if (selectedVoiceName) {
          const allVoices = window.speechSynthesis.getVoices();
          const voice = allVoices.find(v => v.name === selectedVoiceName);
          if (voice) {
            utterance.voice = voice;
          }
        }
        window.speechSynthesis.speak(utterance);
      }
    };
  }, [selectedVoiceName, speechRate, speechPitch]);

  // Fetch vocabulary JSON dataset
  useEffect(() => {
    fetch('/b1_vocab_data.json?t=' + Date.now())
      .then(res => res.json())
      .then(data => {
        setVocabData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load vocabulary data:", err);
        setLoading(false);
      });
  }, []);

  // Load reviews from localStorage on initialization
  useEffect(() => {
    const savedReviews = localStorage.getItem('b1_dashboard_reviews');
    if (savedReviews) {
      try {
        setReviews(JSON.parse(savedReviews));
      } catch (e) {
        console.error("Failed to parse reviews from localStorage:", e);
      }
    }
  }, []);

  // Handle reviewing a word (updates state + persists in localStorage)
  const handleReviewWord = (word, category, rating) => {
    if (category === 'dictation-sentence') return; // Exclude sentence dictations from stats logs
    
    const newReview = {
      word,
      category,
      rating,
      timestamp: Date.now()
    };
    const updatedReviews = [...reviews, newReview];
    setReviews(updatedReviews);
    localStorage.setItem('b1_dashboard_reviews', JSON.stringify(updatedReviews));
  };

  // Reset all study stats
  const handleResetStats = () => {
    setReviews([]);
    localStorage.removeItem('b1_dashboard_reviews');
  };

  // Compute progress stats dynamically based on logs
  const computedStats = useMemo(() => {
    const uniqueReviewedWords = new Set();
    const lastRatingMap = {};

    // Sort chronologically so we get the latest rating
    const sortedReviews = [...reviews].sort((a, b) => a.timestamp - b.timestamp);
    sortedReviews.forEach(r => {
      uniqueReviewedWords.add(r.word);
      lastRatingMap[r.word] = r.rating;
    });

    const totalReviewed = uniqueReviewedWords.size;
    const masteryCount = Object.values(lastRatingMap).filter(rating => rating === 'easy').length;

    const categoryTotals = {
      nouns: vocabData.nouns?.length || 0,
      verbs: vocabData.verbs?.length || 0,
      adjectives: vocabData.adjectives?.length || 0,
      connectors: vocabData.connectors?.length || 0
    };

    const categoryReviewed = { nouns: 0, verbs: 0, adjectives: 0, connectors: 0 };

    const uniqueWordCategory = {};
    sortedReviews.forEach(r => {
      uniqueWordCategory[r.word] = r.category;
    });

    Object.entries(uniqueWordCategory).forEach(([word, category]) => {
      if (categoryReviewed[category] !== undefined) {
        categoryReviewed[category]++;
      }
    });

    const categoryProgress = {
      nouns: { reviewed: categoryReviewed.nouns, total: categoryTotals.nouns },
      verbs: { reviewed: categoryReviewed.verbs, total: categoryTotals.verbs },
      adjectives: { reviewed: categoryReviewed.adjectives, total: categoryTotals.adjectives },
      connectors: { reviewed: categoryReviewed.connectors, total: categoryTotals.connectors }
    };

    // Calculate streak
    let streak = 0;
    if (reviews.length > 0) {
      const uniqueDates = Array.from(new Set(
        reviews.map(r => new Date(r.timestamp).toDateString())
      )).map(d => new Date(d));

      uniqueDates.sort((a, b) => b.getTime() - a.getTime()); // Descending order

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (uniqueDates.length > 0) {
        const latestReviewDate = uniqueDates[0];
        latestReviewDate.setHours(0, 0, 0, 0);

        if (latestReviewDate.getTime() === today.getTime() || latestReviewDate.getTime() === yesterday.getTime()) {
          streak = 1;
          for (let i = 0; i < uniqueDates.length - 1; i++) {
            const current = new Date(uniqueDates[i]);
            current.setHours(0, 0, 0, 0);

            const prev = new Date(uniqueDates[i + 1]);
            prev.setHours(0, 0, 0, 0);

            const diffTime = Math.abs(current.getTime() - prev.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
              streak++;
            } else if (diffDays > 1) {
              break;
            }
          }
        }
      }
    }

    return {
      totalReviewed,
      masteryCount,
      categoryProgress,
      streak
    };
  }, [reviews, vocabData]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#090a0f',
        color: '#f3f4f6',
        fontSize: '20px',
        fontWeight: '600',
        fontFamily: 'sans-serif'
      }}>
        Initializing Deutsch B1 Dashboard...
      </div>
    );
  }

  return (
    <div className="app-container" style={{ zoom: fontScale }}>
      <header className="app-header">
        <div className="logo-section" style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div className="logo-badge">DE</div>
          </div>

          {/* Font Size controls */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '4px 10px',
            borderRadius: '12px',
            border: '1px solid var(--border-color)'
          }}>
            <button
              type="button"
              className="sound-btn"
              style={{ width: '26px', height: '26px', fontSize: '12px', background: 'rgba(255,255,255,0.05)', padding: 0, justifyContent: 'center', alignItems: 'center' }}
              onClick={() => setFontScale(prev => Math.max(0.7, prev - 0.1))}
              title="Decrease text size"
            >
              A-
            </button>
            <span style={{ fontSize: '12px', fontWeight: '700', minWidth: '34px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              {Math.round(fontScale * 100)}%
            </span>
            <button
              type="button"
              className="sound-btn"
              style={{ width: '26px', height: '26px', fontSize: '12px', background: 'rgba(255,255,255,0.05)', padding: 0, justifyContent: 'center', alignItems: 'center' }}
              onClick={() => setFontScale(prev => Math.min(1.5, prev + 0.1))}
              title="Increase text size"
            >
              A+
            </button>
          </div>

          {/* Voice selection & Speech Settings container */}
          {voices.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '4px 10px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                height: '36px'
              }}>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Voice:</span>
                <select
                  value={selectedVoiceName}
                  onChange={(e) => setSelectedVoiceName(e.target.value)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: '700',
                    outline: 'none',
                    cursor: 'pointer',
                    maxWidth: '120px'
                  }}
                >
                  {voices.map(v => (
                    <option key={v.name} value={v.name} style={{ background: '#090a0f', color: '#fff' }}>
                      {v.name.replace('Microsoft', '').replace('Google', 'Google 🌐').replace('Apple', 'Apple 🍎').trim()}
                    </option>
                  ))}
                </select>
              </div>

              {/* Settings Toggle button */}
              <button
                type="button"
                className="sound-btn"
                style={{
                  width: '36px',
                  height: '36px',
                  fontSize: '18px',
                  background: showSpeechSettings ? 'rgba(255,255,255,0.1)' : 'transparent',
                  padding: 0,
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
                onClick={() => setShowSpeechSettings(!showSpeechSettings)}
                title="Speech Settings (Speed & Pitch)"
              >
                ⚙️
              </button>

              {/* Speech settings popover dropdown */}
              {showSpeechSettings && (
                <div
                  className="glass-card"
                  style={{
                    position: 'absolute',
                    top: '44px',
                    right: '0',
                    zIndex: 1000,
                    width: '260px',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                    border: '1px solid var(--border-color)',
                    backdropFilter: 'blur(20px)',
                    textAlign: 'left'
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', borderBottom: '1px dashed var(--border-color)', paddingBottom: '6px', fontWeight: '700' }}>
                    🔊 Speech Parameters
                  </h4>

                  {/* Speed/Rate Slider */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span>Speed (Rate):</span>
                      <span style={{ fontWeight: '700', color: 'var(--color-noun)' }}>{speechRate}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={speechRate}
                      onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                      style={{ accentColor: 'var(--color-noun)', cursor: 'pointer', width: '100%' }}
                    />
                  </div>

                  {/* Pitch Slider */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)' }}>
                      <span>Pitch:</span>
                      <span style={{ fontWeight: '700', color: 'var(--color-verb)' }}>{speechPitch}x</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="1.5"
                      step="0.1"
                      value={speechPitch}
                      onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                      style={{ accentColor: 'var(--color-verb)', cursor: 'pointer', width: '100%' }}
                    />
                  </div>

                  <button
                    type="button"
                    className="nav-button"
                    style={{ fontSize: '11px', padding: '6px 12px', borderRadius: '8px', alignSelf: 'flex-end', minWidth: 'auto', background: 'rgba(255,255,255,0.05)' }}
                    onClick={() => { setSpeechRate(1.0); setSpeechPitch(1.0); }}
                  >
                    Reset Defaults
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <nav className="app-nav">
          <button
            className={`nav-button ${activeTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            📖 Word List
          </button>
          <button
            className={`nav-button ${activeTab === 'practice' ? 'active' : ''}`}
            onClick={() => setActiveTab('practice')}
          >
            🗂️ Ankii
          </button>
          <button
            className={`nav-button ${activeTab === 'cloze' ? 'active' : ''}`}
            onClick={() => setActiveTab('cloze')}
          >
            📝 Fill in blanks
          </button>
          <button
            className={`nav-button ${activeTab === 'reorder' ? 'active' : ''}`}
            onClick={() => setActiveTab('reorder')}
          >
            🧩 Reorder
          </button>
          <button
            className={`nav-button ${activeTab === 'creator' ? 'active' : ''}`}
            onClick={() => setActiveTab('creator')}
          >
            ✍️ Creator
          </button>
          <button
            className={`nav-button ${activeTab === 'dictation' ? 'active' : ''}`}
            onClick={() => setActiveTab('dictation')}
          >
            🎧 Listening
          </button>
          <button
            className={`nav-button ${activeTab === 'mylist' ? 'active' : ''}`}
            onClick={() => setActiveTab('mylist')}
          >
            ⭐ My List
          </button>
          <button
            className={`nav-button ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            📈 Stats
          </button>
        </nav>
      </header>

      <main style={{ flexGrow: 1 }}>
        {activeTab === 'explorer' && <WordList vocabData={vocabData} myList={myList} onToggleMyList={handleToggleMyList} />}
        {activeTab === 'practice' && <Flashcards vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'cloze' && <ClozePractice vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'reorder' && <ReorderPractice vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'creator' && <SentenceCreator vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'dictation' && <DictationPractice vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'mylist' && (
          <MyList 
            myList={myList} 
            onToggleMyList={handleToggleMyList} 
            onImportMyList={handleImportMyList}
            syncCode={syncCode}
            setSyncCode={(code) => {
              setSyncCode(code);
              localStorage.setItem('b1_sync_code', code);
            }}
            syncStatus={syncStatus}
            syncError={syncError}
            onSyncNow={syncWithCloud}
          />
        )}
        {activeTab === 'stats' && <Stats stats={computedStats} reviews={reviews} onResetStats={handleResetStats} />}
      </main>

      {/* Double click quick-add popover */}
      {doubleClickedText && (
        <div 
          id="double-click-popover"
          className="glass-card"
          style={{
            position: 'absolute',
            top: `${doubleClickPosition.y + window.scrollY + 10}px`,
            left: `${Math.min(window.innerWidth - 300, Math.max(10, doubleClickPosition.x + window.scrollX - 130))}px`,
            zIndex: 9999,
            width: '280px',
            padding: '16px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
            border: '2px solid var(--border-color)',
            backdropFilter: 'blur(25px)',
            textAlign: 'left',
            color: 'var(--text-primary)'
          }}
        >
          {matchedWordInfo ? (
            <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              <div style={{fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                B1 Dictionary Match Found
              </div>
              <div style={{fontSize: '15px', fontWeight: '700', color: '#fff'}}>
                {matchedWordInfo.word}
              </div>
              <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
                {matchedWordInfo.meaning}
              </div>
              
              <div style={{display: 'flex', gap: '8px', marginTop: '4px'}}>
                <button
                  type="button"
                  className="feedback-btn good"
                  style={{flexGrow: 1, padding: '8px', fontSize: '11px', borderRadius: '8px', maxWidth: 'none', minHeight: 'auto'}}
                  onClick={() => {
                    handleToggleMyList(matchedWordInfo);
                    setDoubleClickedText('');
                  }}
                >
                  {myList.some(item => item.word.toLowerCase() === matchedWordInfo.word.toLowerCase())
                    ? '★ Unstar Word'
                    : '★ Add to My List'}
                </button>
                <button
                  type="button"
                  className="nav-button"
                  style={{padding: '8px 12px', fontSize: '11px', borderRadius: '8px', minWidth: 'auto', background: 'rgba(255,255,255,0.05)'}}
                  onClick={() => setDoubleClickedText('')}
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleQuickSave} style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
              <div style={{fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                Add Selected Custom Word
              </div>
              <div style={{fontSize: '14px', fontWeight: '700', color: '#fff'}}>
                🇩🇪 {doubleClickedText}
              </div>
              
              <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                <input
                  type="text"
                  className="search-input"
                  style={{padding: '8px', fontSize: '12px', borderRadius: '8px', width: '100%'}}
                  placeholder="English meaning..."
                  value={quickMeaning}
                  onChange={(e) => setQuickMeaning(e.target.value)}
                  required
                  autoFocus
                  autoComplete="off"
                />
              </div>

              <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                <select
                  className="search-input"
                  style={{padding: '8px', fontSize: '12px', borderRadius: '8px', width: '100%', height: '34px', color: '#fff', background: '#090a0f'}}
                  value={quickCategory}
                  onChange={(e) => setQuickCategory(e.target.value)}
                >
                  <option value="nouns">Noun</option>
                  <option value="verbs">Verb</option>
                  <option value="adjectives">Adjective / Adverb</option>
                  <option value="connectors">Connector</option>
                </select>
              </div>

              <div style={{display: 'flex', gap: '8px', marginTop: '4px'}}>
                <button
                  type="submit"
                  className="feedback-btn good"
                  style={{flexGrow: 1, padding: '8px', fontSize: '11px', borderRadius: '8px', maxWidth: 'none', minHeight: 'auto'}}
                  disabled={!quickMeaning.trim()}
                >
                  ➕ Add Word
                </button>
                <button
                  type="button"
                  className="nav-button"
                  style={{padding: '8px 12px', fontSize: '11px', borderRadius: '8px', minWidth: 'auto', background: 'rgba(255,255,255,0.05)'}}
                  onClick={() => setDoubleClickedText('')}
                >
                  Close
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
