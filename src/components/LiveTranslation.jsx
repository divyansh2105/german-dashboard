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

// Curated dictionary of common German dual-usage words (homographs with both verb & noun usages)
const KNOWN_DUAL_USAGES = {
  'ansehen': {
    german: 'ansehen / das Ansehen',
    english: 'to look at / reputation',
    notes: 'Verb (ansehen) & Nomen (das Ansehen)',
    verb: {
      german: 'ansehen',
      english: 'to look at, to view, to watch',
      germanExample: 'Darf ich eure Urlaubsfotos ansehen?',
      englishExample: 'May I look at your vacation photos?',
      notes: 'ansehen, sieht an, sah an, hat angesehen (Verb)'
    },
    noun: {
      german: 'das Ansehen',
      english: 'reputation, prestige, standing',
      germanExample: 'Das Unternehmen genießt in Deutschland ein hohes Ansehen.',
      englishExample: 'The company enjoys a high reputation in Germany.',
      notes: 'das Ansehen (Sg., Nomen)'
    }
  },
  'treffen': {
    german: 'treffen / das Treffen',
    english: 'to meet / meeting',
    notes: 'Verb (treffen) & Nomen (das Treffen)',
    verb: {
      german: 'treffen',
      english: 'to meet, to encounter',
      germanExample: 'Wir treffen uns heute Abend um acht Uhr im Café.',
      englishExample: 'We are meeting tonight at eight o\'clock in the café.',
      notes: 'treffen, trifft, traf, hat getroffen (Verb)'
    },
    noun: {
      german: 'das Treffen',
      english: 'meeting, gathering, encounter',
      germanExample: 'Das Treffen mit den Kunden war sehr erfolgreich.',
      englishExample: 'The meeting with the clients was very successful.',
      notes: 'das Treffen, - (Nomen)'
    }
  },
  'essen': {
    german: 'essen / das Essen',
    english: 'to eat / food, meal',
    notes: 'Verb (essen) & Nomen (das Essen)',
    verb: {
      german: 'essen',
      english: 'to eat',
      germanExample: 'Was möchtest du heute zu Mittag essen?',
      englishExample: 'What would you like to eat for lunch today?',
      notes: 'essen, isst, aß, hat gegessen (Verb)'
    },
    noun: {
      german: 'das Essen',
      english: 'food, meal, dish',
      germanExample: 'Das Essen in diesem Restaurant schmeckt hervorragend.',
      englishExample: 'The food in this restaurant tastes excellent.',
      notes: 'das Essen, - (Nomen)'
    }
  },
  'leben': {
    german: 'leben / das Leben',
    english: 'to live / life',
    notes: 'Verb (leben) & Nomen (das Leben)',
    verb: {
      german: 'leben',
      english: 'to live',
      germanExample: 'Meine Familie lebt seit zehn Jahren in Berlin.',
      englishExample: 'My family has been living in Berlin for ten years.',
      notes: 'leben, lebte, hat gelebt (Verb)'
    },
    noun: {
      german: 'das Leben',
      english: 'life',
      germanExample: 'Das Leben in einer Großstadt bietet viele Möglichkeiten.',
      englishExample: 'Life in a big city offers many opportunities.',
      notes: 'das Leben, - (Nomen)'
    }
  },
  'schreiben': {
    german: 'schreiben / das Schreiben',
    english: 'to write / official letter',
    notes: 'Verb (schreiben) & Nomen (das Schreiben)',
    verb: {
      german: 'schreiben',
      english: 'to write',
      germanExample: 'Ich muss heute noch eine wichtige E-Mail schreiben.',
      englishExample: 'I still have to write an important email today.',
      notes: 'schreiben, schrieb, hat geschrieben (Verb)'
    },
    noun: {
      german: 'das Schreiben',
      english: 'official letter, formal notice',
      germanExample: 'Haben Sie das offizielle Schreiben der Behörde erhalten?',
      englishExample: 'Did you receive the official letter from the authority?',
      notes: 'das Schreiben, - (Nomen)'
    }
  },
  'versprechen': {
    german: 'versprechen / das Versprechen',
    english: 'to promise / promise',
    notes: 'Verb (versprechen) & Nomen (das Versprechen)',
    verb: {
      german: 'versprechen',
      english: 'to promise (or sich versprechen: to misspeak)',
      germanExample: 'Ich verspreche dir, dass ich morgen pünktlich bin.',
      englishExample: 'I promise you that I will be on time tomorrow.',
      notes: 'versprechen, verspricht, versprach, hat versprochen (Verb)'
    },
    noun: {
      german: 'das Versprechen',
      english: 'promise, pledge',
      germanExample: 'Er hat sein Versprechen gehalten und uns geholfen.',
      englishExample: 'He kept his promise and helped us.',
      notes: 'das Versprechen, - (Nomen)'
    }
  },
  'wissen': {
    german: 'wissen / das Wissen',
    english: 'to know / knowledge',
    notes: 'Verb (wissen) & Nomen (das Wissen)',
    verb: {
      german: 'wissen',
      english: 'to know (a fact)',
      germanExample: 'Weißt du, wann der nächste Zug nach München abfährt?',
      englishExample: 'Do you know when the next train to Munich departs?',
      notes: 'wissen, weiß, wusste, hat gewusst (Verb)'
    },
    noun: {
      german: 'das Wissen',
      english: 'knowledge, expertise',
      germanExample: 'Sein Fachwissen über deutsche Grammatik ist beeindruckend.',
      englishExample: 'His expertise in German grammar is impressive.',
      notes: 'das Wissen (Sg., Nomen)'
    }
  },
  'hoffen': {
    german: 'hoffen / die Hoffnung',
    english: 'to hope / hope',
    notes: 'Verb (hoffen) & Nomen (die Hoffnung)',
    verb: {
      german: 'hoffen',
      english: 'to hope',
      germanExample: 'Wir hoffen auf gutes Wetter am Wochenende.',
      englishExample: 'We are hoping for good weather this weekend.',
      notes: 'hoffen, hoffte, hat gehofft (Verb)'
    },
    noun: {
      german: 'die Hoffnung',
      english: 'hope',
      germanExample: 'Ich habe die Hoffnung noch lange nicht aufgegeben.',
      englishExample: 'I haven\'t given up hope by a long shot.',
      notes: 'die Hoffnung, -en (Nomen)'
    }
  },
  'arbeiten': {
    german: 'arbeiten / die Arbeit',
    english: 'to work / work, job',
    notes: 'Verb (arbeiten) & Nomen (die Arbeit)',
    verb: {
      german: 'arbeiten',
      english: 'to work',
      germanExample: 'Er arbeitet als Software-Entwickler in München.',
      englishExample: 'He works as a software developer in Munich.',
      notes: 'arbeiten, arbeitete, hat gearbeitet (Verb)'
    },
    noun: {
      german: 'die Arbeit',
      english: 'work, job, employment',
      germanExample: 'Die Arbeit macht mir wirklich großen Spaß.',
      englishExample: 'I really enjoy the work.',
      notes: 'die Arbeit, -en (Nomen)'
    }
  }
};

