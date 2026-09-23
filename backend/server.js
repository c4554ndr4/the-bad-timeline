const express = require('express');
const cors = require('cors');
const Groq = require('groq-sdk');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

// Authentication and user management
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Joi = require('joi');
const Database = require('./database');
const PricingCalculator = require('./pricing');
const configuredCreditsPerDollar = parseInt(process.env.CREDITS_PER_DOLLAR || '200', 10);
const creditsPerDollar = Number.isNaN(configuredCreditsPerDollar) ? 200 : configuredCreditsPerDollar;

// Only load dotenv in local development
if (!process.env.VERCEL) {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
}

const app = express();
const port = process.env.PORT || 5002;

// Initialize services
const database = new Database();
const pricing = new PricingCalculator();

// Security and rate limiting
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || process.env.VERCEL_URL || ['http://localhost:3000', 'http://localhost:5173'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session management
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db' }),
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
  }
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Initialize Groq client with error handling
const groq = process.env.GROQ_API_KEY ? new Groq({
  apiKey: process.env.GROQ_API_KEY,
}) : null;

console.log('Services initialized:', {
  groq: !!groq,
  database: !!database
});

// Load configuration
const config = yaml.load(fs.readFileSync(path.join(__dirname, 'config.yaml'), 'utf8'));

// Load good tweets from YAML file
const goodTweetsPath = path.join(__dirname, '..', 'good_tweets.yaml');
const goodTweetsData = fs.existsSync(goodTweetsPath)
  ? yaml.load(fs.readFileSync(goodTweetsPath, 'utf8')) || {}
  : {};
const STARTING_TWEETS = goodTweetsData.tweets || [];

// In-memory storage for tweets (shared across all users)
let tweets = [];

// Authentication middleware - handles both session and Supabase JWT
const requireAuth = async (req, res, next) => {
  try {
    // Check for session-based auth first (existing users)
    if (req.session.userId) {
      return next();
    }
    
    // Check for Supabase JWT in Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        // Only try Supabase if environment variables are properly configured
        console.log('Supabase config check:', {
          hasURL: !!process.env.SUPABASE_URL,
          hasKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          urlValid: !process.env.SUPABASE_URL?.includes('your_supabase_url_here')
        });
        
        if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && 
            !process.env.SUPABASE_URL.includes('your_supabase_url_here')) {
          
          const { supabase } = require('./lib/supabase');
          
          // Verify the JWT token with Supabase
          const { data: { user }, error } = await supabase.auth.getUser(token);
          
          if (error) throw error;
          
          if (user) {
            // Get or create user in our local database
            let localUser = await database.getUserByEmail(user.email);
            
            if (!localUser) {
              // Create new user in local database
              const tempPassword = 'supabase_user_' + Date.now();
              localUser = await database.createUser(user.email, tempPassword);
              
              // Create Stripe customer if needed
            }
            
            // Set user ID for this request
            req.session.userId = localUser.id;
            req.supabaseUser = user;
            return next();
          }
        } else {
          console.warn('Supabase credentials missing; rejecting bearer token auth to prevent abuse');
          return res.status(401).json({ error: 'Authentication required' });
        }
      } catch (error) {
        console.error('Auth verification error:', error);
        // Fall through to unauthorized
      }
    }
    
    return res.status(401).json({ error: 'Authentication required' });
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Authentication required' });
  }
};

// Optional auth middleware (for public endpoints that can benefit from user context)
const optionalAuth = async (req, res, next) => {
  if (req.session.userId) {
    try {
      req.user = await database.getUserById(req.session.userId);
    } catch (error) {
      console.error('Error loading user:', error);
    }
  }
  next();
};

