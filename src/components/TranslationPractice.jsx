import React, { useState, useEffect, useRef } from 'react';
import { queryGemini, fetchAvailableModels, DEFAULT_GEMINI_MODELS } from '../utils/geminiApi';

// Predefined B1 curriculum topics for translation exercises
const TRANSLATION_TOPICS = [
  { id: 'mixed', label: '🎲 Mixed B1', desc: 'Random mix of essential B1 grammar and vocabulary' },
  { id: 'past', label: '⏳ Past Tenses', desc: 'Perfekt & Präteritum (haben/sein + Partizip II, unregelmäßige Verben)' },
  { id: 'future', label: '🚀 Future Tense', desc: 'Futur I (werden + Infinitiv) and expressing plans' },
  { id: 'prepositions', label: '📍 Prepositions & Cases', desc: 'Wechselpräpositionen, two-way prepositions, Dativ & Akkusativ' },
  { id: 'subordinate', label: '🔗 Subordinate Clauses', desc: 'Nebensätze (weil, dass, obwohl, wenn, als, da - Verb at end)' },
  { id: 'modal', label: '🛠️ Modal Verbs', desc: 'Modalverben (können, müssen, dürfen, sollen, wollen, möchten)' },
  { id: 'passive', label: '⚙️ Passive Voice', desc: 'Vorgangspassiv (werden + Partizip II)' },
  { id: 'relative', label: '👥 Relative Clauses', desc: 'Relativsätze (der, die, das, welcher, dessen, denen)' },
  { id: 'konjunktiv2', label: '💭 Konjunktiv II', desc: 'Wishes and polite requests (hätte, wäre, würde + Infinitiv)' },
  { id: 'everyday', label: '☕ Everyday & Work', desc: 'B1 exam scenarios (work, appointments, doctor, housing, travel)' }
];

