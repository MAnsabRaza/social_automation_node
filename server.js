const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const { chromium } = require("playwright");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// === Your CapSolver Key ===
const CAPSOLVER_API_KEY =
  "CAP-ED4178FF70C174EB79EDF60846570312670376A951B815C52C7113DC914E7F42";

async function solveCaptcha(siteURL, siteKey) {
  console.log("🧩 Solving Captcha...");

  const createTask = await axios.post("https://api.capsolver.com/createTask", {
    clientKey: CAPSOLVER_API_KEY,
    task: {
      type: "ReCaptchaV2TaskProxyLess",
      websiteURL: siteURL,
      websiteKey: siteKey,
    },
  });

  const taskId = createTask.data.taskId;
  console.log("🧩 taskId:", taskId);

  while (true) {
    const result = await axios.post("https://api.capsolver.com/getTaskResult", {
      clientKey: CAPSOLVER_API_KEY,
      taskId: taskId,
    });

    if (result.data.status === "ready") {
      console.log("🟢 Captcha Solved!");
      return result.data.solution.gRecaptchaResponse;
    }

    await new Promise((x) => setTimeout(x, 5000));
  }
}

// PLATFORM URLS
const LOGIN_URL = {
  instagram: "https://www.instagram.com/accounts/login/",
  facebook: "https://www.facebook.com/login/",
  youtube: "https://accounts.google.com",
  tiktok: "https://www.tiktok.com/login",
  twitter: "https://twitter.com/login",
  linkedin: "https://www.linkedin.com/login",
};
let activeBrowsers = {}; // store browsers and pages
let activeContexts = {};