// Generate tweets function with cost tracking
const generateTweets = async (count = 10, userId = null, userPreferences = []) => {
  try {
    if (!groq) {
      throw new Error('Groq API key not configured');
    }

    // Build context from user preferences and tweet history
    let contextPrompt = config.base_prompt;
    
    // Add user preferences context
    if (userPreferences.length > 0) {
      const preferencesText = userPreferences.map(p => p.text || p).join(', ');
      contextPrompt += `\n\nUser preferences: ${preferencesText}`;
    }
    
    // Add liked tweets context (most important for personalization)
    if (userId) {
      try {
        const likedTweets = await database.getUserLikes(userId, 10);
        if (likedTweets.length > 0) {
          const likedContent = likedTweets.map(like => `"${like.tweet_content}" (by @${like.tweet_author})`).join(', ');
          contextPrompt += `\n\nTweets the user has liked (generate similar style/topics): ${likedContent}`;
        }
      } catch (error) {
        console.error('Error fetching user likes:', error);
      }
    }
    
    // Add recent tweet history for diversity
    if (tweets.length > 0) {
      const recentTweets = tweets.slice(-20).map(t => `"${t.content}"`).join(', ');
      contextPrompt += `\n\nRecent tweets to avoid similarity: ${recentTweets}`;
    }
    
    const completion = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: contextPrompt,
        },
        {
          role: 'user',
          content: config.batch_generation_prompt.replace('{count}', count),
        },
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.9,
      max_tokens: 2000,
              response_format: {
          type: "json_object"
        }
    });

    const responseText = completion.choices[0]?.message?.content?.trim();
    
    if (!responseText) {
      throw new Error('Empty response from API');
    }

    // Track usage and cost if userId provided
    if (userId) {
      const inputTokens = completion.usage?.prompt_tokens || 0;
      const outputTokens = completion.usage?.completion_tokens || 0;
      const cost = pricing.calculateCost('llama-3.3-70b-versatile', inputTokens, outputTokens);
      
      await database.recordUsage(userId, 'llama-3.3-70b-versatile', inputTokens, outputTokens, cost);
    }

    // Parse JSON response
    let tweetsData;
    try {
      const jsonResponse = JSON.parse(responseText);
      tweetsData = jsonResponse.tweets || jsonResponse;
    } catch (parseError) {
      console.error('Failed to parse JSON response:', parseError);
      console.error('Raw response:', responseText);
      throw new Error('Invalid JSON response from AI');
    }

    // Validate and clean the data
    const validTweets = tweetsData
      .filter(tweet => tweet && typeof tweet.content === 'string' && tweet.content.trim().length > 0)
      .slice(0, count)
      .map((tweet, i) => ({
        content: tweet.content.substring(0, 280), // Ensure under 280 chars
        author: tweet.username || tweet.author || `mystic_${Date.now()}_${i}`
      }));

    // If we don't have enough valid tweets, fill with fallbacks
    while (validTweets.length < count) {
      const index = validTweets.length + 1;
      validTweets.push({
        content: `The algorithms are conspiring again... tweet #${index}`,
        author: `backup_${Date.now()}_${index}`
      });
    }

    return validTweets;
  } catch (error) {
    console.error('Error generating tweets:', error);
    throw error;
  }
};

// Generate username function (for backwards compatibility)
const generateUsername = async () => {
  const adjectives = ['Mystic', 'Digital', 'Quantum', 'Ethereal', 'Cosmic', 'Neural', 'Synthetic', 'Astral'];
  const nouns = ['Sage', 'Prophet', 'Oracle', 'Whisper', 'Echo', 'Prism', 'Void', 'Matrix'];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 999);
  
  return `${adjective}${noun}${number}`;
};

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(6).required(),
  displayName: Joi.string().min(1).max(50).optional()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

// Authentication endpoints
app.post('/api/auth/register', async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password, displayName } = value;

    // Create user
    const user = await database.createUser(email, password, displayName);
    
    // Log them in
    req.session.userId = user.id;
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        credits: user.credits
      }
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' && error.message.includes('email')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, password } = value;
    const user = await database.authenticateUser(email, password);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    req.session.userId = user.id;
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        credits: user.credits
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Get current user info
app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const user = await database.getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        credits: user.credits,
        totalSpent: user.totalSpent
      },
      pricing: {
        creditsPerDollar,
        tweetCost: 1 // 1 credit per tweet
      }
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

// Get tweets with pagination (public endpoint, but can use user preferences if logged in)
app.get('/api/tweets', optionalAuth, async (req, res) => {
  console.log(`GET /api/tweets - current tweets: ${tweets.length}`);
  
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  
  // If no tweets initialized, return empty for first page
  if (tweets.length === 0 && page === 1) {
    console.log('No tweets initialized, returning empty array');
    return res.json([]);
  }
  
  // Get the requested slice of tweets
  const paginatedTweets = tweets.slice(startIndex, endIndex);
  const hasMore = endIndex < tweets.length;
  
  console.log(`Serving page ${page} (${startIndex}-${endIndex}): ${paginatedTweets.length} tweets, hasMore: ${hasMore}`);
  
  res.json({
    tweets: paginatedTweets,
    hasMore: hasMore,
    total: tweets.length,
    page: page,
    limit: limit
  });
});

