import { test, expect } from '@playwright/test'
import { site } from '../playwright.config.ts'

test('dört mod ve tahmin ekranı farklı ekran genişliklerinde kullanılabilir', async ({ browser }) => {
  test.setTimeout(120_000)
  const one = await browser.newPage(), two = await browser.newPage()
  try {
    await one.goto(site)
    for (const width of [320, 375, 430, 768, 1280, 1440]) {
      await one.setViewportSize({ width, height: 900 })
      expect(await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    }
    await one.getByLabel('Oyuncu adın').fill('Ada')
    await one.getByRole('button', { name: 'Oda oluştur', exact: true }).click()
    const code = await one.getByTestId('room-code').innerText()
    await two.goto(site + '?oda=' + code)
    await two.getByLabel('Oyuncu adın').fill('Can')
    await two.getByRole('button', { name: 'Odaya katıl', exact: true }).last().click()
    await one.getByRole('button', { name: /Çiz ve Tahmin Et/ }).click()
    for (const width of [320, 375, 430, 768, 1280, 1440]) {
      await one.setViewportSize({ width, height: 900 })
      await expect(one.getByRole('button', { name: /Çiz ve Tahmin Et/ })).toHaveAttribute('aria-pressed', 'true')
      expect(await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    }
    await one.getByRole('button', { name: 'Hazırım', exact: true }).click()
    await two.getByRole('button', { name: 'Hazırım', exact: true }).click()
    await one.getByRole('button', { name: 'Oyunu başlat' }).click()
    await expect(two.getByLabel('Tahminin')).toBeEnabled({ timeout: 6000 })
    for (const width of [320, 375, 430, 768, 1280, 1440]) {
      for (const page of [one, two]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
        await expect(page.getByTestId('timer')).toBeVisible()
        await expect(page.getByLabel('Çizim tuvali')).toBeVisible()
      }
      await expect(two.getByLabel('Tahminin')).toBeVisible()
    }
    const secret = (await one.locator('.guess-context').innerText()).match(/Çizeceğin kelime: ([^\n]+)/)![1]
    expect(await two.locator('.guess-context').innerText()).not.toContain('Çizeceğin kelime:')
    expect(await two.getByLabel('Tahminin').inputValue()).toBe('')
    await two.getByLabel('Tahminin').fill('yanlış tahmin')
    await two.getByLabel('Tahminin').press('Enter')
    await expect(two.getByRole('status').filter({ hasText: 'Bir daha dene' })).toBeVisible()
    await two.getByLabel('Tahminin').fill(secret)
    await two.getByLabel('Tahminin').press('Enter')
    await expect(two.getByText('Bildiniz!')).toBeVisible()
    for (let turn = 1; turn < 6; turn++) {
      const drawer = turn % 2 ? two : one, guesser = turn % 2 ? one : two
      await expect(drawer.locator('.guess-context')).toContainText(`Tur ${turn + 1}/6`, { timeout: 10_000 })
      await expect(guesser.getByLabel('Tahminin')).toBeEnabled({ timeout: 7000 })
      const word = (await drawer.locator('.guess-context').innerText()).match(/Çizeceğin kelime: ([^\n]+)/)![1]
      await guesser.getByLabel('Tahminin').fill(word)
      await guesser.getByLabel('Tahminin').press('Enter')
    }
    await expect(one.getByTestId('results')).toBeVisible({ timeout: 7000 })
    for (const width of [320, 375, 430, 768, 1280, 1440]) {
      await one.setViewportSize({ width, height: 900 })
      expect(await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
      await expect(one.getByText('Birlikte 6/6 kelime bildiniz!')).toBeVisible()
    }
    await one.getByRole('button', { name: 'Galeriye kaydet' }).click()
    await expect(one.getByRole('button', { name: 'Galeriye kaydedildi' })).toBeVisible({ timeout: 16_000 })
    await one.getByRole('button', { name: 'Galerim' }).click()
    await expect(one.getByRole('button', { name: /Çiz ve Tahmin Et/ })).toBeVisible()
    for (const width of [320, 375, 430, 768, 1280, 1440]) {
      await one.setViewportSize({ width, height: 900 })
      expect(await one.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    }
    await one.getByRole('button', { name: /Çiz ve Tahmin Et/ }).click()
    await expect(one.getByRole('img', { name: /Birlikte 6\/6/ })).toBeVisible()
  } finally { await one.close(); await two.close() }
})