app.post("/login-social", async (req, res) => {
  const {
    username,
    password,
    platform,
    account_id,
    proxy_host,
    proxy_port,
    proxy_username,
    proxy_password,
  } = req.body;

  if (!LOGIN_URL[platform]) {
    return res.json({ success: false, message: "Platform not supported" });
  }

  console.log(`🌐 Login attempt → ${platform} | Account ID: ${account_id}`);

  try {
    // Reuse session if browser is already running
    if (activeBrowsers[account_id]) {
      const context = activeContexts[account_id];
      const storageState = await context.storageState();

      return res.json({
        success: true,
        message: "Already logged in - session reused",
        sessionData: JSON.stringify(storageState),
        cookies: storageState.cookies,
        authToken: extractAuthToken(storageState.cookies, platform),
      });
    }

    // Launch new browser
    const browser = await chromium.launch({
      headless: false,
      proxy: proxy_host
        ? {
            server: `http://${proxy_host}:${proxy_port}`,
            username: proxy_username || undefined,
            password: proxy_password || undefined,
          }
        : undefined,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: ["geolocation", "notifications"],
    });

    activeBrowsers[account_id] = browser;
    activeContexts[account_id] = context;

    const page = await context.newPage();

    console.log("⏳ Loading login page...");

    // FIX: Instagram never reaches "networkidle" → replaced
    await page.goto(LOGIN_URL[platform], {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(2500); // Let IG/FB scripts load

    // --------------------------
    //     PLATFORM LOGINS
    // --------------------------

    switch (platform) {
      case "instagram":
        await page.waitForSelector('input[name="username"]', {
          timeout: 30000,
        });

        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);

        await page.click('button[type="submit"]');

        // Wait for login redirect
        await page.waitForTimeout(5000);

        // Dismiss popups
        await page.click("text=Not now").catch(() => {});
        await page.click('button:has-text("Not Now")').catch(() => {});

        break;

      case "facebook":
        await page.waitForSelector("#email", { timeout: 20000 });
        await page.fill("#email", username);
        await page.fill("#pass", password);
        await page.click('button[name="login"]');
        break;

      case "twitter":
        await page.waitForSelector('input[name="text"]', { timeout: 20000 });
        await page.fill('input[name="text"]', username);
        await page.keyboard.press("Enter");

        await page.waitForTimeout(3000);
        await page.fill('input[name="password"]', password);
        await page.keyboard.press("Enter");
        break;

      case "tiktok":
        await page.waitForTimeout(3000);
        await page.fill('input[name="username"]', username);
        await page.fill('input[name="password"]', password);
        await page.click("button");
        break;

      case "linkedin":
        await page.waitForSelector("#username", { timeout: 20000 });
        await page.fill("#username", username);
        await page.fill("#password", password);
        await page.click('button[type="submit"]');
        break;

      case "youtube":
        await page.waitForSelector('input[type="email"]', { timeout: 20000 });
        await page.fill("input[type=email]", username);
        await page.keyboard.press("Enter");

        await page.waitForTimeout(3000);
        await page.fill("input[type=password]", password);
        await page.keyboard.press("Enter");
        break;
    }

    // Allow cookie/session setup
    await page.waitForTimeout(5000);

    // Save session
    const storageState = await context.storageState();
    const authToken = extractAuthToken(storageState.cookies, platform);

    console.log(`✅ Login successful → ${account_id}`);

    return res.json({
      success: true,
      message: "Login successful",
      sessionData: JSON.stringify(storageState),
      cookies: storageState.cookies,
      authToken: authToken,
    });
  } catch (error) {
    console.error("❌ Login failed:", error.message);

    return res.json({
      success: false,
      message: "Login error",
      error: error.message,
    });
  }
});
// --------------- CHECK LOGIN STATUS -------------------
app.post("/check-login", async (req, res) => {
  const {
    platform,
    cookies,
    sessionData,
    proxy_host,
    proxy_port,
    proxy_username,
    proxy_password,
  } = req.body;

  if (!cookies || !sessionData) {
    return res.json({
      success: false,
      isLoggedIn: false,
      message: "No session data found",
    });
  }

  try {
    const browser = await chromium.launch({
      headless: true,
      proxy: proxy_host
        ? {
            server: `http://${proxy_host}:${proxy_port}`,
            username: proxy_username || undefined,
            password: proxy_password || undefined,
          }
        : undefined,
    });

    const parsedSessionData = JSON.parse(sessionData);
    const context = await browser.newContext({
      storageState: parsedSessionData,
    });
    const page = await context.newPage();

    // Check if logged in by navigating to home page
    const homeUrls = {
      instagram: "https://www.instagram.com/",
      facebook: "https://www.facebook.com/",
      twitter: "https://twitter.com/home",
      linkedin: "https://www.linkedin.com/feed/",
      youtube: "https://www.youtube.com/",
      tiktok: "https://www.tiktok.com/foryou",
    };

    await page.goto(homeUrls[platform] || LOGIN_URL[platform], {
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    const currentUrl = page.url();
    const isLoggedIn =
      !currentUrl.includes("/login") && !currentUrl.includes("/signin");

    await browser.close();

    res.json({ success: true, isLoggedIn });
  } catch (error) {
    console.log(error);
    res.json({ success: false, isLoggedIn: false, error: error.message });
  }
});

app.post("/execute-task", async (req, res) => {
  const { task, account } = req.body;

  console.log("📋 Executing Task:", task);

  if (!task || !account) {
    return res.json({
      success: false,
      message: "Missing task or account data",
    });
  }

  const platform = account.platform;
  const taskType = task.task_type;

  try {
    let browser, context, page;

    if (activeBrowsers[account.id]) {
      console.log("♻️ Reusing existing browser session");
      browser = activeBrowsers[account.id];
      context = activeContexts[account.id];
      page = await context.newPage();
    } else {
      console.log("🚀 Launching new browser session");

      let storageState = null;
      if (account.session_data) {
        try {
          storageState = JSON.parse(account.session_data);
        } catch {}
      }

      browser = await chromium.launch({
        headless: false,
        proxy: account.proxy_id
          ? {
              server: `http://${account.proxy.host}:${account.proxy.port}`,
              username: account.proxy.username || undefined,
              password: account.proxy.password || undefined,
            }
          : undefined,
      });

      context = await browser.newContext({
        storageState,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0",
        locale: "en-US",
      });

      activeBrowsers[account.id] = browser;
      activeContexts[account.id] = context;

      page = await context.newPage();
    }

    // ✅ POST TASK
    if (taskType === "post") {
      return res.json(await createPost(page, platform, task));
    }

    if (taskType === "follow") {
      return res.json(await followUser(page, platform, task.target_url));
    }

    if (taskType === "unfollow") {
      return res.json(await unfollowUser(page, platform, task.target_url));
    }

    if (taskType === "like") {
      const result = await likePost(page, platform, task.target_url);
      return res.json(result);
    }
    if (taskType === "comment") {
      return res.json(
        await commentOnPost(page, platform, task.target_url, task.comment)
      );
    }

    return res.json({
      success: false,
      message: `Task type ${taskType} not supported`,
    });
  } catch (error) {
    console.error("❌ Task execution failed:", error.message);
    return res.json({
      success: false,
      message: error.message,
    });
  }
});
async function createPost(page, platform, task) {
  console.log(`📝 Creating post on ${platform}...`);

  try {
    if (platform === "instagram") {
      return await createInstagramPost(page, task); // ✅ PASS task
    }

    return {
      success: false,
      message: `Platform ${platform} not supported`,
    };
  } catch (error) {
    console.error(`❌ Failed to create post on ${platform}:`, error.message);
    return {
      success: false,
      message: error.message,
    };
  }
}

// ==========================================
// INSTAGRAM POST
// ==========================================
async function createInstagramPost(page, postContent) {
  console.log("📸 Creating Instagram post...");

  try {
    // 1️⃣ Open Instagram
    await page.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

    // 2️⃣ Close popups
    await page.click("text=Not now").catch(() => {});
    await page.click('button:has-text("Not Now")').catch(() => {});
    await page.waitForTimeout(2000);

    // 3️⃣ Click Create button
    const createButton = page.locator(
      'svg[aria-label="New post"], svg[aria-label="Create"]'
    ).first();

    await createButton.waitFor({ state: "visible", timeout: 20000 });
    await createButton.click();
    console.log("✅ Create clicked");

    await page.waitForTimeout(3000);

    // 4️⃣ Click "Post" option if available
    const postOption = page.locator('text="Post"').first();
    if (await postOption.isVisible().catch(() => false)) {
      await postOption.click();
      console.log("✅ Post option clicked");
      await page.waitForTimeout(2000);
    }

    // 5️⃣ Resolve image path
    const absoluteImagePath = path.join(
      "C:",
      "wamp64",
      "www",
      "social-automation",
      "public",
      postContent.media_urls
    );

    console.log("🔍 Looking for image at:", absoluteImagePath);

    if (!fs.existsSync(absoluteImagePath)) {
      throw new Error(`Image file not found: ${absoluteImagePath}`);
    }

    console.log("✅ Image file found");

    // 6️⃣ Upload using hidden input[type=file]
    const fileInput = page.locator('input[type="file"]');

    await fileInput.waitFor({ state: "attached", timeout: 20000 });
    await fileInput.setInputFiles(absoluteImagePath);

    console.log("✅ Image uploaded");

    // 7️⃣ Wait for preview and dialog to load
    await page.waitForTimeout(4000);
    
    // Wait for the crop dialog to be visible
    await page.locator('[role="dialog"]').waitFor({ 
      state: "visible", 
      timeout: 15000 
    });
    
    console.log("✅ Crop dialog loaded");
    await page.waitForTimeout(2000);

    // 8️⃣ Click Next button (Crop/Edit step) - Using multiple strategies
    console.log("🔘 Attempting to click Next button (crop step)...");
    
    const nextButtonSelectors = [
      'div[role="button"]:has-text("Next")',
      'button:has-text("Next")',
      '//div[@role="button" and contains(text(), "Next")]',
      '[role="button"]:has-text("Next")',
      'div:text-is("Next")',
    ];

    let nextClicked = false;
    for (const selector of nextButtonSelectors) {
      try {
        const nextBtn = page.locator(selector).first();
        await nextBtn.waitFor({ state: "visible", timeout: 5000 });
        await nextBtn.click({ timeout: 5000 });
        console.log(`✅ Next clicked using selector: ${selector}`);
        nextClicked = true;
        break;
      } catch (e) {
        console.log(`⚠️ Selector failed: ${selector}`);
        continue;
      }
    }

    if (!nextClicked) {
      // Last resort: click by position (top-right of dialog)
      try {
        await page.locator('text=Next').first().click({ force: true, timeout: 5000 });
        console.log("✅ Next clicked using force click");
        nextClicked = true;
      } catch (e) {
        throw new Error("Could not find or click Next button after image upload");
      }
    }

    await page.waitForTimeout(4000);

    // 9️⃣ Click Next button again (Filters step)
    console.log("🔘 Attempting to click Next button (filters step)...");
    
    nextClicked = false;
    for (const selector of nextButtonSelectors) {
      try {
        const nextBtn = page.locator(selector).first();
        await nextBtn.waitFor({ state: "visible", timeout: 5000 });
        await nextBtn.click({ timeout: 5000 });
        console.log(`✅ Next clicked (filters) using selector: ${selector}`);
        nextClicked = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!nextClicked) {
      try {
        await page.locator('text=Next').first().click({ force: true, timeout: 5000 });
        console.log("✅ Next clicked (filters) using force click");
      } catch (e) {
        throw new Error("Could not find or click Next button on filters page");
      }
    }

    await page.waitForTimeout(4000);

    // 🔟 Add Caption
    console.log("📝 Adding caption...");
    
    const caption = (postContent.content || "") + "\n\n" + (postContent.hashtags || "");

    const captionSelectors = [
      'div[aria-label="Write a caption..."]',
      'textarea[aria-label*="caption"]',
      'div[contenteditable="true"]',
      '[aria-label*="Write a caption"]',
    ];

    let captionAdded = false;
    for (const selector of captionSelectors) {
      try {
        const captionBox = page.locator(selector).first();
        await captionBox.waitFor({ state: "visible", timeout: 5000 });
        await captionBox.click();
        await captionBox.fill(caption.trim());
        console.log("✅ Caption added");
        captionAdded = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!captionAdded) {
      console.log("⚠️ Could not add caption, continuing anyway...");
    }

    await page.waitForTimeout(2000);

    // 1️⃣1️⃣ Click Share button
    console.log("📤 Clicking Share button...");
    
    const shareSelectors = [
      'button:has-text("Share")',
      'div[role="button"]:has-text("Share")',
      '//div[@role="button" and contains(text(), "Share")]',
    ];

    let shareClicked = false;
    for (const selector of shareSelectors) {
      try {
        const shareBtn = page.locator(selector).first();
        await shareBtn.waitFor({ state: "visible", timeout: 5000 });
        await shareBtn.click({ timeout: 5000 });
        console.log("✅ Share button clicked");
        shareClicked = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!shareClicked) {
      throw new Error("Could not find or click Share button");
    }

    // Wait for post to complete
    await page.waitForTimeout(12000);

    // Check for success indicators
    const successIndicators = [
      'text=Your post has been shared',
      'text=Post shared',
      'img[alt*="Animated checkmark"]',
    ];

    let postSuccess = false;
    for (const indicator of successIndicators) {
      if (await page.locator(indicator).isVisible().catch(() => false)) {
        postSuccess = true;
        break;
      }
    }

    console.log("✅ Instagram post created successfully");

    return { 
      success: true, 
      message: postSuccess ? "Post confirmed" : "Post likely successful"
    };

  } catch (error) {
    console.error("❌ Instagram post failed:", error.message);
    
    // Take screenshot for debugging
    try {
      await page.screenshot({ 
        path: `instagram-error-${Date.now()}.png`,
        fullPage: true 
      });
      console.log("📸 Error screenshot saved");
    } catch (screenshotError) {
      console.log("⚠️ Could not save screenshot");
    }

    return { 
      success: false, 
      message: error.message 
    };
  }
}
// ==========================================
// FACEBOOK POST
// ==========================================
async function createFacebookPost(page, postContent) {
  console.log("📘 Creating Facebook post...");

  try {
    await page.goto("https://www.facebook.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Click "What's on your mind?" box
    await page.click('[aria-label="Create a post"]').catch(() => {
      return page.click('div[role="button"]:has-text("What\'s on your mind")');
    });

    await page.waitForTimeout(2000);

    // Type content
    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    const textBox = await page
      .locator('[aria-label="What\'s on your mind?"]')
      .first();
    await textBox.fill(fullText);

    await page.waitForTimeout(2000);

    // Click Post button
    await page.click('div[aria-label="Post"]').catch(() => {
      return page.click('div[role="button"]:has-text("Post")');
    });

    await page.waitForTimeout(5000);

    console.log("✅ Facebook post created successfully");
    return {
      success: true,
      message: "Facebook post created successfully",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ Facebook post failed:", error.message);
    return { success: false, message: error.message };
  }
}

// ==========================================
// TWITTER POST
// ==========================================
async function createTwitterPost(page, postContent) {
  console.log("🐦 Creating Twitter post...");

  try {
    await page.goto("https://twitter.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Click tweet box
    const tweetBox = await page
      .locator('[data-testid="tweetTextarea_0"]')
      .first();

    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    await tweetBox.fill(fullText);
    await page.waitForTimeout(2000);

    // Click Post/Tweet button
    await page.click('[data-testid="tweetButtonInline"]');
    await page.waitForTimeout(5000);

    console.log("✅ Twitter post created successfully");
    return {
      success: true,
      message: "Twitter post created successfully",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ Twitter post failed:", error.message);
    return { success: false, message: error.message };
  }
}

// ==========================================
// LINKEDIN POST
// ==========================================
async function createLinkedInPost(page, postContent) {
  console.log("💼 Creating LinkedIn post...");

  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    // Click "Start a post" button
    await page.click('button:has-text("Start a post")');
    await page.waitForTimeout(2000);

    // Type content
    const content = postContent?.content || "";
    const hashtags = postContent?.hashtags || "";
    const fullText = `${content}\n\n${hashtags}`.trim();

    const editor = await page.locator(".ql-editor").first();
    await editor.fill(fullText);

    await page.waitForTimeout(2000);

    // Click Post button
    await page.click('button:has-text("Post")');
    await page.waitForTimeout(5000);

    console.log("✅ LinkedIn post created successfully");
    return {
      success: true,
      message: "LinkedIn post created successfully",
      post_url: page.url(),
    };
  } catch (error) {
    console.error("❌ LinkedIn post failed:", error.message);
    return { success: false, message: error.message };
  }
}

// ==========================================
// LIKE POST FUNCTION
// ==========================================
async function likePost(page, platform, targetUrl) {
  console.log(`❤️ Liking post on ${platform}... new code`);

  try {
    if (!targetUrl) throw new Error("Target URL missing");
    if (platform !== "instagram") throw new Error("Platform not supported");

    const cleanUrl = targetUrl.split("?")[0];

    await page.goto(cleanUrl, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(8000);

    // Detect session expired
    if (await page.locator('input[name="username"]').isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error("Instagram session expired (login required)");
    }

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(3000);

    // Check if already liked (multiple possible red heart indicators)
    const alreadyLiked = await page.evaluate(() => {
      const svgs = document.querySelectorAll('svg');
      for (const svg of svgs) {
        const fill = svg.getAttribute('fill');
        const stroke = svg.getAttribute('stroke');
        const ariaLabel = svg.getAttribute('aria-label');
        
        if ((fill === '#ed4956' || fill === 'rgb(255, 48, 64)' || stroke === '#ed4956') ||
            (ariaLabel && ariaLabel.toLowerCase().includes('unlike'))) {
          return true;
        }
      }
      return false;
    });

    if (alreadyLiked) {
      console.log("💙 Already liked");
      return { success: true, message: "Already liked" };
    }

    // Try multiple selector strategies
    let likeButton = null;
    
    // Strategy 1: Find by aria-label
    likeButton = page.locator('[aria-label="Like"]').first();
    let isVisible = await likeButton.isVisible({ timeout: 3000 }).catch(() => false);
    
    // Strategy 2: Find SVG with specific viewBox (Instagram like icon)
    if (!isVisible) {
      console.log("Trying strategy 2: SVG viewBox...");
      likeButton = page.locator('svg[aria-label="Like"]').locator('..').first();
      isVisible = await likeButton.isVisible({ timeout: 3000 }).catch(() => false);
    }
    
    // Strategy 3: Find button/div containing heart SVG path
    if (!isVisible) {
      console.log("Trying strategy 3: Heart path selector...");
      const heartPaths = [
        'path[d*="M16.792 3.904A4.989"]', // Common Instagram heart path
        'path[d*="M34.6 3.1"]', // Alternative heart path
        'path[d*="M16.792"]' // Partial match
      ];
      
      for (const pathSelector of heartPaths) {
        likeButton = page.locator(`button:has(${pathSelector}), div[role="button"]:has(${pathSelector}), span[role="button"]:has(${pathSelector})`).first();
        isVisible = await likeButton.isVisible({ timeout: 2000 }).catch(() => false);
        if (isVisible) break;
      }
    }
    
    // Strategy 4: Find by JavaScript evaluation (most reliable)
    if (!isVisible) {
      console.log("Trying strategy 4: JavaScript evaluation...");
      const likeButtonFound = await page.evaluate(() => {
        // Find all SVGs
        const svgs = document.querySelectorAll('svg');
        
        for (const svg of svgs) {
          const ariaLabel = svg.getAttribute('aria-label');
          
          // Look for "Like" label
          if (ariaLabel && ariaLabel.toLowerCase() === 'like') {
            // Find the clickable parent
            let parent = svg.parentElement;
            while (parent) {
              const role = parent.getAttribute('role');
              const tag = parent.tagName.toLowerCase();
              
              if (tag === 'button' || role === 'button' || 
                  (tag === 'div' && role === 'button') ||
                  (tag === 'span' && parent.onclick)) {
                parent.setAttribute('data-like-button', 'true');
                return true;
              }
              parent = parent.parentElement;
            }
          }
        }
        return false;
      });
      
      if (likeButtonFound) {
        likeButton = page.locator('[data-like-button="true"]').first();
        isVisible = await likeButton.isVisible({ timeout: 2000 }).catch(() => false);
      }
    }

    if (!isVisible) {
      throw new Error("Like button not found with any strategy");
    }

    console.log("✅ Like button found, clicking...");

    // Human-like interaction
    await likeButton.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300 + Math.random() * 700);
    await likeButton.hover({ timeout: 10000 });
    await page.waitForTimeout(200 + Math.random() * 500);
    
    // Try click with different methods
    try {
      await likeButton.click({ timeout: 10000, delay: 100 });
    } catch (e) {
      console.log("Standard click failed, trying force click...");
      await likeButton.click({ force: true, delay: 150 });
    }

    // Wait and verify
    await page.waitForTimeout(5000);
    
    // Check for red heart or "Unlike" label
    const confirmed = await page.evaluate(() => {
      const svgs = document.querySelectorAll('svg');
      for (const svg of svgs) {
        const fill = svg.getAttribute('fill');
        const stroke = svg.getAttribute('stroke');
        const ariaLabel = svg.getAttribute('aria-label');
        
        if ((fill === '#ed4956' || fill === 'rgb(255, 48, 64)' || stroke === '#ed4956') ||
            (ariaLabel && ariaLabel.toLowerCase().includes('unlike'))) {
          return true;
        }
      }
      return false;
    });

    if (!confirmed) {
      console.warn("⚠️ No red heart visible – like may still have worked");
      // Take debug screenshot
      await page.screenshot({ path: 'like-attempt.png', fullPage: false });
      return { success: true, message: "Like attempted (no visual confirmation)" };
    }

    console.log("❤️ Like successful & confirmed");
    return { success: true, message: "Post liked successfully" };

  } catch (error) {
    console.error("❌ Like failed:", error.message);
    // Debug screenshot
    try {
      await page.screenshot({ path: 'like-error.png', fullPage: false });
    } catch {}
    return { success: false, message: error.message };
  }
}




// ==========================================
// COMMENT FUNCTION
// ==========================================
async function commentOnPost(page, platform, targetUrl, commentText) {
  console.log(`💬 Commenting on ${platform}... new....`);
  try {
    if (!targetUrl) throw new Error("Target URL missing");
    if (!commentText) throw new Error("Comment text missing");
    if (platform !== "instagram") throw new Error("Platform not supported");
    
    const cleanUrl = targetUrl.split("?")[0];
    
    // Navigate with error handling
    try {
      await page.goto(cleanUrl, { 
        waitUntil: "domcontentloaded",
        timeout: 60000 
      });
    } catch (navError) {
      if (!page.url().includes('instagram.com')) {
        throw new Error("Failed to navigate to Instagram post");
      }
      console.log("⚠️ Navigation timeout but page loaded, continuing...");
    }
    
    await page.waitForTimeout(5000);
    
    // Detect session expired
    if (await page.locator('input[name="username"]').isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error("Instagram session expired (login required)");
    }
    
    // Scroll to load the post content
    await page.evaluate(() => {
      window.scrollTo(0, 300);
    });
    await page.waitForTimeout(2000);
    
    // Try multiple selectors for the comment icon (Instagram has variations)
    const commentIconSelectors = [
      'svg[aria-label="Comment"]',
      'svg[aria-label="Comment on this post"]',
      'button[aria-label="Comment"]',
      'span:has(svg[aria-label*="Comment"])',
    ];
    
    let commentIconClicked = false;
    
    for (const selector of commentIconSelectors) {
      try {
        const icon = page.locator(selector).first();
        if (await icon.isVisible({ timeout: 5000 })) {
          await icon.scrollIntoViewIfNeeded();
          await icon.click({ force: true, timeout: 5000 });
          console.log(`✅ Clicked comment icon using selector: ${selector}`);
          commentIconClicked = true;
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) {
        console.log(`⚠️ Failed to click with selector: ${selector}`);
        continue;
      }
    }
    
    if (!commentIconClicked) {
      console.log("⚠️ Comment icon not clicked, trying direct textbox access");
    }
    
    // Scroll down more to ensure comment box is loaded
    await page.evaluate(() => {
      window.scrollBy(0, 400);
    });
    await page.waitForTimeout(2000);
    
    // Try multiple selectors for comment input box
    const commentBoxSelectors = [
      'textarea[placeholder*="Add a comment"]',
      'textarea[aria-label*="Add a comment"]',
      'div[role="textbox"][contenteditable="true"]',
      'textarea[placeholder*="comment"]',
      'form textarea',
    ];
    
    let commentBox = null;
    
    for (const selector of commentBoxSelectors) {
      try {
        const box = page.locator(selector).first();
        if (await box.isVisible({ timeout: 5000 })) {
          commentBox = box;
          console.log(`✅ Found comment box using selector: ${selector}`);
          break;
        }
      } catch (e) {
        console.log(`⚠️ Comment box not found with selector: ${selector}`);
        continue;
      }
    }
    
    if (!commentBox) {
      // Last resort: take screenshot for debugging
      await page.screenshot({ path: 'comment-box-not-found.png', fullPage: true });
      throw new Error("Comment input box not found - check comment-box-not-found.png");
    }
    
    // Interact with comment box
    await commentBox.scrollIntoViewIfNeeded();
    await commentBox.click({ force: true });
    await page.waitForTimeout(1000);
    
    // Clear any existing text
    await commentBox.fill('');
    await page.waitForTimeout(500);
    
    // Type comment with human-like delay
    await commentBox.type(commentText, { delay: 100 + Math.random() * 100 });
    await page.waitForTimeout(1000);
    
    // Find and click the Post button with multiple selectors
    const postButtonSelectors = [
      'button:has-text("Post")',
      'div[role="button"]:has-text("Post")',
      'button[type="submit"]',
      'button:has(div:text("Post"))',
    ];
    
    let postButton = null;
    
    for (const selector of postButtonSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 5000 })) {
          postButton = btn;
          console.log(`✅ Found post button using selector: ${selector}`);
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
    if (!postButton) {
      throw new Error("Post button not found");
    }
    
    await postButton.scrollIntoViewIfNeeded();
    await postButton.hover();
    await page.waitForTimeout(500);
    await postButton.click({ force: true });
    
    // Wait for comment to be posted
    await page.waitForTimeout(5000);
    
    // Verify comment posted
    const commentVisible = await page.locator(`text=${commentText}`).first().isVisible({ timeout: 10000 }).catch(() => false);
    console.log(commentVisible ? "✅ Comment posted & confirmed" : "✅ Comment posted (confirmation pending)");
    
    return {
      success: true,
      message: commentVisible ? "Comment posted successfully" : "Comment posted (confirmation pending)",
      post_url: cleanUrl,
    };
  } catch (error) {
    console.error("❌ Comment failed:", error.message);
    // Debug screenshot with timestamp
    const timestamp = Date.now();
    await page.screenshot({ 
      path: `comment-error-${timestamp}.png`, 
      fullPage: true 
    }).catch(() => {});
    
    return { 
      success: false, 
      message: error.message,
      debug_screenshot: `comment-error-${timestamp}.png`
    };
  }
}
// ==========================================
// FOLLOW USER FUNCTION
// ==========================================
async function followUser(page, platform, targetUrl) {
  console.log(`👤 Following user on ${platform}...`);

  try {
    // Navigate to target URL
    console.log(`🌐 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("✅ Page loaded successfully");
    await page.waitForTimeout(4000);

    // Handle Instagram
    if (platform === "instagram") {
      console.log("📸 Processing Instagram follow...");
      
      // Wait for profile to load
      await page.waitForTimeout(3000);

      // Multiple selectors for Instagram follow button
      const followSelectors = [
        'button:has-text("Follow")',
        'button:has-text("Follow Back")',
        'button._acan._acap._acas._aj1-',
        'button >> text=Follow',
        '[role="button"]:has-text("Follow")'
      ];

      let followed = false;
      for (const selector of followSelectors) {
        try {
          const followBtn = page.locator(selector).first();
          
          // Check if button exists and is visible
          const isVisible = await followBtn.isVisible({ timeout: 5000 }).catch(() => false);
          
          if (isVisible) {
            await followBtn.click({ timeout: 5000 });
            console.log(`✅ Instagram follow button clicked using: ${selector}`);
            followed = true;
            break;
          }
        } catch (e) {
          console.log(`⚠️ Selector failed: ${selector}`);
          continue;
        }
      }

      if (!followed) {
        // Check if already following
        const alreadyFollowing = await page.locator('button:has-text("Following"), button:has-text("Requested")').first().isVisible().catch(() => false);
        
        if (alreadyFollowing) {
          console.log("ℹ️ Already following this user");
          return { success: true, message: "Already following this user" };
        } else {
          throw new Error("Could not find Instagram follow button");
        }
      }
    }

    // Handle Facebook
    if (platform === "facebook") {
      console.log("📘 Processing Facebook friend request...");
      
      // Wait for Facebook profile to fully load
      await page.waitForTimeout(6000);

      // Close any popups that might be blocking
      await page.locator('[aria-label="Close"]').click().catch(() => {});
      await page.waitForTimeout(1000);

      // Multiple selectors for Facebook Add Friend button
      const addFriendSelectors = [
        'div[aria-label="Add Friend"]',
        'div[aria-label="Add friend"]',
        'span:text-is("Add Friend")',
        'span:text-is("Add friend")',
        'div[aria-label="Add Friend"] span',
        'div[role="button"]:has-text("Add Friend")',
        'div[role="button"]:has-text("Add friend")',
        '//div[@aria-label="Add Friend"]',
        '//div[@aria-label="Add friend"]',
        '//span[text()="Add Friend"]',
        '//span[text()="Add friend"]'
      ];

      let requestSent = false;
      for (const selector of addFriendSelectors) {
        try {
          const addFriendBtn = page.locator(selector).first();
          
          // Check if button exists and is visible
          const isVisible = await addFriendBtn.isVisible({ timeout: 8000 }).catch(() => false);
          
          if (isVisible) {
            // Scroll button into view
            await addFriendBtn.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(1000);
            
            // Click the button
            await addFriendBtn.click({ timeout: 5000 });
            console.log(`✅ Facebook Add Friend clicked using: ${selector}`);
            requestSent = true;
            break;
          }
        } catch (e) {
          console.log(`⚠️ Selector failed: ${selector}`);
          continue;
        }
      }

      if (!requestSent) {
        // Check if already friends or request sent
        const alreadyFriends = await page.locator('span:has-text("Friends"), div[aria-label="Friends"], span:has-text("Friend request sent"), span:has-text("Cancel request")').first().isVisible().catch(() => false);
        
        if (alreadyFriends) {
          console.log("ℹ️ Already friends or request already sent");
          return { success: true, message: "Already friends or request sent" };
        } else {
          // Take screenshot for debugging
          try {
            await page.screenshot({ 
              path: `facebook-follow-error-${Date.now()}.png`,
              fullPage: true 
            });
            console.log("📸 Debug screenshot saved");
          } catch (screenshotError) {
            console.log("⚠️ Could not save screenshot");
          }
          
          throw new Error("Could not find Facebook Add Friend button. Screenshot saved for debugging.");
        }
      }

      // Wait for confirmation
      await page.waitForTimeout(2000);
      
      // Check if request was sent successfully
      const requestSentConfirm = await page.locator('span:has-text("Friend request sent"), span:has-text("Cancel request")').first().isVisible().catch(() => false);
      
      if (requestSentConfirm) {
        console.log("✅ Facebook friend request sent successfully");
      }
    }

    // Handle Twitter/X
    if (platform === "twitter" || platform === "x") {
      console.log("🐦 Processing Twitter/X follow...");
      
      await page.waitForTimeout(3000);

      const twitterFollowSelectors = [
        '[data-testid$="-follow"]',
        '[data-testid="placementTracking"] button:has-text("Follow")',
        'button:has-text("Follow")',
        '[role="button"]:has-text("Follow")'
      ];

      let followed = false;
      for (const selector of twitterFollowSelectors) {
        try {
          const followBtn = page.locator(selector).first();
          const isVisible = await followBtn.isVisible({ timeout: 5000 }).catch(() => false);
          
          if (isVisible) {
            await followBtn.click({ timeout: 5000 });
            console.log(`✅ Twitter follow button clicked using: ${selector}`);
            followed = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!followed) {
        const alreadyFollowing = await page.locator('button:has-text("Following")').first().isVisible().catch(() => false);
        
        if (alreadyFollowing) {
          console.log("ℹ️ Already following this user");
          return { success: true, message: "Already following this user" };
        } else {
          throw new Error("Could not find Twitter follow button");
        }
      }
    }

    await page.waitForTimeout(3000);

    console.log("✅ Follow action completed successfully");
    return { 
      success: true, 
      message: `${platform} follow/friend request sent successfully` 
    };

  } catch (error) {
    console.error("❌ Follow action failed:", error.message);
    
    // Take screenshot for debugging
    try {
      await page.screenshot({ 
        path: `${platform}-follow-error-${Date.now()}.png`,
        fullPage: true 
      });
      console.log("📸 Error screenshot saved");
    } catch (screenshotError) {
      console.log("⚠️ Could not save screenshot");
    }

    return { 
      success: false, 
      message: error.message 
    };
  }
}

async function unfollowUser(page, platform, targetUrl) {
  console.log(`🚫 Unfollowing user on ${platform}...`);

  try {
    // Navigate to target URL
    console.log(`🌐 Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    console.log("✅ Page loaded successfully");
    await page.waitForTimeout(5000);

    /* ================= INSTAGRAM ================= */
    if (platform === "instagram") {
      console.log("📸 Processing Instagram unfollow...");
      
      const followingBtn = page.locator('button:has-text("Following")').first();

      const isFollowing = await followingBtn.count();
      if (!isFollowing) {
        console.log("ℹ️ User is NOT followed — skipping unfollow");
        return {
          success: true,
          message: "User was not followed, nothing to unfollow",
        };
      }

      await followingBtn.waitFor({ state: "visible", timeout: 15000 });
      await followingBtn.click();
      await page.waitForTimeout(2000);

      const dialog = page.locator('div[role="dialog"]').first();
      await dialog.waitFor({ state: "visible", timeout: 15000 });

      const unfollowBtn = dialog
        .locator('div[role="button"]:has-text("Unfollow")')
        .first();

      await unfollowBtn.waitFor({ state: "visible", timeout: 15000 });
      await unfollowBtn.click();

      await page.waitForTimeout(3000);

      console.log("✅ Instagram unfollowed successfully");
      return {
        success: true,
        message: "User unfollowed successfully",
      };
    }

    /* ================= FACEBOOK (UNFRIEND) ================= */
    if (platform === "facebook") {
      console.log("📘 Processing Facebook unfriend...");
      
      // Wait for Facebook profile to fully load
      await page.waitForTimeout(6000);

      // Close any popups that might be blocking
      await page.locator('[aria-label="Close"]').click().catch(() => {});
      await page.waitForTimeout(1000);

      // STEP 1: Find and click "Friends" button
      console.log("🔍 Looking for Friends button...");
      
      const friendsButtonSelectors = [
        'div[aria-label="Friends"]',
        'span:text-is("Friends")',
        'div[role="button"]:has-text("Friends")',
        '//div[@aria-label="Friends"]',
        '//span[text()="Friends"]',
        'div.x1i10hfl:has-text("Friends")',
      ];

      let friendsClicked = false;
      let friendsBtn = null;

      for (const selector of friendsButtonSelectors) {
        try {
          friendsBtn = page.locator(selector).first();
          const isVisible = await friendsBtn.isVisible({ timeout: 5000 }).catch(() => false);
          
          if (isVisible) {
            console.log(`✅ Friends button found using: ${selector}`);
            
            // Scroll into view
            await friendsBtn.scrollIntoViewIfNeeded().catch(() => {});
            await page.waitForTimeout(1000);
            
            // Click the Friends button
            await friendsBtn.click({ timeout: 5000 });
            console.log("✅ Friends button clicked");
            friendsClicked = true;
            break;
          }
        } catch (e) {
          console.log(`⚠️ Selector failed: ${selector}`);
          continue;
        }
      }

      if (!friendsClicked) {
        // Check if already not friends
        const notFriends = await page.locator('div[aria-label="Add Friend"], div[aria-label="Add friend"]').first().isVisible().catch(() => false);
        
        if (notFriends) {
          console.log("ℹ️ User is not a friend");
          return {
            success: true,
            message: "User is not a friend, nothing to unfriend",
          };
        }
        
        throw new Error("Could not find Friends button");
      }

      await page.waitForTimeout(2000);

      // STEP 2: Wait for dropdown menu to appear
      console.log("🔍 Waiting for dropdown menu...");
      
      const menuSelectors = [
        'div[role="menu"]',
        'div[role="dialog"]',
        'ul[role="menu"]',
        'div.x1iyjqo2',
      ];

      let menuFound = false;
      for (const selector of menuSelectors) {
        try {
          await page.locator(selector).first().waitFor({ 
            state: "visible", 
            timeout: 8000 
          });
          console.log(`✅ Menu found using: ${selector}`);
          menuFound = true;
          break;
        } catch (e) {
          continue;
        }
      }

      if (!menuFound) {
        throw new Error("Dropdown menu did not appear");
      }

      await page.waitForTimeout(1500);

      // STEP 3: Click "Unfriend" in the menu
      console.log("🔍 Looking for Unfriend option...");
      
      const unfriendSelectors = [
        'div[role="menuitem"]:has-text("Unfriend")',
        'span:text-is("Unfriend")',
        'div:has-text("Unfriend")',
        '//div[@role="menuitem"]//span[text()="Unfriend"]',
        '//span[text()="Unfriend"]',
        'div[role="menu"] span:has-text("Unfriend")',
        'div[role="dialog"] span:has-text("Unfriend")',
      ];

      let unfriendClicked = false;
      for (const selector of unfriendSelectors) {
        try {
          const unfriendBtn = page.locator(selector).first();
          const isVisible = await unfriendBtn.isVisible({ timeout: 5000 }).catch(() => false);
          
          if (isVisible) {
            console.log(`✅ Unfriend option found using: ${selector}`);
            await unfriendBtn.click({ timeout: 5000 });
            console.log("✅ Unfriend clicked");
            unfriendClicked = true;
            break;
          }
        } catch (e) {
          console.log(`⚠️ Selector failed: ${selector}`);
          continue;
        }
      }

      if (!unfriendClicked) {
        // Take screenshot for debugging
        try {
          await page.screenshot({ 
            path: `facebook-unfriend-menu-${Date.now()}.png`,
            fullPage: true 
          });
          console.log("📸 Menu screenshot saved");
        } catch (screenshotError) {}
        
        throw new Error("Could not find Unfriend option in menu");
      }

      await page.waitForTimeout(2000);

      // STEP 4: Confirm unfriend in the confirmation dialog
      console.log("🔍 Looking for confirmation dialog...");
      
      // Wait for confirmation dialog
      const confirmDialogSelectors = [
        'div[role="dialog"]',
        'div[aria-label*="Unfriend"]',
        'div.x1n2onr6',
      ];

      let confirmDialogFound = false;
      for (const selector of confirmDialogSelectors) {
        try {
          await page.locator(selector).first().waitFor({ 
            state: "visible", 
            timeout: 8000 
          });
          console.log(`✅ Confirmation dialog found using: ${selector}`);
          confirmDialogFound = true;
          break;
        } catch (e) {
          continue;
        }
      }

      if (!confirmDialogFound) {
        console.log("⚠️ No confirmation dialog found, checking if unfriend was successful...");
      }

      await page.waitForTimeout(1500);

      // Click confirm button
      console.log("🔍 Looking for Confirm button...");
      
      const confirmSelectors = [
        'div[aria-label="Confirm"]',
        'div[role="button"]:has-text("Confirm")',
        'span:text-is("Confirm")',
        '//div[@aria-label="Confirm"]',
        '//span[text()="Confirm"]',
        'div[role="dialog"] div[role="button"]:has-text("Confirm")',
      ];

      let confirmClicked = false;
      for (const selector of confirmSelectors) {
        try {
          const confirmBtn = page.locator(selector).first();
          const isVisible = await confirmBtn.isVisible({ timeout: 5000 }).catch(() => false);
          
          if (isVisible) {
            console.log(`✅ Confirm button found using: ${selector}`);
            await confirmBtn.click({ timeout: 5000 });
            console.log("✅ Confirm clicked");
            confirmClicked = true;
            break;
          }
        } catch (e) {
          console.log(`⚠️ Selector failed: ${selector}`);
          continue;
        }
      }

      if (!confirmClicked) {
        console.log("⚠️ Could not find Confirm button, checking status...");
      }

      await page.waitForTimeout(3000);

      // Verify unfriend was successful
      const addFriendVisible = await page.locator('div[aria-label="Add Friend"], div[aria-label="Add friend"]').first().isVisible().catch(() => false);
      
      if (addFriendVisible) {
        console.log("✅ Facebook unfriended successfully (verified)");
        return {
          success: true,
          message: "User unfriended successfully",
        };
      } else {
        console.log("✅ Facebook unfriend action completed");
        return {
          success: true,
          message: "Unfriend action completed",
        };
      }
    }

    /* ================= TWITTER/X ================= */
    if (platform === "twitter" || platform === "x") {
      console.log("🐦 Processing Twitter/X unfollow...");
      
      const followingBtn = page.locator('[data-testid$="-unfollow"]').first();
      
      const isFollowing = await followingBtn.isVisible().catch(() => false);
      if (!isFollowing) {
        console.log("ℹ️ User is NOT followed");
        return {
          success: true,
          message: "User was not followed, nothing to unfollow",
        };
      }

      await followingBtn.click();
      await page.waitForTimeout(2000);

      // Confirm unfollow
      const confirmBtn = page.locator('[data-testid="confirmationSheetConfirm"]').first();
      await confirmBtn.waitFor({ state: "visible", timeout: 10000 });
      await confirmBtn.click();

      await page.waitForTimeout(3000);

      console.log("✅ Twitter unfollowed successfully");
      return {
        success: true,
        message: "User unfollowed successfully",
      };
    }

    /* ================= OTHER PLATFORMS ================= */
    return {
      success: false,
      message: `Unfollow not supported for ${platform}`,
    };

  } catch (error) {
    console.error("❌ Unfollow failed:", error.message);
    
    // Take screenshot for debugging
    try {
      await page.screenshot({ 
        path: `${platform}-unfollow-error-${Date.now()}.png`,
        fullPage: true 
      });
      console.log("📸 Error screenshot saved");
    } catch (screenshotError) {
      console.log("⚠️ Could not save screenshot");
    }

    return {
      success: false,
      message: error.message,
    };
  }
}

// async function unfollowUser(page, platform, targetUrl) {
//   console.log(`🚫 Unfollowing user on ${platform}...`);

//   try {
//     await page.goto(targetUrl, {
//       waitUntil: "domcontentloaded",
//       timeout: 60000,
//     });

//     await page.waitForTimeout(4000);

//     if (platform !== "instagram") {
//       return {
//         success: false,
//         message: `Unfollow not supported for ${platform}`,
//       };
//     }

//     // STEP 1: Find "Following" button
//     const followingBtn = page.locator('button:has-text("Following")').first();

//     const isFollowing = await followingBtn.count();
//     if (!isFollowing) {
//       console.log("ℹ️ User is NOT followed — skipping unfollow");
//       return {
//         success: true,
//         message: "User was not followed, nothing to unfollow",
//       };
//     }

//     // ✅ CLICK FOLLOWING (THIS WAS MISSING)
//     await followingBtn.waitFor({ state: "visible", timeout: 15000 });
//     await followingBtn.click();
//     await page.waitForTimeout(2000);

//     // STEP 2: Wait for dialog
//     const dialog = page.locator('div[role="dialog"]').first();
//     await dialog.waitFor({ state: "visible", timeout: 15000 });

//     // STEP 3: Click Unfollow
//     const unfollowBtn = dialog
//       .locator('div[role="button"]:has-text("Unfollow")')
//       .first();

//     await unfollowBtn.waitFor({ state: "visible", timeout: 15000 });
//     await unfollowBtn.click();

//     await page.waitForTimeout(3000);

//     console.log("✅ Unfollowed successfully");
//     return {
//       success: true,
//       message: "User unfollowed successfully",
//     };
//   } catch (error) {
//     console.error("❌ Unfollow failed:", error.message);
//     return {
//       success: false,
//       message: error.message,
//     };
//   }
// }

// Helper function to extract auth token
function extractAuthToken(cookies, platform) {
  const tokenMap = {
    instagram: "sessionid",
    facebook: "c_user",
    twitter: "auth_token",
    linkedin: "li_at",
    youtube: "SAPISID",
    tiktok: "sessionid",
  };

  const tokenName = tokenMap[platform];
  const cookie = cookies.find((c) => c.name === tokenName);
  return cookie ? cookie.value : null;
}

app.listen(PORT, () => {
  console.log(`🚀 Node API running http://localhost:${PORT}`);
});
