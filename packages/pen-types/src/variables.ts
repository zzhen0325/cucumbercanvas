export interface VariableDefinition {
  type: "color" | "number" | "boolean" | "string";
  value: VariableValue;
  /** External source metadata for imported design-tool variables. */
  source?: string;
  /** Original design-tool variable id, e.g. Figma VariableID. */
  id?: string;
  /** Human-readable imported token name when available. */
  name?: string;
  /** Original binding/property path that referenced this variable. */
  property?: string;
  /** True when the importer preserved the variable identity but not its concrete definition. */
  unresolved?: boolean;
  /** Sanitized original variable reference for later reconciliation. */
  rawRef?: unknown;
}

export type VariableValue = string | number | boolean | ThemedValue[];

export interface ThemedValue {
  value: string | number | boolean;
  theme?: Record<string, string>;
}
