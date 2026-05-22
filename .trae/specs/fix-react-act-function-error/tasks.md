# Tasks
- [x] Task 1: 盘点 `apps/web` 中触发 `React.act is not a function` 的测试入口与公共配置，明确是 Vitest 初始化缺失、Testing Library 版本适配，还是测试文件导入方式不一致导致。
- [x] Task 2: 在 `apps/web` 建立统一的测试初始化方案，为 React 19 提供稳定的 `act` 兼容能力，并接入 `vitest.config.ts`。
- [x] Task 3: 收敛受影响测试文件的 `act` 使用方式，移除分散的临时写法，统一到项目约定的测试入口或导入模式。
- [x] Task 4: 运行针对性测试与 `pnpm --filter @cucumber/web test` 回归，确认不再出现 `React.act is not a function`，并记录任何剩余的非本问题失败项。
- [x] Task 5: 修复 `apps/web/test/setup.ts` 中对 `process.env.NODE_ENV` 的只读赋值，确保 `pnpm --filter @cucumber/web typecheck` 通过且不引入新的测试初始化副作用。

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 2
- Task 4 depends on Task 2
- Task 4 should include Task 3 results if测试文件存在需要收敛的导入调整
- Task 5 depends on Task 2
