import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { exportBackupFile, chooseBackupDirectory } from '../utils/backupStorage';
import { wakeLockManager } from '../utils/wakeLockManager';

// Irregular English verbs map: base -> [simple past, past participle]
const ENGLISH_IRREGULARS = {
  arise: ['arose', 'arisen'], awake: ['awoke', 'awoken'], be: ['was/were', 'been'],
  bear: ['bore', 'borne'], beat: ['beat', 'beaten'], become: ['became', 'become'],
  begin: ['began', 'begun'], bend: ['bent', 'bent'], bet: ['bet', 'bet'],
  bind: ['bound', 'bound'], bite: ['bit', 'bitten'], bleed: ['bled', 'bled'],
  blow: ['blew', 'blown'], break: ['broke', 'broken'], breed: ['bred', 'bred'],
  bring: ['brought', 'brought'], build: ['built', 'built'], burn: ['burned', 'burned'],
  burst: ['burst', 'burst'], buy: ['bought', 'bought'], cast: ['cast', 'cast'],
  catch: ['caught', 'caught'], choose: ['chose', 'chosen'], cling: ['clung', 'clung'],
  come: ['came', 'come'], cost: ['cost', 'cost'], creep: ['crept', 'crept'],
  cut: ['cut', 'cut'], deal: ['dealt', 'dealt'], dig: ['dug', 'dug'],
  do: ['did', 'done'], draw: ['drew', 'drawn'], dream: ['dreamed', 'dreamed'],
  drink: ['drank', 'drunk'], drive: ['drove', 'driven'], eat: ['ate', 'eaten'],
  fall: ['fell', 'fallen'], feed: ['fed', 'fed'], feel: ['felt', 'felt'],
  fight: ['fought', 'fought'], find: ['found', 'found'], flee: ['fled', 'fled'],
  fly: ['flew', 'flown'], forbid: ['forbade', 'forbidden'], forget: ['forgot', 'forgotten'],
  forgive: ['forgave', 'forgiven'], freeze: ['froze', 'frozen'], get: ['got', 'gotten'],
  give: ['gave', 'given'], go: ['went', 'gone'], grow: ['grew', 'grown'],
  hang: ['hung', 'hung'], have: ['had', 'had'], hear: ['heard', 'heard'],
  hide: ['hid', 'hidden'], hit: ['hit', 'hit'], hold: ['held', 'held'],
  hurt: ['hurt', 'hurt'], keep: ['kept', 'kept'], know: ['knew', 'known'],
  lay: ['laid', 'laid'], lead: ['led', 'led'], lean: ['leaned', 'leaned'],
  leap: ['leapt', 'leapt'], learn: ['learned', 'learned'], leave: ['left', 'left'],
  lend: ['lent', 'lent'], let: ['let', 'let'], lie: ['lay', 'lain'],
  light: ['lit', 'lit'], lose: ['lost', 'lost'], make: ['made', 'made'],
  mean: ['meant', 'meant'], meet: ['met', 'met'], pay: ['paid', 'paid'],
  put: ['put', 'put'], read: ['read', 'read'], ride: ['rode', 'ridden'],
  ring: ['rang', 'rung'], rise: ['rose', 'risen'], run: ['ran', 'run'],
  say: ['said', 'said'], see: ['saw', 'seen'], seek: ['sought', 'sought'],
  sell: ['sold', 'sold'], send: ['sent', 'sent'], set: ['set', 'set'],
  sew: ['sewed', 'sewn'], shake: ['shook', 'shaken'], shine: ['shone', 'shone'],
  shoot: ['shot', 'shot'], show: ['showed', 'shown'], shrink: ['shrank', 'shrunk'],
  shut: ['shut', 'shut'], sing: ['sang', 'sung'], sink: ['sank', 'sunk'],
  sit: ['sat', 'sat'], sleep: ['slept', 'slept'], slide: ['slid', 'slid'],
  speak: ['spoke', 'spoken'], spend: ['spent', 'spent'], spill: ['spilled', 'spilled'],
  spin: ['spun', 'spun'], spit: ['spat', 'spat'], split: ['split', 'split'],
  spread: ['spread', 'spread'], spring: ['sprang', 'sprung'], stand: ['stood', 'stood'],
  steal: ['stole', 'stolen'], stick: ['stuck', 'stuck'], sting: ['stung', 'stung'],
  stink: ['stank', 'stunk'], strike: ['struck', 'struck'], swear: ['swore', 'sworn'],
  sweep: ['swept', 'swept'], swim: ['swam', 'swum'], swing: ['swung', 'swung'],
  take: ['took', 'taken'], teach: ['taught', 'taught'], tear: ['tore', 'torn'],
  tell: ['told', 'told'], think: ['thought', 'thought'], throw: ['threw', 'thrown'],
  understand: ['understood', 'understood'], undertake: ['undertook', 'undertaken'],
  upset: ['upset', 'upset'], wake: ['woke', 'woken'], wear: ['wore', 'worn'],
  win: ['won', 'won'], withdraw: ['withdrew', 'withdrawn'], write: ['wrote', 'written']
};

function getPastForm(verb) {
  const v = (verb || '').toLowerCase().trim();
  if (!v) return ['', ''];
  if (ENGLISH_IRREGULARS[v]) return ENGLISH_IRREGULARS[v];
  if (v.endsWith('e')) return [v + 'd', v + 'd'];
  if (/[^aeiou]y$/.test(v)) return [v.slice(0, -1) + 'ied', v.slice(0, -1) + 'ied'];
  if (/[aeiou][bcdfghjklmnpqrstvwxyz]$/.test(v) && !/[aeiou]{2}[bcdfghjklmnpqrstvwxyz]$/.test(v) && !/[wxy]$/.test(v) && v.length <= 4) {
    const lastChar = v[v.length - 1];
    return [v + lastChar + 'ed', v + lastChar + 'ed'];
  }
  return [v + 'ed', v + 'ed'];
}

function formatEnglishPast(meaning, subject = 'I') {
  if (!meaning) return '';
  let clean = meaning.split(/[,;/]/)[0].trim();
  clean = clean.replace(/^\((to|sich)\)\s*/i, '').replace(/^to\s+/i, '').trim();
  clean = clean.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (!clean) return meaning;
  const words = clean.split(/\s+/);
  const base = words[0].toLowerCase();
  const rest = words.slice(1).join(' ');
  const [past, part] = getPastForm(base);
  const pastFull = rest ? `${past} ${rest}` : past;
  const partFull = rest ? `${part} ${rest}` : part;
  const hasVerb = subject === 'It' ? 'has' : 'have';
  return `${subject} ${pastFull} / ${subject} ${hasVerb} ${partFull}`;
}

