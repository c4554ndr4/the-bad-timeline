const { supabase, requireUser, ensureProfile } = require('../../backend/lib/supabase')

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const user = await requireUser(req)
    const profile = await ensureProfile(user)

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.user_metadata?.display_name || user.user_metadata?.username || null,
        credits: profile.credits || 0,
        totalSpent: profile.total_credits_purchased || 0
      }
    })
  } catch (error) {
    console.error('User endpoint error:', error)
    const status = error.statusCode || 500
    return res.status(status).json({ error: error.message || 'Failed to fetch user' })
  }
}
