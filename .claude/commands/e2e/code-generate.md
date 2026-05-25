---
description: Implement E2E test code
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, WebSearch, WebFetch, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_close, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_type, mcp__playwright__browser_network_requests
---

# E2E Test Code Implementation

E2Eテストコードを実装します。

📖 **共通ルールと参照ドキュメントは `.claude/e2e-test-common.md` を参照してください。**
📖 **コーディング標準は `docs/coding-standard/playwright.md` を参照してください（リトライ禁止ポリシー等）。**
📖 **プロジェクト固有の設定は `.claude/e2e-config.md` を参照してください。**

## 事前確認: E2E環境の確認（必須）

**最初に以下を確認してください：**

```bash
ls docs/e2e/
```

**`docs/e2e/` ディレクトリが存在しない場合:**
- 以下のメッセージを表示して**このコマンドを終了**してください
- 他のタスクは実行しないでください

```
❌ E2E環境が初期化されていません。

先に /e2e:init を実行してE2E環境を初期化してください。

/e2e:init
```

**ディレクトリが存在する場合:**
- テストケース（`docs/e2e/test-cases/*.md`）が存在しない場合は、`/e2e:case-generate` を先に実行するよう案内してください
- テストケースが存在する場合のみ、以降のタスクに進んでください

## タスク

### 0. 【必須】ブラウザで実際の画面を確認

**⚠️ このステップをスキップしてはいけません。ブラウザを開かずにテストコードを実装することは禁止です。**

1. **開発サーバーの起動確認**
   - 開発サーバーが起動していない場合は、ユーザーに起動を依頼
   - 起動コマンドは `.claude/e2e-config.md` の「開発サーバー起動コマンド」を参照

2. **ブラウザを開いてアプリケーションを確認**
   ```
   mcp__playwright__browser_navigate: {開発サーバーURL}
   mcp__playwright__browser_snapshot: 画面全体を確認
   ```

3. **認証が必要な場合**（`.claude/e2e-config.md` で `認証が必要 | true` の場合）
   - `.auth.md` の手順に従ってログイン
   - 認証エラー時は `.claude/e2e-config.md` の「認証更新コマンド」を実行

4. **テスト対象の画面で要素とセレクタを確認**
   ```
   mcp__playwright__browser_navigate: 対象機能のURL
   mcp__playwright__browser_snapshot: 画面要素を確認
   mcp__playwright__browser_evaluate: 要素のdata-testid属性値を取得
   mcp__playwright__browser_click: 対象要素
   mcp__playwright__browser_snapshot: 変化後の状態を確認
   mcp__playwright__browser_network_requests: API通信を確認
   ```

**確認すべき項目**:
- data-testid属性の実際の値
- 要素の表示タイミング
- API呼び出しのエンドポイントとレスポンス
- 画面遷移のURL
- ローディング状態の有無

### 1. 実装計画の策定

- `docs/e2e/design.md`、`docs/e2e/test-cases/`、`docs/e2e/progress.md`を参照
- 実装方針を計画

### 2. テストコード実装

- **Step 0で確認した情報を元に**テストコードを実装
- 実際のdata-testid、セレクタ、URL、APIエンドポイントを使用
- 確認した挙動に基づいて適切な待機処理を実装
- 必要に応じてプロダクトコードにdata-testidを追加
- テストディレクトリ配下に実装（例: `playwright-tests`、`e2e-tests`など）
- **必須**: コーディングガイドライン（`docs/coding-standard/playwright.md`など、存在する場合）に準拠

**⚠️ 重要: リトライ禁止ポリシー**

このプロジェクトでは、テストのリトライを禁止しています:

- ❌ `playwright.config.ts`での`retries`設定は**0固定**
- ❌ テスト内でのカスタムリトライロジック（`clickWithRetry`等）は禁止
- ❌ `expect.toPass()`によるリトライも原則禁止

