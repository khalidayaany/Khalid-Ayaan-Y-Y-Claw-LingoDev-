export type CliSkillSource =
  | "khalidayaany-core"
  | "agent-skills"
  | "ship-faster"
  | "awesome-openclaw"
  | "workspace-custom";

export type CliSkillSelectionMode = "auto" | "manual";

export interface CliSkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  source: CliSkillSource;
  triggers: string[];
  tags: string[];
  installHint?: string;
  priority?: number;
}

export interface CliSkillsState {
  enabled: boolean;
  selectionMode: CliSkillSelectionMode;
  liveTraceEnabled: boolean;
  preferShipFaster: boolean;
  shipFasterSessionCarryover: boolean;
  preferChiferMemory: boolean;
  maxAutoSkills: number;
  pinnedSkillIds: string[];
  blockedSkillIds: string[];
  awesomeCatalogLastSyncAt?: string;
  awesomeCatalogCount: number;
}

export interface CliSkillMatch {
  skill: CliSkillDefinition;
  score: number;
  reasons: string[];
}

export interface CliSkillPlan {
  enabled: boolean;
  mode: CliSkillSelectionMode | "disabled";
  selected: CliSkillMatch[];
  traces: string[];
  catalogSize: number;
  syncedAt?: string;
}

export interface AwesomeSkillCache {
  syncedAt: string;
  sourceUrl: string;
  skills: CliSkillDefinition[];
}

export interface CliSkillsCatalog {
  skills: CliSkillDefinition[];
  awesomeSyncedAt?: string;
}

export interface AwesomeCatalogSyncResult {
  success: boolean;
  imported: number;
  sourceUrl?: string;
  message: string;
}
