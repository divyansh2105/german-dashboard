import React, { useState, useEffect, useMemo } from 'react';

export default function ReorderPractice({ vocabData, onReview }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queue, setQueue] = useState([]);
  const [selectedWords, setSelectedWords] = useState([]); // indices or string values selected
  const [wordBank, setWordBank] = useState([]); // scrambled word bank list: [ { id, text, used } ]
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // Helper to compile a reorder item
  const generateReorderItem = (item) => {
    if (!item.examples || item.examples.length === 0) return null;
    
    const example = item.examples[0];
    const de = example.de;
    const en = example.en;
    
    // Clean sentence of trailing period/exclamation and split into clean words
    const cleanSentence = de.replace(/[.?!]$/, '').trim();
    const originalWords = cleanSentence
      .split(/\s+/)
      .map(w => w.replace(/[,;.:!?„“"()]/g, ''))
      .filter(w => w.length > 0);
      
    if (originalWords.length < 3) return null; // Only reorder sentences of 3+ words

    return {
      originalWords, // Array of correct ordered words
      englishTranslation: en,
      originalWord: item.word,
      fullGerman: de,
      category: item.category
    };
  };

  // Compile active reorder-ready items
  const activeReorderItems = useMemo(() => {
    let rawItems = [];
    if (selectedCategory === 'all') {
      Object.keys(vocabData).forEach(cat => {
        const items = vocabData[cat] || [];
        items.forEach(item => {
          rawItems.push({ ...item, category: cat });
        });
      });
    } else {
      const items = vocabData[selectedCategory] || [];
      rawItems = items.map(item => ({ ...item, category: selectedCategory }));
    }

    return rawItems
      .map(item => generateReorderItem(item))
      .filter(item => item !== null);
  }, [vocabData, selectedCategory]);

  const shuffleArray = (array) => {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  // Set up queue
  useEffect(() => {
    if (activeReorderItems.length > 0) {
      setQueue(shuffleArray(activeReorderItems));
      setCurrentIndex(0);
      setSelectedWords([]);
      setShowFeedback(false);
    } else {
      setQueue([]);
    }
  }, [activeReorderItems]);

  const currentItem = queue[currentIndex];

  // Set up word bank when currentItem changes
  useEffect(() => {
    if (currentItem) {
      const scrambled = shuffleArray(currentItem.originalWords).map((word, idx) => ({
        id: idx,
        text: word,
        used: false
      }));
      setWordBank(scrambled);
      setSelectedWords([]);
      setShowFeedback(false);
    }
  }, [currentItem]);

  const selectWord = (bankItem) => {
    if (showFeedback) return;
    
    // Add to selected
    setSelectedWords([...selectedWords, bankItem]);
    
    // Mark as used in wordBank
    setWordBank(wordBank.map(item => 
      item.id === bankItem.id ? { ...item, used: true } : item
    ));
  };

  const deselectWord = (selectedItem, indexToRemove) => {
    if (showFeedback) return;
    
    // Remove from selected
    setSelectedWords(selectedWords.filter((_, idx) => idx !== indexToRemove));
    
    // Reset in wordBank
    setWordBank(wordBank.map(item => 
      item.id === selectedItem.id ? { ...item, used: false } : item
    ));
  };

  const handleBackspace = () => {
    if (showFeedback || selectedWords.length === 0) return;
    
    const lastItem = selectedWords[selectedWords.length - 1];
    
    // Remove last item from selected
    setSelectedWords(selectedWords.slice(0, -1));
    
    // Reset in wordBank
    setWordBank(wordBank.map(item => 
      item.id === lastItem.id ? { ...item, used: false } : item
    ));
  };

  // Keyboard shortcut for Backspace key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Backspace') {
        handleBackspace();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectedWords, wordBank, showFeedback]);

  const handleVerify = () => {
    if (showFeedback || !currentItem) return;

    // Compare lowercased words
    const userSentence = selectedWords.map(w => w.text.toLowerCase().replace(/[^a-zäöüß]/g, '')).join(' ');
    const correctSentence = currentItem.originalWords.map(w => w.toLowerCase().replace(/[^a-zäöüß]/g, '')).join(' ');

    const correct = userSentence === correctSentence;
    setIsCorrect(correct);
    setShowFeedback(true);

    onReview(currentItem.originalWord, currentItem.category, correct ? 'good' : 'hard');
  };

  const handleNext = () => {
    setSelectedWords([]);
    setShowFeedback(false);
    
    if (currentIndex + 1 < queue.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      setQueue(shuffleArray(activeReorderItems));
      setCurrentIndex(0);
    }
  };

  const speakSentence = () => {
    if (currentItem && window.speakGerman) {
      window.speakGerman(currentItem.fullGerman);
    }
  };

  const resetSelection = () => {
    if (showFeedback) return;
    setSelectedWords([]);
    setWordBank(wordBank.map(item => ({ ...item, used: false })));
  };

  if (!currentItem) {
    return (
      <div className="flashcard-layout animate-fade-in">
        <div className="empty-state glass-card">
          <p>No suitable example sentences available in this category for reordering practice.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcard-layout animate-fade-in" style={{maxWidth: '800px'}}>
      
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

      <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
        Sentence {currentIndex + 1} of {queue.length}
      </div>

      {/* Reordering Practice Board */}
      <div className={`glass-card ${currentItem.category}`} style={{width: '100%', padding: '40px', minHeight: '350px', display: 'flex', flexDirection: 'column'}}>
        
        <span className="category-tag nouns" style={{position: 'absolute', top: '24px', left: '24px'}}>
          {currentItem.category}
        </span>

        {showFeedback && (
          <button 
            className="sound-btn" 
            onClick={speakSentence} 
            title="Listen to sentence"
            style={{position: 'absolute', top: '20px', right: '20px'}}
          >
            🔊
          </button>
        )}

        <div className="card-instruction" style={{marginBottom: '24px'}}>Reorder German Sentence</div>

        {/* Translation translation */}
        <div style={{fontSize: '16px', color: 'var(--text-primary)', fontWeight: '600', marginBottom: '32px'}}>
          🇬🇧 {currentItem.englishTranslation}
        </div>

        {/* Selected Tiles Slot (Active sentence assembly) */}
        <div 
          style={{
            minHeight: '65px',
            borderBottom: '2px solid rgba(255, 255, 255, 0.1)',
            padding: '10px 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '10px',
            justifyContent: 'center',
            alignItems: 'center',
            marginBottom: '32px',
            background: 'rgba(255,255,255,0.01)',
            borderRadius: '8px'
          }}
        >
          {selectedWords.map((item, idx) => (
            <button
              key={idx}
              className="option-pill"
              style={{
                fontSize: '15px', 
                padding: '10px 18px', 
                background: showFeedback 
                  ? (isCorrect ? 'var(--color-noun)' : '#ef4444')
                  : 'linear-gradient(135deg, var(--color-verb), rgba(59, 130, 246, 0.7))',
                color: '#fff',
                borderColor: 'transparent',
                cursor: showFeedback ? 'default' : 'pointer'
              }}
              onClick={() => deselectWord(item, idx)}
            >
              {item.text}
            </button>
          ))}
          {selectedWords.length === 0 && (
            <span style={{color: 'var(--text-muted)', fontSize: '14px', fontStyle: 'italic'}}>
              Tap words below to arrange them
            </span>
          )}
        </div>

        {/* Scrambled Word Bank tiles */}
        <div 
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            justifyContent: 'center',
            marginBottom: '40px',
            minHeight: '60px'
          }}
        >
          {wordBank.map((item) => (
            <button
              key={item.id}
              className="option-pill"
              style={{
                fontSize: '15px', 
                padding: '10px 18px',
                visibility: item.used ? 'hidden' : 'visible',
                background: 'rgba(255, 255, 255, 0.05)',
                color: 'var(--text-primary)',
                opacity: item.used ? 0 : 1,
                transition: 'all 0.2s ease'
              }}
              onClick={() => selectWord(item)}
            >
              {item.text}
            </button>
          ))}
        </div>

        {/* Action Controls */}
        <div style={{marginTop: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px'}}>
          {!showFeedback ? (
            <div style={{display: 'flex', gap: '12px', width: '100%', maxWidth: '420px'}}>
              <button
                type="button"
                className="feedback-btn good"
                style={{flexGrow: 3, borderRadius: '12px', padding: '14px', maxWidth: 'none'}}
                disabled={selectedWords.length === 0}
                onClick={handleVerify}
              >
                Check Answer
              </button>
              <button
                type="button"
                className="nav-button"
                style={{
                  flexGrow: 1, 
                  borderRadius: '12px', 
                  padding: '14px', 
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  justifyContent: 'center'
                }}
                onClick={handleBackspace}
                disabled={selectedWords.length === 0}
                title="Remove last word"
              >
                ⌫ Back
              </button>
              <button
                type="button"
                className="nav-button"
                style={{
                  flexGrow: 1, 
                  borderRadius: '12px', 
                  padding: '14px', 
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#ef4444',
                  justifyContent: 'center'
                }}
                onClick={resetSelection}
                disabled={selectedWords.length === 0}
              >
                Clear
              </button>
            </div>
          ) : (
            <div className="animate-fade-in" style={{width: '100%', maxWidth: '450px', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center'}}>
              {isCorrect ? (
                <div style={{color: 'var(--color-noun)', fontWeight: '700', fontSize: '16px'}}>
                  Richtig! 🎉
                </div>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: '4px', textAlign: 'center'}}>
                  <span style={{color: '#ef4444', fontWeight: '700', fontSize: '16px'}}>Falsch! ❌</span>
                  <span style={{color: 'var(--text-secondary)', fontSize: '14px'}}>
                    Correct order:
                  </span>
                  <strong style={{color: '#fff', fontSize: '16px', margin: '4px 0'}}>
                    {currentItem.fullGerman}
                  </strong>
                </div>
              )}

              <div style={{fontSize: '13px', color: 'var(--text-secondary)'}}>
                German Word: <strong style={{color: '#fff'}}>{currentItem.originalWord}</strong>
              </div>

              <button
                type="button"
                className="feedback-btn good"
                style={{maxWidth: '360px', width: '100%', borderRadius: '12px', padding: '14px', background: isCorrect ? 'var(--color-noun)' : '#3b82f6'}}
                onClick={handleNext}
              >
                Next Sentence ➔
              </button>
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
