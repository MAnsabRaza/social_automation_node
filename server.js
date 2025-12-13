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
  const { task, account, post_content } = req.body;

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

    // Check if browser session exists
    if (activeBrowsers[account.id]) {
      console.log("♻️ Reusing existing browser session");
      context = activeContexts[account.id];
      browser = activeBrowsers[account.id];
      page = await context.newPage();
    } else {
      console.log("🚀 Launching new browser session");

      // Parse session data if exists
      let storageState = null;
      if (account.session_data) {
        try {
          storageState = JSON.parse(account.session_data);
        } catch (e) {
          console.log("⚠️ Invalid session data, logging in fresh");
        }
      }

      browser = await chromium.launch({
        headless: false,
        proxy: account.proxy_id
          ? {
              server: `http://${account.proxy?.host}:${account.proxy?.port}`,
              username: account.proxy?.username || undefined,
              password: account.proxy?.password || undefined,
            }
          : undefined,
      });

      context = await browser.newContext({
        storageState: storageState,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        locale: "en-US",
        timezoneId: "America/New_York",
      });

      activeBrowsers[account.id] = browser;
      activeContexts[account.id] = context;

      page = await context.newPage();
    }

    // Execute task based on type
    if (taskType === "post") {
      const result = await createPost(page, platform, post_content, task);

      // Don't close browser - keep session alive
      // await browser.close();

      return res.json({
        success: result.success,
        message: result.message,
        post_url: result.post_url || null,
      });
    } else if (taskType === "like") {
      const result = await likePost(page, platform, task.target_url);
      return res.json(result);
    } else if (taskType === "comment") {
      const result = await commentOnPost(
        page,
        platform,
        task.target_url,
        post_content?.content
      );
      return res.json(result);
    } else if (taskType === "follow") {
      const result = await followUser(page, platform, task.target_url);
      return res.json(result);
    } else {
      return res.json({
        success: false,
        message: `Task type "${taskType}" not implemented yet`,
      });
    }
  } catch (error) {
    console.error("❌ Task execution failed:", error.message);
    return res.json({
      success: false,
      message: "Task execution error",
      error: error.message,
    });
  }
});

// ==========================================
// CREATE POST FUNCTION
// ==========================================
async function createPost(page, platform, postContent, task) {
  console.log(`📝 Creating post on ${platform}...`);

  try {
    switch (platform) {
      case "instagram":
        return await createInstagramPost(page, postContent);
      case "facebook":
        return await createFacebookPost(page, postContent);
      case "twitter":
        return await createTwitterPost(page, postContent);
      case "linkedin":
        return await createLinkedInPost(page, postContent);
      default:
        return {
          success: false,
          message: `Platform ${platform} not supported for posting yet`,
        };
    }
  } catch (error) {
    console.error(`❌ Failed to create post on ${platform}:`, error.message);
    return { success: false, message: error.message };
  }
}