export default function LiveTranslation({
  vocabData = [],
  myList = [],
  onToggleMyList,
  isAnonymous = false
}) {
  // Voice Control & Keep-Awake state (default active for instant hands-free use)
  const [isVoiceActive, setIsVoiceActive] = useState(() => {
    try {
      return localStorage.getItem('b1_live_voice_active') !== 'false';
    } catch (e) {
      return true;
    }
  });
  const [isKeepAwake, setIsKeepAwake] = useState(false);
  const [isPocketMode, setIsPocketMode] = useState(false);

  // Direction: 'de_en' (German -> English) or 'en_de' (English -> German)
  const [direction, setDirection] = useState('de_en');
  const directionRef = useRef('de_en');

  // Core recognition phase: 'idle' | 'recording' | 'processing' | 'speaking'
  const [phase, setPhase] = useState('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [currentRecordingText, setCurrentRecordingText] = useState('');
  const [currentResult, setCurrentResult] = useState(null);
  const currentResultRef = useRef(null);
  const [speakingSubPhase, setSpeakingSubPhase] = useState(null); // 'en' | 'de_example' | 'dual_verb' | 'dual_noun' | 'de_word'
  const [statusMessage, setStatusMessage] = useState('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
  const [lastHeardLive, setLastHeardLive] = useState('');
  const [fallbackNotice, setFallbackNotice] = useState('');
  const [availableModels, setAvailableModels] = useState(() => getStoredAvailableModels());

  // Keep currentResultRef in sync with state
  useEffect(() => {
    currentResultRef.current = currentResult;
  }, [currentResult]);

  // Translation history (persisted in localStorage, limited to 10 items)
  const [history, setHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_live_translations');
      return saved ? JSON.parse(saved).slice(0, 10) : [];
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

  // Save history to localStorage (capped at 10 items)
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
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.cancel();
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

  // ----------------------------------------------------
  // Sequential Speaker for Translation Results
  // Handles: Dual usages (verb + noun) AND bidirectional DE <-> EN
  // ----------------------------------------------------
  const speakResult = useCallback((res, onComplete) => {
    if (!res) {
      if (onComplete) onComplete();
      return;
    }

    if (ttsSafetyTimerRef.current) clearTimeout(ttsSafetyTimerRef.current);

    setPhase('speaking');

    // CASE 1: Dual Usages (Verb + Noun)
    if (res.hasBothUsages && res.verbUsage && res.nounUsage) {
      setStatusMessage('Lese beide Verwendungen vor: Verb & Nomen');
      setSpeakingSubPhase('dual_verb');

      // 1a. Announce Verb in English
      const verbAnnounce = `Verb: ${res.verbUsage.english}`;
      speakText(verbAnnounce, 'en-US', () => {
        if (!isMountedRef.current) return;
        // 1b. German verb example sentence
        setTimeout(() => {
          if (!isMountedRef.current) return;
          speakText(res.verbUsage.germanExample || res.verbUsage.german, 'de-DE', () => {
            if (!isMountedRef.current) return;
            // 2. Pause 420ms -> Announce Noun in English
            setTimeout(() => {
              if (!isMountedRef.current) return;
              setSpeakingSubPhase('dual_noun');
              const nounAnnounce = `Noun: ${res.nounUsage.german}, ${res.nounUsage.english}`;
              speakText(nounAnnounce, 'en-US', () => {
                if (!isMountedRef.current) return;
                // 2b. German noun example sentence
                setTimeout(() => {
                  if (!isMountedRef.current) return;
                  speakText(res.nounUsage.germanExample || res.nounUsage.german, 'de-DE', () => {
                    if (!isMountedRef.current) return;
                    setSpeakingSubPhase(null);
                    setPhase('idle');
                    setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
                    if (onComplete) onComplete();
                  });
                }, 300);
              });
            }, 420);
          });
        }, 300);
      });
      return;
    }

    // CASE 2: Single Usage
    const dir = res.direction || 'de_en';
    if (dir === 'en_de') {
      // English -> German: Speak German word -> German example -> English meaning
      setStatusMessage(`Lese deutsche Übersetzung vor: „${res.german}“`);
      setSpeakingSubPhase('de_word');
      speakText(res.german, 'de-DE', () => {
        if (!isMountedRef.current) return;
        if (res.germanExample) {
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setSpeakingSubPhase('de_example');
            speakText(res.germanExample, 'de-DE', () => {
              if (!isMountedRef.current) return;
              setTimeout(() => {
                if (!isMountedRef.current) return;
                setSpeakingSubPhase('en');
                speakText(res.english, 'en-US', () => {
                  if (!isMountedRef.current) return;
                  setSpeakingSubPhase(null);
                  setPhase('idle');
                  setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
                  if (onComplete) onComplete();
                });
              }, 300);
            });
          }, 300);
        } else {
          setTimeout(() => {
            if (!isMountedRef.current) return;
            setSpeakingSubPhase('en');
            speakText(res.english, 'en-US', () => {
              if (!isMountedRef.current) return;
              setSpeakingSubPhase(null);
              setPhase('idle');
              setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
              if (onComplete) onComplete();
            });
          }, 300);
        }
      });
    } else {
      // German -> English: Speak English meaning -> German example
      setStatusMessage(`Lese Übersetzung vor: „${res.english}“`);
      setSpeakingSubPhase('en');
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
              setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
              if (onComplete) onComplete();
            });
          }, 320);
        } else {
          setSpeakingSubPhase(null);
          setPhase('idle');
          setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
          if (onComplete) onComplete();
        }
      });
    }
  }, [speakText]);

  // Backward-compatibility alias
  const speakSequentialTranslation = useCallback((enMeaning, deSentence, onComplete) => {
    speakResult({
      hasBothUsages: false,
      german: '',
      english: enMeaning,
      germanExample: deSentence,
      direction: 'de_en'
    }, onComplete);
  }, [speakResult]);

  // ----------------------------------------------------
  // "Wiederholen" / "Repeat" Action Handler
  // ----------------------------------------------------
  const handleRepeat = useCallback(() => {
    unlockAudio();
    if (currentResultRef.current) {
      speakResult(currentResultRef.current);
    } else {
      speakText('Keine vorherige Übersetzung vorhanden.', 'de-DE');
    }
  }, [unlockAudio, speakResult, speakText]);

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
  // Spoken Phrase Extractors:
  // - German to English: strictly single words (preserves article + noun if spoken together)
  // - English to German: small phrases (3 to 5 words) or single words
  // ----------------------------------------------------
  const extractGermanPhrase = (rawText) => {
    if (!rawText) return '';
    let t = rawText.trim();
    // 1. Remove ANY trigger words (including ubersetz, uber setzen, etc.)
    t = t.replace(/\b(bitte\s+)?(über\s*setz(e|en|t|ung|er)?|ueber\s*setz(e|en|t|ung|er)?|uber\s*setz(e|en|t|ung|er)?|translate|translation)\b/gi, '');
    // 2. Remove TTS acknowledgments if picked up by microphone
    t = t.replace(/\b(in bearbeitung|bearbeitung|in process|in progress)\b/gi, '');
    // 3. Remove repeat command
    t = t.replace(/\b(wiederhol(e|en|t)?|repeat|nochmal)\b/gi, '');
    // 4. Remove stop commands (standalone words or compound suffixes)
    t = t.replace(/\b(halt|halte|stopp|stop|stoppen|stopped|hold|holt|pause|fertig|ende|end|done|genug)\b/gi, '');
    t = t.replace(/(halt|halte|stopp|stop|stoppen|hold|fertig|ende)$/gi, '');
    // 5. Remove conversational fillers
    t = t.replace(/\b(auf englisch|in english)\b/gi, '');
    t = t.replace(/\b(das wort|das|die|der)?\s*(wort|bedeutung|ähm|äh)\b/gi, '');
    t = t.replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();

    // Supports single words or small German phrases/collocations (up to 4 words)
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length <= 4) return words.join(' ');
    return words.slice(0, 4).join(' ');
  };

  const extractEnglishPhrase = (rawText) => {
    if (!rawText) return '';
    let t = rawText.trim();
    // 1. Remove ANY trigger words
    t = t.replace(/\b(please\s+)?(translate|translation|translating|über\s*setz(e|en|t)?|uber\s*setz(e|en|t)?)\b/gi, '');
    // 2. Remove TTS acknowledgments if picked up by microphone
    t = t.replace(/\b(in process|in progress|in bearbeitung|bearbeitung)\b/gi, '');
    // 3. Remove repeat command
    t = t.replace(/\b(repeat|say again|nochmal)\b/gi, '');
    // 4. Remove stop commands (standalone or compound suffix)
    t = t.replace(/\b(stop|halt|finished|done|finish|end|hold|enough)\b/gi, '');
    t = t.replace(/(stop|halt|finished|done|finish|end)$/gi, '');
    // 5. Remove conversational fillers
    t = t.replace(/\b(the phrase is|phrase is|the phrase|the word is|the word|in german|auf deutsch|uh|um|erm|ah)\b/gi, '');
    t = t.replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();

    // Supports small phrases (3 to 5 words) or single words for EN -> DE
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length <= 5) return words.join(' ');
    return words.slice(0, 5).join(' ');
  };

  const extractSpokenPhraseAndPos = (rawText) => {
    const cleanText = extractGermanPhrase(rawText);
    return { cleanText, detectedPos: null };
  };

  // ----------------------------------------------------
  // Local B1 Vocabulary Search (Checks verbs, nouns, connectors, idioms, phrases)
  // ----------------------------------------------------
  const searchLocalVocab = useCallback((query, targetPos = 'auto', dir = 'de_en') => {
    if (!query || !vocabData) return null;
    const cleanQ = query.toLowerCase().trim();
    if (!cleanQ) return null;
    const cleanQNormalized = cleanQ.replace(/\.\.\./g, ' ').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();

    const normalizeGerman = (w) => {
      return (w || '')
        .toLowerCase()
        .replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
        .replace(/\.\.\./g, ' ')
        .replace(/\(.*\)/g, '')
        .replace(/,.*$/, '')
        .replace(/[.,;:!?]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const getItemsForCategory = (cat) => {
      if (Array.isArray(vocabData)) {
        return vocabData.filter(item => (item.category || '').toLowerCase() === cat);
      }
      return Array.isArray(vocabData[cat]) ? vocabData[cat] : [];
    };

    // --------------------------------------------------
    // Direction 1: English -> German lookup (by meaning)
    // --------------------------------------------------
    if (dir === 'en_de') {
      const cleanEnglish = cleanQ.replace(/^to\s+/i, '').trim();
      const cleanEnglishNormalized = cleanEnglish.replace(/\.\.\./g, ' ').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();

      // Check KNOWN_DUAL_USAGES first for English match
      for (const [key, dual] of Object.entries(KNOWN_DUAL_USAGES)) {
        const verbEn = dual.verb.english.toLowerCase();
        const nounEn = dual.noun.english.toLowerCase();
        if (
          verbEn.includes(cleanEnglish) ||
          nounEn.includes(cleanEnglish) ||
          cleanEnglish.includes(key)
        ) {
          return {
            hasBothUsages: true,
            german: dual.german,
            english: dual.english,
            germanExample: dual.verb.germanExample,
            englishExample: dual.verb.englishExample,
            notes: dual.notes,
            verbUsage: dual.verb,
            nounUsage: dual.noun,
            pos: 'verb & noun',
            isFromB1List: true,
            direction: 'en_de'
          };
        }
      }

      // Check all categories in vocabData by meaning (prioritize connectors/idioms for multi-word phrases)
      const isMultiWord = cleanEnglish.includes(' ') || cleanQ.includes(' ');
      const allCategories = isMultiWord
        ? ['connectors', 'verbs', 'reflexive', 'nouns', 'adjectives']
        : ['verbs', 'nouns', 'reflexive', 'adjectives', 'connectors'];

      for (const cat of allCategories) {
        const items = getItemsForCategory(cat);
        const match = items.find(item => {
          const m = (item.meaning || '').toLowerCase();
          const cleanM = m.replace(/\.\.\./g, ' ').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
          if (m === cleanQ || cleanM === cleanQNormalized || m === cleanEnglish || cleanM === cleanEnglishNormalized) return true;

          const chunks = m.split(/[,;/]+/).map(s => s.trim().replace(/^to\s+/i, '').replace(/\.\.\./g, ' ').replace(/\s+/g, ' '));
          if (chunks.includes(cleanEnglish) || chunks.includes(cleanQ) || chunks.includes(cleanEnglishNormalized)) return true;

          // For phrases longer than 3 characters, test boundary phrase match
          if (cleanEnglish.length > 3) {
            const safePattern = cleanEnglish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const phraseRegex = new RegExp(`(^|\\b)${safePattern}(\\b|$)`, 'i');
            if (phraseRegex.test(cleanM)) return true;
          }
          return false;
        });

        if (match) {
          const normMatchWord = normalizeGerman(match.word);
          // Check if this matched word has a known dual companion
          if (KNOWN_DUAL_USAGES[normMatchWord]) {
            const dual = KNOWN_DUAL_USAGES[normMatchWord];
            return {
              hasBothUsages: true,
              german: dual.german,
              english: dual.english,
              germanExample: dual.verb.germanExample,
              englishExample: dual.verb.englishExample,
              notes: dual.notes,
              verbUsage: dual.verb,
              nounUsage: dual.noun,
              pos: 'verb & noun',
              isFromB1List: true,
              direction: 'en_de'
            };
          }

          const primaryExample = match.examples?.[0];
          const isPhraseOrConn = cat === 'connectors' || (match.word && match.word.includes(' '));
          return {
            hasBothUsages: false,
            german: match.word,
            english: match.meaning,
            germanExample: primaryExample?.de || `Beispielsatz: „${match.word}“ ist ein wichtiger Ausdruck.`,
            englishExample: primaryExample?.en || '',
            notes: match.conjugation || match.plural || (match.category ? `B1 Wortschatz (${match.category})` : 'B1 Wortschatz'),
            category: match.category || cat,
            pos: isPhraseOrConn ? 'phrase' : (cat === 'nouns' ? 'noun' : (cat === 'verbs' || cat === 'reflexive' ? 'verb' : 'other')),
            isFromB1List: true,
            direction: 'en_de'
          };
        }
      }

      return null;
    }

    // --------------------------------------------------
    // Direction 2: German -> English lookup
    // --------------------------------------------------
    const normQ = normalizeGerman(cleanQ);

    // Step A: Check KNOWN_DUAL_USAGES immediately (e.g. "ansehen" -> returns both verb and noun!)
    if (KNOWN_DUAL_USAGES[normQ]) {
      const dual = KNOWN_DUAL_USAGES[normQ];
      return {
        hasBothUsages: true,
        german: dual.german,
        english: dual.english,
        germanExample: dual.verb.germanExample,
        englishExample: dual.verb.englishExample,
        notes: dual.notes,
        verbUsage: dual.verb,
        nounUsage: dual.noun,
        pos: 'verb & noun',
        isFromB1List: true,
        direction: 'de_en'
      };
    }

    // Also check if user spoke a noun like "das Ansehen"
    for (const [key, dual] of Object.entries(KNOWN_DUAL_USAGES)) {
      if (normalizeGerman(dual.noun.german) === normQ || dual.noun.german.toLowerCase() === cleanQ) {
        return {
          hasBothUsages: true,
          german: dual.german,
          english: dual.english,
          germanExample: dual.verb.germanExample,
          englishExample: dual.verb.englishExample,
          notes: dual.notes,
          verbUsage: dual.verb,
          nounUsage: dual.noun,
          pos: 'verb & noun',
          isFromB1List: true,
          direction: 'de_en'
        };
      }
    }

    // Step B: Check connectors and multi-word phrases first if query contains spaces or dots
    const connectorItems = getItemsForCategory('connectors');
    const matchedConnector = connectorItems.find(item => {
      const normWord = normalizeGerman(item.word);
      const rawWord = (item.word || '').toLowerCase().replace(/\.\.\./g, ' ').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
      return normWord === normQ || rawWord === cleanQNormalized || normWord === cleanQNormalized || (item.word || '').toLowerCase() === cleanQ;
    });

    if (matchedConnector) {
      const ex = matchedConnector.examples?.[0];
      return {
        hasBothUsages: false,
        german: matchedConnector.word,
        english: matchedConnector.meaning || 'Bedeutung im B1-Wortschatz',
        germanExample: ex?.de || `Beispielsatz: „${matchedConnector.word}“.`,
        englishExample: ex?.en || '',
        notes: matchedConnector.category ? `B1 Konnektor / Redemittel (${matchedConnector.category})` : 'B1 Redemittel',
        category: 'connectors',
        pos: 'phrase',
        isFromB1List: true,
        direction: 'de_en'
      };
    }

    // Step C: Check vocabData for both verb and noun matches
    const verbItems = [...getItemsForCategory('verbs'), ...getItemsForCategory('reflexive')];
    const nounItems = getItemsForCategory('nouns');

    const matchedVerb = verbItems.find(item => {
      const itemNorm = normalizeGerman(item.word);
      const rawWord = (item.word || '').toLowerCase().replace(/\.\.\./g, ' ').replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
      return itemNorm === normQ || rawWord === cleanQNormalized || itemNorm === cleanQNormalized || (item.word || '').toLowerCase() === cleanQ;
    });

    const matchedNoun = nounItems.find(item => {
      const itemNorm = normalizeGerman(item.word);
      const rawWord = (item.word || '').toLowerCase().replace(/[.,;:!?]/g, ' ').replace(/\s+/g, ' ').trim();
      return itemNorm === normQ || rawWord === cleanQNormalized || itemNorm === cleanQNormalized || (item.word || '').toLowerCase() === cleanQ;
    });

    // If both exist in B1 dataset, return dual usage!
    if (matchedVerb && matchedNoun) {
      const verbEx = matchedVerb.examples?.[0];
      const nounEx = matchedNoun.examples?.[0];
      return {
        hasBothUsages: true,
        german: `${matchedVerb.word} / ${matchedNoun.word}`,
        english: `${matchedVerb.meaning} / ${matchedNoun.meaning}`,
        germanExample: verbEx?.de || nounEx?.de || '',
        englishExample: verbEx?.en || nounEx?.en || '',
        notes: `Verb & Nomen im B1 Wortschatz`,
        verbUsage: {
          german: matchedVerb.word,
          english: matchedVerb.meaning,
          germanExample: verbEx?.de || `Beispielsatz: „${matchedVerb.word}“.`,
          englishExample: verbEx?.en || '',
          notes: matchedVerb.conjugation || 'Verb'
        },
        nounUsage: {
          german: matchedNoun.word,
          english: matchedNoun.meaning,
          germanExample: nounEx?.de || `Beispielsatz: „${matchedNoun.word}“.`,
          englishExample: nounEx?.en || '',
          notes: matchedNoun.plural || 'Nomen'
        },
        pos: 'verb & noun',
        isFromB1List: true,
        direction: 'de_en'
      };
    }

    // Step D: Single match in vocabData
    const singleMatch = matchedVerb || matchedNoun || (() => {
      for (const cat of ['adjectives', 'connectors']) {
        const match = getItemsForCategory(cat).find(item => {
          const itemNorm = normalizeGerman(item.word);
          const rawWord = (item.word || '').toLowerCase().replace(/\.\.\./g, ' ').replace(/\s+/g, ' ').trim();
          return itemNorm === normQ || rawWord === cleanQNormalized || itemNorm === cleanQNormalized;
        });
        if (match) return { ...match, category: cat };
      }
      return null;
    })();

    if (singleMatch) {
      const ex = singleMatch.examples?.[0];
      const isV = singleMatch.category === 'verbs' || singleMatch.category === 'reflexive' || !!singleMatch.conjugation;
      const isN = singleMatch.category === 'nouns';
      const isPhrase = singleMatch.category === 'connectors' || (singleMatch.word && singleMatch.word.includes(' '));
      return {
        hasBothUsages: false,
        german: singleMatch.word,
        english: singleMatch.meaning || 'Bedeutung im B1-Wortschatz',
        germanExample: ex?.de || `Beispielsatz: „${singleMatch.word}“ ist ein wichtiger B1-Ausdruck.`,
        englishExample: ex?.en || '',
        notes: singleMatch.conjugation || singleMatch.plural || (singleMatch.category ? `B1 Wortschatz (${singleMatch.category})` : 'B1 Wortschatz'),
        category: singleMatch.category,
        pos: isPhrase ? 'phrase' : (isN ? 'noun' : (isV ? 'verb' : 'other')),
        isFromB1List: true,
        direction: 'de_en'
      };
    }

    return null;
  }, [vocabData]);

  // ----------------------------------------------------
  // Translation Handler (Dual Usages + Bidirectional DE <-> EN)
  // 1. Checks B1 Wordlist FIRST -> If present, returns immediately without Gemini query!
  // 2. Otherwise calls Gemini with dual usage instructions & fallback models
  // ----------------------------------------------------
  const translateWithDirection = async (phraseToTranslate, dir = 'de_en') => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const cleanInput = dir === 'en_de' ? extractEnglishPhrase(phraseToTranslate) : extractGermanPhrase(phraseToTranslate);

    if (!cleanInput) {
      const msg = dir === 'en_de' ? 'No English word detected.' : 'Kein deutsches Wort erkannt.';
      const lang = dir === 'en_de' ? 'en-US' : 'de-DE';
      speakText(msg, lang, () => {
        setPhase('idle');
        setStatusMessage('Bereit. Sage „Übersetze“ (DE) oder „Translate“ (EN).');
      });
      return;
    }

    // ----------------------------------------------------
    // STEP 1: FAST PATH - CHECK B1 WORDLIST & KNOWN DUAL USAGES FIRST (NO GEMINI CALL)
    // ----------------------------------------------------
    const localMatch = searchLocalVocab(cleanInput, 'auto', dir);
    if (localMatch) {
      const b1Result = {
        id: Date.now(),
        german: localMatch.german,
        english: localMatch.english,
        germanExample: localMatch.germanExample,
        englishExample: localMatch.englishExample,
        notes: localMatch.notes,
        category: localMatch.category,
        pos: localMatch.pos,
        hasBothUsages: !!localMatch.hasBothUsages,
        verbUsage: localMatch.verbUsage || null,
        nounUsage: localMatch.nounUsage || null,
        usedModel: 'B1 Wortschatz (Lokal)',
        isFromB1List: true,
        wasFallback: false,
        direction: dir,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setCurrentResult(b1Result);
      setHistory(prev => [b1Result, ...prev.filter(item => item.german !== b1Result.german)].slice(0, 10));

      // Speak both usages or single usage aloud
      speakResult(b1Result);
      return; // EXIT EARLY! Zero Gemini calls required!
    }

    // ----------------------------------------------------
    // STEP 2: NOT IN B1 WORDLIST -> QUERY GEMINI WITH DUAL USAGE INSTRUCTIONS
    // ----------------------------------------------------
    setPhase('processing');
    const isEn = dir === 'en_de';
    setStatusMessage(
      isEn
        ? `Nicht im B1-Wortschatz. Gemini übersetzt: "${cleanInput}"...`
        : `Nicht im B1-Wortschatz. Gemini übersetzt: „${cleanInput}“...`
    );

    const isPhraseInput = cleanInput.includes(' ') || cleanInput.split(/\s+/).length > 1;

    const systemInstruction = `You are a native German language expert and Goethe B1/B2 curriculum language coach.
Your job is to translate between German and English:

1. GERMAN TO ENGLISH (DE ➔ EN):
   - Translate the single German word to English.
   - You MUST check if the word functions as BOTH a verb and a noun in German (e.g. "ansehen" = to look at / "das Ansehen" = reputation; "treffen" = to meet / "das Treffen" = meeting; "essen" = to eat / "das Essen" = food; "leben" = to live / "das Leben" = life; "schreiben" = to write / "das Schreiben" = official letter; "versprechen" = to promise / "das Versprechen" = promise; "hoffen" = to hope / "die Hoffnung" = hope).
   - If BOTH usages exist, you MUST set "hasBothUsages": true, and provide both complete usages under "verbUsage" and "nounUsage".
   - If only one usage exists, set "hasBothUsages": false, and leave "verbUsage" and "nounUsage" as null.

2. ENGLISH TO GERMAN (EN ➔ DE):
   - Translate the English input (single word or small phrase of 3–5 words, e.g. "by the way", "take into account", "as well as", "looking forward to", "piece of cake") into natural B1/B2 German.
   - For multi-word phrases, ALWAYS set "hasBothUsages": false, set "verbUsage": null, "nounUsage": null, and set "pos": "phrase".
   - For single English words, check if the German translation has both verb and noun usages.

Always return a clean JSON object with this exact schema:
{
  "german": "Correct German translation (word with article if noun, or natural phrase/expression)",
  "english": "Concise English translation / meaning",
  "germanExample": "A realistic B1/B2 German sentence using the word or phrase in workplace, daily life or podcast context",
  "englishExample": "English translation of the German example sentence",
  "notes": "Short grammar or usage note (prepositions, formality, or context)",
  "pos": "phrase | idiom | verb | noun | adjective | other",
  "hasBothUsages": boolean,
  "verbUsage": {
    "german": "infinitive verb (e.g. 'ansehen')",
    "english": "English meaning as verb",
    "germanExample": "A realistic B1/B2 German sentence using the verb",
    "englishExample": "English translation of the verb sentence",
    "notes": "conjugation note"
  },
  "nounUsage": {
    "german": "German noun with article (e.g. 'das Ansehen')",
    "english": "English meaning as noun",
    "germanExample": "A realistic B1/B2 German sentence using the noun",
    "englishExample": "English translation of the noun sentence",
    "notes": "plural / gender note"
  }
}`;

    const promptText = isEn
      ? `English input: "${cleanInput}". Translate to natural German (supports single words or small phrases of 3–5 words). Provide authentic German translation and example sentence.`
      : `German input: "${cleanInput}". Translate this single German word to English. Check if it functions as both a verb and a noun in German. Provide English translation and German example sentence.`;

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
          maxOutputTokens: 750
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
    if (!parsed || (!parsed.english && !parsed.german)) {
      try {
        const langpair = isEn ? 'en|de' : 'de|en';
        const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(cleanInput)}&langpair=${langpair}`);
        const data = await res.json();
        const translation = data?.responseData?.translatedText || cleanInput;
        parsed = {
          german: isEn ? translation : cleanInput,
          english: isEn ? cleanInput : translation,
          germanExample: isEn ? `Im Satz: „${translation}“ wird oft verwendet.` : `Beispielsatz: „${cleanInput}“ ist eine nützliche Redewendung.`,
          englishExample: isEn ? `In a sentence: "${translation}" is frequently used.` : `Example sentence: "${translation}" is a useful expression.`,
          notes: isPhraseInput ? 'Redewendung / Phrase' : 'Automatische Schnellübersetzung',
          pos: isPhraseInput ? 'phrase' : 'other',
          hasBothUsages: false
        };
      } catch (e) {
        parsed = {
          german: isEn ? 'Übersetzung nicht verfügbar' : cleanInput,
          english: isEn ? cleanInput : 'Translation unavailable',
          germanExample: `Können Sie das bitte wiederholen?`,
          englishExample: `Could you please repeat that?`,
          notes: 'Bitte Netzwerkverbindung prüfen',
          pos: isPhraseInput ? 'phrase' : 'other',
          hasBothUsages: false
        };
      }
    }

    const hasBoth = !!(parsed.hasBothUsages && parsed.verbUsage && parsed.nounUsage);

    const newResult = {
      id: Date.now(),
      german: parsed.german || (isEn ? 'Unbekannt' : cleanInput),
      english: parsed.english || (isEn ? cleanInput : 'Unbekannt'),
      germanExample: parsed.germanExample || '',
      englishExample: parsed.englishExample || '',
      notes: parsed.notes || '',
      pos: parsed.pos || (hasBoth ? 'verb & noun' : (isPhraseInput ? 'phrase' : 'other')),
      hasBothUsages: hasBoth,
      verbUsage: hasBoth ? parsed.verbUsage : null,
      nounUsage: hasBoth ? parsed.nounUsage : null,
      usedModel: usedModelName,
      isFromB1List: false,
      wasFallback: fallbackTriggered,
      direction: dir,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setCurrentResult(newResult);
    setHistory(prev => [newResult, ...prev.filter(item => item.german !== newResult.german)].slice(0, 10));

    // Speak out loud (both usages if present)
    speakResult(newResult);
  };

  // Backward-compatibility wrapper
  const translateWithGemini = (phrase, pos = null) => {
    translateWithDirection(phrase, directionRef.current || 'de_en');
  };

  // ----------------------------------------------------
  // Speech Recognition Event Engine (Restored from working commit b24c96b)
  // ----------------------------------------------------
  const processLiveSpeech = useCallback((rawTranscript) => {
    if (!rawTranscript) return;
    const text = rawTranscript.trim();
    const lower = text.toLowerCase();
    const compact = lower.replace(/\s+/g, '');

    // Ignore phone's own speaker acknowledgment if picked up
    if (
      compact.includes('inbearbeitung') ||
      lower.includes('in bearbeitung') ||
      compact.includes('inprocess') ||
      lower.includes('in process')
    ) {
      return;
    }

    // 1. REPEAT TRIGGER ("Wiederholen", "Wiederhole", "Repeat", "Nochmal")
    const isRepeat =
      /\b(wiederhol(e|en|t)?|repeat|repeating|replay|again|nochmal|say\s*again)\b/i.test(lower) ||
      compact.includes('wiederhol') ||
      compact.includes('repeat') ||
      compact.includes('nochmal');

    if (isRepeat && (phaseRef.current === 'idle' || phaseRef.current === 'speaking')) {
      handleRepeat();
      return;
    }

    // 2. TRIGGER WORDS (Phonetically tolerant for German & English)
    const hasGermanTrigger =
      /\b(über\s*setz(e|en|t|ung|er)?|ueber\s*setz(e|en|t|ung|er)?|uber\s*setz(e|en|t|ung|er)?)\b/i.test(lower) ||
      compact.includes('übersetz') ||
      compact.includes('uebersetz') ||
      compact.includes('ubersetz') ||
      compact.includes('ubersetzen') ||
      compact.includes('ubersetze');

    const hasEnglishTrigger =
      (/\b(trans\s*late|translate|translation|translating|translates|translator|transit|transfer)\b/i.test(lower) ||
      compact.includes('translate') ||
      compact.includes('translation')) &&
      !hasGermanTrigger;

    const hasTrigger = hasGermanTrigger || hasEnglishTrigger;

    // Flexible stop detection ("Halt", "Stopp", "Stop", "Fertig", "Ende", "Genug")
    const hasStop =
      /\b(halt|halte|stopp|stop|stoppen|fertig|ende|hold|genug)\b/i.test(lower) ||
      lower.includes('halt') ||
      lower.includes('stopp') ||
      lower.includes('stop') ||
      compact.includes('halt') ||
      compact.includes('stopp') ||
      compact.includes('stop') ||
      compact.includes('fertig') ||
      compact.includes('ende');

    // ----------------------------------------------------
    // State 1: IDLE or SPEAKING (Trigger starts new session)
    // Works reliably whether idle OR recovering from speech!
    // ----------------------------------------------------
    if (phaseRef.current === 'idle' || phaseRef.current === 'speaking') {
      if (hasTrigger) {
        // Cancel any previous TTS immediately
        if ('speechSynthesis' in window) {
          try { window.speechSynthesis.cancel(); } catch (e) {}
        }
        isSpeakingTtsRef.current = false;
        setSpeakingSubPhase(null);

        const targetDir = hasEnglishTrigger ? 'en_de' : 'de_en';
        setDirection(targetDir);
        directionRef.current = targetDir;

        // Check if user spoke entire command in one single breath: "Übersetze [word] Halt" or "Translate [phrase] Stop"
        if (hasStop) {
          const phrase = targetDir === 'en_de' ? extractEnglishPhrase(text) : extractGermanPhrase(text);
          if (phrase) {
            setPhase('recording');
            setStatusMessage(`Erfasst: „${phrase}“. Übersetze...`);
            const ackMsg = targetDir === 'en_de' ? 'In Process' : 'In Bearbeitung';
            const ackLang = targetDir === 'en_de' ? 'en-US' : 'de-DE';
            speakText(ackMsg, ackLang, () => {
              translateWithDirection(phrase, targetDir);
            });
            return;
          }
        }

        // Standard 2-Step Flow:
        setPhase('recording');
        setCurrentRecordingText('');
        setLiveTranscript('');
        currentRecordingTextRef.current = '';
        recordedChunksRef.current = [];
        if (targetDir === 'en_de') {
          setStatusMessage('Aufnahme läuft (EN ➔ DE)... Sprich das englische Wort oder die Phrase (3–5 Wörter) und sage „Stop“.');
          speakText('In Process', 'en-US');
        } else {
          setStatusMessage('Aufnahme läuft (DE ➔ EN)... Sprich das deutsche Wort oder die Phrase und sage „Halt“.');
          speakText('In Bearbeitung', 'de-DE');
        }
        return;
      }
    }

    // ----------------------------------------------------
    // State 2: RECORDING (Capturing word until "Halt" / "Stop" is heard or silence)
    // ----------------------------------------------------
    if (phaseRef.current === 'recording') {
      const activeDir = directionRef.current || 'de_en';
      const isEn = activeDir === 'en_de';
      const clean = isEn ? extractEnglishPhrase(text) : extractGermanPhrase(text);

      if (clean) {
        setLiveTranscript(clean);
        setCurrentRecordingText(clean);
        currentRecordingTextRef.current = clean;

        // Clear existing silence timer
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        if (hasStop) {
          setLiveTranscript('');
          const phraseToTranslate = clean;
          currentRecordingTextRef.current = '';
          translateWithDirection(phraseToTranslate, activeDir);
        } else {
          // Auto-translate if user stops speaking for 3.8s (convenient for hands-free listening!)
          silenceTimerRef.current = setTimeout(() => {
            if (phaseRef.current === 'recording') {
              const phraseToTranslate = currentRecordingTextRef.current || clean;
              if (phraseToTranslate) {
                currentRecordingTextRef.current = '';
                translateWithDirection(phraseToTranslate, activeDir);
              }
            }
          }, 3800);
        }
      } else if (hasStop && currentRecordingTextRef.current) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        const phraseToTranslate = currentRecordingTextRef.current;
        setLiveTranscript('');
        currentRecordingTextRef.current = '';
        translateWithDirection(phraseToTranslate, activeDir);
      }
    }
  }, [speakText, handleRepeat]);

  // Keep a stable ref to speech processor
  const processLiveSpeechRef = useRef(processLiveSpeech);
  useEffect(() => {
    processLiveSpeechRef.current = processLiveSpeech;
  }, [processLiveSpeech]);

  // Continuous Speech Recognition lifecycle (German de-DE engine - commit b24c96b)
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
                candLower.includes('ubersetz') ||
                candLower.includes('halt') ||
                candLower.includes('stopp') ||
                candLower.includes('stop') ||
                candLower.includes('translate') ||
                candLower.includes('wiederhol') ||
                candLower.includes('repeat')
              ) {
                bestTranscript = candidate;
                break;
              }
            }

            if (bestTranscript) {
              setLastHeardLive(bestTranscript);
              if (processLiveSpeechRef.current) {
                processLiveSpeechRef.current(bestTranscript);
              }
            }
          }
        };

        recognition.onerror = (event) => {
          console.warn('SpeechRecognition error:', event.error);
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
  const handleStartRecordingManual = async (chosenDir = 'de_en') => {
    unlockAudio();
    setDirection(chosenDir);
    directionRef.current = chosenDir;

    if (!isVoiceActive) {
      setIsVoiceActive(true);
      try {
        localStorage.setItem('b1_live_voice_active', 'true');
        await wakeLockManager.enable();
        setIsKeepAwake(true);
      } catch (e) {}
    }

    setPhase('recording');
    setCurrentRecordingText('');
    setLiveTranscript('');
    currentRecordingTextRef.current = '';

    if (chosenDir === 'en_de') {
      setStatusMessage('Aufnahme läuft (EN ➔ DE)... Sprich das englische Wort oder die Phrase (oder tippe unten).');
      speakText('In Process', 'en-US');
    } else {
      setStatusMessage('Aufnahme läuft (DE ➔ EN)... Sprich das deutsche Wort oder die Phrase (oder tippe unten).');
      speakText('In Bearbeitung', 'de-DE');
    }
  };

  const handleStopRecordingManual = () => {
    unlockAudio();
    const raw = liveTranscript || currentRecordingText || manualInput;
    const activeDir = directionRef.current || 'de_en';
    const textToUse = activeDir === 'en_de' ? extractEnglishPhrase(raw) : extractGermanPhrase(raw);

    if (textToUse) {
      translateWithDirection(textToUse, activeDir);
    } else {
      setPhase('idle');
      setStatusMessage('Kein Begriff oder Phrase eingegeben.');
    }
  };

  const handleManualSubmit = (e) => {
    if (e) e.preventDefault();
    unlockAudio();
    if (!manualInput.trim()) return;

    // Detect if input looks like English or German
    let activeDir = directionRef.current || 'de_en';
    const clean = manualInput.trim();
    if (clean) {
      translateWithDirection(clean, activeDir);
      setManualInput('');
    }
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
            marginBottom: '24px'
          }}>
            {phase === 'recording'
              ? (direction === 'en_de' ? 'Aufnahme (EN ➔ DE)... Sage „Stop“' : 'Aufnahme (DE ➔ EN)... Sage „Halt“')
              : 'Hört zu: „Übersetze“ (DE) • „Translate“ (EN)'}
          </div>

          {currentResult && (
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '16px',
              padding: '14px 16px',
              marginBottom: '28px',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <div style={{ fontSize: '11px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {currentResult.hasBothUsages ? 'Zuletzt (Beide Verwendungen)' : 'Zuletzt'}
              </div>
              {currentResult.hasBothUsages && currentResult.verbUsage && currentResult.nounUsage ? (
                <div style={{ marginTop: '6px', textAlign: 'left' }}>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#93c5fd' }}>
                    ⚡ {currentResult.verbUsage.german} <span style={{ color: '#10b981', fontWeight: '600' }}>• {currentResult.verbUsage.english}</span>
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: '800', color: '#fcd34d', marginTop: '4px' }}>
                    📦 {currentResult.nounUsage.german} <span style={{ color: '#10b981', fontWeight: '600' }}>• {currentResult.nounUsage.english}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: '#e4e4e7', margin: '4px 0' }}>{currentResult.german}</div>
                  <div style={{ fontSize: '14px', color: '#10b981', fontWeight: '700' }}>{currentResult.english}</div>
                </>
              )}
              <div style={{ marginTop: '8px', fontSize: '11px', color: '#38bdf8' }}>
                Sage „Wiederholen“ zum Vorlesen
              </div>
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
            Hände-frei beim Hören: <strong>🇩🇪 „Übersetze“</strong> (DE ➔ EN) • <strong>🇬🇧 „Translate“</strong> (EN ➔ DE) • <strong>🔁 „Wiederholen“ / „Repeat“</strong>
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
              try {
                localStorage.setItem('b1_live_voice_active', nextVoice ? 'true' : 'false');
              } catch (e) {}
              if (nextVoice && !isKeepAwake) {
                try {
                  await wakeLockManager.enable();
                  setIsKeepAwake(true);
                } catch (e) {}
              }
            }}
            title={isVoiceActive ? "Voice Control aktiv (Hört auf 'Übersetze' & 'Translate'). Klicken zum Deaktivieren" : "Voice Control aktivieren (Kontinuierliches Mithören)"}
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

          {/* Repeat Button */}
          <button
            type="button"
            id="live-repeat-header-btn"
            onClick={handleRepeat}
            title="Zuletzt übersetztes Wort und Beispielsatz wiederholen (Voice Trigger: „Wiederholen“ oder „Repeat“)"
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
            <span>🔁</span>
            <span>Wiederholen</span>
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
            {liveTranscript
              ? `„${liveTranscript}“`
              : (direction === 'en_de'
                  ? 'Spreche jetzt dein englisches Wort... Beende mit „Stop“'
                  : 'Spreche jetzt dein deutsches Wort... Beende mit „Halt“')}
          </div>
        )}

        {/* Manual Push-to-Talk / Control Buttons */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
          {phase === 'idle' ? (
            <>
              <button
                type="button"
                id="live-manual-de-btn"
                onClick={() => handleStartRecordingManual('de_en')}
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '12px 20px',
                  fontSize: '14px',
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
                id="live-manual-en-btn"
                onClick={() => handleStartRecordingManual('en_de')}
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '16px',
                  padding: '12px 20px',
                  fontSize: '14px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 16px rgba(16, 185, 129, 0.4)'
                }}
              >
                <span>🇬🇧</span>
                <span>Translate (EN ➔ DE)</span>
              </button>

              {currentResult && (
                <button
                  type="button"
                  id="live-manual-repeat-btn"
                  onClick={handleRepeat}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#e4e4e7',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '16px',
                    padding: '12px 18px',
                    fontSize: '14px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <span>🔁</span>
                  <span>Wiederholen</span>
                </button>
              )}
            </>
          ) : phase === 'recording' ? (
            <button
              type="button"
              id="live-manual-stop-btn"
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
              <span>{direction === 'en_de' ? 'Stop & Übersetzen' : 'Halt & Übersetzen'}</span>
            </button>
          ) : null}
        </div>

        {/* Manual Text Input Bar */}
        <form onSubmit={handleManualSubmit} style={{
          maxWidth: '560px',
          margin: '22px auto 0',
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
            placeholder="Wort oder Phrase eintippen (Deutsch oder Englisch)..."
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
          {/* Top Bar of Card */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1.2px', fontWeight: '800' }}>
                  {currentResult.direction === 'en_de' ? '🇬🇧 ➔ 🇩🇪 Übersetzung' : '🇩🇪 ➔ 🇬🇧 Übersetzung'}
                </span>
                {currentResult.hasBothUsages ? (
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '800',
                    padding: '3px 10px',
                    borderRadius: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(245, 158, 11, 0.25))',
                    color: '#fef08a',
                    border: '1px solid rgba(245, 158, 11, 0.5)'
                  }}>
                    ⚡ Verb & 📦 Nomen (Beide Verwendungen)
                  </span>
                ) : currentResult.pos && currentResult.pos !== 'other' && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: '800',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    background: (currentResult.pos === 'phrase' || currentResult.pos === 'idiom')
                      ? 'rgba(168, 85, 247, 0.2)'
                      : currentResult.pos === 'verb'
                        ? 'rgba(59, 130, 246, 0.2)'
                        : 'rgba(245, 158, 11, 0.2)',
                    color: (currentResult.pos === 'phrase' || currentResult.pos === 'idiom')
                      ? '#c084fc'
                      : currentResult.pos === 'verb'
                        ? '#93c5fd'
                        : '#fcd34d',
                    border: (currentResult.pos === 'phrase' || currentResult.pos === 'idiom')
                      ? '1px solid rgba(168, 85, 247, 0.4)'
                      : currentResult.pos === 'verb'
                        ? '1px solid rgba(59, 130, 246, 0.4)'
                        : '1px solid rgba(245, 158, 11, 0.4)'
                  }}>
                    {currentResult.pos === 'phrase' || currentResult.pos === 'idiom'
                      ? '💬 Phrase / Redewendung'
                      : currentResult.pos === 'verb'
                        ? '⚡ Verb'
                        : '📦 Nomen'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                <h2 style={{ fontSize: '30px', fontWeight: '800', color: '#fff', margin: 0, letterSpacing: '-0.5px' }}>
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

            {/* Quick Actions Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Wiederholen / Repeat Button */}
              <button
                type="button"
                id="live-card-repeat-btn"
                onClick={handleRepeat}
                title="Wiederholt Bedeutung und Beispielsatz (Voice: 'Wiederholen' oder 'Repeat')"
                style={{
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(16, 185, 129, 0.25))',
                  border: '1px solid rgba(59, 130, 246, 0.5)',
                  borderRadius: '12px',
                  color: '#93c5fd',
                  padding: '8px 14px',
                  fontSize: '13px',
                  fontWeight: '800',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
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

          {/* DUAL USAGES DISPLAY (VERB CARD + NOUN CARD) */}
          {currentResult.hasBothUsages && currentResult.verbUsage && currentResult.nounUsage ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '16px',
              marginTop: '20px'
            }}>
              {/* VERB USAGE CARD */}
              <div style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                borderRadius: '18px',
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '800',
                    color: '#60a5fa',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    background: 'rgba(59, 130, 246, 0.2)',
                    padding: '2px 8px',
                    borderRadius: '6px'
                  }}>
                    ⚡ VERB
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      speakText(currentResult.verbUsage.english, 'en-US', () => {
                        setTimeout(() => speakText(currentResult.verbUsage.germanExample, 'de-DE'), 300);
                      });
                    }}
                    title="Verb-Bedeutung & Beispielsatz vorlesen"
                    style={{
                      background: 'rgba(59, 130, 246, 0.2)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      color: '#93c5fd',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    🔊 Vorlesen
                  </button>
                </div>

                <div>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#fff' }}>
                    {currentResult.verbUsage.german}
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#34d399', marginTop: '2px' }}>
                    {currentResult.verbUsage.english}
                  </div>
                </div>

                {currentResult.verbUsage.germanExample && (
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    borderLeft: '3px solid #3b82f6',
                    marginTop: '4px'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#f3f4f6' }}>
                      „{currentResult.verbUsage.germanExample}“
                    </div>
                    {currentResult.verbUsage.englishExample && (
                      <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', marginTop: '4px' }}>
                        "{currentResult.verbUsage.englishExample}"
                      </div>
                    )}
                  </div>
                )}

                {currentResult.verbUsage.notes && (
                  <div style={{ fontSize: '11px', color: '#93c5fd', opacity: 0.9 }}>
                    💡 {currentResult.verbUsage.notes}
                  </div>
                )}
              </div>

              {/* NOUN USAGE CARD */}
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: '18px',
                padding: '18px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '800',
                    color: '#fbbf24',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    background: 'rgba(245, 158, 11, 0.2)',
                    padding: '2px 8px',
                    borderRadius: '6px'
                  }}>
                    📦 NOMEN
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      speakText(currentResult.nounUsage.english, 'en-US', () => {
                        setTimeout(() => speakText(currentResult.nounUsage.germanExample, 'de-DE'), 300);
                      });
                    }}
                    title="Nomen-Bedeutung & Beispielsatz vorlesen"
                    style={{
                      background: 'rgba(245, 158, 11, 0.2)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#fcd34d',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    🔊 Vorlesen
                  </button>
                </div>

                <div>
                  <div style={{ fontSize: '22px', fontWeight: '800', color: '#fff' }}>
                    {currentResult.nounUsage.german}
                  </div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#34d399', marginTop: '2px' }}>
                    {currentResult.nounUsage.english}
                  </div>
                </div>

                {currentResult.nounUsage.germanExample && (
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.25)',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    borderLeft: '3px solid #f59e0b',
                    marginTop: '4px'
                  }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#f3f4f6' }}>
                      „{currentResult.nounUsage.germanExample}“
                    </div>
                    {currentResult.nounUsage.englishExample && (
                      <div style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', marginTop: '4px' }}>
                        "{currentResult.nounUsage.englishExample}"
                      </div>
                    )}
                  </div>
                )}

                {currentResult.nounUsage.notes && (
                  <div style={{ fontSize: '11px', color: '#fcd34d', opacity: 0.9 }}>
                    💡 {currentResult.nounUsage.notes}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* SINGLE USAGE CARD DISPLAY */
            <>
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

                <div style={{ display: 'flex', gap: '8px' }}>
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

                  <button
                    type="button"
                    onClick={() => speakText(currentResult.german, 'de-DE')}
                    title="Deutsche Aussprache anhören"
                    style={{
                      background: 'rgba(59, 130, 246, 0.2)',
                      border: '1px solid rgba(59, 130, 246, 0.4)',
                      borderRadius: '10px',
                      color: '#93c5fd',
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
                    <span>Deutsch</span>
                  </button>
                </div>
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
            </>
          )}
        </div>
      )}

      {/* SESSION TRANSLATION HISTORY */}
      <div style={{ marginTop: '36px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff', margin: 0 }}>
              📜 Podcast Wörter ({history.length}/10)
            </h3>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Die letzten 10 erfassten Begriffe & Phrasen
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
                          background: (item.pos === 'phrase' || item.pos === 'idiom')
                            ? 'rgba(168, 85, 247, 0.2)'
                            : item.pos === 'verb'
                              ? 'rgba(59, 130, 246, 0.2)'
                              : 'rgba(245, 158, 11, 0.2)',
                          color: (item.pos === 'phrase' || item.pos === 'idiom')
                            ? '#c084fc'
                            : item.pos === 'verb'
                              ? '#93c5fd'
                              : '#fcd34d',
                          border: (item.pos === 'phrase' || item.pos === 'idiom')
                            ? '1px solid rgba(168, 85, 247, 0.4)'
                            : item.pos === 'verb'
                              ? '1px solid rgba(59, 130, 246, 0.4)'
                              : '1px solid rgba(245, 158, 11, 0.4)'
                        }}>
                          {item.pos === 'phrase' || item.pos === 'idiom' ? 'Phrase' : item.pos === 'verb' ? 'Verb' : 'Nomen'}
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
                      onClick={() => speakResult(item)}
                      title="Vorlesen (Wiederholen)"
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
