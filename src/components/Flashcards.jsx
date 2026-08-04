import React, { useState, useEffect, useMemo, useRef } from 'react';

export default function Flashcards({ vocabData, onReview }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isFlipped, setIsFlipped] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queue, setQueue] = useState([]);

  // Compile words based on selected category
  const activeWords = useMemo(() => {
    if (selectedCategory === 'all') {
      const all = [];
      Object.keys(vocabData).forEach(cat => {
        const items = vocabData[cat] || [];
        items.forEach(item => {
          all.push({ ...item, category: cat });
        });
      });
      return all;
    } else {
      const items = vocabData[selectedCategory] || [];
      return items.map(item => ({ ...item, category: selectedCategory }));
    }
  }, [vocabData, selectedCategory]);

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

  const handleFeedback = (rating) => {
    if (!currentCard) return;
    
    // Log review to parent
    onReview(currentCard.word, currentCard.category, rating);
    
    // Anki/Leitner Logic: If rating is 'hard', splice it back into the queue 4 cards later
    // to prompt recall and repetition during the same study session.
    let updatedQueue = [...queue];
    if (rating === 'hard') {
      const reinsertDistance = 4; 
      const reinsertIndex = Math.min(currentIndex + 1 + reinsertDistance, updatedQueue.length);
      updatedQueue.splice(reinsertIndex, 0, currentCard);
      setQueue(updatedQueue);
    }
    
    // Go to next card
    setIsFlipped(false);
    setTimeout(() => {
      if (currentIndex + 1 < updatedQueue.length) {
        setCurrentIndex(currentIndex + 1);
      } else {
        // Reshuffle queue if reached end
        setQueue(shuffleArray(activeWords));
        setCurrentIndex(0);
      }
    }, 250); // Small timeout to allow transition to reset flip
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

      {/* Card count indicator */}
      <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
        Card {currentIndex + 1} of {queue.length}
      </div>

      {/* 3D Flip Card */}
      <div 
        className={`flashcard-container ${currentCard.category}`}
        onClick={handleFlip}
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
            
            <div className="card-scroll-content" onClick={(e) => e.stopPropagation()}>
              <div className="card-content-wrapper">
                <div className="card-instruction">German Word</div>
                <div className="card-main-word" onClick={(e) => e.stopPropagation()}>{currentCard.word}</div>
                
                {currentCard.conjugation && (
                  <div className="card-main-conjugation" onClick={(e) => e.stopPropagation()}>
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
            
            <div className="card-scroll-content" onClick={(e) => e.stopPropagation()}>
              <div className="card-content-wrapper">
                <div className="card-instruction">English Translation</div>
                <div className="card-main-meaning" onClick={(e) => e.stopPropagation()}>{currentCard.meaning}</div>
                
                {currentCard.examples && currentCard.examples.length > 0 && (
                  <div className="card-examples-list" onClick={(e) => e.stopPropagation()}>
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
            🔴 Hard [1]
          </button>
          <button className="feedback-btn good" onClick={() => handleFeedback('good')}>
            🔵 Good [2]
          </button>
          <button className="feedback-btn easy" onClick={() => handleFeedback('easy')}>
            🟢 Easy [3]
          </button>
        </div>
      )}
    </div>
  );
}