テストが失敗した場合は、その結果をそのまま記録し、原因を分析してください。flaky testは適切な待機戦略（`waitForResponse`, `waitFor`, `toBeVisible`等）で解決してください。

**⚠️ 重要: APIテストに関するガイドライン**

E2Eテストは**ブラウザを通じたエンドユーザー視点のテスト**です。以下のルールを厳守してください:

- **禁止**: `request` fixtureを使った直接的なAPI呼び出しテスト
  ```typescript
  // ❌ 禁止例: APIを直接テストしている
  test('ユーザー作成', async ({ request }) => {
    const response = await request.post('/api/users', { data: {...} });
    expect(response.status()).toBe(201);
  });
  ```

- **正しいアプローチ**: ブラウザ操作を通じてAPIが呼ばれることを確認
  ```typescript
  // ✅ 正しい例: ブラウザ操作でAPIを間接的にテスト
  test('ユーザー作成', async ({ page }) => {
    await test.step('作成フォームを開く', async () => {
      await page.getByTestId('create-button').click();
      await expect(page.getByTestId('create-form')).toBeVisible();
    });

    await test.step('フォームに入力して保存', async () => {
      await page.getByTestId('name-input').fill('テストユーザー');
      await page.getByTestId('save-button').click();
    });

    await test.step('作成成功を確認', async () => {
      await expect(page.getByText('ユーザーを作成しました')).toBeVisible();
      await expect(page.getByText('テストユーザー')).toBeVisible();
    });
  });
  ```

- **例外: テストデータの準備・クリーンアップのみ許可**
  ```typescript
  // ✅ 許可: テストデータの事前準備
  test('ユーザー編集', async ({ page, request }) => {
    let userId: string;

    // テストデータ準備のためのAPI使用は許可
    await test.step('テスト用ユーザーを作成', async () => {
      const response = await request.post('/api/users', {
        data: { name: 'テスト用ユーザー' }
      });
      const data = await response.json();
      userId = data.id;
    });

    // ブラウザ操作によるメインテスト
    await test.step('ユーザー編集ページを開く', async () => {
      await page.goto(`/users/${userId}`);
    });

    await test.step('名前を編集', async () => {
      await page.getByTestId('name-input').fill('編集後の名前');
      await page.getByTestId('save-button').click();
      await expect(page.getByText('更新しました')).toBeVisible();
    });

    // クリーンアップのためのAPI使用は許可
    await test.step('テスト用ユーザーを削除', async () => {
      await request.delete(`/api/users/${userId}`);
    });
  });
  ```

**API呼び出しが許可される用途:**
1. テストデータの事前準備 (`beforeEach`や`test.step('テスト用データを作成')`など)
2. テスト後のクリーンアップ (`afterEach`や`finally`ブロックでの削除)
3. テスト実行に必要な状態の確認 (例: 既存データの有無チェック)

**API呼び出しが禁止される用途:**
1. 機能の動作確認 (必ずブラウザ操作で確認すること)
2. APIレスポンスの検証 (UIでの表示確認で間接的に検証)
3. CRUD操作のテスト (フォーム操作、ボタンクリックで実施)

---

**信頼性を高めるための実装パターン：**

- **複数の非同期条件を検証する場合**: `waitForResponse`と`expect`を組み合わせて待機（リトライ禁止）
  ```typescript
  // ✅ 推奨: waitForResponseとアサーションの組み合わせ
  const responsePromise = page.waitForResponse(res =>
    res.url().includes('/api/resource') && res.status() === 200
  );
  await page.click('[data-testid="refresh"]');
  await responsePromise;
  await expect(page.locator('[data-testid="data-row"]').first()).toBeVisible();

  // ❌ 禁止: expect.toPass()によるリトライ
  // await expect(async () => { ... }).toPass({ timeout: 10000 });
  ```

