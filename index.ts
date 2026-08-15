import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { StagehandCheckoutAgentV2 } from './StagehandCheckoutAgentV2.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'stagehand-checkout-agent' });
});

// Main autonomous checkout endpoint
app.post('/api/checkout/agent', async (req, res) => {
  const { productUrl, maxSteps, shippingInfo, paymentInfo, credentials, productSpecs } = req.body;

  if (!productUrl) {
    return res.status(400).json({ error: 'productUrl is required' });
  }

  console.log(`\n🤖 New AUTONOMOUS AGENT checkout request: ${productUrl}`);
  if (productSpecs && Object.keys(productSpecs).length > 0) {
    console.log(`📦 Product specs to select:`);
    Object.entries(productSpecs).forEach(([key, value]) => {
      console.log(`   - ${key}: ${value}`);
    });
  }
  if (shippingInfo) {
    console.log(`📦 Custom shipping info provided: ${shippingInfo.firstName} ${shippingInfo.lastName}`);
  }
  if (paymentInfo) {
    console.log(`💳 Custom payment info provided`);
  }
  if (credentials) {
    console.log(`🔐 Site credentials provided: ${credentials.username}`);
  }

  try {
    const agent = new StagehandCheckoutAgentV2();
    
    // Initialize with context support
    await agent.initialize(productUrl, true);

    const result = await agent.automateCheckoutWithAgent(
      productUrl,
      maxSteps || 50, // Agent needs more steps for autonomous exploration
      shippingInfo,
      paymentInfo,
      credentials,
      productSpecs  // Pass product specs to agent
    );

    res.json(result);
  } catch (error: any) {
    console.error('❌ Autonomous agent checkout failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      steps: [],
      decisions: [],
      finalUrl: undefined,
    });
  }
});

// Login onboarding endpoints
app.post('/api/login-onboarding', async (req, res) => {
  const { loginUrl, username, password } = req.body;

  if (!loginUrl || !username || !password) {
    return res.status(400).json({ 
      success: false, 
      error: 'loginUrl, username, and password are required' 
    });
  }

  console.log(`\n🔐 Login onboarding request for: ${loginUrl}`);

  try {
    const { LoginOnboarding } = await import('./loginOnboarding.js');
    const onboarding = new LoginOnboarding();
    
    // Extract base URL for context storage
    const url = new URL(loginUrl);
    const siteUrl = `${url.protocol}//${url.hostname}`;
    
    await onboarding.initialize(siteUrl);
    const success = await onboarding.login(loginUrl, { username, password });
    
    res.json({
      success,
      message: success ? 'Login successful and context saved' : 'Login failed',
      log: 'Check console for detailed logs'
    });
  } catch (error: any) {
    console.error('❌ Login failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      log: error.stack
    });
  }
});

