// Groq pricing with 50% markup
const GROQ_PRICING = {
  // Base Groq rates (per million tokens)
  'llama-3.3-70b-versatile': {
    input: 0.59,   // $0.59/M tokens
    output: 0.79   // $0.79/M tokens
  },
  'llama-3-70b': {
    input: 0.59,
    output: 0.79
  },
  'llama-3-8b': {
    input: 0.05,
    output: 0.1
  }
};

// Our markup rate (50%)
const MARKUP_MULTIPLIER = 1.5;

class PricingCalculator {
  constructor() {
    this.markup = MARKUP_MULTIPLIER;
  }

  // Calculate cost for a specific model and token usage
  calculateCost(modelName, inputTokens = 0, outputTokens = 0) {
    const baseRates = GROQ_PRICING[modelName] || GROQ_PRICING['llama-3.3-70b-versatile'];
    
    // Apply 50% markup to base Groq pricing
    const ourRates = {
      input: baseRates.input * this.markup,   // $0.89/M tokens
      output: baseRates.output * this.markup  // $1.19/M tokens
    };

    // Calculate cost (rates are per million tokens)
    const inputCost = (inputTokens / 1_000_000) * ourRates.input;
    const outputCost = (outputTokens / 1_000_000) * ourRates.output;
    const totalCost = inputCost + outputCost;

    return {
      inputCost,
      outputCost,
      totalCost,
      inputTokens,
      outputTokens,
      rates: ourRates,
      baseRates,
      markup: this.markup
    };
  }

  // Estimate cost for tweet generation (typical usage)
  estimateTweetGenerationCost(tweetCount = 10) {
    // Estimates based on typical token usage:
    // - Input: ~800 tokens (context + prompt + preferences)
    // - Output per tweet: ~50 tokens average
    const estimatedInputTokens = 800;
    const estimatedOutputTokens = tweetCount * 50;

    return this.calculateCost('llama-3.3-70b-versatile', estimatedInputTokens, estimatedOutputTokens);
  }

  // Convert USD to credits (1 credit = $0.01)
  usdToCredits(usd) {
    return Math.ceil(usd * 100);
  }

  // Convert credits to USD
  creditsToUsd(credits) {
    return credits / 100;
  }

  // Get pricing tiers for purchasing credits
  getPricingTiers() {
    return [
      {
        id: 'starter',
        name: 'Starter Pack',
        credits: 1000,        // $10 worth
        priceUsd: 10,
        description: '~200 tweet generations',
        popular: false
      },
      {
        id: 'creator',
        name: 'Creator Pack',
        credits: 2500,        // $25 worth
        priceUsd: 25,
        description: '~500 tweet generations',
        popular: true,
        bonus: 100           // Extra 100 credits
      },
      {
        id: 'power',
        name: 'Power User',
        credits: 5000,        // $50 worth
        priceUsd: 50,
        description: '~1000 tweet generations',
        popular: false,
        bonus: 300          // Extra 300 credits
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        credits: 10000,       // $100 worth
        priceUsd: 100,
        description: '~2000+ tweet generations',
        popular: false,
        bonus: 1000         // Extra 1000 credits
      }
    ];
  }

  // Calculate actual credits with bonuses
  getCreditsWithBonus(tierId) {
    const tier = this.getPricingTiers().find(t => t.id === tierId);
    if (!tier) return 0;
    
    return tier.credits + (tier.bonus || 0);
  }

  // Format pricing for display
  formatPrice(usd) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(usd);
  }

  // Get real-time cost breakdown for display
  getCostBreakdown(inputTokens, outputTokens, modelName = 'llama-3.3-70b-versatile') {
    const cost = this.calculateCost(modelName, inputTokens, outputTokens);
    
    return {
      breakdown: {
        inputTokens: cost.inputTokens.toLocaleString(),
        outputTokens: cost.outputTokens.toLocaleString(),
        inputCost: this.formatPrice(cost.inputCost),
        outputCost: this.formatPrice(cost.outputCost),
        totalCost: this.formatPrice(cost.totalCost),
        credits: this.usdToCredits(cost.totalCost)
      },
      rates: {
        input: this.formatPrice(cost.rates.input),
        output: this.formatPrice(cost.rates.output),
        baseInput: this.formatPrice(cost.baseRates.input),
        baseOutput: this.formatPrice(cost.baseRates.output),
        markup: `${((cost.markup - 1) * 100).toFixed(0)}%`
      }
    };
  }
}

module.exports = PricingCalculator; 