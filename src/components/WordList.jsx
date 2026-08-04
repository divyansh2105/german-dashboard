import React, { useState, useMemo } from 'react';

const CLASS_CATEGORIES = [
  "Arbeit, Beruf & Büro",
  "Gesundheit, Körper & Medizin",
  "Wohnen, Haushalt & Umzug",
  "Reise, Verkehr & Mobilität",
  "Einkaufen, Geld & Finanzen",
  "Essen, Trinken & Gastronomie",
  "Ausbildung, Schule & Wissenschaft",
  "Kommunikation, Medien & Technik",
  "Freizeit, Hobby & Sport",
  "Natur, Umwelt & Wetter",
  "Staat, Gesellschaft & Recht",
  "Familie, Mensch & Beziehungen",
  "Zeit, Datum & Dokumente",
  "Emotionen, Geist & Wahrnehmung",
  "Abstrakte Begriffe & Handlungen"
];

// Helper to get first letter of actual noun/verb, ignoring der/die/das/ein/eine/sich
const getActualWordFirstLetter = (word) => {
  let w = word.trim();
  w = w.replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
       .replace(/\(sich(\s+etwas)?\)\s+/i, '')
       .replace(/^["(]*/, '')
       .trim();
       
  if (w.length === 0) return '';
  const firstChar = w.charAt(0).toUpperCase();
  if (firstChar === 'Ä') return 'A';
  if (firstChar === 'Ö') return 'O';
  if (firstChar === 'Ü') return 'U';
  
  return /[A-Z]/.test(firstChar) ? firstChar : '';
};

const normalizeCategory = (cat) => {
  if (!cat) return '';
  return cat.toLowerCase()
            .replace(/&amp;/g, '&')
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]/g, '')
            .trim();
};

