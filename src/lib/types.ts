export type Table =
  | 'members'
  | 'definitions'
  | 'task_groups'
  | 'tasks'
  | 'items'
  | 'quest_chains'
  | 'quest_nodes'
  | 'quest_edges';

export const TABLES: Table[] = [
  'members',
  'definitions',
  'task_groups',
  'tasks',
  'items',
  'quest_chains',
  'quest_nodes',
  'quest_edges',
];

export interface Member {
  id: string;
  name: string;
  initials: string;
  color: string;
  email: string | null;
  sort: number;
}

export interface Definition {
  id: string;
  list: ListKey;
  name: string;
  color: string;
  sort: number;
  extra: Record<string, string>;
}

export interface TaskGroup {
  id: string;
  name: string;
  color: string;
  sort: number;
  collapsed: boolean;
}

export interface Task {
  id: string;
  group_id: string;
  title: string;
  notes: string;
  assignees: string[];
  priority: string | null;
  status: string | null;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  sort: number;
}

export interface ItemSource {
  type: string; // definition id (source_type)
  text: string;
}

export interface Recipe {
  station: string | null; // definition id (station)
  time: string;
  learned_from: string;
  ingredients: { item: string; qty: number }[];
}

export interface Item {
  id: string;
  code: string;
  name: string;
  category: string | null;
  rarity: string | null;
  stack: number;
  value: number;
  weight: number;
  description: string;
  icon_url: string | null;
  sources: ItemSource[];
  recipe: Recipe | null;
  teaches: string | null;
}

export interface QuestChain {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export type NodeKind = 'start' | 'end' | 'quest' | 'dialogue' | 'condition' | 'action' | 'choice' | 'external' | 'note';

export interface Objective {
  type: string | null;
  text: string;
  count: number;
}

export interface Reward {
  type: string | null; // definition id (reward_type)
  text: string;
  item: string | null; // optional item id
  amount: number;
}

export interface QuestData {
  code: string;
  name: string;
  description: string;
  level: string;
  giver: string;
  giver_id?: string | null; // definition id (character)
  type: string | null;
  region: string | null; // definition id (region)
  district: string | null; // definition id (district)
  status: string | null;
  assignee: string | null;
  objectives: Objective[];
  required_items: { item: string; qty: number }[];
  rewards: Reward[];
  // What the quest giver says when offering, while in progress, and on hand-in.
  dialogue?: { start: string; progress: string; complete: string };
}

export interface QuestNode {
  id: string;
  chain_id: string;
  kind: NodeKind;
  x: number;
  y: number;
  // quest → QuestData, condition → {text}, choice → {text}, external → {ref: quest node id}
  data: Record<string, any>;
}

export type EdgeKind = 'unlocks' | 'condition' | 'choice' | 'external' | 'response';

export interface QuestEdge {
  id: string;
  chain_id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
  // Which output a link leaves from: 'yes' / 'no' on conditions, otherwise null.
  source_handle: string | null;
}

export type ListKey =
  | 'item_category'
  | 'rarity'
  | 'station'
  | 'source_type'
  | 'character'
  | 'variable'
  | 'quest_type'
  | 'region'
  | 'district'
  | 'objective_type'
  | 'reward_type'
  | 'quest_status'
  | 'task_priority'
  | 'task_status';

export interface ListMeta {
  key: ListKey;
  group: 'World' | 'Items' | 'Quests' | 'Tasks';
  title: string;
  enumName: string;
  description: string;
  extras: { key: string; label: string; placeholder?: string; ref?: ListKey; options?: string[] }[];
}

export const LISTS: ListMeta[] = [
  { key: 'item_category', group: 'Items', title: 'Item categories', enumName: 'E_ItemCategory',
    description: 'Every item belongs to one category. It sets the ID prefix and default stack size for new items.',
    extras: [{ key: 'prefix', label: 'ID prefix', placeholder: 'ITM_' }, { key: 'default_stack', label: 'Default stack', placeholder: '1' }] },
  { key: 'rarity', group: 'Items', title: 'Rarities', enumName: 'E_ItemRarity',
    description: 'Rarity sets the colour of an item’s name and icon frame everywhere.',
    extras: [{ key: 'tier', label: 'Tier', placeholder: '1' }] },
  { key: 'station', group: 'Items', title: 'Crafting stations', enumName: 'E_CraftingStation',
    description: 'Where recipes are crafted.', extras: [] },
  { key: 'source_type', group: 'Items', title: 'Source types', enumName: 'E_ItemSource',
    description: 'Ways a player can get an item.', extras: [] },
  { key: 'character', group: 'World', title: 'Characters', enumName: 'E_Character',
    description: 'NPCs and other speakers. Used as quest givers and as speakers in dialogue nodes.',
    extras: [{ key: 'district', label: 'District', ref: 'district' }, { key: 'role', label: 'Role', placeholder: 'e.g. Clockmaker' }] },
  { key: 'variable', group: 'Quests', title: 'Story variables', enumName: 'E_StoryVariable',
    description: 'Flags and counters the story remembers, e.g. helped_guild or rep_city_watch. Conditions check them and “Set variable” nodes change them.',
    extras: [{ key: 'type', label: 'Type', options: ['Boolean', 'Integer', 'Text'] }, { key: 'default', label: 'Starts as', placeholder: 'false / 0 / text' }] },
  { key: 'quest_type', group: 'Quests', title: 'Quest types', enumName: 'E_QuestType',
    description: 'The kind of quest, shown on every quest node.', extras: [] },
  { key: 'region', group: 'World', title: 'Regions', enumName: 'E_Region',
    description: 'The big areas of the world (New Paris, Floating Islands, Europe…). Districts belong to a region.', extras: [] },
  { key: 'district', group: 'World', title: 'Districts', enumName: 'E_District',
    description: 'Districts inside a region, with their plot count. Quests and other content can be placed in a district.',
    extras: [{ key: 'region', label: 'Region', ref: 'region' }, { key: 'plots', label: 'Plots', placeholder: '0' }] },
  { key: 'objective_type', group: 'Quests', title: 'Objective types', enumName: 'E_ObjectiveType',
    description: 'What a quest asks the player to do.', extras: [] },
  { key: 'reward_type', group: 'Quests', title: 'Reward types', enumName: 'E_RewardType',
    description: 'What a quest can give the player.', extras: [] },
  { key: 'quest_status', group: 'Quests', title: 'Quest statuses', enumName: 'E_QuestDevStatus',
    description: 'How far along a quest is in development.', extras: [] },
  { key: 'task_priority', group: 'Tasks', title: 'Task priorities', enumName: 'E_TaskPriority',
    description: 'Priorities on the task board.', extras: [] },
  { key: 'task_status', group: 'Tasks', title: 'Task statuses', enumName: 'E_TaskStatus',
    description: 'Statuses on the task board. Ticking a task’s checkbox marks it done whatever its status.', extras: [] },
];

export function enumKey(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}
