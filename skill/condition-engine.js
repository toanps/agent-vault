/**
 * condition-engine.js — Natural Language Condition Evaluator
 *
 * The brain of AgentVault. Takes human-written conditions and evaluates
 * fund requests against them. No external AI calls — pure pattern matching.
 *
 * Supported condition patterns:
 *   - Amount limits:       "Max $500/month", "Up to $200/week"
 *   - Category rules:      "Only for education", "Deny gaming purchases"
 *   - Time-based:          "Auto-send $3000 on 1st of month"
 *   - Escalation:          "Requests > $1000 need owner approval"
 *   - Recurring allowance: "Weekly allowance of $200"
 *   - Require reason:      "Requests over $200 require a reason"
 *
 * @module condition-engine
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  Category Keywords
// ═══════════════════════════════════════════════════════════════════════════════

const CATEGORY_KEYWORDS = {
  groceries:     ['grocery', 'groceries', 'food', 'supermarket', 'market', 'produce', 'meat', 'vegetables'],
  household:     ['household', 'home', 'house', 'furniture', 'appliance', 'cleaning', 'supplies', 'repair'],
  utilities:     ['utility', 'utilities', 'electricity', 'electric', 'water', 'gas', 'internet', 'wifi', 'phone', 'bill', 'bills'],
  education:     ['education', 'school', 'tuition', 'books', 'textbook', 'course', 'class', 'learning', 'study', 'college', 'university'],
  gaming:        ['gaming', 'game', 'games', 'xbox', 'playstation', 'ps5', 'nintendo', 'steam', 'twitch', 'esports'],
  entertainment: ['entertainment', 'movie', 'movies', 'netflix', 'spotify', 'streaming', 'concert', 'music', 'fun', 'party'],
  medical:       ['medical', 'health', 'doctor', 'hospital', 'medicine', 'pharmacy', 'dental', 'prescription', 'clinic'],
  transport:     ['transport', 'transportation', 'gas', 'fuel', 'uber', 'taxi', 'bus', 'train', 'commute', 'car'],
  salary:        ['salary', 'payroll', 'wage', 'wages', 'pay', 'compensation'],
  rent:          ['rent', 'lease', 'housing', 'mortgage'],
  clothing:      ['clothing', 'clothes', 'shoes', 'fashion', 'apparel'],
  donation:      ['donation', 'donate', 'charity', 'giving'],
  travel:        ['travel', 'trip', 'flight', 'hotel', 'vacation', 'holiday', 'airbnb']
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Time Period Parsing
// ═══════════════════════════════════════════════════════════════════════════════

const PERIOD_MS = {
  day:   24 * 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  week:  7 * 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
  year:  365 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Rule Types
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ParsedRule
 * @property {string} type - Rule type
 * @property {string} original - Original condition text
 * @property {number} [amount] - Dollar amount
 * @property {string} [period] - Time period
 * @property {string[]} [categories] - Matched categories
 * @property {boolean} [deny] - Whether this is a deny rule
 * @property {boolean} [requireReason] - Whether reason is required
 * @property {boolean} [needsApproval] - Whether owner approval needed
 */

// ═══════════════════════════════════════════════════════════════════════════════
//  ConditionEngine Class
// ═══════════════════════════════════════════════════════════════════════════════

class ConditionEngine {
  /**
   * @param {string[]} conditions - Array of natural language rules
   */
  constructor(conditions = []) {
    this.rawConditions = conditions;
    this.rules = conditions.map(c => this._parseCondition(c));
  }

