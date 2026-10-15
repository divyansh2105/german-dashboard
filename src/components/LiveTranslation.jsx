import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { wakeLockManager } from '../utils/wakeLockManager';
import {
  queryGemini,
  getStoredGeminiKey,
  setStoredGeminiKey,
  getStoredGeminiModel,
  getStoredAvailableModels,
  fetchAvailableModels,
  DEFAULT_GEMINI_MODELS
} from '../utils/geminiApi';

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

export default function LiveTranslation({
  vocabData = [],
  myList = [],
  onToggleMyList,
  isAnonymous = false
}) {
  // Voice Control & Keep-Awake state
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isKeepAwake, setIsKeepAwake] = useState(false);
  const [isPocketMode, setIsPocketMode] = useState(false);

  // Core recognition phase: 'idle' | 'recording' | 'processing' | 'speaking'
  const [phase, setPhase] = useState('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [currentRecordingText, setCurrentRecordingText] = useState('');
  const [currentResult, setCurrentResult] = useState(null);
  const [speakingSubPhase, setSpeakingSubPhase] = useState(null); // 'en' | 'de_example' | 'acknowledgment'
  const [statusMessage, setStatusMessage] = useState('Bereit. Sage „Übersetze“, um zu starten.');
  const [lastHeardLive, setLastHeardLive] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState('');
  const [availableModels, setAvailableModels] = useState(() => getStoredAvailableModels());

  // Translation history (persisted in localStorage)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_live_translations');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Manual input state
  const [manualInput, setManualInput] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  // API Key management modal
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [inputKey, setInputKey] = useState(() => getStoredGeminiKey());
  const [keySavedToast, setKeySavedToast] = useState(false);

  // Pocket mode unlock hold state
  const [pocketHoldProgress, setPocketHoldProgress] = useState(0);
  const pocketHoldTimerRef = useRef(null);
  const pocketIntervalRef = useRef(null);

  // Audio & speech synthesis refs
  const isSpeakingTtsRef = useRef(false);
  const ttsSafetyTimerRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const recognitionRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const phaseRef = useRef('idle');

  // Keep phaseRef in sync with phase state
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Query live available models on mount / key change
  useEffect(() => {
    const key = getStoredGeminiKey();
    if (key) {
      fetchAvailableModels(key).then(models => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          try {
            localStorage.setItem('b1_gemini_available_models', JSON.stringify(models));
          } catch (e) {}
        }
      });
    }
  }, []);

  // Clean-up on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      wakeLockManager.disable();
      if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
      if (pocketHoldTimerRef.current) clearTimeout(pocketHoldTimerRef.current);
      if (pocketIntervalRef.current) clearInterval(pocketIntervalRef.current);
    };
  }, []);

  // Save history to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('b1_live_translations', JSON.stringify(history.slice(0, 100)));
    } catch (e) {}
  }, [history]);

  // ----------------------------------------------------
  // Audio Speech Synthesis Helpers (German & English)
  // ----------------------------------------------------
  const speakText = useCallback((text, lang = 'de-DE', onEnd) => {
    if (!('speechSynthesis' in window) || !text) {
      if (onEnd) onEnd();
      return;
    }

    // Cancel ongoing speech
    window.speechSynthesis.cancel();
    if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;

    const voices = window.speechSynthesis.getVoices();
    if (lang.startsWith('de')) {
      const deVoice = voices.find(v => v.lang.startsWith('de-DE') || v.lang.startsWith('de_DE')) ||
        voices.find(v => v.lang.startsWith('de'));
      if (deVoice) utterance.voice = deVoice;
      utterance.rate = 1.0;
    } else {
      const enVoice = voices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en_US')) ||
        voices.find(v => v.lang.startsWith('en'));
      if (enVoice) utterance.voice = enVoice;
      utterance.rate = 0.95;
    }

    isSpeakingTtsRef.current = true;

    // Safety timeout: prevents microphone from getting permanently locked if onend drops on mobile/Safari
    const maxTtsDuration = Math.max(2500, text.length * 85);
    ttsSafetyTimerRef.current = setTimeout(() => {
      isSpeakingTtsRef.current = false;
    }, maxTtsDuration);

    utterance.onend = () => {
      if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);
      if (!isMountedRef.current) return;
      // Brief buffer to ensure microphone doesn't capture speaker echo
      setTimeout(() => {
        isSpeakingTtsRef.current = false;
        if (onEnd) onEnd();
      }, 300);
    };

    utterance.onerror = () => {
      if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);
      if (!isMountedRef.current) return;
      isSpeakingTtsRef.current = false;
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // ----------------------------------------------------
  // Keep-Awake Toggle (Prevents iPhone Auto-Lock in Pocket)
  // ----------------------------------------------------
  const handleToggleKeepAwake = async () => {
    if (isKeepAwake) {
      wakeLockManager.disable();
      setIsKeepAwake(false);
    } else {
      try {
        await wakeLockManager.enable();
        setIsKeepAwake(true);
      } catch (err) {
        console.warn("Could not enable wake lock:", err);
      }
    }
  };

  // ----------------------------------------------------
  // Clean German Text Extraction
  // ----------------------------------------------------
  const cleanSpokenPhrase = (rawText) => {
    if (!rawText) return '';
    return rawText
      .replace(/\büber\s*setz(e|en|t|ung|er)?\b/gi, '')
      .replace(/\b(translate|translation)\b/gi, '')
      .replace(/\b(in bearbeitung|bearbeitung)\b/gi, '')
      .replace(/\b(halt|halte|stopp|stop|stoppen|fertig|ende|hold|genug)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // ----------------------------------------------------
  // Local Vocabulary Fallback Search
  // ----------------------------------------------------
  const searchLocalVocab = (query) => {
    if (!query || !Array.isArray(vocabData) || vocabData.length === 0) return null;
    const cleanQ = query.toLowerCase().trim();

    // 1. Exact match on word
    let match = vocabData.find(item => item.word.toLowerCase() === cleanQ);
    if (match) return match;

    // 2. Exact match on clean word without article
    match = vocabData.find(item => {
      const bare = item.word.replace(/^(der|die|das)\s+/i, '').toLowerCase();
      return bare === cleanQ;
    });
    if (match) return match;

    // 3. Word contains query
    match = vocabData.find(item => item.word.toLowerCase().includes(cleanQ));
    return match || null;
  };

  // ----------------------------------------------------
  // Gemini AI Translation & Sentence Generator with Model Fallback
  // Cascades 3.6-flash -> 3.7-flash -> 3.5-flash -> 2.0-flash -> 1.5-flash
  // ----------------------------------------------------
  const translateWithGemini = async (phraseToTranslate) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const cleanInput = cleanSpokenPhrase(phraseToTranslate);
    if (!cleanInput) {
      speakText('Kein deutsches Wort erkannt.', 'de-DE', () => {
        setPhase('idle');
        setStatusMessage('Bereit. Sage „Übersetze“, um zu starten.');
      });
      return;
    }

    setPhase('processing');
    setStatusMessage(`Gemini übersetzt: „${cleanInput}“...`);

    const localMatch = searchLocalVocab(cleanInput);

    const systemInstruction = `You are a native German language expert and B1/B2 language coach.
Your job is to translate spoken German words or phrases heard during podcasts into clear English and provide a practical German example sentence.
Always return a clean JSON object with this exact schema:
{
  "german": "The correctly spelled German word/phrase (with article 'der/die/das' if it is a noun, e.g. 'die Herausforderung')",
  "english": "Concise English translation / meaning",
  "germanExample": "A realistic B1/B2 German sentence using this word in workplace, business, or daily life context",
  "englishExample": "English translation of the German example sentence",
  "notes": "Optional short grammar note (e.g., preposition used with verb, plural form, or formality)"
}`;

    const promptText = `German input captured from speech: "${cleanInput}"
${localMatch ? `(Context hint from student's curriculum: Meaning='${localMatch.meaning}', Category='${localMatch.category || ''}')` : ''}`;

    let parsed = null;
    let usedModelName = getStoredGeminiModel();
    let fallbackTriggered = false;

    try {
      const response = await queryGemini({
        prompt: promptText,
        systemInstruction,
        jsonMode: true,
        preferredModel: getStoredGeminiModel(),
        availableModels: availableModels && availableModels.length > 0 ? availableModels : getStoredAvailableModels(),
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 600
        },
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`⚡ Modell ${failedModel} überlastet. Wechsle zu ${nextModel}...`);
        }
      });

      if (response) {
        if (response.usedModel) usedModelName = response.usedModel;
        if (response.wasFallback) {
          fallbackTriggered = true;
          setFallbackNotice(`⚡ Übersetzt mit Backup-Modell: ${response.usedModel}`);
          setTimeout(() => setFallbackNotice(''), 7000);
        }

        if (response.parsedJson) {
          parsed = response.parsedJson;
        } else if (response.text) {
          try {
            const cleanedText = response.text
              .replace(/^```json\s*/i, '')
              .replace(/^```\s*/i, '')
              .replace(/```\s*$/i, '')
              .trim();
            parsed = JSON.parse(cleanedText);
          } catch (e) {
            console.warn('[LiveTranslation] Fallback JSON parse failed:', e);
          }
        }
      }
    } catch (err) {
      console.warn('[LiveTranslation] Gemini query failed, falling back:', err);
    }

    // High quality fallback if Gemini fails or is offline
    if (!parsed || !parsed.english) {
      if (localMatch) {
        parsed = {
          german: localMatch.word,
          english: localMatch.meaning,
          germanExample: localMatch.examples?.[0]?.de || `Wir müssen ${localMatch.word} genau verstehen.`,
          englishExample: localMatch.examples?.[0]?.en || `We need to understand ${localMatch.meaning} carefully.`,
          notes: localMatch.conjugation || 'Aus deinem B1-Wortschatz'
        };
      } else {
        // Fallback to free public translation API
        try {
          const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanInput)}&langpair=de|en`);
          const data = await res.json();
          const translation = data?.responseData?.translatedText || cleanInput;
          parsed = {
            german: cleanInput,
            english: translation,
            germanExample: `Im Podcast wurde das Wort „${cleanInput}“ verwendet.`,
            englishExample: `In the podcast the word "${translation}" was used.`,
            notes: 'Automatische Schnellübersetzung'
          };
        } catch (e) {
          parsed = {
            german: cleanInput,
            english: 'Translation unavailable',
            germanExample: `Können Sie „${cleanInput}“ bitte wiederholen?`,
            englishExample: `Could you please repeat "${cleanInput}"?`,
            notes: 'Bitte Netzwerkverbindung prüfen'
          };
        }
      }
    }

    const newResult = {
      id: Date.now(),
      german: parsed.german || cleanInput,
      english: parsed.english || 'Unbekannt',
      germanExample: parsed.germanExample || '',
      englishExample: parsed.englishExample || '',
      notes: parsed.notes || '',
      usedModel: usedModelName,
      wasFallback: fallbackTriggered,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setCurrentResult(newResult);
    setHistory(prev => [newResult, ...prev]);

    // ----------------------------------------------------
    // Speak Aloud Workflow:
    // 1. Speak English translation ('en-US')
    // 2. Pause
    // 3. Speak German example sentence ('de-DE')
    // 4. Return to 'idle' listening
    // ----------------------------------------------------
    setPhase('speaking');
    setSpeakingSubPhase('en');
    setStatusMessage(`Lese Übersetzung vor: „${newResult.english}“`);

    speakText(newResult.english, 'en-US', () => {
      if (!isMountedRef.current) return;
      // Brief natural pause between English translation and German example
      setTimeout(() => {
        if (!isMountedRef.current) return;
        setSpeakingSubPhase('de_example');
        setStatusMessage(`Lese Beispielsatz vor: „${newResult.germanExample}“`);

        speakText(newResult.germanExample, 'de-DE', () => {
          if (!isMountedRef.current) return;
          setSpeakingSubPhase(null);
          setPhase('idle');
          setStatusMessage('Bereit. Sage „Übersetze“, um das nächste Wort zu übersetzen.');
        });
      }, 400);
    });
  };

  // ----------------------------------------------------
  // Speech Recognition Event Engine
  // ----------------------------------------------------
  const processGermanSpeech = useCallback((rawTranscript) => {
    if (!rawTranscript || isSpeakingTtsRef.current) return;
    const text = rawTranscript.trim();
    const lower = text.toLowerCase();
    const compact = lower.replace(/\s+/g, '');

    // Ignore phone's own speaker acknowledgment if picked up
    if (compact.includes('inbearbeitung') || lower.includes('in bearbeitung')) {
      return;
    }

    // Flexible trigger detection ("Übersetze", "Über setze", "Übersetzen", "Translate", "Übersetzung")
    const hasTrigger =
      /\b(über\s*setz(e|en|t|ung|er)?|translate|translation)\b/i.test(lower) ||
      compact.includes('übersetz') ||
      compact.includes('uebersetz') ||
      lower.includes('translate');

    // Flexible stop detection ("Halt", "Stopp", "Stop", "Fertig", "Ende", "Genug")
    const hasStop =
      /\b(halt|halte|stopp|stop|stoppen|fertig|ende|hold|genug)\b/i.test(lower) ||
      lower.includes('halt') ||
      lower.includes('stopp') ||
      lower.includes('fertig');

    // ----------------------------------------------------
    // State 1: IDLE (Waiting for trigger word "Übersetze")
    // ----------------------------------------------------
    if (phaseRef.current === 'idle') {
      if (hasTrigger) {
        // Check if user spoke entire command in one single breath: "Übersetze [word] Halt"
        if (hasStop) {
          const phrase = cleanSpokenPhrase(text);
          if (phrase) {
            setPhase('recording');
            setStatusMessage(`Wort erfasst: „${phrase}“. Übersetze...`);
            speakText('In Bearbeitung', 'de-DE', () => {
              translateWithGemini(phrase);
            });
            return;
          }
        }

        // Standard 2-Step Flow:
        // Acknowledge trigger: Speak "In Bearbeitung" in German
        setPhase('recording');
        setCurrentRecordingText('');
        setLiveTranscript('');
        recordedChunksRef.current = [];
        setStatusMessage('Aufnahme läuft... Sprich das Wort und sage „Halt“.');

        speakText('In Bearbeitung', 'de-DE', () => {
          // Acknowledgment spoken, microphone ready to capture the German word
        });
        return;
      }
    }

    // ----------------------------------------------------
    // State 2: RECORDING (Capturing word until "Halt" is heard or silence)
    // ----------------------------------------------------
    if (phaseRef.current === 'recording') {
      const currentClean = cleanSpokenPhrase(text);
      if (currentClean) {
        setLiveTranscript(currentClean);
        setCurrentRecordingText(currentClean);

        // Clear existing silence timer
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        if (hasStop) {
          setLiveTranscript('');
          translateWithGemini(currentClean);
        } else {
          // Auto-translate if user stops speaking for 3.8s (convenient for hands-free listening!)
          silenceTimerRef.current = setTimeout(() => {
            if (phaseRef.current === 'recording') {
              translateWithGemini(currentClean);
            }
          }, 3800);
        }
      }
    }
  }, [speakText]);

  // Keep a stable ref to speech processor
  const processGermanSpeechRef = useRef(processGermanSpeech);
  useEffect(() => {
    processGermanSpeechRef.current = processGermanSpeech;
  }, [processGermanSpeech]);

  // Continuous Speech Recognition lifecycle
  useEffect(() => {
    if (!SpeechRecognition) return;

    if (!isVoiceActive) {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
        recognitionRef.current = null;
      }
      return;
    }

    let isStoppingManually = false;
    let recognition = null;

    const startRecognition = () => {
      if (isStoppingManually || !isMountedRef.current) return;
      try {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        recognition.lang = 'de-DE'; // German speech recognition engine

        recognition.onresult = (event) => {
          if (isSpeakingTtsRef.current) return; // Prevent mic from hearing phone's own speaker

          for (let i = event.resultIndex; i < event.results.length; i++) {
            // Check all alternatives and prioritize trigger/stop words
            let bestTranscript = '';
            for (let j = 0; j < event.results[i].length; j++) {
              const candidate = event.results[i][j].transcript.trim();
              if (!bestTranscript) bestTranscript = candidate;
              const candLower = candidate.toLowerCase();
              if (
                candLower.includes('übersetz') ||
                candLower.includes('uebersetz') ||
                candLower.includes('halt') ||
                candLower.includes('stopp') ||
                candLower.includes('translate')
              ) {
                bestTranscript = candidate;
                break;
              }
            }

            if (bestTranscript) {
              setLastHeardLive(bestTranscript);
              if (processGermanSpeechRef.current) {
                processGermanSpeechRef.current(bestTranscript);
              }
            }
          }
        };

        recognition.onerror = (event) => {
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            isStoppingManually = true;
            setIsVoiceActive(false);
            alert('Mikrofon-Berechtigung verweigert. Bitte erlaube den Mikrofonzugriff.');
          }
        };

        recognition.onend = () => {
          if (!isStoppingManually && isMountedRef.current) {
            setTimeout(() => {
              if (!isStoppingManually && isMountedRef.current) {
                startRecognition();
              }
            }, 180);
          }
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (err) {
        console.warn('SpeechRecognition start error:', err);
      }
    };

    startRecognition();

    return () => {
      isStoppingManually = true;
      if (recognition) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
    };
  }, [isVoiceActive]);

  // ----------------------------------------------------
  // Manual Actions & Triggers
  // ----------------------------------------------------
  const handleStartRecordingManual = async () => {
    // If voice listening is not yet active, turn it on!
    if (!isVoiceActive) {
      setIsVoiceActive(true);
      if (!isKeepAwake) {
        try {
          await wakeLockManager.enable();
          setIsKeepAwake(true);
        } catch (e) {}
      }
    }
    setPhase('recording');
    setCurrentRecordingText('');
    setLiveTranscript('');
    setStatusMessage('Aufnahme läuft... Sprich das Wort oder tippe unten.');
    speakText('In Bearbeitung', 'de-DE');
  };

  const handleStopRecordingManual = () => {
    const textToUse = cleanSpokenPhrase(liveTranscript || currentRecordingText || manualInput);
    if (textToUse) {
      translateWithGemini(textToUse);
    } else {
      setPhase('idle');
      setStatusMessage('Kein Wort eingegeben.');
    }
  };

  const handleManualSubmit = (e) => {
    if (e) e.preventDefault();
    if (!manualInput.trim()) return;
    translateWithGemini(manualInput.trim());
    setManualInput('');
  };

  // ----------------------------------------------------
  // Star / My List toggle
  // ----------------------------------------------------
  const isItemStarred = useCallback((wordStr) => {
    if (!wordStr || !Array.isArray(myList)) return false;
    const clean = wordStr.toLowerCase().replace(/^(der|die|das)\s+/i, '').trim();
    return myList.some(item => {
      const itemClean = item.word.toLowerCase().replace(/^(der|die|das)\s+/i, '').trim();
      return itemClean === clean || item.word.toLowerCase() === wordStr.toLowerCase();
    });
  }, [myList]);

  const handleToggleStarWord = (resItem) => {
    if (!resItem || !onToggleMyList) return;
    onToggleMyList({
      word: resItem.german,
      meaning: resItem.english,
      category: 'podcast',
      examples: resItem.germanExample ? [{ de: resItem.germanExample, en: resItem.englishExample }] : []
    });
  };

  // ----------------------------------------------------
  // Pocket Mode Unlock Handlers (Hold 1s)
  // ----------------------------------------------------
  const startPocketHold = () => {
    setPocketHoldProgress(0);
    const start = Date.now();
    pocketIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, Math.round((elapsed / 1000) * 100));
      setPocketHoldProgress(pct);
      if (pct >= 100) {
        clearInterval(pocketIntervalRef.current);
        setIsPocketMode(false);
        setPocketHoldProgress(0);
      }
    }, 40);
  };

  const cancelPocketHold = () => {
    if (pocketIntervalRef.current) clearInterval(pocketIntervalRef.current);
    setPocketHoldProgress(0);
  };

  // Filtered history list
  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.toLowerCase();
    return history.filter(item =>
      item.german.toLowerCase().includes(q) ||
      item.english.toLowerCase().includes(q) ||
      (item.germanExample && item.germanExample.toLowerCase().includes(q))
    );
  }, [history, historySearch]);

  // ----------------------------------------------------
  // RENDER: POCKET MODE (Pitch Black Screen for Walking)
  // ----------------------------------------------------
  if (isPocketMode) {
    return (
      <div
        id="live-translation-pocket-mode"
        onMouseDown={startPocketHold}
        onMouseUp={cancelPocketHold}
        onTouchStart={startPocketHold}
        onTouchEnd={cancelPocketHold}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: '#000000',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: 'none'
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: '320px' }}>
          {/* Subtle pulsating microphone */}
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            margin: '0 auto 24px',
            background: phase === 'recording'
              ? 'radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, rgba(0,0,0,0) 70%)'
              : 'radial-gradient(circle, rgba(16, 185, 129, 0.3) 0%, rgba(0,0,0,0) 70%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            animation: phase === 'recording' ? 'pulse 1.2s infinite' : 'pulse 2.5s infinite'
          }}>
            {phase === 'recording' ? '🔴' : '🎙️'}
          </div>

          <div style={{ fontSize: '15px', fontWeight: '700', color: '#52525b', marginBottom: '8px' }}>
            Live Translation • Pocket Mode
          </div>

          <div style={{
            fontSize: '13px',
            color: phase === 'recording' ? '#ef4444' : '#10b981',
            fontWeight: '600',
            marginBottom: '32px'
          }}>
            {phase === 'recording' ? 'Aufnahme läuft (Sage „Halt“)...' : 'Hört zu: Sage „Übersetze“'}
          </div>

          {currentResult && (
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '16px',
              padding: '14px 16px',
              marginBottom: '36px',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '1px' }}>Zuletzt</div>
              <div style={{ fontSize: '18px', fontWeight: '800', color: '#e4e4e7', margin: '4px 0' }}>{currentResult.german}</div>
              <div style={{ fontSize: '14px', color: '#10b981', fontWeight: '700' }}>{currentResult.english}</div>
            </div>
          )}

          {/* Hold to unlock visual indicator */}
          <div style={{
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}>
            <div style={{
              width: '180px',
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              overflow: 'hidden'
            }}>
              <div style={{
                height: '100%',
                width: `${pocketHoldProgress}%`,
                background: '#3b82f6',
                transition: 'width 0.05s linear'
              }} />
            </div>
            <span style={{ fontSize: '12px', color: '#71717a' }}>
              {pocketHoldProgress > 0 ? `Entsperren... ${pocketHoldProgress}%` : 'Tippen & 1s halten zum Entsperren'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // MAIN DASHBOARD VIEW
  // ----------------------------------------------------
  return (
    <div className="app-container animate-fade-in" style={{ maxWidth: '980px', margin: '0 auto', paddingBottom: '60px' }}>
      
      {/* Top Bar Header & Control Actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
        padding: '16px 20px',
        background: 'rgba(20, 22, 33, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderRadius: '20px',
        border: '1px solid var(--border-color)',
        boxShadow: 'var(--shadow-premium)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '24px' }}>🎙️</span>
            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.3px' }}>
              Live Translation
            </h2>
            <span style={{
              fontSize: '10px',
              fontWeight: '800',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              padding: '2px 8px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(168, 85, 247, 0.25))',
              color: '#93c5fd',
              border: '1px solid rgba(59, 130, 246, 0.4)'
            }}>
              Podcast Mode
            </span>
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '4px 0 0 0' }}>
            Hände-frei beim Podcast hören: Sage <strong>„Übersetze“</strong> → sprich das Wort → sage <strong>„Halt“</strong>.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Continuous Voice Control Toggle */}
          <button
            type="button"
            id="live-voice-control-btn"
            onClick={async () => {
              if (!SpeechRecognition) {
                alert("Speech recognition is not supported in this browser. Try Google Chrome, Microsoft Edge, or Apple Safari.");
                return;
              }
              const nextVoice = !isVoiceActive;
              setIsVoiceActive(nextVoice);
              if (nextVoice && !isKeepAwake) {
                try {
                  await wakeLockManager.enable();
                  setIsKeepAwake(true);
                } catch (e) {}
              }
            }}
            title={isVoiceActive ? "Voice Control aktiv (Hört auf 'Übersetze'). Klicken zum Deaktivieren" : "Voice Control aktivieren (Kontinuierliches Mithören)"}
            style={{
              background: isVoiceActive
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(59, 130, 246, 0.28))'
                : 'rgba(255, 255, 255, 0.08)',
              border: isVoiceActive ? '1px solid rgba(16, 185, 129, 0.65)' : '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '12px',
              color: isVoiceActive ? '#10b981' : '#fff',
              padding: '8px 14px',
              fontSize: '12px',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              boxShadow: isVoiceActive ? '0 0 16px rgba(16, 185, 129, 0.35)' : '0 2px 8px rgba(0,0,0,0.15)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <span style={{ fontSize: '14px' }}>🎙️</span>
            <span>{isVoiceActive ? 'Voice: ON' : 'Voice Control'}</span>
            {isVoiceActive && (
              <span className="pulse-indicator" style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#10b981',
                display: 'inline-block'
              }} />
            )}
          </button>

          {/* Screen Keep-Awake Toggle */}
          <button
            type="button"
            id="live-keep-awake-btn"
            onClick={handleToggleKeepAwake}
            title={isKeepAwake ? "Bildschirmsperre deaktiviert (Display bleibt aktiv). Klicken zum Ausschalten" : "Display aktiv halten (Verhindert Bildschirmsperre in der Tasche)"}
            style={{
              background: isKeepAwake
                ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28), rgba(234, 179, 8, 0.28))'
                : 'rgba(255, 255, 255, 0.08)',
              border: isKeepAwake ? '1px solid rgba(245, 158, 11, 0.65)' : '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '12px',
              color: isKeepAwake ? '#f59e0b' : '#fff',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: '800',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: isKeepAwake ? '0 0 16px rgba(245, 158, 11, 0.35)' : '0 2px 8px rgba(0,0,0,0.15)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <span style={{ fontSize: '13px' }}>{isKeepAwake ? '☀️' : '🌙'}</span>
            <span>{isKeepAwake ? 'Awake: ON' : 'Keep Awake'}</span>
          </button>

          {/* Pocket Mode Toggle Button */}
          <button
            type="button"
            id="live-pocket-mode-btn"
            onClick={() => {
              setIsPocketMode(true);
              if (!isVoiceActive) setIsVoiceActive(true);
              if (!isKeepAwake) {
                wakeLockManager.enable().then(() => setIsKeepAwake(true)).catch(() => {});
              }
            }}
            title="Pocket Mode: Schaltet das Display auf Tiefschwarz mit Touch-Sperre für die Hosentasche"
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              borderRadius: '12px',
              color: '#e4e4e7',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span>🕶️</span>
            <span>Pocket Mode</span>
          </button>

          {/* API Key Settings Button */}
          <button
            type="button"
            onClick={() => setShowKeyModal(true)}
            title="Gemini API-Schlüssel verwalten"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '12px',
              color: 'var(--text-secondary)',
              padding: '8px 10px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            ⚙️ Key
          </button>
        </div>
      </div>

      {/* Main Interactive Stage */}
      <div style={{
        marginTop: '20px',
        background: 'linear-gradient(180deg, rgba(20, 22, 33, 0.9) 0%, rgba(15, 17, 26, 0.95) 100%)',
        border: '1px solid var(--border-color)',
        borderRadius: '24px',
        padding: '36px 24px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-premium)'
      }}>
        {/* Visual Pulse Orb & Recognition Status */}
        <div style={{ position: 'relative', width: '130px', height: '130px', margin: '0 auto 20px' }}>
          {/* Animated Glow Rings */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: phase === 'recording'
              ? 'radial-gradient(circle, rgba(239, 68, 68, 0.4) 0%, rgba(239, 68, 68, 0) 70%)'
              : phase === 'processing'
              ? 'radial-gradient(circle, rgba(168, 85, 247, 0.4) 0%, rgba(168, 85, 247, 0) 70%)'
              : phase === 'speaking'
              ? 'radial-gradient(circle, rgba(16, 185, 129, 0.45) 0%, rgba(16, 185, 129, 0) 70%)'
              : isVoiceActive
              ? 'radial-gradient(circle, rgba(59, 130, 246, 0.35) 0%, rgba(59, 130, 246, 0) 70%)'
              : 'radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, rgba(0,0,0,0) 70%)',
            animation: (phase === 'recording' || phase === 'speaking' || isVoiceActive) ? 'pulse 2s infinite' : 'none',
            transform: 'scale(1.4)'
          }} />

          {/* Center Orb */}
          <div style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: phase === 'recording'
              ? 'linear-gradient(135deg, #ef4444, #dc2626)'
              : phase === 'processing'
              ? 'linear-gradient(135deg, #a855f7, #6366f1)'
              : phase === 'speaking'
              ? 'linear-gradient(135deg, #10b981, #059669)'
              : isVoiceActive
              ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
              : 'rgba(255, 255, 255, 0.08)',
            border: '2px solid rgba(255, 255, 255, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '44px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            transition: 'all 0.3s ease'
          }}>
            {phase === 'recording' && '🔴'}
            {phase === 'processing' && '⏳'}
            {phase === 'speaking' && '🔊'}
            {phase === 'idle' && (isVoiceActive ? '🎙️' : '💤')}
          </div>
        </div>

        {/* Dynamic Status Text */}
        <div style={{
          fontSize: '13px',
          fontWeight: '800',
          textTransform: 'uppercase',
          letterSpacing: '1.2px',
          color: phase === 'recording' ? '#ef4444' : phase === 'speaking' ? '#10b981' : phase === 'processing' ? '#a855f7' : '#38bdf8',
          marginBottom: '8px'
        }}>
          {phase === 'recording' && 'Aufnahme aktiv'}
          {phase === 'processing' && 'Gemini Analyse'}
          {phase === 'speaking' && (speakingSubPhase === 'en' ? 'Lese Übersetzung vor' : 'Lese Beispielsatz vor')}
          {phase === 'idle' && (isVoiceActive ? 'Hört auf „Übersetze“' : 'Voice Control inaktiv')}
        </div>

        <h3 style={{ fontSize: '20px', fontWeight: '800', color: '#fff', margin: '0 0 16px 0', minHeight: '30px' }}>
          {statusMessage}
        </h3>

        {/* Fallback Notice Toast */}
        {fallbackNotice && (
          <div style={{
            maxWidth: '520px',
            margin: '0 auto 16px',
            padding: '10px 16px',
            borderRadius: '12px',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: '#fcd34d',
            fontSize: '13px',
            fontWeight: '700',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px'
          }}>
            <span>⚡</span>
            <span>{fallbackNotice}</span>
          </div>
        )}

        {/* Real-time speech preview badge (confirms microphone is picking up user's voice) */}
        {isVoiceActive && lastHeardLive && phase !== 'recording' && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '12px',
            color: '#94a3b8',
            background: 'rgba(255, 255, 255, 0.06)',
            padding: '5px 14px',
            borderRadius: '20px',
            margin: '0 auto 16px auto',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            <span>🎙️</span>
            <span>Zuletzt gehört: <strong style={{ color: '#e2e8f0' }}>„{lastHeardLive}“</strong></span>
          </div>
        )}

        {/* Live Transcript Preview during recording */}
        {phase === 'recording' && (
          <div style={{
            maxWidth: '520px',
            margin: '0 auto 20px',
            padding: '14px 18px',
            borderRadius: '16px',
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            fontSize: '16px',
            fontWeight: '600',
            minHeight: '52px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {liveTranscript ? `„${liveTranscript}“` : 'Spreche jetzt dein deutsches Wort... Beende mit „Halt“'}
          </div>
        )}

        {/* Manual Push-to-Talk / Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
          {phase === 'idle' ? (
            <button
              type="button"
              onClick={handleStartRecordingManual}
              style={{
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#fff',
                border: 'none',
                borderRadius: '16px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(59, 130, 246, 0.4)'
              }}
            >
              <span>🎙️</span>
              <span>Jetzt Übersetzen (Manuell starten)</span>
            </button>
          ) : phase === 'recording' ? (
            <button
              type="button"
              onClick={handleStopRecordingManual}
              style={{
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                color: '#fff',
                border: 'none',
                borderRadius: '16px',
                padding: '12px 28px',
                fontSize: '14px',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 16px rgba(239, 68, 68, 0.4)',
                animation: 'pulse 1.5s infinite'
              }}
            >
              <span>🛑</span>
              <span>Halt & Übersetzen</span>
            </button>
          ) : null}
        </div>

        {/* Manual Text Input Bar */}
        <form onSubmit={handleManualSubmit} style={{
          maxWidth: '540px',
          margin: '28px auto 0',
          display: 'flex',
          gap: '8px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '16px',
          padding: '6px',
          border: '1px solid rgba(255, 255, 255, 0.1)'
        }}>
          <input
            type="text"
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="Oder tippe deutsches Wort/Phrase hier..."
            style={{
              flexGrow: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#fff',
              fontSize: '14px',
              padding: '8px 14px'
            }}
          />
          <button
            type="submit"
            disabled={!manualInput.trim()}
            style={{
              background: manualInput.trim() ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              padding: '8px 18px',
              fontSize: '13px',
              fontWeight: '700',
              cursor: manualInput.trim() ? 'pointer' : 'default',
              transition: 'all 0.2s ease'
            }}
          >
            Übersetzen
          </button>
        </form>
      </div>

      {/* ACTIVE TRANSLATION RESULT CARD */}
      {currentResult && (
        <div className="animate-fade-in" style={{
          marginTop: '24px',
          background: 'rgba(20, 22, 33, 0.85)',
          borderRadius: '24px',
          border: '1px solid rgba(59, 130, 246, 0.35)',
          padding: '28px 24px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: '800' }}>
                Deutsches Wort / Phrase
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>
                  {currentResult.german}
                </h2>
                {currentResult.usedModel && (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '3px 8px',
                    borderRadius: '8px',
                    background: currentResult.wasFallback ? 'rgba(245, 158, 11, 0.2)' : 'rgba(168, 85, 247, 0.2)',
                    color: currentResult.wasFallback ? '#fcd34d' : '#c084fc',
                    border: currentResult.wasFallback ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(168, 85, 247, 0.4)'
                  }}>
                    ✨ {currentResult.usedModel} {currentResult.wasFallback ? '(Backup)' : ''}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Audio Replay German */}
              <button
                type="button"
                onClick={() => speakText(currentResult.german, 'de-DE')}
                title="Deutsches Wort anhören"
                style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderRadius: '12px',
                  color: '#93c5fd',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>🔊</span>
                <span>Deutsch</span>
              </button>

              {/* Star / Add to My List */}
              <button
                type="button"
                onClick={() => handleToggleStarWord(currentResult)}
                title={isItemStarred(currentResult.german) ? "Aus 'My List' entfernen" : "Zu 'My List' hinzufügen"}
                style={{
                  background: isItemStarred(currentResult.german) ? 'rgba(234, 179, 8, 0.22)' : 'rgba(255, 255, 255, 0.08)',
                  border: isItemStarred(currentResult.german) ? '1px solid rgba(234, 179, 8, 0.6)' : '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: '12px',
                  color: isItemStarred(currentResult.german) ? '#eab308' : '#e4e4e7',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span>{isItemStarred(currentResult.german) ? '★' : '☆'}</span>
                <span>{isItemStarred(currentResult.german) ? 'In My List' : 'Merken'}</span>
              </button>
            </div>
          </div>

          {/* English Translation Section */}
          <div style={{
            marginTop: '20px',
            padding: '16px 20px',
            borderRadius: '16px',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div>
              <div style={{ fontSize: '11px', color: '#10b981', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px' }}>
                Englische Übersetzung
              </div>
              <div style={{ fontSize: '24px', fontWeight: '800', color: '#fff', marginTop: '4px' }}>
                {currentResult.english}
              </div>
            </div>

            <button
              type="button"
              onClick={() => speakText(currentResult.english, 'en-US')}
              title="Englische Aussprache anhören"
              style={{
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                borderRadius: '10px',
                color: '#6ee7b7',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>🔊</span>
              <span>English</span>
            </button>
          </div>

          {/* German Example Sentence Section */}
          {currentResult.germanExample && (
            <div style={{
              marginTop: '16px',
              padding: '18px 20px',
              borderRadius: '16px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: '800' }}>
                  Beispielsatz (Praxis / Podcast-Kontext)
                </span>
                <button
                  type="button"
                  onClick={() => speakText(currentResult.germanExample, 'de-DE')}
                  title="Beispielsatz anhören"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#38bdf8',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <span>🔊</span>
                  <span>Satz vorlesen</span>
                </button>
              </div>

              <div style={{ fontSize: '17px', fontWeight: '700', color: '#f3f4f6', lineHeight: '1.45' }}>
                „{currentResult.germanExample}“
              </div>

              {currentResult.englishExample && (
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', marginTop: '6px', fontStyle: 'italic' }}>
                  "{currentResult.englishExample}"
                </div>
              )}

              {currentResult.notes && (
                <div style={{
                  marginTop: '12px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  color: '#a78bfa',
                  background: 'rgba(167, 139, 250, 0.1)',
                  padding: '4px 10px',
                  borderRadius: '8px',
                  border: '1px solid rgba(167, 139, 250, 0.25)'
                }}>
                  <span>💡</span>
                  <span>{currentResult.notes}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SESSION TRANSLATION HISTORY */}
      <div style={{ marginTop: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff', margin: 0 }}>
              📜 Podcast Wörter ({history.length})
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Alle in dieser Session erfassten Begriffe
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {history.length > 0 && (
              <>
                <input
                  type="text"
                  placeholder="Verlauf durchsuchen..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '10px',
                    padding: '6px 12px',
                    color: '#fff',
                    fontSize: '12px',
                    outline: 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Möchtest du den gesamten Übersetzungsverlauf wirklich löschen?')) {
                      setHistory([]);
                    }
                  }}
                  style={{
                    background: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#ef4444',
                    borderRadius: '10px',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  Löschen
                </button>
              </>
            )}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px dashed var(--border-color)',
            borderRadius: '16px',
            padding: '32px',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '13px'
          }}>
            Noch keine Wörter in dieser Session übersetzt.
            <br />
            Schalte <strong>Voice Control</strong> ein und sage beim Podcast-Hören: <strong>„Übersetze [Wort] Halt“</strong>!
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minURIComponent(280px, 1fr))', gap: '12px' }}>
            {filteredHistory.map((item) => (
              <div
                key={item.id}
                style={{
                  background: 'rgba(20, 22, 33, 0.65)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '16px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'transform 0.2s ease, border-color 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: '800', color: '#fff' }}>
                      {item.german}
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#10b981', marginTop: '2px' }}>
                      {item.english}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      type="button"
                      onClick={() => speakText(item.german, 'de-DE')}
                      title="Anhören"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      🔊
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleStarWord(item)}
                      title={isItemStarred(item.german) ? "In My List" : "Zu My List hinzufügen"}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        color: isItemStarred(item.german) ? '#eab308' : '#71717a',
                        fontSize: '12px'
                      }}
                    >
                      ★
                    </button>
                  </div>
                </div>

                {item.germanExample && (
                  <div style={{
                    fontSize: '12px',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.4',
                    background: 'rgba(255,255,255,0.02)',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    borderLeft: '2px solid #3b82f6',
                    marginTop: '4px'
                  }}>
                    „{item.germanExample}“
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '4px' }}>
                  {item.usedModel ? (
                    <span style={{ fontSize: '10px', color: item.wasFallback ? '#f59e0b' : '#a78bfa', fontWeight: '600' }}>
                      ✨ {item.usedModel}
                    </span>
                  ) : <span />}
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {item.timestamp}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GEMINI API KEY MODAL */}
      {showKeyModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            background: '#13151f',
            borderRadius: '24px',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            padding: '28px',
            maxWidth: '460px',
            width: '100%',
            boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
          }}>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff', margin: '0 0 8px 0' }}>
              ⚙️ Gemini API-Schlüssel
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', margin: '0 0 20px 0' }}>
              Live Translation nutzt Google Gemini für präzise B1/B2 Kontext-Übersetzungen und Beispielsätze.
            </p>

            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="AIzaSy..."
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '12px 14px',
                color: '#fff',
                fontSize: '14px',
                outline: 'none',
                marginBottom: '16px'
              }}
            />

            {keySavedToast && (
              <div style={{ color: '#10b981', fontSize: '12px', fontWeight: '700', marginBottom: '12px' }}>
                ✓ API-Schlüssel erfolgreich gespeichert!
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setShowKeyModal(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  padding: '10px 18px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Schließen
              </button>
              <button
                type="button"
                onClick={() => {
                  setStoredGeminiKey(inputKey);
                  setKeySavedToast(true);
                  setTimeout(() => {
                    setKeySavedToast(false);
                    setShowKeyModal(false);
                  }, 900);
                }}
                style={{
                  background: '#3b82f6',
                  border: 'none',
                  borderRadius: '12px',
                  color: '#fff',
                  padding: '10px 20px',
                  fontSize: '13px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
