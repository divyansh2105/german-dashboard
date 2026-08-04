import React, { useState, useEffect, useMemo } from 'react';

export default function ClozePractice({ vocabData, onReview }) {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [queue, setQueue] = useState([]);
  const [userAnswer, setUserAnswer] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [revealedCount, setRevealedCount] = useState(0);

  // Helper to generate cloze data
  const generateCloze = (item) => {
    if (!item.examples || item.examples.length === 0) return null;
    
    // Use the first example sentence
    const example = item.examples[0];
    const de = example.de;
    const en = example.en;
    
    // Clean up base word to find matches to hide
    let cleanRoot = item.word
      .replace(/^(der|die|das|ein|eine|sich)\s+/i, '')
      .replace(/\(.*\)/g, '')
      .replace(/,.*$/, '')
      .trim();
    
    const targets = new Set();
    if (cleanRoot.length > 2) {
      targets.add(cleanRoot.toLowerCase());
    }
    
    if (item.conjugation) {
      item.conjugation.split(',').forEach(p => {
        let cleanP = p.replace(/^(ist|hat|zu)\s+/i, '').trim();
        if (cleanP.length > 2) {
          targets.add(cleanP.toLowerCase());
        }
      });
    }
    
    // Add split word tokens
    cleanRoot.split(/\s+/).forEach(w => {
      if (w.length > 2) {
        targets.add(w.toLowerCase());
      }
    });

    // Tokenize German sentence while preserving spaces/punctuation
    const tokens = de.split(/(\s+|[,.?!;:„“"()])/);
    
    let replaced = false;
    let answer = "";
    
    const newTokens = tokens.map(token => {
      const cleanToken = token.toLowerCase().replace(/[^a-zäöüß]/g, '');
      if (cleanToken.length === 0) return token;
      
      let isTarget = false;
      for (let target of targets) {
        if (cleanToken === target || 
            (target.length > 3 && cleanToken.includes(target)) || 
            (cleanToken.length > 3 && target.includes(cleanToken))) {
          isTarget = true;
          break;
        }
      }
      
      if (cleanRoot.length > 3 && cleanToken.startsWith(cleanRoot.toLowerCase())) {
        isTarget = true;
      }
      
      if (isTarget && !replaced) {
        replaced = true;
        answer = token.trim();
        return "______";
      }
      
      return token;
    });

    // Fallback matching
    if (!replaced && cleanRoot.length >= 3) {
      const rootLower = cleanRoot.toLowerCase();
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const cleanToken = token.toLowerCase().replace(/[^a-zäöüß]/g, '');
        if (cleanToken.length >= 3) {
          if (cleanToken.startsWith(rootLower.substring(0, 3)) || rootLower.startsWith(cleanToken.substring(0, 3))) {
            replaced = true;
            answer = token.trim();
            tokens[i] = "______";
            break;
          }
        }
      }
    }
    
    if (!replaced) return null;
    
    return {
      clozeSentence: replaced ? newTokens.join("") : tokens.join(""),
      answer: answer,
      englishTranslation: en,
      originalWord: item.word,
      fullGerman: de,
      category: item.category,
      priority: item.priority
    };
  };

  // Compile cloze-ready items
  const activeClozeItems = useMemo(() => {
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

    // Process and filter items that can generate a valid Cloze sentence
    return rawItems
      .map(item => generateCloze(item))
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

  // Build prioritized queue with a 6:3:1 ratio (High:Medium:Low) per 10 items
  const buildPrioritizedQueue = (items) => {
    const high = shuffleArray(items.filter(item => item.priority === 1 || !item.priority));
    const med = shuffleArray(items.filter(item => item.priority === 2));
    const low = shuffleArray(items.filter(item => item.priority === 3));

    const finalQueue = [];
    let hIndex = 0, mIndex = 0, lIndex = 0;

    while (hIndex < high.length || mIndex < med.length || lIndex < low.length) {
      const batch = [];

      // Add up to 6 high priority items
      for (let i = 0; i < 6; i++) {
        if (hIndex < high.length) batch.push(high[hIndex++]);
      }

      // Add up to 3 medium priority items
      for (let i = 0; i < 3; i++) {
        if (mIndex < med.length) batch.push(med[mIndex++]);
      }

      // Add up to 1 low priority item
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

  // Initialize/reshuffle queue
  useEffect(() => {
    if (activeClozeItems.length > 0) {
      setQueue(buildPrioritizedQueue(activeClozeItems));
      setCurrentIndex(0);
      setUserAnswer('');
      setShowFeedback(false);
      setRevealedCount(0);
    } else {
      setQueue([]);
    }
  }, [activeClozeItems]);

  const currentItem = queue[currentIndex];

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (showFeedback || !currentItem) return;

    // Clean comparison: lowercase and strip punctuation/accents
    const cleanUser = userAnswer.trim().toLowerCase().replace(/[^a-zäöüß]/g, '');
    const cleanAnswer = currentItem.answer.trim().toLowerCase().replace(/[^a-zäöüß]/g, '');

    const correct = cleanUser === cleanAnswer;
    setIsCorrect(correct);
    setShowFeedback(true);

    // Track review to parent stats
    // rating is 'easy' if correct, 'hard' if wrong
    onReview(currentItem.originalWord, currentItem.category, correct ? 'good' : 'hard');
  };

  const handleNext = () => {
    setUserAnswer('');
    setShowFeedback(false);
    setRevealedCount(0);
    
    if (currentIndex + 1 < queue.length) {
      setCurrentIndex(currentIndex + 1);
    } else {
      // Loop reshuffle
      setQueue(buildPrioritizedQueue(activeClozeItems));
      setCurrentIndex(0);
    }
  };

  // Compute hinted sentence dynamically
  const displaySentence = useMemo(() => {
    if (!currentItem) return '';
    if (revealedCount === 0) return currentItem.clozeSentence;
    
    const answerChars = currentItem.answer.split('');
    const hinted = answerChars.map((char, index) => {
      if (index < revealedCount) return char;
      if (/[^a-zA-ZäöüßÄÖÜ]/.test(char)) return char;
      return '_';
    }).join('');
    
    return currentItem.clozeSentence.replace('______', hinted);
  }, [currentItem, revealedCount]);

  const speakSentence = () => {
    if (currentItem && window.speakGerman) {
      window.speakGerman(currentItem.fullGerman);
    }
  };

  if (!currentItem) {
    return (
      <div className="flashcard-layout animate-fade-in">
        <div className="empty-state glass-card">
          <p>No example sentences available in this category to practice Cloze tests.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcard-layout animate-fade-in" style={{maxWidth: '750px'}}>
      
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

      {/* Main Cloze Card */}
      <div className={`glass-card ${currentItem.category}`} style={{width: '100%', padding: '40px', minHeight: '300px', display: 'flex', flexDirection: 'column', justifyContent: 'center'}}>
        
        <span className="category-tag nouns" style={{position: 'absolute', top: '24px', left: '24px'}}>
          {currentItem.category}
        </span>

        {showFeedback && (
          <button 
            className="sound-btn" 
            onClick={speakSentence} 
            title="Listen to full German sentence"
            style={{position: 'absolute', top: '20px', right: '20px'}}
          >
            🔊
          </button>
        )}

        <div className="card-instruction" style={{marginBottom: '32px'}}>Fill in the Blank</div>

        {/* Cloze Sentence */}
        <div style={{fontSize: '24px', fontWeight: '700', lineHeight: '1.6', marginBottom: '24px', color: '#fff'}}>
          „{displaySentence}“
        </div>

        {/* Translation */}
        <div style={{fontSize: '15px', color: 'var(--text-secondary)', marginBottom: '32px'}}>
          🇬🇧 {currentItem.englishTranslation}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} style={{width: '100%', maxWidth: '400px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px'}}>
          <input 
            type="text" 
            className="search-input"
            style={{
              textAlign: 'center', 
              fontSize: '18px', 
              fontWeight: '700', 
              padding: '14px', 
              borderRadius: '12px',
              border: showFeedback 
                ? (isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444')
                : '1px solid var(--border-color)',
              background: 'rgba(255, 255, 255, 0.02)'
            }}
            placeholder="Type your answer here..."
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            disabled={showFeedback}
            autoFocus
          />

          {!showFeedback ? (
            <div style={{display: 'flex', gap: '12px'}}>
              <button 
                type="submit"
                className="feedback-btn good"
                style={{flexGrow: 2, borderRadius: '12px', padding: '14px', maxWidth: 'none'}}
              >
                Verify Answer
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
                onClick={() => setRevealedCount(prev => Math.min(prev + 2, currentItem.answer.length))}
                disabled={revealedCount >= currentItem.answer.length}
              >
                💡 Hint
              </button>
            </div>
          ) : (
            <div className="animate-fade-in" style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
              
              {/* Feedback messages */}
              {isCorrect ? (
                <div style={{color: 'var(--color-noun)', fontWeight: '700', fontSize: '16px'}}>
                  Richtig! 🎉
                </div>
              ) : (
                <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                  <span style={{color: '#ef4444', fontWeight: '700', fontSize: '16px'}}>Falsch! ❌</span>
                  <span style={{color: 'var(--text-secondary)', fontSize: '14px'}}>
                    Correct answer was: <strong style={{color: '#fff', fontSize: '16px'}}>{currentItem.answer}</strong>
                  </span>
                </div>
              )}

              {/* Reveal full word and sentence */}
              <div style={{fontSize: '14px', color: 'var(--text-secondary)', borderTop: '1px dashed var(--border-color)', paddingTop: '16px'}}>
                German Word: <strong style={{color: '#fff'}}>{currentItem.originalWord}</strong>
              </div>

              <button 
                type="button"
                className="feedback-btn good"
                style={{maxWidth: '100%', width: '100%', borderRadius: '12px', padding: '14px', background: isCorrect ? 'var(--color-noun)' : '#3b82f6'}}
                onClick={handleNext}
              >
                Next Sentence ➔
              </button>
            </div>
          )}
        </form>
      </div>

    </div>
  );
}
