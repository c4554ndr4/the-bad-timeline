const Stripe = require('stripe');
const database = require('./database');
const pricing = require('./pricing');

class PaymentService {
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  // Create a payment intent for purchasing credits
  async createPaymentIntent(userId, tierId) {
    try {
      const tier = pricing.getPricingTiers().find(t => t.id === tierId);
      if (!tier) {
        throw new Error('Invalid pricing tier');
      }

      const creditsWithBonus = pricing.getCreditsWithBonus(tierId);

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: tier.priceUsd * 100, // Stripe uses cents
        currency: 'usd',
        automatic_payment_methods: {
          enabled: true,
        },
        metadata: {
          userId,
          tierId,
          credits: creditsWithBonus.toString(),
          description: tier.description
        },
        description: `The Bad Timeline - ${tier.name}: ${creditsWithBonus} credits`
      });

      // Store transaction in database
      await database.createTransaction(
        userId,
        paymentIntent.id,
        tier.priceUsd,
        creditsWithBonus
      );

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: tier.priceUsd,
        credits: creditsWithBonus,
        tier: tier
      };
    } catch (error) {
      console.error('Error creating payment intent:', error);
      throw error;
    }
  }

  // Handle successful payment webhook
  async handlePaymentSuccess(paymentIntentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status === 'succeeded') {
        const { userId, credits } = paymentIntent.metadata;
        
        // Add credits to user account
        await database.addCredits(userId, parseInt(credits), paymentIntentId);
        
        // Update transaction status
        const transaction = await database.db.get(
          'SELECT id FROM transactions WHERE stripe_payment_intent_id = ?',
          [paymentIntentId]
        );
        
        if (transaction) {
          await database.updateTransactionStatus(transaction.id, 'completed');
        }

        console.log(`Payment successful: Added ${credits} credits to user ${userId}`);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error handling payment success:', error);
      throw error;
    }
  }

  // Create Stripe Link for one-click payments
  async createPaymentLink(tierId) {
    try {
      const tier = pricing.getPricingTiers().find(t => t.id === tierId);
      if (!tier) {
        throw new Error('Invalid pricing tier');
      }

      const creditsWithBonus = pricing.getCreditsWithBonus(tierId);

      // Create or get existing product
      const product = await this.stripe.products.create({
        name: `${tier.name} - The Bad Timeline`,
        description: `${tier.description} (${creditsWithBonus} credits)`,
        metadata: {
          tierId,
          credits: creditsWithBonus.toString()
        }
      });

      // Create price
      const price = await this.stripe.prices.create({
        unit_amount: tier.priceUsd * 100,
        currency: 'usd',
        product: product.id,
      });

      // Create payment link
      const paymentLink = await this.stripe.paymentLinks.create({
        line_items: [
          {
            price: price.id,
            quantity: 1,
          },
        ],
        metadata: {
          tierId,
          credits: creditsWithBonus.toString()
        }
      });

      return {
        paymentLinkUrl: paymentLink.url,
        paymentLinkId: paymentLink.id,
        tier: tier,
        credits: creditsWithBonus
      };
    } catch (error) {
      console.error('Error creating payment link:', error);
      throw error;
    }
  }

  // Verify webhook signature
  verifyWebhookSignature(payload, signature) {
    try {
      return this.stripe.webhooks.constructEvent(
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      throw error;
    }
  }

  // Get user's payment history
  async getUserPaymentHistory(userId) {
    return new Promise((resolve, reject) => {
      database.db.all(
        `SELECT t.*, u.session_id 
         FROM transactions t 
         JOIN users u ON t.user_id = u.id 
         WHERE t.user_id = ? 
         ORDER BY t.created_at DESC`,
        [userId],
        (err, transactions) => {
          if (err) return reject(err);
          resolve(transactions || []);
        }
      );
    });
  }

  // Refund payment (admin function)
  async refundPayment(paymentIntentId, reason = 'requested_by_customer') {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        reason
      });

      // Update transaction status and deduct credits
      const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      const { userId, credits } = paymentIntent.metadata;

      // Deduct credits from user (if they have enough)
      const user = await database.db.get('SELECT credits FROM users WHERE id = ?', [userId]);
      if (user && user.credits >= parseInt(credits)) {
        await database.db.run(
          'UPDATE users SET credits = credits - ? WHERE id = ?',
          [parseInt(credits), userId]
        );
      }

      return refund;
    } catch (error) {
      console.error('Error processing refund:', error);
      throw error;
    }
  }
}

module.exports = PaymentService; 