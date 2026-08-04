import React, { useState, useEffect, useMemo } from 'react';

// Helper to shuffle array
const shuffleArray = (array) => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

// Clean string for spelling comparison
const normalizeSpelling = (str) => {
  return str.toLowerCase()
            .replace(/^(der\/die\/das|der|die|das|ein|eine)\s+/i, '') // Optional article strip
            .replace(/[^a-zäöüß]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
};

export default function DictationPractice({ vocabData, onReview }) {
  const [mode, setMode] = useState('word'); // 'word' or 'sentence'
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userInput, setUserInput] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // Generate dictation queue based on selected mode
  useEffect(() => {
    let items = [];
    if (mode === 'word') {
      // Gather all words across nouns, verbs, adjectives, connectors
      const nouns = (vocabData.nouns || []).map(item => ({
        targetText: item.word.replace(/,.*$/, '').trim(), // e.g. "das Abgas"
        translation: item.meaning,
        word: item.word,
        category: 'nouns'
      }));

      const verbs = (vocabData.verbs || []).map(item => ({
        targetText: item.word.replace(/\(.*\)/, '').replace(/sich\s+/i, '').trim(), // clean base verb
        translation: item.meaning,
        word: item.word,
        category: 'verbs'
      }));

      const adjectives = (vocabData.adjectives || []).map(item => ({
        targetText: item.word.trim(),
        translation: item.meaning,
        word: item.word,
        category: 'adjectives'
      }));

      const connectors = (vocabData.connectors || []).map(item => ({
        targetText: item.word.trim(),
        translation: item.meaning,
        word: item.word,
        category: 'connectors'
      }));

      items = [...nouns, ...verbs, ...adjectives, ...connectors];
    } else {
      // Gather all example sentences
      const allCategories = [...(vocabData.nouns || []), ...(vocabData.verbs || []), ...(vocabData.adjectives || []), ...(vocabData.connectors || [])];
      allCategories.forEach(item => {
        if (item.examples && item.examples.length > 0) {
          item.examples.forEach(ex => {
            items.push({
              targetText: ex.de,
              translation: ex.en,
              word: item.word,
              category: 'sentence'
            });
          });
        }
      });
    }

    if (items.length > 0) {
      setQueue(shuffleArray(items).slice(0, 50)); // Limit active queue to 50 random items
      setCurrentIndex(0);
      setUserInput('');
      setShowFeedback(false);
    }
  }, [mode, vocabData]);

  const currentItem = queue[currentIndex];

  // Auto-play sound when active item changes
  useEffect(() => {
    if (currentItem && !showFeedback) {
      // Small timeout to give speech synthesis engine time to register
      const timer = setTimeout(() => {
        playAudio();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [currentItem, showFeedback]);

  const playAudio = () => {
    if (currentItem && window.speakGerman) {
      window.speakGerman(currentItem.targetText);
    }
  };

  // Keyboard shortcut handlers
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Spacebar plays audio when input is NOT focused
      if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        playAudio();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentItem]);

  const handleCheck = (e) => {
    e.preventDefault();
    if (!currentItem || !userInput.trim()) return;

    // Compare spelling (lenient on articles, spacing, and punctuation)
    const normUser = normalizeSpelling(userInput);
    const normTarget = normalizeSpelling(currentItem.targetText);

    // Exact check (also checking standard direct clean match)
    const directUser = userInput.trim().toLowerCase().replace(/[.,!?-]/g, '');
    const directTarget = currentItem.targetText.trim().toLowerCase().replace(/[.,!?-]/g, '');

    const correct = normUser === normTarget || directUser === directTarget;
    setIsCorrect(correct);
    setShowFeedback(true);

    // Track review in stats
    onReview(currentItem.word, `dictation-${mode}`, correct ? 'good' : 'hard');
  };

  const handleNext = () => {
    setUserInput('');
    setShowFeedback(false);
    
    if (currentIndex + 1 < queue.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Cycle/Reshuffle
      setMode(mode); 
    }
  };

  if (!currentItem) {
    return (
      <div className="flashcard-layout animate-fade-in">
        <div className="empty-state glass-card">
          <p>No words or sentences available for dictation practice.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcard-layout animate-fade-in" style={{maxWidth: '650px'}}>
      
      {/* Mode Selector Header */}
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '10px'}}>
        <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
          Hördiktat — Listen & Write Dictation
        </div>
        <div className="app-nav" style={{margin: 0, padding: 0, border: 'none', background: 'transparent'}}>
          <button 
            type="button"
            className={`nav-button ${mode === 'word' ? 'active' : ''}`}
            onClick={() => setMode('word')}
            style={{padding: '6px 12px', borderRadius: '10px', fontSize: '12px'}}
          >
            🔤 Words
          </button>
          <button 
            type="button"
            className={`nav-button ${mode === 'sentence' ? 'active' : ''}`}
            onClick={() => setMode('sentence')}
            style={{padding: '6px 12px', borderRadius: '10px', fontSize: '12px'}}
          >
            💬 Sentences
          </button>
        </div>
      </div>

      {/* Main Dictation practice card */}
      <div className="glass-card total" style={{width: '100%', padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '380px'}}>
        
        {/* Progress bar */}
        <div style={{width: '100%', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '30px', overflow: 'hidden'}}>
          <div style={{
            width: `${((currentIndex + 1) / queue.length) * 100}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--color-noun), var(--color-verb))',
            transition: 'width 0.3s ease'
          }} />
        </div>

        <div style={{fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px'}}>
          Item {currentIndex + 1} of {queue.length}
        </div>

        {/* Large Play Audio trigger button */}
        <button
          type="button"
          className="sound-btn"
          style={{
            width: '84px',
            height: '84px',
            fontSize: '38px',
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
            marginBottom: '32px',
            transition: 'transform 0.2s ease',
            justifyContent: 'center',
            alignItems: 'center'
          }}
          onClick={playAudio}
          title="Play Audio (Press Space)"
          onMouseEnter={(e) => e.target.style.transform = 'scale(1.08)'}
          onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
        >
          🔊
        </button>

        {/* Input box form */}
        <form onSubmit={handleCheck} style={{width: '100%', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center'}}>
          <input
            type="text"
            className="search-input"
            style={{
              width: '100%',
              fontSize: '18px',
              padding: '16px',
              borderRadius: '12px',
              textAlign: 'center',
              border: showFeedback 
                ? (isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444') 
                : '1px solid var(--border-color)'
            }}
            placeholder="Listen and type the spelling in German..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            disabled={showFeedback}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
          />

          {!showFeedback ? (
            <div style={{display: 'flex', gap: '12px', width: '100%', maxWidth: '340px'}}>
              <button
                type="submit"
                className="feedback-btn good"
                style={{flexGrow: 1, borderRadius: '12px', padding: '14px', maxWidth: 'none'}}
                disabled={!userInput.trim()}
              >
                Verify spelling
              </button>
            </div>
          ) : (
            <div className="animate-fade-in" style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', marginTop: '10px'}}>
              
              {/* Verdict */}
              {isCorrect ? (
                <div style={{color: 'var(--color-noun)', fontWeight: '700', fontSize: '18px'}}>
                  Richtig! 🎉
                </div>
              ) : (
                <div style={{color: '#ef4444', fontWeight: '700', fontSize: '18px'}}>
                  Falsch! ❌
                </div>
              )}

              {/* Reveal translation and spelling details */}
              <div style={{width: '100%', borderTop: '1px dashed var(--border-color)', paddingTop: '20px', textAlign: 'center'}}>
                <div style={{fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '8px'}}>
                  Correct German Spelling
                </div>
                <div style={{fontSize: '22px', fontWeight: '700', color: '#fff', marginBottom: '12px'}}>
                  {currentItem.targetText}
                </div>

                {!isCorrect && (
                  <div style={{marginBottom: '16px'}}>
                    <div style={{fontSize: '11px', color: '#ef4444', textTransform: 'uppercase', marginBottom: '4px'}}>
                      Your Input
                    </div>
                    <div style={{fontSize: '16px', color: 'var(--text-secondary)', textDecoration: 'line-through'}}>
                      {userInput}
                    </div>
                  </div>
                )}

                <div style={{fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px'}}>
                  English Translation
                </div>
                <div style={{fontSize: '15px', color: 'var(--text-secondary)'}}>
                  {currentItem.translation}
                </div>
              </div>

              <button
                type="button"
                className="feedback-btn good"
                style={{borderRadius: '12px', padding: '14px 32px', minWidth: '200px'}}
                onClick={handleNext}
                autoFocus
              >
                Next Item ➔
              </button>

            </div>
          )}
        </form>
      </div>

    </div>
  );
}