export default function WordList({ vocabData, myList = [], onToggleMyList }) {
  const [activeCategory, setActiveCategory] = useState('nouns');
  const [selectedLetter, setSelectedLetter] = useState('A');
  const [selectedClassFilter, setSelectedClassFilter] = useState('all');
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
      const firstLetter = getActualWordFirstLetter(item.word);
      if (firstLetter) {
        letters.add(firstLetter);
      }
    });
    return Array.from(letters).sort();
  }, [activeWords]);

  // Reset filters when active category changes
  React.useEffect(() => {
    setSelectedClassFilter('all');
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
      // 1. Classification Category Filter (only for nouns and verbs)
      if ((activeCategory === 'nouns' || activeCategory === 'verbs') && selectedClassFilter !== 'all') {
        const target = normalizeCategory(selectedClassFilter);
        const matchesClass = normalizeCategory(item.primaryCategory) === target || normalizeCategory(item.secondaryCategory) === target;
        if (!matchesClass) return false;
      }

      // 2. Search Query Filter (globally searches German & English meaning)
      const query = searchQuery.toLowerCase().trim();
      if (query.length > 0) {
        return item.word.toLowerCase().includes(query) || item.meaning.toLowerCase().includes(query);
      }

      // 3. Alphabetical Letter Filter (ignored if classification filter is active)
      if ((activeCategory === 'nouns' || activeCategory === 'verbs') && selectedClassFilter !== 'all') {
        return true;
      }
      
      const firstLetter = getActualWordFirstLetter(item.word);
      return selectedLetter ? firstLetter === selectedLetter : true;
    });
  }, [activeWords, selectedLetter, searchQuery, selectedClassFilter, activeCategory]);

  const toggleExpand = (word) => {
    if (expandedWord === word) {
      setExpandedWord(null);
    } else {
      setExpandedWord(word);
    }
  };

  const speakWord = (e, word) => {
    e.stopPropagation();
    if (window.speakGerman) {
      window.speakGerman(word.replace(/,.*$/, ''));
    }
  };

  const speakSentence = (e, sentence) => {
    e.stopPropagation();
    if (window.speakGerman) {
      window.speakGerman(sentence);
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

        {/* Classification Filter Dropdown */}
        {(activeCategory === 'nouns' || activeCategory === 'verbs') && (
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <span style={{fontSize: '14px', color: 'var(--text-secondary)', fontWeight: '600'}}>Category:</span>
            <select
              value={selectedClassFilter}
              onChange={(e) => { setSelectedClassFilter(e.target.value); setSelectedLetter(''); }}
              className="search-input"
              style={{padding: '8px 12px', minWidth: '220px', fontSize: '14px', cursor: 'pointer', height: '42px'}}
            >
              <option value="all">All Categories</option>
              {CLASS_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
        )}

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

      {/* Alphabet Index (only visible when not searching and no category classification filter is selected) */}
      {searchQuery.trim().length === 0 && selectedClassFilter === 'all' && (
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
            const isStarred = myList.some(starredItem => starredItem.word.toLowerCase() === item.word.toLowerCase());
            return (
              <div 
                key={idx}
                className={`glass-card word-card ${activeCategory.slice(0, -1)}`}
                onClick={() => toggleExpand(item.word)}
                style={{display: 'flex', flexDirection: 'column'}}
              >
                <div className="word-card-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <span className="word-title">{item.word}</span>
                  <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                    <button className="sound-btn" onClick={(e) => speakWord(e, item.word)} title="Listen Pronunciation" style={{fontSize: '18px', width: '32px', height: '32px'}}>
                      🔊
                    </button>
                    {onToggleMyList && (
                      <button 
                        type="button" 
                        className="sound-btn" 
                        onClick={(e) => { e.stopPropagation(); onToggleMyList({ ...item, category: activeCategory }); }} 
                        title={isStarred ? "Remove from My List" : "Add to My List"}
                        style={{fontSize: '18px', width: '32px', height: '32px', color: isStarred ? '#eab308' : 'var(--text-muted)'}}
                      >
                        {isStarred ? '★' : '☆'}
                      </button>
                    )}
                  </div>
                </div>
                
                {item.conjugation && (
                  <div className="word-conjugation">{item.conjugation}</div>
                )}
                
                <div className="word-meaning">{item.meaning}</div>

                {/* Primary and Secondary Class Badges */}
                {(activeCategory === 'nouns' || activeCategory === 'verbs') && (
                  <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '10px'}}>
                    {item.primaryCategory && (
                      <span 
                        style={{
                          fontSize: '10px', 
                          fontWeight: '700', 
                          padding: '3px 8px', 
                          borderRadius: '10px', 
                          background: 'rgba(255, 255, 255, 0.05)', 
                          color: 'var(--text-secondary)',
                          border: '1px solid var(--border-color)'
                        }}
                      >
                        🏷️ {item.primaryCategory}
                      </span>
                    )}
                    {item.secondaryCategory && (
                      <span 
                        style={{
                          fontSize: '10px', 
                          fontWeight: '700', 
                          padding: '3px 8px', 
                          borderRadius: '10px', 
                          background: 'rgba(255, 255, 255, 0.02)', 
                          color: 'var(--text-muted)',
                          border: '1px dashed var(--border-color)'
                        }}
                      >
                        🏷️ {item.secondaryCategory}
                      </span>
                    )}
                  </div>
                )}
                
                {isExpanded && item.examples && item.examples.length > 0 && (
                  <div className="word-example-section animate-fade-in" style={{marginTop: '12px'}}>
                    {item.examples.map((ex, exIdx) => (
                      <div key={exIdx} className="example-item" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', margin: '8px 0'}}>
                        <div style={{flexGrow: 1, textAlign: 'left'}}>
                          <p className="example-de" style={{margin: 0}}>🇩🇪 {ex.de}</p>
                          <p className="example-en" style={{margin: '2px 0 0'}}>🇬🇧 {ex.en}</p>
                        </div>
                        <button 
                          className="sound-btn" 
                          onClick={(e) => speakSentence(e, ex.de)} 
                          title="Listen to sentence"
                        >
                          🔊
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                
                {isExpanded && (!item.examples || item.examples.length === 0) && (
                  <div className="word-example-section text-muted" style={{fontSize: '12px', fontStyle: 'italic', marginTop: '12px'}}>
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
