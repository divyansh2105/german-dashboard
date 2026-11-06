import React, { useState, useEffect, useRef } from 'react';
import { queryGemini, fetchAvailableModels, DEFAULT_GEMINI_MODELS } from '../utils/geminiApi';

const PREPOSITION_GROUPS = {
  Akkusativ: ['bis', 'durch', 'für', 'gegen', 'ohne', 'um'],
  Dativ: ['aus', 'bei', 'mit', 'nach', 'seit', 'von', 'zu', 'gegenüber'],
  Wechsel: ['an', 'auf', 'hinter', 'in', 'neben', 'über', 'unter', 'vor', 'zwischen'],
  Genitiv: ['wegen', 'während', 'trotz', 'statt', 'anstatt']
};

const ALL_PREPOSITIONS = [
  ...PREPOSITION_GROUPS.Akkusativ,
  ...PREPOSITION_GROUPS.Dativ,
  ...PREPOSITION_GROUPS.Wechsel,
  ...PREPOSITION_GROUPS.Genitiv
];

const DEFAULT_PREP_WEIGHTS = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, 2]));

export default function GrammarPractice() {
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
      } catch (e) {
        // ignore JSON parse error
      }
    }
    return DEFAULT_GEMINI_MODELS;
  });

  // State to track selected prepositions
  const [selectedPreps, setSelectedPreps] = useState(() => {
    // Select all by default
    const all = [];
    Object.values(PREPOSITION_GROUPS).forEach(list => all.push(...list));
    return all;
  });

  // Weighted Deck & Anti-Repetition States
  const [prepWeights, setPrepWeights] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_prep_weights');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...DEFAULT_PREP_WEIGHTS, ...parsed };
      }
    } catch (e) {}
    return DEFAULT_PREP_WEIGHTS;
  });

  const [deckRemaining, setDeckRemaining] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_deck_remaining');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed;
      }
    } catch (e) {}
    return DEFAULT_PREP_WEIGHTS;
  });

  const [recentHistory, setRecentHistory] = useState(() => {
    try {
      const saved = localStorage.getItem('b1_grammar_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.slice(0, 10);
      }
    } catch (e) {}
    return [];
  });

  const [showDeckModal, setShowDeckModal] = useState(false);
  const [lastTargetPrep, setLastTargetPrep] = useState('');

  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [fallbackNotice, setFallbackNotice] = useState('');

  // Fetch available models if API key is present
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

  // Deck Management Helpers
  const handleRefillDeck = (customWeights = prepWeights) => {
    const refilled = { ...customWeights };
    setDeckRemaining(refilled);
    localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(refilled));
  };

  const handleUpdatePrepWeight = (prep, delta) => {
    const currentW = prepWeights[prep] ?? 2;
    const newW = Math.max(0, Math.min(20, currentW + delta));
    const nextWeights = { ...prepWeights, [prep]: newW };
    setPrepWeights(nextWeights);
    localStorage.setItem('b1_grammar_prep_weights', JSON.stringify(nextWeights));

    // Also adjust deckRemaining proportionally or clamp
    setDeckRemaining(prev => {
      const nextRemaining = {
        ...prev,
        [prep]: Math.min(newW, (prev[prep] ?? currentW) + (delta > 0 ? delta : 0))
      };
      localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(nextRemaining));
      return nextRemaining;
    });
  };

  const handleApplyPreset = (presetType) => {
    let newWeights = {};
    if (presetType === 'balanced_2') {
      newWeights = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, 2]));
    } else if (presetType === 'balanced_1') {
      newWeights = Object.fromEntries(ALL_PREPOSITIONS.map(p => [p, 1]));
    } else if (presetType === 'genitiv_focus') {
      newWeights = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Genitiv.includes(p) ? 4 : 1
      ]));
    } else if (presetType === 'dativ_focus') {
      newWeights = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Dativ.includes(p) ? 3 : 1
      ]));
    } else if (presetType === 'wechsel_focus') {
      newWeights = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Wechsel.includes(p) ? 3 : 1
      ]));
    } else if (presetType === 'akkusativ_focus') {
      newWeights = Object.fromEntries(ALL_PREPOSITIONS.map(p => [
        p,
        PREPOSITION_GROUPS.Akkusativ.includes(p) ? 3 : 1
      ]));
    }
    setPrepWeights(newWeights);
    localStorage.setItem('b1_grammar_prep_weights', JSON.stringify(newWeights));
    handleRefillDeck(newWeights);
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

    // Weighted sampling from active deck
    let activeDeck = { ...deckRemaining };
    let eligible = selectedPreps.filter(p => (activeDeck[p] || 0) > 0);

    // If deck for selected prepositions is empty, automatically refill for them
    if (eligible.length === 0) {
      selectedPreps.forEach(p => {
        activeDeck[p] = Math.max(1, prepWeights[p] || 1);
      });
      eligible = selectedPreps.filter(p => (activeDeck[p] || 0) > 0);
    }

    if (eligible.length === 0) {
      eligible = selectedPreps;
    }

    // Weighted roll based on remaining counts
    let totalWeight = 0;
    eligible.forEach(p => {
      totalWeight += Math.max(1, activeDeck[p] || 1);
    });

    let rand = Math.random() * totalWeight;
    let targetPrep = eligible[0];
    for (const p of eligible) {
      const w = Math.max(1, activeDeck[p] || 1);
      if (rand < w) {
        targetPrep = p;
        break;
      }
      rand -= w;
    }

    // Decrement counter for selected target preposition
    const updatedDeck = {
      ...activeDeck,
      [targetPrep]: Math.max(0, (activeDeck[targetPrep] || 1) - 1)
    };
    setDeckRemaining(updatedDeck);
    localStorage.setItem('b1_grammar_deck_remaining', JSON.stringify(updatedDeck));
    setLastTargetPrep(targetPrep);

    // Anti-repetition context
    const recentHistoryList = recentHistory.slice(0, 10);
    const recentAvoidBlock = recentHistoryList.length > 0
      ? `\nCRITICAL ANTI-REPETITION CONSTRAINT (PREVIOUS 10 QUESTIONS):
Do NOT repeat, mirror, or paraphrase any of these recently generated sentences. Create a completely different context, subject, and verb:
${recentHistoryList.map((s, idx) => `  ${idx + 1}. "${s}"`).join('\n')}\n`
      : '';

    const randomSeed = Math.floor(Math.random() * 1000000);
    const promptText = `Generate a single B1-level German sentence.
CRITICAL TARGET PREPOSITION: The sentence MUST specifically and unambiguously test the preposition: "${targetPrep}".
Replace "${targetPrep}" in the sentence with three underscores '___' for a blank challenge.
The only natural and grammatically correct solution for the blank must be "${targetPrep}".
${recentAvoidBlock}
Requirements:
1. Provide a diverse, natural, real-life B1 sentence representing everyday scenarios (work, appointments, apartment, travel, conversations, hobbies).
2. DO NOT use generic textbook clichés (like putting a book on the table or waiting for a train).
3. Vary sentence structure and grammatical subjects (use 'wir', 'der Kollege', 'die Nachbarin', formal 'Sie', etc.).
4. Do NOT excessively use reflexive verbs. Mix spatial, temporal, modal, and causal uses.

Seed: ${randomSeed}`;

    const systemInstruction = `You are an expert German language teacher generating preposition fill-in-the-blank questions for B1 students.
You must return a raw JSON object matching this schema exactly:
{
  "sentence": "German sentence with a single '___' blank representing the missing preposition.",
  "correctPreposition": "${targetPrep}",
  "translation": "English translation of the German sentence.",
  "explanation": "A grammatical explanation in English detailing why '${targetPrep}' is correct, which case it governs in this context (Accusative, Dative, Genitive), and if it is part of a verb-preposition idiom (Verben mit Präpositionen)."
}
Do not wrap the JSON output in markdown code blocks. Output raw JSON.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: promptText,
        systemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war überlastet. Versuche automatisch ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Satz über Backup-Modell (${usedModel}) generiert, da ${selectedModel} ausgelastet war.`);
        setTimeout(() => setFallbackNotice(''), 7000);
      } else {
        setFallbackNotice('');
      }

      const parsedQuestion = parsedJson || JSON.parse(rawJson);
      if (!parsedQuestion.sentence || !parsedQuestion.correctPreposition) {
        throw new Error('Invalid question format returned.');
      }

      setCurrentQuestion(parsedQuestion);

      // Save to recent 10-question history
      const fullSentence = parsedQuestion.sentence.replace('___', parsedQuestion.correctPreposition);
      const nextHistory = [
        fullSentence,
        ...recentHistory.filter(s => s !== fullSentence)
      ].slice(0, 10);
      setRecentHistory(nextHistory);
      localStorage.setItem('b1_grammar_history', JSON.stringify(nextHistory));
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

  const totalWeightsForSelected = selectedPreps.reduce((acc, p) => acc + (prepWeights[p] || 0), 0);
  const totalRemainingForSelected = selectedPreps.reduce((acc, p) => acc + (deckRemaining[p] || 0), 0);
  const allTotalWeights = ALL_PREPOSITIONS.reduce((acc, p) => acc + (prepWeights[p] || 0), 0);
  const allTotalRemaining = ALL_PREPOSITIONS.reduce((acc, p) => acc + (deckRemaining[p] || 0), 0);

  return (
    <div className="flashcard-layout animate-fade-in" style={{ maxWidth: '820px', width: '100%', gap: '18px' }}>
      
      {/* Settings bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '4px', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            📝 Grammar Preposition Challenge
          </div>
          <button
            type="button"
            onClick={() => setShowDeckModal(prev => !prev)}
            style={{
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '11.5px',
              fontWeight: '600',
              background: showDeckModal ? 'rgba(59, 130, 246, 0.25)' : 'rgba(59, 130, 246, 0.12)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#60a5fa',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.2s ease'
            }}
            title="Präpositionen-Gewichtung & Fragen-Deck anpassen"
          >
            <span>⚖️ Deck: <strong>{totalRemainingForSelected}/{totalWeightsForSelected}</strong> übrig</span>
            <span style={{ fontSize: '10px' }}>{showDeckModal ? '▲ Schließen' : '⚙️ Gewichte'}</span>
          </button>
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

      {/* Deck & Weights Customization Card */}
      {showDeckModal && (
        <div className="glass-card animate-fade-in" style={{
          width: '100%',
          padding: '18px 20px',
          background: 'rgba(15, 20, 35, 0.95)',
          border: '1px solid rgba(59, 130, 246, 0.4)',
          borderRadius: '14px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⚖️ Präpositionen-Deck & Gewichtung</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
                Jede Frage zieht eine Präposition aus dem Pool und verringert deren Zähler um 1. Passe hier die Quoten an.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => handleRefillDeck()}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  background: 'rgba(59, 130, 246, 0.2)',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                  color: '#93c5fd',
                  fontSize: '11.5px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
                title="Füllt alle Zähler wieder auf die eingestellten Gewichte auf"
              >
                🔄 Deck auffüllen ({allTotalRemaining}/{allTotalWeights})
              </button>
              <button
                type="button"
                onClick={() => setShowDeckModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '0 4px'
                }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Quick Presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' }}>Presets:</span>
            {[
              { id: 'balanced_2', label: 'Ausgeglichen (2x = 56)' },
              { id: 'balanced_1', label: 'Kompakt (1x = 28)' },
              { id: 'genitiv_focus', label: 'Genitiv-Fokus (4x)' },
              { id: 'dativ_focus', label: 'Dativ-Fokus (3x)' },
              { id: 'wechsel_focus', label: 'Wechselpräp.-Fokus (3x)' },
              { id: 'akkusativ_focus', label: 'Akkusativ-Fokus (3x)' }
            ].map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleApplyPreset(p.id)}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '3px 10px',
                  fontSize: '11px',
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Category prepositions weight adjustment list */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' }}>
            {Object.keys(PREPOSITION_GROUPS).map(groupName => {
              const preps = PREPOSITION_GROUPS[groupName];
              let groupColor = 'var(--color-conn)';
              if (groupName === 'Akkusativ') groupColor = 'var(--color-noun)';
              if (groupName === 'Dativ') groupColor = 'var(--color-verb)';
              if (groupName === 'Wechsel') groupColor = 'var(--color-adj)';
              if (groupName === 'Genitiv') groupColor = 'var(--color-reflexive)';

              return (
                <div key={groupName} style={{
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  borderRadius: '10px',
                  padding: '10px'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: groupColor, marginBottom: '8px' }}>
                    {groupName}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {preps.map(prep => {
                      const w = prepWeights[prep] ?? 2;
                      const rem = deckRemaining[prep] ?? w;
                      return (
                        <div key={prep} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '3px 6px',
                          borderRadius: '6px',
                          background: rem === 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.02)'
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: '600', color: rem === 0 ? 'var(--text-muted)' : '#fff' }}>
                            {prep}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '10.5px', color: rem === 0 ? '#ef4444' : 'var(--text-secondary)' }}>
                              {rem}/{w}
                            </span>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                              <button
                                type="button"
                                onClick={() => handleUpdatePrepWeight(prep, -1)}
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  background: 'rgba(255,255,255,0.06)',
                                  color: '#fff',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: 0
                                }}
                              >
                                -
                              </button>
                              <span style={{ fontSize: '11px', fontWeight: '700', minWidth: '16px', textAlign: 'center', color: '#fff' }}>
                                {w}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleUpdatePrepWeight(prep, 1)}
                                style={{
                                  width: '18px',
                                  height: '18px',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(255,255,255,0.15)',
                                  background: 'rgba(255,255,255,0.06)',
                                  color: '#fff',
                                  fontSize: '11px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: 0
                                }}
                              >
                                +
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
          gap: '8px',
          marginBottom: '10px'
        }}>
          <span>🔄</span>
          <span>{fallbackNotice}</span>
        </div>
      )}

      {/* Main interface layout splits into selector on left/top and exercise on right/bottom */}
      <div style={{ display: 'flex', flexDirection: 'row', gap: '24px', width: '100%', flexWrap: 'wrap' }}>
        
        {/* Left Side: Prepositions filter list */}
        <div className="glass-card" style={{ flex: '1 1 250px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
            <div>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#fff' }}>Präpositionen</span>
              <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                Deck: {totalRemainingForSelected} Fragen übrig
              </div>
            </div>
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
                      const rem = deckRemaining[prep] ?? (prepWeights[prep] || 2);
                      const isLastPicked = lastTargetPrep === prep;
                      return (
                        <button
                          key={prep}
                          type="button"
                          onClick={() => togglePrep(prep)}
                          title={`${prep}: ${rem} im Deck übrig`}
                          style={{
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid',
                            borderColor: isLastPicked ? '#f59e0b' : (active ? groupColor : 'var(--border-color)'),
                            background: active 
                              ? (rem === 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255, 255, 255, 0.04)')
                              : 'transparent',
                            color: active ? (rem === 0 ? 'var(--text-muted)' : '#fff') : 'var(--text-muted)',
                            fontSize: '11px',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <span>{prep}</span>
                          {active && (
                            <span style={{
                              fontSize: '9.5px',
                              padding: '1px 4px',
                              borderRadius: '4px',
                              background: rem === 0 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.08)',
                              color: rem === 0 ? '#ef4444' : 'var(--text-secondary)'
                            }}>
                              {rem}
                            </span>
                          )}
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
              <form onSubmit={handleCheck} style={{ display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center' }}>
                <div style={{ display: 'flex', width: '100%', gap: '10px' }}>
                  <input
                    type="text"
                    className="search-input"
                    placeholder="Präposition eintippen..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    disabled={hasChecked}
                    style={{ 
                      textAlign: 'center', 
                      fontSize: '16px', 
                      padding: '12px', 
                      borderRadius: '10px',
                      border: hasChecked
                        ? (isCorrect ? '2px solid var(--color-noun)' : '2px solid #ef4444')
                        : '1px solid var(--border-color)',
                      outline: 'none',
                      flexGrow: 1
                    }}
                    autoFocus
                    autoComplete="off"
                  />
                  
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
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
