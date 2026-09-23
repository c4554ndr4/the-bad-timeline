import { useState, useEffect } from 'react'
import Tweet from './components/Tweet'
import PaymentModal from './components/PaymentModal'
import PaymentSuccess from './components/PaymentSuccess'
import DiscountCodeRedemption from './components/DiscountCodeRedemption'
import { supabase, isSupabaseConfigured } from './lib/supabase'
import api from './lib/api'
import './App.css'

function App() {
  const [tweets, setTweets] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [preferences, setPreferences] = useState([])
  const [newPreference, setNewPreference] = useState('')
  const [feedbackBoxOpen, setFeedbackBoxOpen] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  
  // Auth state
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [authMode, setAuthMode] = useState('login') // 'login' or 'register'
  const [authLoading, setAuthLoading] = useState(false)
  const [authForm, setAuthForm] = useState({
    email: '',
    password: '',
    username: ''
  })

  const getAuthConfig = async () => {
    if (!isSupabaseConfigured) {
      throw new Error('Supabase authentication is not configured')
    }

    const { data: { session: currentSession } } = await supabase.auth.getSession()
    const authToken = currentSession?.access_token || session?.access_token
    
    if (!authToken) {
      throw new Error('Authentication required')
    }

    return {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    }
  }

  // Payment state
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [userCredits, setUserCredits] = useState(0)
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false)

  const fetchTweets = async () => {
    try {
      // Artificial loading delay for better UX
      await new Promise(resolve => setTimeout(resolve, 800))
      
      const response = await api.get('/api/tweets?page=1&limit=10')
      console.log('Fetched initial tweets:', response.data)
      
      if (response.data.tweets) {
        // New paginated format
        setTweets(response.data.tweets)
        setHasMore(response.data.hasMore)
        setCurrentPage(1)
      } else if (Array.isArray(response.data)) {
        // Fallback for old format
        setTweets(response.data)
        setHasMore(response.data.length >= 10)
      } else {
        setTweets([])
        setHasMore(false)
      }
    } catch (error) {
      console.error('Error fetching tweets:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchPreferences = async () => {
    if (!isSupabaseConfigured) {
      return
    }

    try {
      const config = await getAuthConfig()
      const response = await api.get('/api/preferences', config)
      setPreferences(response.data)
    } catch (error) {
      console.error('Error fetching preferences:', error)
    }
  }

  const fetchUserCredits = async () => {
    if (!isSupabaseConfigured || !user || !session) {
      setUserCredits(0)
      return
    }

    try {
      const config = await getAuthConfig()
      const response = await api.get('/api/user/credits', config)
      setUserCredits(response.data.credits)
      console.log(`💰 Fetched credits: ${response.data.credits}`)
    } catch (error) {
      console.error('Error fetching user credits:', error)
      
      // Fallback to localStorage if Supabase API is not available yet
      console.log('🔄 Falling back to localStorage for credits...')
      const localCredits = localStorage.getItem('userCredits')
      if (localCredits && parseInt(localCredits) > 0) {
        setUserCredits(parseInt(localCredits))
        console.log(`💰 Using localStorage credits: ${localCredits}`)
      } else {
        setUserCredits(0)
        console.log('💰 No credits available in localStorage either')
      }
    }
  }

  const addPreference = async () => {
    if (!newPreference.trim()) return
    if (!isSupabaseConfigured) {
      alert('Supabase must be configured to save preferences.')
      return
    }
    
    try {
      const config = await getAuthConfig()
      await api.post('/api/preferences', { text: newPreference }, config)
      await fetchPreferences()
      setNewPreference('')
    } catch (error) {
      console.error('Error adding preference:', error)
    }
  }

  const deletePreference = async (preferenceId) => {
    if (!isSupabaseConfigured) {
      alert('Supabase must be configured to remove preferences.')
      return
    }

    try {
      const config = await getAuthConfig()
      await api.delete(`/api/preferences/${preferenceId}`, config)
      setPreferences(prev => prev.filter((pref) => pref.id !== preferenceId))
    } catch (error) {
      console.error('Error deleting preference:', error)
    }
  }

  const handleLike = (tweetId) => {
    setTweets(prev => prev.map(tweet => 
      tweet.id === tweetId ? { ...tweet, likes: tweet.likes + 1 } : tweet
    ))
  }

  const loadMoreTweets = async () => {
    if (generating || loading || !hasMore) return
    setGenerating(true)
    try {
      // Artificial loading delay for cached tweets (feels more natural)
      await new Promise(resolve => setTimeout(resolve, 600))
      
      const nextPage = currentPage + 1
      const response = await api.get(`/api/tweets?page=${nextPage}&limit=10`)
      console.log('Loaded more tweets:', response.data)
      
      if (response.data.tweets) {
        // New paginated format
        setTweets(prev => [...prev, ...response.data.tweets])
        setHasMore(response.data.hasMore)
        setCurrentPage(nextPage)
      } else if (Array.isArray(response.data)) {
        // Fallback for old format
        setTweets(prev => [...prev, ...response.data])
        setHasMore(response.data.length >= 10)
        setCurrentPage(nextPage)
      }
    } catch (error) {
      console.error('Error loading more tweets:', error)
    } finally {
      setGenerating(false)
    }
  }

  const generateNewTweets = async () => {
    if (generating) return
    if (!isSupabaseConfigured) {
      alert('Supabase must be configured to generate personalized tweets.')
      return
    }
    
    // Check if user is logged in
    if (!user || !session) {
      console.log('No user or session, opening auth modal')
      setAuthModalOpen(true)
      return
    }
    
    // Check if user has credits (need at least 1 credit per tweet, 10 credits for 10 tweets)
    if (userCredits < 10) {
      console.log('Insufficient credits available')
      alert('You need at least 10 credits to generate 10 tweets. Please purchase credits or redeem a discount code.')
      return
    }
    
    console.log(`User logged in, attempting to generate tweets. User: ${user.email}, Credits: ${userCredits}`)
    
    setGenerating(true)
    try {
      const config = await getAuthConfig()
      const response = await api.post('/api/tweets/generate', { count: 10 }, config)
      console.log('Generated new tweets:', response.data)
      
      if (response.data.tweets) {
        setTweets(prev => [...prev, ...response.data.tweets])
        
        // Update credits from API response if available
        if (response.data.creditsRemaining !== undefined) {
          setUserCredits(response.data.creditsRemaining)
        } else {
          // Fallback: manually subtract credits from localStorage
          const currentCredits = parseInt(localStorage.getItem('userCredits') || userCredits.toString())
          const creditsUsed = response.data.tweets.length * 1 // Now 1 credit per tweet
          const newCredits = Math.max(0, currentCredits - creditsUsed)
          localStorage.setItem('userCredits', newCredits.toString())
          setUserCredits(newCredits)
        }
        
        console.log(`✨ Generated ${response.data.tweets.length} tweets using API`)
        
      } else if (Array.isArray(response.data)) {
        setTweets(prev => [...prev, ...response.data])
        
        // For legacy format, consume credits locally
        const creditsUsed = response.data.length * 1 // Now 1 credit per tweet
        const currentCredits = parseInt(localStorage.getItem('userCredits') || userCredits.toString())
        const newCredits = Math.max(0, currentCredits - creditsUsed)
        localStorage.setItem('userCredits', newCredits.toString())
        setUserCredits(newCredits)
        
        console.log(`✨ Generated ${response.data.length} tweets using legacy format`)
      }
      
      // After generating new tweets, we might have more content
      setHasMore(true)
    } catch (error) {
      console.error('Error generating new tweets:', error)
      
      // Show user-friendly error message
      if (error.response?.status === 401) {
        setAuthModalOpen(true)
      } else if (error.response?.status === 402) {
        alert('Insufficient credits. Please purchase more credits to continue.')
      } else {
        console.log('🔄 Tweet generation API failed, this might be expected if Supabase API is not fully deployed yet')
        alert('Tweet generation is currently unavailable. Please try again later or redeem a discount code for credits.')
      }
    } finally {
      setGenerating(false)
    }
  }

  // Authentication functions
  const checkCurrentUser = async () => {
    if (!isSupabaseConfigured) {
      setUser(null)
      setSession(null)
      return
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      setSession(session)
      setUser(session?.user || null)
    } catch (error) {
      console.error('Auth check error:', error)
      setUser(null)
      setSession(null)
    }
  }

  const handleAuth = async (e) => {
    e.preventDefault()
    setAuthLoading(true)
    
    try {
      if (!isSupabaseConfigured) {
        alert('Supabase must be configured for authentication.')
        return
      }

      let result
      
      if (authMode === 'login') {
        // For login, require email if not using anonymous mode
        const loginEmail = authForm.email || `anonymous_${Date.now()}@fake.com`
        result = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password: authForm.password
        })
      } else {
        // For signup, generate email if not provided
        const signupEmail = authForm.email || `user_${Date.now()}@fake.com`
        const username = authForm.username || `user_${Date.now()}`
        
        result = await supabase.auth.signUp({
          email: signupEmail,
          password: authForm.password,
          options: {
            data: {
              username: username,
              display_name: username
            }
          }
        })
      }
      
      if (result.error) {
        throw result.error
      }
      
      if (result.data.user) {
        setUser(result.data.user)
        setSession(result.data.session)
        setAuthModalOpen(false)
        setAuthForm({ email: '', password: '', username: '' })
        await fetchUserCredits()
        
        if (authMode === 'register') {
          if (!result.data.session) {
            // If email confirmation is required
            alert('Account created! If you provided an email, please check it for verification. You can also log in now with your password.')
          } else {
            // Immediate sign in (email confirmation disabled)
            alert('Account created and you are now logged in!')
          }
        }
      }
      
      console.log(`${authMode} successful:`, result.data.user)
    } catch (error) {
      console.error('Auth error:', error)
      
      let errorMessage = error.message || `${authMode} failed`
      
      // Handle specific error cases
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.message?.includes('fetch') || error.message === 'Network Error') {
        errorMessage = 'Network error: Unable to connect to authentication service. Please check your internet connection.'
      } else if (error.message?.includes('Invalid login credentials')) {
        errorMessage = 'Invalid email or password. Please check your credentials.'
      } else if (error.message?.includes('User already registered')) {
        errorMessage = 'An account with this email already exists. Try logging in instead.'
      } else if (error.message?.includes('Password')) {
        errorMessage = 'Password must be at least 6 characters long.'
      }
      
      alert(errorMessage)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    try {
      if (isSupabaseConfigured) {
        await supabase.auth.signOut()
      } else {
        alert('Supabase must be configured to log out.')
      }
      setUser(null)
      setSession(null)
    } catch (error) {
      console.error('Logout error:', error)
      setUser(null)
      setSession(null)
    }
  }

  useEffect(() => {
    // Check for payment success
    const urlParams = new URLSearchParams(window.location.search)
    if (urlParams.get('session_id')) {
      setShowPaymentSuccess(true)
    }

    fetchTweets()
    fetchPreferences()
    checkCurrentUser()

    let authSubscription
    if (isSupabaseConfigured) {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, session) => {
          setSession(session)
          setUser(session?.user || null)
          if (session?.user) {
            fetchUserCredits()
          } else {
            setUserCredits(0)
          }
        }
      )
      authSubscription = subscription
    }

    // Listen for credits updates from payment success
    const handleCreditsUpdate = (event) => {
      const newCredits = parseInt(event.detail.credits)
      console.log('💰 Credits updated via event:', newCredits)
      setUserCredits(newCredits)
      
      // Force a state update to ensure re-render
      setTimeout(() => {
        const localCredits = parseInt(localStorage.getItem('userCredits') || '0')
        console.log(`🔄 Force re-render check: event=${newCredits}, localStorage=${localCredits}, current=${userCredits}`)
        if (localCredits > 0 && localCredits !== userCredits) {
          console.log(`🔄 Force updating credits to: ${localCredits}`)
          setUserCredits(localCredits)
        }
      }, 200)
    }

    window.addEventListener('creditsUpdated', handleCreditsUpdate)

    return () => {
      authSubscription?.unsubscribe?.()
      window.removeEventListener('creditsUpdated', handleCreditsUpdate)
    }
  }, [])

  // Fetch credits when user changes
  useEffect(() => {
    if (user && session) {
      fetchUserCredits()
    }
  }, [user, session])

  useEffect(() => {
    if (loading || tweets.length === 0) return

    const sentinel = document.getElementById('load-more-sentinel')
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !generating) {
          // Smart loading: try to load cached tweets first, then generate if user has credits
          if (hasMore) {
            // Load more cached tweets from the API
            loadMoreTweets()
          } else if (user && session && userCredits >= 10) {
            // No more cached tweets, but user has credits - generate new ones (need 10 credits for 10 tweets at 1 credit each)
            console.log('🚀 Auto-generating new tweets at end of feed')
            generateNewTweets()
          }
          // If no credits or not logged in, just show the appropriate message (no action needed)
        }
      },
      { threshold: 0.1, rootMargin: '100px' }
    )

    observer.observe(sentinel)

    return () => {
      observer.disconnect()
    }
  }, [generating, loading, tweets.length, hasMore, user, session, userCredits])

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>The Bad Timeline</h1>
          <div className="header-actions">
            {user ? (
              <div className="user-menu">
                <div className="credits-display">
                  <span className="user-info">
                    {user.email} 
                    <small>({userCredits} credits)</small>
                  </span>
                  <button 
                    onClick={() => setPaymentModalOpen(true)} 
                    className="buy-credits-btn"
                  >
                    Buy Credits
                  </button>
                </div>
                <button onClick={handleLogout} className="logout-btn">
                  Logout
                </button>
              </div>
            ) : (
              <button onClick={() => setAuthModalOpen(true)} className="login-btn">
                Login / Sign Up
              </button>
            )}
          </div>
        </div>
      </header>


      <main className="timeline">
        {loading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <div>Loading...</div>
          </div>
        ) : (
          <>
            {tweets.map(tweet => (
              <Tweet key={tweet.id} tweet={tweet} onLike={handleLike} />
            ))}
            <div id="load-more-sentinel" style={{ height: '20px', background: 'transparent' }} />
            {tweets.length > 0 && (
              <div className="end-of-feed">
                <div className="end-message">
                  {(() => {
                    const creditsAsNumber = parseInt(userCredits) || 0
                    
                    if (generating) {
                      return (
                        <div className="loading-more">
                          <div className="loading-spinner"></div>
                          <p>Generating more tweets...</p>
                        </div>
                      )
                    } else if (user && session && creditsAsNumber >= 10) {
                      // User has credits - show auto-loading message
                      return (
                        <div className="auto-loading-message">
                          <p>✨ Keep scrolling - more tweets will load automatically</p>
                          <small>{creditsAsNumber} credits remaining</small>
                        </div>
                      )
                    } else if (user && session && creditsAsNumber < 10) {
                      // User logged in but insufficient credits
                      return (
                        <div className="no-credits-message">
                          <p>💳 Purchase more credits to continue</p>
                          <small>You need at least 10 credits to generate 10 more tweets</small>
                        </div>
                      )
                    } else {
                      // User not logged in
                      return (
                        <div className="login-required-message">
                          <p>🔐 <button className="inline-login-btn" onClick={() => setAuthModalOpen(true)}>Log in</button> to generate more tweets</p>
                          <small>Get unlimited access to AI-generated content</small>
                        </div>
                      )
                    }
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating Feedback Box */}
      <div className={`feedback-box ${feedbackBoxOpen ? 'open' : ''}`}>
        <div className="feedback-header" onClick={() => setFeedbackBoxOpen(!feedbackBoxOpen)}>
          <span>💭</span>
          <span className="feedback-title">Feedback</span>
          <span className="feedback-toggle">{feedbackBoxOpen ? '−' : '+'}</span>
        </div>
        
        {feedbackBoxOpen && (
          <div className="feedback-content">
            <h3>Tell me what you want more of:</h3>
            <div className="preference-input">
              <input
                type="text"
                value={newPreference}
                onChange={(e) => setNewPreference(e.target.value)}
                placeholder="e.g., more tech humor, less existential dread..."
                className="preference-field"
                onKeyPress={(e) => e.key === 'Enter' && addPreference()}
              />
              <button onClick={addPreference} className="add-preference-btn">
                Add
              </button>
            </div>
            {preferences.length > 0 && (
              <div className="preference-list">
                <h4>Your preferences:</h4>
                {preferences.map((pref) => (
                  <span key={pref.id} className="preference-tag" title={`Added ${new Date(pref.createdAt || Date.now()).toLocaleString()}`}>
                    {pref.text}
                    <button 
                      onClick={() => deletePreference(pref.id)}
                      className="delete-preference"
                      title="Delete preference"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Auth Modal */}
      {authModalOpen && (
        <div className="modal-overlay" onClick={() => setAuthModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{authMode === 'login' ? 'Log In to Generate More Tweets' : 'Sign Up to Generate More Tweets'}</h2>
              <button 
                className="modal-close"
                onClick={() => setAuthModalOpen(false)}
              >
                ×
              </button>
            </div>
            
            <form onSubmit={handleAuth} className="auth-form">

              
              {authMode === 'register' && (
                <div className="form-group">
                  <label htmlFor="username">Username (optional)</label>
                  <input
                    type="text"
                    id="username"
                    value={authForm.username}
                    onChange={(e) => setAuthForm(prev => ({
                      ...prev,
                      username: e.target.value
                    }))}
                    placeholder="Choose a username"
                  />
                </div>
              )}
              
              <div className="form-group">
                <label htmlFor="email">Email (optional)</label>
                <input
                  type="email"
                  id="email"
                  value={authForm.email}
                  onChange={(e) => setAuthForm(prev => ({
                    ...prev,
                    email: e.target.value
                  }))}
                  placeholder="your@email.com (or leave blank)"
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="password">Password</label>
                <input
                  type="password"
                  id="password"
                  value={authForm.password}
                  onChange={(e) => setAuthForm(prev => ({
                    ...prev,
                    password: e.target.value
                  }))}
                  placeholder="Password"
                  minLength={6}
                  required
                />
              </div>
              
              <button 
                type="submit" 
                className="auth-submit-btn"
                disabled={authLoading}
              >
                {authLoading ? (
                  <span>
                    <span className="loading-spinner"></span>
                    {authMode === 'login' ? 'Logging in...' : 'Signing up...'}
                  </span>
                ) : (
                  authMode === 'login' ? 'Log In' : 'Sign Up'
                )}
              </button>
            </form>
            
            <div className="auth-switch">
              {authMode === 'login' ? (
                <p>
                  Don't have an account? 
                  <button 
                    onClick={() => setAuthMode('register')}
                    className="auth-switch-btn"
                  >
                    Sign Up
                  </button>
                </p>
              ) : (
                <p>
                  Already have an account? 
                  <button 
                    onClick={() => setAuthMode('login')}
                    className="auth-switch-btn"
                  >
                    Log In
                  </button>
                </p>
              )}
            </div>
            
            <div className="auth-info">
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      <PaymentModal 
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onSuccess={(creditsAdded) => {
          setUserCredits(prev => prev + creditsAdded)
          alert(`Successfully added ${creditsAdded} credits!`)
        }}
      />

      {/* Payment Success */}
      {showPaymentSuccess && (
        <PaymentSuccess 
          onClose={() => {
            setShowPaymentSuccess(false)
            // Clean up URL
            window.history.replaceState({}, document.title, window.location.pathname)
            // Refresh credits
            fetchUserCredits()
          }}
        />
      )}

      {/* Promo Code in bottom corner - Always show for development */}
      <DiscountCodeRedemption 
        onCreditsAdded={(creditsAdded, totalCredits) => {
          console.log(`🎁 Discount code redeemed: +${creditsAdded} credits, total: ${totalCredits}`)
          // Credits will be updated via the event listener
        }}
      />
    </div>
  )
}

export default App
