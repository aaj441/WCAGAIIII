const Stripe = require('stripe');

/**
 * WCAGAI v4.0 Stripe Billing Integration
 * Implements 5-stream revenue model with automated processing
 */

class StripeBilling {
    constructor() {
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        this.plans = {
            developer: {
                priceId: 'price_developer_monthly', // Create in Stripe dashboard
                amount: 4900, // $49.00 in cents
                name: 'Developer Plan',
                features: ['1,000 scans/month', 'Basic reports', 'CI/CD integration']
            },
            compliance: {
                priceId: 'price_compliance_monthly', 
                amount: 29900, // $299.00
                name: 'Compliance Plan',
                features: ['10,000 scans/month', 'Vertical discovery', '500 AI fixes', 'Legal risk scoring']
            },
            enterprise: {
                priceId: 'price_enterprise_monthly',
                amount: 99900, // $999.00
                name: 'Enterprise Plan', 
                features: ['Unlimited scans', 'All verticals', 'Unlimited AI fixes', 'API access', 'White-label']
            }
        };
        
        // AI credit packages
        this.creditPackages = {
            starter: { credits: 100, amount: 4900 }, // $49
            pro: { credits: 1000, amount: 39900 }, // $399
            enterprise: { credits: 10000, amount: 299900 } // $2,999
        };
    }

    /**
     * Create subscription for customer
     */
    async createSubscription(customerId, plan, paymentMethodId) {
        try {
            const stripePlan = this.plans[plan];
            if (!stripePlan) {
                throw new Error('Invalid plan selected');
            }

            // Create or retrieve Stripe customer
            const customer = await this.getOrCreateCustomer(customerId, paymentMethodId);

            // Create subscription
            const subscription = await this.stripe.subscriptions.create({
                customer: customer.id,
                items: [{
                    price: stripePlan.priceId
                }],
                payment_behavior: 'default_incomplete',
                payment_settings: {
                    save_default_payment_method: 'on_subscription'
                },
                expand: ['latest_invoice.payment_intent'],
                metadata: {
                    customerId: customerId,
                    plan: plan,
                    source: 'wcagai_v4'
                }
            });

            return {
                subscriptionId: subscription.id,
                clientSecret: subscription.latest_invoice.payment_intent.client_secret,
                plan: plan,
                amount: stripePlan.amount,
                status: subscription.status
            };

        } catch (error) {
            console.error('❌ Subscription creation failed:', error.message);
            throw error;
        }
    }

    /**
     * Purchase AI credits
     */
    async purchaseCredits(customerId, packageType, paymentMethodId) {
        try {
            const creditPackage = this.creditPackages[packageType];
            if (!creditPackage) {
                throw new Error('Invalid credit package');
            }

            const customer = await this.getOrCreateCustomer(customerId, paymentMethodId);

            // Create payment intent for one-time purchase
            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: creditPackage.amount,
                currency: 'usd',
                customer: customer.id,
                payment_method: paymentMethodId,
                confirm: true,
                metadata: {
                    type: 'credit_purchase',
                    package: packageType,
                    credits: creditPackage.credits,
                    customerId: customerId
                }
            });

            console.log(`💰 Credits Purchased: ${creditPackage.credits} for $${creditPackage.amount / 100}`);

