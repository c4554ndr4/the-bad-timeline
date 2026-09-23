const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')
const { supabase } = require('../../backend/lib/supabase')

const goodTweetsPath = path.join(process.cwd(), 'good_tweets.yaml')
const goodTweetsData = fs.existsSync(goodTweetsPath)
  ? yaml.load(fs.readFileSync(goodTweetsPath, 'utf8')) || {}
  : {}
const STARTING_TWEETS = goodTweetsData.tweets || []

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1)
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10), 1), 20)
    const offset = (page - 1) * limit

    const { data, error, count } = await supabase
      .from('generated_tweets')
      .select('id, content, author, likes, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error && error.code !== 'PGRST116') {
      throw error
    }

    if (!data || data.length === 0) {
      const fallback = STARTING_TWEETS.slice(offset, offset + limit).map((tweet, index) => ({
        id: `seed_${offset + index}`,
        content: tweet.content,
        author: tweet.author || `mystic_${offset + index}`,
        likes: 0,
        timestamp: new Date().toISOString()
      }))

      return res.status(200).json({
        tweets: fallback,
        total: STARTING_TWEETS.length,
        hasMore: offset + fallback.length < STARTING_TWEETS.length,
        page,
        limit
      })
    }

    const total = typeof count === 'number' ? count : data.length
    const tweets = data.map((tweet) => ({
      id: tweet.id,
      content: tweet.content,
      author: tweet.author,
      likes: tweet.likes || 0,
      timestamp: tweet.created_at
    }))

    return res.status(200).json({
      tweets,
      total,
      hasMore: offset + tweets.length < total,
      page,
      limit
    })
  } catch (error) {
    console.error('Tweets fetch error:', error)
    res.status(500).json({ error: 'Failed to load tweets' })
  }
}
