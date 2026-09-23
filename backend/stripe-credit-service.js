const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

class StripeCreditService {
  constructor() {
    this.stripe = stripe;
  }

  /**
   * Create a Stripe customer with initial credits
   */
  async createCustomerWithCredits(email, userId, initialCredits = 10) {
    try {
      const customer = await this.stripe.customers.create({
        email: email,
        metadata: {
          userId: userId,
          credits: initialCredits.toString(),
          total_spent: '0',
          created_at: new Date().toISOString()
        }
      });
      
      console.log(`Created Stripe customer ${customer.id} with ${initialCredits} credits`);
      return customer;
    } catch (error) {
      console.error('Error creating Stripe customer:', error);
      throw error;
    }
  }

  /**
   * Get credits for a user from their Stripe customer metadata
   */
  async getCredits(stripeCustomerId) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      return parseInt(customer.metadata.credits || '0');
    } catch (error) {
      console.error('Error retrieving credits from Stripe:', error);
      throw error;
    }
  }

  /**
   * Add credits to a user's Stripe customer metadata
   */
  async addCredits(stripeCustomerId, creditsToAdd, costUsd = 0, paymentIntentId = null) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      const currentCredits = parseInt(customer.metadata.credits || '0');
      const currentTotalSpent = parseFloat(customer.metadata.total_spent || '0');
      
      const newCredits = currentCredits + creditsToAdd;
      const newTotalSpent = currentTotalSpent + costUsd;

      const updatedMetadata = {
        ...customer.metadata,
        credits: newCredits.toString(),
        total_spent: newTotalSpent.toString(),
        last_purchase: new Date().toISOString()
      };

      if (paymentIntentId) {
        updatedMetadata.last_payment_intent = paymentIntentId;
      }

      await this.stripe.customers.update(stripeCustomerId, {
        metadata: updatedMetadata
      });

      console.log(`Added ${creditsToAdd} credits to customer ${stripeCustomerId}. New balance: ${newCredits}`);
      return newCredits;
    } catch (error) {
      console.error('Error adding credits via Stripe:', error);
      throw error;
    }
  }

  /**
   * Use credits (deduct from Stripe customer metadata)
   */
  async useCredits(stripeCustomerId, creditsToUse) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      const currentCredits = parseInt(customer.metadata.credits || '0');
      
      if (currentCredits < creditsToUse) {
        throw new Error(`Insufficient credits. Has ${currentCredits}, needs ${creditsToUse}`);
      }

      const newCredits = currentCredits - creditsToUse;
      
      await this.stripe.customers.update(stripeCustomerId, {
        metadata: {
          ...customer.metadata,
          credits: newCredits.toString(),
          last_usage: new Date().toISOString()
        }
      });

      console.log(`Deducted ${creditsToUse} credits from customer ${stripeCustomerId}. New balance: ${newCredits}`);
      return newCredits;
    } catch (error) {
      console.error('Error using credits via Stripe:', error);
      throw error;
    }
  }

  /**
   * Get full customer data including credits and spending
   */
  async getCustomerData(stripeCustomerId) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      return {
        customerId: customer.id,
        email: customer.email,
        credits: parseInt(customer.metadata.credits || '0'),
        totalSpent: parseFloat(customer.metadata.total_spent || '0'),
        createdAt: customer.metadata.created_at,
        lastPurchase: customer.metadata.last_purchase,
        lastUsage: customer.metadata.last_usage
      };
    } catch (error) {
      console.error('Error retrieving customer data:', error);
      throw error;
    }
  }

  /**
   * Validate that a customer exists and belongs to the given user
   */
  async validateCustomerOwnership(stripeCustomerId, userId) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      return customer.metadata.userId === userId;
    } catch (error) {
      console.error('Error validating customer ownership:', error);
      return false;
    }
  }

  /**
   * Handle promotional credit grants (like clipcash code)
   */
  async grantPromotionalCredits(stripeCustomerId, credits, promoCode) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      const currentCredits = parseInt(customer.metadata.credits || '0');
      const newCredits = currentCredits + credits;

      await this.stripe.customers.update(stripeCustomerId, {
        metadata: {
          ...customer.metadata,
          credits: newCredits.toString(),
          [`promo_${promoCode}_applied`]: new Date().toISOString(),
          last_promo: promoCode
        }
      });

      console.log(`Granted ${credits} promotional credits (${promoCode}) to customer ${stripeCustomerId}`);
      return newCredits;
    } catch (error) {
      console.error('Error granting promotional credits:', error);
      throw error;
    }
  }

  /**
   * Check if a promo code has been used by this customer
   */
  async hasUsedPromoCode(stripeCustomerId, promoCode) {
    try {
      const customer = await this.stripe.customers.retrieve(stripeCustomerId);
      return !!customer.metadata[`promo_${promoCode}_applied`];
    } catch (error) {
      console.error('Error checking promo code usage:', error);
      return false;
    }
  }
}

module.exports = StripeCreditService; 