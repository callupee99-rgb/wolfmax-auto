const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  // Para Render usamos @sparticuz/chromium, no el chromium descargado
  skipDownload: true,
};
