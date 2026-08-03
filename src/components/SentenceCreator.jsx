import React, { useState, useEffect, useMemo } from 'react';

export default function SentenceCreator({ vocabData, onReview }) {
  const [noun, setNoun] = useState(null);
  const [verb, setVerb] = useState(null);
  const [connector, setConnector] = useState(null);
  const [userSentence, setUserSentence] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [validation, setValidation] = useState({ nounOk: false, verbOk: false, connectorOk: false });

  // Helper to get random item from array
  const getRandomItem = (arr) => {
    if (!arr || arr.length === 0) return null;
    const idx = Math.floor(Math.random() * arr.length);
    return arr[idx];
  };

  // Roll a new challenge
  const rollChallenge = () => {
    setNoun(getRandomItem(vocabData.nouns));
    setVerb(getRandomItem(vocabData.verbs));
    setConnector(getRandomItem(vocabData.connectors));
    setUserSentence('');
    setShowFeedback(false);
    setValidation({ nounOk: false, verbOk: false, connectorOk: false });
  };

  // Roll on mount
  useEffect(() => {
    rollChallenge();
  }, [vocabData]);

  // Helper to extract forms of a vocab item
  const getWordForms = (item) => {
    if (!item) return [];
    let cleanRoot = item.word
      .replace(/^(der|die|das|ein|eine|sich)\s+/i, '')
      .replace(/\(.*\)/g, '')
      .replace(/,.*$/, '')
      .trim()
      .toLowerCase();
      
    const forms = new Set();
    if (cleanRoot.length > 2) forms.add(cleanRoot);
    
    if (item.conjugation) {
      item.conjugation.split(',').forEach(p => {
        let cleanP = p.replace(/^(ist|hat|zu)\s+/i, '').trim().toLowerCase();
        if (cleanP.length > 2) forms.add(cleanP);
      });
    }
    
    cleanRoot.split(/\s+/).forEach(w => {
      if (w.length > 2) forms.add(w);
    });

    return Array.from(forms);
  };

  // Verify presence of words in sentence
  const checkWordInSentence = (sentence, item) => {
    if (!item) return false;
    const cleanSentence = sentence.toLowerCase().replace(/[^a-zäöüß]/g, ' ');
    const forms = getWordForms(item);
    
    return forms.some(form => {
      // Check if substring matches or word boundary matches
      return cleanSentence.includes(form);
    });
  };

  const handleVerify = (e) => {
    e.preventDefault();
    if (!noun || !verb || !connector || !userSentence.trim()) return;

    const nounOk = checkWordInSentence(userSentence, noun);
    const verbOk = checkWordInSentence(userSentence, verb);
    const connectorOk = checkWordInSentence(userSentence, connector);

    setValidation({ nounOk, verbOk, connectorOk });
    setShowFeedback(true);

    const allOk = nounOk && verbOk && connectorOk;
    // Log review logs
    onReview(`${noun.word} + ${verb.word} + ${connector.word}`, 'writing', allOk ? 'good' : 'hard');
  };

  if (!noun || !verb || !connector) {
    return (
      <div className="flashcard-layout animate-fade-in">
        <div className="empty-state glass-card">
          <p>Unable to load words. Please check your vocabulary data.</p>
        </div>
      </div>
    );
  }

  const allWordsIncluded = validation.nounOk && validation.verbOk && validation.connectorOk;

  return (
    <div className="flashcard-layout animate-fade-in" style={{maxWidth: '850px'}}>
      
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
        <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
          Creative Sentence Writing Challenge
        </div>
        <button 
          className="nav-button active" 
          onClick={rollChallenge}
          style={{padding: '8px 16px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--color-conn), var(--color-verb))'}}
        >
          🎲 Roll New Challenge
        </button>
      </div>

      {/* Target Words Columns */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', width: '100%'}}>
        
        {/* Noun Card */}
        <div className="glass-card noun" style={{padding: '20px', display: 'flex', flexDirection: 'column'}}>
          <span className="category-tag nouns" style={{alignSelf: 'flex-start', marginBottom: '12px'}}>Noun</span>
          <div style={{fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '8px'}}>{noun.word}</div>
          <div style={{fontSize: '14px', color: 'var(--text-secondary)'}}>{noun.meaning}</div>
        </div>

        {/* Verb Card */}
        <div className="glass-card verb" style={{padding: '20px', display: 'flex', flexDirection: 'column'}}>
          <span className="category-tag verbs" style={{alignSelf: 'flex-start', marginBottom: '12px'}}>Verb</span>
          <div style={{fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '8px'}}>{verb.word}</div>
          <div style={{fontSize: '13px', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '8px'}}>
            {verb.conjugation}
          </div>
          <div style={{fontSize: '14px', color: 'var(--text-secondary)', marginTop: 'auto'}}>{verb.meaning}</div>
        </div>

        {/* Connector Card */}
        <div className="glass-card conn" style={{padding: '20px', display: 'flex', flexDirection: 'column'}}>
          <span className="category-tag connectors" style={{alignSelf: 'flex-start', marginBottom: '12px'}}>Connector</span>
          <div style={{fontSize: '20px', fontWeight: '700', color: '#fff', marginBottom: '8px'}}>{connector.word}</div>
          <div style={{fontSize: '14px', color: 'var(--text-secondary)'}}>{connector.meaning}</div>
        </div>

      </div>

      {/* Input Form & Verification */}
      <div className="glass-card total" style={{width: '100%', padding: '32px'}}>
        <form onSubmit={handleVerify} style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
          <h3 style={{fontSize: '15px', color: 'var(--text-secondary)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
            Write your coherent German sentence below:
          </h3>
          
          <textarea
            className="search-input"
            style={{
              width: '100%',
              minHeight: '100px',
              resize: 'vertical',
              fontSize: '16px',
              lineHeight: '1.5',
              padding: '16px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.01)',
              border: showFeedback
                ? (allWordsIncluded ? '2px solid var(--color-noun)' : '2px solid #ef4444')
                : '1px solid var(--border-color)'
            }}
            placeholder={`E.g., "Ich fahre mit der U-Bahn, obwohl ich ein Auto habe."`}
            value={userSentence}
            onChange={(e) => setUserSentence(e.target.value)}
            disabled={showFeedback}
          />

          {!showFeedback ? (
            <button
              type="submit"
              className="feedback-btn good"
              style={{alignSelf: 'center', width: '100%', maxWidth: '300px', borderRadius: '12px', padding: '14px'}}
              disabled={!userSentence.trim()}
            >
              Check Checklist
            </button>
          ) : (
            <div className="animate-fade-in" style={{display: 'flex', flexDirection: 'column', gap: '24px'}}>
              
              {/* Word check feedback list */}
              <div style={{display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center'}}>
                <span style={{color: validation.nounOk ? 'var(--color-noun)' : '#ef4444', fontWeight: '700'}}>
                  {validation.nounOk ? '🟢' : '🔴'} Noun: {noun.word.replace(/,.*$/, '')}
                </span>
                <span style={{color: validation.verbOk ? 'var(--color-noun)' : '#ef4444', fontWeight: '700'}}>
                  {validation.verbOk ? '🟢' : '🔴'} Verb: {verb.word.replace(/,.*$/, '')}
                </span>
                <span style={{color: validation.connectorOk ? 'var(--color-noun)' : '#ef4444', fontWeight: '700'}}>
                  {validation.connectorOk ? '🟢' : '🔴'} Connector: {connector.word.replace(/,.*$/, '')}
                </span>
              </div>

              {allWordsIncluded ? (
                <div style={{color: 'var(--color-noun)', fontWeight: '700', textAlign: 'center'}}>
                  Richtig! Your sentence successfully uses all three words! 🎉
                </div>
              ) : (
                <div style={{color: '#ef4444', fontWeight: '700', textAlign: 'center'}}>
                  Some target words are missing from your sentence. Edit and try again!
                </div>
              )}

              {/* Reveal example sentences from dictionary for study */}
              <div style={{borderTop: '1px dashed var(--border-color)', paddingTop: '20px'}}>
                <h4 style={{fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                  Dictionary Examples for Reference:
                </h4>
                <div style={{display: 'flex', flexDirection: 'column', gap: '16px'}}>
                  
                  {noun.examples && noun.examples.length > 0 && (
                    <div>
                      <strong style={{color: 'var(--color-noun)', fontSize: '13px'}}>Noun Example:</strong>
                      <p style={{fontStyle: 'italic', fontSize: '14px', marginTop: '4px'}}>🇩🇪 {noun.examples[0].de}</p>
                      <p style={{fontSize: '13px', color: 'var(--text-secondary)'}}>🇬🇧 {noun.examples[0].en}</p>
                    </div>
                  )}

                  {verb.examples && verb.examples.length > 0 && (
                    <div>
                      <strong style={{color: 'var(--color-verb)', fontSize: '13px'}}>Verb Example:</strong>
                      <p style={{fontStyle: 'italic', fontSize: '14px', marginTop: '4px'}}>🇩🇪 {verb.examples[0].de}</p>
                      <p style={{fontSize: '13px', color: 'var(--text-secondary)'}}>🇬🇧 {verb.examples[0].en}</p>
                    </div>
                  )}

                  {connector.examples && connector.examples.length > 0 && (
                    <div>
                      <strong style={{color: 'var(--color-conn)', fontSize: '13px'}}>Connector Example:</strong>
                      <p style={{fontStyle: 'italic', fontSize: '14px', marginTop: '4px'}}>🇩🇪 {connector.examples[0].de}</p>
                      <p style={{fontSize: '13px', color: 'var(--text-secondary)'}}>🇬🇧 {connector.examples[0].en}</p>
                    </div>
                  )}

                </div>
              </div>

              <div style={{display: 'flex', gap: '12px', justifyContent: 'center'}}>
                {!allWordsIncluded && (
                  <button 
                    type="button"
                    className="nav-button"
                    style={{
                      borderRadius: '12px', 
                      padding: '12px 24px', 
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                      justifyContent: 'center'
                    }}
                    onClick={() => setShowFeedback(false)}
                  >
                    ✏️ Edit Sentence
                  </button>
                )}
                <button 
                  type="button"
                  className="feedback-btn good"
                  style={{borderRadius: '12px', padding: '12px 24px', background: 'linear-gradient(135deg, var(--color-conn), var(--color-verb))', maxWidth: 'none'}}
                  onClick={rollChallenge}
                >
                  Next Challenge ➔
                </button>
              </div>

            </div>
          )}
        </form>
      </div>

    </div>
  );
}