  /**
   * Evaluate a fund request against all conditions.
   *
   * @param {Object} request
   * @param {string} request.address - Recipient address
   * @param {number} request.amount - Requested amount in USD
   * @param {string} request.reason - Reason/purpose for the request
   * @param {string} request.purpose - Recipient's designated purpose
   * @param {Object} request.history - Spending history
   * @param {number} request.history.dailySpent - Amount spent today (USD)
   * @param {number} request.history.monthlySpent - Amount spent this month (USD)
   * @param {number} request.history.weeklySpent - Amount spent this week (USD)
   * @param {number} request.history.dailyLimit - On-chain daily limit (USD)
   * @param {number} request.history.monthlyLimit - On-chain monthly limit (USD)
   *
   * @returns {Object} { approved, denied, needsEscalation, reason, matchedRule, confidence }
   */
  evaluate(request) {
    const results = [];

    for (const rule of this.rules) {
      const result = this._evaluateRule(rule, request);
      if (result) {
        results.push(result);
      }
    }

    // Check for denials first (deny rules take priority)
    const denial = results.find(r => r.denied);
    if (denial) {
      return {
        approved: false,
        denied: true,
        needsEscalation: false,
        reason: denial.reason,
        matchedRule: denial.matchedRule,
        confidence: denial.confidence
      };
    }

    // Check for escalations
    const escalation = results.find(r => r.needsEscalation);
    if (escalation) {
      return {
        approved: false,
        denied: false,
        needsEscalation: true,
        reason: escalation.reason,
        matchedRule: escalation.matchedRule,
        confidence: escalation.confidence
      };
    }

    // Check for require-reason rules
    const reasonRequired = results.find(r => r.requireReason);
    if (reasonRequired && (!request.reason || request.reason.trim().length < 3)) {
      return {
        approved: false,
        denied: true,
        needsEscalation: false,
        reason: reasonRequired.reason,
        matchedRule: reasonRequired.matchedRule,
        confidence: 0.9
      };
    }

    // Check for limit violations
    const limitViolation = results.find(r => r.limitExceeded);
    if (limitViolation) {
      return {
        approved: false,
        denied: true,
        needsEscalation: false,
        reason: limitViolation.reason,
        matchedRule: limitViolation.matchedRule,
        confidence: limitViolation.confidence
      };
    }

    // Check for auto-approve matches
    const autoApprove = results.find(r => r.autoApproved);
    if (autoApprove) {
      return {
        approved: true,
        denied: false,
        needsEscalation: false,
        reason: autoApprove.reason,
        matchedRule: autoApprove.matchedRule,
        confidence: autoApprove.confidence
      };
    }

    // Default: approve if no rules blocked it
    return {
      approved: true,
      denied: false,
      needsEscalation: false,
      reason: 'No conditions violated. Request approved.',
      matchedRule: null,
      confidence: 0.7
    };
  }

