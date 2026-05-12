import { chromium } from 'playwright-core';
import { Telegraf } from 'telegraf';
import 'dotenv/config';

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const seenIds = new Set();

async function checkEmails() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const page = await browser.newPage();

  await page.goto('https://studentmail.ukf.sk/webmail/', { waitUntil: 'networkidle' });
  await page.fill('input[name="_user"]', process.env.EMAIL);
  await page.fill('input[name="_pass"]', process.env.PASSWORD);
  await page.click('input[type="submit"]');
  await page.waitForLoadState('networkidle');

  await page.waitForSelector('tr.message', { timeout: 10000 });

  const emails = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr.message.unread');
    return Array.from(rows).map(row => {
      const uid = row.id.replace('rcmrow', '');
      const subjectEl = row.querySelector('td.subject a');
      const fromEl = row.querySelector('td.from span');
      const dateEl = row.querySelector('td.date');
      return {
        uid,
        subject: subjectEl?.innerText?.trim() || '(без темы)',
        sender: fromEl?.getAttribute('title') || fromEl?.innerText || 'Неизвестно',
        date: dateEl?.innerText?.trim() || '',
      };
    });
  });

  console.log(`New messages: ${emails.length}`);

  for (const email of emails) {
    if (seenIds.has(email.uid)) continue;
    seenIds.add(email.uid);

    await page.goto(
        `https://studentmail.ukf.sk/webmail/?_task=mail&_action=show&_mbox=INBOX&_uid=${email.uid}`,
        { waitUntil: 'networkidle' }
    );

    await page.waitForSelector('#messagebody', { timeout: 8000 }).catch(() => {});

    const body = await page.evaluate(() => {
      return document.querySelector('#messagebody')?.innerText?.slice(0, 1000) || '(нет текста)';
    });

    const safe = (str) => str.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');

    const text =
        `📧 *New message*\n\n` +
        `*От:* ${safe(email.sender)}\n` +
        `*Тема:* ${safe(email.subject)}\n` +
        `*Дата:* ${safe(email.date)}\n\n` +
        `${safe(body)}`;

    await bot.telegram.sendMessage(process.env.CHAT_ID, text, {
      parse_mode: 'MarkdownV2'
    });

    console.log(`Sender: ${email.subject}`);

    await page.goto('https://studentmail.ukf.sk/webmail/?_task=mail', { waitUntil: 'networkidle' });
    await page.waitForSelector('tr.message', { timeout: 10000 });
  }

  await browser.close();
}

async function main() {
  console.log('Checking new messages');

  while (true) {
    try {
      await checkEmails();
    } catch (err) {
      console.error('Error:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

main();