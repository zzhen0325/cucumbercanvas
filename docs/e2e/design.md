# E2Eテスト設計書

## テスト戦略

### 目的
- ユーザー視点でのシステム動作検証
- 回帰テストによる品質維持
- CI/CDパイプラインでの自動検証

### スコープ
- 主要なユーザーフロー
- CRUD操作
- 認証・認可
- エラーハンドリング

## アーキテクチャ

### Page Object Model (POM)
- `playwright-tests/pages/` にページクラスを配置
- UIの変更に強い構造

### ファイル構成
```
playwright-tests/
├── tests/           # テストスペック
├── pages/           # Page Objectクラス
├── fixtures/        # テストフィクスチャ
├── utils/           # ユーティリティ
└── .auth/           # 認証情報（認証が必要な場合のみ）
```

## 待機戦略

- `waitForURL()` - ページ遷移待機
- `waitForResponse()` - API応答待機
- `expect().toBeVisible()` - 要素表示待機
- **禁止**: `waitForTimeout()` は使用しない

## セレクタ戦略

優先順位:
1. `getByRole()` - アクセシビリティロール
2. `getByTestId()` - data-testid属性
3. `getByText()` - テキスト内容
4. `locator()` - CSSセレクタ（最終手段）
