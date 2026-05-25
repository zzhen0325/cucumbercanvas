---
description: Initialize E2E test environment with project-specific adaptation
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, AskUserQuestion, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_close
---

# E2E Test Environment Initialization

E2Eテスト環境の初期セットアップを行います。プロジェクト構造を分析し、適応した設定を生成します。

## 使用方法

```bash
/e2e:init
```

## 実行内容

### Phase 1: プロジェクト分析

プロジェクトのルートディレクトリを探索し、以下の情報を特定してください。

#### 1.1 特定すべき情報

- **プロジェクトタイプ**: モノレポ（apps/packages構成） / frontend-backend分離 / シングルパッケージ
- **フレームワーク**: Next.js / React / Vue / Express など
- **ディレクトリ構造**: フロントエンドコードの配置場所
- **パッケージマネージャ**: pnpm / npm / yarn（lockfile で判定）
- **開発サーバーコマンド**: `dev` スクリプトの内容
- **開発サーバーポート**: 設定ファイルまたはデフォルト値から推測

#### 1.2 認証の有無を判定

以下の観点でプロジェクトを分析し、認証が必要かどうかを判定：

**認証が必要と判定する条件**（いずれかに該当）:
- ログインページ（login, signin, auth等）が存在する
- 認証プロバイダ（NextAuth, Auth0, Firebase Auth, Supabase Auth等）がインストールされている
- セッション/トークン管理のコードが存在する

**認証が不要と判定する条件**:
- 上記のいずれも検出されない
- パブリックなアプリケーション（TODO、ブログ、ポートフォリオ等）

### Phase 1.5: ユーザー確認（必須）

**重要**: Phase 1 の分析結果を**すべて**ユーザーに提示し、確認を求めてください。

#### 確認内容

以下の形式で分析結果を表示：

```markdown
## プロジェクト分析結果

以下の設定でE2E環境を初期化します。内容を確認してください。

### 基本設定

| 項目 | 検出結果 | 説明 |
|------|----------|------|
| プロジェクトタイプ | {モノレポ / frontend-backend分離 / シングルパッケージ} | プロジェクト構造 |
| フレームワーク | {Next.js / React / Vue / Express など} | 検出されたフレームワーク |
| パッケージマネージャ | {pnpm / npm / yarn} | lockfileから判定 |

### サーバー設定

| 項目 | 検出結果 | 説明 |
|------|----------|------|
| 開発サーバーURL | http://localhost:{ポート} | テスト対象のベースURL |
| 開発サーバー起動コマンド | {検出したコマンド} | `npm run dev` など |
| ビルド＆起動コマンド | {検出したコマンド} | `npm run build && npm start` など |

### テスト設定

| 項目 | 検出結果 | 説明 |
|------|----------|------|
| テストディレクトリ | playwright-tests/ | E2Eテストコードの配置先 |
| ドキュメントディレクトリ | docs/e2e/ | E2Eドキュメントの配置先 |

### 認証設定

| 項目 | 検出結果 | 説明 |
|------|----------|------|
| 認証が必要 | {はい / いいえ} | テスト実行に認証が必要か |

#### 認証判定の根拠
{認証が必要と判定した場合}
- 検出された認証関連要素:
  - {ログインページのパス}
  - {認証プロバイダ名}
  - {セッション管理コードの場所}

{認証が不要と判定した場合}
- 認証関連の要素は検出されませんでした
```

#### 確認の求め方

分析結果を表示した後、ユーザーに確認を求める：

**質問**: 「上記の設定内容で問題ありませんか？修正が必要な項目があれば教えてください。」

ユーザーが修正を指示した場合は、その内容を反映して Phase 2 に進む。

#### 想定される修正例

- 「ポートは3001に変更してください」
- 「認証は不要です」
- 「認証が必要です。ログインページは /api/auth/signin です」
- 「パッケージマネージャは yarn です」
- 「開発サーバーコマンドは `pnpm dev:web` です」
- 「テストディレクトリは `e2e/` にしてください」

#### ユーザー回答に基づく処理

1. **「問題ありません」「OK」「はい」等の承認**
   - 分析結果に基づいて Phase 2 に進む

2. **修正指示があった場合**
   - 指示された内容を反映
   - 修正後の設定を再度表示して確認
   - 承認を得てから Phase 2 に進む

**注意**: ユーザー確認なしに Phase 2 に進まないでください。

### Phase 2: 設定ファイルの生成・更新

Phase 1 で検出した情報に基づいて設定ファイルを生成・更新します。

#### 2.1 e2e-config.md の生成

`.claude/e2e-config.md` を生成または更新。

**認証が必要な場合**:

