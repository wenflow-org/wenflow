export interface VariableBindings {
  consumes: string[];
  produces: string[];
}

export interface RuntimeDefinitionRecord {
  id: string;
  displayName: string;
  description?: string;
  category: 'agent' | 'skill';
  inputSchema?: Record<string, any>;
  outputSchema?: Record<string, any>;
  variableBindings?: VariableBindings;
  capabilities?: string[];
  defaultMaxTokens?: number;
  defaultTemperature?: number;
  source?: 'code' | 'admin' | 'imported';
  managedByCode?: boolean;
}
