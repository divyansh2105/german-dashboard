import React, { useState, useEffect, useRef, useCallback } from 'react';
import { exportBackupFile, chooseBackupDirectory } from '../utils/backupStorage';
import { wakeLockManager } from '../utils/wakeLockManager';
import { getAudioGermanWord } from './AnkiiSpeaking';

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

// Persistent utterance cache to prevent WebKit / iOS Safari from garbage collecting
// SpeechSynthesisUtterance mid-speech before the onend event has fired
if (typeof window !== 'undefined') {
  window.__ankiActiveUtterances = window.__ankiActiveUtterances || new Set();
}

export default function MyList({ 
  myList, 
  onToggleMyList, 
  onImportMyList,
  syncCode,
  setSyncCode,
  syncStatus,
  syncError,
  onSyncNow,
  reviewPosition,
  onUpdateReviewPosition
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

  useEffect(() => {
    setTempCode(syncCode || '');
  }, [syncCode]);

  // Review List state & refs
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
      const idx = localStorage.getItem('b1_mylist_review_last_index');
      if (idx !== null) {
        const parsed = parseInt(idx, 10);
        return isNaN(parsed) ? 0 : parsed;
      }
    } catch (e) {}
    return 0;
  });

  useEffect(() => {
    if (reviewPosition && typeof reviewPosition.index === 'number') {
      const idx = reviewPosition.index;
      setSavedReviewIndex(idx);
      if (!isReviewActiveRef.current) {
        setReviewIndex(idx);
        reviewIndexRef.current = idx;
      }
    }
  }, [reviewPosition]);

  const [waitEnglishSec, setWaitEnglishSec] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_mylist_review_wait_english');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.5) return val;
      }
    } catch (e) {}
    return 2.0;
  });

  const [waitNextSec, setWaitNextSec] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_mylist_review_wait_next');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 1.0) return val;
      }
    } catch (e) {}
    return 5.0;
  });

  const waitEnglishSecRef = useRef(waitEnglishSec);
  const waitNextSecRef = useRef(waitNextSec);

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
    localStorage.setItem('b1_mylist_review_wait_english', String(clamped));
  };

  const handleUpdateWaitNext = (val) => {
    const clamped = Math.max(1, Math.min(30, Math.round(val * 10) / 10));
    setWaitNextSec(clamped);
    localStorage.setItem('b1_mylist_review_wait_next', String(clamped));
  };

  // Screen Keep-Awake state
  const [isKeepAwake, setIsKeepAwake] = useState(false);

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

  // Voice & TTS state/refs
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const isVoiceActiveRef = useRef(false);
  useEffect(() => {
    isVoiceActiveRef.current = isVoiceActive;
  }, [isVoiceActive]);

  const [voiceFeedbackMsg, setVoiceFeedbackMsg] = useState(null);
  const [lastHeardVoice, setLastHeardVoice] = useState('');
  const isSpeakingRef = useRef(false);
  const lastSpeakingEndTimeRef = useRef(0);
  const lastExecutedCommandTimeRef = useRef(0);
  const lastProcessedResultIndexRef = useRef(-1);
  const hasEverStartedSuccessfullyRef = useRef(false);
  const isStoppingManuallyRef = useRef(false);
  const recognitionRef = useRef(null);
  const startRecognitionRef = useRef(null);
  const restartTimeoutRef = useRef(null);
  const resumeVoiceTimeoutRef = useRef(null);
  const ttsWatchdogRef = useRef(null);
  const voiceFeedbackTimeoutRef = useRef(null);
  const reviewTimerRef = useRef(null);
  const reviewCountdownIntervalRef = useRef(null);
  const reviewToastTimeoutRef = useRef(null);
  const isMountedRef = useRef(true);

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

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      clearReviewTimers();
      if (voiceFeedbackTimeoutRef.current) clearTimeout(voiceFeedbackTimeoutRef.current);
      if (reviewToastTimeoutRef.current) clearTimeout(reviewToastTimeoutRef.current);
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (resumeVoiceTimeoutRef.current) clearTimeout(resumeVoiceTimeoutRef.current);
      if (ttsWatchdogRef.current) clearTimeout(ttsWatchdogRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
      wakeLockManager.disable();
    };
  }, [clearReviewTimers]);

  // WebKit / iOS-safe TTS Helpers
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

  // Review List Engine
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
      localStorage.setItem('b1_mylist_review_last_index', String(idx));
      localStorage.setItem('b1_mylist_review_last_updated', String(Date.now()));
      if (card && card.word) {
        localStorage.setItem('b1_mylist_review_last_word', card.word);
      }
    } catch (e) {}
    if (onUpdateReviewPosition) {
      onUpdateReviewPosition(idx, card?.word);
    }
    setReviewPhase('speaking_de');
    setReviewCountdown(0);

    const deWord = getAudioGermanWord(card.word);
    speakGerman(deWord, () => {
      if (!isReviewActiveRef.current || isReviewPausedRef.current) return;
      if (reviewIndexRef.current !== idx) return;

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

        setReviewPhase('speaking_en');
        const enMeaning = card.meaning || '';
        speakEnglish(enMeaning, () => {
          if (!isReviewActiveRef.current || isReviewPausedRef.current) return;
          if (reviewIndexRef.current !== idx) return;

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

            playReviewCard(idx + 1);
          }, durationNext);
        });
      }, durationEn);
    });
  }, [clearReviewTimers, speakGerman, speakEnglish, onUpdateReviewPosition]);

  const handleReviewRemoveCurrent = useCallback(() => {
    const currentList = reviewListRef.current;
    const idx = reviewIndexRef.current;
    if (!currentList || idx >= currentList.length) return;

    const card = currentList[idx];
    const wordStr = card.word;

    if (onToggleMyList) {
      onToggleMyList(card);
    }

    clearReviewTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    if (reviewToastTimeoutRef.current) clearTimeout(reviewToastTimeoutRef.current);
    setReviewToast(`🗑️ Removed "${wordStr}" from My List!`);
    reviewToastTimeoutRef.current = setTimeout(() => setReviewToast(null), 3000);

    const nextList = currentList.filter((_, i) => i !== idx);
    setReviewList(nextList);
    reviewListRef.current = nextList;

    if (nextList.length === 0) {
      setReviewPhase('finished');
      setReviewIndex(0);
      reviewIndexRef.current = 0;
      setSavedReviewIndex(0);
      try {
        localStorage.setItem('b1_mylist_review_last_index', '0');
        localStorage.setItem('b1_mylist_review_last_updated', String(Date.now()));
        localStorage.setItem('b1_mylist_review_last_word', '');
      } catch (e) {}
      if (onUpdateReviewPosition) {
        onUpdateReviewPosition(0, '');
      }
      return;
    }

    const nextIdx = Math.min(idx, nextList.length - 1);
    setReviewIndex(nextIdx);
    reviewIndexRef.current = nextIdx;
    setSavedReviewIndex(nextIdx);
    try {
      localStorage.setItem('b1_mylist_review_last_index', String(nextIdx));
      localStorage.setItem('b1_mylist_review_last_updated', String(Date.now()));
      if (nextList[nextIdx] && nextList[nextIdx].word) {
        localStorage.setItem('b1_mylist_review_last_word', nextList[nextIdx].word);
      }
    } catch (e) {}
    if (onUpdateReviewPosition) {
      onUpdateReviewPosition(nextIdx, nextList[nextIdx]?.word);
    }

    reviewTimerRef.current = setTimeout(() => {
      playReviewCard(nextIdx, nextList);
    }, 600);
  }, [onToggleMyList, clearReviewTimers, playReviewCard, onUpdateReviewPosition]);

  const handleStartReviewList = useCallback((startIndexOverride) => {
    if (!myList || myList.length === 0) return;

    const cards = [...myList];
    let startingIdx = 0;
    if (typeof startIndexOverride === 'number' && startIndexOverride >= 0 && startIndexOverride < cards.length) {
      startingIdx = startIndexOverride;
    } else {
      try {
        const savedWord = localStorage.getItem('b1_mylist_review_last_word');
        const savedIndexRaw = localStorage.getItem('b1_mylist_review_last_index');
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
  }, [myList, clearReviewTimers, isVoiceActive, isKeepAwake, playReviewCard]);

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

  // Voice Commands & Continuous SpeechRecognition
  const triggerVoiceFeedback = useCallback((cmdName) => {
    if (voiceFeedbackTimeoutRef.current) clearTimeout(voiceFeedbackTimeoutRef.current);
    setVoiceFeedbackMsg(cmdName);
    voiceFeedbackTimeoutRef.current = setTimeout(() => {
      setVoiceFeedbackMsg(null);
    }, 1800);
  }, []);

  const handleVoiceCommand = useCallback((rawText) => {
    if (!rawText || !isReviewActiveRef.current) return false;

    const isTtsSpeaking = isSpeakingRef.current || (Date.now() - lastSpeakingEndTimeRef.current < 400);
    if (isTtsSpeaking) return false;

    const text = rawText.toLowerCase().trim();
    const timeSinceLastCommand = Date.now() - lastExecutedCommandTimeRef.current;

    if (/\b(delete|remove|entfernen|löschen)\b/i.test(text)) {
      if (timeSinceLastCommand < 800) return false;
      lastExecutedCommandTimeRef.current = Date.now();
      triggerVoiceFeedback('Remove [🗑️]');
      handleReviewRemoveCurrent();
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
  }, [triggerVoiceFeedback, handleReviewRemoveCurrent, handleReviewNext, handleReviewRepeat, handleToggleReviewPause]);

  const handleVoiceCommandRef = useRef(handleVoiceCommand);
  useEffect(() => {
    handleVoiceCommandRef.current = handleVoiceCommand;
  }, [handleVoiceCommand]);

  useEffect(() => {
    if (!SpeechRecognition) return;

    if (!isVoiceActive || !isReviewActive) {
      isStoppingManuallyRef.current = true;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
        recognitionRef.current = null;
      }
      return;
    }

    isStoppingManuallyRef.current = false;
    let recognition = null;

    const startRecognition = () => {
      if (isStoppingManuallyRef.current || !isMountedRef.current) return;
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
          if (isSpeakingRef.current || Date.now() - lastSpeakingEndTimeRef.current < 400) {
            return;
          }

          if (event.resultIndex === 0 || event.resultIndex <= lastProcessedResultIndexRef.current) {
            lastProcessedResultIndexRef.current = -1;
          }

          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (i <= lastProcessedResultIndexRef.current) continue;

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
          if ((event.error === 'not-allowed' || event.error === 'service-not-allowed') && !hasEverStartedSuccessfullyRef.current) {
            isStoppingManuallyRef.current = true;
            setIsVoiceActive(false);
            alert('Microphone permission was denied. Please allow microphone access to use Voice Control.');
          }
        };

        recognition.onend = () => {
          if (isStoppingManuallyRef.current || !isMountedRef.current) return;
          if (isSpeakingRef.current) return;

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
        try { recognitionRef.current.abort(); } catch (e) {}
      }
      recognitionRef.current = null;
    };
  }, [isVoiceActive, isReviewActive]);

  // Desktop Keyboard Shortcuts during Review List
  useEffect(() => {
    if (!isReviewActive) return;

    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

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
      } else if (e.code === 'KeyD' || e.key === 'd' || e.key === 'D' || e.code === 'Delete' || e.code === 'Backspace' || e.code === 'Enter') {
        e.preventDefault();
        handleReviewRemoveCurrent();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        handleExitReview();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReviewActive, handleToggleReviewPause, handleReviewNext, handleReviewPrev, handleReviewRepeat, handleReviewRemoveCurrent, handleExitReview]);

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

  const exportBackup = async () => {
    if (!myList || myList.length === 0) {
      alert("Your list is empty! Add or star some words first.");
      return;
    }
    await exportBackupFile('my_list_backup.json', myList);
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

    onToggleMyList(customItem, true);

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
                title={isVoiceActive ? "Voice control active. Say 'Remove' to remove the word hands-free!" : "Click to enable voice control"}
              >
                <span>{isVoiceActive ? '🎙️ Voice: ON' : '🎙️ Voice: OFF'}</span>
                {isVoiceActive && (
                  <span style={{ fontSize: '10.5px', color: '#6ee7b7' }}>(Say "Remove")</span>
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

        {/* Remove Toast */}
        {reviewToast && (
          <div style={{
            padding: '10px 16px',
            borderRadius: '10px',
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.55)',
            color: '#fca5a5',
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
              You have reviewed all words in your My List for this session. Any words you removed are no longer in My List.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => handleStartReviewList(0)}
                disabled={!myList || myList.length === 0}
                className="feedback-btn good"
                style={{ width: 'auto', padding: '12px 24px', borderRadius: '10px', fontSize: '13px', opacity: !myList || myList.length === 0 ? 0.45 : 1, cursor: !myList || myList.length === 0 ? 'not-allowed' : 'pointer' }}
              >
                🔁 Start Over from Beginning (#1)
              </button>
              <button
                type="button"
                onClick={handleExitReview}
                className="nav-button"
                style={{ padding: '12px 20px', fontSize: '13px' }}
              >
                ← Return to My List
              </button>
            </div>
          </div>
        ) : (
          /* Active Review Card */
          <div className="glass-card animate-fade-in" style={{ padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>

            {/* Header info: Progress and Category */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: '6px',
                  background: 'rgba(234, 179, 8, 0.15)',
                  color: '#facc15',
                  border: '1px solid rgba(234, 179, 8, 0.35)'
                }}>
                  ⭐ My List
                </span>
                {currentReviewCard.category && (
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {currentReviewCard.category}
                  </span>
                )}
                {currentReviewCard.isCustom && (
                  <span style={{
                    fontSize: '10px',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    padding: '2px 6px',
                    borderRadius: '6px',
                    background: 'rgba(59, 130, 246, 0.15)',
                    color: 'var(--color-verb)',
                    border: '1px solid rgba(59, 130, 246, 0.25)'
                  }}>
                    ✍️ Custom
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-secondary)' }}>
                  Word {reviewIndex + 1} of {reviewList.length}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const input = window.prompt(`Jump to Word # (1 to ${reviewList.length}):`, String(reviewIndex + 1));
                    if (input !== null) {
                      const num = parseInt(input.trim(), 10);
                      if (!isNaN(num) && num >= 1 && num <= reviewList.length) {
                        playReviewCard(num - 1);
                      }
                    }
                  }}
                  style={{
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.4)',
                    color: '#10b981',
                    fontSize: '10.5px',
                    fontWeight: '700',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer'
                  }}
                  title="Jump directly to any word number"
                >
                  🎯 Jump #
                </button>
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

            {/* German Word Display with clickable audio and quick remove buttons */}
            <div style={{ textAlign: 'center', padding: '16px 0 8px 0' }}>
              <div style={{
                fontSize: '32px',
                fontWeight: '800',
                lineHeight: 1.3,
                color: '#fff',
                marginBottom: currentReviewCard.conjugation ? '4px' : '10px'
              }}>
                {currentReviewCard.word}
              </div>
              {currentReviewCard.conjugation && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
                  {currentReviewCard.conjugation}
                </div>
              )}
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
                  onClick={handleReviewRemoveCurrent}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '700',
                    background: 'rgba(239, 68, 68, 0.18)',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    color: '#f87171',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  title="Remove this word from My List"
                >
                  <span>🗑️</span> Remove Word
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

            {/* Example if available */}
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

            {/* Big Prominent Remove Button */}
            <button
              type="button"
              onClick={handleReviewRemoveCurrent}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.25), rgba(185, 28, 28, 0.35))',
                border: '2px solid #ef4444',
                color: '#fff',
                fontSize: '15px',
                fontWeight: '800',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                boxShadow: '0 4px 18px rgba(239, 68, 68, 0.25)',
                transition: 'all 0.15s ease'
              }}
              title="Click or say 'Remove' / 'Delete' to remove this word from My List"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '17px' }}>🗑️</span>
                <span>REMOVE FROM MY LIST</span>
              </div>
              <span style={{ fontSize: '11px', fontWeight: '500', color: 'rgba(255, 255, 255, 0.85)' }}>
                Removes from My List (or say <b>"Remove"</b> / <b>"Delete"</b>)
              </span>
            </button>

            {/* Controls Bar: Prev, Pause/Resume, Remove, Next, Repeat */}
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
                onClick={handleReviewRemoveCurrent}
                style={{
                  padding: '10px 4px',
                  fontSize: '12px',
                  fontWeight: '800',
                  justifyContent: 'center',
                  borderRadius: '10px',
                  background: 'rgba(239, 68, 68, 0.22)',
                  border: '1px solid rgba(239, 68, 68, 0.65)',
                  color: '#f87171',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
                title="Remove this word from My List immediately"
              >
                🗑️ Remove
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
              Shortcuts: <kbd style={{ padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Space</kbd> Pause/Play • <kbd style={{ padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Enter</kbd> Remove • <kbd style={{ padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>Esc</kbd> Exit
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

  return (
    <div className="explorer-layout animate-fade-in" style={{maxWidth: '850px'}}>
      
      {/* Header controls */}
      <div style={{display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '12px', marginBottom: '20px'}}>
        <div style={{fontSize: '12px', color: 'var(--text-secondary)'}}>
          My List ({myList.length} bookmarked & custom words)
        </div>
        
        <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center'}}>
          <button
            type="button"
            onClick={() => handleStartReviewList()}
            disabled={!myList || myList.length === 0}
            style={{
              background: myList && myList.length > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
              border: myList && myList.length > 0 ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid var(--border-color)',
              color: myList && myList.length > 0 ? '#10b981' : 'var(--text-muted)',
              borderRadius: '12px',
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: '700',
              cursor: myList && myList.length > 0 ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
            title={savedReviewIndex > 0 && savedReviewIndex < myList.length ? `Resume review from word #${savedReviewIndex + 1} of ${myList.length}` : `Autoplay and review My List words in order, with voice 'Remove' support`}
          >
            <span>🎧</span> Review List {savedReviewIndex > 0 && savedReviewIndex < myList.length ? `(Resume #${savedReviewIndex + 1})` : `(${myList.length})`}
          </button>

          {/* Backup Sync Actions */}
          <button
            type="button"
            className="nav-button"
            style={{padding: '8px 12px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', fontSize: '12px'}}
            onClick={exportBackup}
            title="Export My List directly into my_list_backup.json"
          >
            📤 Export
          </button>
          
          <button
            type="button"
            className="nav-button"
            style={{padding: '8px 12px', borderRadius: '12px', background: 'rgba(255,255,255,0.05)', fontSize: '12px'}}
            onClick={chooseBackupDirectory}
            title="Connect your local 'german-dashboard' project directory to auto-overwrite backups without asking"
          >
            📁 Set Folder
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
            const cssCategory = item.category === 'nouns' ? 'noun' : (item.category === 'verbs' ? 'verb' : (item.category === 'adjectives' ? 'adjective' : (item.category === 'reflexive' ? 'reflexive' : 'connector')));
            
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
                    🏷️ {item.category === 'reflexive' ? 'reflexive' : item.category.slice(0, -1)}
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