```markdown
# E2E Test Configuration

## プロジェクト設定

| 設定項目 | 値 | 説明 |
|---------|-----|------|
| 開発サーバーURL | http://localhost:{ポート} | 開発サーバーのURL |
| テストディレクトリ | playwright-tests/ | E2Eテストコードの配置先 |
| ドキュメントディレクトリ | docs/e2e/ | E2Eテストドキュメントの配置先 |
| 開発サーバー起動コマンド | {検出したコマンド} | 開発サーバー起動コマンド |
| ビルド＆起動コマンド | {検出したコマンド} | プロダクションビルド＆サーバー起動 |

## 認証設定

| 設定項目 | 値 | 説明 |
|---------|-----|------|
| 認証が必要 | true | テスト実行に認証が必要 |
| 認証ドキュメント | `.auth.md` | 認証手順の詳細ドキュメント |
| 認証更新コマンド | {パッケージマネージャ} refresh-auth | 認証トークン更新コマンド |
| 認証状態保存先 | `playwright-tests/.auth/user.json` | Playwright認証状態ファイル |
```

**認証が不要な場合**:

```markdown
# E2E Test Configuration

## プロジェクト設定

| 設定項目 | 値 | 説明 |
|---------|-----|------|
| 開発サーバーURL | http://localhost:{ポート} | 開発サーバーのURL |
| テストディレクトリ | playwright-tests/ | E2Eテストコードの配置先 |
| ドキュメントディレクトリ | docs/e2e/ | E2Eテストドキュメントの配置先 |
| 認証が必要 | false | このアプリは認証不要 |
| 開発サーバー起動コマンド | {検出したコマンド} | 開発サーバー起動コマンド |
| ビルド＆起動コマンド | {検出したコマンド} | プロダクションビルド＆サーバー起動 |
```

**重要**: 認証が不要な場合、認証設定セクションは記載しない。

#### 2.2 playwright.config.ts の生成・調整

検出した情報に基づいてカスタマイズ：

- `testDir`: プロジェクト構造に合わせたパス
- `baseURL`: 検出したポート
- `webServer.command`: 検出した開発サーバーコマンド

**認証が必要な場合のみ**、`playwright.config.ts` に以下を追加：
- `use.storageState`: `'./playwright-tests/.auth/user.json'`

```typescript
// 認証が必要な場合、use セクションに追加
use: {
  baseURL: 'http://localhost:{port}',
  trace: 'on-first-retry',
  screenshot: 'only-on-failure',
  // 認証状態を使用
  storageState: './playwright-tests/.auth/user.json',
},
```

**認証が不要な場合**:
- `storageState` は設定しない（既存のまま）

#### 2.3 認証関連ファイルの生成（認証が必要な場合のみ）

**認証が必要な場合**、以下のファイルを生成：

##### .auth.md（プロジェクトルート）

認証手順ドキュメントを生成。以下の内容を含む：
- 認証情報（ログインURL、テストユーザー）
- 手動認証手順
- Playwright MCP での認証手順
- 認証状態の保存方法
- 認証エラー時の対処
- セキュリティ注意事項

##### playwright-tests/global-setup.ts

認証状態ファイルの存在確認を行うグローバルセットアップ：

```typescript
import { chromium, FullConfig } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

async function globalSetup(config: FullConfig) {
  const authFile = path.join(__dirname, '.auth', 'user.json');

  // Check if auth file exists
  if (!fs.existsSync(authFile)) {
    console.log('⚠️  Authentication file not found. Creating empty auth state...');
    const authDir = path.dirname(authFile);
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }
    fs.writeFileSync(authFile, JSON.stringify({
      cookies: [],
      origins: []
    }));
    console.log('📝 Please run your auth refresh command to set up authentication.');
    return;
  }

  console.log('✅ Authentication file found.');
}

export default globalSetup;
```

**認証が不要な場合**:
- `.auth.md` が存在する場合は削除を提案
- `global-setup.ts` はシンプルなプレースホルダーのまま
- 新規ファイルを作成しない

### Phase 3: ディレクトリ・ファイル作成

#### 3.1 ディレクトリ構造の作成

```bash
mkdir -p playwright-tests/tests
mkdir -p playwright-tests/pages
mkdir -p playwright-tests/fixtures
mkdir -p playwright-tests/utils
mkdir -p docs/e2e/test-cases
mkdir -p docs/e2e/histories
```

**認証が必要な場合のみ**:
```bash
mkdir -p playwright-tests/.auth
```

#### 3.2 基本ファイルの作成

存在しない場合のみ作成：

| ファイル | 目的 | 条件 |
|---------|------|------|
| `docs/e2e/README.md` | E2Eテスト概要 | 常に |
| `docs/e2e/design.md` | テスト設計書 | 常に |
| `docs/e2e/progress.md` | 進捗管理（最新結果のみ） | 常に |
| `docs/e2e/risk-assessment.md` | リスク評価 | 常に |
| `docs/e2e/quality-checklist.md` | 品質チェックリスト | 常に |
| `docs/e2e/test-cases/index.md` | テストケース索引 | 常に |
| `docs/e2e/histories/README.md` | 実行履歴ディレクトリ説明 | 常に |
| `playwright-tests/global-setup.ts` | グローバルセットアップ | 認証が必要な場合のみ |

