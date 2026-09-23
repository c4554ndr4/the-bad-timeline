const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

class Database {
  constructor() {
    // For production, consider using a hosted database
    const dbPath = process.env.NODE_ENV === 'production' 
      ? ':memory:' // Vercel doesn't persist files, so use external DB in production
      : path.join(__dirname, 'timeline.db');
    
    this.db = new sqlite3.Database(dbPath);
    this.initializeDatabase();
    this.migrateLegacyStripeColumns();
  }

  initializeDatabase() {
    // Users table with Stripe integration
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        payment_provider_id TEXT,
        credits INTEGER DEFAULT 0,
        total_spent REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Credit transactions for auditing
    this.db.run(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL, -- 'purchase', 'usage', 'refund'
        amount INTEGER NOT NULL, -- positive for purchase/refund, negative for usage
        cost_usd REAL DEFAULT 0,
        reference_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // User preferences (replaces the global preferences)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        preference_text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // User likes table to track which tweets users have liked
    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_likes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tweet_id TEXT NOT NULL,
        tweet_content TEXT NOT NULL,
        tweet_author TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id, tweet_id)
      )
    `);

    // Discount code usage tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS discount_code_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        discount_code TEXT NOT NULL,
        credits_granted INTEGER NOT NULL,
        used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id),
        UNIQUE(user_id, discount_code)
      )
    `);
  }
  
  migrateLegacyStripeColumns() {
    this.db.serialize(() => {
      this.db.all(`PRAGMA table_info(users)`, (err, columns) => {
        if (err || !Array.isArray(columns)) {
          if (err) {
            console.warn('Failed to inspect users table:', err.message);
          }
          return;
        }
        const hasStripeColumn = columns.some(col => col.name === 'stripe_customer_id');
        const hasPaymentColumn = columns.some(col => col.name === 'payment_provider_id');
        if (hasStripeColumn && !hasPaymentColumn) {
          this.db.run(`ALTER TABLE users RENAME COLUMN stripe_customer_id TO payment_provider_id`, (renameErr) => {
            if (renameErr) {
              console.warn('Unable to rename stripe_customer_id column:', renameErr.message);
            } else {
              console.log('Renamed users.stripe_customer_id to payment_provider_id');
            }
          });
        }
      });

      this.db.all(`PRAGMA table_info(credit_transactions)`, (err, columns) => {
        if (err || !Array.isArray(columns)) {
          if (err) {
            console.warn('Failed to inspect credit_transactions table:', err.message);
          }
          return;
        }
        const hasStripeColumn = columns.some(col => col.name === 'stripe_payment_intent');
        const hasReferenceColumn = columns.some(col => col.name === 'reference_id');
        if (hasStripeColumn && !hasReferenceColumn) {
          this.db.run(`ALTER TABLE credit_transactions RENAME COLUMN stripe_payment_intent TO reference_id`, (renameErr) => {
            if (renameErr) {
              console.warn('Unable to rename stripe_payment_intent column:', renameErr.message);
            } else {
              console.log('Renamed credit_transactions.stripe_payment_intent to reference_id');
            }
          });
        }
      });
    });
  }

  // User management
  async createUser(email, password) {
    return new Promise((resolve, reject) => {
      const userId = uuidv4();
      const saltRounds = 12;
      
      bcrypt.hash(password, saltRounds, (err, hash) => {
        if (err) return reject(err);
        
        this.db.run(
          `INSERT INTO users (id, email, password_hash, display_name) 
           VALUES (?, ?, ?, ?)`,
           [userId, email.toLowerCase(), hash, null],
          function(err) {
            if (err) return reject(err);
            resolve({ 
              id: userId, 
              email: email.toLowerCase(), 
              credits: 0
            });
          }
        );
      });
    });
  }

  async authenticateUser(email, password) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM users WHERE email = ?`,
        [email.toLowerCase()],
        (err, user) => {
          if (err) return reject(err);
          if (!user) return resolve(null);
          
          bcrypt.compare(password, user.password_hash, (err, result) => {
            if (err) return reject(err);
            if (!result) return resolve(null);
            
            // Update last login
            this.db.run(
              `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?`,
              [user.id]
            );
            
            resolve({
              id: user.id,
              email: user.email,
              displayName: user.display_name,
              credits: user.credits,
              totalSpent: user.total_spent
            });
          });
        }
      );
    });
  }

  async getUserById(userId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT id, email, display_name, credits, total_spent 
         FROM users WHERE id = ?`,
        [userId],
        (err, user) => {
          if (err) return reject(err);
          if (!user) return resolve(null);
          
          resolve({
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            credits: user.credits,
            totalSpent: user.total_spent
          });
        }
      );
    });
  }

  async getUserByEmail(email) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT id, email, display_name, credits, total_spent 
         FROM users WHERE email = ?`,
        [email.toLowerCase()],
        (err, user) => {
          if (err) return reject(err);
          if (!user) return resolve(null);
          
          resolve({
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            credits: user.credits,
            totalSpent: user.total_spent
          });
        }
      );
    });
  }

  // Credit management
  async addCredits(userId, credits, costUsd = 0, referenceId = null) {
    return new Promise((resolve, reject) => {
      const transactionId = uuidv4();
      
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        // Add credits to user
        this.db.run(
          `UPDATE users SET credits = credits + ?, total_spent = total_spent + ? WHERE id = ?`,
          [credits, costUsd, userId],
          function(err) {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }
          }
        );
        
        // Record transaction
        this.db.run(
          `INSERT INTO credit_transactions (id, user_id, type, amount, cost_usd, reference_id)
           VALUES (?, ?, 'purchase', ?, ?, ?)`,
          [transactionId, userId, credits, costUsd, referenceId],
          function(err) {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }
          }
        );
        
        this.db.run('COMMIT', (err) => {
          if (err) return reject(err);
          
          // Return updated user credits
          this.db.get(
            `SELECT credits FROM users WHERE id = ?`,
            [userId],
            (err, user) => {
              if (err) return reject(err);
              resolve(user.credits);
            }
          );
        });
      });
    });
  }

  async useCredits(userId, credits) {
    return new Promise((resolve, reject) => {
      const transactionId = uuidv4();
      
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        // Check if user has enough credits
        this.db.get(
          `SELECT credits FROM users WHERE id = ?`,
          [userId],
          (err, user) => {
            if (err) {
              this.db.run('ROLLBACK');
              return reject(err);
            }
            
            if (!user || user.credits < credits) {
              this.db.run('ROLLBACK');
              return reject(new Error('Insufficient credits'));
            }
            
            // Deduct credits
            this.db.run(
              `UPDATE users SET credits = credits - ? WHERE id = ?`,
              [credits, userId],
              function(err) {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }
              }
            );
            
            // Record usage transaction
            this.db.run(
              `INSERT INTO credit_transactions (id, user_id, type, amount)
               VALUES (?, ?, 'usage', ?)`,
              [transactionId, userId, -credits],
              function(err) {
                if (err) {
                  this.db.run('ROLLBACK');
                  return reject(err);
                }
              }
            );
            
            this.db.run('COMMIT', (err) => {
              if (err) return reject(err);
              resolve(user.credits - credits);
            });
          }
        );
      });
    });
  }

  // User preferences
  async addUserPreference(userId, preferenceText) {
    return new Promise((resolve, reject) => {
      const prefId = uuidv4();
      
      this.db.run(
        `INSERT INTO user_preferences (id, user_id, preference_text)
         VALUES (?, ?, ?)`,
        [prefId, userId, preferenceText],
        function(err) {
          if (err) return reject(err);
          resolve({
            id: prefId,
            userId,
            text: preferenceText,
            createdAt: new Date().toISOString()
          });
        }
      );
    });
  }

  async getUserPreferences(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT id, preference_text as text, created_at 
         FROM user_preferences 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT 10`,
        [userId],
        (err, preferences) => {
          if (err) return reject(err);
          resolve(preferences || []);
        }
      );
    });
  }

  async removeUserPreference(userId, preferenceId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM user_preferences WHERE id = ? AND user_id = ?`,
        [preferenceId, userId],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        }
      );
    });
  }

  // Like management
  async addUserLike(userId, tweetId, tweetContent, tweetAuthor) {
    return new Promise((resolve, reject) => {
      const likeId = uuidv4();
      
      this.db.run(
        `INSERT OR IGNORE INTO user_likes (id, user_id, tweet_id, tweet_content, tweet_author)
         VALUES (?, ?, ?, ?, ?)`,
        [likeId, userId, tweetId, tweetContent, tweetAuthor],
        function(err) {
          if (err) return reject(err);
          resolve({
            id: likeId,
            userId,
            tweetId,
            tweetContent,
            tweetAuthor,
            createdAt: new Date().toISOString()
          });
        }
      );
    });
  }

  async getUserLikes(userId, limit = 20) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT tweet_id, tweet_content, tweet_author, created_at 
         FROM user_likes 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
        [userId, limit],
        (err, likes) => {
          if (err) return reject(err);
          resolve(likes || []);
        }
      );
    });
  }

  async hasUserLikedTweet(userId, tweetId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT 1 FROM user_likes WHERE user_id = ? AND tweet_id = ?`,
        [userId, tweetId],
        (err, row) => {
          if (err) return reject(err);
          resolve(!!row);
        }
      );
    });
  }

  // Analytics
  async getUserStats(userId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT 
           type,
           COUNT(*) as count,
           SUM(ABS(amount)) as total_credits,
           SUM(cost_usd) as total_cost
         FROM credit_transactions 
         WHERE user_id = ? 
         GROUP BY type`,
        [userId],
        (err, stats) => {
          if (err) return reject(err);
          resolve(stats || []);
        }
      );
    });
  }

  // Discount code methods
  async checkDiscountCodeUsage(userId, discountCode) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM discount_code_usage WHERE user_id = ? AND discount_code = ?`,
        [userId, discountCode.toLowerCase()],
        (err, usage) => {
          if (err) return reject(err);
          resolve(!!usage); // Returns true if code has been used by this user
        }
      );
    });
  }

  async recordDiscountCodeUsage(userId, discountCode, creditsGranted) {
    return new Promise((resolve, reject) => {
      const usageId = uuidv4();
      
      this.db.run(
        `INSERT INTO discount_code_usage (id, user_id, discount_code, credits_granted)
         VALUES (?, ?, ?, ?)`,
        [usageId, userId, discountCode.toLowerCase(), creditsGranted],
        function(err) {
          if (err) return reject(err);
          resolve({
            id: usageId,
            userId,
            discountCode: discountCode.toLowerCase(),
            creditsGranted,
            usedAt: new Date().toISOString()
          });
        }
      );
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = Database; 
