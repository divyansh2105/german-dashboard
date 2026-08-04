import React, { useState, useEffect, useMemo, useRef } from 'react';

export default function Flashcards({ vocabData, onReview }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queue, setQueue] = useState([]);
  const [studyAhead, setStudyAhead] = useState(false);

  // Load Leitner schedules from localStorage on mount
  const [schedules, setSchedules] = useState(() => {
    const saved = localStorage.getItem('b1_flashcard_schedules');
    return saved ? JSON.parse(saved) : {};
  });

  // Reset studyAhead when category changes to give due cards priority
  useEffect(() => {
    setStudyAhead(false);
  }, [selectedCategory]);

  // Compile words based on selected category and due date status
  const activeWords = useMemo(() => {
    let baseWords = [];
    if (selectedCategory === 'all') {
      const all = [];
      Object.keys(vocabData).forEach(cat => {
        const items = vocabData[cat] || [];
        items.forEach(item => {
          all.push({ ...item, category: cat });
        });
      });
      baseWords = all;
    } else {
      const items = vocabData[selectedCategory] || [];
      baseWords = items.map(item => ({ ...item, category: selectedCategory }));
    }

    // Filter to only show cards that are due, unless studyAhead is active
    if (!studyAhead) {
      baseWords = baseWords.filter(w => {
        const key = w.word.toLowerCase();
        const sched = schedules[key];
        if (!sched) return true; // Never studied before -> due!
        return sched.nextReviewTime <= Date.now();
      });
    }

    return baseWords;
  }, [vocabData, selectedCategory, schedules, studyAhead]);

  // Shuffle queue helper
  const shuffleArray = (array) => {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  // Build prioritized queue with a 6:3:1 ratio (High:Medium:Low) per 10 items
  const buildPrioritizedQueue = (words) => {
    const high = shuffleArray(words.filter(w => w.priority === 1 || !w.priority));
    const med = shuffleArray(words.filter(w => w.priority === 2));
    const low = shuffleArray(words.filter(w => w.priority === 3));

    const finalQueue = [];
    let hIndex = 0, mIndex = 0, lIndex = 0;

    while (hIndex < high.length || mIndex < med.length || lIndex < low.length) {
      const batch = [];

      // Add up to 6 high priority words
      for (let i = 0; i < 6; i++) {
        if (hIndex < high.length) batch.push(high[hIndex++]);
      }

      // Add up to 3 medium priority words
      for (let i = 0; i < 3; i++) {
        if (mIndex < med.length) batch.push(med[mIndex++]);
      }

      // Add up to 1 low priority word
      for (let i = 0; i < 1; i++) {
        if (lIndex < low.length) batch.push(low[lIndex++]);
      }

      // Fill up to 10 if any category runs out early
      while (batch.length < 10 && (hIndex < high.length || mIndex < med.length || lIndex < low.length)) {
        if (hIndex < high.length) batch.push(high[hIndex++]);
        else if (mIndex < med.length) batch.push(med[mIndex++]);
        else if (lIndex < low.length) batch.push(low[lIndex++]);
      }

      finalQueue.push(...shuffleArray(batch));
    }

    return finalQueue;
  };

  // Re-build and shuffle queue whenever the category/activeWords change
  useEffect(() => {
    if (activeWords.length > 0) {
      setQueue(buildPrioritizedQueue(activeWords));
      setCurrentIndex(0);
      setIsFlipped(false);
    } else {
      setQueue([]);
    }
  }, [activeWords]);

  const currentCard = queue[currentIndex];

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  const clickTimeoutRef = useRef(null);

  const handleCardClick = (e) => {
    if (e.target.closest('button') || e.target.closest('.sound-btn')) {
      return;
    }
    
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      return;
    }
    
    clickTimeoutRef.current = setTimeout(() => {
      handleFlip();
      clickTimeoutRef.current = null;
    }, 220);
  };

  const handleFeedback = (rating) => {
    if (!currentCard) return;
    
    onReview(currentCard.word, currentCard.category, rating);
    
    // Spaced Repetition Leitner Interval Adjustments
    const key = currentCard.word.toLowerCase();
    const currentSched = schedules[key] || { intervalDays: 0, nextReviewTime: 0 };
    let nextInterval = 0;
    
    if (rating === 'easy') {
      nextInterval = currentSched.intervalDays === 0 ? 4 : currentSched.intervalDays * 2;
    } else if (rating === 'good') {
      if (currentSched.intervalDays === 0) {
        nextInterval = 1;
      } else if (currentSched.intervalDays === 1) {
        nextInterval = 3;
      } else {
        nextInterval = Math.round(currentSched.intervalDays * 1.5);
      }
    } else if (rating === 'hard') {
      nextInterval = 0; // Reset scheduling interval on failure
    }
    
    const nextReviewTime = Date.now() + nextInterval * 24 * 60 * 60 * 1000;
    
    const updatedSchedules = {
      ...schedules,
      [key]: {
        intervalDays: nextInterval,
        nextReviewTime
      }
    };
    
    setSchedules(updatedSchedules);
    localStorage.setItem('b1_flashcard_schedules', JSON.stringify(updatedSchedules));

    let updatedQueue = [...queue];
    if (rating === 'hard') {
      const reinsertDistance = 4; 
      const reinsertIndex = Math.min(currentIndex + 1 + reinsertDistance, updatedQueue.length);
      updatedQueue.splice(reinsertIndex, 0, currentCard);
      setQueue(updatedQueue);
    }
    
    setIsFlipped(false);
    setTimeout(() => {
      if (currentIndex + 1 < updatedQueue.length) {
        setCurrentIndex(currentIndex + 1);
      } else {
        setQueue(shuffleArray(activeWords));
        setCurrentIndex(0);
      }
    }, 250);
  };

  // Keyboard Shortcuts (Space to Flip, 1/2/3 for Hard/Good/Easy)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        handleFlip();
      } else if (isFlipped) {
        if (e.key === '1') {
          handleFeedback('hard');
        } else if (e.key === '2') {
          handleFeedback('good');
        } else if (e.key === '3') {
          handleFeedback('easy');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFlipped, currentIndex, queue, currentCard]);

  const speakWord = (e, word) => {
    e.stopPropagation();
    if (window.speakGerman) {
      window.speakGerman(word.replace(/,.*$/, ''));
    }
  };

  // Calculate potential intervals beforehand to show on the feedback buttons
  const prospectiveIntervals = useMemo(() => {
    if (!currentCard) return { hard: '', good: '', easy: '' };
    const key = currentCard.word.toLowerCase();
    const currentSched = schedules[key] || { intervalDays: 0, nextReviewTime: 0 };
    
    // Hard: reset interval / practice in same session
    const hardInterval = "<10m";
    
    // Good
    let goodDays = 0;
    if (currentSched.intervalDays === 0) {
      goodDays = 1;
    } else if (currentSched.intervalDays === 1) {
      goodDays = 3;
    } else {
      goodDays = Math.round(currentSched.intervalDays * 1.5);
    }
    const goodInterval = `${goodDays}d`;
    
    // Easy
    const easyDays = currentSched.intervalDays === 0 ? 4 : currentSched.intervalDays * 2;
    const easyInterval = `${easyDays}d`;
    
    return {
      hard: hardInterval,
      good: goodInterval,
      easy: easyInterval
    };
  }, [currentCard, schedules]);

  // 1. Caught Up State
  if (activeWords.length === 0 && !studyAhead) {
    let nextDueTime = null;
    let baseWords = [];
    if (selectedCategory === 'all') {
      Object.keys(vocabData).forEach(cat => {
        const items = vocabData[cat] || [];
        items.forEach(item => {
          baseWords.push({ ...item, category: cat });
        });
      });
    } else {
      const items = vocabData[selectedCategory] || [];
      baseWords = items.map(item => ({ ...item, category: selectedCategory }));
    }

    baseWords.forEach(w => {
      const sched = schedules[w.word.toLowerCase()];
      if (sched) {
        if (nextDueTime === null || sched.nextReviewTime < nextDueTime) {
          nextDueTime = sched.nextReviewTime;
        }
      }
    });

    let dueMsg = "You are all caught up for today!";
    if (nextDueTime !== null) {
      const hoursRemaining = Math.max(0, Math.ceil((nextDueTime - Date.now()) / (1000 * 60 * 60)));
      if (hoursRemaining === 0) {
        dueMsg = "Your next card review is due in less than an hour.";
      } else if (hoursRemaining < 24) {
        dueMsg = `Your next card review is due in ${hoursRemaining} hour${hoursRemaining > 1 ? 's' : ''}.`;
      } else {
        const daysRemaining = Math.ceil(hoursRemaining / 24);
        dueMsg = `Your next card review is due in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}.`;
      }
    }

    return (
      <div className="flashcard-layout animate-fade-in" style={{maxWidth: '650px'}}>
        <div className="flashcard-options">
          <button className={`option-pill ${selectedCategory === 'all' ? 'active' : ''}`} onClick={() => setSelectedCategory('all')}>🌐 Mix All</button>
          <button className={`option-pill ${selectedCategory === 'nouns' ? 'active' : ''}`} onClick={() => setSelectedCategory('nouns')}>🟢 Nouns</button>
          <button className={`option-pill ${selectedCategory === 'verbs' ? 'active' : ''}`} onClick={() => setSelectedCategory('verbs')}>🔵 Verbs</button>
          <button className={`option-pill ${selectedCategory === 'adjectives' ? 'active' : ''}`} onClick={() => setSelectedCategory('adjectives')}>🟡 Adjectives</button>
          <button className={`option-pill ${selectedCategory === 'connectors' ? 'active' : ''}`} onClick={() => setSelectedCategory('connectors')}>#️⃣ Connectors</button>
        </div>

        <div className="glass-card" style={{padding: '40px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%'}}>
          <div style={{fontSize: '48px'}}>🎉</div>
          <h3 style={{margin: 0, color: '#fff', fontSize: '18px', fontWeight: '700'}}>All Caught Up!</h3>
          <p style={{margin: 0, color: 'var(--text-secondary)', fontSize: '14px'}}>{dueMsg}</p>
          <button 
            type="button" 
            className="nav-button active"
            onClick={() => setStudyAhead(true)}
            style={{marginTop: '10px', padding: '10px 20px', borderRadius: '10px', background: 'linear-gradient(135deg, var(--color-noun), var(--color-verb))', fontWeight: '700'}}
          >
            📖 Study Ahead (Practice All Words)
          </button>
        </div>
      </div>
    );
  }

  // 2. Base fallback if empty queue and studyAhead active
  if (!currentCard) {
    return (
      <div className="flashcard-layout animate-fade-in">
        <div className="empty-state glass-card">
          <p>No words available to practice.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcard-layout animate-fade-in">
      {/* Category selector */}
      <div className="flashcard-options">
        <button 
          className={`option-pill ${selectedCategory === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('all')}
        >
          🌐 Mix All
        </button>
        <button 
          className={`option-pill ${selectedCategory === 'nouns' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('nouns')}
        >
          🟢 Nouns
        </button>
        <button 
          className={`option-pill ${selectedCategory === 'verbs' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('verbs')}
        >
          🔵 Verbs
        </button>
        <button 
          className={`option-pill ${selectedCategory === 'adjectives' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('adjectives')}
        >
          🟡 Adjectives
        </button>
        <button 
          className={`option-pill ${selectedCategory === 'connectors' ? 'active' : ''}`}
          onClick={() => setSelectedCategory('connectors')}
        >
          #️⃣ Connectors
        </button>
      </div>
      
      {/* Study Ahead Indicator */}
      {studyAhead && (
        <div style={{display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', marginTop: '-8px', marginBottom: '8px'}}>
          <span style={{fontSize: '11px', color: 'var(--color-verb)', fontWeight: '700'}}>📖 Study Ahead Mode Active</span>
          <button 
            type="button"
            onClick={() => setStudyAhead(false)}
            style={{
              fontSize: '10px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'var(--text-secondary)',
              padding: '2px 8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Switch to Due
          </button>
        </div>
      )}

      {/* Card count indicator */}
      <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
        Card {currentIndex + 1} of {queue.length}
      </div>

      {/* 3D Flip Card */}
      <div 
        className={`flashcard-container ${currentCard.category}`}
        onClick={handleCardClick}
      >
        <div className={`flashcard-inner ${isFlipped ? 'flipped' : ''}`}>
          
          {/* FRONT FACE (German word) */}
          <div className="card-face front">
            <span className="category-tag nouns" style={{position: 'absolute', top: '24px', left: '24px'}}>
              {currentCard.category}
            </span>
            <button 
              className="sound-btn" 
              onClick={(e) => speakWord(e, currentCard.word)} 
              title="Speak word"
              style={{position: 'absolute', top: '20px', right: '20px'}}
            >
              🔊
            </button>
            
            <div className="card-scroll-content">
              <div className="card-content-wrapper">
                <div className="card-instruction">German Word</div>
                <div className="card-main-word">{currentCard.word}</div>
                
                {currentCard.conjugation && (
                  <div className="card-main-conjugation">
                    {currentCard.conjugation}
                  </div>
                )}
              </div>
            </div>
            
            <div className="card-subtext">Click card or press [Space] to Flip</div>
          </div>
          
          {/* BACK FACE (Translation + Usage) */}
          <div className="card-face back">
            <span className="category-tag nouns" style={{position: 'absolute', top: '24px', left: '24px'}}>
              {currentCard.category}
            </span>
            
            <div className="card-scroll-content">
              <div className="card-content-wrapper">
                <div className="card-instruction">English Translation</div>
                <div className="card-main-meaning">{currentCard.meaning}</div>
                
                {currentCard.examples && currentCard.examples.length > 0 && (
                  <div className="card-examples-list">
                    {currentCard.examples.map((ex, exIdx) => (
                      <div key={exIdx} className="card-example-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', width: '100%', margin: '8px 0'}}>
                        <div style={{flexGrow: 1, textAlign: 'left'}}>
                          <p className="example-de" style={{margin: 0}}>🇩🇪 {ex.de}</p>
                          <p className="example-en" style={{margin: '2px 0 0', color: 'var(--text-secondary)', fontSize: '13px'}}>🇬🇧 {ex.en}</p>
                        </div>
                        <button 
                          type="button"
                          className="sound-btn" 
                          onClick={(e) => { e.stopPropagation(); if (window.speakGerman) window.speakGerman(ex.de); }} 
                          title="Listen to sentence"
                          style={{fontSize: '14px', width: '28px', height: '28px', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 0}}
                        >
                          🔊
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            
            <div className="card-subtext">Press rating key or select button below</div>
          </div>
          
        </div>
      </div>

      {/* Rating Buttons */}
      {isFlipped && (
        <div className="feedback-bar animate-fade-in">
          <button className="feedback-btn hard" onClick={() => handleFeedback('hard')}>
            🔴 Hard ({prospectiveIntervals.hard}) [1]
          </button>
          <button className="feedback-btn good" onClick={() => handleFeedback('good')}>
            🔵 Good ({prospectiveIntervals.good}) [2]
          </button>
          <button className="feedback-btn easy" onClick={() => handleFeedback('easy')}>
            🟢 Easy ({prospectiveIntervals.easy}) [3]
          </button>
        </div>
      )}
    </div>
  );
}