  /**
   * Evaluate global/vault-wide rules (separate from per-recipient conditions).
   *
   * @param {Object} request
   * @param {number} request.amount
   * @param {number} request.dailyVaultSpent - Total vault spending today
   * @param {number} request.dailyVaultLimit - Vault daily limit
   * @param {string[]} globalRules - Array of global rule strings
   * @returns {Object|null} Denial/escalation result, or null if passed
   */
  static evaluateGlobalRules(request, globalRules = []) {
    for (const rule of globalRules) {
      const lower = rule.toLowerCase();

      // "Total daily vault spending cannot exceed $X"
      const dailyLimitMatch = lower.match(/daily.*(?:cannot exceed|max|limit).*\$?([\d,]+)/);
      if (dailyLimitMatch) {
        const limit = parseFloat(dailyLimitMatch[1].replace(/,/g, ''));
        if ((request.dailyVaultSpent || 0) + request.amount > limit) {
          return {
            approved: false,
            denied: true,
            reason: `Vault daily spending limit of $${limit} would be exceeded. Already spent: $${request.dailyVaultSpent || 0}`,
            matchedRule: rule,
            confidence: 1.0
          };
        }
      }

      // "Requests over $X always need owner approval"
      const escalationMatch = lower.match(/(?:requests?|transfers?)\s*(?:over|above|>|exceeding)\s*\$?([\d,]+).*(?:need|require|must have)\s*(?:owner\s*)?approval/);
      if (escalationMatch) {
        const threshold = parseFloat(escalationMatch[1].replace(/,/g, ''));
        if (request.amount > threshold) {
          return {
            approved: false,
            needsEscalation: true,
            reason: `Amount ($${request.amount}) exceeds $${threshold} — owner approval required.`,
            matchedRule: rule,
            confidence: 1.0
          };
        }
      }
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Internal: Parse a condition string into a structured rule
  // ═══════════════════════════════════════════════════════════════════════

  _parseCondition(condition) {
    const lower = condition.toLowerCase().trim();
    const rule = { original: condition, type: 'unknown' };

    // ── Pattern: Amount limit with period ──────────────────────────────
    // "Max $500/month", "Up to $200/week", "Limit $100/day"
    const limitMatch = lower.match(/(?:max|maximum|up to|limit|cap)\s*\$?([\d,]+(?:\.\d+)?)\s*(?:\/|\s*per\s*)(day|daily|week|weekly|month|monthly|year|yearly)/);
    if (limitMatch) {
      rule.type = 'amount_limit';
      rule.amount = parseFloat(limitMatch[1].replace(/,/g, ''));
      rule.period = limitMatch[2].replace(/ly$/, '');
      // Normalize period
      if (rule.period === 'dai') rule.period = 'day';
      rule.categories = this._extractCategories(lower);
      return rule;
    }

    // ── Pattern: Deny category over amount ─────────────────────────────
    // "Deny gaming > $50", "Deny gaming or entertainment requests over $50"
    const denyCatMatch = lower.match(/deny\s+(.+?)(?:\s*(?:>|over|above|exceeding)\s*\$?([\d,]+(?:\.\d+)?))?$/);
    if (denyCatMatch) {
      rule.type = 'deny_category';
      rule.deny = true;
      rule.categories = this._extractCategories(denyCatMatch[1]);
      rule.amount = denyCatMatch[2] ? parseFloat(denyCatMatch[2].replace(/,/g, '')) : 0;
      return rule;
    }

    // ── Pattern: Only for category ─────────────────────────────────────
    // "Only for education expenses", "Extra funds only for education"
    const onlyMatch = lower.match(/only\s+(?:for|allow(?:ed)?)\s+(.+)/);
    if (onlyMatch) {
      rule.type = 'only_category';
      rule.categories = this._extractCategories(onlyMatch[1]);
      return rule;
    }

    // ── Pattern: Auto-approve/auto-send ────────────────────────────────
    // "Auto-approve utility bills", "Auto-send $3000 on 1st of month"
    const autoMatch = lower.match(/auto[- ](?:approve|send|pay)\s+(.+)/);
    if (autoMatch) {
      rule.type = 'auto_approve';
      rule.categories = this._extractCategories(autoMatch[1]);
      // Check for amount
      const amountMatch = autoMatch[1].match(/\$?([\d,]+(?:\.\d+)?)/);
      if (amountMatch) {
        rule.amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      }
      // Check for recurring day
      const dayMatch = autoMatch[1].match(/(?:on\s+)?(\d+)(?:st|nd|rd|th)\s+(?:of\s+)?(?:every\s+)?month/);
      if (dayMatch) {
        rule.dayOfMonth = parseInt(dayMatch[1]);
      }
      return rule;
    }

    // ── Pattern: Escalation threshold ──────────────────────────────────
    // "Requests > $1000 need owner approval"
    const escalateMatch = lower.match(/(?:requests?|transfers?|amounts?)\s*(?:over|above|>|>=|exceeding)\s*\$?([\d,]+(?:\.\d+)?)\s*(?:need|require|must)/);
    if (escalateMatch) {
      rule.type = 'escalation';
      rule.amount = parseFloat(escalateMatch[1].replace(/,/g, ''));
      rule.needsApproval = true;
      return rule;
    }

    // ── Pattern: Recurring allowance ───────────────────────────────────
    // "Weekly allowance of $200", "$100 weekly allowance"
    const allowanceMatch = lower.match(/(?:(daily|weekly|monthly|yearly)\s+allowance\s+(?:of\s+)?\$?([\d,]+(?:\.\d+)?))|(?:\$?([\d,]+(?:\.\d+)?)\s+(daily|weekly|monthly|yearly)\s+allowance)/);
    if (allowanceMatch) {
      rule.type = 'allowance';
      rule.period = (allowanceMatch[1] || allowanceMatch[4]).replace(/ly$/, '');
      if (rule.period === 'dai') rule.period = 'day';
      if (rule.period === 'week') rule.period = 'week';
      rule.amount = parseFloat((allowanceMatch[2] || allowanceMatch[3]).replace(/,/g, ''));
      // Check for reset day
      const resetMatch = lower.match(/reset(?:s)?\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
      if (resetMatch) {
        rule.resetDay = resetMatch[1];
      }
      return rule;
    }

    // ── Pattern: Require reason over amount ────────────────────────────
    // "Requests over $200 require a reason"
    const reasonMatch = lower.match(/(?:requests?|transfers?)\s*(?:over|above|>)\s*\$?([\d,]+(?:\.\d+)?)\s*(?:require|need|must have)\s*(?:a\s+)?reason/);
    if (reasonMatch) {
      rule.type = 'require_reason';
      rule.amount = parseFloat(reasonMatch[1].replace(/,/g, ''));
      rule.requireReason = true;
      return rule;
    }

    // ── Fallback: try to extract any useful info ───────────────────────
    const anyAmount = lower.match(/\$?([\d,]+(?:\.\d+)?)/);
    if (anyAmount) {
      rule.amount = parseFloat(anyAmount[1].replace(/,/g, ''));
    }
    rule.categories = this._extractCategories(lower);

    return rule;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Internal: Evaluate a single rule against a request
  // ═══════════════════════════════════════════════════════════════════════

  _evaluateRule(rule, request) {
    switch (rule.type) {

      case 'amount_limit':
        return this._evalAmountLimit(rule, request);

      case 'deny_category':
        return this._evalDenyCategory(rule, request);

      case 'only_category':
        return this._evalOnlyCategory(rule, request);

      case 'auto_approve':
        return this._evalAutoApprove(rule, request);

      case 'escalation':
        return this._evalEscalation(rule, request);

      case 'allowance':
        return this._evalAllowance(rule, request);

      case 'require_reason':
        return this._evalRequireReason(rule, request);

      default:
        return null;
    }
  }

  /** Amount limit: "Max $500/month for groceries" */
  _evalAmountLimit(rule, request) {
    // If rule has categories, only apply if request matches
    if (rule.categories.length > 0) {
      const requestCategories = this._categorizeText(request.reason || '');
      const matches = rule.categories.some(c => requestCategories.includes(c));
      if (!matches) return null; // Rule doesn't apply to this request
    }

    // Check against spending in the relevant period
    let spent = 0;
    const period = rule.period;
    if (period === 'day' || period === 'daily') {
      spent = request.history?.dailySpent || 0;
    } else if (period === 'week' || period === 'weekly') {
      spent = request.history?.weeklySpent || 0;
    } else if (period === 'month' || period === 'monthly') {
      spent = request.history?.monthlySpent || 0;
    }

    if (spent + request.amount > rule.amount) {
      return {
        limitExceeded: true,
        reason: `Would exceed ${period} limit of $${rule.amount}. Already spent: $${spent}. Remaining: $${Math.max(0, rule.amount - spent)}.`,
        matchedRule: rule.original,
        confidence: 0.95
      };
    }

    return null;
  }

  /** Deny category: "Deny gaming or entertainment requests over $50" */
  _evalDenyCategory(rule, request) {
    const requestCategories = this._categorizeText(request.reason || '');
    const matches = rule.categories.some(c => requestCategories.includes(c));

    if (!matches) return null; // Doesn't match denied categories

    // If there's an amount threshold, only deny above it
    if (rule.amount > 0 && request.amount <= rule.amount) {
      return null; // Under the threshold
    }

    const amountNote = rule.amount > 0 ? ` over $${rule.amount}` : '';
    return {
      denied: true,
      reason: `Request matches denied category${amountNote}: "${rule.original}"`,
      matchedRule: rule.original,
      confidence: 0.85
    };
  }

  /** Only category: "Only for education expenses" */
  _evalOnlyCategory(rule, request) {
    const requestCategories = this._categorizeText(request.reason || '');
    const matches = rule.categories.some(c => requestCategories.includes(c));

    if (!matches && request.reason && request.reason.trim().length > 0) {
      return {
        denied: true,
        reason: `Extra funds are only allowed for: ${rule.categories.join(', ')}. Your request doesn't match.`,
        matchedRule: rule.original,
        confidence: 0.8
      };
    }

    return null;
  }

  /** Auto-approve: "Auto-approve utility bills" */
  _evalAutoApprove(rule, request) {
    const requestCategories = this._categorizeText(request.reason || '');
    const matches = rule.categories.some(c => requestCategories.includes(c));

    if (matches) {
      return {
        autoApproved: true,
        reason: `Auto-approved: matches "${rule.original}"`,
        matchedRule: rule.original,
        confidence: 0.9
      };
    }

    return null;
  }

  /** Escalation: "Requests > $1000 need owner approval" */
  _evalEscalation(rule, request) {
    if (request.amount > rule.amount) {
      return {
        needsEscalation: true,
        reason: `Amount ($${request.amount}) exceeds $${rule.amount} — owner approval required.`,
        matchedRule: rule.original,
        confidence: 1.0
      };
    }
    return null;
  }

  /** Allowance: "Weekly allowance of $200, resets Monday" */
  _evalAllowance(rule, request) {
    let spent = 0;
    if (rule.period === 'day') spent = request.history?.dailySpent || 0;
    else if (rule.period === 'week') spent = request.history?.weeklySpent || 0;
    else if (rule.period === 'month') spent = request.history?.monthlySpent || 0;

    if (spent + request.amount > rule.amount) {
      return {
        limitExceeded: true,
        reason: `Would exceed ${rule.period}ly allowance of $${rule.amount}. Already used: $${spent}. Remaining: $${Math.max(0, rule.amount - spent)}.`,
        matchedRule: rule.original,
        confidence: 0.95
      };
    }

    // If within allowance, auto-approve
    return {
      autoApproved: true,
      reason: `Within ${rule.period}ly allowance of $${rule.amount} ($${spent} used).`,
      matchedRule: rule.original,
      confidence: 0.9
    };
  }

  /** Require reason: "Requests over $200 require a reason" */
  _evalRequireReason(rule, request) {
    if (request.amount > rule.amount) {
      if (!request.reason || request.reason.trim().length < 3) {
        return {
          requireReason: true,
          reason: `Requests over $${rule.amount} require a reason. Please explain what the funds are for.`,
          matchedRule: rule.original,
          confidence: 0.95
        };
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Internal: Category Extraction & Matching
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Extract category names from a condition text.
   * @param {string} text
   * @returns {string[]} Array of matched category names
   */
  _extractCategories(text) {
    const lower = text.toLowerCase();
    const matched = [];

    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        matched.push(category);
      }
    }

    return matched;
  }

  /**
   * Categorize a request text (reason/purpose) into categories.
   * @param {string} text
   * @returns {string[]} Array of matched category names
   */
  _categorizeText(text) {
    return this._extractCategories(text);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Exports
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = { ConditionEngine, CATEGORY_KEYWORDS, PERIOD_MS };
