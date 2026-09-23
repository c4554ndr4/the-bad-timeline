const { requireUser, ensureProfile } = require('../../backend/lib/supabase')

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,PUT')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization')

  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const user = await requireUser(req)
    const profile = await ensureProfile(user)

    return res.status(200).json({
      credits: profile.credits || 0,
      totalPurchased: profile.total_credits_purchased || 0,
      totalEarned: profile.total_credits_earned || 0
    })
  } catch (error) {
    console.error('Credits fetch error:', error)
    const status = error.statusCode || 500
    return res.status(status).json({ error: error.message || 'Internal server error' })
  }
}
