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

  // Re-build and shuffle queue whenever the category/activeWords change
  useEffect(() => {
    if (activeWords.length > 0) {
      setQueue(shuffleArray(activeWords));
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
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(word.replace(/,.*$/, ''));
      utterance.lang = 'de-DE';
      window.speechSynthesis.speak(utterance);
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
                      <div key={exIdx} className="card-example-item">
                        <p className="example-de">🇩🇪 {ex.de}</p>
                        <p className="example-en">🇬🇧 {ex.en}</p>
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
