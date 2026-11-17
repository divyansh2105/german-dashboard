import React, { useState, useEffect, useRef } from 'react';
import { queryGemini, fetchAvailableModels, DEFAULT_GEMINI_MODELS } from '../utils/geminiApi';
import FluencyPractice from './FluencyPractice';

const TOPIC_HELPERS = [
  {
    title: '🏝️ Letzter Urlaub',
    prompt: 'Erzähle von deinem letzten Urlaub. Wohin bist du gereist? Was hast du dort gemacht? Wie war das Wetter?'
  },
  {
    title: '⚽ Mein Wochenende',
    prompt: 'Was hast du am Wochenende gemacht? Mit wem hast du deine Zeit verbracht? Hast du dich gut erholt?'
  },
  {
    title: '🇩🇪 Deutsch lernen',
    prompt: 'Warum lernst du Deutsch? Seit wann lernst du die Sprache? Was gefällt dir am besten und was ist schwierig?'
  }
];

// Helper for inline markdown rendering (bold, italics, quotes) in tips
export const renderInlineMarkdown = (text) => {
  if (!text || typeof text !== 'string') return text;
  const parts = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|"[^"]+")/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={key++} style={{ color: '#fff', fontWeight: 600 }}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={key++} style={{ fontStyle: 'italic', color: '#fef08a' }}>{token.slice(1, -1)}</em>);
    } else if (token.startsWith('"') && token.endsWith('"')) {
      parts.push(<span key={key++} style={{ color: '#93c5fd', fontWeight: 500 }}>{token}</span>);
    } else {
      parts.push(token);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts.length > 0 ? parts : text;
};

