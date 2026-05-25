# Playwrightコーディング標準

このドキュメントはPlaywrightを使用したE2Eテストのコーディング標準を定義します。

## 基本原則

### 1. リトライ禁止ポリシー

テストの信頼性を確保するため、リトライは禁止します。

```typescript
// ❌ 禁止: playwright.config.ts
export default defineConfig({
  retries: 2, // リトライ禁止
});

// ✅ 正しい設定
export default defineConfig({
  retries: 0, // リトライなし
});
```

```typescript
// ❌ 禁止: expect.toPass()
await expect(async () => {
  await page.click('[data-testid="button"]');
}).toPass({ timeout: 10000 });

// ✅ 正しい: 明示的な待機
await page.waitForResponse(res => res.url().includes('/api'));
await page.click('[data-testid="button"]');
```

### 2. waitForTimeout() 禁止

固定時間待機は不安定なテストの原因になります。

```typescript
// ❌ 禁止
await page.waitForTimeout(2000);

// ✅ 正しい: 明示的な待機
await page.waitForResponse(res => res.url().includes('/api/data'));
await expect(page.getByTestId('element')).toBeVisible();
```

### 3. ブラウザ操作優先

E2Eテストはブラウザ操作を通じて実施します。

```typescript
// ❌ 禁止: APIを直接テスト
test('データ作成', async ({ request }) => {
  const response = await request.post('/api/data', { data: {...} });
  expect(response.status()).toBe(201);
});

// ✅ 正しい: ブラウザ操作でテスト
test('データ作成', async ({ page }) => {
  await page.getByTestId('create-button').click();
  await page.getByTestId('name-input').fill('テストデータ');
  await page.getByTestId('save-button').click();
  await expect(page.getByText('作成しました')).toBeVisible();
});

// ✅ 例外: テストデータ準備/クリーンアップのみAPI使用可
test('データ編集', async ({ page, request }) => {
  // テストデータ準備（許可）
  const response = await request.post('/api/data', { data: {...} });
  const { id } = await response.json();

  // ブラウザ操作でテスト（必須）
  await page.goto(`/data/${id}`);
  await page.getByTestId('edit-button').click();
  // ...

  // クリーンアップ（許可）
  await request.delete(`/api/data/${id}`);
});
```

## 構造とパターン

### Page Object Model

```typescript
// playwright-tests/pages/ExamplePage.ts
import { Page, expect } from '@playwright/test';

export class ExamplePage {
  constructor(private page: Page) {}

  // セレクタをページオブジェクトに集約
  private readonly createButton = () => this.page.getByTestId('create-button');
  private readonly nameInput = () => this.page.getByTestId('name-input');
  private readonly saveButton = () => this.page.getByTestId('save-button');

  async create(name: string) {
    await this.createButton().click();
    await this.nameInput().fill(name);
    await this.saveButton().click();
  }

  async expectCreated() {
    await expect(this.page.getByText('作成しました')).toBeVisible();
  }
}
```

### test.step() の使用

```typescript
test('データ作成フロー', async ({ page }) => {
  await test.step('作成フォームを開く', async () => {
    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('create-form')).toBeVisible();
  });

  await test.step('フォームに入力', async () => {
    await page.getByTestId('name-input').fill('テストデータ');
  });

  await test.step('保存して成功確認', async () => {
    const responsePromise = page.waitForResponse(res =>
      res.url().includes('/api/data') && res.request().method() === 'POST'
    );
    await page.getByTestId('save-button').click();
    await responsePromise;
    await expect(page.getByText('作成しました')).toBeVisible();
  });
});
```

## セレクタ戦略

優先順位:

1. **getByTestId()** - 最も安定
   ```typescript
   page.getByTestId('submit-button')
   ```

2. **getByRole()** - アクセシビリティ
   ```typescript
   page.getByRole('button', { name: '送信' })
   ```

3. **getByText()** - テキストベース
   ```typescript
   page.getByText('送信')
   ```

4. **locator()** - 最終手段
   ```typescript
   page.locator('[data-custom="value"]')
   ```

## 待機戦略

### API応答待機

```typescript
const responsePromise = page.waitForResponse(res =>
  res.url().includes('/api/data') && res.status() === 200
);
await page.getByTestId('submit-button').click();
await responsePromise;
```

### 要素表示待機

```typescript
await expect(page.getByTestId('element')).toBeVisible();
```

### ローディング完了待機

```typescript
await page.locator('[data-testid="loading"]').waitFor({ state: 'hidden' });
```

## テストデータ管理

### 一意性の確保

```typescript
const uniqueName = `テスト_${Date.now()}`;
await page.getByTestId('name-input').fill(uniqueName);
```

### クリーンアップ

```typescript
test('データ作成', async ({ page, request }) => {
  let dataId: string | null = null;

  try {
    // テスト実行
    await page.getByTestId('create-button').click();
    // ...
    dataId = await page.getByTestId('data-id').textContent();
  } finally {
    // クリーンアップ
    if (dataId) {
      await request.delete(`/api/data/${dataId}`);
    }
  }
});
```

## 禁止パターンまとめ

| 禁止パターン | 代替手段 |
|-------------|---------|
| `waitForTimeout()` | `waitForResponse()`, `expect().toBeVisible()` |
| `retries > 0` | 適切な待機戦略 |
| `expect.toPass()` | 明示的な待機 |
| API直接テスト | ブラウザ操作 |
| `networkidle` | `waitForResponse()` |