            return {
                paymentIntentId: paymentIntent.id,
                credits: creditPackage.credits,
                amount: creditPackage.amount,
                status: paymentIntent.status
            };

        } catch (error) {
            console.error('❌ Credit purchase failed:', error.message);
            throw error;
        }
    }

    /**
     * Process microtransaction for AI fix
     */
    async processAIFix(customerId, fixId, amount) {
        try {
            // Amount is already in cents (e.g., $0.50 = 50 cents)
            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: amount, // Small amount for microtransaction
                currency: 'usd',
                customer: customerId, // Assuming Stripe customer exists
                payment_method: 'default', // Use saved payment method
                confirm: true,
                off_session: true, // Charge without user interaction
                metadata: {
                    type: 'ai_fix',
                    fixId: fixId,
                    customerId: customerId
                }
            });

            if (paymentIntent.status === 'succeeded') {
                console.log(`💰 AI Fix Charged: $${amount / 100} for fix ${fixId}`);
                return { success: true, paymentIntentId: paymentIntent.id };
            } else {
                throw new Error(`Payment failed: ${paymentIntent.status}`);
            }

        } catch (error) {
            console.error('❌ AI fix payment failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create benchmark report purchase
     */
    async purchaseBenchmarkReport(customerId, vertical, customData = {}) {
        try {
            const prices = {
                healthcare: 199900, // $1,999
                fintech: 249900,    // $2,499
                ecommerce: 179900  // $1,799
            };

            const amount = prices[vertical] || 199900;

            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                customer: customerId,
                confirm: false, // Require customer confirmation for high-value
                metadata: {
                    type: 'benchmark_report',
                    vertical: vertical,
                    customerId: customerId,
                    ...customData
                }
            });

            console.log(`📊 Benchmark Report Created: ${vertical} - $${amount / 100}`);

            return {
                clientSecret: paymentIntent.client_secret,
                amount: amount,
                vertical: vertical,
                paymentIntentId: paymentIntent.id
            };

        } catch (error) {
            console.error('❌ Benchmark report purchase failed:', error.message);
            throw error;
        }
    }

    /**
     * Get or create Stripe customer
     */
    async getOrCreateCustomer(customerId, paymentMethodId = null) {
        try {
            // First try to find existing customer
            const existingCustomers = await this.stripe.customers.list({
                email: customerId, // Assuming customerId is email for demo
                limit: 1
            });

            if (existingCustomers.data.length > 0) {
                const customer = existingCustomers.data[0];
                
                // Attach payment method if provided
                if (paymentMethodId) {
                    await this.stripe.paymentMethods.attach(paymentMethodId, {
                        customer: customer.id
                    });
                }
                
                return customer;
            }

            // Create new customer
            const customer = await this.stripe.customers.create({
                email: customerId,
                payment_method: paymentMethodId,
                invoice_settings: {
                    default_payment_method: paymentMethodId
                },
                metadata: {
                    source: 'wcagai_v4'
                }
            });

            return customer;

        } catch (error) {
            console.error('❌ Customer creation failed:', error.message);
            throw error;
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: true
            });

            console.log(`📅 Subscription Canceled: ${subscriptionId} (ends at period end)`);
            
            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                currentPeriodEnd: subscription.current_period_end
            };

        } catch (error) {
            console.error('❌ Subscription cancellation failed:', error.message);
            throw error;
        }
    }

    /**
     * Get customer's subscription status
     */
    async getCustomerSubscription(customerId) {
        try {
            const customer = await this.getOrCreateCustomer(customerId);
            
            const subscriptions = await this.stripe.subscriptions.list({
                customer: customer.id,
                status: 'active',
                limit: 1
            });

            if (subscriptions.data.length === 0) {
                return { active: false };
            }

            const subscription = subscriptions.data[0];
            const plan = Object.keys(this.plans).find(key => 
                this.plans[key].priceId === subscription.items.data[0].price.id
            );

            return {
                active: true,
                subscriptionId: subscription.id,
                plan: plan,
                status: subscription.status,
                currentPeriodEnd: subscription.current_period_end,
                cancelAtPeriodEnd: subscription.cancel_at_period_end
            };

        } catch (error) {
            console.error('❌ Failed to get subscription:', error.message);
            return { active: false, error: error.message };
        }
    }

    /**
     * Calculate revenue metrics
     */
    async getRevenueMetrics(period = 'month') {
        try {
            const now = Math.floor(Date.now() / 1000);
            let periodStart;
            
            if (period === 'day') periodStart = now - (24 * 60 * 60);
            else if (period === 'week') periodStart = now - (7 * 24 * 60 * 60);
            else if (period === 'month') periodStart = now - (30 * 24 * 60 * 60);
            else if (period === 'year') periodStart = now - (365 * 24 * 60 * 60);

            // Get revenue from payments
            const charges = await this.stripe.charges.list({
                created: { gte: periodStart },
                limit: 100
            });

            const totalRevenue = charges.data.reduce((sum, charge) => sum + charge.amount, 0);
            const successfulCharges = charges.data.filter(charge => charge.status === 'succeeded').length;
            
            // Get subscription revenue
            const subscriptions = await this.stripe.subscriptions.list({
                status: 'active',
                limit: 100
            });

            const mrr = subscriptions.data.reduce((sum, sub) => {
                return sum + (sub.items.data[0].price.unit_amount * (sub.items.data[0].quantity || 1));
            }, 0);

            return {
                period,
                totalRevenue,
                totalCharges: charges.data.length,
                successfulCharges,
                mrr,
                activeSubscriptions: subscriptions.data.length,
                averageTransactionSize: successfulCharges > 0 ? totalRevenue / successfulCharges : 0
            };

        } catch (error) {
            console.error('❌ Revenue metrics failed:', error.message);
            return { error: error.message };
        }
    }

    /**
     * Create webhook handler for payment events
     */
    constructWebhookEvent(payload, signature) {
        try {
            return this.stripe.webhooks.constructEvent(
                payload,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );
        } catch (error) {
            console.error('❌ Webhook signature verification failed:', error.message);
            throw error;
        }
    }
}

module.exports = StripeBilling;