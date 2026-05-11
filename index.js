import puppeteer from 'puppeteer';
import { Telegraf } from 'telegraf';
import 'dotenv/config';

const bot = new Telegraf(process.env.TELEGRAM_TOKEN);
const seenIds = new Set();

async function checkEmails() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Логинимся
  await page.goto('https://studentmail.ukf.sk/webmail/', { waitUntil: 'networkidle2' });
  await page.type('input[name="_user"]', process.env.EMAIL);
  await page.type('input[name="_pass"]', process.env.PASSWORD);
  await page.click('input[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle2' });

  // Ждём загрузки списка писем
  await page.waitForSelector('tr.message', { timeout: 10000 });
  // Получаем непрочитанные письма
  const emails = await page.evaluate(() => {
    const rows = document.querySelectorAll('tr.message.unread');
    return Array.from(rows).map(row => {
      const uid = row.id.replace('rcmrow', ''); // достаём UID из id="rcmrow224"
      const subjectEl = row.querySelector('td.subject a');
      const fromEl = row.querySelector('td.from span');
      const dateEl = row.querySelector('td.date');

      return {
        uid,
        subject: subjectEl?.innerText?.trim() || '(без темы)',
        sender: fromEl?.getAttribute('title') || fromEl?.innerText || 'Неизвестно',
        date: dateEl?.innerText?.trim() || '',
        link: subjectEl?.href || '',
      };
    });
  });

  console.log(`📬 Найдено новых писем: ${emails.length}`);

  for (const email of emails) {
    if (seenIds.has(email.uid)) continue;
    seenIds.add(email.uid);

    // Открываем письмо по прямой ссылке
    await page.goto(
        `https://studentmail.ukf.sk/webmail/?_task=mail&_action=show&_mbox=INBOX&_uid=${email.uid}`,
        { waitUntil: 'networkidle2' }
    );

    // Ждём тело письма
    await page.waitForSelector('#messagebody', { timeout: 8000 }).catch(() => {});

    const body = await page.evaluate(() => {
      return document.querySelector('#messagebody')?.innerText?.slice(0, 1000) || '(нет текста)';
    });

    // Экранируем спецсимволы для Markdown
    const safe = (str) => str.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');

    const text =
        `📧 *Новое письмо*\n\n` +
        `*От:* ${safe(email.sender)}\n` +
        `*Тема:* ${safe(email.subject)}\n` +
        `*Дата:* ${safe(email.date)}\n\n` +
        `${safe(body)}`;

    await bot.telegram.sendMessage(process.env.CHAT_ID, text, {
      parse_mode: 'MarkdownV2'
    });

    console.log(`✅ Отправлено: ${email.subject}`);

    // Возвращаемся к списку писем
    await page.goto('https://studentmail.ukf.sk/webmail/?_task=mail', { waitUntil: 'networkidle2' });
    await page.waitForSelector('tr.message', { timeout: 10000 });
  }

  await browser.close();
}

async function main() {
  console.log('🤖 Бот запущен, проверяю почту каждые 60 секунд...');

  while (true) {
    try {
      await checkEmails();
    } catch (err) {
      console.error('❌ Ошибка:', err.message);
    }

    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

main();