export function parseVerbPerfekt(verbItem) {
  if (!verbItem) return null;
  const word = verbItem.word || '';
  const conj = verbItem.conjugation || '';

  // Weather / Impersonal verbs
  if (word === 'regnen') {
    return {
      auxiliary: 'hat',
      subject: 'Es',
      participle: 'geregnet',
      perfektDe: 'Es hat geregnet',
      thirdPersonDe: 'hat geregnet',
      perfektEn: formatEnglishPast(verbItem.meaning || 'rain', 'It'),
      perfektExample: findPerfektExample(verbItem, 'geregnet')
    };
  }
  if (word === 'schneien') {
    return {
      auxiliary: 'hat',
      subject: 'Es',
      participle: 'geschneit',
      perfektDe: 'Es hat geschneit',
      thirdPersonDe: 'hat geschneit',
      perfektEn: formatEnglishPast(verbItem.meaning || 'snow', 'It'),
      perfektExample: findPerfektExample(verbItem, 'geschneit')
    };
  }
  if (word === 'geschieden sein') {
    return {
      auxiliary: 'ist',
      subject: 'Ich',
      participle: 'geschieden gewesen',
      perfektDe: 'Ich bin geschieden gewesen',
      thirdPersonDe: 'ist geschieden gewesen',
      perfektEn: 'I was divorced / I have been divorced',
      perfektExample: findPerfektExample(verbItem, 'geschieden')
    };
  }

  // Regex to extract auxiliary ('hat' or 'ist') and past participle from conjugation
  const m = conj.match(/\b(hat|ist)\s+(?:(sich|mir|uns)\s+)?([a-zäöüß]+(?:ge[a-zäöüß]+|[a-zäöüß]+iert|[a-zäöüß]+t|[a-zäöüß]+en))\b/i)
         || conj.match(/\b(hat|ist)\s+([a-zäöüß]+)\b/i);

  let aux = 'hat';
  let participle = '';
  if (m) {
    aux = m[1].toLowerCase();
    participle = m[3] || m[2];
  } else {
    // Fallback: search for hat or ist
    if (/\bist\b/i.test(conj)) aux = 'ist';
    const tokens = conj.split(/[\s,]+/);
    participle = tokens[tokens.length - 1] || word;
  }

  const isReflexive = word.startsWith('sich') || conj.includes(' sich');
  let perfektDe = '';
  let thirdPersonDe = '';

  if (aux === 'ist') {
    perfektDe = `Ich bin ${participle}`;
    thirdPersonDe = `ist ${participle}`;
  } else if (isReflexive) {
    perfektDe = `Ich habe mich ${participle}`;
    thirdPersonDe = `hat sich ${participle}`;
  } else {
    perfektDe = `Ich habe ${participle}`;
    thirdPersonDe = `hat ${participle}`;
  }

  const perfektEn = formatEnglishPast(verbItem.meaning, 'I');
  const perfektExample = findPerfektExample(verbItem, participle);

  return {
    auxiliary: aux,
    subject: 'Ich',
    participle,
    perfektDe,
    thirdPersonDe,
    perfektEn,
    perfektExample
  };
}

// Only return an example sentence IF it contains the Perfekt auxiliary & participle
function findPerfektExample(verbItem, participle) {
  if (!verbItem || !verbItem.examples || verbItem.examples.length === 0) return null;
  if (!participle) return null;

  const cleanPart = participle.replace(/^[-()]/, '').trim();
  if (!cleanPart) return null;

  const auxRegex = /\b(habe|hast|hat|haben|habt|bin|bist|ist|sind|seid)\b/i;
  const partRegex = new RegExp(`\\b${cleanPart}\\b`, 'i');

  const matching = verbItem.examples.find(ex => ex.de && auxRegex.test(ex.de) && partRegex.test(ex.de));
  return matching || null;
}

export function extractWordForSpelling(rawWord) {
  if (!rawWord) return '';
  let clean = rawWord
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/,.*$/, '')
    .trim();
  clean = clean.replace(/^((der|die|das|dem|den|des)(\s*\/\s*(der|die|das|dem|den|des))?|sich)\s+/i, '').trim();
  return clean;
}

const SpeechRecognition = typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null;

