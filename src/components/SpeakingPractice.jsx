import React, { useState, useEffect, useRef, useMemo } from 'react';

export default function SpeakingPractice() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('b1_gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);
  const [tempKey, setTempKey] = useState('');

  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem('b1_gemini_selected_model') || 'gemini-1.5-flash');
  const [availableModels, setAvailableModels] = useState(() => {
    const saved = localStorage.getItem('b1_gemini_available_models');
    return saved ? JSON.parse(saved) : ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash-exp'];
  });

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
          
          if (!names.includes(selectedModel)) {
            const flash = names.find(n => n.includes('flash'));
            const finalModel = flash || names[0];
            setSelectedModel(finalModel);
            localStorage.setItem('b1_gemini_selected_model', finalModel);
          }
        }
      }
    } catch (err) {
      console.error("Error listing Gemini models:", err);
    }
  };

  useEffect(() => {
    if (apiKey) {
      fetchModels(apiKey);
    }
  }, [apiKey]);
  
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('b1_speaking_chat_history');
    return saved ? JSON.parse(saved) : [
      {
        role: 'model',
        text: 'Hallo! Ich bin dein Gemini-Sprachpartner. Lass uns auf Deutsch unterhalten! Worüber möchtest du heute sprechen?'
      }
    ];
  });
  
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const sessionBaseTextRef = useRef('');

  // Persist messages
  useEffect(() => {
    localStorage.setItem('b1_speaking_chat_history', JSON.stringify(messages));
    // Auto-scroll to bottom
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
        isListeningRef.current = true;
      };

      rec.onresult = (event) => {
        let sessionTranscript = '';
        for (let i = 0; i < event.results.length; ++i) {
          if (event.results[i][0]) {
            sessionTranscript += event.results[i][0].transcript;
          }
        }
        const cleanedSession = sessionTranscript.replace(/[.!?]/g, '').trim();
        const base = sessionBaseTextRef.current;
        setUserInput(base ? (base + ' ' + cleanedSession) : cleanedSession);
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'aborted') return;
      };

      rec.onend = () => {
        setIsListening(false);
        isListeningRef.current = false;
      };

      recognitionRef.current = rec;
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const toggleSpeech = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. Please try Google Chrome or Safari.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      sessionBaseTextRef.current = userInput ? userInput.trim() : '';
      recognitionRef.current.start();
    }
  };

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
    if (window.confirm("Are you sure you want to remove the Gemini API Key from this browser?")) {
      localStorage.removeItem('b1_gemini_api_key');
      setApiKey('');
      setShowKeyInput(true);
    }
  };

  // Speaks Gemini's German responses out loud
  const speakGermanText = (text) => {
    if (window.speakGerman) {
      // Remove any parenthetical grammar tips from the audio spoken output
      const cleanAudioText = text.replace(/\(.*?\)/g, '').trim();
      window.speakGerman(cleanAudioText);
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const promptText = userInput.trim();
    if (!promptText || isLoading) return;

    // Abort speech listening if active
    if (recognitionRef.current && isListeningRef.current) {
      recognitionRef.current.stop();
    }

    const newMessages = [...messages, { role: 'user', text: promptText }];
    setMessages(newMessages);
    setUserInput('');
    setIsLoading(true);

    try {
      // Format history for Gemini contents array
      // Gemini expects roles: "user" and "model"
      const contentsPayload = newMessages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));

      const systemInstructionText = `You are a friendly German conversation partner helping a student practice for their B1 German exam. Speak ONLY in clear, natural, grammatically correct German suitable for a B1 learner. Keep your responses relatively short (2-3 sentences max) so it feels like a real conversation. Occasionally ask B1-level questions to keep the conversation going. Try to use common B1 vocabulary. If the user makes a minor grammatical or spelling error, briefly correct them inside parentheses at the very start of your response, e.g. '(Grammatik-Tipp: "Ich habe gegangen" -> "Ich bin gegangen")' before continuing the conversation.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: contentsPayload,
            systemInstruction: {
              parts: [{ text: systemInstructionText }]
            }
          })
        }
      );

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || 'API error occurred');
      }

      const geminiText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Entschuldigung, ich konnte keine Antwort generieren.';
      
      setMessages(prev => [...prev, { role: 'model', text: geminiText }]);
      speakGermanText(geminiText);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: `⚠️ Fehler bei der Verbindung mit Gemini: ${err.message}. Bitte überprüfe deinen API-Schlüssel.` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClearHistory = () => {
    if (window.confirm("Möchtest du den Gesprächsverlauf zurücksetzen?")) {
      setMessages([
        {
          role: 'model',
          text: 'Hallo! Ich bin dein Gemini-Sprachpartner. Lass uns auf Deutsch unterhalten! Worüber möchtest du heute sprechen?'
        }
      ]);
    }
  };

  const startTopic = (topicText) => {
    setUserInput(topicText);
  };

  // Render Key input view if no key
  if (showKeyInput) {
    return (
      <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '550px', padding: '20px' }}>
        <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', width: '100%' }}>
          <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔑</div>
          <h2 style={{ fontSize: '22px', fontWeight: '800', marginBottom: '12px', color: '#fff' }}>Gemini API-Schlüssel</h2>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px', lineHeight: '1.5' }}>
            Um eine Konversation zu führen, benötigst du einen kostenlosen Gemini API-Schlüssel.<br/>
            Dein Schlüssel wird <strong>nur lokal in deinem Browser gespeichert</strong> und niemals ins Netz oder auf Github geladen.
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
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '800px', width: '100%' }}>
      {/* Speaking header options */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '10px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
          🗣️ Gemini Konversationspartner (B1 Deutsch)
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {/* Model Selector Dropdown */}
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
            onClick={handleClearHistory}
            className="sound-btn"
            title="Chatverlauf zurücksetzen"
            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '8px' }}
          >
            🗑️ Reset
          </button>
          <button
            type="button"
            onClick={handleRemoveKey}
            className="sound-btn"
            title="API-Schlüssel verwalten"
            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)', borderRadius: '8px' }}
          >
            ⚙️ Key
          </button>
        </div>
      </div>

      {/* Main chat window container */}
      <div className="glass-card" style={{ width: '100%', height: '520px', display: 'flex', flexDirection: 'column', padding: '20px', position: 'relative' }}>
        
        {/* Messages area scrollable */}
        <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '6px', marginBottom: '16px' }}>
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            return (
              <div 
                key={index} 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: isUser ? 'flex-end' : 'flex-start',
                  width: '100%'
                }}
              >
                {/* Speaker bubble styling */}
                <div 
                  style={{
                    background: isUser ? 'rgba(59, 130, 246, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                    border: isUser ? '1px solid rgba(59, 130, 246, 0.25)' : '1px solid var(--border-color)',
                    padding: '12px 16px',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    maxWidth: '85%',
                    fontSize: '15px',
                    lineHeight: '1.5',
                    color: '#fff',
                    position: 'relative'
                  }}
                >
                  {/* Grammar tips styling highlight */}
                  {msg.text.includes('(Grammatik-Tipp:') ? (
                    <div>
                      <div style={{ background: 'rgba(245, 158, 11, 0.1)', borderLeft: '3.5px solid var(--color-adj)', padding: '6px 10px', borderRadius: '4px', fontSize: '13px', color: 'var(--color-adj)', marginBottom: '8px', fontStyle: 'italic' }}>
                        💡 {msg.text.match(/\((Grammatik-Tipp:.*?)\)/)?.[1] || 'Grammatik-Tipp'}
                      </div>
                      <div>{msg.text.replace(/\(Grammatik-Tipp:.*?\)/g, '').trim()}</div>
                    </div>
                  ) : msg.text}

                  {/* Play audio button on Gemini bubble */}
                  {!isUser && (
                    <button
                      type="button"
                      className="sound-btn"
                      onClick={() => speakGermanText(msg.text)}
                      title="Antwort anhören"
                      style={{
                        position: 'absolute',
                        right: '-36px',
                        bottom: '4px',
                        width: '26px',
                        height: '26px',
                        fontSize: '12px',
                        padding: 0,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                    >
                      🔊
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '10px 16px', color: 'var(--text-secondary)', fontSize: '13px', fontStyle: 'italic' }}>
              <span className="animate-pulse">🔄 Gemini schreibt...</span>
            </div>
          )}
          
          <div ref={chatEndRef} />
        </div>

        {/* Quick starter topics cards (only show if chat is just starting) */}
        {messages.length === 1 && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', justifyContent: 'center' }}>
            <button onClick={() => startTopic('Lass uns über Hobbys und Freizeit sprechen.')} className="letter-btn" style={{ padding: '6px 12px', width: 'auto', height: 'auto', borderRadius: '8px', fontSize: '12px' }}>
              ⚽ Hobbys & Freizeit
            </button>
            <button onClick={() => startTopic('Ich möchte das Bestellen im Restaurant üben.')} className="letter-btn" style={{ padding: '6px 12px', width: 'auto', height: 'auto', borderRadius: '8px', fontSize: '12px' }}>
              🍽️ Im Restaurant
            </button>
            <button onClick={() => startTopic('Lass uns über das Wetter und meine Pläne für das Wochenende sprechen.')} className="letter-btn" style={{ padding: '6px 12px', width: 'auto', height: 'auto', borderRadius: '8px', fontSize: '12px' }}>
              ☀️ Wetter & Wochenende
            </button>
          </div>
        )}

        {/* Input box section */}
        <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center' }}>
            <input
              type="text"
              className="search-input"
              style={{
                width: '100%',
                fontSize: '15px',
                padding: '12px 85px 12px 16px',
                borderRadius: '10px',
                border: '1px solid var(--border-color)',
                outline: 'none',
                height: '46px'
              }}
              placeholder={isListening ? "Ich höre zu... Sprich jetzt..." : "Schreibe oder sprich deine Antwort..."}
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              disabled={isLoading}
              autoFocus
              autoComplete="off"
              spellCheck="false"
            />
            
            <div style={{ position: 'absolute', right: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              {/* Reset input field */}
              {userInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => setUserInput('')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', padding: '4px' }}
                  title="Eingabefeld zurücksetzen"
                >
                  ❌
                </button>
              )}

              {/* Dictation mic toggle */}
              <button
                type="button"
                onClick={toggleSpeech}
                disabled={isLoading}
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
                  transition: 'all 0.2s'
                }}
                title={isListening ? "Zuhören stoppen" : "Auf Deutsch sprechen"}
              >
                {isListening ? '🛑' : '🎙️'}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="feedback-btn good"
            disabled={!userInput.trim() || isLoading}
            style={{ width: '46px', height: '46px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '10px', flexShrink: 0, maxWidth: 'none', minHeight: 'auto' }}
          >
            ➔
          </button>
        </form>
      </div>
    </div>
  );
}
