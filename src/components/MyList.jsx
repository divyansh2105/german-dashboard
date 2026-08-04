import React, { useState } from 'react';

export default function MyList({ 
  myList, 
  onToggleMyList, 
  onImportMyList,
  syncCode,
  setSyncCode,
  syncStatus,
  syncError,
  onSyncNow
}) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWord, setNewWord] = useState('');
  const [newMeaning, setNewMeaning] = useState('');
  const [newCategory, setNewCategory] = useState('nouns');
  const [newConjugation, setNewConjugation] = useState('');
  const [newExampleDe, setNewExampleDe] = useState('');
  const [newExampleEn, setNewExampleEn] = useState('');
  const [expandedWord, setExpandedWord] = useState(null);

  // Temporary sync code state for the input field
  const [tempCode, setTempCode] = useState(syncCode || '');

  React.useEffect(() => {
    setTempCode(syncCode || '');
  }, [syncCode]);

  const handleSaveCode = () => {
    if (tempCode.trim().length < 3) {
      alert("Sync code must be at least 3 characters long.");
      return;
    }
    setSyncCode(tempCode.trim());
    onSyncNow(tempCode.trim(), myList);
  };

  const handleClearCode = () => {
    if (window.confirm("Disconnect cloud sync? Your list will remain saved on this device local storage.")) {
      setSyncCode('');
      setTempCode('');
    }
  };

  const exportBackup = () => {
    if (myList.length === 0) {
      alert("Your list is empty! Add or star some words first.");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(myList, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `b1_german_mylist_backup.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const importBackup = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          if (onImportMyList) {
            onImportMyList(parsed);
            alert(`Successfully imported and merged ${parsed.length} items into My List!`);
          }
        } else {
          alert("Invalid backup file format. Must be a JSON array of words.");
        }
      } catch (err) {
        alert("Failed to parse JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newWord.trim() || !newMeaning.trim()) return;

    const examples = [];
    if (newExampleDe.trim()) {
      examples.push({
        de: newExampleDe.trim(),
        en: newExampleEn.trim()
      });
    }

    const customItem = {
      word: newWord.trim(),
      meaning: newMeaning.trim(),
      category: newCategory,
      conjugation: newConjugation.trim(),
      examples,
      isCustom: true
    };

    onToggleMyList(customItem);

    // Reset form
    setNewWord('');
    setNewMeaning('');
    setNewCategory('nouns');
    setNewConjugation('');
    setNewExampleDe('');
    setNewExampleEn('');
    setShowAddForm(false);
  };

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
    <div className="explorer-layout animate-fade-in" style={{maxWidth: '850px'}}>
      
      {/* Header controls */}
      <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '12px', marginBottom: '20px'}}>
        <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
          My List ({myList.length} bookmarked & custom words)
        </div>
        
        <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
          {/* Backup Sync Actions */}
          <button
            type="button"
            className="nav-button"
            style={{padding: '8px 12px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', fontSize: '12px'}}
            onClick={exportBackup}
            title="Export My List as JSON backup file to copy to other devices"
          >
            📤 Export
          </button>
          
          <label
            className="nav-button"
            style={{padding: '8px 12px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', fontSize: '12px', cursor: 'pointer', margin: 0}}
            title="Import JSON backup file from another device to merge lists"
          >
            📥 Import
            <input 
              type="file" 
              accept=".json" 
              onChange={importBackup} 
              style={{display: 'none'}} 
            />
          </label>

          <button 
            className="nav-button active"
            onClick={() => setShowAddForm(!showAddForm)}
            style={{padding: '8px 16px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--color-noun), var(--color-verb))'}}
          >
            {showAddForm ? 'Close Form' : '➕ Add Custom Word'}
          </button>
        </div>
      </div>

      {/* Cloud Sync Setup Drawer */}
      <div className="glass-card" style={{padding: '16px', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.15)', marginBottom: '24px', display: 'flex', flexDirection: 'column', gap: '12px'}}>
        <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px'}}>
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <span style={{fontSize: '18px'}}>☁️</span>
            <div>
              <h4 style={{margin: 0, fontSize: '13px', color: 'var(--text-primary)', fontWeight: '700'}}>Cloud Sync Settings (Vercel KV)</h4>
              <p style={{margin: 0, fontSize: '11px', color: 'var(--text-muted)'}}>Enter a secret shared code on your devices to automatically sync and merge your list.</p>
            </div>
          </div>
          
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            {syncStatus === 'syncing' && <span style={{fontSize: '11px', color: 'var(--color-verb)'}}>🔄 Syncing...</span>}
            {syncStatus === 'success' && <span style={{fontSize: '11px', color: 'var(--color-noun)'}}>🟢 Synced to Cloud</span>}
            {syncStatus === 'error' && <span style={{fontSize: '11px', color: '#ef4444'}} title={syncError}>⚠️ Sync Failed</span>}
            {syncStatus === 'idle' && !syncCode && <span style={{fontSize: '11px', color: 'var(--text-muted)'}}>⚪ Local-only mode</span>}
            {syncStatus === 'idle' && syncCode && <span style={{fontSize: '11px', color: 'var(--text-secondary)'}}>🟡 Setup ready</span>}
          </div>
        </div>

        <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center'}}>
          <input 
            type="text" 
            className="search-input" 
            style={{padding: '8px 12px', maxWidth: '240px', fontSize: '12px', height: '36px', minWidth: '150px'}}
            placeholder="Enter a secret sync code..."
            value={tempCode}
            onChange={(e) => setTempCode(e.target.value)}
          />
          <button
            type="button"
            className="nav-button active"
            style={{padding: '6px 14px', borderRadius: '8px', fontSize: '12px', background: 'var(--color-conn)'}}
            onClick={handleSaveCode}
          >
            Save Code
          </button>
          
          {syncCode && (
            <>
              <button
                type="button"
                className="nav-button"
                style={{padding: '6px 14px', borderRadius: '8px', fontSize: '12px', background: 'rgba(255, 255, 255, 0.05)'}}
                onClick={() => onSyncNow(syncCode)}
                disabled={syncStatus === 'syncing'}
              >
                🔄 Force Sync Now
              </button>
              <button
                type="button"
                className="sound-btn"
                style={{fontSize: '11px', color: '#ef4444', width: 'auto', height: 'auto', padding: '6px', borderRadius: '6px'}}
                onClick={handleClearCode}
                title="Disconnect cloud sync"
              >
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>

      {/* Add Custom Word form drawer */}
      {showAddForm && (
        <div className="glass-card total animate-fade-in" style={{width: '100%', padding: '24px', marginBottom: '24px'}}>
          <form onSubmit={handleSubmit} style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
            <h3 style={{fontSize: '14px', color: 'var(--text-primary)', fontWeight: '700', textTransform: 'uppercase', borderBottom: '1px dashed var(--border-color)', paddingBottom: '8px'}}>
              Add New Custom Vocabulary Card
            </h3>
            
            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px'}}>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <label style={{fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600'}}>German Word:*</label>
                <input 
                  type="text" 
                  className="search-input" 
                  style={{padding: '10px'}}
                  placeholder="e.g., das Bier"
                  value={newWord}
                  onChange={(e) => setNewWord(e.target.value)}
                  required
                />
              </div>

              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <label style={{fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600'}}>Meaning (English Translation):*</label>
                <input 
                  type="text" 
                  className="search-input" 
                  style={{padding: '10px'}}
                  placeholder="e.g., beer"
                  value={newMeaning}
                  onChange={(e) => setNewMeaning(e.target.value)}
                  required
                />
              </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px'}}>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <label style={{fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600'}}>Category:*</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="search-input"
                  style={{padding: '10px', height: '42px', color: '#fff', background: '#0c0d14'}}
                >
                  <option value="nouns">Noun</option>
                  <option value="verbs">Verb</option>
                  <option value="adjectives">Adjective / Adverb</option>
                  <option value="connectors">Connector</option>
                </select>
              </div>

              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <label style={{fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600'}}>Conjugation / Plural (optional):</label>
                <input 
                  type="text" 
                  className="search-input" 
                  style={{padding: '10px'}}
                  placeholder="e.g., -e (for nouns) or verb parts"
                  value={newConjugation}
                  onChange={(e) => setNewConjugation(e.target.value)}
                />
              </div>
            </div>

            <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px'}}>
              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <label style={{fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600'}}>Example German Sentence (optional):</label>
                <input 
                  type="text" 
                  className="search-input" 
                  style={{padding: '10px'}}
                  placeholder="e.g., Ich trinke ein kaltes Bier."
                  value={newExampleDe}
                  onChange={(e) => setNewExampleDe(e.target.value)}
                />
              </div>

              <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                <label style={{fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600'}}>Example English Translation (optional):</label>
                <input 
                  type="text" 
                  className="search-input" 
                  style={{padding: '10px'}}
                  placeholder="e.g., I am drinking a cold beer."
                  value={newExampleEn}
                  onChange={(e) => setNewExampleEn(e.target.value)}
                />
              </div>
            </div>

            <button 
              type="submit" 
              className="feedback-btn good"
              style={{alignSelf: 'flex-end', borderRadius: '10px', padding: '10px 24px', marginTop: '8px'}}
            >
              Save to My List
            </button>
          </form>
        </div>
      )}

      {/* Starred words grid */}
      {myList.length === 0 ? (
        <div className="empty-state glass-card" style={{padding: '60px 20px'}}>
          <span style={{fontSize: '48px', marginBottom: '16px', display: 'block'}}>⭐</span>
          <p style={{fontSize: '16px', color: 'var(--text-primary)', fontWeight: '600'}}>Your Personal List is Empty</p>
          <p style={{maxWidth: '460px', margin: '8px auto 0', lineHeight: '1.5'}}>
            Add custom words using the button above, or click the star icon (<strong>☆</strong>) on any card inside the <strong>📖 Word List</strong> tab to bookmark vocabulary items here!
          </p>
        </div>
      ) : (
        <div className="word-grid">
          {myList.map((item, idx) => {
            const isExpanded = expandedWord === item.word;
            // Map list plural categories to singular CSS matching classes
            const cssCategory = item.category === 'nouns' ? 'noun' : (item.category === 'verbs' ? 'verb' : (item.category === 'adjectives' ? 'adjective' : 'connector'));
            
            return (
              <div 
                key={idx}
                className={`glass-card word-card ${cssCategory}`}
                onClick={() => toggleExpand(item.word)}
                style={{display: 'flex', flexDirection: 'column'}}
              >
                <div className="word-card-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <span className="word-title" onClick={(e) => e.stopPropagation()}>{item.word}</span>
                  <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
                    <button 
                      className="sound-btn" 
                      onClick={(e) => speakWord(e, item.word)} 
                      title="Listen Pronunciation"
                      style={{fontSize: '18px', width: '32px', height: '32px'}}
                    >
                      🔊
                    </button>
                    <button 
                      type="button"
                      className="sound-btn" 
                      onClick={(e) => { e.stopPropagation(); onToggleMyList(item); }} 
                      title="Delete from My List"
                      style={{fontSize: '18px', width: '32px', height: '32px', color: '#ef4444'}}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
                
                {item.conjugation && (
                  <div className="word-conjugation" onClick={(e) => e.stopPropagation()}>{item.conjugation}</div>
                )}
                
                <div className="word-meaning" onClick={(e) => e.stopPropagation()}>{item.meaning}</div>

                {/* Starred badges */}
                <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: 'auto', paddingTop: '10px'}}>
                  <span 
                    style={{
                      fontSize: '9px', 
                      fontWeight: '700', 
                      padding: '2px 6px', 
                      borderRadius: '8px', 
                      background: 'rgba(255, 255, 255, 0.05)', 
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-color)',
                      textTransform: 'uppercase'
                    }}
                  >
                    🏷️ {item.category.slice(0, -1)}
                  </span>
                  {item.isCustom && (
                    <span 
                      style={{
                        fontSize: '9px', 
                        fontWeight: '700', 
                        padding: '2px 6px', 
                        borderRadius: '8px', 
                        background: 'rgba(59, 130, 246, 0.15)', 
                        color: 'var(--color-verb)',
                        border: '1px solid rgba(59, 130, 246, 0.25)',
                        textTransform: 'uppercase'
                      }}
                    >
                      ✍️ Custom
                    </span>
                  )}
                </div>
                
                {isExpanded && item.examples && item.examples.length > 0 && (
                  <div className="word-example-section animate-fade-in" onClick={(e) => e.stopPropagation()} style={{marginTop: '12px'}}>
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
