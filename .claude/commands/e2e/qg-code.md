---
description: Quality Gate for test code - Validate against coding standards
allowed-tools: Bash, Glob, Grep, Read, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_close, mcp__playwright__browser_evaluate
---

# E2E Test Code Quality Gate

テストコードが`docs/coding-standard/playwright.md`のルールに則っているかを検証します。

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

**ディレクトリが存在する場合のみ、以降のタスクに進んでください。**

## 目的

テストコード（`playwright-tests/tests/*.spec.ts`）の品質を検証し、合格/不合格を判定します。

## タスク

### 0. 【推奨】ブラウザでセレクタと挙動を検証

テストコードのセレクタが実際の画面要素と一致しているかを確認します。

1. **開発サーバーの起動確認**
   - 開発サーバーが起動していない場合は、ユーザーに起動を依頼

2. **実際の画面でセレクタを確認**
   ```
   mcp__playwright__browser_navigate: {開発サーバーURL}
   mcp__playwright__browser_snapshot: 画面要素を確認
   mcp__playwright__browser_evaluate: document.querySelectorAll('[data-testid]')でdata-testid一覧を取得
   ```

3. **テストコードとの照合**
   - テストコードで使用しているdata-testidが実際に存在するか
   - セレクタが正しい要素を指しているか
   - 待機処理が適切か（要素の表示タイミングを確認）

### 1. テストコードファイルの検証

```bash
# テストコードファイルの一覧
ls playwright-tests/tests/*.spec.ts
```

### 2. 禁止パターン検出

```bash
# waitForTimeout() の使用（禁止）
grep -rn "waitForTimeout" playwright-tests/tests/

# expect.toPass() の使用（リトライ禁止）
grep -rn "\.toPass(" playwright-tests/tests/

# API直接テスト（禁止）- データ準備以外での request 使用
grep -rn "async ({ request })" playwright-tests/tests/

# networkidle の使用（非推奨）
grep -rn "networkidle" playwright-tests/tests/

# retries 設定が0以外（禁止）
grep -rn "retries:" playwright-tests/ | grep -v "retries: 0"

# カスタムリトライロジック（禁止）
grep -rn "Retry\|retry\|maxRetries" playwright-tests/tests/
```

### 3. playwright.config.ts の検証

```bash
# retries設定の確認（0であること）
grep -n "retries" playwright-tests/playwright.config.ts

# trace設定の確認
grep -n "trace" playwright-tests/playwright.config.ts
```

### 4. 推奨パターン確認

```bash
# Page Objectの使用確認
ls playwright-tests/pages/*.ts 2>/dev/null || echo "Page Objectなし"

# test.step() の使用確認
grep -rn "test.step(" playwright-tests/tests/

# data-testid の使用確認
grep -rn "getByTestId" playwright-tests/tests/

# waitForResponse の使用確認
grep -rn "waitForResponse" playwright-tests/tests/
```

### 5. 品質ゲート判定

#### 不合格条件（1つでも該当すれば不合格）

| 不合格条件 |
|-----------|
| `waitForTimeout()` の使用 |
| `expect.toPass()` の使用 |
| `retries` が0以外 |
| API直接テスト（データ準備以外での `request` 使用） |
| カスタムリトライロジックの使用 |

#### 警告条件（合格だが改善推奨）

| 警告条件 |
|---------|
| Page Objectパターン未使用 |
| `test.step()` 未使用（複雑なテスト） |
| `networkidle` の使用 |
| `data-testid` / `getByTestId` の使用が少ない |

## 出力フォーマット

```markdown
# 🔍 E2E Test Code Quality Gate Report

**実行日時**: YYYY-MM-DD HH:mm:ss

## 判定結果

┌─────────────────────────────────────┐
│  ✅ PASSED  /  ❌ FAILED            │
└─────────────────────────────────────┘

---

## サマリー

- 検証ファイル数: X件
- 合格: Y件
- 不合格: Z件
- 警告: W件

---

## ❌ 不合格項目

| ファイル | 違反内容 | 行番号 | コード |
|---------|---------|--------|-------|
| user-crud.spec.ts | waitForTimeout使用 | 45 | `await page.waitForTimeout(1000)` |
| tag.spec.ts | expect.toPass使用 | 120 | `await expect(...).toPass()` |
| filter.spec.ts | retries設定 | 5 | `retries: 2` |

---

## ⚠️ 警告項目

| ファイル | 警告内容 | 推奨対応 |
|---------|---------|---------|
| filter.spec.ts | Page Object未使用 | FilterPageを作成 |
| search.spec.ts | networkidle使用 | waitForResponseに変更 |

---

## ⚙️ playwright.config.ts 検証

| 設定項目 | 現在値 | 期待値 | 状態 |
|---------|-------|-------|------|
| retries | 0 | 0 | ✅ |
| trace | 'on' | 'on' | ✅ |

---

## 💡 修正が必要な項目

### 即時対応（不合格項目）

1. `playwright-tests/tests/user-crud.spec.ts:45`
   - `waitForTimeout(1000)` を削除
   - 代わりに `waitForResponse()` または `expect().toBeVisible()` を使用

2. `playwright-tests/tests/tag.spec.ts:120`
   - `expect.toPass()` を削除
   - 代わりに適切な待機戦略を使用

### 改善推奨（警告項目）

1. `playwright-tests/tests/filter.spec.ts`
   - FilterPage クラスを作成してセレクタを分離

---

## 🎯 次のアクション

```bash
# 違反を修正後、再度検証
/e2e:qg-code

# テスト実行
/e2e:steering
```
```

## 実行例

```bash
# コマンド実行
/e2e:qg-code

# 出力例（合格の場合）
🔍 E2E Test Code Quality Gate を実行します...

📝 コーディング標準準拠性検証中...
  ✅ user-crud.spec.ts - 違反なし
  ✅ user-search.spec.ts - 違反なし
  ✅ auto-save.spec.ts - 違反なし
  ⚠️ filter.spec.ts - 警告1件（Page Object未使用）
  ... (全12ファイル)

⚙️ playwright.config.ts 検証中...
  ✅ retries: 0
  ✅ trace: 'on'

┌─────────────────────────────────────┐
│            ✅ PASSED                │
│                                     │
│  テストコード: 12/12 合格           │
│  警告: 3件（改善推奨）              │
└─────────────────────────────────────┘

# 出力例（不合格の場合）
🔍 E2E Test Code Quality Gate を実行します...

📝 コーディング標準準拠性検証中...
  ❌ user-crud.spec.ts - waitForTimeout使用 (line 45)
  ❌ tag.spec.ts - expect.toPass使用 (line 120)
  ⚠️ filter.spec.ts - 警告1件
  ...

⚙️ playwright.config.ts 検証中...
  ✅ retries: 0
  ✅ trace: 'on'

┌─────────────────────────────────────┐
│            ❌ FAILED                │
│                                     │
│  テストコード: 10/12 合格           │
│  不合格: 2件（修正必須）            │
│  警告: 3件（改善推奨）              │
└─────────────────────────────────────┘

❌ 不合格項目:
1. playwright-tests/tests/user-crud.spec.ts:45 - waitForTimeout使用
2. playwright-tests/tests/tag.spec.ts:120 - expect.toPass使用

修正後、再度 /e2e:qg-code を実行してください。
```

## 注意事項

- このコマンドは静的検証のみ（テスト実行は行いません）
- 不合格の場合、`/e2e:steering`の前に修正を推奨
- 警告項目は合格扱いだが、改善を推奨