// Offline backup bank of curated B1 translation exercises
const OFFLINE_EXERCISES = [
  {
    english: "Yesterday I had to cancel the doctor's appointment because my train was delayed.",
    topic: "past",
    topicName: "Past Tenses & Modal Verbs",
    grammarFocus: "Modalverb im Präteritum ('musste') und Kausalsatz mit 'weil' (Verb am Ende).",
    hints: [
      { english: "to cancel", german: "absagen (hat abgesagt)" },
      { english: "doctor's appointment", german: "der Arzttermin (-e)" },
      { english: "delayed", german: "verspätet sein" }
    ],
    referenceTranslations: [
      "Gestern musste ich den Arzttermin absagen, weil mein Zug verspätet war.",
      "Gestern habe ich den Arzttermin absagen müssen, weil mein Zug Verspätung hatte."
    ]
  },
  {
    english: "Next year we will move into a larger apartment near the city center.",
    topic: "future",
    topicName: "Future Tense (Futur I)",
    grammarFocus: "Futur I: werden (konjugiert) + Infinitiv am Satzende ('einziehen').",
    hints: [
      { english: "to move in", german: "einziehen (zieht ein, ist eingezogen)" },
      { english: "larger", german: "größer (Komparativ)" },
      { english: "city center", german: "das Stadtzentrum / die Innenstadt" }
    ],
    referenceTranslations: [
      "Nächstes Jahr werden wir in eine größere Wohnung in der Nähe des Stadtzentrums einziehen.",
      "Im nächsten Jahr werden wir in eine größere Wohnung nahe der Innenstadt umziehen."
    ]
  },
  {
    english: "He placed the keys on the kitchen table before he left the house.",
    topic: "prepositions",
    topicName: "Prepositions (Wechselpräpositionen & Cases)",
    grammarFocus: "Wechselpräposition 'auf' + Akkusativ bei Bewegung ('legen auf den Tisch'), gefolgt von Temporalsatz mit 'bevor'.",
    hints: [
      { english: "to place / put", german: "legen (hat gelegt)" },
      { english: "kitchen table", german: "der Küchentisch (-e)" },
      { english: "to leave", german: "verlassen (verlässt, hat verlassen)" }
    ],
    referenceTranslations: [
      "Er hat die Schlüssel auf den Küchentisch gelegt, bevor er das Haus verlassen hat.",
      "Er legte die Schlüssel auf den Küchentisch, bevor er das Haus verließ."
    ]
  },
  {
    english: "Although the weather was bad, many colleagues went for a walk during the lunch break.",
    topic: "subordinate",
    topicName: "Subordinate Clauses (Konzessivsatz mit obwohl)",
    grammarFocus: "Nebensatz mit 'obwohl' (konjugiertes Verb am Ende) und Inversion im Hauptsatz.",
    hints: [
      { english: "although", german: "obwohl (Nebensatzkonjunktion)" },
      { english: "colleague", german: "der Kollege (-n) / die Kollegin (-nen)" },
      { english: "lunch break", german: "die Mittagspause (-n)" },
      { english: "to go for a walk", german: "spazieren gehen" }
    ],
    referenceTranslations: [
      "Obwohl das Wetter schlecht war, sind viele Kollegen in der Mittagspause spazieren gegangen.",
      "Obwohl das Wetter schlecht war, gingen viele Kollegen in der Mittagspause spazieren."
    ]
  },
  {
    english: "The application documents must be submitted to the company by Friday.",
    topic: "passive",
    topicName: "Passive Voice (Passiv mit Modalverb)",
    grammarFocus: "Passiv mit Modalverb: Modalverb konjugiert + Partizip II ('eingereicht') + 'werden' am Satzende.",
    hints: [
      { english: "application documents", german: "die Bewerbungsunterlagen (Plural)" },
      { english: "to submit", german: "einreichen (hat eingereicht)" },
      { english: "by Friday", german: "bis Freitag" }
    ],
    referenceTranslations: [
      "Die Bewerbungsunterlagen müssen bis Freitag bei der Firma eingereicht werden.",
      "Bis Freitag müssen die Bewerbungsunterlagen bei dem Unternehmen eingereicht werden."
    ]
  },
  {
    english: "If I had more time, I would attend an intensive German course every day.",
    topic: "konjunktiv2",
    topicName: "Konjunktiv II (Wishes & Conditions)",
    grammarFocus: "Konditionalsatz mit Konjunktiv II: 'hätte' im Wenn-Satz, 'würde + Infinitiv' ('besuchen') im Hauptsatz.",
    hints: [
      { english: "if I had", german: "wenn ich ... hätte" },
      { english: "to attend a course", german: "einen Kurs besuchen / an einem Kurs teilnehmen" },
      { english: "intensive course", german: "der Intensivkurs (-e)" }
    ],
    referenceTranslations: [
      "Wenn ich mehr Zeit hätte, würde ich jeden Tag einen Deutsch-Intensivkurs besuchen.",
      "Hätte ich mehr Zeit, würde ich täglich an einem Deutsch-Intensivkurs teilnehmen."
    ]
  }
];

