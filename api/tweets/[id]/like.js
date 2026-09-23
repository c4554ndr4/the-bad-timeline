const { supabase, requireUser } = require('../../backend/lib/supabase')

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const user = await requireUser(req)
    const tweetId = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id

    if (!tweetId) {
      return res.status(400).json({ error: 'Tweet id is required' })
    }

    const { data: tweet, error: tweetError } = await supabase
      .from('generated_tweets')
      .select('id, likes')
      .eq('id', tweetId)
      .single()

    if (tweetError || !tweet) {
      return res.status(404).json({ error: 'Tweet not found' })
    }

    const { error: likeError } = await supabase
      .from('user_likes')
      .insert({
        user_id: user.id,
        tweet_id: tweetId
      })

    if (likeError) {
      if (likeError.code === '23505') {
        return res.status(400).json({ error: 'Tweet already liked' })
      }
      throw likeError
    }

    const { data: updated, error: updateError } = await supabase
      .from('generated_tweets')
      .update({ likes: (tweet.likes || 0) + 1 })
      .eq('id', tweetId)
      .select('likes')
      .single()

    if (updateError) {
      throw updateError
    }

    return res.status(200).json({
      success: true,
      likes: updated.likes
    })
  } catch (error) {
    console.error('Like tweet error:', error)
    const status = error.statusCode || 500
    return res.status(status).json({ error: error.message || 'Failed to like tweet' })
  }
}