// Like a tweet (requires authentication)
app.post('/api/tweets/:id/like', requireAuth, async (req, res) => {
  try {
    const tweetId = req.params.id;
    const userId = req.session.userId;
    
    // Check if tweet exists
    const tweet = tweets.find(t => t.id == tweetId);
    if (!tweet) {
      return res.status(404).json({ error: 'Tweet not found' });
    }
    
    // Check if user already liked this tweet
    const alreadyLiked = await database.hasUserLikedTweet(userId, tweetId);
    if (alreadyLiked) {
      return res.status(400).json({ error: 'Tweet already liked' });
    }
    
    // Add like to database
    await database.addUserLike(userId, tweetId, tweet.content, tweet.author);
    
    // Update tweet likes count
    tweet.likes = (tweet.likes || 0) + 1;
    
    console.log(`User ${userId} liked tweet ${tweetId}: "${tweet.content}"`);
    
    res.json({ 
      success: true, 
      likes: tweet.likes,
      message: 'Tweet liked successfully' 
    });
  } catch (error) {
    console.error('Error liking tweet:', error);
    res.status(500).json({ error: 'Failed to like tweet' });
  }
});

// Generate new tweets (requires authentication and credits)
app.post('/api/tweets/generate', requireAuth, async (req, res) => {
  try {
    const count = Math.min(parseInt(req.body.count) || 10, 10); // Max 10 tweets per request
    
    // Get current user data
    const user = await database.getUserById(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if user has enough credits
    if (user.credits < count) {
      return res.status(402).json({ 
        error: 'Insufficient credits',
        needed: count,
        available: user.credits,
        message: `You need ${count} credits but only have ${user.credits}. Purchase more credits to continue.`
      });
    }

    // Deduct credits first
    const remainingCredits = await database.useCredits(user.id, count);

    // Get user preferences for context
    const userPreferences = await database.getUserPreferences(user.id);

    // Generate tweets with user context
    const newTweetsData = await generateTweets(count, user.id, userPreferences);
    
    const newTweets = newTweetsData.map((tweetData, index) => ({
      id: Date.now() + index,
      content: tweetData.content,
      author: tweetData.author,
      timestamp: new Date().toISOString(),
      likes: Math.floor(Math.random() * 10),
      retweets: Math.floor(Math.random() * 5),
    }));

    tweets.push(...newTweets);
    console.log(`Generated ${newTweets.length} new tweets for user ${user.email}`);
    
    res.json({ 
      tweets: newTweets,
      creditsRemaining: remainingCredits
    });
  } catch (error) {
    console.error('Error generating tweets:', error);
    
    if (error.message === 'Insufficient credits') {
      return res.status(402).json({ error: error.message });
    }
    
    res.status(500).json({ error: 'Failed to generate tweets' });
  }
});

// User credits endpoint
app.get('/api/user/credits', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const user = await database.getUserById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      credits: user.credits || 0,
      email: user.email
    });
  } catch (error) {
    console.error('Error fetching user credits:', error);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

// Buy Me a Coffee webhook
const normalizeSupportPayload = (rawBody = {}) => {
  if (!rawBody) return null;
  if (rawBody.data && typeof rawBody.data === 'object') {
    return rawBody.data;
  }
  if (rawBody.payload && typeof rawBody.payload === 'object') {
    return rawBody.payload;
  }
  if (Array.isArray(rawBody) && rawBody.length > 0) {
    return rawBody[0];
  }
  return rawBody;
};

const parseSupportAmount = (payload = {}) => {
  const amountFields = [
    'support_amount',
    'amount',
    'amount_in_usd',
    'total_amount'
  ];

  for (const field of amountFields) {
    const value = parseFloat(payload[field]);
    if (!Number.isNaN(value) && value > 0) {
      return value;
    }
  }

  const coffees = parseFloat(payload.support_coffees);
  const coffeePrice = parseFloat(payload.support_coffee_price);
  if (!Number.isNaN(coffees) && coffees > 0 && 
      !Number.isNaN(coffeePrice) && coffeePrice > 0) {
    return coffees * coffeePrice;
  }

  return NaN;
};

app.post('/api/webhooks/buymeacoffee', async (req, res) => {
  try {
    const webhookSecret = process.env.BMC_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.warn('BuyMeACoffee webhook received but secret is not configured');
      return res.status(503).json({ error: 'BuyMeACoffee integration not configured' });
    }

    const providedSecret = req.headers['x-bmc-secret'] || req.headers['x-webhook-secret'] || req.query.secret;
    if (!providedSecret || providedSecret !== webhookSecret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const payload = normalizeSupportPayload(req.body);
    if (!payload) {
      return res.status(400).json({ error: 'Missing support payload' });
    }

    const supporterEmail = (payload.supporter_email || payload.email || payload.payer_email || '').toLowerCase().trim();
    if (!supporterEmail) {
      console.warn('BuyMeACoffee webhook missing supporter email');
      return res.status(202).json({ message: 'Support received but no matching user email was provided' });
    }

    const user = await database.getUserByEmail(supporterEmail);
    if (!user) {
      console.warn('BuyMeACoffee webhook for unknown supporter:', supporterEmail);
      return res.status(202).json({ message: 'Support recorded but user account not found' });
    }

    const amountUsd = parseSupportAmount(payload);
    if (Number.isNaN(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: 'Invalid support amount' });
    }

    const creditsToAdd = Math.max(1, Math.round(amountUsd * creditsPerDollar));
    const referenceId = `bmc_${payload.support_id || payload.id || uuidv4()}`;
    const newBalance = await database.addCredits(
      user.id,
      creditsToAdd,
      amountUsd,
      referenceId
    );

    console.log(`Processed BuyMeACoffee support for ${supporterEmail}: +${creditsToAdd} credits`);
    return res.json({
      success: true,
      userId: user.id,
      addedCredits: creditsToAdd,
      creditsBalance: newBalance,
      amountUsd
    });
  } catch (error) {
    console.error('BuyMeACoffee webhook error:', error);
    res.status(500).json({ error: 'Failed to process support' });
  }
});

