const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir);
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const capture = async (filename) => {
    // Wait a brief moment for any animations/renders
    await new Promise(r => setTimeout(r, 1000));
    const filePath = path.join(screenshotsDir, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`Saved ${filename}`);
  };

  const login = async (email, password) => {
    await page.goto('http://localhost:3001/auth/login', { waitUntil: 'networkidle0' });
    await page.type('input[name="email"]', email);
    await page.type('input[name="password"]', password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0' }),
      page.click('button[type="submit"]')
    ]);
  };

  const logout = async () => {
    await page.goto('http://localhost:3001/auth/logout', { waitUntil: 'networkidle0' });
  };

  try {
    // DOCTOR PAGES
    await login('doctor1@labtm.com', 'password123');
    
    // TEST REPORT SCREEN (Order 1 is completed based on seed.sql)
    await page.goto('http://localhost:3001/doctor/report/1', { waitUntil: 'networkidle0' });
    await capture('06-test-report.png');

    await logout();

    // TECHNICIAN PAGES
    await login('tech1@labtm.com', 'password123');
    
    // ALERT CONFIRMATION SCREEN
    await page.goto('http://localhost:3001/technician/verify', { waitUntil: 'networkidle0' });
    await capture('08-alert-confirmation-screen.png');

    console.log('Capture complete!');
  } catch (err) {
    console.error('Error during capture:', err);
  } finally {
    await browser.close();
  }
}

run();
