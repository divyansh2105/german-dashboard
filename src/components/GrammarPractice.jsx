import React, { useState, useEffect, useRef } from 'react';

const PREPOSITION_GROUPS = {
  Akkusativ: ['bis', 'durch', 'für', 'gegen', 'ohne', 'um'],
  Dativ: ['aus', 'bei', 'mit', 'nach', 'seit', 'von', 'zu', 'gegenüber'],
  Wechsel: ['an', 'auf', 'hinter', 'in', 'neben', 'über', 'unter', 'vor', 'zwischen'],
  Genitiv: ['wegen', 'während', 'trotz', 'statt', 'anstatt']
};

export default function GrammarPractice() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('b1_gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);
  const [tempKey, setTempKey] = useState('');
  
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('b1_gemini_selected_model') || 'gemini-1.5-flash');
  const [availableModels, setAvailableModels] = useState(() => {
    const saved = localStorage.getItem('b1_gemini_available_models');
    return saved ? JSON.parse(saved) : ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];
  });

  // State to track selected prepositions
  const [selectedPreps, setSelectedPreps] = useState(() => {
    // Select all by default
    const all = [];
    Object.values(PREPOSITION_GROUPS).forEach(list => all.push(...list));
    return all;
  });

  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [isListening, setIsListening] = useState(false);
  const [isHolding, setIsHolding] = useState(false);
  const isHoldingRef = useRef(false);
  const recognitionRef = useRef(null);
  const sessionBaseTextRef = useRef('');
  const userInputRef = useRef('');

  useEffect(() => {
    userInputRef.current = userInput;
  }, [userInput]);

  // Speech Recognition setup (Voice-to-Text)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = 'de-DE';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event) => {
        let sessionTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i][0]) {
            sessionTranscript += event.results[i][0].transcript;
          }
        }
        const cleanedSession = sessionTranscript.replace(/[.!?]/g, '').trim().toLowerCase();
        const base = sessionBaseTextRef.current;
        setUserInput(base ? (base + ' ' + cleanedSession) : cleanedSession);
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'aborted') return;
      };

      rec.onend = () => {
        setIsListening(false);

        // Auto-restart if user is still holding the button
        if (isHoldingRef.current) {
          try {
            sessionBaseTextRef.current = userInputRef.current ? userInputRef.current.trim() : '';
            rec.start();
          } catch (err) {
            console.error("Auto-restart failed:", err);
          }
        }
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const handleHoldStart = (e) => {
    if (e) e.preventDefault();
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please try Google Chrome or Safari.");
      return;
    }

    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    setIsHolding(true);
    isHoldingRef.current = true;
    sessionBaseTextRef.current = userInputRef.current ? userInputRef.current.trim() : '';

    try {
      recognitionRef.current.start();
    } catch (err) {
      console.error("Speech start error:", err);
    }
  };

  const handleHoldEnd = (e) => {
    if (e) e.preventDefault();
    if (!recognitionRef.current) return;

    setIsHolding(false);
    isHoldingRef.current = false;

    try {
      recognitionRef.current.stop();
    } catch (err) {
      console.error("Speech stop error:", err);
    }
  };

  // Fetch available models if API key is present
  const fetchModels = async (key) => {
    if (!key) return;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        const names = data.models
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace('models/', ''));
        if (names.length > 0) {
          setAvailableModels(names);
          localStorage.setItem('b1_gemini_available_models', JSON.stringify(names));
        }
      }
    } catch (err) {
      console.error("Error listing models:", err);
    }
  };

  useEffect(() => {
    if (apiKey) {
      fetchModels(apiKey);
    }
  }, [apiKey]);

  const handleSaveKey = (e) => {
    e.preventDefault();
    if (tempKey.trim()) {
      localStorage.setItem('b1_gemini_api_key', tempKey.trim());
      setApiKey(tempKey.trim());
      setShowKeyInput(false);
      setTempKey('');
    }
  };

  const handleRemoveKey = () => {
    if (window.confirm("Are you sure you want to remove the Gemini API Key?")) {
      localStorage.removeItem('b1_gemini_api_key');
      setApiKey('');
      setShowKeyInput(true);
    }
  };

  // Toggle single preposition
  const togglePrep = (prep) => {
    setSelectedPreps(prev => 
      prev.includes(prep) ? prev.filter(p => p !== prep) : [...prev, prep]
    );
  };

  // Toggle entire category group
  const toggleGroup = (groupName) => {
    const groupPreps = PREPOSITION_GROUPS[groupName];
    const allSelected = groupPreps.every(p => selectedPreps.includes(p));
    
    if (allSelected) {
      // Remove all preps of this group
      setSelectedPreps(prev => prev.filter(p => !groupPreps.includes(p)));
    } else {
      // Add missing preps of this group
      setSelectedPreps(prev => {
        const missing = groupPreps.filter(p => !prev.includes(p));
        return [...prev, ...missing];
      });
    }
  };

  const selectAllPreps = () => {
    const all = [];
    Object.values(PREPOSITION_GROUPS).forEach(list => all.push(...list));
    setSelectedPreps(all);
  };

  const selectNonePreps = () => {
    setSelectedPreps([]);
  };

  // Speaks complete German sentence using browser Text-to-Speech
  const speakGermanText = (text) => {
    if (window.speakGerman && text) {
      window.speakGerman(text);
    }
  };

  const generateQuestion = async () => {
    if (selectedPreps.length === 0) {
      alert("Bitte wähle mindestens eine Präposition aus!");
      return;
    }
    
    setIsLoading(true);
    setErrorMsg('');
    setHasChecked(false);
    setUserInput('');
    setCurrentQuestion(null);

    const activePrepsList = selectedPreps.join(', ');
    const promptText = `Generate a single B1 level German sentence. The sentence MUST contain exactly one of these prepositions: [${activePrepsList}]. Replace this preposition in the sentence with three underscores '___' for a blank challenge. Return the result strictly in JSON format.`;

    const systemInstruction = `You are a German grammar teacher generating preposition fill-in-the-blank questions for a B1 student.
You must output exactly a JSON object matching this schema:
{
  "sentence": "German sentence with a single '___' blank representing the missing preposition.",
  "correctPreposition": "The exact preposition that fits in the blank.",
  "translation": "English translation of the German sentence.",
  "explanation": "A grammatical explanation in English detailing why this preposition is correct, which case it governs in this context (Accusative, Dative, Genitive), and if it is part of a verb-preposition idiom (Verben mit Präpositionen)."
}
Do not wrap the JSON output in markdown code blocks. Output raw JSON.`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'Gemini API Error');
      }

      const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawJson) {
        throw new Error('No content returned from Gemini.');
      }

      const parsedQuestion = JSON.parse(rawJson);
      if (!parsedQuestion.sentence || !parsedQuestion.correctPreposition) {
        throw new Error('Invalid question format returned.');
      }

      setCurrentQuestion(parsedQuestion);
    } catch (err) {
      console.error(err);
      setErrorMsg(`Fehler bei der Verbindung mit Gemini: ${err.message}. Bitte API-Key oder Netzwerk prüfen.`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheck = (e) => {
    if (e) e.preventDefault();
    if (!currentQuestion || hasChecked) return;

    const normalizedUser = userInput.trim().toLowerCase();
    const normalizedCorrect = currentQuestion.correctPreposition.trim().toLowerCase();

    const correct = normalizedUser === normalizedCorrect;
    setIsCorrect(correct);
    setHasChecked(true);

    // Speak the complete German sentence with correct answer filled in
    const fullSentence = currentQuestion.sentence.replace('___', currentQuestion.correctPreposition);
    speakGermanText(fullSentence);
  };

  if (showKeyInput) {
    return (
      <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '550px', padding: '20px' }}>
        <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', width: '100%' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔑</div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '12px', color: '#fff' }}>Gemini API-Schlüssel</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.5' }}>
            Der Grammatik-Trainer benötigt einen Gemini API-Schlüssel.<br/>
            Dein Schlüssel wird <strong>nur lokal im Browser gespeichert</strong> und nicht geteilt.
          </p>
          
          <form onSubmit={handleSaveKey} style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '100%' }}>
            <input
              type="password"
              className="search-input"
              style={{ textAlign: 'center', padding: '14px', borderRadius: '10px', fontSize: '15px' }}
              placeholder="Füge deinen Gemini API-Key hier ein..."
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              required
            />
            <button type="submit" className="feedback-btn good" style={{ padding: '12px', borderRadius: '10px' }}>
              Schlüssel Speichern 💾
            </button>
          </form>

          <div style={{ marginTop: '20px', fontSize: '13px' }}>
            <a 
              href="https://aistudio.google.com/" 
              target="_blank" 
              rel="noopener noreferrer" 
              style={{ color: 'var(--color-verb)', textDecoration: 'underline', fontWeight: '600' }}
            >
              Kostenlosen API-Key bei Google AI Studio erstellen ➔
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '800px', width: '100%', gap: '20px' }}>
      
      {/* Settings bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          📝 Grammar Preposition Challenge
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
              localStorage.setItem('b1_gemini_selected_model', e.target.value);
            }}
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              height: '28px',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              color: '#fff',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
            title="Wähle das Gemini-Modell"
          >
            {availableModels.map(model => (
              <option key={model} value={model} style={{ background: '#090a0f', color: '#fff' }}>
                {model}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleRemoveKey}
            className="sound-btn"
            title="API-Schlüssel verwalten"
            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', borderRadius: '8px' }}
          >
            ⚙️ Key
          </button>
        </div>
      </div>

      {/* Main interface layout splits into selector on left/top and exercise on right/bottom */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', width: '100%', flexWrap: 'wrap' }}>
        
        {/* Left Side: Prepositions filter list */}
        <div className="glass-card" style={{ flex: '1 1 250px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <span style={{ fontSize: '14px', fontWeight: '700', color: '#fff' }}>Präpositionen</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span onClick={selectAllPreps} style={{ fontSize: '11px', color: 'var(--color-verb)', cursor: 'pointer', fontWeight: '600' }}>All</span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>|</span>
              <span onClick={selectNonePreps} style={{ fontSize: '11px', color: '#ef4444', cursor: 'pointer', fontWeight: '600' }}>None</span>
            </div>
          </div>

          <div style={{ overflowY: 'auto', maxHeight: '380px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {Object.keys(PREPOSITION_GROUPS).map(groupName => {
              const preps = PREPOSITION_GROUPS[groupName];
              const groupSelected = preps.every(p => selectedPreps.includes(p));
              const someSelected = preps.some(p => selectedPreps.includes(p)) && !groupSelected;
              
              let groupColor = 'var(--color-conn)';
              if (groupName === 'Akkusativ') groupColor = 'var(--color-noun)';
              if (groupName === 'Dativ') groupColor = 'var(--color-verb)';
              if (groupName === 'Wechsel') groupColor = 'var(--color-adj)';
              if (groupName === 'Genitiv') groupColor = 'var(--color-reflexive)';

              return (
                <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div 
                    onClick={() => toggleGroup(groupName)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      cursor: 'pointer', 
                      fontSize: '12.5px', 
                      fontWeight: '700', 
                      color: groupColor
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={groupSelected}
                      ref={el => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={() => {}} // handled by parent onClick
                      style={{ cursor: 'pointer', accentColor: groupColor }}
                    />
                    {groupName} ({preps.length})
                  </div>
                  
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingLeft: '20px' }}>
                    {preps.map(prep => {
                      const active = selectedPreps.includes(prep);
                      return (
                        <button
                          key={prep}
                          type="button"
                          onClick={() => togglePrep(prep)}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid',
                            borderColor: active ? groupColor : 'var(--border-color)',
                            background: active ? `rgba(255, 255, 255, 0.04)` : 'transparent',
                            color: active ? '#fff' : 'var(--text-muted)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          {prep}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Generated sentence and input challenge */}
        <div className="glass-card" style={{ flex: '2 1 450px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '350px', position: 'relative' }}>
          
          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', width: '100%', height: '100%', minHeight: '260px' }}>
              <div style={{ fontSize: '32px', animation: 'spin 1.5s linear infinite' }}>🔄</div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }} className="animate-pulse">
                Gemini generiert einen Präpositionalsatz...
              </div>
            </div>
          )}

          {errorMsg && (
            <div style={{ textAlign: 'center', color: '#ef4444', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', minHeight: '260px' }}>
              <div style={{ fontSize: '36px' }}>⚠️</div>
              <p style={{ fontSize: '14px', maxWidth: '380px', lineHeight: '1.5' }}>{errorMsg}</p>
              <button onClick={generateQuestion} className="feedback-btn good" style={{ maxWidth: '180px', padding: '10px' }}>
                Erneut versuchen 🔄
              </button>
            </div>
          )}

          {!currentQuestion && !isLoading && !errorMsg && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', minHeight: '260px', textAlign: 'center' }}>
              <div style={{ fontSize: '48px' }}>📝</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff' }}>Präpositionen Trainieren</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', maxWidth: '340px', lineHeight: '1.5' }}>
                  Wähle links die Präpositionen aus, die du üben möchtest, und klicke auf Generieren.
                </p>
              </div>
              <button 
                onClick={generateQuestion} 
                className="feedback-btn good" 
                style={{ padding: '12px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: '700', width: 'auto', maxWidth: 'none' }}
                disabled={selectedPreps.length === 0}
              >
                Satz Generieren ➔
              </button>
            </div>
          )}

          {currentQuestion && !isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.3s ease' }}>
              
              {/* Question display */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                  Setze die richtige Präposition ein:
                </div>
                
                {/* Large sentence display */}
                <div style={{ 
                  fontSize: '22px', 
                  fontWeight: '700', 
                  lineHeight: '1.6', 
                  color: '#fff', 
                  padding: '16px', 
                  background: 'rgba(255, 255, 255, 0.02)', 
                  border: '1px solid var(--border-color)', 
                  borderRadius: '12px',
                  textAlign: 'center'
                }}>
                  {hasChecked ? (
                    <span>
                      {currentQuestion.sentence.split('___')[0]}
                      <strong style={{ color: isCorrect ? 'var(--color-noun)' : '#ef4444', borderBottom: isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444', padding: '0 4px' }}>
                        {currentQuestion.correctPreposition}
                      </strong>
                      {currentQuestion.sentence.split('___')[1]}
                    </span>
                  ) : (
                    currentQuestion.sentence
                  )}
                </div>

                {/* Translation subtitle */}
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', fontStyle: 'italic', textAlign: 'center' }}>
                  🇬🇧 "{currentQuestion.translation}"
                </div>
              </div>

              {/* Form Input */}
              <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', width: '100%', gap: '10px', alignItems: 'center' }}>
                  <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="search-input"
                      placeholder={isListening ? "Zuhören... Sprich jetzt..." : "Präposition eintippen..."}
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      disabled={hasChecked}
                      style={{ 
                        textAlign: 'center', 
                        fontSize: '16px', 
                        padding: '12px 75px 12px 16px', 
                        borderRadius: '10px',
                        border: hasChecked
                          ? (isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444')
                          : '1px solid var(--border-color)',
                        outline: 'none',
                        width: '100%',
                        height: '46px'
                      }}
                      autoFocus
                      autoComplete="off"
                    />

                    <div style={{ position: 'absolute', right: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {userInput.length > 0 && !hasChecked && (
                        <button
                          type="button"
                          onClick={() => setUserInput('')}
                          style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', padding: '4px' }}
                          title="Eingabefeld resetten"
                        >
                          ❌
                        </button>
                      )}

                      {!hasChecked && (
                        <button
                          type="button"
                          onMouseDown={handleHoldStart}
                          onMouseUp={handleHoldEnd}
                          onMouseLeave={handleHoldEnd}
                          onTouchStart={handleHoldStart}
                          onTouchEnd={handleHoldEnd}
                          style={{
                            background: isListening ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                            border: isListening ? '1.5px solid #ef4444' : '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: isListening ? '#ef4444' : 'var(--text-secondary)',
                            cursor: 'pointer',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s',
                            userSelect: 'none',
                            touchAction: 'none'
                          }}
                          title="Hold to speak, release to pause"
                        >
                          🎙️
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Speaker helper for full sentence */}
                  {hasChecked && (
                    <button
                      type="button"
                      className="sound-btn"
                      onClick={() => {
                        const full = currentQuestion.sentence.replace('___', currentQuestion.correctPreposition);
                        speakGermanText(full);
                      }}
                      style={{ width: '46px', height: '46px', fontSize: '18px', padding: 0, justifyContent: 'center', alignItems: 'center', borderRadius: '10px', flexShrink: 0 }}
                      title="Satz anhören"
                    >
                      🔊
                    </button>
                  )}
                </div>

                {/* Feedback panel post validation */}
                {hasChecked && (
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '12px', animation: 'fadeIn 0.3s ease' }}>
                    {/* Badge */}
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      fontSize: '14px', 
                      fontWeight: '700',
                      color: isCorrect ? 'var(--color-noun)' : '#ef4444'
                    }}>
                      {isCorrect ? '✅ Richtig!' : `❌ Falsch! Richtig ist: ${currentQuestion.correctPreposition}`}
                    </div>

                    {/* Explanatory notes */}
                    <div style={{ 
                      background: 'rgba(255, 255, 255, 0.03)', 
                      borderLeft: isCorrect ? '3px solid var(--color-noun)' : '3px solid #ef4444', 
                      padding: '12px 16px', 
                      borderRadius: '4px',
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.5'
                    }}>
                      <strong>Grammatik-Erklärung:</strong> {currentQuestion.explanation}
                    </div>
                  </div>
                )}

                {/* Submissions or Next triggers */}
                {!hasChecked ? (
                  <button 
                    type="submit" 
                    className="feedback-btn good"
                    disabled={!userInput.trim()}
                    style={{ width: '100%', maxWidth: '240px', padding: '12px', borderRadius: '10px', fontSize: '14px' }}
                  >
                    Antwort prüfen ✔️
                  </button>
                ) : (
                  <button 
                    type="button" 
                    onClick={generateQuestion} 
                    className="feedback-btn good"
                    style={{ width: '100%', maxWidth: '240px', padding: '12px', borderRadius: '10px', fontSize: '14px', background: 'var(--color-verb)', border: '1px solid rgba(59,130,246,0.3)' }}
                  >
                    Nächster Satz ➔
                  </button>
                )}
              </form>
              {!hasChecked && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center', fontStyle: 'italic' }}>
                  💡 Halt das Mikrofon-Symbol 🎙️ gedrückt, um zu sprechen. Lass los, um zu pausieren.
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