- **アプリケーション固有の状態を待機する場合**: ローディング状態やデータロード状態を明示的に待機
  ```typescript
  // ローディングインジケーターが消えるまで待機
  await page.locator('[data-testid="loading"]').waitFor({ state: 'hidden' });

  // データがロードされたことを確認
  await page.waitForFunction(() => {
    const rows = document.querySelectorAll('[data-testid^="data-row-"]');
    return rows.length > 0;
  });
  ```

- **API通信とUI更新の両方を待機する場合**: レスポンス待機後にUI更新も確認
  ```typescript
  const responsePromise = page.waitForResponse(res =>
    res.url().includes('/api/resource') && res.status() === 200
  );
  await page.getByTestId('submit-button').click();
  await responsePromise;
  await expect(page.getByTestId('success-message')).toBeVisible();
  ```

- **test.step()の必須利用**: 全てのテストで手順を`test.step()`で明確化（`.claude/e2e-test-common.md`参照）
  ```typescript
  test('リソース作成フロー', async ({ page }) => {
    await test.step('作成フォームを開く', async () => {
      await page.getByTestId('create-button').click();
      await expect(page.getByTestId('create-form')).toBeVisible();
    });

    await test.step('フォームに入力', async () => {
      await page.getByTestId('field-name').fill('テストリソース');
      await page.getByTestId('field-description').fill('説明文');
    });

    await test.step('保存してAPIレスポンスを確認', async () => {
      const responsePromise = page.waitForResponse(res =>
        res.url().includes('/api/resource') && res.request().method() === 'POST'
      );
      await page.getByTestId('save-button').click();
      const response = await responsePromise;
      expect(response.status()).toBe(201);
    });
  });
  ```

### 3. テスト実行と検証

- **必須**: 各テスト実装完了後にE2Eテストを実行
- **テストが失敗した場合の調査手順**:

  1. **Playwright MCPでブラウザを開いて実際の挙動を確認**
     ```
     # ブラウザを開いて対象機能のページに遷移
     mcp__playwright__browser_navigate: 失敗したテストの対象URL

     # 画面のスナップショットを取得して現在の状態を確認
     mcp__playwright__browser_snapshot

     # テストで行っている操作を手動で再現
     mcp__playwright__browser_click: 対象要素
     mcp__playwright__browser_type: 入力値

     # 操作後の状態を確認
     mcp__playwright__browser_snapshot

     # ネットワークリクエストを確認（API呼び出しの検証）
     mcp__playwright__browser_network_requests

     # コンソールエラーを確認
     mcp__playwright__browser_console_messages
     ```

  2. **調査で確認すべきポイント**:
     - セレクタが正しいか（要素が存在するか、data-testidが正しいか）
     - 要素の表示タイミング（ローディング中に操作していないか）
     - API呼び出しが成功しているか（ステータスコード、レスポンス内容）
     - 画面遷移が正しく行われているか
     - エラーメッセージが表示されていないか

  3. **問題の切り分け**:
     - **セレクタの問題**: 要素が見つからない → `browser_snapshot`で実際のdata-testidを確認
     - **タイミングの問題**: 要素が表示される前に操作 → 適切な待機処理を追加
     - **APIの問題**: リクエストが失敗 → `browser_network_requests`でステータス確認
     - **アプリケーションの問題**: 機能自体が動作しない → プロダクトコードの修正が必要

  4. **修正と再テスト**:
     - 問題箇所を特定したら、テストコードまたはプロダクトコードを修正
     - 再度テストを実行して成功することを確認
     - **動作するまで調査・修正を継続**

- 実装内容とテストケースの整合性を確認

### 4. テストコード品質検証（実装完了後に実行）

テストコード実装完了後、以下の検証を必ず実施してください。

#### 4.1 自己検証チェックリスト

実装した各テストについて以下を確認:

**構造とパターン**
- [ ] **Page Object Model**: Page Objectパターンを使用しているか
  - UI要素のセレクタがPage Objectに分離されているか
  - テストロジックとUI実装が分離されているか
  - `playwright-tests/pages/` 配下にPage Objectクラスがあるか
