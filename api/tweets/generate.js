const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const Groq = require('groq-sdk')
const { supabase, requireUser, adjustUserCredits } = require('../../backend/lib/supabase')

const groqClient = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null
const configPath = path.join(process.cwd(), 'backend', 'config.yaml')
const config = yaml.load(fs.readFileSync(configPath, 'utf8'))
const BATCH_PROMPT = config.batch_generation_prompt || 'Generate {count} tweets'

const generateTweets = async ({ count, preferencesText, likedTweetsText, recentTweetsText }) => {
  if (!groqClient) {
    throw new Error('Groq API key not configured')
  }

  let systemPrompt = config.base_prompt || ''

  if (preferencesText) {
    systemPrompt += `\n\nUser preferences: ${preferencesText}`
  }

  if (likedTweetsText) {
    systemPrompt += `\n\nTweets the user has liked: ${likedTweetsText}`
  }

  if (recentTweetsText) {
    systemPrompt += `\n\nRecent tweets to diversify from: ${recentTweetsText}`
  }

  const completion = await groqClient.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: BATCH_PROMPT.replace('{count}', count) }
    ],
    model: 'llama-3.3-70b-versatile',
    temperature: 0.9,
    max_tokens: 2000,
    response_format: { type: 'json_object' }
  })

  const responseText = completion.choices[0]?.message?.content?.trim()
  if (!responseText) {
    throw new Error('Empty response from Groq')
  }

  let tweetsData
  try {
    const parsed = JSON.parse(responseText)
    tweetsData = parsed.tweets || parsed
  } catch (error) {
    throw new Error('Invalid JSON response from Groq')
  }

  const validTweets = (tweetsData || [])
    .filter((tweet) => tweet && typeof tweet.content === 'string' && tweet.content.trim().length > 0)
    .slice(0, count)
    .map((tweet, index) => ({
      content: tweet.content.substring(0, 280),
      author: tweet.username || tweet.author || `mystic_${Date.now()}_${index}`
    }))

  while (validTweets.length < count) {
    const index = validTweets.length + 1
    validTweets.push({
      content: `The timelines are glitching again... tweet #${index}`,
      author: `backup_${Date.now()}_${index}`
    })
  }

  return validTweets
}

const fetchUserContext = async (userId) => {
  const [{ data: preferences }, { data: likes }, { data: recentTweets }] = await Promise.all([
    supabase
      .from('user_preferences')
      .select('preference_text')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('user_likes')
      .select('tweet_id')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('generated_tweets')
      .select('content')
      .order('created_at', { ascending: false })
      .limit(20)
  ])

  let likedTweetsText = ''
  const tweetIds = (likes || []).map((like) => like.tweet_id)
  if (tweetIds.length > 0) {
    const { data: likedTweets } = await supabase
      .from('generated_tweets')
      .select('content, author')
      .in('id', tweetIds)

    likedTweetsText = (likedTweets || [])
      .map((tweet) => tweet.content && `"${tweet.content}"`)
      .filter(Boolean)
      .join(', ')
  }

  const preferencesText = (preferences || []).map((pref) => pref.preference_text).filter(Boolean).join(', ')
  const recentTweetsText = (recentTweets || []).map((tweet) => `"${tweet.content}"`).join(', ')

  return { preferencesText, likedTweetsText, recentTweetsText }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    if (!groqClient) {
      return res.status(503).json({ error: 'Groq API key not configured' })
    }

    const user = await requireUser(req)
    const count = Math.min(parseInt(req.body?.count || '10', 10), 10)

    if (!count || count < 1) {
      return res.status(400).json({ error: 'Invalid tweet count' })
    }

    const creditResult = await adjustUserCredits({
      userId: user.id,
      delta: -count,
      transactionType: 'spent',
      description: `Generated ${count} tweets`
    })

    if (!creditResult.success) {
      return res.status(402).json({
        error: 'Insufficient credits',
        credits: creditResult.creditsBefore
      })
    }

    try {
      const context = await fetchUserContext(user.id)
      const tweetsData = await generateTweets({ count, ...context })

      const insertPayload = tweetsData.map((tweet) => ({
        user_id: user.id,
        content: tweet.content,
        author: tweet.author
      }))

      const { data: inserted, error: insertError } = await supabase
        .from('generated_tweets')
        .insert(insertPayload)
        .select('id, content, author, likes, created_at')

      if (insertError) {
        throw insertError
      }

      return res.status(200).json({
        tweets: inserted.map((tweet) => ({
          id: tweet.id,
          content: tweet.content,
          author: tweet.author,
          likes: tweet.likes || 0,
          timestamp: tweet.created_at
        })),
        creditsRemaining: creditResult.creditsAfter
      })
    } catch (generationError) {
      console.error('Tweet generation error:', generationError)
      await adjustUserCredits({
        userId: user.id,
        delta: count,
        transactionType: 'refunded',
        description: 'Tweet generation refund'
      })
      throw generationError
    }
  } catch (error) {
    const status = error.statusCode || 500
    return res.status(status).json({ error: error.message || 'Failed to generate tweets' })
  }
}
