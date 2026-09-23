const { supabase, requireUser } = require('../../backend/lib/supabase')

const handler = async (req, res) => {
  try {
    if (req.method === 'GET') {
      return getPreferences(req, res)
    }

    if (req.method === 'POST') {
      return createPreference(req, res)
    }

    res.setHeader('Allow', 'GET,POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (error) {
    console.error('Preferences API error:', error)
    const status = error.statusCode || 500
    return res.status(status).json({ error: error.message || 'Failed to handle preferences' })
  }
}

const getPreferences = async (req, res) => {
  const user = await requireUser(req)

  const { data, error } = await supabase
    .from('user_preferences')
    .select('id, preference_text, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    throw error
  }

  return res.status(200).json(
    (data || []).map((preference) => ({
      id: preference.id,
      text: preference.preference_text,
      createdAt: preference.created_at
    }))
  )
}

const createPreference = async (req, res) => {
  const user = await requireUser(req)
  const { text } = req.body || {}

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Preference text is required' })
  }

  const { data, error } = await supabase
    .from('user_preferences')
    .insert({
      user_id: user.id,
      preference_text: text.trim()
    })
    .select('id, preference_text, created_at')
    .single()

  if (error) {
    throw error
  }

  return res.status(200).json({
    id: data.id,
    text: data.preference_text,
    createdAt: data.created_at
  })
}

export default handler
