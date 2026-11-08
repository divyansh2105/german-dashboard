import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { exportBackupFile, chooseBackupDirectory } from '../utils/backupStorage';
import { wakeLockManager } from '../utils/wakeLockManager';

// Helpers for clean TTS text extraction
export function getAudioGermanWord(word) {
  if (!word) return '';
  return word
    .replace(/,.*$/, '') // remove plural/inflection suffixes like ", -e", ", -s"
    .replace(/\s*\((Sg|Pl)\.?\)/gi, '') // remove (Sg.) or (Pl.)
    .replace(/\s*\(sich etwas\)/gi, 'sich') // clean reflexives
    .replace(/\s*\(etwas\)/gi, '')
    .trim();
}

// Clean word extractor specifically for spelling:
// Strips brackets (...), plural suffixes like ", -s", and leading articles (der/die/das/sich)
export function extractWordForSpelling(rawWord) {
  if (!rawWord) return '';
  let clean = rawWord
    .replace(/\([^)]*\)/g, '')   // remove anything in round brackets (...)
    .replace(/\[[^\]]*\]/g, '')  // remove anything in square brackets [...]
    .replace(/,.*$/, '')         // remove plural/inflection suffixes like ", -s", ", -e"
    .trim();

  // Strip leading German definite articles (der, die, das, dem, den, des) and reflexives (sich)
  clean = clean.replace(/^((der|die|das|dem|den|des)(\s*\/\s*(der|die|das|dem|den|des))?|sich)\s+/i, '').trim();

  return clean;
}

export function getWorkplaceExample(card) {
  if (!card || !card.examples || card.examples.length === 0) return null;
  // Look for workplace/office/business related example first
  const workplaceRegex = /\b(arbeit|beruf|büro|kolleg|chef|firma|termin|kunde|projekt|geschäft|vertrag|meeting|abteilung|stelle|gehalt|bewerb|team|aufgabe|kollegin|kollegen|mitarbeiter|vorgesetzt|pause|feierabend|büroalltag|arbeitsplatz)\b/i;
  const match = card.examples.find(ex => workplaceRegex.test(ex.de) || (ex.en && workplaceRegex.test(ex.en)));
  return match || card.examples[0];
}

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

// Persistent utterance cache to prevent WebKit / iOS Safari from garbage collecting
// SpeechSynthesisUtterance mid-speech before the onend event has fired
if (typeof window !== 'undefined') {
  window.__ankiActiveUtterances = window.__ankiActiveUtterances || new Set();
}

