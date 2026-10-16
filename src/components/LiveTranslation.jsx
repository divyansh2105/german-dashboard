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
  const [speakingSubPhase, setSpeakingSubPhase] = useState(null); // 'en' | 'de_translation' | 'de_example'
  const [direction, setDirection] = useState('de_en'); // 'de_en' (DE -> EN) | 'en_de' (EN -> DE)
  const [statusMessage, setStatusMessage] = useState('Bereit. Sage „Übersetze“ (DE), „Translate“ (EN) oder „Wiederholen“ / „Repeat“.');
  const [lastHeardLive, setLastHeardLive] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState('');
  const [availableModels, setAvailableModels] = useState(() => getStoredAvailableModels());

  // Translation history (persisted in localStorage, limited to 10 most recent words)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_live_translations');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
    } catch (e) {
      return [];
    }
  });

  // Manual input state
  const [manualInput, setManualInput] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  // Part of speech preference: 'auto' | 'verb' | 'noun'
  const [posFilter, setPosFilter] = useState('auto');

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
  const activeUtteranceRef = useRef(null);
  const ttsSafetyTimerRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const recognitionRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const currentRecordingTextRef = useRef('');
  const detectedPosRef = useRef(null);
  const lastTriggerTimeRef = useRef(0);
  const phaseRef = useRef('idle');
  const directionRef = useRef('de_en');
  const recognitionLangRef = useRef('de-DE');
  const lastResultRef = useRef(null);
  const recordingStartIndexRef = useRef(0);

  // Keep phaseRef & directionRef in sync with state
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    if (currentResult) {
      lastResultRef.current = currentResult;
    } else if (!lastResultRef.current && history.length > 0) {
      lastResultRef.current = history[0];
    }
  }, [currentResult, history]);

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

  // Save history to localStorage (kept to most recent 10 words)
  useEffect(() => {
    try {
      localStorage.setItem('b1_live_translations', JSON.stringify(history.slice(0, 10)));
    } catch (e) {}
  }, [history]);

  // ----------------------------------------------------
  // Audio Speech Synthesis Helpers (German & English)
  // Specially optimized for iOS Safari & iPhone Chrome (WebKit)
  // ----------------------------------------------------
  const unlockAudio = useCallback(() => {
    if ('speechSynthesis' in window) {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      try {
        const dummy = new SpeechSynthesisUtterance('');
        dummy.volume = 0;
        window.speechSynthesis.speak(dummy);
      } catch (e) {}
    }
    if (window.AudioContext || window.webkitAudioContext) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') {
          ctx.resume();
        }
      } catch (e) {}
    }
  }, []);

  // Global touch listener to unlock audio on first user touch/tap on iPhone
  useEffect(() => {
    const handleGesture = () => {
      unlockAudio();
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
    window.addEventListener('click', handleGesture, { passive: true });
    window.addEventListener('touchstart', handleGesture, { passive: true });
    return () => {
      window.removeEventListener('click', handleGesture);
      window.removeEventListener('touchstart', handleGesture);
    };
  }, [unlockAudio]);

  const speakText = useCallback((text, lang = 'de-DE', onEnd) => {
    if (!('speechSynthesis' in window) || !text) {
      if (onEnd) onEnd();
      return;
    }

    if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);

    // Resume speech synthesis engine if paused (critical on iOS WebKit / Chrome)
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = lang.startsWith('de') ? 1.0 : 0.95;

    // Retain global and ref references to avoid premature garbage collection on iOS/WebKit
    window.__lt_utterance = utterance;
    activeUtteranceRef.current = utterance;

    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) {
      let chosenVoice = null;
      if (lang.startsWith('de')) {
        chosenVoice = voices.find(v => (v.lang.startsWith('de-DE') || v.lang.startsWith('de_DE')) && v.localService !== false) ||
          voices.find(v => v.lang.startsWith('de'));
      } else {
        chosenVoice = voices.find(v => (v.lang.startsWith('en-US') || v.lang.startsWith('en_US')) && v.localService !== false) ||
          voices.find(v => v.lang.startsWith('en'));
      }
      if (chosenVoice) {
        try { utterance.voice = chosenVoice; } catch (e) {}
      }
    }

    isSpeakingTtsRef.current = true;

    let isDone = false;
    const finish = () => {
      if (isDone) return;
      isDone = true;
      if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);
      window.__lt_utterance = null;
      activeUtteranceRef.current = null;
      setTimeout(() => {
        if (!isMountedRef.current) return;
        isSpeakingTtsRef.current = false;
        if (onEnd) onEnd();
      }, 250);
    };

    utterance.onend = finish;
    utterance.onerror = (e) => {
      console.warn('[LiveTranslation TTS Error]', e);
      finish();
    };

    // Deterministic safety timeout (prevents hanging if onend is swallowed by iOS WebKit)
    const wordCount = (text || '').trim().split(/\s+/).length;
    const estDuration = Math.max(1800, wordCount * 550 + 1000);
    ttsSafetyTimerRef.current = setTimeout(() => {
      finish();
    }, estDuration);

    try {
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[LiveTranslation TTS Speak failed]', e);
      finish();
    }
  }, []);

  // Switch speech recognition language dynamically ('de-DE' <-> 'en-US')
  const switchRecognitionLang = useCallback((targetLang) => {
    if (recognitionLangRef.current === targetLang) return;
    recognitionLangRef.current = targetLang;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = targetLang;
        recognitionRef.current.abort();
      } catch (e) {
        console.warn('Could not switch recognition lang:', e);
      }
    }
  }, []);

  // ----------------------------------------------------
  // Sequential Speaker for Translation Results
  // DE ➔ EN: Speaks English translation ('en-US') -> German example ('de-DE')
  // EN ➔ DE: Speaks German translation ('de-DE') -> German example ('de-DE')
  // ----------------------------------------------------
  const speakSequentialResult = useCallback((res, dir = 'de_en', onComplete) => {
    if (!res) {
      if (onComplete) onComplete();
      return;
    }

    if (dir === 'en_de') {
      // EN -> DE: Read German translation first, then German example sentence
      setPhase('speaking');
      setSpeakingSubPhase('de_translation');
      setStatusMessage(`Lese deutsche Übersetzung vor: „${res.german}“`);

      speakText(res.german, 'de-DE', () => {
        if (!isMountedRef.current) return;
        if (res.germanExample) {
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setSpeakingSubPhase('de_example');
            setStatusMessage(`Lese Beispielsatz vor: „${res.germanExample}“`);

            speakText(res.germanExample, 'de-DE', () => {
              if (!isMountedRef.current) return;
              setSpeakingSubPhase(null);
              setPhase('idle');
              switchRecognitionLang('de-DE');
              setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
              if (onComplete) onComplete();
            });
          }, 320);
        } else {
          setSpeakingSubPhase(null);
          setPhase('idle');
          switchRecognitionLang('de-DE');
          setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
          if (onComplete) onComplete();
        }
      });
    } else {
      // DE -> EN: Read English translation first, then German example sentence
      setPhase('speaking');
      setSpeakingSubPhase('en');
      setStatusMessage(`Lese Übersetzung vor: „${res.english}“`);

      speakText(res.english, 'en-US', () => {
        if (!isMountedRef.current) return;
        if (res.germanExample) {
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setSpeakingSubPhase('de_example');
            setStatusMessage(`Lese Beispielsatz vor: „${res.germanExample}“`);

            speakText(res.germanExample, 'de-DE', () => {
              if (!isMountedRef.current) return;
              setSpeakingSubPhase(null);
              setPhase('idle');
              switchRecognitionLang('de-DE');
              setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
              if (onComplete) onComplete();
            });
          }, 320);
        } else {
          setSpeakingSubPhase(null);
          setPhase('idle');
          switchRecognitionLang('de-DE');
          setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
          if (onComplete) onComplete();
        }
      });
    }
  }, [speakText, switchRecognitionLang]);

  const speakSequentialTranslation = useCallback((enMeaning, deSentence, onComplete) => {
    speakSequentialResult({ english: enMeaning, germanExample: deSentence }, 'de_en', onComplete);
  }, [speakSequentialResult]);

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
  // Clean German Text Extraction & Spoken POS Recognition
  // ----------------------------------------------------
  const extractGermanPhraseAndPos = (rawText) => {
    if (!rawText) return { cleanText: '', detectedPos: null };
    let detectedPos = null;
    let text = rawText;

    // Check for spoken POS qualifiers (e.g. "Verb ansehen", "ansehen als Verb", "Nomen ansehen", "Substantiv")
    if (/\b(als\s+verb|verb|als\s+zeitwort|als\s+tätigkeitswort)\b/i.test(text)) {
      detectedPos = 'verb';
      text = text.replace(/\b(als\s+verb|verb|als\s+zeitwort|als\s+tätigkeitswort)\b/gi, ' ');
    } else if (/\b(als\s+nomen|nomen|als\s+substantiv|substantiv|als\s+namenwort|als\s+hauptwort)\b/i.test(text)) {
      detectedPos = 'noun';
      text = text.replace(/\b(als\s+nomen|nomen|als\s+substantiv|substantiv|als\s+namenwort|als\s+hauptwort)\b/gi, ' ');
    }

    // 1. Strip leading trigger words
    text = text.replace(/^\s*(?:bitte\s+)?(?:über|ueber|uber)\s*setz(?:en|e|t|ung|er)?\b\s*/gi, ' ');

    // 2. Strip leading phone speaker acknowledgment echo ("In Bearbeitung" / "Bearbeitung")
    text = text.replace(/^\s*(?:in\s+bearbeitung|bearbeitung)\b\s*/gi, ' ');

    // 3. Strip trailing stop commands ("... Halt" / "... Stopp")
    text = text.replace(/\b(?:halt|halte|stopp|stop|stoppen|fertig|ende|genug)\b\s*$/gi, ' ');

    // 4. Strip repeat commands at boundaries
    text = text.replace(/^\s*(?:bitte\s+)?(?:wiederhol(?:en|e|t)?|noch\s*mal|noch\s*einmal)\b\s*/gi, ' ');
    text = text.replace(/\b(?:bitte\s+)?(?:wiederhol(?:en|e|t)?|noch\s*mal|noch\s*einmal)\b\s*$/gi, ' ');

    const cleanText = text
      .replace(/[.,;:!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // If remaining text was solely an echo or empty
    if (/^(?:in\s+bearbeitung|bearbeitung|übersetzen|uebersetzen|ubersetzen|halt|stopp)$/i.test(cleanText)) {
      return { cleanText: '', detectedPos };
    }

    return { cleanText, detectedPos };
  };

  // ----------------------------------------------------
  // Clean English Text Extraction (Supports phrases 1 to 6 words)
  // Preserves legitimate words like "progress", "stop", "hold" inside phrases
  // ----------------------------------------------------
  const extractEnglishPhraseAndPos = (rawText) => {
    if (!rawText) return { cleanText: '', detectedPos: null };
    let detectedPos = null;
    let text = rawText;

    if (/\b(as\s+a?\s*verb|verb)\b/i.test(text)) {
      detectedPos = 'verb';
      text = text.replace(/\b(as\s+a?\s*verb|verb)\b/gi, ' ');
    } else if (/\b(as\s+a?\s*noun|noun)\b/i.test(text)) {
      detectedPos = 'noun';
      text = text.replace(/\b(as\s+a?\s*noun|noun)\b/gi, ' ');
    }

    // 1. Strip leading trigger words (e.g. "Translate make an appointment Stop")
    text = text.replace(/^\s*(?:please\s+)?(?:translate|translation|translat|trenslate|trendslate)\b\s*/gi, ' ');

    // 2. Strip leading phone speaker acknowledgment echo ("In Progress" / "In Process" / "Progress")
    text = text.replace(/^\s*(?:in\s+progress|in\s+process|progress)\b\s*/gi, ' ');

    // 3. Strip trailing stop commands (e.g. "... Stop" or "... Halt")
    text = text.replace(/\b(?:stop|stopped|stopping|halt|done|finished)\b\s*$/gi, ' ');

    // 4. Strip repeat commands at boundaries
    text = text.replace(/^\s*(?:please\s+)?(?:repeat(?:\s+that|\s+sentence)?|say\s+again)\b\s*/gi, ' ');
    text = text.replace(/\b(?:repeat(?:\s+that|\s+sentence)?|say\s+again)\b\s*$/gi, ' ');

    const cleanText = text
      .replace(/[.,;:!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // If remaining text was solely an echo or command keyword
    if (/^(?:in\s+progress|in\s+process|progress|translate|stop|halt)$/i.test(cleanText)) {
      return { cleanText: '', detectedPos };
    }

    return { cleanText, detectedPos };
  };

  const extractSpokenPhraseAndPos = (rawText, dir = 'de_en') => {
    return dir === 'en_de' ? extractEnglishPhraseAndPos(rawText) : extractGermanPhraseAndPos(rawText);
  };

  const cleanSpokenPhrase = (rawText) => {
    return extractSpokenPhraseAndPos(rawText, directionRef.current || 'de_en').cleanText;
  };

  // ----------------------------------------------------
  // Local B1 Vocabulary Search (Checks verbs, nouns, conjugations)
  // ----------------------------------------------------
  const searchLocalVocab = useCallback((query, targetPos = 'auto', dir = 'de_en') => {
    if (!query || !vocabData) return null;
    const cleanQ = query.toLowerCase().trim();
    if (!cleanQ) return null;

    const normalizeWord = (w) => {
      return (w || '')
        .toLowerCase()
        .replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
        .replace(/\(.*\)/g, '')
        .replace(/,.*$/, '')
        .trim();
    };

    // If searching English to German:
    if (dir === 'en_de') {
      const qWithoutTo = cleanQ.replace(/^(to)\s+/i, '').trim();
      const categoriesToSearch = ['verbs', 'nouns', 'adjectives', 'connectors', 'reflexive'];

      const getItemsForCategory = (cat) => {
        if (Array.isArray(vocabData)) {
          return vocabData.filter(item => (item.category || '').toLowerCase() === cat);
        }
        return Array.isArray(vocabData[cat]) ? vocabData[cat] : [];
      };

      for (const cat of categoriesToSearch) {
        const items = getItemsForCategory(cat);
        const match = items.find(item => {
          if (!item.meaning) return false;
          const cleanMeaning = item.meaning.toLowerCase().replace(/^(to)\s+/i, '').trim();
          if (cleanMeaning === qWithoutTo) return true;
          const parts = cleanMeaning.split(/[,;\/]/).map(p => p.trim());
          return parts.includes(qWithoutTo);
        });
        if (match) return { ...match, category: cat };
      }
      return null;
    }

    // Standard German to English search:
    // Determine category search order based on targetPos
    // Categories available in vocabData: nouns, verbs, adjectives, connectors, reflexive
    let categoriesToSearch = [];
    if (targetPos === 'verb') {
      categoriesToSearch = ['verbs', 'reflexive'];
    } else if (targetPos === 'noun') {
      categoriesToSearch = ['nouns'];
    } else {
      // 'auto': prioritize verbs if input looks like an infinitive / lowercase;
      // prioritize nouns if input has definite article
      if (/^(der|die|das|ein|eine)\s+/i.test(cleanQ)) {
        categoriesToSearch = ['nouns', 'verbs', 'adjectives', 'connectors', 'reflexive'];
      } else {
        categoriesToSearch = ['verbs', 'nouns', 'reflexive', 'adjectives', 'connectors'];
      }
    }

    const getItemsForCategory = (cat) => {
      if (Array.isArray(vocabData)) {
        return vocabData.filter(item => (item.category || '').toLowerCase() === cat);
      }
      return Array.isArray(vocabData[cat]) ? vocabData[cat] : [];
    };

    // Pass 1: Exact match on normalized word or raw word
    for (const cat of categoriesToSearch) {
      const items = getItemsForCategory(cat);
      const match = items.find(item => {
        const itemRaw = (item.word || '').toLowerCase().trim();
        const itemNorm = normalizeWord(item.word);
        const queryNorm = normalizeWord(cleanQ);
        return itemRaw === cleanQ || itemNorm === queryNorm;
      });
      if (match) return { ...match, category: cat };
    }

    // Pass 2: Conjugation or plural match (e.g. "sieht an", "sah an", "hat angesehen" -> "ansehen")
    for (const cat of categoriesToSearch) {
      const items = getItemsForCategory(cat);
      const match = items.find(item => {
        if (item.conjugation) {
          const conjParts = item.conjugation
            .toLowerCase()
            .replace(/[^a-zäöüß\s]/g, ' ')
            .split(/\s+/);
          if (conjParts.includes(cleanQ)) return true;
          if (item.conjugation.toLowerCase().includes(cleanQ)) return true;
        }
        if (item.plural) {
          if (item.plural.toLowerCase().includes(cleanQ)) return true;
        }
        return false;
      });
      if (match) return { ...match, category: cat };
    }

    // Pass 3: If targetPos was 'auto', check remaining categories as fallback
    if (targetPos === 'auto') {
      const remainingCats = ['verbs', 'nouns', 'adjectives', 'connectors', 'reflexive']
        .filter(c => !categoriesToSearch.includes(c));
      for (const cat of remainingCats) {
        const items = getItemsForCategory(cat);
        const match = items.find(item => {
          const itemNorm = normalizeWord(item.word);
          const queryNorm = normalizeWord(cleanQ);
          return itemNorm === queryNorm;
        });
        if (match) return { ...match, category: cat };
      }
    }

    return null;
  }, [vocabData]);

  // ----------------------------------------------------
  // Translation Handler:
  // ----------------------------------------------------
  // Translation Handler (Bidirectional: DE -> EN and EN -> DE)
  // 1. Checks B1 Wordlist FIRST -> If present, returns immediately without Gemini query!
  // 2. Otherwise calls Gemini with explicit POS constraints & fallback models
  // 3. Supports 1 to 6 word English phrases for EN -> DE
  // ----------------------------------------------------
  const translateWithDirection = async (phraseToTranslate, dir = 'de_en', posOverride = null) => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const { cleanText: cleanInput, detectedPos: spokenPos } = extractSpokenPhraseAndPos(phraseToTranslate, dir);
    const effectivePos = posOverride || spokenPos || posFilter;

    if (!cleanInput) {
      const errMsg = dir === 'en_de' ? 'No English phrase detected.' : 'Kein deutsches Wort erkannt.';
      const errLang = dir === 'en_de' ? 'en-US' : 'de-DE';
      speakText(errMsg, errLang, () => {
        setPhase('idle');
        switchRecognitionLang('de-DE');
        setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
      });
      return;
    }

    if (spokenPos) {
      setPosFilter(spokenPos);
    }

    // ----------------------------------------------------
    // STEP 1: FAST PATH - CHECK B1 WORDLIST FIRST
    // ----------------------------------------------------
    const localMatch = searchLocalVocab(cleanInput, effectivePos, dir);
    if (localMatch) {
      const primaryExample = localMatch.examples?.[0];
      const germanEx = primaryExample?.de || `Beispielsatz: „${localMatch.word}“ ist ein wichtiges B1-Wort.`;
      const englishEx = primaryExample?.en || '';
      const isVerb = localMatch.category === 'verbs' || localMatch.category === 'reflexive';
      const isNoun = localMatch.category === 'nouns';

      const b1Result = {
        id: Date.now(),
        dir,
        german: localMatch.word,
        english: localMatch.meaning || (dir === 'en_de' ? cleanInput : 'Bedeutung im B1-Wortschatz'),
        germanExample: germanEx,
        englishExample: englishEx,
        notes: localMatch.conjugation || localMatch.plural || (localMatch.category ? `B1 Wortschatz (${localMatch.category})` : 'B1 Wortschatz'),
        category: localMatch.category,
        pos: isNoun ? 'noun' : (isVerb ? 'verb' : 'other'),
        usedModel: 'B1 Wortschatz (Lokal)',
        isFromB1List: true,
        wasFallback: false,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      lastResultRef.current = b1Result;
      setCurrentResult(b1Result);
      setHistory(prev => [b1Result, ...prev.filter(item => item.german !== b1Result.german)].slice(0, 10));

      // Speak Aloud sequentially based on direction
      speakSequentialResult(b1Result, dir);
      return; // EXIT EARLY! Zero Gemini API calls required!
    }

    // ----------------------------------------------------
    // STEP 2: NOT IN B1 WORDLIST -> QUERY GEMINI
    // ----------------------------------------------------
    setPhase('processing');
    const posHint = effectivePos === 'verb' ? ' (als Verb)' : effectivePos === 'noun' ? ' (als Nomen)' : '';
    if (dir === 'en_de') {
      setStatusMessage(`Gemini übersetzt: „${cleanInput}“${posHint} ins Deutsche...`);
    } else {
      setStatusMessage(`Nicht im B1-Wortschatz. Gemini übersetzt: „${cleanInput}“${posHint}...`);
    }

    let posInstruction = '';
    if (effectivePos === 'verb') {
      posInstruction = `
CRITICAL POS SPECIFICATION:
The user explicitly specified this is a VERB.
Translate and output the word in its base infinitive verb form (lowercase, e.g. "ansehen" = "to look at / to watch").
Do NOT translate it as a noun.`;
    } else if (effectivePos === 'noun') {
      posInstruction = `
CRITICAL POS SPECIFICATION:
The user explicitly specified this is a NOUN.
Translate and output the word as a NOUN with its German definite article (der/die/das) capitalized (e.g. "das Ansehen" = "reputation / prestige / standing").
Do NOT translate it as a verb.`;
    }

    const systemInstruction = dir === 'en_de'
      ? `You are an expert native German language teacher and translator (B1/B2 level).
Your job is to translate spoken English words or phrases (1 to 6 words) into natural, idiomatic German, and provide an authentic, high-quality German example sentence with its English translation.

CRITICAL RULES:
1. SPEECH-TO-TEXT PHONETIC ERROR RECONSTRUCTION:
   The English input was captured via a microphone speech-to-text system and may contain phonetic misspellings, misrecognitions, split words, or non-native acoustic artifacts (for example: "a point meant" / "a point mend" -> "appointment", "the cision" / "die session" -> "decision", "sustain able" -> "sustainable", "chelendsch" -> "challenge", "look forward too" -> "look forward to", "in vironment" -> "environment", "oppurtunity" -> "opportunity", "re leible" -> "reliable", "com for table" -> "comfortable", "make a point ment" -> "make an appointment").
   Intelligently reconstruct the user's intended authentic English word or phrase first, and output the correctly spelled English in the "english" field.
2. Translate the reconstructed English input into natural, accurate German:
   - If the English input is a single noun, include the German definite article (der/die/das) and capitalize it (e.g. "decision" -> "die Entscheidung").
   - If the English input is a verb or phrasal verb, provide the German infinitive (e.g. "take care of" -> "sich kümmern um").
   - If the English input is a short phrase or idiom (up to 6 words), provide the natural German idiomatic equivalent (e.g. "as soon as possible" -> "so bald wie möglich", "make an appointment" -> "einen Termin vereinbaren").
3. ALWAYS provide an actual, authentic, everyday German sentence (B1/B2 level) demonstrating the true practical usage in daily life, work, travel, or conversations.
4. NEVER generate generic, robotic, or meta sentences such as:
   - "Ich habe das Wort im Podcast gehört." (STRICTLY FORBIDDEN: never mention podcasts, radio, listening, or hearing words)
   - "Im Podcast wurde das Wort verwendet." (STRICTLY FORBIDDEN)
   - "Das Wort bedeutet..." or "Ich kenne dieses Wort." (STRICTLY FORBIDDEN)
5. Always return a clean JSON object with this exact schema:
{
  "german": "The accurate German translation (with article 'der/die/das' if noun, or infinitive if verb, or natural phrase)",
  "english": "The reconstructed/corrected English word or phrase",
  "germanExample": "An authentic, natural B1/B2 German sentence using this German word/phrase in real-world context (DO NOT mention podcasts or hearing words)",
  "englishExample": "Accurate English translation of the German example sentence",
  "notes": "Helpful grammar or usage note (e.g. preposition, case, or context)",
  "pos": "verb | noun | adjective | phrase | other"
}${posInstruction}`
      : `You are an expert native German language teacher and B1/B2 vocabulary coach.
Your job is to translate spoken German words or phrases into clear, natural English and provide an authentic, high-quality German example sentence.

CRITICAL RULES FOR "germanExample" AND "englishExample":
1. ALWAYS provide an actual, authentic, everyday German sentence (B1/B2 level) demonstrating the true practical usage of the word in daily life, work, travel, business, or social conversations.
2. NEVER generate generic, robotic, or meta sentences such as:
   - "Ich habe das Wort im Podcast gehört." (STRICTLY FORBIDDEN: never mention podcasts, radio, listening, or hearing words)
   - "Im Podcast wurde das Wort verwendet." (STRICTLY FORBIDDEN)
   - "Das Wort bedeutet..." or "Ich kenne dieses Wort." (STRICTLY FORBIDDEN)
3. The example sentence MUST show how native speakers actually use the word in context.
   Examples of EXCELLENT sentences:
   - "die Herausforderung" -> "Eine neue Sprache zu lernen ist eine große Herausforderung, aber es lohnt sich."
   - "ansehen" (Verb) -> "Wir müssen uns das Dokument vor dem Meeting noch genau ansehen."
   - "zuverlässig" -> "Mein Kollege ist sehr zuverlässig und pünktlich bei der Arbeit."
   - "die Voraussetzung" -> "Gute Deutschkenntnisse sind eine wichtige Voraussetzung für diesen Beruf."

Always return a clean JSON object with this exact schema:
{
  "german": "The correctly spelled German word/phrase (with article 'der/die/das' if it is a noun, e.g. 'die Herausforderung')",
  "english": "Concise, accurate English translation / meaning",
  "germanExample": "An authentic, natural B1/B2 German sentence using this word in real-world context (DO NOT mention podcasts or hearing words)",
  "englishExample": "Accurate English translation of the German example sentence",
  "notes": "Helpful grammar note (e.g. preposition used with verb like 'warten auf + Akk', plural form, or formality)",
  "pos": "verb | noun | adjective | other"
}${posInstruction}`;

    const promptText = dir === 'en_de'
      ? `English input captured from speech (1-6 words, possibly with speech-to-text phonetic artifacts): "${cleanInput}"
${effectivePos !== 'auto' ? `User requested part of speech: "${effectivePos.toUpperCase()}"` : ''}
Reconstruct intended English if needed, translate to German, and provide an authentic, natural German example sentence in a real-world scenario (DO NOT mention podcasts or audio).`
      : `German input captured from speech: "${cleanInput}"
${effectivePos !== 'auto' ? `User requested part of speech: "${effectivePos.toUpperCase()}"` : ''}
Provide an authentic, natural German example sentence in a real-world scenario (DO NOT mention podcasts or audio).`;

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
    if (!parsed || (dir === 'en_de' ? !parsed.german : !parsed.english)) {
      const langpair = dir === 'en_de' ? 'en|de' : 'de|en';
      try {
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanInput)}&langpair=${langpair}`);
        const data = await res.json();
        const translation = data?.responseData?.translatedText || cleanInput;

        let smartGermanExample = '';
        let smartEnglishExample = '';

        if (dir === 'en_de') {
          smartGermanExample = `Wir verwenden „${translation}“ häufig in diesem Zusammenhang.`;
          smartEnglishExample = `We often use "${cleanInput}" in this context.`;
          parsed = {
            german: translation,
            english: cleanInput,
            germanExample: smartGermanExample,
            englishExample: smartEnglishExample,
            notes: 'Automatische Schnellübersetzung',
            pos: effectivePos !== 'auto' ? effectivePos : 'phrase'
          };
        } else {
          const isLikelyVerb = effectivePos === 'verb' || cleanInput.toLowerCase().endsWith('en');
          const isLikelyNoun = effectivePos === 'noun' || /^(der|die|das)\s+/i.test(cleanInput);

          if (isLikelyVerb) {
            smartGermanExample = `Wir müssen das Problem sorgfältig ${cleanInput}, um eine gute Lösung zu finden.`;
            smartEnglishExample = `We need to carefully ${translation} the problem to find a good solution.`;
          } else if (isLikelyNoun) {
            smartGermanExample = `Das ist ein wichtiger Punkt für ${cleanInput} in unserem Projekt.`;
            smartEnglishExample = `That is an important point for ${translation} in our project.`;
          } else {
            smartGermanExample = `In der Praxis spielt „${cleanInput}“ eine entscheidende Rolle.`;
            smartEnglishExample = `In practice, "${translation}" plays a decisive role.`;
          }

          parsed = {
            german: cleanInput,
            english: translation,
            germanExample: smartGermanExample,
            englishExample: smartEnglishExample,
            notes: 'Automatische Schnellübersetzung',
            pos: effectivePos !== 'auto' ? effectivePos : (isLikelyNoun ? 'noun' : isLikelyVerb ? 'verb' : 'other')
          };
        }
      } catch (e) {
        parsed = {
          german: dir === 'en_de' ? cleanInput : cleanInput,
          english: dir === 'en_de' ? cleanInput : 'Translation unavailable',
          germanExample: `Können Sie das bitte im Satz wiederholen?`,
          englishExample: `Could you please repeat that in a sentence?`,
          notes: 'Bitte Netzwerkverbindung prüfen',
          pos: effectivePos !== 'auto' ? effectivePos : 'other'
        };
      }
    }

    // Safety guard: ensure no meta "podcast" sentence ever slips through
    if (parsed && parsed.germanExample && /podcast/i.test(parsed.germanExample)) {
      const gWord = parsed.german || cleanInput;
      const eWord = parsed.english || cleanInput;
      if (parsed.pos === 'verb' || gWord.endsWith('en')) {
        parsed.germanExample = `Wir müssen das Problem sorgfältig ${gWord}, um eine Lösung zu finden.`;
        parsed.englishExample = `We need to carefully ${eWord} the problem to find a solution.`;
      } else if (parsed.pos === 'noun' || /^(der|die|das)\s+/i.test(gWord)) {
        parsed.germanExample = `Das ist ein wichtiger Punkt für ${gWord} in unserem Alltag.`;
        parsed.englishExample = `That is an important point for ${eWord} in our daily life.`;
      } else {
        parsed.germanExample = `In der Praxis spielt „${gWord}“ eine wichtige Rolle.`;
        parsed.englishExample = `In practice, "${eWord}" plays an important role.`;
      }
    }

    const determinedPos = parsed.pos || (effectivePos !== 'auto' ? effectivePos : (/^(der|die|das)\s+/i.test(parsed.german) ? 'noun' : (parsed.german.endsWith('en') ? 'verb' : 'other')));

    const newResult = {
      id: Date.now(),
      dir,
      german: parsed.german || cleanInput,
      english: parsed.english || (dir === 'en_de' ? cleanInput : 'Unbekannt'),
      germanExample: parsed.germanExample || '',
      englishExample: parsed.englishExample || '',
      notes: parsed.notes || '',
      pos: determinedPos,
      usedModel: usedModelName,
      isFromB1List: false,
      wasFallback: fallbackTriggered,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    lastResultRef.current = newResult;
    setCurrentResult(newResult);
    setHistory(prev => [newResult, ...prev.filter(item => item.german !== newResult.german)].slice(0, 10));

    // Speak Aloud sequentially based on direction
    speakSequentialResult(newResult, dir);
  };

  const translateWithGemini = (phraseToTranslate, posOverride = null) => {
    return translateWithDirection(phraseToTranslate, directionRef.current || 'de_en', posOverride);
  };

  // ----------------------------------------------------
  // Speech Recognition Event Engine
  // ----------------------------------------------------
  const processGermanSpeech = useCallback((rawTranscript, currentResultCount = 0) => {
    if (!rawTranscript) return;
    const text = rawTranscript.trim();
    const lower = text.toLowerCase();
    const compact = lower.replace(/\s+/g, '');

    // Ignore phone's own speaker acknowledgments if picked up SOLELY
    const cleanAck = lower.replace(/[.,;:!?]/g, '').trim();
    if (
      cleanAck === 'in bearbeitung' ||
      cleanAck === 'bearbeitung' ||
      cleanAck === 'in progress' ||
      cleanAck === 'progress' ||
      cleanAck === 'in process'
    ) {
      return;
    }

    // Flexible trigger detection ("Übersetze" for DE->EN, "Translate" for EN->DE)
    const hasGermanTrigger =
      /(?:^|\s|[.,;:!?])(?:bitte\s+)?(?:über|ueber|uber)\s*setz(?:en|e|t|ung|er)?(?=\s|[.,;:!?]|$)/i.test(text) ||
      compact.includes('übersetz') ||
      compact.includes('uebersetz') ||
      compact.includes('ubersetz');

    const hasEnglishTrigger =
      /(?:^|\s|[.,;:!?])(?:please\s+)?(?:translate|translation|translat|trenslate|trendslate|trans\s*late)(?=\s|[.,;:!?]|$)/i.test(text) ||
      lower.includes('translate') ||
      lower.includes('translat') ||
      lower.includes('trenslat');

    // Flexible repeat detection ("Wiederholen" for DE, "Repeat" for EN)
    const hasGermanRepeat =
      /(?:^|\s|[.,;:!?])(?:bitte\s+)?(?:wiederhol(?:en|e|t)?|noch\s*mal|noch\s*einmal)(?=\s|[.,;:!?]|$)/i.test(text) ||
      compact.includes('wiederhol') ||
      compact.includes('nochmal');

    const hasEnglishRepeat =
      /(?:^|\s|[.,;:!?])(?:please\s+)?(?:repeat(?:\s+that|\s+sentence)?|say\s+again|once\s+more)(?=\s|[.,;:!?]|$)/i.test(text) ||
      lower.includes('repeat');

    const hasRepeat = hasGermanRepeat || hasEnglishRepeat;

    // Flexible stop detection: Standalone or at the end of utterance
    const hasGermanStop =
      /\b(halt|halte|stopp|fertig|ende|genug)\b[.!]?\s*$/i.test(text) ||
      /^(halt|halte|stopp|fertig|ende|genug)[.!]?$/i.test(lower);

    const hasEnglishStop =
      /\b(stop|stopped|stopping|done|finished)\b[.!]?\s*$/i.test(text) ||
      /^(stop|stopped|done|finished)[.!]?$/i.test(lower);

    const hasTrigger = hasGermanTrigger || hasEnglishTrigger;
    const hasStop = hasGermanStop || hasEnglishStop;

    // ----------------------------------------------------
    // State 1: IDLE or SPEAKING (Trigger starts new session OR Repeat re-speaks last word)
    // ----------------------------------------------------
    if (phaseRef.current === 'idle' || phaseRef.current === 'speaking') {
      // Repeat command ("Wiederholen" / "Repeat")
      if (hasRepeat) {
        const now = Date.now();
        if (now - lastTriggerTimeRef.current < 1500) {
          return;
        }
        lastTriggerTimeRef.current = now;

        if ('speechSynthesis' in window) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        isSpeakingTtsRef.current = false;
        setSpeakingSubPhase(null);

        const target = lastResultRef.current || currentResult || (history && history[0]);
        if (!target) {
          if (hasEnglishRepeat) {
            speakText('No translation to repeat.', 'en-US', () => {
              setPhase('idle');
              switchRecognitionLang('de-DE');
              setStatusMessage('Bereit. Sage „Übersetze“ (DE), „Translate“ (EN) oder „Wiederholen“.');
            });
          } else {
            speakText('Keine Übersetzung zum Wiederholen vorhanden.', 'de-DE', () => {
              setPhase('idle');
              switchRecognitionLang('de-DE');
              setStatusMessage('Bereit. Sage „Übersetze“ (DE), „Translate“ (EN) oder „Wiederholen“.');
            });
          }
          return;
        }

        const targetDir = target.dir || (hasEnglishRepeat ? 'en_de' : 'de_en');
        if (hasEnglishRepeat) {
          setStatusMessage(`Repeating translation & sentence: „${target.english || target.german}“...`);
        } else {
          setStatusMessage(`Wiederhole Übersetzung & Satz: „${target.german}“...`);
        }

        speakSequentialResult(target, targetDir);
        return;
      }

      if (hasTrigger) {
        // Prevent duplicate trigger execution from rapid interim + final speech results
        const now = Date.now();
        if (now - lastTriggerTimeRef.current < 2000) {
          return;
        }
        lastTriggerTimeRef.current = now;

        // Cancel any previous TTS immediately
        if ('speechSynthesis' in window) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        isSpeakingTtsRef.current = false;
        setSpeakingSubPhase(null);

        const targetDir = hasEnglishTrigger ? 'en_de' : 'de_en';
        setDirection(targetDir);
        directionRef.current = targetDir;

        // Check if user spoke entire command in one single breath: "Translate [phrase] Stop" or "Übersetze [word] Halt"
        if (hasStop) {
          const { cleanText: phrase, detectedPos } = extractSpokenPhraseAndPos(text, targetDir);
          if (phrase) {
            setPhase('recording');
            currentRecordingTextRef.current = phrase;
            detectedPosRef.current = detectedPos;
            if (targetDir === 'en_de') {
              setStatusMessage(`Phrase erfasst: „${phrase}“. Translating...`);
              speakText('In Progress', 'en-US', () => {
                translateWithDirection(phrase, 'en_de', detectedPos);
              });
            } else {
              setStatusMessage(`Wort erfasst: „${phrase}“. Übersetze...`);
              speakText('In Bearbeitung', 'de-DE', () => {
                translateWithDirection(phrase, 'de_en', detectedPos);
              });
            }
            return;
          }
        }

        // Standard 2-Step Flow:
        setPhase('recording');
        currentRecordingTextRef.current = '';
        detectedPosRef.current = null;
        setCurrentRecordingText('');
        setLiveTranscript('');
        recordedChunksRef.current = [];

        if (targetDir === 'en_de') {
          setStatusMessage('Aufnahme läuft (EN ➔ DE)... Sprich die Phrase (1-6 Wörter) und sage „Stop“.');
          recordingStartIndexRef.current = currentResultCount;
          switchRecognitionLang('en-US');
          speakText('In Progress', 'en-US');
        } else {
          setStatusMessage('Aufnahme läuft (DE ➔ EN)... Sprich das Wort und sage „Halt“.');
          recordingStartIndexRef.current = currentResultCount;
          switchRecognitionLang('de-DE');
          speakText('In Bearbeitung', 'de-DE');
        }
        return;
      }
    }

    // ----------------------------------------------------
    // State 2: RECORDING (Capturing word/phrase until "Stop" or "Halt" is heard)
    // Empty by default, NEVER auto-submits until stop keyword is spoken
    // ----------------------------------------------------
    if (phaseRef.current === 'recording') {
      // If repeat was spoken instead of a phrase while recording, abort to repeat last
      if (hasRepeat && !hasStop) {
        const cleanCheck = (cleanSpokenPhrase(text) || '').toLowerCase().trim();
        if (!cleanCheck || cleanCheck.includes('repeat') || cleanCheck.includes('wiederhol')) {
          setPhase('idle');
          currentRecordingTextRef.current = '';
          const target = lastResultRef.current || currentResult || (history && history[0]);
          if (target) {
            const targetDir = target.dir || (hasEnglishRepeat ? 'en_de' : 'de_en');
            speakSequentialResult(target, targetDir);
          }
          return;
        }
      }

      // If trailing or repeated trigger events arrive while recording, do not speak again
      if (hasTrigger && !hasStop) {
        return;
      }

      const activeDir = directionRef.current || 'de_en';
      const { cleanText: currentClean, detectedPos } = extractSpokenPhraseAndPos(text, activeDir);

      // Only update buffer if an actual word/phrase was spoken (not empty/trigger words)
      if (currentClean) {
        setLiveTranscript(currentClean);
        setCurrentRecordingText(currentClean);
        currentRecordingTextRef.current = currentClean;
        if (detectedPos) {
          detectedPosRef.current = detectedPos;
        }
      }

      // ONLY submit when user explicitly says "Stop" or "Halt"
      if (hasStop) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        const phraseToTranslate = currentClean || currentRecordingTextRef.current;
        const posToUse = detectedPos || detectedPosRef.current;

        if (phraseToTranslate) {
          setLiveTranscript('');
          setCurrentRecordingText('');
          currentRecordingTextRef.current = '';
          detectedPosRef.current = null;
          translateWithDirection(phraseToTranslate, activeDir, posToUse);
        } else {
          // If Stop/Halt was spoken but no word/phrase was captured yet
          if (activeDir === 'en_de') {
            setStatusMessage('Keine Phrase erfasst. Sage „Translate“, um es erneut zu versuchen.');
            switchRecognitionLang('de-DE');
          } else {
            setStatusMessage('Kein Wort erfasst. Sage „Übersetze“, um es erneut zu versuchen.');
          }
          setPhase('idle');
          currentRecordingTextRef.current = '';
          detectedPosRef.current = null;
        }
      }
    }
  }, [speakText, translateWithDirection, switchRecognitionLang, speakSequentialResult, cleanSpokenPhrase, currentResult, history]);

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
        recognition.maxAlternatives = 5;
        recognition.lang = recognitionLangRef.current || 'de-DE'; // Dynamic speech recognition engine
        recordingStartIndexRef.current = 0;

        recognition.onresult = (event) => {
          // 1. Inspect alternatives in newest results for commands / triggers
          let latestCandidate = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            for (let j = 0; j < event.results[i].length; j++) {
              const candidate = event.results[i][j].transcript.trim();
              if (!latestCandidate) latestCandidate = candidate;
              const candLower = candidate.toLowerCase();
              if (
                candLower.includes('übersetz') ||
                candLower.includes('uebersetz') ||
                candLower.includes('ubersetz') ||
                candLower.includes('halt') ||
                candLower.includes('stopp') ||
                candLower.includes('stop') ||
                candLower.includes('translate') ||
                candLower.includes('translat') ||
                candLower.includes('trenslate') ||
                candLower.includes('wiederhol') ||
                candLower.includes('repeat')
              ) {
                latestCandidate = candidate;
                break;
              }
            }
          }

          // 2. Compute cumulative transcript across all segments in the active recording session
          const startIdx = Math.max(0, recordingStartIndexRef.current || 0);
          let cumulativeTranscript = '';
          for (let i = startIdx; i < event.results.length; i++) {
            if (event.results[i] && event.results[i][0]) {
              const seg = event.results[i][0].transcript.trim();
              if (seg) {
                cumulativeTranscript += (cumulativeTranscript ? ' ' : '') + seg;
              }
            }
          }

          // In recording phase, use cumulative transcript so words spoken across pauses are never lost
          const textToProcess = (phaseRef.current === 'recording' && cumulativeTranscript)
            ? cumulativeTranscript
            : latestCandidate;

          if (textToProcess) {
            setLastHeardLive(textToProcess);
            if (processGermanSpeechRef.current) {
              processGermanSpeechRef.current(textToProcess, event.results.length);
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
            }, 40);
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
  const handleStartRecordingManual = async (dir = 'de_en') => {
    unlockAudio();
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
    setDirection(dir);
    directionRef.current = dir;
    setPhase('recording');
    setCurrentRecordingText('');
    currentRecordingTextRef.current = '';
    recordingStartIndexRef.current = 0;
    detectedPosRef.current = null;
    setLiveTranscript('');
    if (dir === 'en_de') {
      setStatusMessage('Aufnahme läuft (EN ➔ DE)... Sprich die Phrase (1-6 Wörter) und sage „Stop“.');
      switchRecognitionLang('en-US');
      speakText('In Progress', 'en-US');
    } else {
      setStatusMessage('Aufnahme läuft (DE ➔ EN)... Sprich das Wort und sage „Halt“.');
      switchRecognitionLang('de-DE');
      speakText('In Bearbeitung', 'de-DE');
    }
  };

  const handleStopRecordingManual = () => {
    unlockAudio();
    const activeDir = directionRef.current || 'de_en';
    const raw = liveTranscript || currentRecordingText || currentRecordingTextRef.current || manualInput;
    const { cleanText: textToUse, detectedPos } = extractSpokenPhraseAndPos(raw, activeDir);
    const finalWord = textToUse || currentRecordingTextRef.current;
    if (finalWord) {
      setLiveTranscript('');
      setCurrentRecordingText('');
      currentRecordingTextRef.current = '';
      translateWithDirection(finalWord, activeDir, detectedPos || detectedPosRef.current || posFilter);
    } else {
      setPhase('idle');
      switchRecognitionLang('de-DE');
      setStatusMessage(activeDir === 'en_de' ? 'Keine Phrase erfasst.' : 'Kein Wort eingegeben.');
    }
  };

  const handleManualSubmit = (e) => {
    if (e) e.preventDefault();
    unlockAudio();
    if (!manualInput.trim()) return;
    const activeDir = directionRef.current || 'de_en';
    const { cleanText, detectedPos } = extractSpokenPhraseAndPos(manualInput.trim(), activeDir);
    if (cleanText) {
      translateWithDirection(cleanText, activeDir, detectedPos || posFilter);
      setManualInput('');
    }
  };

  const handleRepeatTranslation = useCallback(() => {
    unlockAudio();
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    isSpeakingTtsRef.current = false;
    setSpeakingSubPhase(null);

    const target = lastResultRef.current || currentResult || (history && history[0]);
    if (!target) {
      const isEnglish = directionRef.current === 'en_de';
      speakText(isEnglish ? 'No translation to repeat.' : 'Keine Übersetzung zum Wiederholen vorhanden.', isEnglish ? 'en-US' : 'de-DE');
      return;
    }

    const targetDir = target.dir || directionRef.current || 'de_en';
    if (targetDir === 'en_de') {
      setStatusMessage(`Repeating translation & sentence for „${target.german || target.english}“...`);
    } else {
      setStatusMessage(`Wiederhole Übersetzung & Satz für „${target.german}“...`);
    }

    speakSequentialResult(target, targetDir);
  }, [currentResult, history, speakSequentialResult, speakText, unlockAudio]);

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
            {phase === 'recording'
              ? (direction === 'en_de' ? 'Aufnahme läuft (Sage „Stop“)...' : 'Aufnahme läuft (Sage „Halt“)...')
              : 'Hört zu: „Übersetze“, „Translate“ oder „Wiederholen“'}
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
            Hände-frei: <strong>„Übersetze“</strong> (DE) → <strong>„Halt“</strong>, <strong>„Translate“</strong> (EN) → <strong>„Stop“</strong>, oder <strong>„Wiederholen“</strong> / <strong>„Repeat“</strong> zum Nochmal-Hören.
          </p>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Continuous Voice Control Toggle */}
          <button
            type="button"
            id="live-voice-control-btn"
            onClick={async () => {
              unlockAudio();
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
          {phase === 'speaking' && (speakingSubPhase === 'en' ? 'Lese englische Übersetzung vor' : speakingSubPhase === 'de_translation' ? 'Lese deutsche Übersetzung vor' : 'Lese Beispielsatz vor')}
          {phase === 'idle' && (isVoiceActive ? 'Hört auf „Übersetze“ (DE) oder „Translate“ (EN)' : 'Voice Control inaktiv')}
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
            {liveTranscript
              ? `„${liveTranscript}“`
              : (direction === 'en_de'
                  ? 'Spreche jetzt deine englische Phrase (1-6 Wörter)... Beende mit „Stop“'
                  : 'Spreche jetzt dein deutsches Wort... Beende mit „Halt“')}
          </div>
        )}

        {/* Manual Push-to-Talk / Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
          {phase === 'idle' ? (
            <>
              <button
                type="button"
                onClick={() => handleStartRecordingManual('de_en')}
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '12px 20px',
                  fontSize: '13px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 16px rgba(59, 130, 246, 0.4)'
                }}
              >
                <span>🇩🇪</span>
                <span>Übersetzen (DE ➔ EN)</span>
              </button>
              <button
                type="button"
                onClick={() => handleStartRecordingManual('en_de')}
                style={{
                  background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '12px 20px',
                  fontSize: '13px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 16px rgba(139, 92, 246, 0.4)'
                }}
              >
                <span>🇬🇧</span>
                <span>Translate (EN ➔ DE)</span>
              </button>
            </>
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
              <span>{direction === 'en_de' ? 'Stop & Translate' : 'Halt & Übersetzen'}</span>
            </button>
          ) : null}
        </div>

        {/* Word Type / Part-of-Speech Segmented Control */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '20px',
          flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
            Wortart:
          </span>
          <div style={{
            display: 'inline-flex',
            background: 'rgba(255, 255, 255, 0.05)',
            padding: '4px',
            borderRadius: '14px',
            border: '1px solid rgba(255, 255, 255, 0.1)'
          }}>
            {[
              { id: 'auto', label: 'Auto (Erkennen)', icon: '🔍' },
              { id: 'verb', label: 'Verb', icon: '⚡', hint: 'Nur als Verb suchen/übersetzen (z.B. ansehen)' },
              { id: 'noun', label: 'Nomen', icon: '📦', hint: 'Nur als Nomen suchen/übersetzen (z.B. das Ansehen)' }
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPosFilter(tab.id)}
                style={{
                  background: posFilter === tab.id
                    ? (tab.id === 'verb' ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)' : tab.id === 'noun' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #8b5cf6, #6d28d9)')
                    : 'transparent',
                  border: 'none',
                  borderRadius: '10px',
                  color: posFilter === tab.id ? '#fff' : '#94a3b8',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: posFilter === tab.id ? '800' : '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  boxShadow: posFilter === tab.id ? '0 2px 8px rgba(0,0,0,0.25)' : 'none',
                  transition: 'all 0.15s ease'
                }}
                title={tab.hint}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Manual Text Input Bar */}
        <form onSubmit={handleManualSubmit} style={{
          maxWidth: '540px',
          margin: '20px auto 0',
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
            placeholder={direction === 'en_de' ? "Englische Phrase (1-6 Wörter) hier eintippen..." : (posFilter === 'verb' ? "Deutsches Verb eintippen (z.B. ansehen)..." : posFilter === 'noun' ? "Deutsches Nomen eintippen (z.B. Ansehen)..." : "Wort oder Phrase hier eintippen...")}
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
          border: currentResult.isFromB1List ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(59, 130, 246, 0.35)',
          padding: '28px 24px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.4)',
          position: 'relative'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: '800' }}>
                  Deutsches Wort / Phrase
                </span>
                {currentResult.pos && currentResult.pos !== 'other' && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: '800',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: currentResult.pos === 'verb' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                    color: currentResult.pos === 'verb' ? '#93c5fd' : '#fcd34d',
                    border: currentResult.pos === 'verb' ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)'
                  }}>
                    {currentResult.pos === 'verb' ? '⚡ Verb' : '📦 Nomen'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                <h2 style={{ fontSize: '32px', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>
                  {currentResult.german}
                </h2>
                {currentResult.isFromB1List ? (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '800',
                    padding: '4px 10px',
                    borderRadius: '8px',
                    background: 'rgba(16, 185, 129, 0.22)',
                    color: '#34d399',
                    border: '1px solid rgba(16, 185, 129, 0.45)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    <span>📚</span>
                    <span>B1 Wortschatz (Lokal · Kein Gemini-Call)</span>
                  </span>
                ) : currentResult.usedModel ? (
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
                ) : null}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Quick Switch Part of Speech Button */}
              <button
                type="button"
                onClick={() => {
                  const isCurrentlyVerb = currentResult.pos === 'verb' || (currentResult.category === 'verbs' || currentResult.category === 'reflexive') || (!currentResult.german.toLowerCase().startsWith('der ') && !currentResult.german.toLowerCase().startsWith('die ') && !currentResult.german.toLowerCase().startsWith('das ') && currentResult.german.endsWith('en'));
                  const newPos = isCurrentlyVerb ? 'noun' : 'verb';
                  setPosFilter(newPos);
                  translateWithGemini(currentResult.german, newPos);
                }}
                title="Als andere Wortart übersetzen"
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '12px',
                  color: '#e2e8f0',
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'background 0.2s ease'
                }}
              >
                <span>🔄</span>
                <span>
                  {(currentResult.pos === 'verb' || (currentResult.category === 'verbs' || currentResult.category === 'reflexive') || (!currentResult.german.toLowerCase().startsWith('der ') && !currentResult.german.toLowerCase().startsWith('die ') && !currentResult.german.toLowerCase().startsWith('das ') && currentResult.german.endsWith('en')))
                    ? 'Als Nomen übersetzen'
                    : 'Als Verb übersetzen'}
                </span>
              </button>

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

              {/* Repeat Translation & Example Sentence */}
              <button
                type="button"
                onClick={handleRepeatTranslation}
                title="Übersetzung und Beispielsatz wiederholen (Voice: „Wiederholen“ oder „Repeat“)"
                style={{
                  background: 'rgba(168, 85, 247, 0.18)',
                  border: '1px solid rgba(168, 85, 247, 0.45)',
                  borderRadius: '12px',
                  color: '#d8b4fe',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'background 0.2s ease'
                }}
              >
                <span>🔁</span>
                <span>Wiederholen</span>
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
              📜 Podcast Wörter ({history.length}{history.length >= 10 ? ' · Max 10' : ''})
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Die 10 neuesten erfassten Begriffe
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {filteredHistory.map((item) => (
              <div
                key={item.id}
                style={{
                  background: 'rgba(20, 22, 33, 0.65)',
                  border: item.isFromB1List ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)',
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '17px', fontWeight: '800', color: '#fff' }}>
                        {item.german}
                      </span>
                      {item.pos && item.pos !== 'other' && (
                        <span style={{
                          fontSize: '9px',
                          fontWeight: '800',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          textTransform: 'uppercase',
                          background: item.pos === 'verb' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: item.pos === 'verb' ? '#93c5fd' : '#fcd34d',
                          border: item.pos === 'verb' ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid rgba(245, 158, 11, 0.4)'
                        }}>
                          {item.pos === 'verb' ? 'Verb' : 'Nomen'}
                        </span>
                      )}
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
                    borderLeft: item.isFromB1List ? '2px solid #10b981' : '2px solid #3b82f6',
                    marginTop: '4px'
                  }}>
                    „{item.germanExample}“
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '4px' }}>
                  {item.isFromB1List ? (
                    <span style={{ fontSize: '10px', color: '#34d399', fontWeight: '700' }}>
                      📚 B1 Wortschatz
                    </span>
                  ) : item.usedModel ? (
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