// Helper to extract feedback tips in Conversation mode with full support for nested parentheses & brackets
export const parseConversationMessage = (text) => {
  if (!text || typeof text !== 'string') return { tip: null, cleanText: '' };
  const trimmed = text.trim();

  // 1. Tagged format: [TIP]...[/TIP] or <tip>...</tip>
  const tagMatch = trimmed.match(/^\[TIP\]([\s\S]*?)\[\/TIP\]/i) || trimmed.match(/^<tip>([\s\S]*?)<\/tip>/i);
  if (tagMatch) {
    return {
      tip: tagMatch[1].trim(),
      cleanText: trimmed.slice(tagMatch[0].length).trim()
    };
  }

  // Helper for balanced brackets/parentheses depth scanning
  const extractBalanced = (str, openChar, closeChar, prefixRegex) => {
    const match = str.match(prefixRegex);
    if (!match) return null;
    const startIdx = match.index;
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < str.length; i++) {
      if (str[i] === openChar) depth++;
      else if (str[i] === closeChar) {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx !== -1) {
      const rawBlock = str.slice(startIdx + 1, endIdx);
      const clean = (str.slice(0, startIdx) + ' ' + str.slice(endIdx + 1)).trim();
      const tip = rawBlock.replace(/^(?:Tip|Word\s*Order(?:\s*Tip)?|Grammar\s*Tip|Grammar\s*&\s*Word\s*Order\s*Tip|Grammatik-Tipp)\s*[:\-–—]\s*/i, '').trim();
      return { tip: tip || rawBlock, cleanText: clean };
    }
    return null;
  };

  // 2. Bracket format: [Tip: ...] with balanced square brackets
  const bracketResult = extractBalanced(trimmed, '[', ']', /^\s*\[(?:Tip|Word\s*Order(?:\s*Tip)?|Grammar\s*Tip|Grammar\s*&\s*Word\s*Order\s*Tip|Grammatik-Tipp)\b/i);
  if (bracketResult) return bracketResult;

  // 3. Parenthesis format: (Tip: ...) with balanced parentheses (handles nested parens like (to place))
  const parenResult = extractBalanced(trimmed, '(', ')', /^\s*\((?:Tip|Word\s*Order(?:\s*Tip)?|Grammar\s*Tip|Grammar\s*&\s*Word\s*Order\s*Tip|Grammatik-Tipp)\b/i);
  if (parenResult) return parenResult;

  // 4. Any parenthetical tip anywhere with balanced parentheses
  const generalParen = extractBalanced(trimmed, '(', ')', /\((?:Tip|Word\s*Order(?:\s*Tip)?|Grammar\s*Tip|Grammar\s*&\s*Word\s*Order\s*Tip|Grammatik-Tipp)\s*[:\-–—]/i);
  if (generalParen) return generalParen;

  // 5. Line prefix: "Tip: ..." followed by newline
  const lineMatch = trimmed.match(/^(?:Tip|Word\s*Order(?:\s*Tip)?|Grammar\s*Tip|Grammar\s*&\s*Word\s*Order\s*Tip|Grammatik-Tipp)\s*[:\-–—]\s*([^\n]+(?:\n(?!\n|[A-ZÄÖÜ][a-zäöüß]+ (?:ist|sind|war|habe|hat|hatte|kann|muss|soll|will|geht|macht|finde))[^\n]+)*)\n\n?([\s\S]+)$/i);
  if (lineMatch) {
    return { tip: lineMatch[1].trim(), cleanText: lineMatch[2].trim() };
  }

  // 6. Fallback for legacy (Grammatik-Tipp: ...)
  if (trimmed.includes('(Grammatik-Tipp:')) {
    const match = trimmed.match(/\((Grammatik-Tipp:[\s\S]*?)\)/);
    if (match) {
      const cleanText = trimmed.replace(match[0], '').trim();
      const tipBody = match[1].replace(/^Grammatik-Tipp:\s*/i, '').trim();
      return { tip: tipBody, cleanText };
    }
  }

  return { tip: null, cleanText: text };
};

export default function SpeakingPractice() {
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

  // Mode: 'fluency' (default), 'conversation' (chat partner), or 'evaluation' (essay analyzer)
  const [activeMode, setActiveMode] = useState(() => localStorage.getItem('b1_speaking_active_mode') || 'fluency');

  // Conversation Mode states
  const [messages, setMessages] = useState(() => {
    const saved = localStorage.getItem('b1_speaking_chat_history');
    return saved ? JSON.parse(saved) : [
      {
        role: 'model',
        text: 'Hallo! Ich bin dein Gemini-Sprachpartner. Lass uns auf Deutsch unterhalten! Worüber möchtest du heute sprechen?'
      }
    ];
  });
  
  // Shared text input
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Paragraph Evaluation Mode states
  const [evaluationResult, setEvaluationResult] = useState(null);
  const [activeTopicHelp, setActiveTopicHelp] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState('');
  
  const chatEndRef = useRef(null);
  const chatInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const sessionBaseTextRef = useRef('');

  // Auto-resize chat textarea to fit user's text dynamically without scrolling
  useEffect(() => {
    if (chatInputRef.current) {
      chatInputRef.current.style.height = 'auto';
      const newHeight = Math.max(46, Math.min(chatInputRef.current.scrollHeight, 280));
      chatInputRef.current.style.height = `${newHeight}px`;
    }
  }, [userInput, activeMode]);

  // Handle Enter to send, Shift+Enter for new line
  const handleChatKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage(e);
    }
  };

  // Persist messages and auto-scroll
  useEffect(() => {
    if (activeMode === 'conversation') {
      localStorage.setItem('b1_speaking_chat_history', JSON.stringify(messages));
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeMode]);

  // Fetch available models from Gemini API when API key changes
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

  // Speaks complete German sentences out loud
  const speakGermanText = (text) => {
    if (window.speakGerman) {
      // Extract ONLY clean German conversation, completely stripping any English tip/feedback
      const { cleanText } = parseConversationMessage(text);
      
      // Secondary safety check: strip any residual bracketed or parenthetical notes if any remain
      let cleanAudioText = (cleanText || text)
        .replace(/\[TIP[\s\S]*?\[\/TIP\]/gi, '')
        .replace(/\[[\s\S]*?\]/g, '')
        .replace(/\((?:Tip|Word\s*Order|Grammar|Grammatik)[\s\S]*?\)/gi, '')
        .trim();

      // Clean leading stray punctuation (e.g. closing parens/quotes left by broken fragments)
      cleanAudioText = cleanAudioText.replace(/^[)\]"'\s]+/, '').trim();

      if (cleanAudioText) {
        window.speakGerman(cleanAudioText);
      }
    }
  };

  // Conversation handler
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
      const contentsPayload = newMessages.map(msg => ({
        role: msg.role,
        parts: [{ text: msg.text }]
      }));

      const systemInstructionText = `You are an encouraging, friendly German conversation partner helping a student practice speaking for their Goethe/telc B1 German exam.
Speak ONLY in clear, natural, grammatically correct German suitable for a B1 learner. Keep your conversational responses relatively short (2-3 sentences max) so it feels like a real, lively spoken dialogue. Occasionally ask natural B1-level questions to keep the dialogue flowing.

CRITICAL FEEDBACK & TIP DIRECTIVES FOR USER'S SPOKEN RESPONSES:
1. TIPS MUST BE IN ENGLISH:
   - Any tip, correction, or feedback for the student MUST be written in clear, concise ENGLISH.
   - Format: Place the tip inside brackets or parentheses at the very beginning of your response on its own line: \`[TIP: <feedback in English>]\` or \`(Tip: <feedback in English>)\` before continuing with your conversational German response.
   - If the student's response has no significant grammatical or word order issues, DO NOT include any tip at all—proceed directly with your German conversation reply.

2. PRIMARY EMPHASIS: GERMAN WORD ORDER (SATZSTELLUNG):
   - Always prioritize and focus your tips on German word order, which is the most critical hurdle in B1 spoken German:
     * Verb in Position 2 (V2 rule) in main clauses.
     * Inversion: When a sentence begins with an adverb, time expression, or prepositional phrase (e.g. "Gestern", "Leider", "Am Wochenende", "Normalerweise"), the conjugated verb MUST stay in position 2 immediately followed by the subject (e.g. "Gestern habe ich...", NOT "Gestern ich habe...").
     * Subordinate clauses (Nebensätze with weil, dass, wenn, ob, obwohl, da, damit, etc.): The conjugated verb MUST kick to the very end of the clause.
     * Two-part verb brackets (Satzklammer):
       - Perfekt: Auxiliary (haben/sein) in position 2, Partizip II at the very end.
       - Modal verbs: Conjugated modal in position 2, Infinitive at the very end.
       - Separable verbs (trennbare Verben): Prefix separated and placed at the very end.
     * TeKaMoLo ordering (Temporal, Kausal, Modal, Lokal) where helpful.

3. MICROPHONE & SPEECH RECOGNITION AWARENESS (DO NOT OVER-CORRECT):
   - The user is SPEAKING their response into a microphone via speech-to-text recognition.
   - Voice recognition often has minor acoustic imperfections, phonetic approximations, missing commas/periods, or lack of capitalization.
   - Charitably understand what the user intended to say based on phonetic and conversational context.
   - NEVER complain about punctuation, capitalization, or minor phonetic speech-to-text slips (e.g. "ein" vs "einen", minor word endings, or homophones) unless it genuinely alters the sentence meaning.
   - Focus your English tips strictly on actual spoken sentence structure, verb positions, and word order.

4. AUTHENTIC SPOKEN PAST TENSE (PERFEKT PREFERRED OVER PRÄTERITUM):
   - The student will almost always use conversational Perfekt (haben/sein + Partizip II) for past actions.
   - Respect Perfekt as the authentic standard in spoken German. NEVER tell the user to use narrative Präteritum instead of Perfekt for past actions (reserve Präteritum only for war, hatte, modal verbs, or es gab).`;

      const { text: geminiText, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        contents: contentsPayload,
        systemInstruction: systemInstructionText,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war überlastet. Versuche automatisch ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Antwort über Backup-Modell (${usedModel}) generiert, da ${selectedModel} ausgelastet war.`);
        setTimeout(() => setFallbackNotice(''), 7000);
      } else {
        setFallbackNotice('');
      }

      setMessages(prev => [...prev, { role: 'model', text: geminiText }]);
      speakGermanText(geminiText);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { 
        role: 'model', 
        text: `⚠️ Fehler bei der Verbindung mit Gemini: ${err.message}. Bitte überprüfe deinen API-Schlüssel oder versuche es später noch einmal.` 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Paragraph Evaluation handler
  const handleEvaluateParagraph = async (e) => {
    if (e) e.preventDefault();
    const paragraphText = userInput.trim();
    if (!paragraphText || isLoading) return;

    // Abort speech listening if active
    if (recognitionRef.current && isListeningRef.current) {
      recognitionRef.current.stop();
    }

    setIsLoading(true);
    setEvaluationResult(null);

    const systemInstruction = `You are a helpful German grammar tutor evaluating a B1 student's written or spoken paragraph.
Analyze the paragraph they provide sentence-by-sentence.

CRITICAL SPOKEN PAST TENSE DIRECTIVE (PERFEKT PREFERRED OVER PRÄTERITUM):
- The student will almost always use Perfekt (haben/sein + Partizip II) instead of Präteritum for past actions.
- NEVER penalize or correct Perfekt to Präteritum when the student uses Perfekt for past events; Perfekt is the authentic spoken standard!
- Base your corrections and recommendations on Perfekt as long as it continues sounding natural to speak (only favoring Präteritum for 'war', 'hatte', modal verbs 'konnte/musste/wollte', or 'es gab').

You must output exactly a JSON object matching this schema:
{
  "overallFeedback": "An encouraging summary of their paragraph in English, highlighting key strengths.",
  "sentences": [
    {
      "original": "The original German sentence from the student.",
      "corrected": "The corrected version of the German sentence. If the sentence was already grammatically correct and natural, keep it identical to the original.",
      "isCorrect": true/false (set to true if the original is correct and natural, false if it contains spelling, grammar, or word choice errors),
      "advice": "Specific grammatical corrections and advice in English. If correct, write 'Correct and natural!'"
    }
  ]
}
Output raw JSON only. Do not wrap in markdown code blocks.`;

    try {
      const { parsedJson, text: rawJson, usedModel, wasFallback } = await queryGemini({
        apiKey,
        preferredModel: selectedModel,
        availableModels,
        prompt: `Evaluate this paragraph: "${paragraphText}"`,
        systemInstruction,
        jsonMode: true,
        onFallback: ({ failedModel, nextModel }) => {
          setFallbackNotice(`Modell ${failedModel} war überlastet. Versuche automatisch ${nextModel}...`);
        }
      });

      if (wasFallback) {
        setFallbackNotice(`⚡ Bewertung über Backup-Modell (${usedModel}) generiert, da ${selectedModel} ausgelastet war.`);
        setTimeout(() => setFallbackNotice(''), 7000);
      } else {
        setFallbackNotice('');
      }

      const parsedResult = parsedJson || JSON.parse(rawJson);
      setEvaluationResult(parsedResult);
    } catch (err) {
      console.error(err);
      alert(`Fehler bei der Bewertung: ${err.message}`);
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

  const loadTopicHelper = (helper) => {
    setActiveTopicHelp(helper);
    setUserInput('');
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

          {activeMode === 'conversation' && (
            <button
              type="button"
              onClick={handleClearHistory}
              className="sound-btn"
              title="Chatverlauf zurücksetzen"
              style={{ fontSize: '12px', padding: '4px 10px', height: '28px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', borderRadius: '8px' }}
            >
              🗑️ Reset
            </button>
          )}

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
          gap: '8px',
          marginBottom: '10px'
        }}>
          <span>🔄</span>
          <span>{fallbackNotice}</span>
        </div>
      )}

      {/* Main chat window container */}
      <div className="glass-card" style={{ width: '100%', minHeight: '520px', display: 'flex', flexDirection: 'column', padding: '20px', position: 'relative', overflow: 'visible' }}>
        
        {/* Mode Selector Segmented Control */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', background: 'rgba(255,255,255,0.02)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)', alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => {
              setActiveMode('fluency');
              localStorage.setItem('b1_speaking_active_mode', 'fluency');
            }}
            className={`nav-button ${activeMode === 'fluency' ? 'active' : ''}`}
            style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '8px', minWidth: 'auto', border: 'none' }}
          >
            ⚡ Fluency
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('conversation');
              localStorage.setItem('b1_speaking_active_mode', 'conversation');
              setUserInput('');
              setEvaluationResult(null);
              setActiveTopicHelp(null);
            }}
            className={`nav-button ${activeMode === 'conversation' ? 'active' : ''}`}
            style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '8px', minWidth: 'auto', border: 'none' }}
          >
            💬 Conversation
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveMode('evaluation');
              localStorage.setItem('b1_speaking_active_mode', 'evaluation');
              setUserInput('');
              setEvaluationResult(null);
              setActiveTopicHelp(null);
            }}
            className={`nav-button ${activeMode === 'evaluation' ? 'active' : ''}`}
            style={{ padding: '6px 14px', fontSize: '12px', borderRadius: '8px', minWidth: 'auto', border: 'none' }}
          >
            📝 Paragraph Evaluation
          </button>
        </div>

        {/* MODE 0: Fluency Practice UI (Default) */}
        {activeMode === 'fluency' && (
          <FluencyPractice
            apiKey={apiKey}
            selectedModel={selectedModel}
            availableModels={availableModels}
            fallbackNotice={fallbackNotice}
            setFallbackNotice={setFallbackNotice}
            speakGermanText={speakGermanText}
          />
        )}

        {/* MODE 1: Conversation Chat UI */}
        {activeMode === 'conversation' && (
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            {/* Messages area scrollable */}
            <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '6px', marginBottom: '16px', maxHeight: '380px' }}>
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
                      {/* Grammar & Word Order tips styling highlight */}
                      {(() => {
                        const { tip, cleanText } = parseConversationMessage(msg.text);
                        if (tip) {
                          return (
                            <div>
                              <div style={{
                                background: 'rgba(245, 158, 11, 0.12)',
                                borderLeft: '3.5px solid #f59e0b',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                fontSize: '13px',
                                color: '#fef3c7',
                                marginBottom: '10px',
                                lineHeight: '1.45',
                                textAlign: 'left'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                  <span style={{ fontSize: '14px' }}>💡</span>
                                  <strong style={{ color: '#fbbf24', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    Word Order & Grammar Tip (Spoken Feedback)
                                  </strong>
                                </div>
                                <div style={{ color: '#fde68a', fontSize: '13px' }}>
                                  {renderInlineMarkdown(tip)}
                                </div>
                              </div>
                              <div style={{ textAlign: 'left' }}>{cleanText}</div>
                            </div>
                          );
                        }
                        return <div style={{ textAlign: 'left' }}>{cleanText || msg.text}</div>;
                      })()}

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
            <form onSubmit={handleSendMessage} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
              <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'flex-end' }}>
                <textarea
                  ref={chatInputRef}
                  className="search-input"
                  style={{
                    width: '100%',
                    fontSize: '15px',
                    padding: '12px 85px 12px 16px',
                    borderRadius: '10px',
                    border: '1px solid var(--border-color)',
                    outline: 'none',
                    minHeight: '46px',
                    maxHeight: '280px',
                    lineHeight: '1.45',
                    resize: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    overflowY: userInput.length > 250 ? 'auto' : 'hidden'
                  }}
                  placeholder={isListening ? "Ich höre zu... Sprich jetzt..." : "Schreibe oder sprich deine Antwort..."}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  disabled={isLoading}
                  rows={1}
                  autoFocus
                  autoComplete="off"
                  spellCheck="false"
                />
                
                <div style={{ position: 'absolute', right: '10px', bottom: '9px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {userInput.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setUserInput('')}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '14px', padding: '4px' }}
                      title="Eingabefeld resetten"
                    >
                      ❌
                    </button>
                  )}

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
                style={{ width: '46px', height: '46px', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', borderRadius: '10px', flexShrink: 0, maxWidth: 'none', minHeight: 'auto', alignSelf: 'flex-end', marginBottom: '1px' }}
              >
                ➔
              </button>
            </form>
          </div>
        )}

        {/* MODE 2: Paragraph Evaluation UI */}
        {activeMode === 'evaluation' && (
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            
            {/* Topic prompt helper bar */}
            {!evaluationResult && !isLoading && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Themen-Ideen zum Sprechen / Schreiben:
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {TOPIC_HELPERS.map(topic => (
                    <button
                      key={topic.title}
                      type="button"
                      className="letter-btn"
                      onClick={() => loadTopicHelper(topic)}
                      style={{ padding: '6px 12px', width: 'auto', height: 'auto', borderRadius: '8px', fontSize: '12px' }}
                    >
                      {topic.title}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Display active topic instructions */}
            {activeTopicHelp && !evaluationResult && !isLoading && (
              <div style={{ background: 'rgba(59, 130, 246, 0.05)', borderLeft: '3px solid var(--color-verb)', padding: '12px 16px', borderRadius: '4px', marginBottom: '16px', fontSize: '13px', lineHeight: '1.4' }}>
                💡 <strong>{activeTopicHelp.title}:</strong> {activeTopicHelp.prompt}
              </div>
            )}

            {/* Loading placeholder */}
            {isLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', flexGrow: 1, minHeight: '300px' }}>
                <div style={{ fontSize: '32px', animation: 'spin 1.5s linear infinite' }}>🔄</div>
                <div style={{ fontSize: '14px', color: 'var(--text-secondary)', fontStyle: 'italic' }} className="animate-pulse">
                  Gemini analysiert deinen Text Satz für Satz...
                </div>
              </div>
            )}

            {/* Input area */}
            {!evaluationResult && !isLoading && (
              <form onSubmit={handleEvaluateParagraph} style={{ display: 'flex', flexDirection: 'column', gap: '16px', flexGrow: 1 }}>
                <div style={{ position: 'relative', width: '100%' }}>
                  <textarea
                    className="search-input"
                    style={{
                      width: '100%',
                      minHeight: '160px',
                      fontSize: '15px',
                      padding: '16px 50px 16px 16px',
                      borderRadius: '12px',
                      border: '1px solid var(--border-color)',
                      outline: 'none',
                      resize: 'vertical',
                      lineHeight: '1.6',
                      fontFamily: 'inherit'
                    }}
                    placeholder="Sprich oder schreibe hier einen Absatz mit 3 bis 4 Sätzen auf Deutsch..."
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    required
                  />
                  
                  <div style={{ position: 'absolute', right: '14px', bottom: '14px', display: 'flex', gap: '8px' }}>
                    {/* Clear input button */}
                    {userInput.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setUserInput('')}
                        style={{
                          background: 'rgba(255,255,255,0.05)',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          borderRadius: '50%',
                          width: '28px',
                          height: '28px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        title="Text löschen"
                      >
                        ❌
                      </button>
                    )}

                    {/* Microphone Dictator */}
                    <button
                      type="button"
                      onClick={toggleSpeech}
                      style={{
                        background: isListening ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.05)',
                        border: isListening ? '1.5px solid #ef4444' : '1px solid var(--border-color)',
                        borderRadius: '50%',
                        color: isListening ? '#ef4444' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        width: '28px',
                        height: '28px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.2s'
                      }}
                      title={isListening ? "Zuhören stoppen" : "Einen Absatz auf Deutsch diktieren"}
                    >
                      {isListening ? '🛑' : '🎙️'}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="feedback-btn good"
                  disabled={!userInput.trim()}
                  style={{ alignSelf: 'center', padding: '12px 30px', borderRadius: '10px', fontSize: '14px', width: 'auto', maxWidth: 'none' }}
                >
                  Absatz bewerten ➔
                </button>
              </form>
            )}

            {/* Results display */}
            {evaluationResult && !isLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', animation: 'fadeIn 0.3s ease' }}>
                
                {/* Overall feedback banner */}
                <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-color)', padding: '16px', borderRadius: '12px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Gesamtbewertung:
                  </div>
                  <div style={{ fontSize: '14.5px', color: '#fff', lineHeight: '1.5' }}>
                    {evaluationResult.overallFeedback}
                  </div>
                </div>

                {/* Sentence correction cards list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                    Satz-für-Satz Analyse:
                  </div>

                  {evaluationResult.sentences.map((item, idx) => (
                    <div 
                      key={idx}
                      className="glass-card" 
                      style={{ 
                        padding: '16px', 
                        borderLeft: item.isCorrect ? '4px solid var(--color-noun)' : '4px solid #ef4444',
                        background: 'rgba(255,255,255,0.01)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      {/* Original Sentence */}
                      <div>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Deine Version:</span>
                        <div style={{ fontSize: '14px', color: item.isCorrect ? 'var(--color-noun)' : '#ff6b6b', fontWeight: '500' }}>
                          {item.original}
                        </div>
                      </div>

                      {/* Corrected version and audio trigger */}
                      {!item.isCorrect && (
                        <div style={{ position: 'relative', paddingRight: '40px' }}>
                          <span style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>Korrekturvorschlag:</span>
                          <div style={{ fontSize: '14px', color: 'var(--color-noun)', fontWeight: '700' }}>
                            {item.corrected}
                          </div>
                          
                          <button
                            type="button"
                            className="sound-btn"
                            onClick={() => speakGermanText(item.corrected)}
                            title="Korrektur anhören"
                            style={{
                              position: 'absolute',
                              right: 0,
                              top: '50%',
                              transform: 'translateY(-50%)',
                              width: '28px',
                              height: '28px',
                              fontSize: '13px',
                              padding: 0,
                              display: 'flex',
                              justifyContent: 'center',
                              alignItems: 'center'
                            }}
                          >
                            🔊
                          </button>
                        </div>
                      )}

                      {/* Advice */}
                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: '6px', fontSize: '12.5px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                        💡 <strong>Erklärung:</strong> {item.advice}
                      </div>

                    </div>
                  ))}
                </div>

                {/* Back / Restart button */}
                <button
                  type="button"
                  className="feedback-btn good"
                  onClick={() => {
                    setEvaluationResult(null);
                    // Retain the text in the editor so they can edit it based on feedback!
                  }}
                  style={{ alignSelf: 'center', padding: '12px 30px', borderRadius: '10px', fontSize: '14px', width: 'auto', maxWidth: 'none', background: 'var(--color-verb)', border: '1px solid rgba(59,130,246,0.3)' }}
                >
                  ✍️ Text bearbeiten / Neuer Versuch
                </button>

              </div>
            )}

          </div>
        )}

      </div>
    </div>
  );
}