export default function AnkiiSpeaking({
  vocabData,
  myList = [],
  onToggleMyList,
  deletedWords: propDeletedWords,
  onDeleteWord,
  onRestoreWord,
  onRestoreAllDeleted,
  onImportDeletedWords,
  syncCode,
  setSyncCode,
  onSyncDeletedNow,
  onReview,
  isAnonymous
}) {
  // Pre-session filter state
  const [priorityFilters, setPriorityFilters] = useState([1]); // Only High (1) by default
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [queueLimit, setQueueLimit] = useState('50');

  // Cloud sync status and manual sync triggers
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [isEditingSyncCode, setIsEditingSyncCode] = useState(false);
  const [inputSyncCode, setInputSyncCode] = useState(syncCode || '');

  // Screen Keep-Awake state (disables iPhone auto-lock so voice mic & audio never sleep)
  const [isKeepAwake, setIsKeepAwake] = useState(false);

  useEffect(() => {
    return () => {
      wakeLockManager.disable();
    };
  }, []);

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

  useEffect(() => {
    setInputSyncCode(syncCode || '');
  }, [syncCode]);

  const handleTriggerSync = async () => {
    if (!onSyncDeletedNow) return;
    setIsSyncing(true);
    setSyncFeedback(null);
    try {
      const res = await onSyncDeletedNow(syncCode);
      if (res && res.success) {
        setSyncFeedback(`✅ Synced! (${res.count ?? deletedWords.length} words active)`);
      } else {
        setSyncFeedback(`⚠️ Sync failed: ${res?.error || 'Check internet'}`);
      }
    } catch (e) {
      setSyncFeedback(`⚠️ ${e.message}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncFeedback(null), 4000);
    }
  };

  const handleSaveSyncCode = async (codeToSave) => {
    const clean = (codeToSave || '').trim();
    if (clean.length < 3) {
      alert("Sync code must be at least 3 characters.");
      return;
    }
    if (setSyncCode) {
      setSyncCode(clean);
    }
    setIsEditingSyncCode(false);
    setIsSyncing(true);
    setSyncFeedback(null);
    if (onSyncDeletedNow) {
      try {
        const res = await onSyncDeletedNow(clean);
        if (res && res.success) {
          setSyncFeedback(`✅ Connected & Synced! (${res.count ?? deletedWords.length} words active)`);
        } else {
          setSyncFeedback(`⚠️ ${res?.error || 'Connected, but initial sync had issues'}`);
        }
      } catch (e) {
        setSyncFeedback(`⚠️ ${e.message}`);
      } finally {
        setIsSyncing(false);
        setTimeout(() => setSyncFeedback(null), 4000);
      }
    } else {
      setIsSyncing(false);
    }
  };

  // Persistent Deleted Words (words that will never appear in any future Ankii Speaking sessions)
  const [localDeletedWords, setLocalDeletedWords] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_anki_speaking_deleted_words');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const deletedWords = propDeletedWords !== undefined ? propDeletedWords : localDeletedWords;

  const deletedWordsSet = useMemo(() => {
    return new Set(deletedWords.map(w => {
      if (typeof w === 'string') return w.toLowerCase();
      if (w && typeof w.word === 'string') return w.word.toLowerCase();
      return '';
    }));
  }, [deletedWords]);

  // Modal state for viewing/restoring deleted words
  const [showDeletedModal, setShowDeletedModal] = useState(false);

  // Review List (Deleted Words in Order) state & refs
  const [isReviewActive, setIsReviewActive] = useState(false);
  const isReviewActiveRef = useRef(false);
  const [reviewList, setReviewList] = useState([]);
  const reviewListRef = useRef([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const reviewIndexRef = useRef(0);
  const [isReviewPaused, setIsReviewPaused] = useState(false);
  const isReviewPausedRef = useRef(false);
  const [reviewPhase, setReviewPhase] = useState('idle'); // 'idle' | 'speaking_de' | 'waiting_en' | 'speaking_en' | 'gap' | 'paused' | 'finished'
  const reviewPhaseRef = useRef('idle');
  const [reviewCountdown, setReviewCountdown] = useState(0);
  const [reviewToast, setReviewToast] = useState(null);
  const [savedReviewIndex, setSavedReviewIndex] = useState(() => {
    try {
      const idx = localStorage.getItem('b1_anki_review_last_index');
      if (idx !== null) {
        const parsed = parseInt(idx, 10);
        return isNaN(parsed) ? 0 : parsed;
      }
    } catch (e) {}
    return 0;
  });

  const [waitEnglishSec, setWaitEnglishSec] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_anki_review_wait_english');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.5) return val;
      }
    } catch (e) {}
    return 2.0;
  });

  const [waitNextSec, setWaitNextSec] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_anki_review_wait_next');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 1.0) return val;
      }
    } catch (e) {}
    return 5.0;
  });

  const waitEnglishSecRef = useRef(2.0);
  const waitNextSecRef = useRef(5.0);

  useEffect(() => {
    waitEnglishSecRef.current = waitEnglishSec;
  }, [waitEnglishSec]);

  useEffect(() => {
    waitNextSecRef.current = waitNextSec;
  }, [waitNextSec]);

  const [showTimerSettings, setShowTimerSettings] = useState(false);

  const handleUpdateWaitEnglish = (val) => {
    const clamped = Math.max(0.5, Math.min(20, Math.round(val * 10) / 10));
    setWaitEnglishSec(clamped);
    localStorage.setItem('b1_anki_review_wait_english', String(clamped));
  };

  const handleUpdateWaitNext = (val) => {
    const clamped = Math.max(1, Math.min(30, Math.round(val * 10) / 10));
    setWaitNextSec(clamped);
    localStorage.setItem('b1_anki_review_wait_next', String(clamped));
  };

  const reviewTimerRef = useRef(null);
  const reviewCountdownIntervalRef = useRef(null);

  useEffect(() => {
    isReviewActiveRef.current = isReviewActive;
  }, [isReviewActive]);

  useEffect(() => {
    isReviewPausedRef.current = isReviewPaused;
  }, [isReviewPaused]);

  useEffect(() => {
    reviewPhaseRef.current = reviewPhase;
  }, [reviewPhase]);

  const clearReviewTimers = useCallback(() => {
    if (reviewTimerRef.current) {
      clearTimeout(reviewTimerRef.current);
      reviewTimerRef.current = null;
    }
    if (reviewCountdownIntervalRef.current) {
      clearInterval(reviewCountdownIntervalRef.current);
      reviewCountdownIntervalRef.current = null;
    }
  }, []);

  // 10-Second Undo Timer Toast State: { word: string, card: object, secondsLeft: number }
  const [undoToast, setUndoToast] = useState(null);
  const undoIntervalRef = useRef(null);
  const undoTimeoutRef = useRef(null);

  // Session lifecycle state
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [sessionCards, setSessionCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState([]); // Array of { card, result: 'mastered' | 'english' | 'context' }
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Active card display & audio state
  // revealedState: 'none' | 'english' | 'context'
  const [revealedState, setRevealedState] = useState('none');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  const lastSpeakingEndTimeRef = useRef(0);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
    if (!isSpeaking) {
      lastSpeakingEndTimeRef.current = Date.now();
    }
  }, [isSpeaking]);
  const [speakingPhase, setSpeakingPhase] = useState(null); // 'de' | 'en' | 'example'
  const [touchFeedback, setTouchFeedback] = useState(null); // 'mastered' | 'english' | 'context' | null

  // Mobile drag physics & touch state (Hold 1s to activate)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isGestureMode, setIsGestureMode] = useState(false);
  const [isWiggling, setIsWiggling] = useState(false);
  const touchStartRef = useRef(null);
  const isDraggingRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const isGestureActiveRef = useRef(false);
  const lastTouchEndTimeRef = useRef(0);

  // Voice Instruction State & Continuous Recognition Engine
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const isVoiceActiveRef = useRef(false);
  useEffect(() => {
    isVoiceActiveRef.current = isVoiceActive;
  }, [isVoiceActive]);

  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const [voiceFeedbackMsg, setVoiceFeedbackMsg] = useState(null);
  const [lastHeardVoice, setLastHeardVoice] = useState('');
  const voiceFeedbackTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const startRecognitionRef = useRef(null);
  const restartTimeoutRef = useRef(null);
  const resumeVoiceTimeoutRef = useRef(null);
  const ttsWatchdogRef = useRef(null);
  const isStoppingManuallyRef = useRef(false);
  const hasEverStartedSuccessfullyRef = useRef(false);
  const cardAppearedTimeRef = useRef(Date.now());
  const lastExecutedCommandTimeRef = useRef(0);
  const lastProcessedResultIndexRef = useRef(-1);
  const [sessionDeletedCount, setSessionDeletedCount] = useState(0);
  const [spellingDisplay, setSpellingDisplay] = useState(null);

  // Filter for completed summary list: 'all' | 'mastered' | 'english' | 'context'
  const [summaryFilter, setSummaryFilter] = useState('all');

  // Refs for audio and timers to avoid memory leaks
  const audioEndTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      clearAdvanceTimers();
      clearReviewTimers();
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      if (voiceFeedbackTimeoutRef.current) clearTimeout(voiceFeedbackTimeoutRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (resumeVoiceTimeoutRef.current) clearTimeout(resumeVoiceTimeoutRef.current);
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) { }
      }
    };
  }, []);

  // Timer for session duration
  useEffect(() => {
    let interval = null;
    if (sessionActive && !sessionFinished && sessionStartTime) {
      interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - sessionStartTime) / 1000));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [sessionActive, sessionFinished, sessionStartTime]);

  // Cooldown timer: Voice commands armed after 1.5s of the word appearing
  useEffect(() => {
    setIsVoiceReady(false);
    cardAppearedTimeRef.current = Date.now();
    const timer = setTimeout(() => {
      setIsVoiceReady(true);
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentIndex, sessionActive]);

  const clearAdvanceTimers = () => {
    if (audioEndTimeoutRef.current) {
      clearTimeout(audioEndTimeoutRef.current);
      audioEndTimeoutRef.current = null;
    }
  };

  // Compile all available words from vocabData, EXCLUDING any deleted words
  const allFilteredPool = useMemo(() => {
    let pool = [];
    if (selectedCategory === 'all') {
      Object.keys(vocabData).forEach(cat => {
        const items = vocabData[cat] || [];
        items.forEach(item => {
          pool.push({ ...item, category: cat });
        });
      });
    } else {
      const items = vocabData[selectedCategory] || [];
      pool = items.map(item => ({ ...item, category: selectedCategory }));
    }

    // Filter by selected priorities AND exclude deleted words
    return pool.filter(item => {
      const p = item.priority || 1;
      const isPriority = priorityFilters.includes(p);
      const isDeleted = deletedWordsSet.has(item.word.toLowerCase());
      return isPriority && !isDeleted;
    });
  }, [vocabData, selectedCategory, priorityFilters, deletedWordsSet]);

  // Lookup map for fast retrieval of full word cards (meaning, category, examples) from vocabData
  const allVocabMap = useMemo(() => {
    const map = new Map();
    if (!vocabData) return map;
    Object.keys(vocabData).forEach(cat => {
      const items = vocabData[cat] || [];
      items.forEach(item => {
        if (item && item.word) {
          const key = item.word.toLowerCase().trim();
          map.set(key, { ...item, category: cat });
          const cleanKey = item.word.split(',')[0].trim().toLowerCase();
          if (!map.has(cleanKey)) {
            map.set(cleanKey, { ...item, category: cat });
          }
        }
      });
    });
    return map;
  }, [vocabData]);

  const getCardForWord = useCallback((wordEntry) => {
    if (!wordEntry) return null;
    const rawWord = typeof wordEntry === 'string' ? wordEntry : (wordEntry.word || '');
    const cleanRaw = rawWord.trim().toLowerCase();

    let matched = allVocabMap.get(cleanRaw);
    if (!matched) {
      matched = allVocabMap.get(cleanRaw.split(',')[0].trim());
    }
    if (!matched) {
      const stripped = cleanRaw.replace(/^(der|die|das)\s+/i, '').trim();
      matched = allVocabMap.get(stripped);
    }
    if (matched) return matched;

    return {
      word: rawWord,
      meaning: (typeof wordEntry === 'object' && wordEntry.meaning) ? wordEntry.meaning : '',
      category: 'vocabulary',
      examples: []
    };
  }, [allVocabMap]);

  // Priority count breakdown for the setup screen, respecting selectedCategory and excluding deleted words
  const priorityCounts = useMemo(() => {
    let pool = [];
    if (selectedCategory === 'all') {
      Object.keys(vocabData).forEach(cat => {
        const items = vocabData[cat] || [];
        items.forEach(item => {
          if (!deletedWordsSet.has(item.word.toLowerCase())) {
            pool.push(item);
          }
        });
      });
    } else {
      const items = vocabData[selectedCategory] || [];
      items.forEach(item => {
        if (!deletedWordsSet.has(item.word.toLowerCase())) {
          pool.push(item);
        }
      });
    }

    const high = pool.filter(item => (item.priority || 1) === 1).length;
    const med = pool.filter(item => item.priority === 2).length;
    const low = pool.filter(item => item.priority === 3).length;

    return { high, med, low, total: pool.length };
  }, [vocabData, selectedCategory, deletedWordsSet]);

  // Category counts breakdown respecting active priorityFilters and excluding deleted words
  const categoryCounts = useMemo(() => {
    const counts = { all: 0, nouns: 0, verbs: 0, adjectives: 0, connectors: 0 };
    Object.keys(vocabData).forEach(cat => {
      const items = vocabData[cat] || [];
      const valid = items.filter(item => {
        const p = item.priority || 1;
        return priorityFilters.includes(p) && !deletedWordsSet.has(item.word.toLowerCase());
      });
      if (counts[cat] !== undefined) {
        counts[cat] = valid.length;
      }
      counts.all += valid.length;
    });
    return counts;
  }, [vocabData, priorityFilters, deletedWordsSet]);

  // Toggle priority filter
  const togglePriority = (priorityNumber) => {
    setPriorityFilters(prev => {
      if (prev.includes(priorityNumber)) {
        if (prev.length === 1) return prev; // Keep at least one selected
        return prev.filter(p => p !== priorityNumber);
      } else {
        return [...prev, priorityNumber].sort();
      }
    });
  };

  // Shuffle helper
  const shuffleArray = (arr) => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  // ----------------------------------------------------
  // Audio Speech Helpers & WebKit iOS Voice Coordination
  // ----------------------------------------------------

  const pauseRecognitionForTts = useCallback(() => {
    isSpeakingRef.current = true;
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    if (resumeVoiceTimeoutRef.current) clearTimeout(resumeVoiceTimeoutRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch (e) {}
    }
  }, []);

  const resumeRecognitionAfterTts = useCallback(() => {
    if (resumeVoiceTimeoutRef.current) clearTimeout(resumeVoiceTimeoutRef.current);
    if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
    // 350ms settle delay allows iOS AVAudioSession to release the playback hardware lock
    resumeVoiceTimeoutRef.current = setTimeout(() => {
      isSpeakingRef.current = false;
      lastSpeakingEndTimeRef.current = Date.now();
      if (isVoiceActiveRef.current && isMountedRef.current && startRecognitionRef.current) {
        startRecognitionRef.current();
      }
    }, 350);
  }, []);

  const speakGerman = useCallback((text, onEnd) => {
    if (!('speechSynthesis' in window) || !text) {
      if (onEnd) onEnd();
      return;
    }
    pauseRecognitionForTts();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 0.92;

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSpeakingPhase('de');

    if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
      window.__ankiActiveUtterances.add(utterance);
    }

    let hasEnded = false;
    const finish = () => {
      if (hasEnded) return;
      hasEnded = true;
      if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
        window.__ankiActiveUtterances.delete(utterance);
      }
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      if (isMountedRef.current) {
        setIsSpeaking(false);
        setSpeakingPhase(null);
      }
      resumeRecognitionAfterTts();
      if (onEnd) onEnd();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    // Watchdog to guarantee isSpeaking resets even if iOS drops onend
    const estDuration = Math.max(2500, (text || '').length * 120);
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
    ttsWatchdogRef.current = setTimeout(finish, estDuration);

    window.speechSynthesis.speak(utterance);
  }, [pauseRecognitionForTts, resumeRecognitionAfterTts]);

  const speakEnglish = useCallback((text, onEnd) => {
    if (!('speechSynthesis' in window) || !text) {
      if (onEnd) onEnd();
      return;
    }
    pauseRecognitionForTts();
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSpeakingPhase('en');

    if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
      window.__ankiActiveUtterances.add(utterance);
    }

    let hasEnded = false;
    const finish = () => {
      if (hasEnded) return;
      hasEnded = true;
      if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
        window.__ankiActiveUtterances.delete(utterance);
      }
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      if (isMountedRef.current) {
        setIsSpeaking(false);
        setSpeakingPhase(null);
      }
      resumeRecognitionAfterTts();
      if (onEnd) onEnd();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    const estDuration = Math.max(2500, (text || '').length * 120);
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
    ttsWatchdogRef.current = setTimeout(finish, estDuration);

    window.speechSynthesis.speak(utterance);
  }, [pauseRecognitionForTts, resumeRecognitionAfterTts]);

  // Sequential speech: English meaning -> pause -> German workplace example sentence
  const speakSequentialContext = useCallback((enText, deSentence, onEnd) => {
    if (!('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      return;
    }
    pauseRecognitionForTts();
    window.speechSynthesis.cancel();

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSpeakingPhase('en');

    const utterEn = new SpeechSynthesisUtterance(enText);
    utterEn.lang = 'en-US';
    utterEn.rate = 1.0;

    if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
      window.__ankiActiveUtterances.add(utterEn);
    }

    let hasEndedFinal = false;
    const finishFinal = () => {
      if (hasEndedFinal) return;
      hasEndedFinal = true;
      if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
        window.__ankiActiveUtterances.delete(utterEn);
      }
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      if (isMountedRef.current) {
        setIsSpeaking(false);
        setSpeakingPhase(null);
      }
      resumeRecognitionAfterTts();
      if (onEnd) onEnd();
    };

    const estTotalDuration = Math.max(5000, ((enText || '').length + (deSentence || '').length) * 140);
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
    ttsWatchdogRef.current = setTimeout(finishFinal, estTotalDuration);

    utterEn.onend = () => {
      if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
        window.__ankiActiveUtterances.delete(utterEn);
      }
      if (!isMountedRef.current) {
        finishFinal();
        return;
      }
      setSpeakingPhase('example');
      audioEndTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) {
          finishFinal();
          return;
        }
        if (!deSentence) {
          finishFinal();
          return;
        }
        const utterDe = new SpeechSynthesisUtterance(deSentence);
        utterDe.lang = 'de-DE';
        utterDe.rate = 0.92;

        if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
          window.__ankiActiveUtterances.add(utterDe);
        }

        const finishDe = () => {
          if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
            window.__ankiActiveUtterances.delete(utterDe);
          }
          finishFinal();
        };

        utterDe.onend = finishDe;
        utterDe.onerror = finishDe;

        window.speechSynthesis.speak(utterDe);
      }, 320);
    };

    utterEn.onerror = () => {
      finishFinal();
    };

    window.speechSynthesis.speak(utterEn);
  }, [pauseRecognitionForTts, resumeRecognitionAfterTts]);

  // Current Card
  const currentCard = sessionCards[currentIndex];
  const wpExample = useMemo(() => getWorkplaceExample(currentCard), [currentCard]);
  const isStarred = useMemo(() => {
    if (!currentCard || !Array.isArray(myList)) return false;
    return myList.some(item => item.word.toLowerCase() === currentCard.word.toLowerCase());
  }, [currentCard, myList]);

  // Replay German word (tap on card)
  const replayGerman = useCallback(() => {
    if (!currentCard) return;
    const deWord = getAudioGermanWord(currentCard.word);
    speakGerman(deWord);
  }, [currentCard, speakGerman]);

  // English spelling breakdown helper for German words (including ä, ö, ü, ß)
  const formatSpellBreakdown = (text) => {
    if (!text) return { cleanWord: '', spoken: '', display: '' };
    const cleanWord = extractWordForSpelling(text);
    if (!cleanWord) return { cleanWord: '', spoken: '', display: '' };

    const spokenTokens = [];
    const displayTokens = [];

    for (const char of cleanWord) {
      const lower = char.toLowerCase();
      if (lower === 'ä') {
        spokenTokens.push('A umlaut');
        displayTokens.push('Ä (A-umlaut)');
      } else if (lower === 'ö') {
        spokenTokens.push('O umlaut');
        displayTokens.push('Ö (O-umlaut)');
      } else if (lower === 'ü') {
        spokenTokens.push('U umlaut');
        displayTokens.push('Ü (U-umlaut)');
      } else if (lower === 'ß') {
        spokenTokens.push('sharp S');
        displayTokens.push('ß (sharp S)');
      } else if (lower === ' ') {
        spokenTokens.push('space');
        displayTokens.push('␣');
      } else if (lower === '-') {
        spokenTokens.push('hyphen');
        displayTokens.push('-');
      } else if (/[a-z]/i.test(char)) {
        spokenTokens.push(char.toUpperCase());
        displayTokens.push(char.toUpperCase());
      }
    }

    return {
      cleanWord,
      spoken: spokenTokens.join(', ') + '.',
      display: displayTokens.join(' • ')
    };
  };

  const speakSpelling = useCallback((wordToSpell, onEnd) => {
    if (!('speechSynthesis' in window) || !wordToSpell) {
      if (onEnd) onEnd();
      return;
    }
    pauseRecognitionForTts();
    window.speechSynthesis.cancel();

    const { spoken } = formatSpellBreakdown(wordToSpell);
    if (!spoken) {
      if (onEnd) onEnd();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.lang = 'en-US';
    utterance.rate = 0.85; // Measured, clear cadence for spelling

    isSpeakingRef.current = true;
    setIsSpeaking(true);
    setSpeakingPhase('spell');

    if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
      window.__ankiActiveUtterances.add(utterance);
    }

    let hasEnded = false;
    const finish = () => {
      if (hasEnded) return;
      hasEnded = true;
      if (typeof window !== 'undefined' && window.__ankiActiveUtterances) {
        window.__ankiActiveUtterances.delete(utterance);
      }
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      if (isMountedRef.current) {
        setIsSpeaking(false);
        setSpeakingPhase(null);
      }
      resumeRecognitionAfterTts();
      if (onEnd) onEnd();
    };

    utterance.onend = finish;
    utterance.onerror = finish;

    const estDuration = Math.max(3000, (spoken || '').length * 140);
    if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
    ttsWatchdogRef.current = setTimeout(finish, estDuration);

    window.speechSynthesis.speak(utterance);
  }, [pauseRecognitionForTts, resumeRecognitionAfterTts]);

  const handleSpellWord = useCallback(() => {
    if (!currentCard) return;
    const { display } = formatSpellBreakdown(currentCard.word);
    setSpellingDisplay(display);
    speakSpelling(currentCard.word);
  }, [currentCard, speakSpelling]);

  // ----------------------------------------------------
  // Session Initiation & Audio Unlock
  // Each word is seen exactly once! Zero cycling.
  // ----------------------------------------------------

  const handleStartSession = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const dummy = new SpeechSynthesisUtterance('');
      dummy.volume = 0;
      dummy.rate = 1;
      window.speechSynthesis.speak(dummy);
    }
    if (window.AudioContext || window.webkitAudioContext) {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      } catch (e) {
        // Safe ignore
      }
    }

    // Cross-session freshness tracking: get recently studied words from localStorage
    let recentWords = [];
    try {
      const stored = localStorage.getItem('b1_ankii_recent_words');
      if (stored) recentWords = JSON.parse(stored);
    } catch (e) {}

    const recentSet = new Set(recentWords.map(w => (w || '').toLowerCase()));

    // Partition pool into unseen words vs recently studied words to prevent repetition across multiple sessions
    const unseenPool = allFilteredPool.filter(item => !recentSet.has(item.word.toLowerCase()));
    const seenPool = allFilteredPool.filter(item => recentSet.has(item.word.toLowerCase()));

    // Fully shuffle both pools independently
    const shuffledUnseen = shuffleArray(unseenPool);
    const shuffledSeen = shuffleArray(seenPool);

    // Combine fresh unseen words first, followed by seen words
    let combinedPool = [...shuffledUnseen, ...shuffledSeen];
    if (combinedPool.length === 0) {
      combinedPool = shuffleArray(allFilteredPool);
    }

    let initialList = combinedPool;
    if (queueLimit !== 'all') {
      const limit = parseInt(queueLimit, 10);
      initialList = initialList.slice(0, limit);
    }

    if (initialList.length === 0) return;

    cardAppearedTimeRef.current = Date.now();
    lastExecutedCommandTimeRef.current = Date.now();
    setSessionCards(initialList);
    setCurrentIndex(0);
    setSessionResults([]);
    setSessionDeletedCount(0);
    setSpellingDisplay(null);
    setSessionStartTime(Date.now());
    setElapsedTime(0);
    setRevealedState('none');
    setSessionFinished(false);
    setSessionActive(true);

    if (isKeepAwake) {
      wakeLockManager.enable().catch(() => {});
    }

    const firstWord = getAudioGermanWord(initialList[0].word);
    setTimeout(() => {
      speakGerman(firstWord);
    }, 100);
  };

  // Helper to advance to the next card in line
  // Re-inserts the card perpetually at a further point (randomly 20 to 400 positions ahead) as long as it's not deleted
  const advanceToNextWord = useCallback(() => {
    clearAdvanceTimers();
    cardAppearedTimeRef.current = Date.now();
    lastExecutedCommandTimeRef.current = Date.now();
    setSpellingDisplay(null);

    // Persist recently studied word in localStorage (keeping last 400 words across sessions)
    if (currentCard && currentCard.word) {
      try {
        const stored = localStorage.getItem('b1_ankii_recent_words');
        const prev = stored ? JSON.parse(stored) : [];
        const updated = [currentCard.word, ...prev.filter(w => w.toLowerCase() !== currentCard.word.toLowerCase())].slice(0, 400);
        localStorage.setItem('b1_ankii_recent_words', JSON.stringify(updated));
      } catch (e) {}
    }

    const isDeleted = currentCard && deletedWordsSet.has(currentCard.word.toLowerCase());

    // Continuously re-insert the card into the queue at a further point (randomly 20 to 400 positions ahead)
    // The card keeps re-inserting perpetually on every review, as long as it has not been deleted!
    if (currentCard && !isDeleted) {
      const minOffset = 20;
      const maxOffset = 400;
      const offset = Math.floor(Math.random() * (maxOffset - minOffset + 1)) + minOffset;

      setSessionCards(prev => {
        const next = [...prev];
        const insertIndex = Math.min(next.length, currentIndex + offset);
        next.splice(insertIndex, 0, currentCard);
        return next;
      });
    }

    const nextIdx = currentIndex + 1;
    const effectiveLength = sessionCards.length + (currentCard && !isDeleted ? 1 : 0);
    if (nextIdx >= effectiveLength) {
      setSessionFinished(true);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      setCurrentIndex(nextIdx);
      setRevealedState('none');
      const nextCard = sessionCards[nextIdx] || currentCard;
      if (nextCard) {
        const nextWord = getAudioGermanWord(nextCard.word);
        speakGerman(nextWord);
      }
    }
  }, [currentIndex, sessionCards, speakGerman, currentCard, deletedWordsSet]);

  // ----------------------------------------------------
  // Action 1: Mastered / Known (Instant Recall)
  // [Space] or Swipe Right or "Know It" Button
  // Advances directly to the next word.
  // ----------------------------------------------------
  const handleMastered = useCallback(() => {
    if (!currentCard) return;
    clearAdvanceTimers();

    if (onReview) {
      onReview(currentCard.word, currentCard.category, 'easy');
    }

    setSessionResults(prev => [...prev, { card: currentCard, result: 'mastered' }]);

    advanceToNextWord();
  }, [currentCard, onReview, advanceToNextWord]);

  // ----------------------------------------------------
  // Action 2: Forgot Word (English Meaning Only)
  // [N] or Swipe Left or "English" Button
  // Reveals English translation, reads aloud via TTS.
  // ----------------------------------------------------
  const handleForgotEnglish = useCallback(() => {
    if (!currentCard) return;
    clearAdvanceTimers();

    if (onReview) {
      onReview(currentCard.word, currentCard.category, 'hard');
    }

    if (revealedState === 'none') {
      setSessionResults(prev => [...prev, { card: currentCard, result: 'english' }]);
    }

    setRevealedState('english');
    speakEnglish(currentCard.meaning);
  }, [currentCard, revealedState, onReview, speakEnglish]);

  // ----------------------------------------------------
  // Action 3: More Context (English + Workplace Example)
  // [M] or Swipe Up or "Context" Button
  // Reveals English & Workplace Example, reads sequentially via TTS.
  // ----------------------------------------------------
  const handleMoreContext = useCallback(() => {
    if (!currentCard) return;
    clearAdvanceTimers();

    if (onReview) {
      onReview(currentCard.word, currentCard.category, 'hard');
    }

    const example = getWorkplaceExample(currentCard);

    if (revealedState === 'none') {
      setSessionResults(prev => [...prev, { card: currentCard, result: 'context' }]);
    }

    setRevealedState('context');

    const exampleDe = example ? example.de : '';
    speakSequentialContext(currentCard.meaning, exampleDe);
  }, [currentCard, revealedState, onReview, speakSequentialContext]);

  // Advance to next card manually (when card is revealed)
  const handleAdvanceNext = useCallback(() => {
    advanceToNextWord();
  }, [advanceToNextWord]);

  // Star toggle
  const handleToggleStar = useCallback((e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (onToggleMyList && currentCard) {
      onToggleMyList(currentCard);
    }
  }, [onToggleMyList, currentCard]);

  // ----------------------------------------------------
  // DELETE WORD (Never show in any future Ankii Speaking session)
  // With 10-Second Undo Timer Toast
  // ----------------------------------------------------
  const handleDeleteWord = useCallback((e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!currentCard) return;

    const cardToDelete = currentCard;
    const wordKey = cardToDelete.word;

    clearAdvanceTimers();

    // 1. Add word to deleted list
    if (onDeleteWord) {
      onDeleteWord(wordKey);
    } else {
      setLocalDeletedWords(prev => {
        const updated = prev.includes(wordKey) ? prev : [...prev, wordKey];
        localStorage.setItem('b1_anki_speaking_deleted_words', JSON.stringify(updated));
        return updated;
      });
    }

    // 2. Advance to the next card immediately & remove any future copies of this deleted word
    cardAppearedTimeRef.current = Date.now();
    lastExecutedCommandTimeRef.current = Date.now();
    setSessionDeletedCount(prev => prev + 1);
    setSpellingDisplay(null);

    // Remove any future occurrences of this deleted word if it was re-inserted earlier
    const cleanedCards = sessionCards.filter((c, idx) => idx <= currentIndex || c.word.toLowerCase() !== wordKey.toLowerCase());
    setSessionCards(cleanedCards);

    const nextIdx = currentIndex + 1;
    if (nextIdx >= cleanedCards.length) {
      setSessionFinished(true);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } else {
      setCurrentIndex(nextIdx);
      setRevealedState('none');
      const nextWord = getAudioGermanWord(cleanedCards[nextIdx].word);
      speakGerman(nextWord);
    }

    // 3. Initiate 10-Second Undo Notification
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    let seconds = 10;
    setUndoToast({
      word: wordKey,
      card: cardToDelete,
      insertIndex: currentIndex,
      secondsLeft: seconds
    });

    undoIntervalRef.current = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        clearInterval(undoIntervalRef.current);
        undoIntervalRef.current = null;
        setUndoToast(null);
      } else {
        setUndoToast(prev => prev ? { ...prev, secondsLeft: seconds } : null);
      }
    }, 1000);

    undoTimeoutRef.current = setTimeout(() => {
      setUndoToast(null);
      if (undoIntervalRef.current) {
        clearInterval(undoIntervalRef.current);
        undoIntervalRef.current = null;
      }
    }, 10000);
  }, [currentCard, currentIndex, sessionCards, speakGerman, onDeleteWord]);

  // Centralized restore word handler (used by Undo, Modal, and Review List)
  const handleRestoreWord = useCallback((wordToRestore) => {
    if (!wordToRestore) return;
    if (onRestoreWord) {
      onRestoreWord(wordToRestore);
    }
    setLocalDeletedWords(prev => {
      const updated = prev.filter(w => (typeof w === 'string' ? w : w.word).toLowerCase() !== wordToRestore.toLowerCase());
      localStorage.setItem('b1_anki_speaking_deleted_words', JSON.stringify(updated));
      return updated;
    });
  }, [onRestoreWord]);

  // Undo Delete Handler (Click within 10 seconds)
  const handleUndoDelete = useCallback(() => {
    if (!undoToast) return;

    const restoredWord = undoToast.word;
    const restoredCard = undoToast.card;

    // 1. Remove from deletedWords list
    handleRestoreWord(restoredWord);

    // 2. Clear undo timers
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    setUndoToast(null);
    setSessionDeletedCount(prev => Math.max(0, prev - 1));

    // 3. Put card back into session queue right at current position so user can study it
    if (sessionActive && !sessionFinished) {
      cardAppearedTimeRef.current = Date.now();
      lastExecutedCommandTimeRef.current = Date.now();
      setSessionCards(prev => {
        const next = [...prev];
        next.splice(currentIndex, 0, restoredCard);
        return next;
      });
      // Immediately present restored card
      setRevealedState('none');
      const restoredDe = getAudioGermanWord(restoredCard.word);
      speakGerman(restoredDe);
    }
  }, [undoToast, sessionActive, sessionFinished, currentIndex, speakGerman, handleRestoreWord]);

  // ----------------------------------------------------
  // REVIEW LIST ENGINE (Plays Deleted Words in Order)
  // Flow: Speak German -> 2s Pause -> Speak English -> 5s Gap -> Next Word
  // Supports voice control "Restore" to put word back into deck in correct categories
  // ----------------------------------------------------
  const playReviewCard = useCallback((idx, listOverride) => {
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    const currentList = listOverride || reviewListRef.current;
    if (!isReviewActiveRef.current || isReviewPausedRef.current) return;

    if (!currentList || idx >= currentList.length) {
      setReviewPhase('finished');
      setReviewIndex(currentList ? currentList.length : 0);
      reviewIndexRef.current = currentList ? currentList.length : 0;
      return;
    }

    const card = currentList[idx];
    setReviewIndex(idx);
    reviewIndexRef.current = idx;
    setSavedReviewIndex(idx);
    try {
      localStorage.setItem('b1_anki_review_last_index', String(idx));
      if (card && card.word) {
        localStorage.setItem('b1_anki_review_last_word', card.word);
      }
    } catch (e) {}
    setReviewPhase('speaking_de');
    setReviewCountdown(0);

    const deWord = getAudioGermanWord(card.word);
    speakGerman(deWord, () => {
      if (!isReviewActiveRef.current || isReviewPausedRef.current) return;
      if (reviewIndexRef.current !== idx) return;

      // 1. After German TTS: pause before English meaning
      const durationEn = (waitEnglishSecRef.current || 2.0) * 1000;
      setReviewPhase('waiting_en');
      setReviewCountdown(waitEnglishSecRef.current || 2.0);

      const waitStart = Date.now();
      reviewCountdownIntervalRef.current = setInterval(() => {
        const elapsed = Date.now() - waitStart;
        const rem = Math.max(0, (durationEn - elapsed) / 1000);
        setReviewCountdown(Number(rem.toFixed(1)));
        if (elapsed >= durationEn) {
          clearInterval(reviewCountdownIntervalRef.current);
        }
      }, 100);

      reviewTimerRef.current = setTimeout(() => {
        clearInterval(reviewCountdownIntervalRef.current);
        if (!isReviewActiveRef.current || isReviewPausedRef.current) return;
        if (reviewIndexRef.current !== idx) return;

        // 2. Speak out loud English meaning
        setReviewPhase('speaking_en');
        const enMeaning = card.meaning || '';
        speakEnglish(enMeaning, () => {
          if (!isReviewActiveRef.current || isReviewPausedRef.current) return;
          if (reviewIndexRef.current !== idx) return;

          // 3. Gap before next word
          const durationNext = (waitNextSecRef.current || 5.0) * 1000;
          setReviewPhase('gap');
          setReviewCountdown(waitNextSecRef.current || 5.0);

          const gapStart = Date.now();
          reviewCountdownIntervalRef.current = setInterval(() => {
            const elapsed = Date.now() - gapStart;
            const rem = Math.max(0, (durationNext - elapsed) / 1000);
            setReviewCountdown(Number(rem.toFixed(1)));
            if (elapsed >= durationNext) {
              clearInterval(reviewCountdownIntervalRef.current);
            }
          }, 100);

          reviewTimerRef.current = setTimeout(() => {
            clearInterval(reviewCountdownIntervalRef.current);
            if (!isReviewActiveRef.current || isReviewPausedRef.current) return;
            if (reviewIndexRef.current !== idx) return;

            // Advance to next word
            playReviewCard(idx + 1);
          }, durationNext);
        });
      }, durationEn);
    });
  }, [clearReviewTimers, speakGerman, speakEnglish]);

  // Restore current word in Review List
  const handleReviewRestoreCurrent = useCallback(() => {
    const currentList = reviewListRef.current;
    const idx = reviewIndexRef.current;
    if (!currentList || idx >= currentList.length) return;

    const card = currentList[idx];
    const wordStr = card.word;

    // 1. Remove from deleted list (automatically returns to deck in correct category)
    handleRestoreWord(wordStr);

    // 2. Stop speech & timers
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    // 3. Show feedback toast
    setReviewToast(`✅ Restored "${wordStr}" back to deck!`);
    setTimeout(() => setReviewToast(null), 3000);

    // 4. Remove restored word from active review list
    const nextList = currentList.filter((_, i) => i !== idx);
    setReviewList(nextList);
    reviewListRef.current = nextList;

    if (nextList.length === 0) {
      setReviewPhase('finished');
      return;
    }

    // 5. Advance to next word
    const nextIdx = Math.min(idx, nextList.length - 1);
    setReviewIndex(nextIdx);
    reviewIndexRef.current = nextIdx;
    setSavedReviewIndex(nextIdx);
    try {
      localStorage.setItem('b1_anki_review_last_index', String(nextIdx));
      if (nextList[nextIdx] && nextList[nextIdx].word) {
        localStorage.setItem('b1_anki_review_last_word', nextList[nextIdx].word);
      }
    } catch (e) {}

    reviewTimerRef.current = setTimeout(() => {
      playReviewCard(nextIdx, nextList);
    }, 600);
  }, [handleRestoreWord, clearReviewTimers, playReviewCard]);

  // Start Review List session (resumes from last reviewed position unless override provided)
  const handleStartReviewList = useCallback((startIndexOverride) => {
    if (!deletedWords || deletedWords.length === 0) return;

    // In order: earliest inserted first (deletedWords[0] is earliest)
    const cards = deletedWords.map(w => getCardForWord(w)).filter(Boolean);
    if (cards.length === 0) return;

    let startingIdx = 0;
    if (typeof startIndexOverride === 'number' && startIndexOverride >= 0 && startIndexOverride < cards.length) {
      startingIdx = startIndexOverride;
    } else {
      try {
        const savedWord = localStorage.getItem('b1_anki_review_last_word');
        const savedIndexRaw = localStorage.getItem('b1_anki_review_last_index');
        if (savedWord) {
          const foundIdx = cards.findIndex(c => c.word.toLowerCase() === savedWord.toLowerCase());
          if (foundIdx !== -1) {
            startingIdx = foundIdx;
          } else if (savedIndexRaw !== null) {
            const parsed = parseInt(savedIndexRaw, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              startingIdx = Math.min(parsed, cards.length - 1);
            }
          }
        } else if (savedIndexRaw !== null) {
          const parsed = parseInt(savedIndexRaw, 10);
          if (!isNaN(parsed) && parsed >= 0) {
            startingIdx = Math.min(parsed, cards.length - 1);
          }
        }
      } catch (e) {}
    }

    clearAdvanceTimers();
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    setReviewList(cards);
    reviewListRef.current = cards;
    setReviewIndex(startingIdx);
    reviewIndexRef.current = startingIdx;
    setSavedReviewIndex(startingIdx);
    setIsReviewPaused(false);
    isReviewPausedRef.current = false;
    setIsReviewActive(true);
    isReviewActiveRef.current = true;
    setReviewToast(null);

    if (SpeechRecognition && !isVoiceActive) {
      setIsVoiceActive(true);
    }
    if (isKeepAwake) {
      wakeLockManager.enable().catch(() => {});
    }

    setTimeout(() => {
      playReviewCard(startingIdx, cards);
    }, 250);
  }, [deletedWords, getCardForWord, clearReviewTimers, isVoiceActive, isKeepAwake, playReviewCard]);

  // Toggle Pause/Resume during Review List
  const handleToggleReviewPause = useCallback((forcePause) => {
    const nextPaused = typeof forcePause === 'boolean' ? forcePause : !isReviewPaused;
    setIsReviewPaused(nextPaused);
    isReviewPausedRef.current = nextPaused;

    if (nextPaused) {
      clearReviewTimers();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setReviewPhase('paused');
    } else {
      playReviewCard(reviewIndexRef.current);
    }
  }, [isReviewPaused, clearReviewTimers, playReviewCard]);

  // Review List Navigation
  const handleReviewNext = useCallback(() => {
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const nextIdx = reviewIndexRef.current + 1;
    if (nextIdx < reviewListRef.current.length) {
      playReviewCard(nextIdx);
    } else {
      setReviewPhase('finished');
    }
  }, [clearReviewTimers, playReviewCard]);

  const handleReviewPrev = useCallback(() => {
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const prevIdx = Math.max(0, reviewIndexRef.current - 1);
    playReviewCard(prevIdx);
  }, [clearReviewTimers, playReviewCard]);

  const handleReviewRepeat = useCallback(() => {
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    playReviewCard(reviewIndexRef.current);
  }, [clearReviewTimers, playReviewCard]);

  const handleExitReview = useCallback(() => {
    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setIsReviewActive(false);
    isReviewActiveRef.current = false;
    setReviewPhase('idle');
  }, [clearReviewTimers]);

  // ----------------------------------------------------
  // Voice Command Trigger & Continuous Speech Recognition
  // Supports 4 Voice Instructions throughout the session:
  // 1. Next (Space press)
  // 2. Translate (N press)
  // 3. More (M press)
  // 4. Delete (D press)
  // ----------------------------------------------------
  const triggerVoiceFeedback = useCallback((cmdName) => {
    if (voiceFeedbackTimeoutRef.current) clearTimeout(voiceFeedbackTimeoutRef.current);
    setVoiceFeedbackMsg(cmdName);
    voiceFeedbackTimeoutRef.current = setTimeout(() => {
      setVoiceFeedbackMsg(null);
    }, 1800);
  }, []);

  const handleVoiceCommand = useCallback((rawText) => {
    if (!rawText) return false;

    // While device is speaking out loud or within 400ms cooldown, disable recognizing instructions to prevent self-triggering
    const isTtsSpeaking = isSpeakingRef.current || (Date.now() - lastSpeakingEndTimeRef.current < 400);

    if (isTtsSpeaking) return false;

    const text = rawText.toLowerCase().trim();
    const timeSinceCardAppeared = Date.now() - cardAppearedTimeRef.current;
    const timeSinceLastCommand = Date.now() - lastExecutedCommandTimeRef.current;

    // Review List Voice Commands
    if (isReviewActiveRef.current) {
      if (/\b(restore|wiederherstellen)\b/i.test(text)) {
        lastExecutedCommandTimeRef.current = Date.now();
        triggerVoiceFeedback('Restore [↩️]');
        handleReviewRestoreCurrent();
        return true;
      }
      if (timeSinceLastCommand < 300) return false;
      if (/\b(next|skip|weiter)\b/i.test(text)) {
        lastExecutedCommandTimeRef.current = Date.now();
        triggerVoiceFeedback('Next [⏭️]');
        handleReviewNext();
        return true;
      }
      if (/\b(repeat|again|wiederholen)\b/i.test(text)) {
        lastExecutedCommandTimeRef.current = Date.now();
        triggerVoiceFeedback('Repeat [🔁]');
        handleReviewRepeat();
        return true;
      }
      if (/\b(pause|stop|halt)\b/i.test(text)) {
        lastExecutedCommandTimeRef.current = Date.now();
        triggerVoiceFeedback('Pause [⏸️]');
        handleToggleReviewPause(true);
        return true;
      }
      if (/\b(play|resume|start)\b/i.test(text)) {
        lastExecutedCommandTimeRef.current = Date.now();
        triggerVoiceFeedback('Resume [▶️]');
        handleToggleReviewPause(false);
        return true;
      }
      return false;
    }

    // 1. Delete (D press / Delete card with 10s undo) - 1.2s card appearance guard to prevent cascading
    if (/\bdelete\b/i.test(text)) {
      if (timeSinceCardAppeared < 1200) return false;
      if (timeSinceLastCommand < 1200) return false;
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('Delete [D]');
      handleDeleteWord();
      return true;
    }

    // 2. Next (Space press / Mastered or advance next card) - 1.2s card appearance guard to prevent skipping
    if (/\bnext\b/i.test(text)) {
      if (timeSinceCardAppeared < 1200) return false;
      if (timeSinceLastCommand < 1200) return false;
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('Next [Space]');
      if (revealedState === 'none') {
        handleMastered();
      } else {
        handleAdvanceNext();
      }
      return true;
    }

    // Informational commands (Translate, More, Repeat, Spell/Spelling, Favorite):
    // Zero card appearance delay so user can ask immediately
    if (timeSinceLastCommand < 250) return false;

    // 3. Translate (N press / Reveal English meaning)
    if (/\btranslate\b/i.test(text)) {
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('Translate [N]');
      handleForgotEnglish();
      return true;
    }

    // 4. More (M press / Reveal English + Workplace Example)
    if (/\bmore\b/i.test(text)) {
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('More [M]');
      handleMoreContext();
      return true;
    }

    // 5. Repeat (R press / Replay German word pronunciation)
    if (/\brepeat\b/i.test(text)) {
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('Repeat [R]');
      replayGerman();
      return true;
    }

    // 6. Spell / Spelling (P press / Spell German word letter-by-letter in English)
    if (/\b(spell|spelling)\b/i.test(text)) {
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('Spell [P]');
      handleSpellWord();
      return true;
    }

    // 7. Favorite (S/F press / Add word to My List)
    if (/\b(favorite|favourite)\b/i.test(text)) {
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback(isStarred ? 'Unfavorited' : 'Favorited [★]');
      handleToggleStar();
      return true;
    }

    return false;
  }, [revealedState, handleMastered, handleAdvanceNext, handleForgotEnglish, handleMoreContext, handleDeleteWord, replayGerman, handleSpellWord, handleToggleStar, isStarred, triggerVoiceFeedback, handleReviewRestoreCurrent, handleReviewNext, handleReviewRepeat, handleToggleReviewPause]);

  // Keep a stable ref to handleVoiceCommand to avoid re-initializing recognition on state updates
  const handleVoiceCommandRef = useRef(handleVoiceCommand);
  useEffect(() => {
    handleVoiceCommandRef.current = handleVoiceCommand;
  }, [handleVoiceCommand]);

  // Continuous SpeechRecognition lifecycle: once started, lasts the entire duration of the session
  useEffect(() => {
    if (!SpeechRecognition) return;

    const isAnyActive = (sessionActive && !sessionFinished) || isReviewActive;
    if (!isVoiceActive || !isAnyActive) {
      isStoppingManuallyRef.current = true;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) { }
        recognitionRef.current = null;
      }
      return;
    }

    isStoppingManuallyRef.current = false;
    let recognition = null;

    const startRecognition = () => {
      if (isStoppingManuallyRef.current || !isMountedRef.current) return;
      // If TTS is currently speaking, wait; resumeRecognitionAfterTts will fire once speech finishes
      if (isSpeakingRef.current) return;

      try {
        if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
        if (recognitionRef.current) {
          try { recognitionRef.current.abort(); } catch (e) {}
          recognitionRef.current = null;
        }

        lastProcessedResultIndexRef.current = -1;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          hasEverStartedSuccessfullyRef.current = true;
        };

        recognition.onresult = (event) => {
          // While device is speaking out loud or within 400ms cooldown, discard mic input to prevent self-triggering
          if (isSpeakingRef.current || Date.now() - lastSpeakingEndTimeRef.current < 400) {
            return;
          }

          // iOS WebKit Segment Reset:
          // Unlike Desktop Chrome, WebKit on iOS does not accumulate results monotonically.
          // Whenever event.resultIndex is 0 or less than our last processed index, reset our tracker
          // so subsequent instructions are not locked out!
          if (event.resultIndex === 0 || event.resultIndex <= lastProcessedResultIndexRef.current) {
            lastProcessedResultIndexRef.current = -1;
          }

          for (let i = event.resultIndex; i < event.results.length; i++) {
            // Guard: If this utterance index was already consumed in this segment, skip it!
            if (i <= lastProcessedResultIndexRef.current) {
              continue;
            }

            for (let j = 0; j < event.results[i].length; j++) {
              const transcript = event.results[i][j].transcript.trim();
              if (transcript) {
                setLastHeardVoice(transcript);
              }
              if (handleVoiceCommandRef.current && transcript) {
                const matched = handleVoiceCommandRef.current(transcript);
                if (matched) {
                  lastProcessedResultIndexRef.current = Math.max(lastProcessedResultIndexRef.current, event.results.length - 1);
                  return;
                }
              }
            }
          }
        };

        recognition.onerror = (event) => {
          console.warn('SpeechRecognition error:', event.error);
          // Only permanently abort if genuine permission denial on initial start
          if ((event.error === 'not-allowed' || event.error === 'service-not-allowed') && !hasEverStartedSuccessfullyRef.current) {
            isStoppingManuallyRef.current = true;
            setIsVoiceActive(false);
            alert('Microphone permission was denied. Please allow microphone access to use Voice Control.');
          }
        };

        recognition.onend = () => {
          if (isStoppingManuallyRef.current || !isMountedRef.current) return;
          // If TTS is speaking, do not restart yet; resumeRecognitionAfterTts will restart it when TTS finishes
          if (isSpeakingRef.current) return;

          // Restart recognition after 300ms buffer so iOS WebKit can cycle its audio session cleanly
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = setTimeout(() => {
            if (!isStoppingManuallyRef.current && isMountedRef.current && isVoiceActiveRef.current && !isSpeakingRef.current) {
              startRecognition();
            }
          }, 300);
        };

        recognition.start();
        recognitionRef.current = recognition;
      } catch (err) {
        console.warn('SpeechRecognition start failed, scheduling retry...', err);
        if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
        restartTimeoutRef.current = setTimeout(() => {
          if (!isStoppingManuallyRef.current && isMountedRef.current && isVoiceActiveRef.current && !isSpeakingRef.current) {
            startRecognition();
          }
        }, 600);
      }
    };

    startRecognitionRef.current = startRecognition;
    startRecognition();

    return () => {
      isStoppingManuallyRef.current = true;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) { }
      }
      recognitionRef.current = null;
    };
  }, [isVoiceActive, sessionActive, sessionFinished, isReviewActive]);

  // Restore a word from the Deleted Words Manager Modal
  const handleRestoreWordFromModal = useCallback((wordToRestore) => {
    handleRestoreWord(wordToRestore);
  }, [handleRestoreWord]);

  // Restore All words from modal
  const handleRestoreAllDeleted = useCallback(() => {
    if (onRestoreAllDeleted) {
      onRestoreAllDeleted();
    } else {
      setLocalDeletedWords([]);
      localStorage.removeItem('b1_anki_speaking_deleted_words');
    }
    setShowDeletedModal(false);
  }, [onRestoreAllDeleted]);

  // Backup Export & Import (Disaster recovery)
  const fileInputRef = useRef(null);

  const exportDeletedBackup = useCallback(async () => {
    if (!deletedWords || deletedWords.length === 0) {
      alert("No deleted words to export.");
      return;
    }
    await exportBackupFile('deleted_words_backup.json', deletedWords);
  }, [deletedWords]);

  const handleImportBackupFile = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) {
          if (onImportDeletedWords) {
            onImportDeletedWords(parsed);
          } else {
            setLocalDeletedWords(prev => {
              const merged = new Map();
              prev.forEach(w => { if (typeof w === 'string') merged.set(w.toLowerCase(), w); });
              parsed.forEach(w => { if (typeof w === 'string') merged.set(w.toLowerCase(), w); });
              const res = Array.from(merged.values());
              localStorage.setItem('b1_anki_speaking_deleted_words', JSON.stringify(res));
              return res;
            });
          }
          alert(`Successfully restored ${parsed.length} deleted words from backup!`);
        } else {
          alert("Invalid backup file: Expected a JSON array of words.");
        }
      } catch (err) {
        alert("Failed to read JSON backup file.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [onImportDeletedWords]);

  // ----------------------------------------------------
  // Desktop Keyboard Shortcuts
  // ----------------------------------------------------
  useEffect(() => {
    if ((!sessionActive && !isReviewActive) || (sessionActive && sessionFinished) || showDeletedModal) return;

    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (isReviewActive) {
        if (e.code === 'Space' || e.code === 'KeyP' || e.key === 'p' || e.key === 'P') {
          e.preventDefault();
          handleToggleReviewPause();
        } else if (e.code === 'ArrowRight' || e.code === 'KeyN' || e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          handleReviewNext();
        } else if (e.code === 'ArrowLeft') {
          e.preventDefault();
          handleReviewPrev();
        } else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          handleReviewRepeat();
        } else if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D' || e.code === 'KeyZ' || e.code === 'Enter') {
          e.preventDefault();
          handleReviewRestoreCurrent();
        } else if (e.code === 'Escape') {
          e.preventDefault();
          handleExitReview();
        }
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (revealedState === 'none') {
          handleMastered();
        } else {
          handleAdvanceNext();
        }
      } else if (e.code === 'KeyN' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handleForgotEnglish();
      } else if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleMoreContext();
      } else if (e.code === 'KeyS' || e.key === 's' || e.key === 'S' || e.code === 'KeyF' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleStar();
      } else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        replayGerman();
      } else if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        handleSpellWord();
      } else if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D' || e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        handleDeleteWord();
      } else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
        if (undoToast) {
          e.preventDefault();
          handleUndoDelete();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (revealedState === 'none') handleMastered();
        else handleAdvanceNext();
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        handleForgotEnglish();
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        handleMoreContext();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        clearAdvanceTimers();
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        setSessionActive(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [sessionActive, sessionFinished, showDeletedModal, revealedState, handleMastered, handleForgotEnglish, handleMoreContext, handleAdvanceNext, replayGerman, handleSpellWord, handleToggleStar, handleDeleteWord, handleUndoDelete, undoToast, isReviewActive, handleToggleReviewPause, handleReviewNext, handleReviewPrev, handleReviewRepeat, handleReviewRestoreCurrent, handleExitReview]);

  // ----------------------------------------------------
  // Full-Screen Mobile Touch Gestures & Swipe Physics
  // ----------------------------------------------------
  // Touch Gestures on Card: Click and hold for 1s to activate
  // Card wiggles upon activation, preventing scrolling conflicts
  // ----------------------------------------------------
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) {
      touchStartRef.current = null;
      isDraggingRef.current = false;
      return;
    }

    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      target: e.target,
      time: Date.now()
    };
    isDraggingRef.current = false;
    isGestureActiveRef.current = false;
    setIsGestureMode(false);
    setTouchFeedback(null);

    // Click and hold for 1 second to activate gesture mode & wiggle card
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isGestureActiveRef.current = true;
      setIsGestureMode(true);
      setIsWiggling(true);
      setTimeout(() => setIsWiggling(false), 450);

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(50); } catch (err) { }
      }
    }, 1000);
  };

  const handleTouchMove = (e) => {
    if (!touchStartRef.current) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartRef.current.x;
    const diffY = currentY - touchStartRef.current.y;

    // If gesture mode is NOT active yet:
    if (!isGestureActiveRef.current) {
      // If user moved their finger more than 10px before 1s, they are scrolling!
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
      return; // Do NOT prevent scrolling or drag card
    }

    // Gesture mode IS active: drag card and show directional feedback
    isDraggingRef.current = true;
    setDragOffset({ x: diffX * 0.7, y: diffY * 0.7 });

    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 40) setTouchFeedback('mastered');
      else if (diffX < -40) setTouchFeedback('english');
      else setTouchFeedback(null);
    } else {
      if (diffY < -40) setTouchFeedback('context');
      else if (diffY > 40) setTouchFeedback('delete');
      else setTouchFeedback(null);
    }
  };

  const handleTouchEnd = (e) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!touchStartRef.current) return;
    const touchEnd = e.changedTouches[0];
    const diffX = touchEnd.clientX - touchStartRef.current.x;
    const diffY = touchEnd.clientY - touchStartRef.current.y;
    const duration = Date.now() - touchStartRef.current.time;
    const touchedCard = touchStartRef.current.target && touchStartRef.current.target.closest('.ankii-speaking-card');

    const wasGestureActive = isGestureActiveRef.current;
    isGestureActiveRef.current = false;
    setIsGestureMode(false);
    isDraggingRef.current = false;
    setDragOffset({ x: 0, y: 0 });
    setTouchFeedback(null);

    const SWIPE_THRESHOLD = 45;

    // If gesture mode was active (user held for 1s), perform swipe action
    if (wasGestureActive) {
      if (Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX > SWIPE_THRESHOLD) {
          if (revealedState === 'none') {
            handleMastered();
          } else {
            handleAdvanceNext();
          }
        } else if (diffX < -SWIPE_THRESHOLD) {
          handleForgotEnglish();
        }
      } else {
        if (diffY < -SWIPE_THRESHOLD) {
          handleMoreContext();
        } else if (diffY > SWIPE_THRESHOLD) {
          handleDeleteWord();
        }
      }
      lastTouchEndTimeRef.current = Date.now();
      touchStartRef.current = null;
      return;
    }

    // If gesture mode was NOT active: Normal quick tap (< 350ms, minimal movement) replays German audio
    if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15 && duration < 350) {
      if (touchedCard) {
        replayGerman();
      }
    }

    lastTouchEndTimeRef.current = Date.now();
    touchStartRef.current = null;
  };

  // Card click handler on desktop (safeguarded against synthetic touch clicks)
  const handleCardClick = (e) => {
    if (e.target.closest('button')) return;
    if (Date.now() - lastTouchEndTimeRef.current < 450) return;
    replayGerman();
  };

  // Format elapsed time string
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Derived counts for words seen and triage breakdown
  const totalSessionWords = sessionCards.length;
  const wordsSeenCount = sessionActive && !sessionFinished ? currentIndex + 1 : totalSessionWords;
  const masteredCount = sessionResults.filter(r => r.result === 'mastered').length;
  const englishCount = sessionResults.filter(r => r.result === 'english').length;
  const contextCount = sessionResults.filter(r => r.result === 'context').length;
  const remainingCount = Math.max(0, totalSessionWords - (currentIndex + 1));

  // ----------------------------------------------------
  // VIEW: Review List (Deleted Words in Order)
  // ----------------------------------------------------
  if (isReviewActive) {
    const currentReviewCard = reviewList[reviewIndex] || null;
    const isFinished = reviewPhase === 'finished' || !currentReviewCard;

    return (
      <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '640px', margin: '20px auto', padding: '0 16px' }}>
        
        {/* Top Action Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            onClick={handleExitReview}
            className="nav-button"
            style={{ padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>✕</span> Exit Review
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Timer Settings Button */}
            <button
              type="button"
              onClick={() => setShowTimerSettings(!showTimerSettings)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                borderRadius: '10px',
                background: showTimerSettings ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                border: showTimerSettings ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid var(--border-color)',
                color: showTimerSettings ? '#93c5fd' : 'var(--text-secondary)',
                fontSize: '11.5px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
              title="Customize wait times for English meaning and next word"
            >
              <span>⏱️</span>
              <span>Timers: {waitEnglishSec}s / {waitNextSec}s</span>
            </button>

            {SpeechRecognition && (
              <button
                type="button"
                onClick={() => setIsVoiceActive(!isVoiceActive)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  borderRadius: '10px',
                  background: isVoiceActive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  border: isVoiceActive ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid var(--border-color)',
                  color: isVoiceActive ? '#10b981' : 'var(--text-secondary)',
                  fontSize: '11.5px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
                title={isVoiceActive ? "Voice control active. Say 'Restore' to restore the word hands-free!" : "Click to enable voice control"}
              >
                <span>{isVoiceActive ? '🎙️ Voice: ON' : '🎙️ Voice: OFF'}</span>
                {isVoiceActive && (
                  <span style={{ fontSize: '10.5px', color: '#6ee7b7' }}>(Say "Restore")</span>
                )}
              </button>
            )}

            <div
              onClick={handleToggleKeepAwake}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '6px 10px',
                borderRadius: '10px',
                background: isKeepAwake ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                border: isKeepAwake ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid var(--border-color)',
                fontSize: '11px',
                color: isKeepAwake ? '#f59e0b' : 'var(--text-muted)',
                cursor: 'pointer'
              }}
              title="Prevent phone screen from sleeping during review"
            >
              <span>{isKeepAwake ? '☀️' : '🌙'}</span>
            </div>
          </div>
        </div>

        {/* Expandable Timer Settings Panel */}
        {showTimerSettings && (
          <div style={{
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(59, 130, 246, 0.35)',
            borderRadius: '14px',
            padding: '16px',
            marginBottom: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
            animation: 'fadeIn 0.2s ease'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '13px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⏱️</span> Customize Review Timers
              </div>
              <button
                type="button"
                onClick={() => setShowTimerSettings(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '14px', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              {/* 1. Wait before English */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Pause before English meaning:
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleUpdateWaitEnglish(waitEnglishSec - 0.5)}
                    className="nav-button"
                    style={{ padding: '4px 10px', fontSize: '14px', fontWeight: '800' }}
                  >
                    -
                  </button>
                  <div style={{
                    minWidth: '55px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: '800',
                    color: '#f59e0b',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    {waitEnglishSec}s
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateWaitEnglish(waitEnglishSec + 0.5)}
                    className="nav-button"
                    style={{ padding: '4px 10px', fontSize: '14px', fontWeight: '800' }}
                  >
                    +
                  </button>
                  <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
                    {[1, 2, 3, 5].map(sec => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleUpdateWaitEnglish(sec)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: '5px',
                          border: '1px solid',
                          borderColor: waitEnglishSec === sec ? '#f59e0b' : 'rgba(255,255,255,0.1)',
                          background: waitEnglishSec === sec ? 'rgba(245, 158, 11, 0.2)' : 'transparent',
                          color: waitEnglishSec === sec ? '#f59e0b' : 'var(--text-muted)',
                          fontSize: '10.5px',
                          cursor: 'pointer'
                        }}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 2. Wait before Next Word */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', fontWeight: '600' }}>
                  Gap before next word:
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => handleUpdateWaitNext(waitNextSec - 1.0)}
                    className="nav-button"
                    style={{ padding: '4px 10px', fontSize: '14px', fontWeight: '800' }}
                  >
                    -
                  </button>
                  <div style={{
                    minWidth: '55px',
                    textAlign: 'center',
                    fontSize: '14px',
                    fontWeight: '800',
                    color: '#3b82f6',
                    background: 'rgba(0,0,0,0.3)',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    {waitNextSec}s
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateWaitNext(waitNextSec + 1.0)}
                    className="nav-button"
                    style={{ padding: '4px 10px', fontSize: '14px', fontWeight: '800' }}
                  >
                    +
                  </button>
                  <div style={{ display: 'flex', gap: '4px', marginLeft: '6px' }}>
                    {[2, 3, 5, 8].map(sec => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => handleUpdateWaitNext(sec)}
                        style={{
                          padding: '3px 6px',
                          borderRadius: '5px',
                          border: '1px solid',
                          borderColor: waitNextSec === sec ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                          background: waitNextSec === sec ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                          color: waitNextSec === sec ? '#93c5fd' : 'var(--text-muted)',
                          fontSize: '10.5px',
                          cursor: 'pointer'
                        }}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Restore Toast */}
        {reviewToast && (
          <div style={{
            padding: '10px 16px',
            borderRadius: '10px',
            background: 'rgba(16, 185, 129, 0.25)',
            border: '1px solid rgba(16, 185, 129, 0.6)',
            color: '#10b981',
            fontSize: '13px',
            fontWeight: '700',
            textAlign: 'center',
            marginBottom: '14px',
            animation: 'fadeIn 0.2s ease'
          }}>
            {reviewToast}
          </div>
        )}

        {/* Finished View */}
        {isFinished ? (
          <div className="glass-card animate-fade-in" style={{ padding: '40px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
            <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>
              Review List Completed!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '420px', margin: '0 auto 24px', lineHeight: 1.5 }}>
              You have reviewed all deleted words in this session. Any words you restored are now back in your active Ankii Speaking deck!
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <button
                type="button"
                onClick={() => handleStartReviewList(0)}
                className="feedback-btn good"
                style={{ width: 'auto', padding: '12px 24px', borderRadius: '10px', fontSize: '13px' }}
              >
                🔁 Start Over from Beginning (#1)
              </button>
              <button
                type="button"
                onClick={handleExitReview}
                className="nav-button"
                style={{ padding: '12px 20px', fontSize: '13px' }}
              >
                ← Return to Setup
              </button>
            </div>
          </div>
        ) : (
          /* Active Review Card */
          <div className="glass-card animate-fade-in" style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
            
            {/* Header info: Progress and Category */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)'
                }}>
                  Deleted Word
                </span>
                {currentReviewCard.category && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {currentReviewCard.category}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  Word {reviewIndex + 1} of {reviewList.length}
                </span>
                {reviewIndex > 0 && (
                  <button
                    type="button"
                    onClick={() => playReviewCard(0)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)',
                      fontSize: '10.5px',
                      padding: '2px 7px',
                      borderRadius: '6px',
                      cursor: 'pointer'
                    }}
                    title="Jump back to the very first word (#1)"
                  >
                    ⏮️ Restart #1
                  </button>
                )}
              </div>
            </div>

            {/* German Word Display with clickable audio and quick restore buttons */}
            <div style={{ textAlign: 'center', padding: '16px 0 8px 0' }}>
              <div style={{
                fontSize: '32px',
                fontWeight: '800',
                lineHeight: 1.3,
                color: '#fff',
                marginBottom: '10px'
              }}>
                {currentReviewCard.word}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => speakGerman(getAudioGermanWord(currentReviewCard.word))}
                  className="sound-btn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '8px', fontSize: '12px', background: 'rgba(255,255,255,0.06)' }}
                  title="Aussprache anhören"
                >
                  <span>🔊</span> Hören
                </button>
                <button
                  type="button"
                  onClick={handleReviewRestoreCurrent}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    background: 'rgba(16, 185, 129, 0.2)',
                    border: '1px solid rgba(16, 185, 129, 0.55)',
                    color: '#10b981',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Restore this word back to Ankii Speaking"
                >
                  <span>↩️</span> Restore Word
                </button>
              </div>
            </div>

            {/* English Meaning Display */}
            <div style={{
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700', letterSpacing: '0.5px', marginBottom: '4px' }}>
                English Meaning
              </div>
              <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--color-verb)' }}>
                {currentReviewCard.meaning || '(No translation)'}
              </div>
            </div>

            {/* Workplace/Example if available */}
            {currentReviewCard.examples && currentReviewCard.examples.length > 0 && (
              <div style={{
                padding: '12px 14px',
                borderRadius: '10px',
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                fontSize: '12.5px'
              }}>
                <div style={{ color: '#fff', fontWeight: '600', marginBottom: '4px' }}>
                  💬 {currentReviewCard.examples[0].de}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', fontSize: '11.5px' }}>
                  {currentReviewCard.examples[0].en}
                </div>
              </div>
            )}

            {/* Phase / Countdown Banner */}
            <div style={{
              padding: '12px 16px',
              borderRadius: '12px',
              background: reviewPhase === 'paused'
                ? 'rgba(245, 158, 11, 0.1)'
                : (reviewPhase === 'gap' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255, 255, 255, 0.04)'),
              border: '1px solid var(--border-color)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12.5px' }}>
                <span style={{ fontWeight: '700', color: '#fff' }}>
                  {reviewPhase === 'speaking_de' && '🔊 Speaking German word...'}
                  {reviewPhase === 'waiting_en' && `⏳ English Pause (${reviewCountdown}s / ${waitEnglishSec}s)`}
                  {reviewPhase === 'speaking_en' && '🇬🇧 Speaking English meaning...'}
                  {reviewPhase === 'gap' && `⏳ Next Word Gap (${reviewCountdown}s / ${waitNextSec}s)`}
                  {reviewPhase === 'paused' && '⏸️ Autoplay is Paused'}
                </span>
                {reviewCountdown > 0 && (
                  <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '700' }}>
                    {reviewCountdown}s
                  </span>
                )}
              </div>

              {/* Animated Progress Bar */}
              <div style={{
                width: '100%',
                height: '5px',
                background: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: reviewPhase === 'waiting_en' ? '#f59e0b' : '#3b82f6',
                  width: reviewPhase === 'waiting_en'
                    ? `${(((waitEnglishSec || 2.0) - reviewCountdown) / (waitEnglishSec || 2.0)) * 100}%`
                    : (reviewPhase === 'gap' ? `${(((waitNextSec || 5.0) - reviewCountdown) / (waitNextSec || 5.0)) * 100}%` : (reviewPhase === 'paused' ? '0%' : '100%')),
                  transition: 'width 0.1s linear'
                }} />
              </div>
            </div>

            {/* Big Prominent Restore Button */}
            <button
              type="button"
              onClick={handleReviewRestoreCurrent}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.35))',
                border: '2px solid #10b981',
                color: '#fff',
                fontSize: '15px',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 4px 18px rgba(16, 185, 129, 0.25)',
                transition: 'all 0.15s ease'
              }}
              title="Click or say 'Restore' to return this word to Ankii Speaking"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '17px' }}>↩️</span>
                <span>RESTORE WORD TO DECK</span>
              </div>
              <span style={{ fontSize: '11px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.85)' }}>
                Removes from Deleted List & returns to Ankii Speaking (or say <b>"Restore"</b>)
              </span>
            </button>

            {/* Controls Bar: Prev, Pause/Resume, Restore, Next, Repeat */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', marginTop: '4px' }}>
              <button
                type="button"
                onClick={handleReviewPrev}
                disabled={reviewIndex === 0}
                className="nav-button"
                style={{ padding: '10px 4px', fontSize: '12px', justifyContent: 'center', opacity: reviewIndex === 0 ? 0.4 : 1 }}
                title="Vorheriges Wort (Pfeiltaste links)"
              >
                ⏮️ Prev
              </button>

              <button
                type="button"
                onClick={() => handleToggleReviewPause()}
                className="nav-button"
                style={{
                  padding: '10px 4px',
                  fontSize: '12px',
                  justifyContent: 'center',
                  background: isReviewPaused ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                  border: isReviewPaused ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid var(--border-color)',
                  color: isReviewPaused ? '#93c5fd' : '#fff'
                }}
                title="Pause / Weiter (Leertaste)"
              >
                {isReviewPaused ? '▶️ Resume' : '⏸️ Pause'}
              </button>

              <button
                type="button"
                onClick={handleReviewRestoreCurrent}
                style={{
                  padding: '10px 4px',
                  fontSize: '12px',
                  fontWeight: '800',
                  justifyContent: 'center',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.22)',
                  border: '1px solid rgba(16, 185, 129, 0.65)',
                  color: '#10b981',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
                title="Restore this word back to deck immediately"
              >
                ↩️ Restore
              </button>

              <button
                type="button"
                onClick={handleReviewNext}
                disabled={reviewIndex >= reviewList.length - 1}
                className="nav-button"
                style={{ padding: '10px 4px', fontSize: '12px', justifyContent: 'center', opacity: reviewIndex >= reviewList.length - 1 ? 0.4 : 1 }}
                title="Nächstes Wort (Pfeiltaste rechts)"
              >
                ⏭️ Skip
              </button>

              <button
                type="button"
                onClick={handleReviewRepeat}
                className="nav-button"
                style={{ padding: '10px 4px', fontSize: '12px', justifyContent: 'center' }}
                title="Nochmal abspielen (R)"
              >
                🔁 Repeat
              </button>
            </div>

            {/* Keyboard shortcut cues */}
            <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
              Shortcuts: <kbd style={{ padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Space</kbd> Pause/Play • <kbd style={{ padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Enter</kbd> Restore • <kbd style={{ padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Esc</kbd> Exit
            </div>

          </div>
        )}

        {/* Voice Feedback Floating HUD */}
        {isVoiceActive && (voiceFeedbackMsg || lastHeardVoice) && (
          <div style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 18px',
            borderRadius: '30px',
            background: voiceFeedbackMsg ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
            color: '#fff',
            fontSize: '13px',
            fontWeight: '700',
            animation: 'fadeIn 0.2s ease',
            pointerEvents: 'none'
          }}>
            <span style={{ fontSize: '15px' }}>{voiceFeedbackMsg ? '⚡' : '🎙️'}</span>
            <span>{voiceFeedbackMsg || `Heard: "${lastHeardVoice}"`}</span>
          </div>
        )}

      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW: 1. Pre-Session Setup & Filters
  // ----------------------------------------------------
  if (!sessionActive || !currentCard) {
    if (sessionFinished) {
      const filteredResults = sessionResults.filter(r => {
        if (summaryFilter === 'all') return true;
        return r.result === summaryFilter;
      });

      return (
        <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '680px', margin: '20px auto', padding: '0 16px' }}>
          <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', width: '100%', position: 'relative' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>
              Speaking Session Completed!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '440px', margin: '0 auto 24px' }}>
              You reviewed all <b>{totalSessionWords} words</b> in this session (each seen exactly once).
            </p>

            {/* Performance Stats Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
              maxWidth: '540px',
              margin: '0 auto 28px'
            }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Words Seen</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-verb)', marginTop: '4px' }}>{totalSessionWords}</div>
              </div>
              <div style={{ background: 'rgba(34, 197, 94, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(34, 197, 94, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Mastered</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-noun)', marginTop: '4px' }}>{masteredCount}</div>
              </div>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>English Needed</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-adj)', marginTop: '4px' }}>{englishCount}</div>
              </div>
              <div style={{ background: 'rgba(139, 92, 246, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(139, 92, 246, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Context Needed</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-conn)', marginTop: '4px' }}>{contextCount}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 12px', borderRadius: '14px', border: '1px solid var(--border-color)', gridColumn: 'span 2' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Total Duration</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: '#fff', marginTop: '4px' }}>⏱️ {formatTime(elapsedTime)}</div>
              </div>
            </div>

            {/* Word Recap Breakdown */}
            <div style={{
              background: 'rgba(0,0,0,0.25)',
              border: '1px solid var(--border-color)',
              borderRadius: '18px',
              padding: '20px 16px',
              marginBottom: '28px',
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#fff' }}>
                  📋 Session Words Recap ({sessionResults.length})
                </div>
                {/* Filter Pills */}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    type="button"
                    onClick={() => setSummaryFilter('all')}
                    className={`option-pill ${summaryFilter === 'all' ? 'active' : ''}`}
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    All ({sessionResults.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSummaryFilter('mastered')}
                    className={`option-pill ${summaryFilter === 'mastered' ? 'active' : ''}`}
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    ✓ Mastered ({masteredCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSummaryFilter('english')}
                    className={`option-pill ${summaryFilter === 'english' ? 'active' : ''}`}
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    🇬🇧 English ({englishCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSummaryFilter('context')}
                    className={`option-pill ${summaryFilter === 'context' ? 'active' : ''}`}
                    style={{ padding: '3px 8px', fontSize: '11px' }}
                  >
                    🏢 Context ({contextCount})
                  </button>
                </div>
              </div>

              {/* Scrollable List of Words Seen */}
              <div style={{ maxHeight: '280px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                {filteredResults.map(({ card, result }, idx) => {
                  const starred = myList && myList.some(item => item.word.toLowerCase() === card.word.toLowerCase());
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '12px',
                        border: '1px solid rgba(255, 255, 255, 0.06)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)', width: '22px' }}>
                          #{idx + 1}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff' }}>
                            {card.word}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {card.meaning}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                        {result === 'mastered' && (
                          <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '10px', background: 'rgba(34, 197, 94, 0.15)', color: '#22c55e', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
                            ✓ Know It
                          </span>
                        )}
                        {result === 'english' && (
                          <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                            🇬🇧 English
                          </span>
                        )}
                        {result === 'context' && (
                          <span style={{ fontSize: '11px', fontWeight: '700', padding: '3px 8px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                            🏢 Context
                          </span>
                        )}
                        {onToggleMyList && !isAnonymous && (
                          <button
                            type="button"
                            onClick={() => onToggleMyList(card)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: starred ? '#eab308' : 'var(--text-muted)',
                              fontSize: '16px',
                              cursor: 'pointer',
                              padding: '2px 4px'
                            }}
                            title={starred ? "Remove from My List" : "Add to My List"}
                          >
                            {starred ? '★' : '☆'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  setSessionActive(false);
                  setSessionFinished(false);
                }}
                className="ankii-btn-primary"
                style={{
                  padding: '14px 28px',
                  fontSize: '15px',
                  fontWeight: '700',
                  borderRadius: '14px',
                  background: 'linear-gradient(135deg, var(--color-verb), var(--color-conn))',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)'
                }}
              >
                ⚙️ Adjust Filters & Start New Session
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Default Pre-Session Setup View
    return (
      <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '680px', margin: '20px auto', padding: '0 16px' }}>
        <div className="glass-card" style={{ padding: '32px 24px', width: '100%' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#fff', letterSpacing: '-0.5px', margin: '4px 0' }}>
              Ankii Speaking
            </h2>
          </div>

          {/* Deleted Words & Cross-Device Cloud Sync Status Bar */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            padding: '12px 16px',
            borderRadius: '14px',
            background: 'rgba(239, 68, 68, 0.08)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#ef4444', fontWeight: '700' }}>
                <span>🗑️</span>
                <span>{deletedWords.length} word{deletedWords.length !== 1 ? 's' : ''} deleted from future sessions</span>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleStartReviewList()}
                  disabled={deletedWords.length === 0}
                  style={{
                    background: deletedWords.length > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    border: deletedWords.length > 0 ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid var(--border-color)',
                    color: deletedWords.length > 0 ? '#10b981' : 'var(--text-muted)',
                    borderRadius: '8px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: '700',
                    cursor: deletedWords.length > 0 ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                  }}
                  title={savedReviewIndex > 0 && savedReviewIndex < deletedWords.length ? `Resume review from word #${savedReviewIndex + 1} of ${deletedWords.length}` : `Autoplay and review deleted words in order, with voice 'Restore' support`}
                >
                  <span>🎧</span> Review List {savedReviewIndex > 0 && savedReviewIndex < deletedWords.length ? `(Resume #${savedReviewIndex + 1})` : `(${deletedWords.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeletedModal(true)}
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '5px 12px',
                    fontSize: '11px',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  Manage / Restore
                </button>
              </div>
            </div>

            {/* Cloud Sync Status & Actions Row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingTop: '8px',
              borderTop: '1px solid rgba(255, 255, 255, 0.07)',
              flexWrap: 'wrap',
              gap: '8px'
            }}>
              {syncCode && !isEditingSyncCode ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                    <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }}></span>
                    Cloud Sync:
                  </span>
                  <code style={{ color: '#60a5fa', fontWeight: '700', background: 'rgba(59, 130, 246, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                    {syncCode}
                  </code>
                  <button
                    type="button"
                    onClick={() => {
                      setInputSyncCode(syncCode);
                      setIsEditingSyncCode(true);
                    }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', flexWrap: 'wrap', width: '100%' }}>
                  <span style={{ color: '#f59e0b', fontWeight: '600' }}>⚠️ Cloud Sync Not Connected (Local Only)</span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      placeholder="Enter sync code (e.g. secret123)"
                      value={inputSyncCode}
                      onChange={(e) => setInputSyncCode(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSyncCode(inputSyncCode); }}
                      style={{
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid var(--border-color)',
                        color: '#fff',
                        fontSize: '11px',
                        padding: '4px 8px',
                        borderRadius: '6px',
                        width: '180px'
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveSyncCode(inputSyncCode)}
                      style={{
                        background: 'rgba(59, 130, 246, 0.25)',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        color: '#60a5fa',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      Connect & Sync
                    </button>
                    {isEditingSyncCode && (
                      <button
                        type="button"
                        onClick={() => setIsEditingSyncCode(false)}
                        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>
              )}

              {syncCode && !isEditingSyncCode && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                  {syncFeedback && (
                    <span style={{ fontSize: '11px', color: syncFeedback.startsWith('✅') ? '#10b981' : '#f59e0b', fontWeight: '600' }}>
                      {syncFeedback}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleTriggerSync}
                    disabled={isSyncing}
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      color: '#60a5fa',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: isSyncing ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      opacity: isSyncing ? 0.6 : 1
                    }}
                  >
                    <span>🔄</span>
                    <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 1. Priority Filters */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              1. Filter by Priority:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
              {/* High */}
              <button
                type="button"
                onClick={() => togglePriority(1)}
                className={`ankii-priority-btn ${priorityFilters.includes(1) ? 'active high' : ''}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '14px 10px',
                  borderRadius: '14px',
                  border: priorityFilters.includes(1) ? '2px solid rgba(34, 197, 94, 0.6)' : '1px solid var(--border-color)',
                  background: priorityFilters.includes(1) ? 'rgba(34, 197, 94, 0.12)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', color: priorityFilters.includes(1) ? '#22c55e' : 'var(--text-secondary)' }}>
                  <span>🟢</span> High
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {priorityCounts.high} cards
                </div>
              </button>

              {/* Medium */}
              <button
                type="button"
                onClick={() => togglePriority(2)}
                className={`ankii-priority-btn ${priorityFilters.includes(2) ? 'active med' : ''}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '14px 10px',
                  borderRadius: '14px',
                  border: priorityFilters.includes(2) ? '2px solid rgba(234, 179, 8, 0.6)' : '1px solid var(--border-color)',
                  background: priorityFilters.includes(2) ? 'rgba(234, 179, 8, 0.12)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', color: priorityFilters.includes(2) ? '#eab308' : 'var(--text-secondary)' }}>
                  <span>🟡</span> Medium
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {priorityCounts.med} cards
                </div>
              </button>

              {/* Low */}
              <button
                type="button"
                onClick={() => togglePriority(3)}
                className={`ankii-priority-btn ${priorityFilters.includes(3) ? 'active low' : ''}`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '14px 10px',
                  borderRadius: '14px',
                  border: priorityFilters.includes(3) ? '2px solid rgba(239, 68, 68, 0.6)' : '1px solid var(--border-color)',
                  background: priorityFilters.includes(3) ? 'rgba(239, 68, 68, 0.12)' : 'rgba(255,255,255,0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '700', color: priorityFilters.includes(3) ? '#ef4444' : 'var(--text-secondary)' }}>
                  <span>🔴</span> Low
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {priorityCounts.low} cards
                </div>
              </button>
            </div>
          </div>

          {/* 2. Category selection */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              2. Word Class (Optional):
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {[
                { id: 'all', label: '🌐 All Classes', count: categoryCounts.all },
                { id: 'nouns', label: '🟢 Nouns', count: categoryCounts.nouns },
                { id: 'verbs', label: '🔵 Verbs', count: categoryCounts.verbs },
                { id: 'adjectives', label: '🟡 Adjectives', count: categoryCounts.adjectives },
                { id: 'connectors', label: '#️⃣ Connectors', count: categoryCounts.connectors }
              ].map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`option-pill ${selectedCategory === cat.id ? 'active' : ''}`}
                  style={{
                    padding: '8px 14px',
                    fontSize: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <span>{cat.label}</span>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '1px 7px',
                    borderRadius: '10px',
                    background: selectedCategory === cat.id ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)',
                    color: selectedCategory === cat.id ? '#fff' : 'var(--text-muted)'
                  }}>
                    {cat.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Session Batch Size */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              3. Session Size (Words Seen):
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: '25', label: '⚡ 25 Words' },
                { id: '50', label: '🎯 50 Words' },
                { id: '100', label: '🔥 100 Words' },
                { id: 'all', label: `All Matching (${allFilteredPool.length})` }
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQueueLimit(item.id)}
                  className={`option-pill ${queueLimit === item.id ? 'active' : ''}`}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>


          {/* Prominent Start Session Button */}
          <button
            type="button"
            onClick={handleStartSession}
            disabled={allFilteredPool.length === 0}
            style={{
              width: '100%',
              padding: '18px 24px',
              borderRadius: '16px',
              border: 'none',
              background: allFilteredPool.length > 0
                ? 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)'
                : 'rgba(255,255,255,0.05)',
              color: '#fff',
              fontSize: '17px',
              fontWeight: '800',
              letterSpacing: '0.2px',
              cursor: allFilteredPool.length > 0 ? 'pointer' : 'not-allowed',
              boxShadow: allFilteredPool.length > 0 ? '0 10px 30px rgba(16, 185, 129, 0.35)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <span style={{ fontSize: '20px' }}>🚀</span>
            <span>
              Start Session ({queueLimit === 'all' ? allFilteredPool.length : Math.min(allFilteredPool.length, parseInt(queueLimit, 10))} Words)
            </span>
          </button>

          <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
            💡 Words play automatically in German. Each word is seen once.
          </div>

          {/* Keep Screen Awake Toggle for iPhone & Mobile */}
          <div
            onClick={handleToggleKeepAwake}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '12px',
              padding: '8px 14px',
              borderRadius: '12px',
              background: isKeepAwake ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255, 255, 255, 0.04)',
              border: isKeepAwake ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              maxWidth: '380px',
              margin: '12px auto 0'
            }}
            title="Prevents iPhone from locking the screen during practice so the microphone stays on"
          >
            <span style={{ fontSize: '15px' }}>{isKeepAwake ? '☀️' : '🌙'}</span>
            <span style={{ fontSize: '12px', fontWeight: '700', color: isKeepAwake ? '#f59e0b' : 'var(--text-secondary)' }}>
              {isKeepAwake ? 'Screen Lock Disabled (Awake: ON)' : 'Keep Screen Awake (Prevents iPhone Auto-Lock)'}
            </span>
            {isKeepAwake && (
              <span className="pulse-indicator" style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: '#f59e0b',
                display: 'inline-block'
              }} />
            )}
          </div>

        </div>

        {/* MODAL: Manage / Restore Deleted Words */}
        {showDeletedModal && (
          <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            backdropFilter: 'blur(8px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}>
            <div className="glass-card animate-fade-in" style={{
              maxWidth: '520px',
              width: '100%',
              padding: '24px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🗑️</span> Deleted Words ({deletedWords.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowDeletedModal(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>

              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.4' }}>
                These words will never appear in any future Ankii Speaking sessions. Click <b>Restore</b> on any word to add it back to your deck.
              </p>

              {/* Start Review List button inside modal */}
              {deletedWords.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeletedModal(false);
                      handleStartReviewList();
                    }}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(59, 130, 246, 0.25))',
                      border: '1px solid rgba(16, 185, 129, 0.5)',
                      color: '#fff',
                      fontWeight: '700',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      boxShadow: '0 4px 15px rgba(16, 185, 129, 0.2)'
                    }}
                  >
                    <span>🎧 {savedReviewIndex > 0 && savedReviewIndex < deletedWords.length ? `Resume Review at #${savedReviewIndex + 1} of ${deletedWords.length}` : `Start Review List (${deletedWords.length} Words in Order)`}</span>
                  </button>
                  {savedReviewIndex > 0 && savedReviewIndex < deletedWords.length && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowDeletedModal(false);
                        handleStartReviewList(0);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        textAlign: 'center'
                      }}
                    >
                      Or restart from beginning (#1)
                    </button>
                  )}
                </div>
              )}

              {/* Cloud Sync Status & Actions inside Modal */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-color)',
                marginBottom: '16px',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                {syncCode && !isEditingSyncCode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', flexWrap: 'wrap' }}>
                    <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '600' }}>
                      <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }}></span>
                      Cloud Sync:
                    </span>
                    <code style={{ color: '#60a5fa', fontWeight: '700', background: 'rgba(59, 130, 246, 0.12)', padding: '2px 6px', borderRadius: '4px' }}>
                      {syncCode}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        setInputSyncCode(syncCode);
                        setIsEditingSyncCode(true);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', flexWrap: 'wrap', width: '100%' }}>
                    <span style={{ color: '#f59e0b', fontWeight: '600' }}>⚠️ Cloud Sync Not Connected</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        type="text"
                        placeholder="Enter sync code"
                        value={inputSyncCode}
                        onChange={(e) => setInputSyncCode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSyncCode(inputSyncCode); }}
                        style={{
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid var(--border-color)',
                          color: '#fff',
                          fontSize: '11px',
                          padding: '4px 8px',
                          borderRadius: '6px',
                          width: '160px'
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveSyncCode(inputSyncCode)}
                        style={{
                          background: 'rgba(59, 130, 246, 0.25)',
                          border: '1px solid rgba(59, 130, 246, 0.4)',
                          color: '#60a5fa',
                          borderRadius: '6px',
                          padding: '4px 10px',
                          fontSize: '11px',
                          fontWeight: '700',
                          cursor: 'pointer'
                        }}
                      >
                        Connect & Sync
                      </button>
                      {isEditingSyncCode && (
                        <button
                          type="button"
                          onClick={() => setIsEditingSyncCode(false)}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {syncCode && !isEditingSyncCode && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                    {syncFeedback && (
                      <span style={{ fontSize: '11px', color: syncFeedback.startsWith('✅') ? '#10b981' : '#f59e0b', fontWeight: '600' }}>
                        {syncFeedback}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleTriggerSync}
                      disabled={isSyncing}
                      style={{
                        background: 'rgba(59, 130, 246, 0.15)',
                        border: '1px solid rgba(59, 130, 246, 0.35)',
                        color: '#60a5fa',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: isSyncing ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        opacity: isSyncing ? 0.6 : 1
                      }}
                    >
                      <span>🔄</span>
                      <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                    </button>
                  </div>
                )}
              </div>

              <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px', paddingRight: '4px' }}>
                {deletedWords.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '13px' }}>
                    No deleted words.
                  </div>
                ) : (
                  deletedWords.map((item, idx) => {
                    const wordStr = typeof item === 'string' ? item : (item && item.word ? item.word : String(item));
                    return (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border-color)'
                        }}
                      >
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#fff' }}>
                          {wordStr}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRestoreWordFromModal(wordStr)}
                          style={{
                            background: 'rgba(34, 197, 94, 0.15)',
                            border: '1px solid rgba(34, 197, 94, 0.35)',
                            color: '#22c55e',
                            borderRadius: '8px',
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: '700',
                            cursor: 'pointer'
                          }}
                        >
                          ↩ Restore
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Modal Footer with Disaster Recovery and Restore Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={exportDeletedBackup}
                    style={{
                      background: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      color: '#60a5fa',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                    title="Download and update deleted_words_backup.json directly"
                  >
                    💾 Export Backup
                  </button>
                  <button
                    type="button"
                    onClick={chooseBackupDirectory}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-secondary)',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                    title="Connect or re-select your local 'german-dashboard' project directory"
                  >
                    📁 Set Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    style={{
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '8px 12px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                    title="Import or restore words from JSON backup file"
                  >
                    📥 Recover from Backup
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportBackupFile}
                    style={{ display: 'none' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                  {deletedWords.length > 0 && (
                    <button
                      type="button"
                      onClick={handleRestoreAllDeleted}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.35)',
                        color: '#ef4444',
                        borderRadius: '8px',
                        padding: '8px 14px',
                        fontSize: '11px',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      Restore All
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowDeletedModal(false)}
                    style={{
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      borderRadius: '8px',
                      padding: '8px 16px',
                      fontSize: '11px',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW: 2. Active Audio-First Card Session
  // With Full-Screen Smartphone Swipe Support!
  // Shows Words Seen Counter & Delete with 10s Undo Timer
  // ----------------------------------------------------
  const progressPercent = totalSessionWords > 0
    ? Math.min(100, Math.round((wordsSeenCount / totalSessionWords) * 100))
    : 0;

  return (
    <div
      className="flashcard-layout animate-fade-in"
      style={{
        maxWidth: '640px',
        margin: '16px auto',
        padding: '0 16px 64px 16px',
        minHeight: 'calc(100dvh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative'
      }}
    >

      {/* Top Header & Words Seen Counter */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

          {/* Words Seen & Deleted Counters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '13px',
              fontWeight: '800',
              color: '#fff',
              background: 'rgba(59, 130, 246, 0.2)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              padding: '4px 10px',
              borderRadius: '12px'
            }}>
              👁️ {wordsSeenCount} / {totalSessionWords}
            </span>

            <span style={{
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '12px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#ef4444',
              fontWeight: '700'
            }}
            title="Words deleted during this session"
            >
              🗑️ {sessionDeletedCount} Deleted
            </span>

            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              ({remainingCount} left)
            </span>
          </div>

          {/* Quick Actions (Voice / Keep Awake / Exit) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {/* Prominent Continuous Voice Control Button */}
            <button
              type="button"
              onClick={async () => {
                if (!SpeechRecognition) {
                  alert("Speech recognition is not supported in this browser. Try Google Chrome, Microsoft Edge, or Apple Safari.");
                  return;
                }
                const nextVoice = !isVoiceActive;
                setIsVoiceActive(nextVoice);
                // When activating hands-free voice control on iPhone/mobile, automatically keep screen awake!
                if (nextVoice && !isKeepAwake) {
                  try {
                    await wakeLockManager.enable();
                    setIsKeepAwake(true);
                  } catch (e) {}
                }
              }}
              title={isVoiceActive ? (isVoiceReady ? "Voice Control Active (Listening). Click to turn off" : "Voice Control Cooldown (Ready in 2s)") : "Enable Hands-free Voice Control ('More', 'Next', 'Translate', 'Delete', 'Favorite', 'Spell/Spelling', 'Repeat')"}
              style={{
                background: isVoiceActive
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.28), rgba(59, 130, 246, 0.28))'
                  : 'rgba(255, 255, 255, 0.08)',
                border: isVoiceActive ? '1px solid rgba(16, 185, 129, 0.65)' : '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '12px',
                color: isVoiceActive ? '#10b981' : '#fff',
                padding: '6px 13px',
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
                  background: isVoiceReady ? '#10b981' : '#f59e0b',
                  display: 'inline-block',
                  opacity: isVoiceReady ? 1 : 0.6,
                  transition: 'all 0.3s ease'
                }} />
              )}
            </button>

            {/* Screen Keep-Awake Button (Disables iPhone Auto-Lock so Voice Mic Stays Active) */}
            <button
              type="button"
              onClick={handleToggleKeepAwake}
              title={isKeepAwake ? "Screen Lock Disabled (Screen stays awake, mic won't sleep). Click to turn off" : "Keep Screen Awake (Disables iPhone screen auto-lock so voice mic stays on)"}
              style={{
                background: isKeepAwake
                  ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.28), rgba(234, 179, 8, 0.28))'
                  : 'rgba(255, 255, 255, 0.08)',
                border: isKeepAwake ? '1px solid rgba(245, 158, 11, 0.65)' : '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '12px',
                color: isKeepAwake ? '#f59e0b' : '#fff',
                padding: '6px 12px',
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
              {isKeepAwake && (
                <span className="pulse-indicator" style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#f59e0b',
                  display: 'inline-block'
                }} />
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                clearAdvanceTimers();
                if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                setSessionActive(false);
              }}
              title="Exit Session"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-muted)',
                padding: '5px 10px',
                fontSize: '12px',
                cursor: 'pointer',
                fontWeight: '600'
              }}
            >
              ✕ Exit
            </button>
          </div>
        </div>

        {/* Progress Bar (Words Seen %) */}
        <div style={{
          width: '100%',
          height: '6px',
          background: 'rgba(255,255,255,0.08)',
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{
            width: `${progressPercent}%`,
            height: '100%',
            background: 'linear-gradient(90deg, var(--color-verb), var(--color-noun))',
            borderRadius: '3px',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Voice Control Floating Command Indicator */}
      {isVoiceActive && (voiceFeedbackMsg || lastHeardVoice) && (
        <div style={{
          position: 'fixed',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9990,
          background: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: voiceFeedbackMsg ? '1px solid rgba(16, 185, 129, 0.5)' : '1px solid rgba(148, 163, 184, 0.25)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          borderRadius: '24px',
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '12px',
          color: voiceFeedbackMsg ? '#10b981' : '#cbd5e1',
          fontWeight: '700',
          pointerEvents: 'none',
          transition: 'all 0.2s ease'
        }}>
          <span className="pulse-indicator" style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: voiceFeedbackMsg ? '#10b981' : '#38bdf8',
            display: 'inline-block'
          }} />
          <span>
            {voiceFeedbackMsg ? `Command: "${voiceFeedbackMsg}"` : `🎙️ Heard: "${lastHeardVoice}"`}
          </span>
        </div>
      )}

      {/* Swipe Feedback Badge (Mobile Drag across card) */}
      <div style={{
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.15s ease',
        opacity: touchFeedback ? 1 : 0,
        margin: '4px 0'
      }}>
        {touchFeedback === 'mastered' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👉 Release to Master [Next]
          </span>
        )}
        {touchFeedback === 'english' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👈 Release for English Translation
          </span>
        )}
        {touchFeedback === 'context' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👆 Release for Context & Workplace Example
          </span>
        )}
        {touchFeedback === 'delete' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👇 Release to Delete Word
          </span>
        )}
      </div>

      {/* MAIN AUDIO-FIRST FLASHCARD (Touch gestures strictly bound to card area) */}
      <div
        className={`glass-card ankii-speaking-card ${currentCard.category || 'nouns'} ${isWiggling ? 'card-wiggle' : ''} ${isGestureMode ? 'gesture-active' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleCardClick}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          width: '100%',
          minHeight: '340px',
          padding: '28px 24px',
          borderRadius: '24px',
          cursor: 'pointer',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          touchAction: isGestureMode ? 'none' : 'pan-y',
          transform: isWiggling
            ? undefined
            : `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${dragOffset.x * 0.05}deg)`,
          transition: isDraggingRef.current ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease, box-shadow 0.2s ease',
          borderColor: touchFeedback === 'mastered' ? 'rgba(34, 197, 94, 0.8)' :
            touchFeedback === 'english' ? 'rgba(245, 158, 11, 0.8)' :
              touchFeedback === 'context' ? 'rgba(59, 130, 246, 0.8)' :
                touchFeedback === 'delete' ? 'rgba(239, 68, 68, 0.8)' :
                  isGestureMode ? 'rgba(59, 130, 246, 0.85)' :
                    isSpeaking ? 'rgba(139, 92, 246, 0.7)' : 'rgba(255, 255, 255, 0.12)',
          boxShadow: isGestureMode
            ? '0 0 28px rgba(59, 130, 246, 0.35), var(--shadow-premium)'
            : isSpeaking
              ? '0 12px 40px rgba(139, 92, 246, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.2)'
              : 'var(--shadow-premium), var(--shadow-inset)'
        }}
      >
        {/* TOP CARD CUE: More (Positioned directly at top edge of card to prevent overlapping with viewport) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleMoreContext();
          }}
          className={`ankii-layout-cue ankii-card-cue-top ${touchFeedback === 'context' ? 'active-cue' : ''}`}
          style={{
            position: 'absolute',
            top: '-15px',
            left: '50%',
            transform: 'translateX(-50%)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            background: touchFeedback === 'context' ? 'rgba(59, 130, 246, 0.35)' : 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(59, 130, 246, 0.45)',
            color: 'var(--color-verb)',
            padding: '5px 15px',
            borderRadius: '16px',
            fontSize: '11px',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            zIndex: 10,
            cursor: 'pointer'
          }}
          title="More Context (Swipe Up on Card / Voice: 'More' / [M])"
        >
          <span style={{ fontSize: '9px' }}>▲</span>
          <span>More</span>
          <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px', color: 'rgba(255,255,255,0.7)' }}>[M]</kbd>
        </button>

        {/* BOTTOM CARD CUE: Delete (Positioned directly at bottom edge of card to prevent overlapping with viewport) */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleDeleteWord();
          }}
          className={`ankii-layout-cue ankii-card-cue-bottom ${touchFeedback === 'delete' ? 'active-cue' : ''}`}
          style={{
            position: 'absolute',
            bottom: '-15px',
            left: '50%',
            transform: 'translateX(-50%)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            background: touchFeedback === 'delete' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(15, 23, 42, 0.85)',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            color: '#ef4444',
            padding: '5px 15px',
            borderRadius: '16px',
            fontSize: '11px',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
            zIndex: 10,
            cursor: 'pointer'
          }}
          title="Delete Word (Swipe Down on Card / Voice: 'Delete' / [D])"
        >
          <span style={{ fontSize: '9px' }}>▼</span>
          <span>Delete</span>
          <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px', color: 'rgba(255,255,255,0.7)' }}>[D]</kbd>
        </button>
        {/* Top Left Card Badges */}
        <div style={{ position: 'absolute', top: '20px', left: '20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span className={`category-tag ${currentCard.category || 'nouns'}`}>
            {currentCard.category}
          </span>
          {currentCard.priority && (
            <span style={{
              fontSize: '11px',
              fontWeight: '700',
              padding: '3px 8px',
              borderRadius: '12px',
              background: currentCard.priority === 1 ? 'rgba(34, 197, 94, 0.15)' :
                currentCard.priority === 2 ? 'rgba(234, 179, 8, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: currentCard.priority === 1 ? '#22c55e' :
                currentCard.priority === 2 ? '#eab308' : '#ef4444',
              border: `1px solid ${currentCard.priority === 1 ? 'rgba(34, 197, 94, 0.25)' :
                currentCard.priority === 2 ? 'rgba(234, 179, 8, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`
            }}>
              ⚡ P{currentCard.priority}
            </span>
          )}
        </div>

        {/* Top Right: Delete Icon, Star Button & Audio Replay Button */}
        <div style={{ position: 'absolute', top: '16px', right: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>

          {/* DELETE BUTTON (Never show in future sessions, 10s undo timer) */}
          <button
            type="button"
            className="sound-btn ankii-delete-btn"
            onClick={handleDeleteWord}
            title="Never show this word in any future Anki Speaking session [D / Del]"
            style={{
              fontSize: '15px',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            🗑️
          </button>

          {/* Add to List Star Button */}
          {onToggleMyList && !isAnonymous && (
            <button
              type="button"
              className="sound-btn ankii-star-btn"
              onClick={handleToggleStar}
              title={isStarred ? "Remove from My List (Starred) [S]" : "Add to My List Star [S]"}
              style={{
                fontSize: '19px',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: isStarred ? 'rgba(234, 179, 8, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                border: isStarred ? '1px solid rgba(234, 179, 8, 0.6)' : '1px solid var(--border-color)',
                color: isStarred ? '#eab308' : 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isStarred ? '0 0 14px rgba(234, 179, 8, 0.35)' : 'none',
                transform: isStarred ? 'scale(1.08)' : 'scale(1)'
              }}
            >
              {isStarred ? '★' : '☆'}
            </button>
          )}

          {/* Sound Replay button */}
          <button
            type="button"
            className="sound-btn"
            onClick={(e) => {
              e.stopPropagation();
              replayGerman();
            }}
            title="Tap to replay German pronunciation [R]"
            style={{
              fontSize: '16px',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isSpeaking ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.06)',
              transform: isSpeaking ? 'scale(1.15)' : 'scale(1)',
              transition: 'transform 0.2s ease, background 0.2s ease'
            }}
          >
            {isSpeaking ? '🔊' : '🔈'}
          </button>
        </div>

        {/* Center Content: German Word */}
        <div style={{ margin: 'auto 0', width: '100%', padding: '16px 0' }}>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            fontWeight: '700',
            marginBottom: '10px'
          }}>
            German Word ({currentIndex + 1} of {totalSessionWords})
          </div>

          <div style={{
            fontSize: '38px',
            fontWeight: '800',
            color: '#fff',
            letterSpacing: '-0.5px',
            lineHeight: 1.2,
            marginBottom: currentCard.conjugation ? '8px' : '0'
          }}>
            {currentCard.word}
          </div>

          {/* Spell Mode Display Badge */}
          {spellingDisplay && (
            <div style={{
              marginTop: '10px',
              padding: '6px 14px',
              borderRadius: '12px',
              background: 'rgba(168, 85, 247, 0.16)',
              border: '1px solid rgba(168, 85, 247, 0.4)',
              color: '#d8b4fe',
              fontSize: '13px',
              fontWeight: '700',
              letterSpacing: '0.8px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 0 14px rgba(168, 85, 247, 0.25)'
            }}>
              <span>🔤</span>
              <span>{spellingDisplay}</span>
            </div>
          )}

          {currentCard.conjugation && (
            <div style={{
              fontSize: '14px',
              color: 'var(--text-secondary)',
              fontStyle: 'italic',
              marginTop: '4px'
            }}>
              {currentCard.conjugation}
            </div>
          )}

          {/* CENTER LAYOUT CUES: Repeat & Spell (Desktop & Phone) */}
          <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                replayGerman();
              }}
              className="ankii-layout-cue ankii-cue-center"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '20px',
                background: isSpeaking && speakingPhase === 'de' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: isSpeaking && speakingPhase === 'de' ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid rgba(255, 255, 255, 0.14)',
                color: isSpeaking && speakingPhase === 'de' ? 'var(--color-verb)' : 'rgba(255, 255, 255, 0.85)',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.15)'
              }}
              title="Repeat German Pronunciation [R / Voice: 'Repeat']"
            >
              <span style={{ fontSize: '13px' }}>{isSpeaking && speakingPhase === 'de' ? '🔊' : '⟳'}</span>
              <span>Repeat</span>
              <kbd style={{
                fontSize: '9px',
                background: 'rgba(255,255,255,0.1)',
                padding: '1px 5px',
                borderRadius: '4px',
                color: 'rgba(255,255,255,0.6)'
              }}>
                [R]
              </kbd>
            </button>

            {/* Spell Button (Spells letters in English with clear pronunciation of ä, ö, ü, ß) */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleSpellWord();
              }}
              className="ankii-layout-cue ankii-cue-center"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 14px',
                borderRadius: '20px',
                background: isSpeaking && speakingPhase === 'spell' ? 'rgba(168, 85, 247, 0.28)' : 'rgba(255, 255, 255, 0.06)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: isSpeaking && speakingPhase === 'spell' ? '1px solid rgba(168, 85, 247, 0.55)' : '1px solid rgba(255, 255, 255, 0.14)',
                color: isSpeaking && speakingPhase === 'spell' ? '#c084fc' : 'rgba(255, 255, 255, 0.85)',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: '0 2px 10px rgba(0,0,0,0.15)'
              }}
              title="Spell Word letter-by-letter in English [P / Voice: 'Spell']"
            >
              <span style={{ fontSize: '13px' }}>{isSpeaking && speakingPhase === 'spell' ? '🔊' : '🔤'}</span>
              <span>Spell</span>
              <kbd style={{
                fontSize: '9px',
                background: 'rgba(255,255,255,0.1)',
                padding: '1px 5px',
                borderRadius: '4px',
                color: 'rgba(255,255,255,0.6)'
              }}>
                [P]
              </kbd>
            </button>
          </div>

          {/* FAVORITE LAYOUT OPTION (Directly Underneath Repeat - Desktop & Phone) */}
          <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleToggleStar();
              }}
              className={`ankii-layout-cue ankii-cue-center ankii-cue-favorite ${isStarred ? 'active-cue' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 15px',
                borderRadius: '20px',
                background: isStarred ? 'rgba(234, 179, 8, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                border: isStarred ? '1px solid rgba(234, 179, 8, 0.55)' : '1px solid rgba(255, 255, 255, 0.14)',
                color: isStarred ? '#eab308' : 'rgba(255, 255, 255, 0.82)',
                fontSize: '11px',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isStarred ? '0 0 14px rgba(234, 179, 8, 0.3)' : '0 2px 8px rgba(0,0,0,0.12)'
              }}
              title={isStarred ? "Word is in My List - Click to Remove [S / F / Voice: 'Favorite']" : "Add word to My List [S / F / Voice: 'Favorite']"}
            >
              <span style={{ fontSize: '13px', color: isStarred ? '#eab308' : 'rgba(255, 255, 255, 0.6)' }}>
                {isStarred ? '★' : '☆'}
              </span>
              <span>{isStarred ? 'In My List' : 'Favorite'}</span>
              <kbd style={{
                fontSize: '9px',
                background: 'rgba(255,255,255,0.1)',
                padding: '1px 5px',
                borderRadius: '4px',
                color: 'rgba(255,255,255,0.6)'
              }}>
                [S]
              </kbd>
            </button>
          </div>

          {/* AUDIO PROMPT HINT & 1-SECOND GESTURE STATUS */}
          {revealedState === 'none' && (
            <div style={{
              marginTop: '12px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}>
              <span>👆</span>
              <span>Tap to replay • Hold 1s to swipe</span>
            </div>
          )}
          {isGestureMode && (
            <div style={{
              marginTop: '8px',
              fontSize: '11px',
              fontWeight: '800',
              color: '#38bdf8',
              letterSpacing: '0.5px'
            }}>
              ✨ Gestures Active: Swipe card in any direction!
            </div>
          )}

          {/* REVEALED CONTENT 1: English Meaning */}
          {(revealedState === 'english' || revealedState === 'context') && (
            <div className="animate-fade-in" style={{
              marginTop: '24px',
              padding: '16px 20px',
              borderRadius: '16px',
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              width: '100%',
              maxWidth: '480px',
              margin: '24px auto 0'
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: '800',
                color: 'var(--color-adj)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '6px'
              }}>
                English Translation
              </div>
              <div style={{
                fontSize: '22px',
                fontWeight: '700',
                color: '#fff'
              }}>
                {currentCard.meaning}
              </div>
            </div>
          )}

          {/* REVEALED CONTENT 2: German Workplace Example Sentence */}
          {revealedState === 'context' && wpExample && (
            <div className="animate-fade-in" style={{
              marginTop: '16px',
              padding: '16px 20px',
              borderRadius: '16px',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              width: '100%',
              maxWidth: '480px',
              margin: '16px auto 0',
              textAlign: 'left'
            }}>
              <div style={{
                fontSize: '11px',
                fontWeight: '800',
                color: 'var(--color-verb)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span>🏢</span> Workplace Example Sentence
              </div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', lineHeight: '1.4' }}>
                🇩🇪 {wpExample.de}
              </div>
              {wpExample.en && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                  🇬🇧 {wpExample.en}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom Card Footer: Shortcut Cheatsheet */}
        <div style={{ width: '100%', marginTop: 'auto', paddingTop: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Desktop: <code>[Space]</code> Know It • <code>[N]</code> English • <code>[M]</code> Context • <code>[S]</code> Favorite • <code>[D]</code> Delete
          </div>
        </div>
      </div>

      {/* 2 SCREEN BORDER VISUAL LAYOUT CUES (Left: Translate / Right: Next) */}
      <div className="ankii-layout-cues ankii-phone-border-cues">
        {/* Left Screen Border: Translate */}
        <button
          type="button"
          onClick={handleForgotEnglish}
          className={`ankii-layout-cue ankii-phone-cue ankii-cue-left ${touchFeedback === 'english' ? 'active-cue' : ''}`}
          style={{
            position: 'fixed',
            left: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            background: touchFeedback === 'english' ? 'rgba(245, 158, 11, 0.28)' : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: 'var(--color-adj)',
            padding: '9px 13px',
            borderRadius: '16px',
            fontSize: '11px',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            zIndex: 90,
            cursor: 'pointer'
          }}
          title="Translate (Swipe Left on Card / Voice: 'Translate')"
        >
          <span style={{ fontSize: '13px' }}>‹</span>
          <span>Translate</span>
        </button>

        {/* Right Screen Border: Next */}
        <button
          type="button"
          onClick={revealedState === 'none' ? handleMastered : handleAdvanceNext}
          className={`ankii-layout-cue ankii-phone-cue ankii-cue-right ${touchFeedback === 'mastered' ? 'active-cue' : ''}`}
          style={{
            position: 'fixed',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            background: touchFeedback === 'mastered' ? 'rgba(16, 185, 129, 0.28)' : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            color: '#22c55e',
            padding: '9px 13px',
            borderRadius: '16px',
            fontSize: '11px',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
            zIndex: 90,
            cursor: 'pointer'
          }}
          title="Next (Swipe Right on Card / Voice: 'Next')"
        >
          <span>Next</span>
          <span style={{ fontSize: '13px' }}>›</span>
        </button>
      </div>

      {/* 10-SECOND UNDO TOAST NOTIFICATION (RESPONSIVE FOR PHONE) */}
      {undoToast && (
        <div
          className="animate-fade-in"
          style={{
            position: 'fixed',
            bottom: '18px',
            left: '12px',
            right: '12px',
            maxWidth: '460px',
            margin: '0 auto',
            boxSizing: 'border-box',
            background: 'rgba(18, 20, 30, 0.96)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.65), 0 0 20px rgba(239, 68, 68, 0.25)',
            borderRadius: '14px',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            zIndex: 9999
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: '1 1 auto' }}>
            <span style={{ fontSize: '18px', flexShrink: 0 }}>🗑️</span>
            <div style={{ minWidth: 0, flex: '1 1 auto' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                "{undoToast.word}" deleted
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Removed from future sessions
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleUndoDelete}
              style={{
                background: 'linear-gradient(135deg, #10b981, #059669)',
                border: 'none',
                color: '#fff',
                fontWeight: '800',
                fontSize: '11px',
                padding: '7px 11px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.35)',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              <span>↩ Undo</span>
              <span style={{
                background: 'rgba(0,0,0,0.25)',
                padding: '1px 5px',
                borderRadius: '6px',
                fontSize: '10px'
              }}>
                {undoToast.secondsLeft}s
              </span>
            </button>

            <button
              type="button"
              onClick={() => setUndoToast(null)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '15px',
                cursor: 'pointer',
                padding: '4px',
                flexShrink: 0
              }}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* BOTTOM TRIAGE CONTROLS (OPTIMIZED FOR TOUCH & KEYBOARD) */}
      <div style={{ width: '100%', marginTop: '16px' }}>

        {/* If card is revealed, show an additional quick "Next Card" bar */}
        {revealedState !== 'none' && (
          <button
            type="button"
            onClick={handleAdvanceNext}
            className="ankii-next-bar animate-fade-in"
            style={{
              width: '100%',
              padding: '14px 20px',
              borderRadius: '16px',
              border: 'none',
              background: 'linear-gradient(135deg, var(--color-noun), var(--color-verb))',
              color: '#fff',
              fontSize: '15px',
              fontWeight: '800',
              cursor: 'pointer',
              marginBottom: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 6px 20px rgba(16, 185, 129, 0.25)'
            }}
          >
            <span>Next Word ({currentIndex + 2 > totalSessionWords ? 'Finish' : `${currentIndex + 2} of ${totalSessionWords}`})</span>
            <kbd style={{
              fontSize: '11px',
              background: 'rgba(0,0,0,0.25)',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.2)'
            }}>
              Space ➔
            </kbd>
          </button>
        )}

        {/* The 3 Core Action Buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1.3fr',
          gap: '10px',
          width: '100%'
        }}>
          {/* Action 2: English Meaning Only */}
          <button
            type="button"
            onClick={handleForgotEnglish}
            className="triage-btn forgot-btn"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 10px',
              borderRadius: '18px',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              background: revealedState === 'english' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(245, 158, 11, 0.08)',
              color: 'var(--color-adj)',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: '800' }}>
              <span>🇬🇧</span>
              <span>English</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginTop: '4px' }}>
              <kbd style={{
                fontSize: '10px',
                background: 'rgba(0,0,0,0.25)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: 'var(--text-secondary)'
              }}>
                [N]
              </kbd>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>• 👈 Swipe</span>
            </div>
          </button>

          {/* Action 3: More Context (English + Workplace Example) */}
          <button
            type="button"
            onClick={handleMoreContext}
            className="triage-btn context-btn"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 10px',
              borderRadius: '18px',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              background: revealedState === 'context' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(59, 130, 246, 0.08)',
              color: 'var(--color-verb)',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: '800' }}>
              <span>🏢</span>
              <span>Context</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginTop: '4px' }}>
              <kbd style={{
                fontSize: '10px',
                background: 'rgba(0,0,0,0.25)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: 'var(--text-secondary)'
              }}>
                [M]
              </kbd>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>• 👆 Swipe</span>
            </div>
          </button>

          {/* Action 1: Mastered / Known (Instant Recall) */}
          <button
            type="button"
            onClick={handleMastered}
            className="triage-btn mastered-btn"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '14px 12px',
              borderRadius: '18px',
              border: '1px solid rgba(16, 185, 129, 0.45)',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(16, 185, 129, 0.12))',
              color: '#22c55e',
              cursor: 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.15)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '15px', fontWeight: '800' }}>
              <span>✨</span>
              <span>Know It</span>
            </div>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginTop: '4px' }}>
              <kbd style={{
                fontSize: '10px',
                background: 'rgba(0,0,0,0.3)',
                padding: '2px 6px',
                borderRadius: '4px',
                color: '#fff'
              }}>
                [Space]
              </kbd>
              <span style={{ fontSize: '10px', color: 'rgba(34, 197, 94, 0.8)' }}>• 👉 Swipe</span>
            </div>
          </button>
        </div>
      </div>

    </div>
  );
}
