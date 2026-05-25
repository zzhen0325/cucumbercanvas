# E2E Test Common Rules

このドキュメントはE2Eテストコマンド群で共有される共通ルールと参照ドキュメントを定義します。

## 参照ドキュメント

📖 **プロジェクト固有の設定は `.claude/e2e-config.md` を参照してください。**

### コマンド一覧

| コマンド | 説明 |
|---------|------|
| `/e2e:init` | E2E環境の初期セットアップ |
| `/e2e:generate` | 全工程を順次実行 |
| `/e2e:validate-gap-case` | 実装済み機能に対するテストケースの不足を分析 |
| `/e2e:validate-gap-code` | テストケースに対するテストコードの不足を分析 |
| `/e2e:case-generate` | テスト設計とテストケースを生成 |
| `/e2e:code-generate` | テストコードを実装 |
| `/e2e:qg-case` | テストケースの品質検査 |
| `/e2e:qg-code` | テストコードの品質検査 |
| `/e2e:steering` | テスト実行と進捗更新 |

## 共通ルール

### 1. 冪等性の確保

- テストケースはデータベース状態に依存しないこと
- テスト実行前後でシステム状態が変わらないこと
- テストデータは各テストで作成・削除すること

### 2. 実装優先確認

コード生成前に必ず以下を確認:
- 既存の実装パターンを確認
- 類似機能のテストコードを参照
- Page Objectの再利用を検討

### 3. アーキテクチャ準拠

- Page Object Model (POM) パターンを使用
- テストコードとセレクタを分離
- 共通処理はユーティリティに抽出

### 4. test.step() の必須利用

全てのテストで `test.step()` を使用して手順を明確化:

```typescript
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

## 進捗管理フォーマット

`docs/e2e/progress.md` で使用するテーブル形式:

| Test ID | テスト名 | 目的 | 実装ステータス | テスト結果 |
|---------|---------|------|--------------|-----------|
| CRUD-001 | 新規作成 | 新規データ作成機能のテスト | ✅ 完了 | ✅ PASS |
| CRUD-002 | 編集 | データ編集機能のテスト | ⏳ 実装中 | - |
| CRUD-003 | 削除 | データ削除機能のテスト | 📝 未実装 | - |

### 実装ステータス

- ✅ 完了: テストコード実装済み
- ⏳ 実装中: 作業中
- 📝 未実装: 未着手
- ⏸️ スキップ: 意図的にスキップ

### テスト結果

- ✅ PASS: テスト成功
- ❌ FAIL: テスト失敗
- ⏭️ SKIP: スキップ
- -: 未実行

## テストケースID命名規則

- カテゴリ接頭辞 + 連番（3桁）
- 例: `CRUD-001`, `AUTO-TEXT-001`, `SEARCH-001`

### カテゴリ接頭辞

| 接頭辞 | カテゴリ |
|--------|---------|
| CRUD | 作成・読取・更新・削除 |
| AUTO-TEXT | テキスト自動保存 |
| AUTO-DATE | 日付自動保存 |
| AUTO-SELECT | 選択フィールド自動保存 |
| SEARCH | 検索機能 |
| FILTER | フィルタ機能 |
| BULK | 一括操作 |
| NAV | ナビゲーション |
| AUTH | 認証 |
| CSV | CSV操作 |
| URL | URL連携 |
| KEY | キーボード操作 |

## 優先度定義

| 優先度 | 説明 | タグ |
|--------|------|------|
| P0 | ビジネスクリティカル | `@critical`, `@smoke` |
| P1 | 重要機能 | `@smoke`, `@regression` |
| P2 | 標準機能 | `@regression` |
| P3 | エッジケース | `@optional` |
| P4 | 低優先度 | `@optional` |
