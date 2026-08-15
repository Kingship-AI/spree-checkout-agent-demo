import { waitForTimeout, getContent, pressKey, typeText } from './utils/pageHelpers.js';
import 'dotenv/config';
import { Stagehand } from '@browserbasehq/stagehand';
import { getContextManager } from './services/contextManager.js';
import { SiteCredentials } from './types.js';

/**
 * Login Onboarding Flow
 * Purpose: Log into a site and save the authentication context for future use
 * 
 * Usage:
 *   npm run login-onboarding
 * 
 * This will:
 * 1. Navigate to the login URL
 * 2. Fill in credentials and submit
 * 3. Verify login success
 * 4. Save the authenticated session to Browserbase context
 * 5. Future checkout flows will automatically use this saved login
 */

export class LoginOnboarding {
  private stagehand: Stagehand | null = null;
  private contextId: string | null = null;

  async initialize(siteUrl: string) {
    console.log('\n========================================');
    console.log('🔐 LOGIN ONBOARDING FLOW');
    console.log('========================================\n');
    
    // Get or create context for this site
    const contextManager = getContextManager();
    this.contextId = await contextManager.getOrCreateContext(siteUrl);
    console.log(`🔗 Using context: ${this.contextId}\n`);
    
    console.log('🚀 Initializing Stagehand with Browserbase...');
    console.log(`📋 Will save to context: ${this.contextId}`);
    
    // Initialize with context persistence enabled
    this.stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      verbose: 1,
      model: 'google/gemini-2.5-flash',
      domSettleTimeout: 30000,
      browserbaseSessionCreateParams: {
        browserSettings: {
          context: {
            id: this.contextId,
            persist: true,
          },
        },
      },
    });

    await this.stagehand.init();
    console.log('✅ Stagehand initialized successfully\n');
  }

  async login(loginUrl: string, credentials: SiteCredentials): Promise<boolean> {
    if (!this.stagehand) {
      throw new Error('Stagehand not initialized. Call initialize() first.');
    }

    const page = this.stagehand.context.pages()[0];

    try {
      // Step 1: Navigate to login page
      console.log('========================================');
      console.log('📍 Step 1: Navigate to login page');
      console.log('========================================');
      console.log(`🌐 URL: ${loginUrl}\n`);
      
      await page.goto(loginUrl, { waitUntil: 'networkidle' });
      await waitForTimeout(page, 5000);
      
      const currentUrl = page.url();
      console.log(`✅ Loaded: ${currentUrl}\n`);

      // Wait for login form to be fully rendered
      console.log('⏳ Waiting for login form to load...\n');
      await waitForTimeout(page, 3000);

      // Analyze login page pattern using observe
      console.log('========================================');
      console.log('🔍 Step 2: Observe page elements');
      console.log('========================================');
      
      const loginElements = await this.stagehand.observe(
        "Find the email field, username field, password field, continue button, next button, and sign in button on this page"
      );
      
      console.log(`📋 Found ${loginElements.length} elements:`);
      loginElements.forEach((el, idx) => {
        console.log(`   ${idx + 1}. ${el.description} [${el.method}]`);
      });
      console.log();
      
      // Determine login pattern based on observed elements
      const hasPasswordField = loginElements.some(el => 
        el.description.toLowerCase().includes('password')
      );
      const hasContinueButton = loginElements.some(el => 
        el.description.toLowerCase().includes('continue') || 
        el.description.toLowerCase().includes('next')
      );
      
      let loginPattern: 'single-page' | 'email-first' = 'single-page';
      
      if (!hasPasswordField && hasContinueButton) {
        loginPattern = 'email-first';
        console.log('📋 Pattern: EMAIL-FIRST (email → continue → password)\n');
      } else if (hasPasswordField) {
        loginPattern = 'single-page';
        console.log('📋 Pattern: SINGLE-PAGE (email + password together)\n');
      } else {
        console.log('📋 Pattern: UNKNOWN (will proceed step-by-step)\n');
      }

      // Step 3: Enter email/username
      console.log('========================================');
      console.log('📝 Step 3: Enter email/username');
      console.log('========================================');
      console.log(`📧 Email: ${credentials.username}\n`);
      
      try {
        // First observe to find the email field
        const emailFields = await this.stagehand.observe(
          "Find the email field, username field, or email address input field"
        );
        
        if (emailFields.length === 0) {
          console.log('❌ No email field found on page\n');
          return false;
        }
        
        console.log(`🔍 Found email field: ${emailFields[0].description}\n`);
        
        await this.stagehand.act(emailFields[0]);
        await waitForTimeout(page, 1000);
        
        // Clear any autofill
        await pressKey(page, 'Meta+A');
        await pressKey(page, 'Backspace');
        await waitForTimeout(page, 300);
        
        // Type email character by character
        await typeText(page, credentials.username, { delay: 50 });
        console.log('✅ Email entered successfully\n');
        await waitForTimeout(page, 1000);
      } catch (error: any) {
        console.log(`❌ Failed to enter email: ${error.message}\n`);
        return false;
      }

      // Step 4: If email-first pattern, observe and click Continue
      if (loginPattern === 'email-first') {
        console.log('========================================');
        console.log('📝 Step 4: Observe and click Continue button');
        console.log('========================================\n');
        
        try {
          // Wait a bit for any dynamic elements to appear
          await waitForTimeout(page, 1500);
          
          // Observe to find the continue/next button
          const continueButtons = await this.stagehand.observe(
            "Find the Continue button, Next button, or submit button to proceed after entering email"
          );
          
          if (continueButtons.length > 0) {
            console.log(`🔍 Found button: ${continueButtons[0].description}`);
            console.log(`📍 Action: ${continueButtons[0].method} on ${continueButtons[0].selector}\n`);
            
            // Use the observed action directly (no LLM call needed)
            await this.stagehand.act(continueButtons[0]);
            await waitForTimeout(page, 5000);
            console.log('✅ Proceeded to next step\n');
            
            // Wait for password page to fully load
            await waitForTimeout(page, 3000);
            
            // Observe the new page state
            const nextPageElements = await this.stagehand.observe(
              "Find the password field and sign in button"
            );
            
            console.log('🔍 Next page elements:');
            nextPageElements.forEach((el, idx) => {
              console.log(`   ${idx + 1}. ${el.description} [${el.method}]`);
            });
            
            const hasPasswordNow = nextPageElements.some(el => 
              el.description.toLowerCase().includes('password')
            );
            
            if (hasPasswordNow) {
              console.log('✅ Confirmed: Now on password page\n');
            } else {
              console.log('⚠️ Warning: Password field not found on next page\n');
            }
          } else {
            console.log('⚠️ No continue button found');
            console.log('💡 Will attempt to enter password on current page\n');
          }
        } catch (error: any) {
          console.log(`⚠️ Could not proceed: ${error.message}`);
          console.log('💡 Will attempt to enter password on current page\n');
        }
      }

      // Step 5: Enter password
      console.log('========================================');
      console.log('📝 Step 5: Enter password');
      console.log('========================================');
      console.log(`🔑 Password: ${'*'.repeat(credentials.password.length)}\n`);
      
      try {
        await waitForTimeout(page, 2000);
        
        // Observe to find the password field
        const passwordFields = await this.stagehand.observe(
          'Find the password input field'
        );
        
        if (passwordFields.length === 0) {
          console.log('❌ No password field found on page\n');
          return false;
        }
        
        console.log(`🔍 Found password field: ${passwordFields[0].description}\n`);
        
        await this.stagehand.act(passwordFields[0]);
        await waitForTimeout(page, 1000);
        
        // Clear any autofill
        await pressKey(page, 'Meta+A');
        await pressKey(page, 'Backspace');
        await waitForTimeout(page, 300);
        
        // Type password
        await typeText(page, credentials.password, { delay: 50 });
        console.log('✅ Password entered successfully\n');
        await waitForTimeout(page, 1000);
      } catch (error: any) {
        console.log(`❌ Failed to enter password: ${error.message}\n`);
        return false;
      }

      // Step 6: Observe and submit login form
      console.log('========================================');
      console.log('📝 Step 6: Observe and submit login form');
      console.log('========================================\n');
      
      try {
        // Wait a moment before looking for submit button
        await waitForTimeout(page, 1500);
        
        // Observe to find the submit button
        const submitButtons = await this.stagehand.observe(
          "Find the sign in button, login button, or submit button to complete login"
        );
        
        if (submitButtons.length > 0) {
          console.log(`🔍 Found submit button: ${submitButtons[0].description}`);
          console.log(`📍 Action: ${submitButtons[0].method} on ${submitButtons[0].selector}\n`);
          
          // Use the observed action directly
          const submitPromise = this.stagehand.act(submitButtons[0]);
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Login submit timeout')), 15000)
          );
          
          await Promise.race([submitPromise, timeoutPromise]);
          console.log('✅ Login form submitted\n');
          await waitForTimeout(page, 5000);
          
          await waitForTimeout(page, 2000);
        } else {
          console.log('⚠️ No submit button found, trying Enter key...\n');
          await pressKey(page, 'Enter');
          await waitForTimeout(page, 5000);
          
          await waitForTimeout(page, 2000);
        }
      } catch (error: any) {
        console.log(`⚠️ Submit error: ${error.message}`);
        console.log('🔄 Trying Enter key as fallback...\n');
        
        try {
          await pressKey(page, 'Enter');
          await waitForTimeout(page, 5000);
          
          await waitForTimeout(page, 2000);
        } catch (e) {
          console.log('❌ Could not submit login form\n');
          return false;
        }
      }

      // Step 7: Verify login success
      console.log('========================================');
      console.log('🔍 Step 7: Verify login success');
      console.log('========================================\n');
      
      const finalUrl = page.url();
      const finalContent = await getContent(page);
      
      const isStillOnLogin = finalUrl.toLowerCase().includes('login') || 
                            finalUrl.toLowerCase().includes('signin') ||
                            finalUrl.toLowerCase().includes('identity/signin');
      
      const hasSignOut = finalContent.toLowerCase().includes('sign out') || 
                        finalContent.toLowerCase().includes('log out') ||
                        finalContent.toLowerCase().includes('my account') ||
                        finalContent.toLowerCase().includes('account settings');
      
      const loginSuccessful = !isStillOnLogin || hasSignOut;
      
      if (loginSuccessful) {
        console.log('✅ LOGIN SUCCESSFUL!');
        console.log(`📍 Current URL: ${finalUrl}`);
        console.log(`🔗 Context ID: ${this.contextId}`);
        console.log('\n💾 Authentication state has been saved to context');
        console.log('🎉 Future sessions will automatically use this login\n');
        return true;
      } else {
        console.log('❌ LOGIN FAILED');
        console.log(`📍 Still on: ${finalUrl}`);
        console.log('💡 Possible reasons:');
        console.log('   - Incorrect credentials');
        console.log('   - Additional verification required (2FA, CAPTCHA)');
        console.log('   - Login form structure not recognized\n');
        return false;
      }

    } catch (error: any) {
      console.log(`\n❌ Login onboarding error: ${error.message}\n`);
      return false;
    } finally {
      if (this.stagehand) {
        console.log('🔒 Closing browser...');
        await this.stagehand.close();
        console.log('✅ Browser closed');
        
        // IMPORTANT: Wait after closing to allow context to persist
        // Per Browserbase docs: "After a session using a context with persist: true,
        // there will be a brief delay before the updated context state is ready"
        console.log('⏳ Waiting 5 seconds for context to sync...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log('✅ Context should now be persisted and ready for reuse\n');
      }
    }
  }

  async testLogin(siteUrl: string) {
    console.log('\n========================================');
    console.log('🧪 TESTING SAVED LOGIN CONTEXT');
    console.log('========================================\n');
    
    const contextManager = getContextManager();
    const contextId = contextManager.getContext(siteUrl);
    
    if (!contextId) {
      console.log('❌ No saved context found for this site');
      console.log('💡 Run login onboarding first\n');
      return false;
    }
    
    console.log(`🔗 Found saved context: ${contextId}`);
    console.log('🚀 Initializing new session with saved context...\n');
    
    // Initialize with the saved context (persist: false for read-only testing)
    this.stagehand = new Stagehand({
      env: 'BROWSERBASE',
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      verbose: 1,
      model: 'google/gemini-2.0-flash',
      domSettleTimeout: 30000,
      browserbaseSessionCreateParams: {
        browserSettings: {
          context: {
            id: contextId,
            persist: false, // Read-only test - don't update the context
          },
        },
      },
    });

    await this.stagehand.init();
    const page = this.stagehand.context.pages()[0];
    
    try {
      // Navigate to the site
      console.log(`🌐 Navigating to: ${siteUrl}`);
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded' });
      await waitForTimeout(page, 3000);
      
      // Check if we're logged in
      const pageContent = await getContent(page);
      const hasSignOut = pageContent.toLowerCase().includes('sign out') || 
                        pageContent.toLowerCase().includes('log out') ||
                        pageContent.toLowerCase().includes('my account');
      
      if (hasSignOut) {
        console.log('\n✅ SUCCESS! Already logged in from saved context');
        console.log('🎉 Context authentication is working!\n');
        return true;
      } else {
        console.log('\n⚠️ Not logged in - context may have expired');
        console.log('💡 Try running login onboarding again\n');
        return false;
      }
      
    } catch (error: any) {
      console.log(`\n❌ Test error: ${error.message}\n`);
      return false;
    } finally {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (this.stagehand) {
        await this.stagehand.close();
      }
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'login') {
    // Login onboarding
    const loginUrl = args[1];
    const username = args[2];
    const password = args[3];
    
    if (!loginUrl || !username || !password) {
      console.log('\n❌ Missing arguments');
      console.log('\nUsage:');
      console.log('  npm run login-onboarding login <login-url> <username> <password>');
      console.log('\nExample:');
      console.log('  npm run login-onboarding login https://bose.com/login user@example.com mypassword');
      console.log('\n');
      process.exit(1);
    }
    
    const onboarding = new LoginOnboarding();
    
    // Extract base URL for context storage
    const url = new URL(loginUrl);
    const siteUrl = `${url.protocol}//${url.hostname}`;
    
    await onboarding.initialize(siteUrl);
    const success = await onboarding.login(loginUrl, { username, password });
    
    if (success) {
      console.log('========================================');
      console.log('✅ ONBOARDING COMPLETE');
      console.log('========================================\n');
      process.exit(0);
    } else {
      console.log('========================================');
      console.log('❌ ONBOARDING FAILED');
      console.log('========================================\n');
      process.exit(1);
    }
    
  } else if (command === 'test') {
    // Test saved login
    const siteUrl = args[1];
    
    if (!siteUrl) {
      console.log('\n❌ Missing site URL');
      console.log('\nUsage:');
      console.log('  npm run login-onboarding test <site-url>');
      console.log('\nExample:');
      console.log('  npm run login-onboarding test https://bose.com');
      console.log('\n');
      process.exit(1);
    }
    
    const onboarding = new LoginOnboarding();
    const success = await onboarding.testLogin(siteUrl);
    
    process.exit(success ? 0 : 1);
    
  } else {
    console.log('\n🔐 LOGIN ONBOARDING TOOL');
    console.log('========================\n');
    console.log('Commands:');
    console.log('  login   - Log into a site and save authentication context');
    console.log('  test    - Test if saved login context works\n');
    console.log('Usage:');
    console.log('  npm run login-onboarding login <login-url> <username> <password>');
    console.log('  npm run login-onboarding test <site-url>\n');
    console.log('Examples:');
    console.log('  npm run login-onboarding login https://bose.com/login user@example.com mypass123');
    console.log('  npm run login-onboarding test https://bose.com\n');
    process.exit(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