- [ ] **test.step()の使用**: 複雑なテストで`test.step()`を使用しているか
  - 各ステップが明確で意味のある名前を持っているか
  - ステップごとに検証が行われているか
- [ ] **test.describe()のグループ化**: 関連するテストが適切にグループ化されているか
  - グループ名が機能やカテゴリを反映しているか

**セレクタ戦略**
- [ ] **data-testidの優先使用**: `data-testid`を優先的に使用しているか
  - `page.getByTestId()` を優先的に使用
  - テキストベースのセレクタは適切な場合のみ使用
  - CSSセレクタやXPathの使用が最小限か
- [ ] **セレクタの安定性**: 実装変更に強いセレクタを使用しているか
  - 脆弱なセレクタ（`nth-child`, `index`など）を避けているか

**待機戦略**
- [ ] **適切な待機方法**: `waitForTimeout()`を使用していないか
  - `waitForSelector()`, `waitForResponse()` などの明示的な待機を使用
  - `expect().toBeVisible()` などのアサーション付き待機を使用
- [ ] **ネットワークリクエストの待機**: API呼び出しを含むアクションで`waitForResponse()`を使用しているか
  - レースコンディションを回避しているか

**E2Eテスト原則（ブラウザ vs API）**
- [ ] **ブラウザ操作優先**: 機能テストはブラウザ操作を通じて実施しているか
  - `page` fixtureを使用したブラウザ操作
  - フォーム入力、ボタンクリック、画面遷移など
- [ ] **API直接呼び出しの制限**: `request` fixtureの使用がテストデータ準備/クリーンアップのみか
  - メイン機能のテストでAPIを直接呼んでいないか
  - UI操作の検証をAPIで代替していないか

**禁止パターンのチェック:**
```typescript
// ❌ API直接テスト（禁止）
test('ユーザー作成', async ({ request }) => {
  const response = await request.post('/api/users', { data: {...} });
  expect(response.status()).toBe(201);
});

// ✅ ブラウザ操作テスト（推奨）
test('ユーザー作成', async ({ page }) => {
  await page.getByTestId('create-button').click();
  await page.getByTestId('name-input').fill('テストユーザー');
  await page.getByTestId('save-button').click();
  await expect(page.getByText('ユーザーを作成しました')).toBeVisible();
});
```

**エラーハンドリング**
- [ ] **適切なアサーション**: `expect()` を使用した明確なアサーションがあるか
  - カスタムエラーメッセージが必要な箇所で使用されているか
- [ ] **失敗時の情報**: スクリーンショット、トレース、ビデオが有効化されているか

**テストデータ管理**
- [ ] **テストデータの独立性**: 各テストが独自のテストデータを使用しているか
  - タイムスタンプやUUIDで一意性を確保しているか
- [ ] **クリーンアップ**: テスト後のデータクリーンアップが実装されているか
  - `try-finally` でクリーンアップを保証しているか

**コーディング標準準拠**
- [ ] **`docs/coding-standard/playwright.md`に準拠**: コーディング標準ドキュメント（存在する場合）のルールに従っているか

#### 4.2 自動検証（`/e2e:validate-gap`を使用）

テストコード実装完了後、以下のコマンドで準拠性を自動検証:

```bash
/e2e:validate-gap --detailed
```

このコマンドは以下を自動チェック:
- テストケース仕様との一致性
- コーディング標準準拠性（`waitForTimeout()`使用、API直接テストなど）
- Page Objectパターンの使用状況
- セレクタ戦略の適切性

#### 4.3 自動検出パターン

以下のアンチパターンを自動検出:

```bash
# waitForTimeout() の使用を検出
grep -rn "waitForTimeout" playwright-tests/tests/

# API直接テストパターンを検出（request のみでページ操作なし）
grep -rn "async ({ request })" playwright-tests/tests/

# Page Objectパターン未使用を検出（page.locator が直接テストに記述）
grep -rn "page.locator\|page.getByRole\|page.getByTestId" playwright-tests/tests/*.spec.ts

# waitForLoadState('networkidle') の使用を検出（非推奨）
grep -rn "waitForLoadState.*networkidle" playwright-tests/tests/
```

