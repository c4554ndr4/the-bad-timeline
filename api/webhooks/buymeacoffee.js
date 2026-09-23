const { adjustUserCredits, findProfileByEmail } = require('../../backend/lib/supabase')

const creditsPerDollar = parseInt(process.env.CREDITS_PER_DOLLAR || '200', 10)

const parsePayload = (body) => {
  if (!body) return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body)
    } catch (error) {
      return null
    }
  }
  return body
}

const normalizePayload = (raw) => {
  if (!raw) return null
  if (raw.data && typeof raw.data === 'object') {
    return raw.data
  }
  if (raw.payload && typeof raw.payload === 'object') {
    return raw.payload
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw[0]
  }
  return raw
}

const parseAmount = (payload) => {
  const fields = ['support_amount', 'amount', 'amount_in_usd', 'total_amount']

  for (const field of fields) {
    const value = parseFloat(payload[field])
    if (!Number.isNaN(value) && value > 0) {
      return value
    }
  }

  const coffees = parseFloat(payload.support_coffees)
  const price = parseFloat(payload.support_coffee_price)
  if (!Number.isNaN(coffees) && coffees > 0 && !Number.isNaN(price) && price > 0) {
    return coffees * price
  }

  return NaN
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const webhookSecret = process.env.BMC_WEBHOOK_SECRET
  if (!webhookSecret) {
    return res.status(503).json({ error: 'Webhook secret not configured' })
  }

  const providedSecret = req.headers['x-bmc-secret'] || req.headers['x-webhook-secret'] || req.query.secret
  if (!providedSecret || providedSecret !== webhookSecret) {
    return res.status(401).json({ error: 'Invalid webhook secret' })
  }

  try {
    const payload = normalizePayload(parsePayload(req.body) || req.body)
    if (!payload) {
      return res.status(400).json({ error: 'Missing payload' })
    }

    const supporterEmail = (payload.supporter_email || payload.email || payload.payer_email || '').toLowerCase().trim()
    if (!supporterEmail) {
      return res.status(202).json({ message: 'Support recorded but no email provided' })
    }

    const profile = await findProfileByEmail(supporterEmail)
    if (!profile) {
      console.warn('BuyMeACoffee webhook for unknown user:', supporterEmail)
      return res.status(202).json({ message: 'Support recorded but user not found' })
    }

    const amountUsd = parseAmount(payload)
    if (Number.isNaN(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: 'Invalid support amount' })
    }

    const creditsToAdd = Math.max(1, Math.round(amountUsd * creditsPerDollar))
    const referenceId = `bmc_${payload.support_id || payload.id || Date.now()}`

    const result = await adjustUserCredits({
      userId: profile.id,
      delta: creditsToAdd,
      transactionType: 'purchased',
      description: 'Buy Me a Coffee support',
      referenceId
    })

    return res.status(200).json({
      success: true,
      addedCredits: creditsToAdd,
      creditsBalance: result.creditsAfter,
      amountUsd
    })
  } catch (error) {
    console.error('BuyMeACoffee webhook error:', error)
    return res.status(500).json({ error: 'Failed to process webhook' })
  }
}