export default function VerbTenses({
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
  // Setup filters: only priority and session size
  const [priorityFilters, setPriorityFilters] = useState([1]);
  const [queueLimit, setQueueLimit] = useState('50');

  // Cloud sync status and manual sync triggers
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);
  const [isEditingSyncCode, setIsEditingSyncCode] = useState(false);
  const [inputSyncCode, setInputSyncCode] = useState(syncCode || '');

  // Screen Keep-Awake state
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
        console.warn('Could not enable wake lock:', err);
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
      alert('Sync code must be at least 3 characters.');
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

  // Persistent Deleted Words
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

  const [showDeletedModal, setShowDeletedModal] = useState(false);

  // 10-Second Undo Toast State
  const [undoToast, setUndoToast] = useState(null);
  const undoIntervalRef = useRef(null);
  const undoTimeoutRef = useRef(null);

  // Session lifecycle state
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [sessionCards, setSessionCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState([]);
  const [sessionStartTime, setSessionStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Active card display & audio state
  // revealedState: 'none' | 'perfekt' | 'context'
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
  const [speakingPhase, setSpeakingPhase] = useState(null);
  const [touchFeedback, setTouchFeedback] = useState(null);

  // Mobile drag physics & touch state
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isGestureMode, setIsGestureMode] = useState(false);
  const [isWiggling, setIsWiggling] = useState(false);
  const touchStartRef = useRef(null);
  const isDraggingRef = useRef(false);
  const longPressTimerRef = useRef(null);
  const isGestureActiveRef = useRef(false);
  const lastTouchEndTimeRef = useRef(0);

  // Voice Instruction State
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [isVoiceReady, setIsVoiceReady] = useState(false);
  const [voiceFeedbackMsg, setVoiceFeedbackMsg] = useState(null);
  const [lastHeardVoice, setLastHeardVoice] = useState('');
  const voiceFeedbackTimeoutRef = useRef(null);
  const recognitionRef = useRef(null);
  const cardAppearedTimeRef = useRef(Date.now());
  const lastExecutedCommandTimeRef = useRef(0);
  const lastProcessedResultIndexRef = useRef(-1);
  const [sessionDeletedCount, setSessionDeletedCount] = useState(0);
  const [spellingDisplay, setSpellingDisplay] = useState(null);

  const [summaryFilter, setSummaryFilter] = useState('all');

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
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      if (voiceFeedbackTimeoutRef.current) clearTimeout(voiceFeedbackTimeoutRef.current);
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) { }
      }
    };
  }, []);

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

  // Compile all available verbs from vocabData.verbs and vocabData.reflexive
  const allVerbsPool = useMemo(() => {
    const rawVerbs = [
      ...(vocabData.verbs || []).map(v => ({ ...v, category: 'verbs' })),
      ...(vocabData.reflexive || []).map(v => ({ ...v, category: 'reflexive' }))
    ];

    // Filter by priority and exclude deleted words
    return rawVerbs.filter(item => {
      const p = item.priority || 1;
      const isPriority = priorityFilters.includes(p);
      const isDeleted = deletedWordsSet.has(item.word.toLowerCase());
      return isPriority && !isDeleted;
    });
  }, [vocabData, priorityFilters, deletedWordsSet]);

  const priorityCounts = useMemo(() => {
    const rawVerbs = [
      ...(vocabData.verbs || []).map(v => ({ ...v, category: 'verbs' })),
      ...(vocabData.reflexive || []).map(v => ({ ...v, category: 'reflexive' }))
    ];
    const nonDeleted = rawVerbs.filter(v => !deletedWordsSet.has(v.word.toLowerCase()));
    return {
      high: nonDeleted.filter(v => (v.priority || 1) === 1).length,
      med: nonDeleted.filter(v => v.priority === 2).length,
      low: nonDeleted.filter(v => v.priority === 3).length,
      total: nonDeleted.length
    };
  }, [vocabData, deletedWordsSet]);

  const togglePriority = (p) => {
    setPriorityFilters(prev => {
      if (prev.includes(p)) {
        if (prev.length === 1) return prev;
        return prev.filter(item => item !== p);
      } else {
        return [...prev, p].sort();
      }
    });
  };

  // Build the session cards enriched with parsed Perfekt details
  const startSession = () => {
    if (allVerbsPool.length === 0) {
      alert('No verbs match your selected priority filters.');
      return;
    }

    // Shuffle verbs
    const shuffled = [...allVerbsPool].sort(() => Math.random() - 0.5);

    const limit = queueLimit === 'all' ? shuffled.length : parseInt(queueLimit, 10);
    const chosen = shuffled.slice(0, limit);

    // Enrich each card with Perfekt form
    const enriched = chosen.map(item => {
      const parsed = parseVerbPerfekt(item);
      return {
        ...item,
        perfektData: parsed
      };
    });

    setSessionCards(enriched);
    setCurrentIndex(0);
    setRevealedState('none');
    setSessionResults([]);
    setElapsedTime(0);
    setSessionDeletedCount(0);
    setSpellingDisplay(null);
    setSessionStartTime(Date.now());
    setSessionFinished(false);
    setSessionActive(true);

    // Play German verb infinitive initially
    const firstWord = enriched[0]?.word || '';
    speakGerman(firstWord);
  };

  const currentCard = sessionCards[currentIndex] || null;
  const isStarred = currentCard && myList.some(m => m.word.toLowerCase() === currentCard.word.toLowerCase());
  const perfektInfo = currentCard ? (currentCard.perfektData || parseVerbPerfekt(currentCard)) : null;

  // Speech synthesis helpers
  const speakGerman = useCallback((text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 0.92;
    utterance.onstart = () => {
      setIsSpeaking(true);
      setSpeakingPhase('de');
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const speakEnglish = useCallback((text) => {
    if (!('speechSynthesis' in window) || !text) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 1.0;
    utterance.onstart = () => {
      setIsSpeaking(true);
      setSpeakingPhase('en');
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const speakSequentialPerfekt = useCallback((perfektDe, englishPast, exampleDe) => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    // 1. Speak German Perfekt
    const deUtterance = new SpeechSynthesisUtterance(perfektDe);
    deUtterance.lang = 'de-DE';
    deUtterance.rate = 0.92;

    deUtterance.onstart = () => {
      setIsSpeaking(true);
      setSpeakingPhase('de');
    };

    deUtterance.onend = () => {
      if (!isMountedRef.current) return;
      if (exampleDe) {
        // Speak example sentence in German
        setTimeout(() => {
          if (!isMountedRef.current) return;
          const exUtterance = new SpeechSynthesisUtterance(exampleDe);
          exUtterance.lang = 'de-DE';
          exUtterance.rate = 0.92;
          exUtterance.onstart = () => {
            setIsSpeaking(true);
            setSpeakingPhase('example');
          };
          exUtterance.onend = () => {
            setIsSpeaking(false);
            setSpeakingPhase(null);
          };
          exUtterance.onerror = () => {
            setIsSpeaking(false);
            setSpeakingPhase(null);
          };
          window.speechSynthesis.speak(exUtterance);
        }, 300);
      } else {
        setIsSpeaking(false);
        setSpeakingPhase(null);
      }
    };

    deUtterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };

    window.speechSynthesis.speak(deUtterance);
  }, []);

  const replayGerman = useCallback(() => {
    if (!currentCard) return;
    if (revealedState !== 'none' && perfektInfo) {
      speakGerman(perfektInfo.perfektDe);
    } else {
      speakGerman(currentCard.word);
    }
  }, [currentCard, revealedState, perfektInfo, speakGerman]);

  const advanceToNextWord = useCallback(() => {
    clearAdvanceTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpellingDisplay(null);

    const nextIdx = currentIndex + 1;
    if (nextIdx >= sessionCards.length) {
      setSessionFinished(true);
    } else {
      setCurrentIndex(nextIdx);
      setRevealedState('none');
      const nextCard = sessionCards[nextIdx];
      speakGerman(nextCard.word);
    }
  }, [currentIndex, sessionCards, speakGerman]);

  // Actions
  const handleMastered = useCallback(() => {
    if (!currentCard) return;
    if (onReview) {
      onReview(currentCard.word, 'verbs', 'easy');
    }
    setSessionResults(prev => [...prev, { card: currentCard, result: 'mastered' }]);
    advanceToNextWord();
  }, [currentCard, onReview, advanceToNextWord]);

  const handleRevealPerfekt = useCallback(() => {
    if (!currentCard || !perfektInfo) return;
    clearAdvanceTimers();
    if (onReview) {
      onReview(currentCard.word, 'verbs', 'good');
    }
    if (revealedState === 'none') {
      setSessionResults(prev => [...prev, { card: currentCard, result: 'english' }]);
    }
    setRevealedState('perfekt');
    speakGerman(perfektInfo.perfektDe);
  }, [currentCard, perfektInfo, revealedState, onReview, speakGerman]);

  const handleMoreContext = useCallback(() => {
    if (!currentCard || !perfektInfo) return;
    clearAdvanceTimers();
    if (onReview) {
      onReview(currentCard.word, 'verbs', 'hard');
    }
    if (revealedState === 'none') {
      setSessionResults(prev => [...prev, { card: currentCard, result: 'context' }]);
    }
    setRevealedState('context');
    const exDe = perfektInfo.perfektExample ? perfektInfo.perfektExample.de : '';
    speakSequentialPerfekt(perfektInfo.perfektDe, perfektInfo.perfektEn, exDe);
  }, [currentCard, perfektInfo, revealedState, onReview, speakSequentialPerfekt]);

  const handleAdvanceNext = useCallback(() => {
    advanceToNextWord();
  }, [advanceToNextWord]);

  const handleToggleStar = useCallback((e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (onToggleMyList && currentCard) {
      onToggleMyList(currentCard);
    }
  }, [onToggleMyList, currentCard]);

  // DELETE VERB (10-Second Undo Timer Toast)
  const handleDeleteWord = useCallback((e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (!currentCard) return;

    const cardToDelete = currentCard;
    const wordKey = cardToDelete.word;

    clearAdvanceTimers();

    if (onDeleteWord) {
      onDeleteWord(wordKey);
    } else {
      setLocalDeletedWords(prev => {
        const updated = prev.includes(wordKey) ? prev : [...prev, wordKey];
        localStorage.setItem('b1_anki_speaking_deleted_words', JSON.stringify(updated));
        return updated;
      });
    }

    cardAppearedTimeRef.current = Date.now();
    lastExecutedCommandTimeRef.current = Date.now();
    setSessionDeletedCount(prev => prev + 1);
    setSpellingDisplay(null);

    const cleanedCards = sessionCards.filter((c, idx) => idx <= currentIndex || c.word.toLowerCase() !== wordKey.toLowerCase());
    setSessionCards(cleanedCards);

    const nextIdx = currentIndex + 1;
    if (nextIdx >= cleanedCards.length) {
      setSessionFinished(true);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } else {
      setCurrentIndex(nextIdx);
      setRevealedState('none');
      const nextWord = cleanedCards[nextIdx].word;
      speakGerman(nextWord);
    }

    // 10-Second Undo Notification
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

  const handleUndoDelete = useCallback(() => {
    if (!undoToast) return;

    const restoredWord = undoToast.word;
    const restoredCard = undoToast.card;

    if (onRestoreWord) {
      onRestoreWord(restoredWord);
    } else {
      setLocalDeletedWords(prev => {
        const updated = prev.filter(w => w.toLowerCase() !== restoredWord.toLowerCase());
        localStorage.setItem('b1_anki_speaking_deleted_words', JSON.stringify(updated));
        return updated;
      });
    }

    if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setUndoToast(null);
    setSessionDeletedCount(prev => Math.max(0, prev - 1));

    if (sessionActive && !sessionFinished) {
      cardAppearedTimeRef.current = Date.now();
      lastExecutedCommandTimeRef.current = Date.now();
      setSessionCards(prev => {
        const next = [...prev];
        next.splice(currentIndex, 0, restoredCard);
        return next;
      });
    }
  }, [undoToast, sessionActive, sessionFinished, currentIndex, onRestoreWord]);

  // English Letter Spelling
  const handleSpellWord = useCallback(() => {
    if (!currentCard) return;
    const cleanWord = extractWordForSpelling(currentCard.word);
    if (!cleanWord) return;

    clearAdvanceTimers();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    const letters = cleanWord.split('');
    const letterDescriptions = letters.map(char => {
      const lower = char.toLowerCase();
      if (lower === 'ä') return 'A Umlaut';
      if (lower === 'ö') return 'O Umlaut';
      if (lower === 'ü') return 'U Umlaut';
      if (lower === 'ß') return 'Eszett';
      if (lower === ' ') return 'space';
      if (lower === '-') return 'hyphen';
      return char.toUpperCase();
    });

    const displayStr = letters.map(c => c.toUpperCase()).join(' - ');
    setSpellingDisplay(displayStr);

    const speechText = letterDescriptions.join('. ');
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;

    utterance.onstart = () => {
      setIsSpeaking(true);
      setSpeakingPhase('spell');
    };
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingPhase(null);
    };

    window.speechSynthesis.speak(utterance);
  }, [currentCard]);

  // ----------------------------------------------------
  // Voice Command Engine (Continuous hands-free)
  // Strictly recognized: More, Next, Translate, Delete, Favorite, Spell/Spelling, Repeat
  // Muted during speech playback
  // ----------------------------------------------------
  const showVoiceFeedback = useCallback((msg) => {
    setVoiceFeedbackMsg(msg);
    if (voiceFeedbackTimeoutRef.current) clearTimeout(voiceFeedbackTimeoutRef.current);
    voiceFeedbackTimeoutRef.current = setTimeout(() => {
      setVoiceFeedbackMsg(null);
    }, 2800);
  }, []);

  const handleVoiceCommand = useCallback((transcript) => {
    if (!transcript) return;
    const lower = transcript.toLowerCase().trim();
    setLastHeardVoice(transcript);

    // Muted while speaking
    if (isSpeakingRef.current || (Date.now() - lastSpeakingEndTimeRef.current < 600)) {
      return;
    }

    if (Date.now() - cardAppearedTimeRef.current < 1200) {
      return;
    }
    if (Date.now() - lastExecutedCommandTimeRef.current < 800) {
      return;
    }

    let command = null;

    if (/\b(delete|remove|erase|löschen)\b/i.test(lower)) {
      command = 'delete';
    } else if (/\b(spell|spelling|buchstabiere)\b/i.test(lower)) {
      command = 'spell';
    } else if (/\b(repeat|again|nochmal|wiederholen)\b/i.test(lower)) {
      command = 'repeat';
    } else if (/\b(favorite|star|stern|favorit)\b/i.test(lower)) {
      command = 'favorite';
    } else if (/\b(more|context|example|beispiel)\b/i.test(lower)) {
      command = 'more';
    } else if (/\b(translate|english|übersetzen|bedeutung|meaning)\b/i.test(lower)) {
      command = 'translate';
    } else if (/\b(next|continue|weiter|nächste|mastered|know)\b/i.test(lower)) {
      command = 'next';
    }

    if (!command) return;

    lastExecutedCommandTimeRef.current = Date.now();

    switch (command) {
      case 'more':
        showVoiceFeedback('🗣️ "More" recognized');
        handleMoreContext();
        break;
      case 'next':
        showVoiceFeedback('🗣️ "Next" recognized');
        if (revealedState === 'none') {
          handleMastered();
        } else {
          handleAdvanceNext();
        }
        break;
      case 'translate':
        showVoiceFeedback('🗣️ "Translate" recognized');
        handleRevealPerfekt();
        break;
      case 'delete':
        showVoiceFeedback('🗣️ "Delete" recognized');
        handleDeleteWord();
        break;
      case 'favorite':
        showVoiceFeedback('🗣️ "Favorite" recognized');
        handleToggleStar();
        break;
      case 'spell':
        showVoiceFeedback('🗣️ "Spell" recognized');
        handleSpellWord();
        break;
      case 'repeat':
        showVoiceFeedback('🗣️ "Repeat" recognized');
        replayGerman();
        break;
      default:
        break;
    }
  }, [revealedState, handleMoreContext, handleMastered, handleAdvanceNext, handleRevealPerfekt, handleDeleteWord, handleToggleStar, handleSpellWord, replayGerman, showVoiceFeedback]);

  useEffect(() => {
    if (!SpeechRecognition) return;

    if (isVoiceActive && sessionActive && !sessionFinished) {
      try {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onresult = (event) => {
          const startIndex = lastProcessedResultIndexRef.current + 1;
          for (let i = startIndex; i < event.results.length; i++) {
            lastProcessedResultIndexRef.current = i;
            if (event.results[i].isFinal) {
              const text = event.results[i][0].transcript;
              handleVoiceCommand(text);
            }
          }
        };

        recognition.onerror = (e) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') {
            console.warn('Voice recognition error:', e.error);
          }
        };

        recognition.onend = () => {
          if (isVoiceActive && isMountedRef.current && sessionActive && !sessionFinished) {
            try {
              recognition.start();
            } catch (err) { }
          }
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err) {
        console.warn('Could not start SpeechRecognition:', err);
      }
    } else {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (err) { }
        recognitionRef.current = null;
      }
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (err) { }
        recognitionRef.current = null;
      }
    };
  }, [isVoiceActive, sessionActive, sessionFinished, handleVoiceCommand]);

  // Desktop keyboard shortcuts
  useEffect(() => {
    if (!sessionActive || sessionFinished) return;

    const handleKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const key = e.key.toLowerCase();

      if (e.code === 'Space') {
        e.preventDefault();
        if (revealedState === 'none') {
          handleRevealPerfekt();
        } else {
          handleAdvanceNext();
        }
      } else if (key === 'n') {
        e.preventDefault();
        if (revealedState === 'none') {
          handleMastered();
        } else {
          handleAdvanceNext();
        }
      } else if (key === 'm') {
        e.preventDefault();
        handleMoreContext();
      } else if (key === 't') {
        e.preventDefault();
        handleRevealPerfekt();
      } else if (key === 'p') {
        e.preventDefault();
        handleSpellWord();
      } else if (key === 'r') {
        e.preventDefault();
        replayGerman();
      } else if (key === 's' || key === 'f') {
        e.preventDefault();
        handleToggleStar();
      } else if (key === 'd' || e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteWord();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionActive, sessionFinished, revealedState, handleRevealPerfekt, handleAdvanceNext, handleMastered, handleMoreContext, handleSpellWord, replayGerman, handleToggleStar, handleDeleteWord]);

  // Mobile Touch Gestures (Hold 1s to activate swipe)
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      target: e.target
    };
    isDraggingRef.current = false;
    isGestureActiveRef.current = false;

    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      isGestureActiveRef.current = true;
      setIsGestureMode(true);
      setIsWiggling(true);
      setTimeout(() => setIsWiggling(false), 300);
      if (navigator.vibrate) navigator.vibrate(40);
    }, 700);
  };

  const handleTouchMove = (e) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    if (!isGestureActiveRef.current) {
      if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
      return;
    }

    isDraggingRef.current = true;
    setDragOffset({ x: diffX * 0.7, y: diffY * 0.7 });

    if (Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX > 40) setTouchFeedback('mastered');
      else if (diffX < -40) setTouchFeedback('perfekt');
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

    if (wasGestureActive) {
      if (Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX > SWIPE_THRESHOLD) {
          if (revealedState === 'none') {
            handleMastered();
          } else {
            handleAdvanceNext();
          }
        } else if (diffX < -SWIPE_THRESHOLD) {
          handleRevealPerfekt();
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

    if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15 && duration < 350) {
      if (touchedCard) {
        replayGerman();
      }
    }

    lastTouchEndTimeRef.current = Date.now();
    touchStartRef.current = null;
  };

  const handleCardClick = (e) => {
    if (e.target.closest('button')) return;
    if (Date.now() - lastTouchEndTimeRef.current < 450) return;
    replayGerman();
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const totalSessionWords = sessionCards.length;
  const wordsSeenCount = sessionActive && !sessionFinished ? currentIndex + 1 : totalSessionWords;
  const masteredCount = sessionResults.filter(r => r.result === 'mastered').length;
  const englishCount = sessionResults.filter(r => r.result === 'english').length;
  const contextCount = sessionResults.filter(r => r.result === 'context').length;
  const remainingCount = Math.max(0, totalSessionWords - (currentIndex + 1));

  // ----------------------------------------------------
  // VIEW: 1. Setup & Results
  // ----------------------------------------------------
  if (!sessionActive || !currentCard) {
    if (sessionFinished) {
      return (
        <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '680px', margin: '20px auto', padding: '0 16px' }}>
          <div className="glass-card" style={{ padding: '40px 24px', textAlign: 'center', width: '100%', position: 'relative' }}>
            <div style={{ fontSize: '56px', marginBottom: '16px' }}>🎉</div>
            <h2 style={{ fontSize: '26px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>
              Verb Tenses Session Completed!
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '15px', maxWidth: '440px', margin: '0 auto 24px' }}>
              You practiced all <b>{totalSessionWords} verbs</b> in Spoken Past (Perfekt).
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '12px',
              maxWidth: '540px',
              margin: '0 auto 28px'
            }}>
              <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Verbs Seen</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-verb)', marginTop: '4px' }}>{totalSessionWords}</div>
              </div>
              <div style={{ background: 'rgba(34, 197, 94, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(34, 197, 94, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Mastered</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: 'var(--color-noun)', marginTop: '4px' }}>{masteredCount}</div>
              </div>
              <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '16px 12px', borderRadius: '14px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: '700' }}>Perfekt Needed</div>
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

            <button
              type="button"
              onClick={() => {
                setSessionFinished(false);
                setSessionActive(false);
              }}
              style={{
                background: 'linear-gradient(135deg, var(--color-noun), var(--color-verb))',
                color: '#fff',
                border: 'none',
                padding: '14px 28px',
                borderRadius: '16px',
                fontSize: '15px',
                fontWeight: '800',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(59, 130, 246, 0.3)'
              }}
            >
              ⚙️ Start New Session
            </button>
          </div>
        </div>
      );
    }

    // Pre-Session Setup Screen (ONLY Priority and Session Size)
    return (
      <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '680px', margin: '20px auto', padding: '0 16px' }}>
        <div className="glass-card" style={{ padding: '32px 24px', width: '100%' }}>

          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '28px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 12px',
              borderRadius: '20px',
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              color: 'var(--color-verb)',
              fontSize: '12px',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '10px'
            }}>
              <span>⏱️</span> Spoken Past • Perfekt
            </div>
            <h2 style={{ fontSize: '28px', fontWeight: '800', color: '#fff', letterSpacing: '-0.5px', margin: '4px 0' }}>
              Verb Tenses
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '6px 0 0 0' }}>
              Practice German spoken past (Perfekt) forms with audio pronunciation & triage.
            </p>
          </div>

          {/* Deleted Words Status Bar */}
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
                <span>{deletedWords.length} verb{deletedWords.length !== 1 ? 's' : ''} deleted from sessions</span>
              </div>
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

          {/* 1. Priority Filters */}
          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              1. Filter by Priority:
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
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
                  {priorityCounts.high} verbs
                </div>
              </button>

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
                  {priorityCounts.med} verbs
                </div>
              </button>

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
                  {priorityCounts.low} verbs
                </div>
              </button>
            </div>
          </div>

          {/* 2. Session Size */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
              2. Session Size (Verbs Seen):
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { id: '25', label: '⚡ 25 Verbs' },
                { id: '50', label: '🎯 50 Verbs' },
                { id: '100', label: '🔥 100 Verbs' },
                { id: 'all', label: `All Matching (${allVerbsPool.length})` }
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setQueueLimit(item.id)}
                  className={`option-pill ${queueLimit === item.id ? 'active' : ''}`}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: '700'
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Start Session Button */}
          <button
            type="button"
            onClick={startSession}
            disabled={allVerbsPool.length === 0}
            style={{
              width: '100%',
              padding: '16px 24px',
              borderRadius: '16px',
              border: 'none',
              background: allVerbsPool.length > 0
                ? 'linear-gradient(135deg, var(--color-noun), var(--color-verb))'
                : 'rgba(255,255,255,0.08)',
              color: allVerbsPool.length > 0 ? '#fff' : 'var(--text-muted)',
              fontSize: '16px',
              fontWeight: '800',
              cursor: allVerbsPool.length > 0 ? 'pointer' : 'not-allowed',
              boxShadow: allVerbsPool.length > 0 ? '0 8px 24px rgba(59, 130, 246, 0.35)' : 'none',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            🚀 Start Verb Tenses Session ({allVerbsPool.length} available)
          </button>

          {/* Screen Keep-Awake Toggle */}
          <div
            onClick={handleToggleKeepAwake}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              marginTop: '16px',
              padding: '8px 14px',
              borderRadius: '12px',
              background: isKeepAwake ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255, 255, 255, 0.04)',
              border: isKeepAwake ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid var(--border-color)',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              maxWidth: '380px',
              margin: '16px auto 0'
            }}
            title="Prevents iPhone from locking the screen during practice"
          >
            <span style={{ fontSize: '15px' }}>{isKeepAwake ? '☀️' : '🌙'}</span>
            <span style={{ fontSize: '12px', fontWeight: '700', color: isKeepAwake ? '#f59e0b' : 'var(--text-secondary)' }}>
              {isKeepAwake ? 'Screen Lock Disabled (Awake: ON)' : 'Keep Screen Awake (Prevents Sleep)'}
            </span>
          </div>

        </div>

        {/* Modal: Deleted Verbs */}
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
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#fff', margin: 0 }}>
                  🗑️ Deleted Verbs ({deletedWords.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setShowDeletedModal(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '18px', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
              <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                These verbs will not appear in practice sessions. Click <b>Restore</b> to re-add them.
              </p>
              <div style={{ overflowY: 'auto', flex: 1, maxHeight: '300px' }}>
                {deletedWords.map(w => (
                  <div key={w} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ color: '#fff', fontWeight: '600' }}>{w}</span>
                    <button
                      type="button"
                      onClick={() => onRestoreWord ? onRestoreWord(w) : setLocalDeletedWords(prev => prev.filter(x => x !== w))}
                      style={{ background: 'rgba(34, 197, 94, 0.2)', border: '1px solid #22c55e', color: '#22c55e', borderRadius: '6px', padding: '3px 8px', fontSize: '11px', cursor: 'pointer' }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '16px', textAlign: 'right' }}>
                <button
                  type="button"
                  onClick={() => setShowDeletedModal(false)}
                  style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid var(--border-color)', color: '#fff', borderRadius: '8px', padding: '8px 16px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------------------------------
  // VIEW: 2. Active Session Card (Reusing AnkiiSpeaking layout)
  // ----------------------------------------------------
  const progressPercent = totalSessionWords > 0
    ? Math.min(100, Math.round((wordsSeenCount / totalSessionWords) * 100))
    : 0;

  const hasPerfektExample = Boolean(perfektInfo && perfektInfo.perfektExample);

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
            }}>
              🗑️ {sessionDeletedCount} Deleted
            </span>

            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              ({remainingCount} left)
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={async () => {
                if (!SpeechRecognition) {
                  alert('Speech recognition is not supported in this browser.');
                  return;
                }
                const nextVoice = !isVoiceActive;
                setIsVoiceActive(nextVoice);
                if (nextVoice && !isKeepAwake) {
                  try {
                    await wakeLockManager.enable();
                    setIsKeepAwake(true);
                  } catch (e) { }
                }
              }}
              title="Voice Commands: More, Next, Translate, Delete, Favorite, Spell, Repeat"
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
                gap: '7px'
              }}
            >
              <span style={{ fontSize: '14px' }}>🎙️</span>
              <span>{isVoiceActive ? 'Voice: ON' : 'Voice Control'}</span>
            </button>

            <button
              type="button"
              onClick={handleToggleKeepAwake}
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
                gap: '6px'
              }}
            >
              <span style={{ fontSize: '13px' }}>{isKeepAwake ? '☀️' : '🌙'}</span>
              <span>{isKeepAwake ? 'Awake: ON' : 'Keep Awake'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                clearAdvanceTimers();
                if ('speechSynthesis' in window) window.speechSynthesis.cancel();
                setSessionActive(false);
              }}
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
          borderRadius: '4px',
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            background: 'linear-gradient(90deg, #3b82f6, #10b981)',
            borderRadius: '4px',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Voice feedback badge */}
      {voiceFeedbackMsg && (
        <div className="animate-fade-in" style={{
          position: 'absolute',
          top: '60px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(16, 185, 129, 0.25)',
          border: '1px solid rgba(16, 185, 129, 0.5)',
          color: '#10b981',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          fontWeight: '700',
          zIndex: 100
        }}>
          {voiceFeedbackMsg}
        </div>
      )}

      {/* Swipe Feedback Badge */}
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
        {touchFeedback === 'perfekt' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👈 Release to Reveal Perfekt Form
          </span>
        )}
        {touchFeedback === 'context' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#3b82f6', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👆 Release for Context & Example
          </span>
        )}
        {touchFeedback === 'delete' && (
          <span style={{ fontSize: '12px', fontWeight: '800', color: '#ef4444', textTransform: 'uppercase', letterSpacing: '1px' }}>
            👇 Release to Delete Verb
          </span>
        )}
      </div>

      {/* MAIN AUDIO-FIRST FLASHCARD */}
      <div
        className={`glass-card ankii-speaking-card verbs ${isWiggling ? 'card-wiggle' : ''} ${isGestureMode ? 'gesture-active' : ''}`}
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
            touchFeedback === 'perfekt' ? 'rgba(245, 158, 11, 0.8)' :
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
        {/* Top Cue: More / Example */}
        {hasPerfektExample && (
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
            title="More Context (Example Sentence) [M]"
          >
            <span style={{ fontSize: '9px' }}>▲</span>
            <span>More</span>
            <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px', color: 'rgba(255,255,255,0.7)' }}>[M]</kbd>
          </button>
        )}

        {/* Bottom Cue: Delete */}
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
          title="Delete Verb [D]"
        >
          <span style={{ fontSize: '9px' }}>▼</span>
          <span>Delete</span>
          <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px', color: 'rgba(255,255,255,0.7)' }}>[D]</kbd>
        </button>

        {/* Top Left Card Badges */}
        <div style={{ position: 'absolute', top: '20px', left: '20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{
            fontSize: '11px',
            fontWeight: '800',
            padding: '3px 10px',
            borderRadius: '12px',
            background: 'rgba(59, 130, 246, 0.18)',
            border: '1px solid rgba(59, 130, 246, 0.4)',
            color: '#60a5fa',
            textTransform: 'uppercase',
            letterSpacing: '0.8px'
          }}>
            Spoken Past • Perfekt
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

        {/* Top Right: Delete, Star & Audio Replay */}
        <div style={{ position: 'absolute', top: '16px', right: '18px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="sound-btn ankii-delete-btn"
            onClick={handleDeleteWord}
            title="Delete this verb from future sessions [D]"
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
              cursor: 'pointer'
            }}
          >
            🗑️
          </button>

          {onToggleMyList && !isAnonymous && (
            <button
              type="button"
              className="sound-btn ankii-star-btn"
              onClick={handleToggleStar}
              title={isStarred ? 'Remove from My List [S]' : 'Add to My List Star [S]'}
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
                cursor: 'pointer'
              }}
            >
              {isStarred ? '★' : '☆'}
            </button>
          )}

          <button
            type="button"
            className="sound-btn"
            onClick={(e) => {
              e.stopPropagation();
              replayGerman();
            }}
            title="Tap to replay pronunciation [R]"
            style={{
              fontSize: '16px',
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isSpeaking ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.06)'
            }}
          >
            {isSpeaking ? '🔊' : '🔈'}
          </button>
        </div>

        {/* Center Content: Verb Infinitive & Details */}
        <div style={{ margin: 'auto 0', width: '100%', padding: '16px 0' }}>
          <div style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            fontWeight: '700',
            marginBottom: '10px'
          }}>
            Verb ({currentIndex + 1} of {totalSessionWords})
          </div>

          <div style={{
            fontSize: '36px',
            fontWeight: '800',
            color: '#fff',
            letterSpacing: '-0.5px',
            lineHeight: 1.2
          }}>
            {currentCard.word}
          </div>

          {currentCard.meaning && (
            <div style={{
              fontSize: '15px',
              color: 'var(--text-secondary)',
              marginTop: '6px'
            }}>
              ({currentCard.meaning})
            </div>
          )}

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
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span>🔤</span>
              <span>{spellingDisplay}</span>
            </div>
          )}

          {/* Quick Repeat & Spell Action Pills */}
          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
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
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
              title="Repeat Audio [R]"
            >
              <span>{isSpeaking ? '🔊' : '⟳'}</span>
              <span>Repeat</span>
              <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px' }}>[R]</kbd>
            </button>

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
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.14)',
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: '12px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
              title="Spell Letters [P]"
            >
              <span>🔤</span>
              <span>Spell</span>
              <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: '4px' }}>[P]</kbd>
            </button>
          </div>

          {/* Unrevealed Prompt Hint */}
          {revealedState === 'none' && (
            <div style={{
              marginTop: '16px',
              fontSize: '12px',
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}>
              <span>👆</span>
              <span>Tap, swipe left or press [Space] to reveal Perfekt form</span>
            </div>
          )}

          {/* REVEALED CONTENT: German Perfekt Form & English Past */}
          {revealedState !== 'none' && perfektInfo && (
            <div className="animate-fade-in" style={{
              marginTop: '22px',
              padding: '18px 22px',
              borderRadius: '18px',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(139, 92, 246, 0.12))',
              border: '1px solid rgba(59, 130, 246, 0.35)',
              width: '100%',
              maxWidth: '500px',
              margin: '22px auto 0'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{
                  fontSize: '11px',
                  fontWeight: '800',
                  color: 'var(--color-verb)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}>
                  🇩🇪 Spoken Past • Perfekt
                </span>
                <span style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic'
                }}>
                  {perfektInfo.thirdPersonDe}
                </span>
              </div>

              {/* Prominent Perfekt Sentence */}
              <div style={{
                fontSize: '26px',
                fontWeight: '800',
                color: '#fff',
                lineHeight: '1.25',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}>
                <span>{perfektInfo.perfektDe}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    speakGerman(perfektInfo.perfektDe);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-verb)',
                    fontSize: '18px',
                    cursor: 'pointer',
                    padding: '2px 4px'
                  }}
                  title="Listen to Perfekt"
                >
                  🔊
                </button>
              </div>

              {/* English Past Translation */}
              {perfektInfo.perfektEn && (
                <div style={{
                  marginTop: '10px',
                  paddingTop: '10px',
                  borderTop: '1px dashed rgba(255,255,255,0.12)',
                  fontSize: '16px',
                  fontWeight: '600',
                  color: 'var(--color-adj)'
                }}>
                  🇬🇧 {perfektInfo.perfektEn}
                </div>
              )}
            </div>
          )}

          {/* REVEALED CONTENT: Example sentence (ONLY if Perfekt example exists) */}
          {revealedState === 'context' && perfektInfo && perfektInfo.perfektExample && (
            <div className="animate-fade-in" style={{
              marginTop: '16px',
              padding: '16px 20px',
              borderRadius: '16px',
              background: 'rgba(59, 130, 246, 0.08)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              width: '100%',
              maxWidth: '500px',
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
                <span>📖</span> Perfekt Example Sentence
              </div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#fff', lineHeight: '1.4' }}>
                🇩🇪 {perfektInfo.perfektExample.de}
              </div>
              {perfektInfo.perfektExample.en && (
                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                  🇬🇧 {perfektInfo.perfektExample.en}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Bottom Card Footer: Shortcut Cheatsheet */}
        <div style={{ width: '100%', marginTop: 'auto', paddingTop: '12px' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Desktop: <code>[Space]</code> Reveal / Next • <code>[N]</code> Mastered • <code>[T]</code> Translate • <code>[R]</code> Repeat • <code>[D]</code> Delete
          </div>
        </div>
      </div>

      {/* Screen Border Visual Layout Cues */}
      <div className="ankii-layout-cues ankii-phone-border-cues">
        <button
          type="button"
          onClick={handleRevealPerfekt}
          className={`ankii-layout-cue ankii-phone-cue ankii-cue-left ${touchFeedback === 'perfekt' ? 'active-cue' : ''}`}
          style={{
            position: 'fixed',
            left: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            backdropFilter: 'blur(10px)',
            background: touchFeedback === 'perfekt' ? 'rgba(245, 158, 11, 0.28)' : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(245, 158, 11, 0.35)',
            color: 'var(--color-adj)',
            padding: '9px 13px',
            borderRadius: '16px',
            fontSize: '11px',
            fontWeight: '800',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            zIndex: 90,
            cursor: 'pointer'
          }}
          title="Translate / Reveal Perfekt [T]"
        >
          <span style={{ fontSize: '13px' }}>‹</span>
          <span>Translate</span>
        </button>

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
            zIndex: 90,
            cursor: 'pointer'
          }}
          title="Next / Mastered [N]"
        >
          <span>Next</span>
          <span style={{ fontSize: '13px' }}>›</span>
        </button>
      </div>

      {/* 10-Second Undo Toast */}
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
            background: 'rgba(18, 20, 30, 0.96)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(239, 68, 68, 0.5)',
            boxShadow: '0 12px 36px rgba(0,0,0,0.65)',
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
            <span style={{ fontSize: '18px' }}>🗑️</span>
            <div>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>
                "{undoToast.word}" deleted
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                Removed from future sessions
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                gap: '5px'
              }}
            >
              <span>↩ Undo</span>
              <span style={{ background: 'rgba(0,0,0,0.25)', padding: '1px 5px', borderRadius: '6px', fontSize: '10px' }}>
                {undoToast.secondsLeft}s
              </span>
            </button>
            <button
              type="button"
              onClick={() => setUndoToast(null)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '15px', cursor: 'pointer', padding: '4px' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Bottom Triage Controls */}
      <div style={{ width: '100%', marginTop: '16px' }}>
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 8px 24px rgba(59, 130, 246, 0.35)',
              marginBottom: '12px'
            }}
          >
            <span>Next Verb</span>
            <span style={{ fontSize: '18px' }}>→</span>
            <kbd style={{ fontSize: '10px', background: 'rgba(255,255,255,0.2)', padding: '2px 6px', borderRadius: '4px', marginLeft: '6px' }}>[Space]</kbd>
          </button>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
          <button
            type="button"
            onClick={handleRevealPerfekt}
            style={{
              padding: '12px 10px',
              borderRadius: '14px',
              background: revealedState === 'perfekt' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              color: 'var(--color-adj)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: '800' }}>‹ Perfekt</span>
            <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '4px' }}>[T]</kbd>
          </button>

          {hasPerfektExample ? (
            <button
              type="button"
              onClick={handleMoreContext}
              style={{
                padding: '12px 10px',
                borderRadius: '14px',
                background: revealedState === 'context' ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: 'var(--color-verb)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: '800' }}>▲ Example</span>
              <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '4px' }}>[M]</kbd>
            </button>
          ) : (
            <div style={{
              padding: '12px 10px',
              borderRadius: '14px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '11px',
              opacity: 0.5
            }}>
              <span>No Example</span>
            </div>
          )}

          <button
            type="button"
            onClick={revealedState === 'none' ? handleMastered : handleAdvanceNext}
            style={{
              padding: '12px 10px',
              borderRadius: '14px',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.3)',
              color: '#22c55e',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span style={{ fontSize: '12px', fontWeight: '800' }}>Next ›</span>
            <kbd style={{ fontSize: '9px', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '4px' }}>[N]</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
