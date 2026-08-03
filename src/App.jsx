import React, { useState, useEffect, useMemo } from 'react';
import WordList from './components/WordList';
import Flashcards from './components/Flashcards';
import ClozePractice from './components/ClozePractice';
import ReorderPractice from './components/ReorderPractice';
import Stats from './components/Stats';
import './index.css';

function App() {
  const [vocabData, setVocabData] = useState({ nouns: [], verbs: [], adjectives: [], connectors: [] });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('explorer');
  const [reviews, setReviews] = useState([]);

  // Fetch vocabulary JSON dataset
  useEffect(() => {
    fetch('/b1_vocab_data.json')
      .then(res => res.json())
      .then(data => {
        setVocabData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load vocabulary data:", err);
        setLoading(false);
      });
  }, []);

  // Load reviews from localStorage on initialization
  useEffect(() => {
    const savedReviews = localStorage.getItem('b1_dashboard_reviews');
    if (savedReviews) {
      try {
        setReviews(JSON.parse(savedReviews));
      } catch (e) {
        console.error("Failed to parse reviews from localStorage:", e);
      }
    }
  }, []);

  // Handle reviewing a word (updates state + persists in localStorage)
  const handleReviewWord = (word, category, rating) => {
    const newReview = {
      word,
      category,
      rating,
      timestamp: Date.now()
    };
    const updatedReviews = [...reviews, newReview];
    setReviews(updatedReviews);
    localStorage.setItem('b1_dashboard_reviews', JSON.stringify(updatedReviews));
  };

  // Reset all study stats
  const handleResetStats = () => {
    setReviews([]);
    localStorage.removeItem('b1_dashboard_reviews');
  };

  // Compute progress stats dynamically based on logs
  const computedStats = useMemo(() => {
    const uniqueReviewedWords = new Set();
    const lastRatingMap = {};

    // Sort chronologically so we get the latest rating
    const sortedReviews = [...reviews].sort((a, b) => a.timestamp - b.timestamp);
    sortedReviews.forEach(r => {
      uniqueReviewedWords.add(r.word);
      lastRatingMap[r.word] = r.rating;
    });

    const totalReviewed = uniqueReviewedWords.size;
    const masteryCount = Object.values(lastRatingMap).filter(rating => rating === 'easy').length;

    const categoryTotals = {
      nouns: vocabData.nouns?.length || 0,
      verbs: vocabData.verbs?.length || 0,
      adjectives: vocabData.adjectives?.length || 0,
      connectors: vocabData.connectors?.length || 0
    };

    const categoryReviewed = { nouns: 0, verbs: 0, adjectives: 0, connectors: 0 };

    const uniqueWordCategory = {};
    sortedReviews.forEach(r => {
      uniqueWordCategory[r.word] = r.category;
    });

    Object.entries(uniqueWordCategory).forEach(([word, category]) => {
      if (categoryReviewed[category] !== undefined) {
        categoryReviewed[category]++;
      }
    });

    const categoryProgress = {
      nouns: { reviewed: categoryReviewed.nouns, total: categoryTotals.nouns },
      verbs: { reviewed: categoryReviewed.verbs, total: categoryTotals.verbs },
      adjectives: { reviewed: categoryReviewed.adjectives, total: categoryTotals.adjectives },
      connectors: { reviewed: categoryReviewed.connectors, total: categoryTotals.connectors }
    };

    // Calculate streak
    let streak = 0;
    if (reviews.length > 0) {
      const uniqueDates = Array.from(new Set(
        reviews.map(r => new Date(r.timestamp).toDateString())
      )).map(d => new Date(d));

      uniqueDates.sort((a, b) => b.getTime() - a.getTime()); // Descending order

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (uniqueDates.length > 0) {
        const latestReviewDate = uniqueDates[0];
        latestReviewDate.setHours(0, 0, 0, 0);

        if (latestReviewDate.getTime() === today.getTime() || latestReviewDate.getTime() === yesterday.getTime()) {
          streak = 1;
          for (let i = 0; i < uniqueDates.length - 1; i++) {
            const current = new Date(uniqueDates[i]);
            current.setHours(0, 0, 0, 0);

            const prev = new Date(uniqueDates[i + 1]);
            prev.setHours(0, 0, 0, 0);

            const diffTime = Math.abs(current.getTime() - prev.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
              streak++;
            } else if (diffDays > 1) {
              break;
            }
          }
        }
      }
    }

    return {
      totalReviewed,
      masteryCount,
      categoryProgress,
      streak
    };
  }, [reviews, vocabData]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        backgroundColor: '#090a0f',
        color: '#f3f4f6',
        fontSize: '20px',
        fontWeight: '600',
        fontFamily: 'sans-serif'
      }}>
        Initializing Deutsch B1 Dashboard...
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="logo-badge">DE</div>
          <div className="logo-text">
            <h1>Deutsch B1</h1>
            <p>Vocabulary Learning Center</p>
          </div>
        </div>

        <nav className="app-nav">
          <button
            className={`nav-button ${activeTab === 'explorer' ? 'active' : ''}`}
            onClick={() => setActiveTab('explorer')}
          >
            📖 Word List
          </button>
          <button
            className={`nav-button ${activeTab === 'practice' ? 'active' : ''}`}
            onClick={() => setActiveTab('practice')}
          >
            🗂️ Ankii
          </button>
          <button
            className={`nav-button ${activeTab === 'cloze' ? 'active' : ''}`}
            onClick={() => setActiveTab('cloze')}
          >
            📝 Fill in blanks
          </button>
          <button
            className={`nav-button ${activeTab === 'reorder' ? 'active' : ''}`}
            onClick={() => setActiveTab('reorder')}
          >
            🧩 Reorder
          </button>
          <button
            className={`nav-button ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            📈 Stats
          </button>
        </nav>
      </header>

      <main style={{ flexGrow: 1 }}>
        {activeTab === 'explorer' && <WordList vocabData={vocabData} />}
        {activeTab === 'practice' && <Flashcards vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'cloze' && <ClozePractice vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'reorder' && <ReorderPractice vocabData={vocabData} onReview={handleReviewWord} />}
        {activeTab === 'stats' && <Stats stats={computedStats} reviews={reviews} onResetStats={handleResetStats} />}
      </main>
    </div>
  );
}

export default App;
