const { supabase, requireUser } = require('../../backend/lib/supabase')

export default async function handler(req, res) {
  try {
    if (req.method !== 'DELETE') {
      res.setHeader('Allow', 'DELETE')
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const user = await requireUser(req)
    const { id } = req.query

    if (!id) {
      return res.status(400).json({ error: 'Preference id is required' })
    }

    const { error } = await supabase
      .from('user_preferences')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)

    if (error) {
      throw error
    }

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Delete preference error:', error)
    const status = error.statusCode || 500
    return res.status(status).json({ error: error.message || 'Failed to remove preference' })
  }
}
