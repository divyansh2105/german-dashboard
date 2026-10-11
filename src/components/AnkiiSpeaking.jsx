import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

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

export function getWorkplaceExample(card) {
  if (!card || !card.examples || card.examples.length === 0) return null;
  // Look for workplace/office/business related example first
  const workplaceRegex = /\b(arbeit|beruf|büro|kolleg|chef|firma|termin|kunde|projekt|geschäft|vertrag|meeting|abteilung|stelle|gehalt|bewerb|team|aufgabe|kollegin|kollegen|mitarbeiter|vorgesetzt|pause|feierabend|büroalltag|arbeitsplatz)\b/i;
  const match = card.examples.find(ex => workplaceRegex.test(ex.de) || (ex.en && workplaceRegex.test(ex.en)));
  return match || card.examples[0];
}

export default function AnkiiSpeaking({ vocabData, onReview }) {
  // Pre-session filter state
  const [priorityFilters, setPriorityFilters] = useState([1, 2, 3]); // High (1), Med (2), Low (3)
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [queueLimit, setQueueLimit] = useState('all');

  // Session lifecycle state
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [queue, setQueue] = useState([]);
  const [initialQueueCount, setInitialQueueCount] = useState(0);
  const [masteredCount, setMasteredCount] = useState(0);
  const [totalActions, setTotalActions] = useState(0);
  const [cycledCount, setCycledCount] = useState(0);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Active card display & audio state
  // revealedState: 'none' | 'english' | 'context'
  const [revealedState, setRevealedState] = useState('none');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingPhase, setSpeakingPhase] = useState(null); // 'de' | 'en' | 'example'
  const [autoAdvanceSeconds, setAutoAdvanceSeconds] = useState(null);
  const [touchFeedback, setTouchFeedback] = useState(null); // 'mastered' | 'english' | 'context' | null

  // Mobile drag physics
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const touchStartRef = useRef(null);
  const isDraggingRef = useRef(false);

  // Refs for audio and timers to avoid memory leaks
  const autoAdvanceTimerRef = useRef(null);
  const autoAdvanceIntervalRef = useRef(null);
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

  const clearAdvanceTimers = () => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
    if (autoAdvanceIntervalRef.current) {
      clearInterval(autoAdvanceIntervalRef.current);
      autoAdvanceIntervalRef.current = null;
    }
    if (audioEndTimeoutRef.current) {
      clearTimeout(audioEndTimeoutRef.current);
      audioEndTimeoutRef.current = null;
    }
    setAutoAdvanceSeconds(null);
  };

  // Compile all available words from vocabData
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

    // Filter by selected priorities
    return pool.filter(item => {
      const p = item.priority || 1;
      return priorityFilters.includes(p);
    });
  }, [vocabData, selectedCategory, priorityFilters]);

  // Priority count breakdown for the setup screen
  const priorityCounts = useMemo(() => {
    let all = [];
    Object.keys(vocabData).forEach(cat => {
      const items = vocabData[cat] || [];
      items.forEach(item => all.push(item));
    });

    const high = all.filter(item => (item.priority || 1) === 1).length;
    const med = all.filter(item => item.priority === 2).length;
    const low = all.filter(item => item.priority === 3).length;

    return { high, med, low, total: all.length };
  }, [vocabData]);

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
  // Audio Speech Helpers
  // ----------------------------------------------------

  const speakGerman = useCallback((text, onEnd) => {
    if (!('speechSynthesis' in window) || !text) {
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';

    const voices = window.speechSynthesis.getVoices();
    const deVoice = voices.find(v => v.lang.startsWith('de-DE') || v.lang.startsWith('de_DE')) ||
                    voices.find(v => v.lang.startsWith('de'));
    if (deVoice) utterance.voice = deVoice;
    utterance.rate = 1.0;

    setIsSpeaking(true);
    setSpeakingPhase('de');

    utterance.onend = () => {
      if (!isMountedRef.current) return;
      setIsSpeaking(false);
      setSpeakingPhase(null);
      if (onEnd) onEnd();
    };

    utterance.onerror = () => {
      if (!isMountedRef.current) return;
      setIsSpeaking(false);
      setSpeakingPhase(null);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const speakEnglish = useCallback((text, onEnd) => {
    if (!('speechSynthesis' in window) || !text) {
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';

    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en_US')) ||
                    voices.find(v => v.lang.startsWith('en'));
    if (enVoice) utterance.voice = enVoice;
    utterance.rate = 1.0;

    setIsSpeaking(true);
    setSpeakingPhase('en');

    utterance.onend = () => {
      if (!isMountedRef.current) return;
      setIsSpeaking(false);
      setSpeakingPhase(null);
      if (onEnd) onEnd();
    };

    utterance.onerror = () => {
      if (!isMountedRef.current) return;
      setIsSpeaking(false);
      setSpeakingPhase(null);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  // Sequential speech: English meaning -> pause -> German workplace example sentence
  const speakSequentialContext = useCallback((enText, deSentence, onEnd) => {
    if (!('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();

    const voices = window.speechSynthesis.getVoices();
    const enVoice = voices.find(v => v.lang.startsWith('en-US') || v.lang.startsWith('en_US')) ||
                    voices.find(v => v.lang.startsWith('en'));
    const deVoice = voices.find(v => v.lang.startsWith('de-DE') || v.lang.startsWith('de_DE')) ||
                    voices.find(v => v.lang.startsWith('de'));

    setIsSpeaking(true);
    setSpeakingPhase('en');

    const utterEn = new SpeechSynthesisUtterance(enText);
    utterEn.lang = 'en-US';
    if (enVoice) utterEn.voice = enVoice;
    utterEn.rate = 1.0;

    utterEn.onend = () => {
      if (!isMountedRef.current) return;
      setSpeakingPhase('example');
      // Short breath pause between languages
      audioEndTimeoutRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        const utterDe = new SpeechSynthesisUtterance(deSentence);
        utterDe.lang = 'de-DE';
        if (deVoice) utterDe.voice = deVoice;
        utterDe.rate = 1.0;

        utterDe.onend = () => {
          if (!isMountedRef.current) return;
          setIsSpeaking(false);
          setSpeakingPhase(null);
          if (onEnd) onEnd();
        };

        utterDe.onerror = () => {
          if (!isMountedRef.current) return;
          setIsSpeaking(false);
          setSpeakingPhase(null);
          if (onEnd) onEnd();
        };

        window.speechSynthesis.speak(utterDe);
      }, 320);
    };

    utterEn.onerror = () => {
      if (!isMountedRef.current) return;
      setIsSpeaking(false);
      setSpeakingPhase(null);
      if (onEnd) onEnd();
    };

    window.speechSynthesis.speak(utterEn);
  }, []);

  // Replay German word (tap on card)
  const replayGerman = useCallback(() => {
    if (!queue || queue.length === 0) return;
    const current = queue[0];
    const deWord = getAudioGermanWord(current.word);
    speakGerman(deWord);
  }, [queue, speakGerman]);

  // ----------------------------------------------------
  // Session Queue Initiation & Audio Unlock
  // ----------------------------------------------------

  const handleStartSession = () => {
    // 1. Mobile Audio Context & Speech Synthesis Unlock
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      // Speak a blank dummy utterance within user gesture context to prime iOS / Android
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

    // 2. Prepare queue
    let initialList = shuffleArray(allFilteredPool);
    if (queueLimit !== 'all') {
      const limit = parseInt(queueLimit, 10);
      initialList = initialList.slice(0, limit);
    }

    if (initialList.length === 0) return;

    setQueue(initialList);
    setInitialQueueCount(initialList.length);
    setMasteredCount(0);
    setTotalActions(0);
    setCycledCount(0);
    setSessionStartTime(Date.now());
    setElapsedTime(0);
    setRevealedState('none');
    setSessionFinished(false);
    setSessionActive(true);

    // 3. Immediately play first card's German audio
    const firstWord = getAudioGermanWord(initialList[0].word);
    setTimeout(() => {
      speakGerman(firstWord);
    }, 100);
  };

  // Helper to start auto-advance countdown
  const triggerAutoAdvance = useCallback((seconds = 2) => {
    clearAdvanceTimers();
    let remaining = seconds;
    setAutoAdvanceSeconds(remaining);

    autoAdvanceIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(autoAdvanceIntervalRef.current);
        autoAdvanceIntervalRef.current = null;
      }
      setAutoAdvanceSeconds(remaining > 0 ? remaining : null);
    }, 1000);

    autoAdvanceTimerRef.current = setTimeout(() => {
      handleAdvanceNext();
    }, seconds * 1000);
  }, []);

  // ----------------------------------------------------
  // Action 1: Mastered / Known (Instant Recall)
  // [Space] or Swipe Right or "Know It" Button
  // ----------------------------------------------------
  const handleMastered = useCallback(() => {
    if (!queue || queue.length === 0) return;
    clearAdvanceTimers();

    const currentCard = queue[0];
    setTotalActions(prev => prev + 1);
    setMasteredCount(prev => prev + 1);

    if (onReview) {
      onReview(currentCard.word, currentCard.category, 'easy');
    }

    const nextQueue = queue.slice(1);
    setQueue(nextQueue);
    setRevealedState('none');

    if (nextQueue.length === 0) {
      // Session finished!
      setSessionFinished(true);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      // Immediately play German audio of next card
      const nextWord = getAudioGermanWord(nextQueue[0].word);
      speakGerman(nextWord);
    }
  }, [queue, onReview, speakGerman]);

  // ----------------------------------------------------
  // Action 2: Forgot Word (English Meaning Only)
  // [N] or Swipe Left or "English" Button
  // ----------------------------------------------------
  const handleForgotEnglish = useCallback(() => {
    if (!queue || queue.length === 0) return;
    clearAdvanceTimers();

    const currentCard = queue[0];
    setTotalActions(prev => prev + 1);

    if (onReview) {
      onReview(currentCard.word, currentCard.category, 'hard');
    }

    // Only re-insert once per card appearance
    if (revealedState === 'none') {
      setCycledCount(prev => prev + 1);
      // Re-insert randomly 3 to 5 positions ahead
      const offset = Math.floor(Math.random() * 3) + 3; // 3, 4, or 5
      const updatedQueue = [...queue];
      const [card] = updatedQueue.splice(0, 1);
      const insertIndex = Math.min(updatedQueue.length, offset);
      updatedQueue.splice(insertIndex, 0, card);
      // Keep card active at index 0 for current display until advanced
      setQueue([card, ...updatedQueue.slice(1)]);
    }

    setRevealedState('english');

    // Read English translation aloud via TTS
    speakEnglish(currentCard.meaning, () => {
      // Optional subtle auto-advance after TTS
      triggerAutoAdvance(2);
    });
  }, [queue, revealedState, onReview, speakEnglish, triggerAutoAdvance]);

  // ----------------------------------------------------
  // Action 3: More Context (English + Workplace Example)
  // [M] or Swipe Up or "Context" Button
  // ----------------------------------------------------
  const handleMoreContext = useCallback(() => {
    if (!queue || queue.length === 0) return;
    clearAdvanceTimers();

    const currentCard = queue[0];
    setTotalActions(prev => prev + 1);

    if (onReview) {
      onReview(currentCard.word, currentCard.category, 'hard');
    }

    const wpExample = getWorkplaceExample(currentCard);

    // Only re-insert once per card appearance
    if (revealedState !== 'context') {
      setCycledCount(prev => prev + 1);
      // Re-insert 8 to 10 positions ahead
      const offset = Math.floor(Math.random() * 3) + 8; // 8, 9, or 10
      const updatedQueue = [...queue];
      const [card] = updatedQueue.splice(0, 1);
      const insertIndex = Math.min(updatedQueue.length, offset);
      updatedQueue.splice(insertIndex, 0, card);
      setQueue([card, ...updatedQueue.slice(1)]);
    }

    setRevealedState('context');

    const exampleDe = wpExample ? wpExample.de : '';
    // Sequentially read English translation followed by 1 German workplace example
    speakSequentialContext(currentCard.meaning, exampleDe, () => {
      // Subtle auto-advance after sequential playback finishes
      triggerAutoAdvance(3);
    });
  }, [queue, revealedState, onReview, speakSequentialContext, triggerAutoAdvance]);

  // Advance to next card manually
  const handleAdvanceNext = useCallback(() => {
    if (!queue || queue.length === 0) return;
    clearAdvanceTimers();

    const nextQueue = queue.slice(1);
    setQueue(nextQueue);
    setRevealedState('none');

    if (nextQueue.length === 0) {
      setSessionFinished(true);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } else {
      const nextWord = getAudioGermanWord(nextQueue[0].word);
      speakGerman(nextWord);
    }
  }, [queue, speakGerman]);

  // ----------------------------------------------------
  // Desktop Keyboard Shortcuts
  // ----------------------------------------------------
  useEffect(() => {
    if (!sessionActive || sessionFinished) return;

    const handleKeyDown = (e) => {
      // Ignore if user is inside an input/textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (revealedState === 'none') {
          handleMastered(); // Instant Recall (Mastered)
        } else {
          handleAdvanceNext(); // Advance after seeing translation
        }
      } else if (e.code === 'KeyN' || e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        handleForgotEnglish();
      } else if (e.code === 'KeyM' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleMoreContext();
      } else if (e.code === 'KeyR' || e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        replayGerman();
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
  }, [sessionActive, sessionFinished, revealedState, handleMastered, handleForgotEnglish, handleMoreContext, handleAdvanceNext, replayGerman]);

  // ----------------------------------------------------
  // Mobile Touch Gestures & Swipe Physics
  // ----------------------------------------------------
  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    };
    isDraggingRef.current = true;
    setTouchFeedback(null);
  };

  const handleTouchMove = (e) => {
    if (!isDraggingRef.current || !touchStartRef.current) return;
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX - touchStartRef.current.x;
    const diffY = currentY - touchStartRef.current.y;

    // Apply drag damping
    setDragOffset({ x: diffX * 0.7, y: diffY * 0.7 });

    // Show dynamic swipe direction indicator
    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 40) setTouchFeedback('mastered');
      else if (diffX < -40) setTouchFeedback('english');
      else setTouchFeedback(null);
    } else {
      if (diffY < -40) setTouchFeedback('context');
      else setTouchFeedback(null);
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchStartRef.current) return;
    const touchEnd = e.changedTouches[0];
    const diffX = touchEnd.clientX - touchStartRef.current.x;
    const diffY = touchEnd.clientY - touchStartRef.current.y;
    const duration = Date.now() - touchStartRef.current.time;

    isDraggingRef.current = false;
    setDragOffset({ x: 0, y: 0 });
    setTouchFeedback(null);

    const SWIPE_THRESHOLD = 50;

    // 1. Minimal movement = Tap -> Replay German word
    if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15 && duration < 350) {
      replayGerman();
      return;
    }

    // 2. Horizontal Swipes
    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > SWIPE_THRESHOLD) {
        // Swipe Right -> Know It / Mastered
        if (revealedState === 'none') {
          handleMastered();
        } else {
          handleAdvanceNext();
        }
      } else if (diffX < -SWIPE_THRESHOLD) {
        // Swipe Left -> Forgot (English)
        handleForgotEnglish();
      }
    } else {
      // 3. Vertical Swipes
      if (diffY < -SWIPE_THRESHOLD) {
        // Swipe Up -> More Context
        handleMoreContext();
      }
    }

    touchStartRef.current = null;
  };

  // Card click handler on desktop
  const handleCardClick = (e) => {
    if (e.target.closest('button')) return;
    replayGerman();
  };

  const currentCard = queue[0];
  const wpExample = useMemo(() => getWorkplaceExample(currentCard), [currentCard]);

  // Format elapsed time string
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // ----------------------------------------------------
  // VIEW: 1. Pre-Session Setup & Filters
  // ----------------------------------------------------
  if (!sessionActive || !currentCard) {
    if (sessionFinished) {
      return (
        <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '680px', margin: '20px auto', padding: '0 16px' }}>
          <div className="glass-card" style={{ padding: '48px 24px', textAlign: 'center', width: '100%', position: 'relative' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>
              Speaking Session Completed!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '420px', margin: '0 auto 28px' }}>
              All {initialQueueCount} cards in this queue have been cleanly mastered via active audio recall.
            </p>

            {/* Performance Stats Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
              maxWidth: '520px',
              margin: '0 auto 32px'
            }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 12px', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Mastered</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-noun)', marginTop: '4px' }}>{masteredCount}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 12px', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Cycles / Misses</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-adj)', marginTop: '4px' }}>{cycledCount}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 12px', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Total Triage</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-verb)', marginTop: '4px' }}>{totalActions}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '16px 12px', borderRadius: '14px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Duration</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#fff', marginTop: '4px' }}>{formatTime(elapsedTime)}</div>
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
                ⚙️ Adjust Filters & Practice Again
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
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(139, 92, 246, 0.12)', border: '1px solid rgba(139, 92, 246, 0.25)', padding: '6px 14px', borderRadius: '20px', marginBottom: '12px' }}>
              <span style={{ fontSize: '14px' }}>🗣️</span>
              <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--color-conn)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                Zero-Friction Audio Triage
              </span>
            </div>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#fff', letterSpacing: '-0.5px', margin: '4px 0' }}>
              Ankii Speaking
            </h2>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', maxWidth: '440px', margin: '8px auto 0', lineHeight: '1.5' }}>
              Audio-first flashcards. Words play immediately via German TTS. Swipe or press keys to triage cards instantly until mastered.
            </p>
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
                { id: 'all', label: '🌐 All Classes' },
                { id: 'nouns', label: '🟢 Nouns' },
                { id: 'verbs', label: '🔵 Verbs' },
                { id: 'adjectives', label: '🟡 Adjectives' },
                { id: 'connectors', label: '#️⃣ Connectors' }
              ].map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`option-pill ${selectedCategory === cat.id ? 'active' : ''}`}
                  style={{ padding: '6px 14px', fontSize: '12px' }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 3. Session Batch Size */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              3. Session Size:
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: `All Matching (${allFilteredPool.length})` },
                { id: '25', label: '⚡ 25 Cards' },
                { id: '50', label: '🎯 50 Cards' },
                { id: '100', label: '🔥 100 Cards' }
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

          {/* Control Scheme Overview Card */}
          <div style={{
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid var(--border-color)',
            borderRadius: '16px',
            padding: '16px',
            marginBottom: '28px'
          }}>
            <div style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--color-verb)', marginBottom: '10px' }}>
              🎮 Dual Control Scheme (Zero Grading Friction):
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '16px', lineHeight: 1 }}>✨</span>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#22c55e' }}>Mastered / Know It</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Desktop: <code>[Space]</code> • Mobile: <b>Swipe Right</b>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '16px', lineHeight: 1 }}>🇬🇧</span>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#f59e0b' }}>Forgot (English)</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Desktop: <code>[N]</code> • Mobile: <b>Swipe Left</b>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '16px', lineHeight: 1 }}>🏢</span>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#3b82f6' }}>More Context</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Desktop: <code>[M]</code> • Mobile: <b>Swipe Up</b>
                  </div>
                </div>
              </div>
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
              Start Session ({queueLimit === 'all' ? allFilteredPool.length : Math.min(allFilteredPool.length, parseInt(queueLimit, 10))} Cards)
            </span>
          </button>
          
          <div style={{ textAlign: 'center', marginTop: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
            💡 Unlocks mobile audio context automatically. German word will play immediately.
          </div>

        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW: 2. Active Audio-First Card Session
  // ----------------------------------------------------
  const progressPercent = initialQueueCount > 0 
    ? Math.min(100, Math.round((masteredCount / initialQueueCount) * 100)) 
    : 0;

  return (
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '640px', margin: '16px auto', padding: '0 16px' }}>
      
      {/* Top Header & Progress */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Remaining & Mastered badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)' }}>
              Card 1 of {queue.length}
            </span>
            <span style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: 'var(--color-noun)',
              fontWeight: '700'
            }}>
              ✓ {masteredCount} Mastered
            </span>
            {cycledCount > 0 && (
              <span style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.15)',
                color: 'var(--color-adj)',
                fontWeight: '700'
              }}>
                ↻ {cycledCount} Cycling
              </span>
            )}
          </div>

          {/* Quick Actions (Exit / Sound Replay) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={replayGerman}
              title="Replay German Audio [R]"
              style={{
                background: isSpeaking ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255,255,255,0.06)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: isSpeaking ? 'var(--color-verb)' : 'var(--text-primary)',
                padding: '5px 10px',
                fontSize: '12px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontWeight: '600'
              }}
            >
              <span style={{ fontSize: '14px' }}>🔊</span>
              <span>Replay</span>
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

        {/* Progress Bar */}
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
            background: 'linear-gradient(90deg, var(--color-noun), var(--color-verb))',
            borderRadius: '3px',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Swipe Feedback Badge (Mobile Drag) */}
      <div style={{
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'opacity 0.15s ease',
        opacity: touchFeedback ? 1 : 0
      }}>
        {touchFeedback === 'mastered' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#22c55e', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👉 Release to Master [Know It]
          </span>
        )}
        {touchFeedback === 'english' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👈 Release for English Meaning
          </span>
        )}
        {touchFeedback === 'context' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👆 Release for Context & Workplace Example
          </span>
        )}
      </div>

      {/* MAIN AUDIO-FIRST FLASHCARD */}
      <div
        className={`glass-card ankii-speaking-card ${currentCard.category || 'nouns'}`}
        onClick={handleCardClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
          transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${dragOffset.x * 0.05}deg)`,
          transition: isDraggingRef.current ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.2s ease',
          borderColor: touchFeedback === 'mastered' ? 'rgba(34, 197, 94, 0.8)' :
                       touchFeedback === 'english' ? 'rgba(245, 158, 11, 0.8)' :
                       touchFeedback === 'context' ? 'rgba(59, 130, 246, 0.8)' :
                       isSpeaking ? 'rgba(139, 92, 246, 0.7)' : 'rgba(255, 255, 255, 0.12)',
          boxShadow: isSpeaking 
            ? '0 12px 40px rgba(139, 92, 246, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.2)' 
            : 'var(--shadow-premium), var(--shadow-inset)'
        }}
      >
        {/* Top Card Badges */}
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

        {/* Audio Speaking Wave Badge */}
        <div style={{ position: 'absolute', top: '18px', right: '20px' }}>
          <button
            type="button"
            className="sound-btn"
            onClick={(e) => {
              e.stopPropagation();
              replayGerman();
            }}
            title="Tap to replay German pronunciation"
            style={{
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
            German Word
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

          {/* AUDIO PROMPT HINT */}
          {revealedState === 'none' && (
            <div style={{
              marginTop: '20px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}>
              <span>👆</span>
              <span>Tap anywhere to replay audio</span>
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

        {/* Bottom Card Footer: Shortcut Cheatsheet or Countdown */}
        <div style={{ width: '100%', marginTop: 'auto', paddingTop: '12px' }}>
          {autoAdvanceSeconds !== null ? (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              color: 'var(--color-noun)',
              fontWeight: '700',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '4px 12px',
              borderRadius: '20px'
            }}>
              <span>⏱️ Advancing in {autoAdvanceSeconds}s</span>
              <span style={{ color: 'var(--text-secondary)', fontWeight: '400' }}>(or press Space / tap Next)</span>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              Desktop: <code>[Space]</code> Know It • <code>[N]</code> English • <code>[M]</code> Context
            </div>
          )}
        </div>
      </div>

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
            <span>Next Card</span>
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
