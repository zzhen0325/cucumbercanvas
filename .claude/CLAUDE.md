# Cucumber Studio Agent Manual
AI 原生无限画布，画布不是先存在的空白空间，而是 AI Agent 执行过程的可视化产物；

## 核心设计理念

Agent 优先：所有内容由 Agent 生成，用户仅提供目标和反馈
容器即输出：每个 Agent 的执行结果都以独立容器的形式呈现在画布上
空间即上下文：容器的位置、大小、连接关系天然表达了 Agent 的思考逻辑和数据流动


## 核心参考
项目中有openpencil项目，画布和agent的实现可以参考openpencil的实现。如果有类似实现，可以直接参考openpencil的实现。如果 openpencil 项目没有实现某个功能，也可以根据 openpencil 项目的实现进行修改。


## 核心要求
- 代码旨在为高效生产和高质量要求而不是MVP搭建DEMO完成，完成功能要考虑产品特性和整体交互，阅读以及撰写时思维需要有大局观，以第一性原理直击痛点。
- 在相关代码加入对应日志便于后续线上或本地排查，以及TODO或相关备注 为后续他人接手提供更好的桥梁。赠人玫瑰手留余香。

# langchain框架使用指南

关于langchain，langgraph，deepagents相关开发查看官方llm.txt 作为索引 看对应网址文档 获取最佳实践，https://docs.langchain.com/llms.txt

对于其他框架包括nextjs,excalidraw等不理解或者不熟悉的地方 一定要 先去看文档或者源码再开始！ 确保先获取信息上下文再开干，不然容易导致返工。