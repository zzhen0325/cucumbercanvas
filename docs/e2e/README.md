# E2Eテスト

## 概要

このディレクトリには、プロジェクトのE2Eテストに関するドキュメントが含まれています。

## ドキュメント構成

- `design.md` - テスト設計書（戦略、アーキテクチャ）
- `progress.md` - 実装状況とテスト結果
- `risk-assessment.md` - リスク評価と優先度
- `quality-checklist.md` - 品質基準
- `test-cases/` - テストケース仕様

## テスト実行

```bash
# 全テスト実行
npx playwright test

# 特定のテスト実行
npx playwright test --grep "CRUD"

# UIモードで実行
npx playwright test --ui
```

## 関連コマンド

- `/e2e:generate` - 全工程実行
- `/e2e:case-generate` - テストケース生成
- `/e2e:code-generate` - テストコード生成
- `/e2e:steering` - テスト実行・進捗更新
