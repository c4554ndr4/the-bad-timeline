import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { paymentIntentId } = req.body;
    
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Payment intent ID required' });
    }

    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status === 'succeeded') {
      const { userId, credits, userEmail } = paymentIntent.metadata;
      
      // Update customer metadata with credits
      if (paymentIntent.customer) {
        const customer = await stripe.customers.retrieve(paymentIntent.customer);
        const currentCredits = parseInt(customer.metadata.credits || '0');
        const newCredits = currentCredits + parseInt(credits);
        
        await stripe.customers.update(paymentIntent.customer, {
          metadata: {
            ...customer.metadata,
            credits: newCredits.toString(),
            last_purchase: new Date().toISOString(),
            last_payment_intent: paymentIntentId
          }
        });

        return res.json({
          success: true,
          credits: newCredits,
          message: `Successfully added ${credits} credits!`
        });
      }
    }
    
    res.status(400).json({ 
      error: 'Payment not completed',
      status: paymentIntent.status 
    });

  } catch (error) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ 
      error: 'Failed to confirm payment',
      details: error.message 
    });
  }
}