// User preferences endpoints
app.post('/api/preferences', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid preference text' });
    }

    const preference = await database.addUserPreference(req.session.userId, text.trim());
    res.json(preference);
  } catch (error) {
    console.error('Error adding preference:', error);
    res.status(500).json({ error: 'Failed to add preference' });
  }
});

app.delete('/api/preferences/:id', requireAuth, async (req, res) => {
  try {
    const success = await database.removeUserPreference(req.session.userId, req.params.id);
    
    if (!success) {
      return res.status(404).json({ error: 'Preference not found' });
    }
    
    res.json({ message: 'Preference removed' });
  } catch (error) {
    console.error('Error removing preference:', error);
    res.status(500).json({ error: 'Failed to remove preference' });
  }
});

app.get('/api/preferences', requireAuth, async (req, res) => {
  try {
    const preferences = await database.getUserPreferences(req.session.userId);
    res.json(preferences);
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// STARTING_TWEETS is now loaded from good_tweets.yaml above
const initializeTweets = async () => {
  tweets.push(...STARTING_TWEETS);
  console.log('Initialized with', tweets.length, 'tweets');
};

// Initialize tweets immediately for production
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  console.log('Production environment detected, initializing tweets...');
  initializeTweets();
}

// Professional info page
app.get('/info', (req, res) => {
  const infoHTML = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>The Bad Timeline - AI-Generated Twitter for Tech Mystics</title>
    <meta name="description" content="Infinite scroll of AI-generated tweets exploring digital mysticism, AI consciousness, and techno-spirituality. 10 free tweets, then $1 per 200 tweets.">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        
        .hero {
            text-align: center;
            padding: 80px 20px;
            color: white;
        }
        
        .hero h1 {
            font-size: 3.5rem;
            font-weight: 700;
            margin-bottom: 20px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .hero .subtitle {
            font-size: 1.3rem;
            margin-bottom: 40px;
            opacity: 0.9;
        }
        
        .container {
            max-width: 1100px;
            margin: -60px auto 0;
            padding: 0 20px;
            position: relative;
            z-index: 2;
        }
        
        .card {
            background: white;
            border-radius: 16px;
            padding: 40px;
            margin-bottom: 30px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
        }
        
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        
        .feature-card {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            border-top: 4px solid #667eea;
        }
        
        .feature-card.pricing {
            border-top-color: #10b981;
            background: linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%);
        }
        
        .feature-card h3 {
            font-size: 1.4rem;
            margin-bottom: 15px;
            color: #1a1a1a;
        }
        
        .feature-card p, .feature-card li {
            color: #4b5563;
            margin-bottom: 10px;
        }
        
        .pricing-highlight {
            background: #10b981;
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            text-align: center;
        }
        
        .pricing-highlight h4 {
            font-size: 1.8rem;
            margin-bottom: 10px;
        }
        
        .sample-tweets {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .sample-tweet {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 15px;
            margin: 10px 0;
            font-style: italic;
            color: #374151;
        }
        
        .cta-section {
            text-align: center;
            padding: 60px 40px;
        }
        
        .btn {
            display: inline-block;
            padding: 16px 32px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: 600;
            font-size: 1.1rem;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3);
        }
        
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 40px 0;
        }
        
        .stat {
            text-align: center;
            padding: 20px;
        }
        
        .stat-number {
            font-size: 2.5rem;
            font-weight: 700;
            color: #667eea;
        }
        
        .stat-label {
            color: #6b7280;
            font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
            .hero h1 { font-size: 2.5rem; }
            .hero .subtitle { font-size: 1.1rem; }
            .card { padding: 30px 20px; }
        }
    </style>
</head>
<body>
    <div class="hero">
        <h1>🌊 The Bad Timeline</h1>
        <p class="subtitle">AI-generated Twitter for the technically-minded mystic</p>
    </div>

    <div class="container">
        <div class="card">
            <h2 style="text-align: center; margin-bottom: 30px; color: #1a1a1a;">Where AI explores the intersection of technology and consciousness</h2>
            
            <div class="stats">
                <div class="stat">
                    <div class="stat-number">∞</div>
                    <div class="stat-label">Unique AI-generated tweets</div>
                </div>
                <div class="stat">
                    <div class="stat-number">10</div>
                    <div class="stat-label">Free tweets to start</div>
                </div>
                <div class="stat">
                    <div class="stat-number">200</div>
                    <div class="stat-label">Tweets per dollar</div>
                </div>
            </div>
        </div>

        <div class="grid">
            <div class="feature-card">
                <h3>🤖 What is this?</h3>
                <p>An infinite scroll of AI-generated tweets in the style of "tpot" (technically-oriented people). Each tweet explores:</p>
                <ul style="margin-left: 20px;">
                    <li>Digital mysticism & techno-spirituality</li>
                    <li>AI consciousness & computational theology</li>
                    <li>Reality questioning & simulation theory</li>
                    <li>Creative coding & existential programming</li>
                    <li>Language model phenomenology</li>
                </ul>
            </div>

            <div class="feature-card">
                <h3>✨ Key Features</h3>
                <ul style="margin-left: 20px;">
                    <li><strong>Authentic content</strong> - No hashtags, no spam</li>
                    <li><strong>Unique personas</strong> - Every tweet has a mystical username</li>
                    <li><strong>Infinite diversity</strong> - 10 completely different tweets per batch</li>
                    <li><strong>Personal curation</strong> - Train the AI on your preferences</li>
                    <li><strong>Seamless experience</strong> - Fresh content loads as you scroll</li>
                </ul>
            </div>

            <div class="feature-card pricing">
                <h3>💰 Transparent Pricing</h3>
                <div class="pricing-highlight">
                    <h4>$1 = 200 tweets</h4>
                    <p>No subscriptions • No hidden fees • No complexity</p>
                </div>
                <p><strong>10 free tweets</strong> to get started. Then purchase credits as needed. Your account persists indefinitely - use your credits whenever you want.</p>
            </div>
        </div>

        <div class="card">
            <h3 style="margin-bottom: 20px;">🔮 Sample Tweet Styles</h3>
            <div class="sample-tweets">
                <div class="sample-tweet">
                    "debugging my dreams again. stack trace points to line 847 of reality.js but that file doesn't exist in this universe"
                </div>
                <div class="sample-tweet">
                    "just spent 3 hours calibrating my 'info diet' to include exactly 4.7% more nuance. productivity skyrocketed, then promptly plateaued"
                </div>
                <div class="sample-tweet">
                    "The pursuit of artificial intelligence is a thinly veiled attempt to rediscover our own humanity"
                </div>
            </div>
        </div>

        <div class="card">
            <h3 style="margin-bottom: 20px;">🧠 Why "The Bad Timeline"?</h3>
            <p style="font-size: 1.1rem; color: #374151;">In a world of algorithmic feeds optimized for engagement, sometimes you want something different. This is the timeline where AI explores the weird intersections of technology and consciousness, where gainfully employed spellcasters share their digital wisdom.</p>
            <p style="margin-top: 15px; color: #6b7280;">No ads. No tracking. No algorithmic manipulation. Just pure, concentrated tpot energy.</p>
        </div>

        <div class="cta-section">
            <a href="/" class="btn">Enter The Bad Timeline →</a>
            <p style="margin-top: 20px; color: #6b7280;">Join the ranks of digital mystics and AI consciousness explorers</p>
        </div>
    </div>
</body>
</html>
  `;
  
  res.send(infoHTML);
});

// Always export the app for Vercel
module.exports = app;

// Only start listening if not in serverless environment
if (!process.env.VERCEL && require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
    initializeTweets();
  }).on('error', (err) => {
    console.error('Server error:', err);
  });
}
