const { chromium } = require('playwright');
const log = (...a) => console.log(...a);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  p.on('response', r => r.status() >= 400 && errs.push('HTTP ' + r.status() + ' ' + r.url().slice(0,160))); p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  p.on('console', (m) => m.type() === 'error' && errs.push('CONSOLE ' + m.text().slice(0, 200)));
  p.on('dialog', (d) => d.accept());
  const go = async (tab) => { await p.getByRole('button', { name: tab, exact: true }).click(); await p.waitForTimeout(1500); };
  await p.goto((process.env.APP_URL||'http://localhost:5173')+'/#overview', { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Reset data' }).click(); await p.waitForTimeout(3000);
  await p.getByRole('button', { name: 'Hide copilot' }).click().catch(() => {});
  log('HEADER:', (await p.locator('h1').first().innerText()), '|', (await p.locator('main p').first().innerText()).slice(0, 160));
  log('KPI1:', (await p.locator('.card').nth(0).innerText()).replace(/\n/g, ' | '));
  log('KPI2:', (await p.locator('.card').nth(1).innerText()).replace(/\n/g, ' | '));
  await p.screenshot({ path: './shots/v3_overview.png', fullPage: true });
  // Attendees
  await go('Attendees');
  log('ATT people heading:', await p.getByText(/^People \(/).first().innerText());
  await p.getByRole('button', { name: '+ New registration' }).click();
  await p.getByLabel('Full name').fill('Test Runner'); await p.getByLabel('College').fill('Hansraj College');
  await p.getByLabel('Sport').selectOption('Basketball'); await p.getByLabel('Source campaign').selectOption('C04');
  await p.getByRole('button', { name: 'Register', exact: true }).click(); await p.waitForTimeout(1500);
  const msg = await p.getByRole('status').first().innerText(); log('ATT register:', msg);
  const rid = (msg.match(/R26-[0-9A-F]+/) || [])[0];
  await p.getByLabel('Status filter').selectOption('waitlisted'); await p.waitForTimeout(1000);
  log('ATT waitlisted heading:', await p.getByText(/^People \(/).first().innerText());
  await p.getByText('release now').click(); await p.waitForTimeout(2500);
  log('ATT release:', await p.getByRole('status').first().innerText());
  await p.getByLabel('Status filter').selectOption('all'); await p.getByLabel('Search people').fill('Test Runner'); await p.getByRole('button', { name: 'Search' }).click(); await p.waitForTimeout(1000);
  await p.getByText('Test Runner').first().click(); await p.waitForTimeout(1200);
  await p.getByRole('button', { name: 'Show pass' }).click(); await p.waitForTimeout(800);
  await p.screenshot({ path: './shots/v3_attendees.png', fullPage: true });
  await p.getByRole('button', { name: 'Send pass' }).click().catch(() => log('no send pass btn')); await p.waitForTimeout(1200);
  // Public pages
  const pub = await b.newPage({ viewport: { width: 390, height: 844 } });
  await pub.goto((process.env.APP_URL||'http://localhost:5173')+'/#register?c=C05', { waitUntil: 'networkidle' });
  await pub.getByLabel('Full name').fill('Phone Person'); await pub.getByRole('button', { name: 'Watch' }).click();
  await pub.getByRole('button', { name: 'Register', exact: true }).click(); await pub.waitForTimeout(1500);
  log('PUBLIC register:', (await pub.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 200));
  await pub.screenshot({ path: './shots/v3_register_done.png', fullPage: true });
  await pub.goto((process.env.APP_URL||'http://localhost:5173')+'/#pass/' + rid, { waitUntil: 'networkidle' }); await pub.waitForTimeout(1500);
  log('PASS page:', (await pub.locator('main').innerText()).replace(/\n/g, ' | ').slice(0, 200));
  await pub.screenshot({ path: './shots/v3_pass.png', fullPage: true });
  // Gate
  await go('Gate');
  log('GATE closed banner:', (await p.getByText(/The gate is closed/).count()));
  await p.getByRole('button', { name: 'Move to fest day 1, 10:00' }).click(); await p.waitForTimeout(2500);
  await p.getByLabel('Pass code').fill(rid); await p.getByRole('button', { name: 'Admit', exact: true }).click(); await p.waitForTimeout(1500);
  log('GATE admit:', (await p.getByRole('status').first().innerText()).replace(/\n/g, ' | '));
  await p.getByLabel('Pass code').fill(rid); await p.getByRole('button', { name: 'Admit', exact: true }).click(); await p.waitForTimeout(1500);
  log('GATE repeat:', (await p.getByRole('status').first().innerText()).replace(/\n/g, ' | '));
  await p.getByLabel('Walk-in name').fill('Gate Walker'); await p.getByRole('button', { name: 'Admit walk-in' }).click(); await p.waitForTimeout(1500);
  log('GATE kpis:', (await p.locator('.card').nth(0).innerText()).replace(/\n/g, ' | '), '||', (await p.locator('.card').nth(1).innerText()).replace(/\n/g, ' | '));
  await p.screenshot({ path: './shots/v3_gate.png', fullPage: true });
  await go('Overview');
  log('OVERVIEW live:', (await p.locator('main p').first().innerText()).slice(0, 160), '|', (await p.locator('.card').nth(0).innerText()).replace(/\n/g, ' | '));
  // Bets
  await go('Bets');
  log('BETS verdicts:', (await p.locator('.tag.text-sm').allInnerTexts()).join(','));
  // 2025 replay
  await p.getByLabel('Fest year').selectOption('2025'); await p.waitForTimeout(1500); await go('Overview');
  log('2025 KPI1:', (await p.locator('.card').nth(0).innerText()).replace(/\n/g, ' | '));
  // Data settings
  await go('Data');
  log('DATA fest settings:', await p.getByText(/^Fest settings/).count());
  await p.getByLabel('Fest year').selectOption('2026'); await p.waitForTimeout(1500);
  log('DATA sim note:', (await p.getByText(/Simulated data \[A\]/).first().innerText()).slice(0, 120));
  await p.getByRole('button', { name: 'Reset data' }).click(); await p.waitForTimeout(3000);
  for (const t of ['Overview', 'Channels', 'Campaigns & tasks']) { await go(t); }
  await p.setViewportSize({ width: 390, height: 844 });
  for (const t of ['attendees', 'gate']) { await p.goto((process.env.APP_URL||'http://localhost:5173')+'/#' + t, { waitUntil: 'networkidle' }); await p.waitForTimeout(1500); log('PHONE', t, await p.evaluate(() => document.documentElement.scrollWidth)); }
  log('errors:', JSON.stringify(errs.slice(0, 8)));
  await b.close();
})().catch((e) => { console.error('FAIL', e.message.slice(0, 600)); process.exit(1); });
