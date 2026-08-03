import React, { useState, useMemo } from 'react';

export default function WordList({ vocabData }) {
  const [activeCategory, setActiveCategory] = useState('nouns');
  const [selectedLetter, setSelectedLetter] = useState('A');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedWord, setExpandedWord] = useState(null);

  // Get active word list
  const activeWords = useMemo(() => {
    return vocabData[activeCategory] || [];
  }, [vocabData, activeCategory]);

  // Find all starting letters available in the active word list
  const availableLetters = useMemo(() => {
    const letters = new Set();
    activeWords.forEach(item => {
      // Clean word to find real first letter (handle parentheses or quotes)
      const clean = item.word.replace(/^["(]*/, '').trim();
      if (clean.length > 0) {
        const firstChar = clean.charAt(0).toUpperCase();
        // Handle German umlauts (Ä -> A, Ö -> O, Ü -> U)
        if (firstChar === 'Ä') letters.add('A');
        else if (firstChar === 'Ö') letters.add('O');
        else if (firstChar === 'Ü') letters.add('U');
        else if (/[A-Z]/.test(firstChar)) {
          letters.add(firstChar);
        }
      }
    });
    return Array.from(letters).sort();
  }, [activeWords]);

  // Reset selected letter when category changes
  React.useEffect(() => {
    if (availableLetters.length > 0) {
      if (!availableLetters.includes(selectedLetter)) {
        setSelectedLetter(availableLetters[0]);
      }
    } else {
      setSelectedLetter('');
    }
  }, [activeCategory, availableLetters]);

  // Filtered words
  const filteredWords = useMemo(() => {
    return activeWords.filter(item => {
      const clean = item.word.replace(/^["(]*/, '').trim();
      const firstChar = clean.charAt(0).toUpperCase();
      const mappedChar = firstChar === 'Ä' ? 'A' : (firstChar === 'Ö' ? 'O' : (firstChar === 'Ü' ? 'U' : firstChar));
      
      const matchesLetter = selectedLetter ? mappedChar === selectedLetter : true;
      
      const query = searchQuery.toLowerCase().trim();
      if (query.length === 0) return matchesLetter;
      
      const matchesQuery = item.word.toLowerCase().includes(query) || 
                           item.meaning.toLowerCase().includes(query);
      
      // If there is a search query, ignore letter filter to make searching global
      return matchesQuery;
    });
  }, [activeWords, selectedLetter, searchQuery]);

  const toggleExpand = (word) => {
    if (expandedWord === word) {
      setExpandedWord(null);
    } else {
      setExpandedWord(word);
    }
  };

  const speakWord = (e, word) => {
    e.stopPropagation();
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(word.replace(/,.*$/, ''));
      utterance.lang = 'de-DE';
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="explorer-layout animate-fade-in">
      <div className="filter-bar">
        <div className="app-nav">
          <button 
            className={`nav-button ${activeCategory === 'nouns' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('nouns'); setSearchQuery(''); }}
          >
            🟢 Nouns ({vocabData.nouns?.length || 0})
          </button>
          <button 
            className={`nav-button ${activeCategory === 'verbs' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('verbs'); setSearchQuery(''); }}
          >
            🔵 Verbs ({vocabData.verbs?.length || 0})
          </button>
          <button 
            className={`nav-button ${activeCategory === 'adjectives' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('adjectives'); setSearchQuery(''); }}
          >
            🟡 Adjectives ({vocabData.adjectives?.length || 0})
          </button>
          <button 
            className={`nav-button ${activeCategory === 'connectors' ? 'active' : ''}`}
            onClick={() => { setActiveCategory('connectors'); setSearchQuery(''); }}
          >
            🟣 Connectors ({vocabData.connectors?.length || 0})
          </button>
        </div>

        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input 
            type="text" 
            className="search-input" 
            placeholder="Search word or translation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Alphabet Index (only visible when not searching) */}
      {searchQuery.trim().length === 0 && (
        <div className="alphabet-bar">
          {"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(letter => {
            const isAvailable = availableLetters.includes(letter);
            return (
              <button
                key={letter}
                className={`letter-btn ${selectedLetter === letter ? 'active' : ''} ${!isAvailable ? 'disabled' : ''}`}
                disabled={!isAvailable}
                onClick={() => setSelectedLetter(letter)}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}

      {/* Words list */}
      {filteredWords.length === 0 ? (
        <div className="empty-state glass-card">
          <p>No words found matching the filters.</p>
        </div>
      ) : (
        <div className="word-grid">
          {filteredWords.map((item, idx) => {
            const isExpanded = expandedWord === item.word;
            return (
              <div 
                key={idx}
                className={`glass-card word-card ${activeCategory.slice(0, -1)}`}
                onClick={() => toggleExpand(item.word)}
              >
                <div className="word-card-header">
                  <span className="word-title">{item.word}</span>
                  <button className="sound-btn" onClick={(e) => speakWord(e, item.word)} title="Listen Pronunciation">
                    🔊
                  </button>
                </div>
                
                {item.conjugation && (
                  <div className="word-conjugation">{item.conjugation}</div>
                )}
                
                <div className="word-meaning">{item.meaning}</div>
                
                {isExpanded && item.examples && item.examples.length > 0 && (
                  <div className="word-example-section animate-fade-in">
                    {item.examples.map((ex, exIdx) => (
                      <div key={exIdx} className="example-item">
                        <p className="example-de">🇩🇪 {ex.de}</p>
                        <p className="example-en">🇬🇧 {ex.en}</p>
                      </div>
                    ))}
                  </div>
                )}
                
                {isExpanded && (!item.examples || item.examples.length === 0) && (
                  <div className="word-example-section text-muted" style={{fontSize: '12px', fontStyle: 'italic'}}>
                    No usage examples listed for this word.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
