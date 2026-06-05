export type AgentRunControlState = {
  activeRunId?: string;
  canceling?: boolean;
  pausing?: boolean;
  streaming: boolean;
};