### Phase 3.5: CLAUDE.md への追記

プロジェクトルートに `CLAUDE.md` が存在する場合、E2E テスト関連のセクションを追記します。

#### 追記内容

既存の `CLAUDE.md` の末尾に以下のセクションを追加：

```markdown
### E2E Test Documentation Structure

E2E test documentation is organized in `docs/e2e/` directory:

- **`docs/e2e/README.md`**: E2E Test Overview
- **`docs/e2e/test-cases/`**: Test Case Specifications
- **`docs/e2e/design.md`**: Test Strategy and Architecture
- **`docs/e2e/progress.md`**: Implementation Status and Latest Test Results
- **`docs/e2e/histories/`**: Test Execution History (timestamped files)
- **`docs/e2e/risk-assessment.md`**: Risk-Based Test Design
- **`docs/e2e/quality-checklist.md`**: Test Case Quality Standards

**Important**: `progress.md` contains only the latest results. Historical execution records are stored in `docs/e2e/histories/` with `YYYY-MM-DD_HHmmss.md` naming convention.

**E2E Test Commands**:

- `/e2e:case-generate` - Generate test design and test cases
- `/e2e:code-generate` - Implement E2E test code
- `/e2e:qg-case` - Quality gate for test cases
- `/e2e:qg-code` - Quality gate for test code
- `/e2e:steering` - Run E2E tests and update progress

📖 Common rules for E2E testing are defined in `.claude/e2e-test-common.md`.
```

**認証が必要な場合**、以下も追加：

```markdown
### Browser Testing Procedure

When conducting browser tests with Claude Code, follow the authentication procedure defined in `.auth.md`.

**認証エラー発生時の対処**:
- 401エラー、authエラー、認証トークンの有効期限切れが発生した場合:
  ```bash
  {パッケージマネージャ} refresh-auth
  ```
- 詳細は`.auth.md`を参照してください
```

#### 追記の条件

- `CLAUDE.md` が存在する場合のみ追記
- 既に E2E セクションが存在する場合は追記しない（重複防止）
- E2E セクションの存在は `### E2E Test` で始まる行があるかで判定

### Phase 4: Page Object ベースの作成

プロジェクトのページ構造を分析し、検出したページごとに基本的な Page Object クラスを生成：

```typescript
// playwright-tests/pages/ExamplePage.ts
import { Page } from '@playwright/test';

export class ExamplePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/example');
  }
}
```

**生成するPage Object:**
- 検出した主要ページごとに1ファイル
- 基本的な `goto()` メソッドのみ
- 詳細なロケータは `/e2e:code-generate` で追加

### Phase 5: 依存関係のインストール

Playwrightがインストールされていない場合はインストール：

```bash
{パッケージマネージャ} add -D @playwright/test
npx playwright install chromium
```

### Phase 6: 動作確認

1. ユーザーに開発サーバーの起動を依頼
2. Playwright MCPで接続テスト（`browser_navigate` → `browser_snapshot` → `browser_close`）

## 出力サマリー

初期化完了後、検出結果と生成ファイルのサマリーを表示：

**認証が必要な場合**:

```markdown
## E2E環境初期化完了

### 検出されたプロジェクト情報
- プロジェクトタイプ: {検出結果}
- フレームワーク: {検出結果}
- パッケージマネージャ: {検出結果}
- 認証: 必要

### 生成・更新されたファイル
- .claude/e2e-config.md
- playwright.config.ts
- .auth.md
- playwright-tests/global-setup.ts
- playwright-tests/pages/*.ts
- CLAUDE.md（E2Eセクション追記）

### 次のステップ
1. `.claude/e2e-config.md` を確認・調整
2. `.auth.md` の認証手順を設定
3. `/e2e:case-generate` でテストケースを生成
```

**認証が不要な場合**:

```markdown
## E2E環境初期化完了

### 検出されたプロジェクト情報
- プロジェクトタイプ: {検出結果}
- フレームワーク: {検出結果}
- パッケージマネージャ: {検出結果}
- 認証: 不要

### 生成・更新されたファイル
- .claude/e2e-config.md
- playwright.config.ts
- playwright-tests/pages/*.ts
- CLAUDE.md（E2Eセクション追記）

### 次のステップ
1. `.claude/e2e-config.md` を確認・調整
2. `/e2e:case-generate` でテストケースを生成
```

## 注意事項

- 既存ファイルは上書きしません（確認を求めます）
- 認証が不要な場合、認証関連のファイル・設定は生成しません
- Page Object は基本構造のみ生成（詳細は後続コマンドで追加）
