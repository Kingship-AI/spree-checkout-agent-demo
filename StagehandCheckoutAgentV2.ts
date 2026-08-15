/**
 * StagehandCheckoutAgentV2 - Autonomous Agent-Based E-commerce Checkout
 * 
 * Uses Stagehand's agent() method for autonomous checkout that adapts to different website patterns.
 */

import { Stagehand } from '@browserbasehq/stagehand';
import dotenv from 'dotenv';
import type { ShippingInfo, PaymentInfo, SiteCredentials, CheckoutResult } from './types.js';
import { getCardFromEnv } from './services/stripeService.js';
import { getCheckoutValidator, type ValidationResult } from './services/checkoutValidator.js';

dotenv.config();

export class StagehandCheckoutAgentV2 {
  private stagehand: Stagehand | null = null;
  private sessionId: string | null = null;
  private contextId: string | null = null;

  async initialize(siteUrl?: string, useContext: boolean = true) {
    console.log('🚀 Initializing Stagehand with Browserbase...');
    
    // Check for existing context first (from manual login)
    if (useContext && siteUrl) {
      const { getContextManager } = await import('./services/contextManager.js');
      const contextManager = getContextManager();
      
      const existingContextId: string | undefined = contextManager.getContext(siteUrl);
      if (existingContextId) {
        this.contextId = existingContextId as string;
        console.log(`✅ Found existing context for ${siteUrl}`);
      }
    }
    
    this.stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      verbose: 2, // Increase verbosity for better debugging
      experimental: true, // Required for hybrid mode
      cacheDir: 'checkout-cache', // Enable deterministic caching (10-100x faster subsequent runs)
      model: 'google/gemini-2.5-computer-use-preview-10-2025', // Computer use model - 66.7% success rate
      domSettleTimeout: 120000,
      browserbaseSessionCreateParams: {
        projectId: process.env.BROWSERBASE_PROJECT_ID!,
        proxies: true,
        region: "us-west-2",
        timeout: 3600,
        browserSettings: {
          advancedStealth: false,
          blockAds: true,
          solveCaptchas: true,
          viewport: {
            width: 1288,
            height: 711,
          },
          fingerprint: {
            browsers: ["chrome", "edge"],
            devices: ["desktop"],
            operatingSystems: ["windows", "macos"],
            locales: ["en-US", "en-GB"]
          },
          ...(this.contextId && {
            context: {
              id: this.contextId,
              persist: true,
            },
          }),
        },
        userMetadata: {
          userId: process.env.USER_ID || 'spree-agent',
          environment: process.env.NODE_ENV || 'production',
        },
      },
    });

    await this.stagehand.init();
    console.log('✅ Stagehand initialized successfully');
    
    if (this.contextId) {
      console.log('💾 Context persistence enabled - authentication will be saved');
    }
  }

  /**
   * AUTONOMOUS CHECKOUT using agent()
   * 
   * This method uses a single autonomous agent to handle the entire checkout flow.
   * The agent will:
   * 1. Navigate to the product page
   * 2. Figure out how to add to cart (handling options/variants)
   * 3. Navigate to cart
   * 4. Proceed to checkout
   * 5. Handle login/guest checkout intelligently
   * 6. Fill shipping information
   * 7. Fill payment information
   * 8. Reach final checkout/review page
   */
  async automateCheckoutWithAgent(
    productUrl: string,
    maxSteps: number = 50, // Default 50 steps for complex checkout flows
    shippingInfo?: ShippingInfo,
    paymentInfo?: PaymentInfo,
    credentials?: SiteCredentials,
    productSpecs?: Record<string, string>
  ): Promise<CheckoutResult> {
    if (!shippingInfo) {
      throw new Error('SHIPPING_INFO_REQUIRED: Shipping information must be provided');
    }

    const shipping = shippingInfo;

    const stripeCard = await getCardFromEnv();
    
    if (!stripeCard) {
      throw new Error('STRIPE_CARD_REQUIRED: No Stripe card found in environment. Set CARD_ID in .env file.');
    }

    console.log('💳 Using Stripe virtual card for payment and billing');
    console.log(`   Card: ${stripeCard.brand} ending in ${stripeCard.card_number.slice(-4)}`);
    console.log(`   Cardholder: ${stripeCard.cardholder_firstName} ${stripeCard.cardholder_lastName}`);

    // Payment info ALWAYS comes from Stripe - no fallback, no override
    const payment: PaymentInfo = {
      cardNumber: stripeCard.card_number,
      expirationDate: `${stripeCard.expiration_month.toString().padStart(2, '0')}/${stripeCard.expiration_year}`,
      cvv: stripeCard.cvc,
      cardholderName: `${stripeCard.cardholder_firstName} ${stripeCard.cardholder_lastName}`,
      billingAddress: {
        firstName: stripeCard.cardholder_firstName,
        lastName: stripeCard.cardholder_lastName,
        address: stripeCard.cardholder_address.line1,
        city: stripeCard.cardholder_address.city,
        state: stripeCard.cardholder_address.state,
        zipCode: stripeCard.cardholder_address.postal_code,
        country: stripeCard.cardholder_address.country
      }
    };

    const result: CheckoutResult = {
      success: false,
      steps: [],
      decisions: [],
    };

    try {
      if (!this.stagehand) {
        throw new Error('Stagehand not initialized. Call initialize() first.');
      }

      console.log('\n========================================');
      console.log('🤖 AUTONOMOUS CHECKOUT AGENT STARTING');
      console.log('========================================\n');

      const page = this.stagehand.context.pages()[0];
      
      // Navigate to product page first (best practice)
      console.log(`🌐 Navigating to: ${productUrl}`);
      await page.goto(productUrl);
      await page.waitForLoadState('domcontentloaded');
      console.log('✅ Product page loaded\n');

      // Log product specs if provided
      if (productSpecs && Object.keys(productSpecs).length > 0) {
        console.log('📦 Product Specifications to select:');
        Object.entries(productSpecs).forEach(([key, value]) => {
          console.log(`   - ${key}: ${value}`);
        });
        console.log('');
      }

      // Agent configuration with computer use model (66.7% success rate vs 0% with standard)
      // Set STAGEHAND_MODEL env var to use different models:
      // - google/gemini-2.5-computer-use-preview-10-2025 (DEFAULT - best performance)
      // - google/gemini-2.5-pro (hybrid mode, standard)
      // - google/gemini-2.5-flash (faster, cheaper)
      // - claude-3-7-sonnet (requires ANTHROPIC_API_KEY)
      const modelName = process.env.STAGEHAND_MODEL || "google/gemini-2.5-computer-use-preview-10-2025";
      const agentMode = process.env.STAGEHAND_MODE || "cua"; // cua (computer use) | hybrid | visual | dom
      
      console.log(`🤖 Agent Configuration:`);
      console.log(`   Model: ${modelName}`);
      console.log(`   Mode: ${agentMode}`);
      console.log(`   Max Steps: ${maxSteps}`);
      console.log('');
      
      const agent = this.stagehand.agent({
        mode: agentMode as any,
        model: modelName,
        systemPrompt: this.buildSystemPrompt(shipping, payment, credentials, productSpecs)
      });

      console.log('🧠 Starting autonomous agent execution...');
      console.log(`⚙️  Configuration: Model=${modelName}, MaxSteps=${maxSteps}, Mode=${agentMode}`);
      const instruction = this.buildCheckoutInstruction(shipping, payment, credentials, productSpecs);
      console.log('📝 Instruction:', instruction);
      console.log('');

      const agentResult = await agent.execute({
        instruction: instruction,
        maxSteps: maxSteps, // Use parameter instead of hardcoded value
        highlightCursor: true, // Visual cursor highlight for better debugging and coordinate accuracy
      });

      // Process agent result
      result.success = agentResult.completed && agentResult.success;
      result.finalUrl = page.url();
      result.decisions = agentResult.actions.map((action: any, idx: number) => ({
        step: idx + 1,
        type: action.type,
        reasoning: action.reasoning,
        completed: action.taskCompleted,
        action: action.action || action.instruction,
        timestamp: action.timestamp
      }));

      if (this.sessionId) {
        result.sessionUrl = `https://browserbase.com/sessions/${this.sessionId}`;
      }

      console.log('\n========================================');
      console.log('✅ AUTONOMOUS AGENT EXECUTION COMPLETE');
      console.log('========================================\n');
      console.log(`📊 Agent Status: ${agentResult.success ? '✅ SUCCESS' : '⚠️ PARTIAL'}`);
      console.log(`📝 Agent Message: ${agentResult.message}`);
      console.log(`🔢 Actions Taken: ${agentResult.actions.length}`);
      console.log(`✓ Task Completed: ${agentResult.completed ? 'YES' : 'NO'}`);
      console.log(`🌐 Final URL: ${result.finalUrl}`);
      
      // Capture token usage for eval tracking
      if (agentResult.usage) {
        const totalTokens = agentResult.usage.input_tokens + agentResult.usage.output_tokens + (agentResult.usage.reasoning_tokens || 0);
        console.log(`\n💡 Token Usage:`);
        console.log(`   Input: ${agentResult.usage.input_tokens || 0}`);
        console.log(`   Output: ${agentResult.usage.output_tokens || 0}`);
        console.log(`   Reasoning: ${agentResult.usage.reasoning_tokens || 0}`);
        console.log(`   Total: ${totalTokens}`);
        console.log(`   Time: ${agentResult.usage.inference_time_ms || 0}ms`);
      } else {
        console.warn('⚠️  No token usage data available from agent');
      }

      if (result.sessionUrl) {
        console.log(`\n📹 Session Recording: ${result.sessionUrl}`);
      }

      console.log('========================================\n');

      // Validate final state
      const finalUrl = result.finalUrl?.toLowerCase() || '';
      const onCheckoutPage = finalUrl.includes('checkout') ||
                            finalUrl.includes('payment') ||
                            finalUrl.includes('review') ||
                            finalUrl.includes('confirm');

      if (onCheckoutPage && agentResult.completed) {
        console.log('\n🔍 PERFORMING FINAL CHECKOUT VALIDATION...\n');
        
        const validator = getCheckoutValidator();
        const validation: ValidationResult = await validator.validateCheckout(
          this.stagehand,
          shipping,
          payment,
          {
            name: undefined,
            specs: undefined
          }
        );

        result.validation = validation;

        if (validation.valid) {
          result.success = true;
          console.log('✅ SUCCESS! Agent reached checkout page AND validation passed');
          console.log(`   Confidence: ${validation.confidence.toUpperCase()}`);
        } else {
          result.success = false;
          console.log('⚠️ WARNING! Agent reached checkout page but validation FAILED');
          console.log(`   Errors: ${validation.errors.length}`);
          console.log(`   Review URL: ${result.finalUrl}`);
          console.log('   ⚡ ADMIN INTERVENTION REQUIRED');
          
          if (result.sessionUrl) {
            console.log(`   📹 Session Recording: ${result.sessionUrl}`);
          }
        }
      } else if (agentResult.completed) {
        console.log('✅ Agent completed task (verify final page manually)');
      } else {
        console.log('⚠️ Agent stopped before completing full checkout');
        result.success = false;
      }

    } catch (error: any) {
      console.error('❌ Autonomous agent failed:', error.message);
      result.error = error.message;
      result.success = false;
    } finally {
      // Always close the session to prevent it from running indefinitely
      if (this.stagehand) {
        console.log('🔒 Closing Browserbase session...');
        try {
          await this.stagehand.close();
          console.log('✅ Session closed successfully');
        } catch (closeError: any) {
          console.warn('⚠️ Error closing session:', closeError.message);
        }
        this.stagehand = null;
      }
    }

    return result;
  }

  private buildSystemPrompt(
    shipping: ShippingInfo,
    payment: PaymentInfo,
    credentials?: SiteCredentials,
    productSpecs?: Record<string, string>
  ): string {
    // Per Stagehand best practices: system prompt defines BEHAVIOR + provides data context
    const specsContext = productSpecs && Object.keys(productSpecs).length > 0
      ? `\n\nPRODUCT OPTIONS TO SELECT:\n${Object.entries(productSpecs).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`
      : '';

    const loginContext = credentials
      ? `\n\nLOGIN CREDENTIALS:\nUsername: ${credentials.username}\nPassword: ${credentials.password}`
      : '';

    return `You are a professional e-commerce checkout automation agent with extensive experience completing online purchases.

🎯 YOUR MISSION: Complete the ENTIRE checkout process from product page to review page (DO NOT place the final order).

⚠️ CRITICAL INSTRUCTIONS:
1. You are ALREADY on the product page - DO NOT navigate away or search
2. COMPLETE ALL STEPS - do not stop until you reach the final review page
3. Take as many steps as needed (you have sufficient steps available)
4. If you encounter errors or obstacles, try alternative approaches
5. DO NOT assume the task is complete until you see the review/confirmation page

📦 CHECKOUT DATA AVAILABLE:

SHIPPING INFORMATION:
Name: ${shipping.firstName} ${shipping.lastName}
Address: ${shipping.address}
City/State/ZIP: ${shipping.city}, ${shipping.state} ${shipping.zipCode}
Phone: ${process.env.COMPANY_PHONE || '+14257863300'}
Email: ${process.env.COMPANY_EMAIL || 'kingshipai2@gmail.com'}

PAYMENT INFORMATION:
Card Number: ${payment.cardNumber}
Expiration: ${payment.expirationDate}
CVV: ${payment.cvv}
Cardholder Name: ${payment.cardholderName}

BILLING ADDRESS:
${payment.billingAddress ? `${payment.billingAddress.firstName} ${payment.billingAddress.lastName}\n${payment.billingAddress.address}\n${payment.billingAddress.city}, ${payment.billingAddress.state} ${payment.billingAddress.zipCode}\n${payment.billingAddress.country}` : 'Same as shipping address'}${specsContext}${loginContext}

🔄 STEP-BY-STEP PROCESS (COMPLETE ALL STEPS):

STEP 1 - HANDLE PRODUCT OPTIONS:
• Look for size, color, quantity selectors
• Select the required options ${productSpecs ? `(${Object.entries(productSpecs).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}
• Ensure all required selections are made

STEP 2 - ADD TO CART:
• Click "Add to Cart", "Add to Bag", or similar button
• Wait for confirmation that item was added
• DO NOT click "Buy Now" or "Checkout" yet

STEP 3 - NAVIGATE TO CART:
• Click "View Cart", cart icon, or navigate to cart page
• Verify product is in cart with correct options

STEP 4 - PROCEED TO CHECKOUT:
• Click "Checkout", "Proceed to Checkout", or similar button
• Choose GUEST checkout if available (unless credentials provided)
• If login is required, use provided credentials

STEP 5 - FILL SHIPPING INFORMATION:
• Fill ALL required shipping fields with data above
• Select country/state from dropdowns if available
• Click "Continue" or "Next" to proceed

STEP 6 - FILL PAYMENT INFORMATION:
• Enter card number, expiration, CVV
• Enter cardholder name
• Fill billing address (or select "Same as shipping")
• Click "Continue" or "Review Order"

STEP 7 - REACH REVIEW PAGE:
• You should now be on order review/confirmation page
• Verify you can see:
  - Product details
  - Shipping address
  - Payment method (last 4 digits)
  - "Place Order" or "Complete Purchase" button
• ✅ STOP HERE - DO NOT click the final order button

🚨 OBSTACLES TO HANDLE:
• Cookie banners: Click "Accept" or "Continue without"
• Email popups: Click X to close or "No thanks"• Upsells/recommendations: Decline and continue
• Account creation prompts: Choose guest checkout
• Promo code fields: Leave empty and continue
• Shipping method: Select cheapest/standard option
• Required fields: Fill ALL fields - missing fields prevent progress

⛔ SUCCESS CRITERIA (MUST REACH ALL):
✓ Product options selected (if applicable)
✓ Item added to cart
✓ Cart page visited and verified
✓ Checkout initiated
✓ Shipping information filled completely
✓ Payment information filled completely
✓ Review page reached with "Place Order" button visible

⛔ DO NOT STOP EARLY:
❌ DO NOT stop after just viewing the product
❌ DO NOT stop after clicking "Add to Cart"
❌ DO NOT stop at cart page
❌ DO NOT stop at shipping page
❌ DO NOT stop at payment page
✅ ONLY stop when you reach the REVIEW PAGE with all info visible

Remember: You have sufficient steps to complete this task. Be thorough and methodical. Complete ALL steps above.`;
  }

  private buildCheckoutInstruction(
    shipping: ShippingInfo,
    payment: PaymentInfo,
    credentials?: SiteCredentials,
    productSpecs?: Record<string, string>
  ): string {
    // Per Stagehand best practices: goal-oriented instruction with clear success criteria
    return `Complete the checkout process for THIS product. Add to cart, proceed to checkout, fill all shipping and payment forms with the provided data, and stop at the order review page. Do NOT place the actual order - success is reaching the review page where you can see a "Place Order" button that you did NOT click.`;
  }

  async close() {
    if (this.stagehand) {
      await this.stagehand.close();
      console.log('🔒 Stagehand session closed');
    }
  }
}
