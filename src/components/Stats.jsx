import React from 'react';

export default function Stats({ stats, reviews, onResetStats }) {
  const getPercentage = (reviewed, total) => {
    if (!total || total === 0) return 0;
    return Math.round((reviewed / total) * 100);
  };

  const getRecentReviews = () => {
    // Sort reviews by timestamp descending
    return [...reviews].sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  };

  return (
    <div className="stats-layout animate-fade-in">
      
      {/* Top Cards Section */}
      <div className="stats-summary-cards">
        <div className="glass-card stats-card-premium Nouns">
          <div className="stats-card-label">🔥 Practice Streak</div>
          <div className="stats-card-value">{stats.streak || 0} Days</div>
          <div className="stats-card-desc">Keep practicing daily to build your retention streak!</div>
        </div>
        
        <div className="glass-card stats-card-premium Verbs">
          <div className="stats-card-label">🧠 Total Cards Reviewed</div>
          <div className="stats-card-value">{stats.totalReviewed || 0} Words</div>
          <div className="stats-card-desc">Total unique flashcards practiced in your sessions.</div>
        </div>

        <div className="glass-card stats-card-premium Adjectives">
          <div className="stats-card-label">🎓 Estimated Mastery</div>
          <div className="stats-card-value">
            {getPercentage(stats.masteryCount, stats.totalReviewed)}%
          </div>
          <div className="stats-card-desc">Percentage of reviewed words rated as "Easy".</div>
        </div>
      </div>

      {/* Progress Bars Section */}
      <div className="glass-card">
        <h2 className="section-title">📊 Category Progress</h2>
        
        <div style={{display: 'flex', flexDirection: 'column', gap: '20px'}}>
          {/* Nouns */}
          <div className="stat-item">
            <div className="stat-header">
              <span className="stat-title">🟢 Nouns</span>
              <span className="stat-title">
                {stats.categoryProgress?.nouns?.reviewed || 0} / {stats.categoryProgress?.nouns?.total || 0} words ({getPercentage(stats.categoryProgress?.nouns?.reviewed, stats.categoryProgress?.nouns?.total)}%)
              </span>
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar nouns" 
                style={{width: `${getPercentage(stats.categoryProgress?.nouns?.reviewed, stats.categoryProgress?.nouns?.total)}%`}}
              />
            </div>
          </div>

          {/* Verbs */}
          <div className="stat-item">
            <div className="stat-header">
              <span className="stat-title">🔵 Verbs</span>
              <span className="stat-title">
                {stats.categoryProgress?.verbs?.reviewed || 0} / {stats.categoryProgress?.verbs?.total || 0} words ({getPercentage(stats.categoryProgress?.verbs?.reviewed, stats.categoryProgress?.verbs?.total)}%)
              </span>
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar verbs" 
                style={{width: `${getPercentage(stats.categoryProgress?.verbs?.reviewed, stats.categoryProgress?.verbs?.total)}%`}}
              />
            </div>
          </div>

          {/* Adjectives */}
          <div className="stat-item">
            <div className="stat-header">
              <span className="stat-title">🟡 Adjectives</span>
              <span className="stat-title">
                {stats.categoryProgress?.adjectives?.reviewed || 0} / {stats.categoryProgress?.adjectives?.total || 0} words ({getPercentage(stats.categoryProgress?.adjectives?.reviewed, stats.categoryProgress?.adjectives?.total)}%)
              </span>
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar adjectives" 
                style={{width: `${getPercentage(stats.categoryProgress?.adjectives?.reviewed, stats.categoryProgress?.adjectives?.total)}%`}}
              />
            </div>
          </div>

          {/* Connectors */}
          <div className="stat-item">
            <div className="stat-header">
              <span className="stat-title">🟣 Connectors</span>
              <span className="stat-title">
                {stats.categoryProgress?.connectors?.reviewed || 0} / {stats.categoryProgress?.connectors?.total || 0} words ({getPercentage(stats.categoryProgress?.connectors?.reviewed, stats.categoryProgress?.connectors?.total)}%)
              </span>
            </div>
            <div className="progress-bar-container">
              <div 
                className="progress-bar connectors" 
                style={{width: `${getPercentage(stats.categoryProgress?.connectors?.reviewed, stats.categoryProgress?.connectors?.total)}%`}}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Recent Reviews List */}
      <div className="glass-card">
        <h2 className="section-title">🕒 Recent Reviews (Last 10)</h2>
        {reviews.length === 0 ? (
          <div className="empty-state">
            <p>No recent reviews logged. Head over to the practice section to get started!</p>
          </div>
        ) : (
          <div style={{overflowX: 'auto'}}>
            <table className="recent-reviews-table">
              <thead>
                <tr>
                  <th>Word</th>
                  <th>Category</th>
                  <th>Feedback Given</th>
                  <th>Reviewed At</th>
                </tr>
              </thead>
              <tbody>
                {getRecentReviews().map((review, idx) => (
                  <tr key={idx}>
                    <td style={{fontWeight: 700}}>{review.word}</td>
                    <td>
                      <span className={`category-tag ${review.category}`}>
                        {review.category}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${review.rating}`}>
                        {review.rating}
                      </span>
                    </td>
                    <td style={{color: 'var(--text-secondary)'}}>
                      {new Date(review.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reset stats button */}
      <button 
        className="reset-btn"
        onClick={() => {
          if (window.confirm("Are you sure you want to clear your learning history? This will delete all study logs and reset progress to 0%.")) {
            onResetStats();
          }
        }}
      >
        ⚠️ Reset Study History
      </button>
    </div>
  );
}
