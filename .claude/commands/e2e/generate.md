---
description: Full E2E generation - gap analysis, case/code generation, quality gates, and test execution
allowed-tools: Bash, Glob, Grep, Read, Write, Edit, WebSearch, WebFetch, mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_close, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_type, mcp__playwright__browser_network_requests
---

# E2E Generate

新規機能開発時のE2Eテスト作成から実行までの全工程を順次実行します。

📖 **共通ルールと参照ドキュメントは `.claude/e2e-test-common.md` を参照してください。**
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

**ディレクトリが存在する場合のみ、以降の処理に進んでください。**

## 使用方法

```bash
# 全工程を順次実行
/e2e:generate

# 特定機能に対して実行
/e2e:generate [機能名や説明]
```

## 処理概要

```
┌─────────────────────────────────────────────────────────────┐
│                      E2E Generate                           │
├─────────────────────────────────────────────────────────────┤
│  Step 1:   /e2e:validate-gap-case  → 不足テストケースを特定 │
│      ↓                                                      │
│  Step 1.5: [ユーザー確認]          → 対象機能を選択         │
│      ↓                                                      │
│  Step 2:   /e2e:case-generate      → テストケース生成       │
│      ↓                                                      │
│  Step 3:   /e2e:qg-case            → テストケースの品質検査 │
│      ↓ (PASS時のみ続行)                                     │
│  Step 4:   /e2e:code-generate      → テストコード生成       │
│      ↓                                                      │
│  Step 5:   /e2e:qg-code            → テストコードの品質検査 │
│      ↓ (PASS時のみ続行)                                     │
│  Step 6:   /e2e:steering           → テスト実行・進捗更新   │
└─────────────────────────────────────────────────────────────┘
```

## 実行手順

### Step 1: ギャップ分析（validate-gap-case）

実装済み機能に対するテストケースの不足を分析します。

**実行内容**:
- UIコンポーネント、APIエンドポイント、仕様書から機能を抽出
- 既存テストケースとの照合
- 不足しているテストケースの特定とリスク評価

**出力**:
- `docs/e2e/feature-coverage-report.md`

**次のステップへの条件**: 不足テストケースが特定された場合は Step 1.5 へ、なければ Step 4 へスキップ

---

### Step 1.5: 対象機能の選択（ユーザー確認）

ギャップ分析の結果を元に、どの機能のテストケースを作成するかをユーザーに確認します。

---

### Step 2: テストケース生成（case-generate）

選択された機能のテストケースを生成します。

---

### Step 3: テストケース品質検査（qg-case）

生成されたテストケースの品質を検証します。

**判定**:
- ✅ PASSED → Step 4 へ
- ❌ FAILED → 問題箇所を修正し、Step 3 を再実行

---

### Step 4: テストコード生成（code-generate）

テストケースに基づいてテストコードを生成します。

---

### Step 5: テストコード品質検査（qg-code）

生成されたテストコードの品質を検証します。

**判定**:
- ✅ PASSED → Step 6 へ
- ❌ FAILED → 問題箇所を修正し、Step 5 を再実行

---

### Step 6: テスト実行・進捗更新（steering）

テストを実行し、結果を記録します。

**テスト失敗時**:
- 原因分析を記録
- Step 4 に戻ってコード修正

---

## 中断・再開

品質検査で不合格の場合、ワークフローは中断されます。

**中断時の対応**:
1. 問題箇所を手動で修正
2. 該当する品質検査コマンドを再実行（`/e2e:qg-case` or `/e2e:qg-code`）
3. ワークフローを再開

## 注意事項

- 各ステップは前のステップの成功を前提としています
- 品質検査（qg-case, qg-code）で不合格の場合は自動的に中断します
- テスト失敗時は原因分析を記録し、修正フローに移行します