#### 4.4 検証で問題が見つかった場合

**`waitForTimeout()`を使用している場合:**
```typescript
// ❌ 禁止
await page.waitForTimeout(2000);

// ✅ 修正例1: 明示的な待機
await page.waitForResponse(res => res.url().includes('/api/data'));

// ✅ 修正例2: アサーション付き待機
await expect(page.getByTestId('data-loaded')).toBeVisible();
```

**API直接テストになっている場合:**
```typescript
// ❌ 禁止: APIを直接テスト
test('ユーザー作成', async ({ request }) => {
  const response = await request.post('/api/users', { data: {...} });
  expect(response.status()).toBe(201);
});

// ✅ 修正: ブラウザ操作でテスト
test('ユーザー作成', async ({ page }) => {
  await test.step('作成ボタンをクリック', async () => {
    await page.getByTestId('create-button').click();
  });

  await test.step('フォームに入力', async () => {
    await page.getByTestId('name-input').fill('テストユーザー');
    await page.getByTestId('save-button').click();
  });

  await test.step('作成成功を確認', async () => {
    await expect(page.getByText('ユーザーを作成しました')).toBeVisible();
  });
});
```

**Page Objectパターンを使用していない場合:**
```typescript
// ❌ テストコードに直接セレクタを記述
test('ユーザー作成', async ({ page }) => {
  await page.getByTestId('create-button').click();
  await page.getByTestId('name-input').fill('テストユーザー');
  // ...
});

// ✅ Page Objectパターンを使用
// playwright-tests/pages/UserPage.ts を作成
class UserPage {
  constructor(private page: Page) {}

  async clickCreateButton() {
    await this.page.getByTestId('create-button').click();
  }

  async fillName(name: string) {
    await this.page.getByTestId('name-input').fill(name);
  }
}

// テストコード
test('ユーザー作成', async ({ page }) => {
  const userPage = new UserPage(page);
  await userPage.clickCreateButton();
  await userPage.fillName('テストユーザー');
  // ...
});
```

**test.step()を使用していない場合:**
```typescript
// ❌ ステップが不明確
test('ユーザー作成フロー', async ({ page }) => {
  await page.getByTestId('create-button').click();
  await page.getByTestId('name-input').fill('テストユーザー');
  await page.getByTestId('save-button').click();
  await expect(page.getByText('作成しました')).toBeVisible();
});

// ✅ test.step()で明確化
test('ユーザー作成フロー', async ({ page }) => {
  await test.step('作成フォームを開く', async () => {
    await page.getByTestId('create-button').click();
    await expect(page.getByTestId('create-form')).toBeVisible();
  });

  await test.step('フォームに入力', async () => {
    await page.getByTestId('name-input').fill('テストユーザー');
  });

  await test.step('保存して成功確認', async () => {
    await page.getByTestId('save-button').click();
    await expect(page.getByText('作成しました')).toBeVisible();
  });
});
```

#### 4.5 検証完了の確認

全てのチェック項目が✅になり、自動検証で違反が0件になったら、テストコード実装が完了です。

### 5. 進捗状況の更新

- 品質検証完了後、実装状況と実行結果に基づき`docs/e2e/progress.md`を更新
- 更新フォーマットは`.claude/e2e-test-common.md`の「進捗管理フォーマット」を参照

## 完了条件

- [ ] 追加実装がない、または未実装部分をリストアップ済み
- [ ] 全テストが実行成功
- [ ] **品質検証チェックリストが全て✅**
- [ ] **自動検証（`/e2e:validate-gap --detailed`）で違反が0件**
- [ ] `docs/e2e/progress.md`が最新状態

**未完了の場合**: 「完了していません」と明示的に返答すること