export default function TranslationPractice() {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('b1_gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);
  const [tempKey, setTempKey] = useState('');

  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem('b1_gemini_selected_model');
    if (!saved || saved === 'gemini-1.5-flash') {
      return 'gemini-3.6-flash';
    }
    return saved;
  });

  const [availableModels, setAvailableModels] = useState(() => {
    const saved = localStorage.getItem('b1_gemini_available_models');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return Array.from(new Set([...DEFAULT_GEMINI_MODELS, ...parsed]));
        }
      } catch (e) {}
    }
    return DEFAULT_GEMINI_MODELS;
  });

  const [selectedTopic, setSelectedTopic] = useState('mixed');
  const [currentExercise, setCurrentExercise] = useState(null);
  const [userTranslation, setUserTranslation] = useState('');
  const [showHints, setShowHints] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState('');

  // Voice-to-Text Recognition states
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const sessionBaseTextRef = useRef('');

  // Stats / streak
  const [stats, setStats] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_translation_stats');
      return saved ? JSON.parse(saved) : { totalSolved: 0, correct: 0, streak: 0 };
    } catch (e) {
      return { totalSolved: 0, correct: 0, streak: 0 };
    }
  });

  // Sync available models
  useEffect(() => {
    if (apiKey) {
      fetchAvailableModels(apiKey).then(models => {
        if (models && models.length > 0) {
          setAvailableModels(models);
          localStorage.setItem('b1_gemini_available_models', JSON.stringify(models));
        }
      });
    }
  }, [apiKey]);

  // Persist stats
  useEffect(() => {
    localStorage.setItem('b1_translation_stats', JSON.stringify(stats));
  }, [stats]);

  // Initialize Web Speech Recognition
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
        const cleanedSession = sessionTranscript.trim();
        const base = sessionBaseTextRef.current;
        setUserTranslation(base ? (base + ' ' + cleanedSession) : cleanedSession);
      };

      rec.onerror = (event) => {
        console.error('Speech recognition error in Translations:', event.error);
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
      sessionBaseTextRef.current = userTranslation ? userTranslation.trim() : '';
      recognitionRef.current.start();
    }
  };

  // Generate a new translation exercise
  const generateNewExercise = async (topicId = selectedTopic) => {
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setUserTranslation('');
    setEvaluation(null);
    setIsGenerating(true);
    setFallbackNotice('');

    const targetTopicObj = TRANSLATION_TOPICS.find(t => t.id === topicId) || TRANSLATION_TOPICS[0];

    // If no API key is provided, choose from curated offline collection
    if (!apiKey) {
      const filtered = topicId === 'mixed'
        ? OFFLINE_EXERCISES
        : OFFLINE_EXERCISES.filter(ex => ex.topic === topicId);
      const pool = filtered.length > 0 ? filtered : OFFLINE_EXERCISES;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setCurrentExercise(pick);
      setIsGenerating(false);
      return;
    }

    const systemInstruction = `You are an expert German teacher creating B1 Goethe/Telc certification translation exercises.
The user wants to practice translating an English sentence into natural, grammatically correct German at B1 level.
Topic required: "${targetTopicObj.label}: ${targetTopicObj.desc}".

Instructions:
1. Provide a realistic, natural English sentence (12-25 words long) testing the selected B1 topic.
2. If the sentence includes difficult, formal, or specialized nouns, verbs, or prepositions, provide their German equivalents as hints (including article/gender for nouns and auxiliary/participle for verbs).
3. Provide 2-3 natural German reference translations.
4. Explain the key grammar focus tested in German.

You MUST respond strictly with a valid JSON object matching this schema:
{
  "english": "English sentence here",
  "topicName": "${targetTopicObj.label}",
  "grammarFocus": "Brief German explanation of what grammar pattern is being tested",
  "hints": [
    { "english": "difficult word or verb", "german": "der/die/das ... or verb (mit Präposition)" }
  ],
  "referenceTranslations": [
    "Ideal German translation 1",
    "Alternative valid German translation 2"
  ]
}

Respond ONLY with raw JSON. No markdown ticks, no preamble.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: `Generate a new B1 German translation exercise for topic: ${targetTopicObj.label}`,
        systemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war ausgelastet. Wechsle zu ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Übung über Backup-Modell (${usedModel}) generiert.`);
        setTimeout(() => setFallbackNotice(''), 6000);
      }

      const parsed = parsedJson || JSON.parse(rawJson);
      if (!parsed.english || !parsed.referenceTranslations) {
        throw new Error("Invalid exercise structure returned.");
      }
      setCurrentExercise(parsed);
    } catch (err) {
      console.error("Failed to generate exercise with Gemini:", err);
      // Fallback to offline collection on error
      const filtered = topicId === 'mixed'
        ? OFFLINE_EXERCISES
        : OFFLINE_EXERCISES.filter(ex => ex.topic === topicId);
      const pool = filtered.length > 0 ? filtered : OFFLINE_EXERCISES;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setCurrentExercise(pick);
      setFallbackNotice("⚠️ Offline-Übung geladen, da keine Verbindung zu Gemini möglich war.");
    } finally {
      setIsGenerating(false);
    }
  };

  // Evaluate the user's translation
  const handleCheckTranslation = async (e) => {
    if (e) e.preventDefault();
    if (!userTranslation.trim() || !currentExercise) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }

    setIsEvaluating(true);
    setFallbackNotice('');

    // If no API key, use client-side heuristic comparison
    if (!apiKey) {
      const cleanUser = userTranslation.trim().toLowerCase().replace(/[.,!?;:]/g, '');
      const matches = currentExercise.referenceTranslations.some(ref => {
        const cleanRef = ref.toLowerCase().replace(/[.,!?;:]/g, '');
        return cleanRef === cleanUser;
      });

      const fallbackEval = {
        isCorrect: matches,
        score: matches ? 100 : 70,
        rating: matches ? 'excellent' : 'good',
        bestTranslation: currentExercise.referenceTranslations[0],
        alternativeTranslations: currentExercise.referenceTranslations.slice(1),
        feedback: matches 
          ? "Perfekt übersetzt! Deine Formulierung entspricht genau der Musterlösung." 
          : "Guter Versuch! Vergleiche deine Antwort mit den Musterlösungen unten.",
        corrections: matches ? [] : [
          {
            original: userTranslation,
            corrected: currentExercise.referenceTranslations[0],
            explanation: `Beachte den Fokus: ${currentExercise.grammarFocus || 'Korrekte Satzstellung und Kasus'}.`
          }
        ],
        grammarNotes: currentExercise.grammarFocus || "Achte auf Wortstellung und korrekte Konjugation."
      };

      setEvaluation(fallbackEval);
      setStats(prev => ({
        totalSolved: prev.totalSolved + 1,
        correct: matches ? prev.correct + 1 : prev.correct,
        streak: matches ? prev.streak + 1 : 0
      }));
      setIsEvaluating(false);
      return;
    }

    const evalSystemInstruction = `You are a strict yet encouraging German language examiner evaluating a B1 student's translation.
English Source: "${currentExercise.english}"
Reference Translations: ${JSON.stringify(currentExercise.referenceTranslations)}
Grammar Focus: "${currentExercise.grammarFocus}"

The user has translated it as:
"${userTranslation.trim()}"

Evaluate the user's German translation accurately:
1. Is it grammatically correct German? Does it preserve the meaning of the English source?
2. Assess word order (Verbposition in Haupt- und Nebensätzen), case endings (Akkusativ, Dativ, Genitiv), tense, and vocabulary.
3. Minor punctuation or capitalization slips should deduct only 5-10 points. Grammar errors (wrong case, misplaced verb, wrong auxiliary) should deduct accordingly.
4. Provide constructive feedback in German suitable for a B1 learner.
5. If there are mistakes, break them down clearly into: original part, corrected part, and the grammatical explanation.

Output ONLY a JSON object matching this schema:
{
  "isCorrect": boolean (true if score >= 80),
  "score": integer (0 to 100),
  "rating": "excellent" | "good" | "needs_work",
  "bestTranslation": "Best natural German sentence",
  "alternativeTranslations": ["Alternative valid sentence"],
  "feedback": "Encouraging, clear explanation in German (2-3 sentences)",
  "corrections": [
    {
      "original": "part with mistake",
      "corrected": "corrected version",
      "explanation": "Why this change is needed"
    }
  ],
  "grammarNotes": "Quick rule reminder for future practice"
}
Output raw JSON only.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: `Evaluate this translation: "${userTranslation.trim()}"`,
        systemInstruction: evalSystemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war ausgelastet. Wechsle zu ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Bewertung über Backup-Modell (${usedModel}) generiert.`);
        setTimeout(() => setFallbackNotice(''), 6000);
      }

      const evalData = parsedJson || JSON.parse(rawJson);
      setEvaluation(evalData);

      setStats(prev => ({
        totalSolved: prev.totalSolved + 1,
        correct: evalData.isCorrect ? prev.correct + 1 : prev.correct,
        streak: evalData.isCorrect ? prev.streak + 1 : 0
      }));
    } catch (err) {
      console.error("Evaluation error:", err);
      setFallbackNotice(`⚠️ Fehler bei der Bewertung: ${err.message}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Load first exercise on mount
  useEffect(() => {
    generateNewExercise('mixed');
  }, []);

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

  const speakText = (text) => {
    if (window.speakGerman) {
      window.speakGerman(text);
    }
  };

  return (
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '850px', width: '100%', gap: '20px' }}>
      
      {/* Top Header Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🌐</span>
            <span>B1 Deutsch Übersetzer & Satz-Trainer</span>
          </div>
          {/* Quick Streak & Solved counter */}
          <div style={{ display: 'flex', gap: '8px', fontSize: '11px' }}>
            <span style={{ background: 'rgba(234, 179, 8, 0.15)', color: '#facc15', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
              🔥 Streak: {stats.streak}
            </span>
            <span style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              ✓ {stats.correct}/{stats.totalSolved}
            </span>
          </div>
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
            title="Choose Gemini Model"
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
            title="Manage Gemini API Key"
            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', borderRadius: '8px' }}
          >
            ⚙️ Key
          </button>
        </div>
      </div>

      {/* Fallback notification indicator */}
      {fallbackNotice && (
        <div style={{
          width: '100%',
          padding: '8px 12px',
          background: 'rgba(234, 179, 8, 0.15)',
          border: '1px solid rgba(234, 179, 8, 0.35)',
          borderRadius: '10px',
          color: '#facc15',
          fontSize: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span>🔄</span>
          <span>{fallbackNotice}</span>
        </div>
      )}

      {/* API Key Modal if requested */}
      {showKeyInput && (
        <div className="glass-card" style={{ width: '100%', padding: '20px', background: 'rgba(20, 22, 35, 0.95)', border: '1px solid var(--color-conn)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h4 style={{ margin: 0, fontSize: '15px', color: '#fff' }}>🔑 Gemini API-Schlüssel</h4>
            {apiKey && (
              <button type="button" onClick={() => setShowKeyInput(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}>✕</button>
            )}
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: 1.5 }}>
            Gib deinen kostenlosen Google Gemini API-Schlüssel ein, um unbegrenzte, abwechslungsreiche B1-Übungen und präzises Grammatik-Feedback zu erhalten.
          </p>
          <form onSubmit={handleSaveKey} style={{ display: 'flex', gap: '8px' }}>
            <input
              type="password"
              placeholder="AIzaSy..."
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              style={{
                flexGrow: 1,
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#fff',
                fontSize: '13px'
              }}
            />
            <button type="submit" className="feedback-btn good" style={{ padding: '10px 20px', fontSize: '13px', width: 'auto', maxWidth: 'none', minHeight: 'auto' }}>
              Speichern
            </button>
          </form>
        </div>
      )}

      {/* Topic Selection Carousel / Pill Bar */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: '700' }}>
            Grammatik-Thema / Topic Focus
          </span>
          <button
            type="button"
            onClick={() => generateNewExercise(selectedTopic)}
            disabled={isGenerating}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-verb)',
              fontSize: '12px',
              fontWeight: '600',
              cursor: isGenerating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <span>🔄</span>
            <span>{isGenerating ? 'Generiere...' : 'Neue Übung'}</span>
          </button>
        </div>

        <div style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
          paddingBottom: '6px',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none'
        }}>
          {TRANSLATION_TOPICS.map(topic => {
            const isSelected = selectedTopic === topic.id;
            return (
              <button
                key={topic.id}
                type="button"
                onClick={() => {
                  setSelectedTopic(topic.id);
                  generateNewExercise(topic.id);
                }}
                disabled={isGenerating}
                style={{
                  flexShrink: 0,
                  padding: '7px 14px',
                  borderRadius: '20px',
                  fontSize: '12px',
                  fontWeight: isSelected ? '700' : '500',
                  border: isSelected ? '1px solid var(--color-conn)' : '1px solid var(--border-color)',
                  background: isSelected 
                    ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.3))' 
                    : 'rgba(255, 255, 255, 0.03)',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: isSelected ? '0 2px 8px rgba(139, 92, 246, 0.2)' : 'none'
                }}
                title={topic.desc}
              >
                {topic.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Exercise Card */}
      <div className="glass-card" style={{ width: '100%', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
        
        {isGenerating ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '50px 20px', gap: '16px' }}>
            <div className="voice-pulse" style={{ width: '48px', height: '48px', border: '3px solid var(--color-conn)', borderRadius: '50%', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }} />
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
              Generiere B1-Übersetzungsaufgabe mit Gemini...
            </p>
          </div>
        ) : currentExercise ? (
          <>
            {/* Exercise Source Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    background: 'rgba(139, 92, 246, 0.15)',
                    color: 'var(--color-conn)',
                    border: '1px solid rgba(139, 92, 246, 0.3)'
                  }}>
                    {currentExercise.topicName || 'B1 German Exercise'}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    Translate to German
                  </span>
                </div>

                {/* Hints Toggle */}
                {currentExercise.hints && currentExercise.hints.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowHints(prev => !prev)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: showHints ? 'var(--color-noun)' : 'var(--text-muted)',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>💡</span>
                    <span>{showHints ? 'Wortschatz-Tipps ausblenden' : 'Wortschatz-Tipps anzeigen'}</span>
                  </button>
                )}
              </div>

              {/* English Prompt Sentence */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border-color)',
                borderRadius: '14px',
                padding: '18px 20px',
                fontSize: '17px',
                fontWeight: '600',
                color: '#fff',
                lineHeight: 1.5,
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)'
              }}>
                "{currentExercise.english}"
              </div>

              {/* Vocabulary Hints Pill Box */}
              {showHints && currentExercise.hints && currentExercise.hints.length > 0 && (
                <div style={{
                  background: 'rgba(245, 158, 11, 0.05)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px'
                }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💡</span>
                    <span>Wortschatz-Tipps / Vocabulary Hints:</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {currentExercise.hints.map((hint, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          borderRadius: '8px',
                          padding: '4px 10px',
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        <span style={{ color: 'var(--text-secondary)' }}>{hint.english}:</span>
                        <strong style={{ color: '#fff' }}>{hint.german}</strong>
                        <button
                          type="button"
                          onClick={() => speakText(hint.german.replace(/\(.*?\)/g, ''))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '11px', color: 'var(--color-verb)' }}
                          title="Aussprache hören"
                        >
                          🔊
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Translation Input Area */}
            <form onSubmit={handleCheckTranslation} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <textarea
                  value={userTranslation}
                  onChange={(e) => setUserTranslation(e.target.value)}
                  placeholder="✍️ Sprich oder tippe deine deutsche Übersetzung hier..."
                  rows={3}
                  disabled={isEvaluating}
                  style={{
                    width: '100%',
                    padding: '14px 48px 14px 16px',
                    borderRadius: '14px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: isListening ? '1.5px solid #ef4444' : '1px solid var(--border-color)',
                    color: '#fff',
                    fontSize: '15px',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    boxSizing: 'border-box',
                    outline: 'none',
                    boxShadow: isListening ? '0 0 14px rgba(239, 68, 68, 0.3)' : 'none'
                  }}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      handleCheckTranslation(e);
                    }
                  }}
                />

                {/* Voice-to-Text Microphone Button inside input corner */}
                <button
                  type="button"
                  onClick={toggleSpeech}
                  title={isListening ? "Aufnahme stoppen" : "Auf Deutsch sprechen (Voice-to-Text)"}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    top: '12px',
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isListening ? '#ef4444' : 'rgba(255, 255, 255, 0.08)',
                    color: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    transition: 'all 0.2s ease',
                    boxShadow: isListening ? '0 0 10px rgba(239, 68, 68, 0.6)' : 'none'
                  }}
                >
                  {isListening ? '⏹️' : '🎙️'}
                </button>
              </div>

              {/* Listening Active Pulse Banner */}
              {isListening && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12px',
                  color: '#ef4444',
                  fontWeight: '600',
                  animation: 'pulse 1.5s infinite'
                }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} />
                  <span>Zuhören aktiv... Sprich deinen deutschen Satz (z.B. "Gestern musste ich...")</span>
                </div>
              )}

              {/* Action Buttons Row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {userTranslation && (
                    <button
                      type="button"
                      onClick={() => setUserTranslation('')}
                      style={{
                        padding: '8px 14px',
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '10px',
                        color: 'var(--text-secondary)',
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      Löschen
                    </button>
                  )}
                  {evaluation && (
                    <button
                      type="button"
                      onClick={() => generateNewExercise(selectedTopic)}
                      className="nav-button"
                      style={{ padding: '8px 16px', fontSize: '13px', background: 'rgba(255, 255, 255, 0.06)' }}
                    >
                      Nächste Übung ➔
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!userTranslation.trim() || isEvaluating}
                  className="feedback-btn good"
                  style={{
                    padding: '12px 24px',
                    fontSize: '14px',
                    fontWeight: '700',
                    width: 'auto',
                    maxWidth: 'none',
                    minHeight: 'auto',
                    opacity: (!userTranslation.trim() || isEvaluating) ? 0.5 : 1,
                    cursor: (!userTranslation.trim() || isEvaluating) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isEvaluating ? 'Überprüfe Übersetzung...' : 'Übersetzung prüfen ✨'}
                </button>
              </div>
            </form>

            {/* Evaluation Results Card */}
            {evaluation && (
              <div style={{
                marginTop: '10px',
                padding: '20px',
                borderRadius: '16px',
                background: evaluation.isCorrect ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)',
                border: evaluation.isCorrect ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                {/* Result Status Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>
                      {evaluation.isCorrect ? '🎉' : '✍️'}
                    </span>
                    <span style={{
                      fontSize: '15px',
                      fontWeight: '800',
                      color: evaluation.isCorrect ? '#4ade80' : '#f87171'
                    }}>
                      {evaluation.score >= 90 ? 'Hervorragend! / Excellent' : (evaluation.isCorrect ? 'Sehr gut!' : 'Verbesserungswürdig')}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: evaluation.isCorrect ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                      color: evaluation.isCorrect ? '#4ade80' : '#f87171',
                      fontWeight: '700'
                    }}>
                      {evaluation.score}/100
                    </span>
                  </div>

                  {/* Audio button for best translation */}
                  <button
                    type="button"
                    onClick={() => speakText(evaluation.bestTranslation)}
                    className="sound-btn"
                    title="Musterlösung auf Deutsch anhören"
                    style={{ fontSize: '13px', padding: '6px 12px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '10px', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <span>🔊</span>
                    <span>Anhören</span>
                  </button>
                </div>

                {/* Explanation text */}
                <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                  {evaluation.feedback}
                </p>

                {/* Corrections breakdown if any */}
                {evaluation.corrections && evaluation.corrections.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)' }}>
                      Korrekturen / Detailed Notes:
                    </span>
                    {evaluation.corrections.map((corr, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'rgba(0, 0, 0, 0.25)',
                          borderRadius: '10px',
                          padding: '10px 14px',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          fontSize: '13px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px'
                        }}
                      >
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <span style={{ color: '#f87171', textDecoration: 'line-through' }}>{corr.original}</span>
                          <span style={{ color: 'var(--text-muted)' }}>➔</span>
                          <strong style={{ color: '#4ade80' }}>{corr.corrected}</strong>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          {corr.explanation}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Reference translations */}
                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '12px',
                  padding: '12px 16px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Musterlösung / Ideal Translations:
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>1. {evaluation.bestTranslation}</span>
                      <button
                        type="button"
                        onClick={() => speakText(evaluation.bestTranslation)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', padding: '2px 6px', color: 'var(--color-verb)' }}
                        title="Anhören"
                      >
                        🔊
                      </button>
                    </div>
                    {evaluation.alternativeTranslations && evaluation.alternativeTranslations.map((alt, idx) => (
                      <div key={idx} style={{ fontSize: '13px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>2. {alt}</span>
                        <button
                          type="button"
                          onClick={() => speakText(alt)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '12px', padding: '2px 6px', color: 'var(--text-secondary)' }}
                          title="Anhören"
                        >
                          🔊
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom button: next exercise */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                  <button
                    type="button"
                    onClick={() => generateNewExercise(selectedTopic)}
                    className="feedback-btn good"
                    style={{ padding: '10px 22px', fontSize: '13px', width: 'auto', maxWidth: 'none', minHeight: 'auto' }}
                  >
                    Nächster Satz ➔
                  </button>
                </div>

              </div>
            )}
          </>
        ) : null}

      </div>

    </div>
  );
}
