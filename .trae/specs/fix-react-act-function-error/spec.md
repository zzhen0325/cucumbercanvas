# React.act 报错修复 Spec

## Why
`apps/web` 的全量 Vitest 测试目前被 React 19 与 Testing Library 的 `act()` 兼容性问题阻塞，已在项目进度记录中被标记为存量失败项。需要为测试运行时补齐一致的 React `act` 接入方式，恢复现有 Web 测试套件的可执行性。

## What Changes
- 为 `apps/web` 的测试环境定义统一的 React 19 `act` 兼容层，避免运行时依赖不存在的 `React.act`
- 收敛受影响测试中的 `act` 导入和使用方式，统一到仓库允许的测试入口
- 为该兼容修复补充回归验证，确保全量 Web 测试不再因同类错误中断

## Impact
- Affected specs: Web 测试基础设施, 前端单元测试稳定性
- Affected code: `apps/web/vitest.config.ts`, `apps/web/test/**`, 可能受影响的测试公共初始化文件

## ADDED Requirements
### Requirement: Web 测试环境提供 React 19 act 兼容能力
系统 SHALL 在 `apps/web` 的 Vitest/jsdom 测试启动阶段注入统一的 `act` 运行时兼容能力，使 Testing Library 和测试文件不会访问不存在的 `React.act` 实现。

#### Scenario: 全量测试启动时加载兼容层
- **WHEN** 开发者执行 `pnpm --filter @cucumber/web test`
- **THEN** `apps/web` 的测试环境会先加载统一的测试初始化逻辑
- **THEN** 测试运行时不会再抛出 `React.act is not a function`

#### Scenario: 测试文件复用统一 act 来源
- **WHEN** 某个 Web 测试需要包裹状态更新或异步渲染
- **THEN** 该测试使用项目约定的 `act` 来源
- **THEN** 不需要在各测试文件中临时拼接私有兼容代码

## MODIFIED Requirements
### Requirement: Web 测试命令可作为有效回归信号
系统 SHALL 让 `apps/web` 的 Vitest 测试命令在现有用例集上可稳定执行，并把 React 19 `act` 兼容问题从已知阻塞项中移除。

#### Scenario: 运行 Web 测试回归
- **WHEN** 开发者运行 `pnpm --filter @cucumber/web test`
- **THEN** 测试失败若存在，应指向真实断言或业务问题
- **THEN** 不应再被统一的 `React.act is not a function` 初始化错误拦截