// Manual login with Live View
app.post('/api/login-onboarding/manual', async (req, res) => {
  const { siteUrl, durationMinutes } = req.body;

  if (!siteUrl) {
    return res.status(400).json({ 
      success: false, 
      error: 'siteUrl is required' 
    });
  }

  const duration = durationMinutes || 5; // Default 5 minutes
  console.log(`\n🎮 Manual login with Live View request for: ${siteUrl}`);
  console.log(`⏱️  Session will stay open for ${duration} minutes`);

  try {
    const { Browserbase } = await import('@browserbasehq/sdk');
    const { getContextManager } = await import('./services/contextManager.js');
    
    // Get or create context for this site
    const contextManager = getContextManager();
    const contextId = await contextManager.getOrCreateContext(siteUrl);
    console.log(`🔗 Using context: ${contextId}`);
    
    // Create Browserbase session with context persistence and keep-alive
    const bb = new Browserbase({ 
      apiKey: process.env.BROWSERBASE_API_KEY 
    });
    
    const session = await bb.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      keepAlive: true, // Keep session alive even after disconnect
      browserSettings: {
        context: {
          id: contextId,
          persist: true, // Save authentication state when session ends
        },
      },
    });
    
    console.log(`✅ Session created: ${session.id}`);
    console.log(`⏱️  Keep-alive enabled: Session will stay open`);
    
    // Connect to the session to navigate to the site
    console.log(`🌐 Connecting to session to navigate to ${siteUrl}...`);
    const { chromium } = await import('playwright-core');
    const browser = await chromium.connectOverCDP(session.connectUrl);
    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages()[0] || await defaultContext.newPage();
    
    try {
      // Navigate to the site
      await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      console.log(`✅ Navigated to ${siteUrl}`);
    } catch (navError: any) {
      console.log(`⚠️  Navigation warning: ${navError.message}`);
      console.log(`💡 Continuing anyway - user can navigate via Live View`);
    }
    
    // Get Live View URL
    const liveViewData = await bb.sessions.debug(session.id);
    const liveViewUrl = liveViewData.debuggerFullscreenUrl;
    
    console.log(`🔍 Live View URL: ${liveViewUrl}`);
    console.log(`\n📝 Instructions:`);
    console.log(`   1. Open the Live View URL in your browser`);
    console.log(`   2. The site ${siteUrl} should already be loaded`);
    console.log(`   3. Navigate to login page if needed and log in manually`);
    console.log(`   4. Session will auto-close after ${duration} minutes`);
    console.log(`   5. Your login will be saved to context: ${contextId}\n`);
    
    // Send response immediately
    res.json({
      success: true,
      liveViewUrl,
      sessionId: session.id,
      contextId,
      domain: new URL(siteUrl).hostname.replace('www.', ''),
      durationMinutes: duration,
      message: `Live View session created. Open the URL and login manually. Session will close in ${duration} minutes.`,
      instructions: [
        'Open the Live View URL in your browser',
        `The site ${siteUrl} should already be loaded`,
        'Navigate to login page if needed and log in with your credentials',
        `Session will auto-close after ${duration} minutes`,
        'Your authentication will be saved automatically after session ends'
      ]
    });
    
    // Schedule session termination after specified duration
    setTimeout(async () => {
      try {
        console.log(`\n⏱️  ${duration} minutes elapsed for session ${session.id}`);
        console.log(`🔒 Releasing keep-alive session to trigger context save...`);
        
        // Release the keep-alive session - this will trigger context persistence
        await bb.sessions.update(session.id, {
          status: 'REQUEST_RELEASE',
          projectId: process.env.BROWSERBASE_PROJECT_ID!
        });
        console.log(`✅ Session released`);
        
        // Wait 5 seconds for context to sync (per Browserbase docs)
        console.log(`⏳ Waiting 5 seconds for context to sync...`);
        await new Promise(resolve => setTimeout(resolve, 5000));
        console.log(`💾 Context ${contextId} should now have the authentication state saved\n`);
      } catch (e) {
        console.error('Error during session cleanup:', e);
      }
    }, duration * 60 * 1000);
    
  } catch (error: any) {
    console.error('❌ Failed to create manual login session:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      log: error.stack
    });
  }
});

app.post('/api/login-onboarding/test', async (req, res) => {
  const { siteUrl } = req.body;

  if (!siteUrl) {
    return res.status(400).json({ 
      success: false, 
      error: 'siteUrl is required' 
    });
  }

  console.log(`\n🧪 Testing saved login context for: ${siteUrl}`);

  try {
    const { LoginOnboarding } = await import('./loginOnboarding.js');
    const onboarding = new LoginOnboarding();
    
    const success = await onboarding.testLogin(siteUrl);
    
    res.json({
      success,
      message: success ? 'Login context is working' : 'Login context test failed',
      log: 'Check console for detailed logs'
    });
  } catch (error: any) {
    console.error('❌ Test login failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      log: error.stack
    });
  }
});

// Context management endpoints
app.get('/api/contexts', async (req, res) => {
  try {
    const { getContextManager } = await import('./services/contextManager.js');
    const contextManager = getContextManager();
    const contexts = contextManager.listContexts();
    res.json({ success: true, contexts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/contexts/:domain', async (req, res) => {
  try {
    const { domain } = req.params;
    const { getContextManager } = await import('./services/contextManager.js');
    const contextManager = getContextManager();
    const deleted = await contextManager.deleteContext(domain);
    
    if (deleted) {
      res.json({ success: true, message: `Context deleted for ${domain}` });
    } else {
      res.status(404).json({ success: false, error: 'Context not found' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Stagehand Checkout Agent API running on http://localhost:${PORT}`);
  console.log(`📝 Endpoints:`);
  console.log(`   POST   /api/checkout/agent - Autonomous checkout with AI agent 🤖`);
  console.log(`   POST   /api/login-onboarding - Auto login and save context`);
  console.log(`   POST   /api/login-onboarding/manual - Manual login with Live View`);
  console.log(`   POST   /api/login-onboarding/test - Test saved login context`);
  console.log(`   GET    /api/contexts - List all saved contexts`);
  console.log(`   DELETE /api/contexts/:domain - Delete context for domain`);
  console.log(`   GET    /health - Health check\n`);
});