// ==========================================
// INSTAGRAM POST
// ==========================================
async function createInstagramPost(page, postContent) {
  console.log("📸 Creating Instagram post (2025 updated method)...");

  try {
    await page.goto("https://www.instagram.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForTimeout(4000);

    // Dismiss all popups
    await page.click("text=Not now").catch(() => {});
    await page.click('button:has-text("Not Now")').catch(() => {});
    await page
      .click('button:has-text("Turn on Notifications") >> nth=0')
      .catch(() => {});
    await page.waitForTimeout(3000);

    // METHOD 1: Click bottom "+" button (most reliable in 2025)
    const createButton = await page
      .waitForSelector('[data-testid="new-post-button"]', { timeout: 10000 })
      .catch(async () => {
        // Fallback: try SVG icon in bottom nav
        return await page.waitForSelector('svg[aria-label="New post"]', {
          timeout: 10000,
        });
      });

    if (!createButton) {
      throw new Error("Instagram Create (+) button not found");
    }

    await createButton.click({ force: true });
    console.log("✅ Create button clicked");

    // Wait for the Create modal/panel to open
    await page.waitForTimeout(3000);

    // Look for "Select from computer" button or drag area
    const selectFromComputer = await page
      .locator(
        'button:has-text("Select from computer"), div[role="button"]:has-text("Select from computer"), span:has-text("Select from computer")'
      )
      .first();

    if (await selectFromComputer.isVisible({ timeout: 10000 })) {
      await selectFromComputer.click({ force: true });
      console.log("✅ Clicked 'Select from computer'");
    } else {
      // Alternative: click the big drop zone
      const dropZone = page.locator(
        'div[accept*="image"], div[accept*="video"], i[aria-label="Photo/video"]'
      );
      await dropZone.click({ force: true });
      console.log("✅ Clicked drop zone");
    }

    await page.waitForTimeout(2000);

    // === UPLOAD FILES USING FILE CHOOSER ===
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page
        .click('input[type="file"][multiple]', { force: true })
        .catch(() => {}), // hidden input
    ]);

    if (!fileChooser) {
      throw new Error("File chooser did not open");
    }

    // Prepare temp files
    const tempFiles = [];
    let mediaUrls = [];

    if (postContent?.media_urls) {
      const raw = postContent.media_urls.trim();
      if (raw.startsWith("[")) {
        try {
          mediaUrls = JSON.parse(raw);
        } catch {
          mediaUrls = [raw];
        }
      } else if (raw) {
        mediaUrls = [raw];
      }
    }

    for (let b64 of mediaUrls) {
      if (b64.startsWith("data:image") || b64.startsWith("data:video")) {
        const ext = b64.includes("video") ? ".mp4" : ".jpg";
        const filePath = path.join(
          __dirname,
          `temp_${Date.now()}_${Math.random().toString(36)}.${ext}`
        );
        const base64Data = b64.split(",")[1];
        fs.writeFileSync(filePath, Buffer.from(base64Data, "base64"));
        tempFiles.push(filePath);
      }
    }

    if (tempFiles.length === 0) {
      throw new Error("No valid media files to upload");
    }

    await fileChooser.setFiles(tempFiles);
    console.log(`✅ Uploaded ${tempFiles.length} file(s)`);

    // Wait for upload to finish
    await page
      .waitForSelector('img[alt="Preview"]', { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(4000);

    // Click Next → Next → Share
    await page
      .click('div:has-text("Next") >> nth=0')
      .catch(() => page.click('button:has-text("Next")'));
    await page.waitForTimeout(3000);

    await page
      .click('div:has-text("Next") >> nth=0')
      .catch(() => page.click('button:has-text("Next")'));
    await page.waitForTimeout(3000);

    // Add caption
    const caption =
      (postContent?.content || "") + "\n\n" + (postContent?.hashtags || "");
    await page.fill(
      'textarea[aria-label="Write a caption..."]',
      caption.trim()
    );
    await page.waitForTimeout(2000);

    // Share
    await page
      .click('div:has-text("Share") >> nth=0')
      .catch(() => page.click('button:has-text("Share")'));

    await page.waitForTimeout(8000);

    // Cleanup
    tempFiles.forEach((f) => fs.unlinkSync(f));

    console.log("✅ Instagram post created successfully!");
    return {
      success: true,
      message: "Instagram post created successfully",
      post_url: "https://www.instagram.com/",
    };
  } catch (error) {
    console.error("❌ Instagram post failed:", error.message);
    return {
      success: false,
      message: error.message || "Instagram post failed",
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
  console.log(`❤️ Liking post on ${platform}...`);

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    switch (platform) {
      case "instagram":
        await page.click('svg[aria-label="Like"]').catch(() => {});
        break;
      case "facebook":
        await page.click('[aria-label="Like"]').catch(() => {});
        break;
      case "twitter":
        await page.click('[data-testid="like"]').catch(() => {});
        break;
    }

    await page.waitForTimeout(2000);
    return { success: true, message: "Post liked successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// ==========================================
// COMMENT FUNCTION
// ==========================================
async function commentOnPost(page, platform, targetUrl, commentText) {
  console.log(`💬 Commenting on ${platform}...`);

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    switch (platform) {
      case "instagram":
        await page.click('textarea[aria-label="Add a comment..."]');
        await page.fill('textarea[aria-label="Add a comment..."]', commentText);
        await page.click('button:has-text("Post")');
        break;
      case "facebook":
        await page.click('[aria-label="Write a comment"]');
        await page.fill('[aria-label="Write a comment"]', commentText);
        await page.keyboard.press("Enter");
        break;
    }

    await page.waitForTimeout(2000);
    return { success: true, message: "Comment posted successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// ==========================================
// FOLLOW USER FUNCTION
// ==========================================
async function followUser(page, platform, targetUrl) {
  console.log(`👤 Following user on ${platform}...`);

  try {
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    switch (platform) {
      case "instagram":
        await page
          .click('button:has-text("Follow")')
          .first()
          .catch(() => {});
        break;
      case "twitter":
        await page.click('[data-testid$="-follow"]').catch(() => {});
        break;
    }

    await page.waitForTimeout(2000);
    return { success: true, message: "User followed successfully" };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

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
