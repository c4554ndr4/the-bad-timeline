export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { amount, credits, userId, userEmail } = req.body;
    
    // Validation
    if (!amount || amount < 1 || amount > 100) {
      return res.status(400).json({ error: 'Invalid amount. Must be between $1 and $100.' });
    }

    if (!credits || credits < 1) {
      return res.status(400).json({ error: 'Invalid credits amount.' });
    }

    if (!userId || !userEmail) {
      return res.status(400).json({ error: 'User information required.' });
    }

    // Simple HTTP request to Stripe API instead of SDK
    const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': `${credits} AI Tweet Credits`,
        'line_items[0][price_data][product_data][description]': 'Credits for generating AI-powered tweets',
        'line_items[0][price_data][unit_amount]': amount * 100, // Convert to cents
        'line_items[0][quantity]': 1,
        'metadata[userId]': userId,
        'metadata[credits]': credits.toString(),
        'metadata[userEmail]': userEmail,
        'customer_email': userEmail,
        'mode': 'payment',
        'success_url': `${req.headers.origin || 'https://the-bad-timeline.vercel.app'}/success?session_id={CHECKOUT_SESSION_ID}`,
        'cancel_url': `${req.headers.origin || 'https://the-bad-timeline.vercel.app'}/?cancelled=true`,
      })
    });

    if (!stripeResponse.ok) {
      const errorData = await stripeResponse.text();
      console.error('Stripe API Error:', errorData);
      return res.status(500).json({ 
        error: 'Failed to create checkout session',
        details: 'Stripe API request failed'
      });
    }

    const session = await stripeResponse.json();
    
    res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Checkout creation error:', error);
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      details: error.message 
    });
  }
}