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

export type NodeKind = 'quest' | 'condition' | 'choice' | 'external';

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
  type: string | null;
  zone: string | null;
  status: string | null;
  assignee: string | null;
  objectives: Objective[];
  required_items: { item: string; qty: number }[];
  rewards: Reward[];
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

export type EdgeKind = 'unlocks' | 'condition' | 'choice' | 'external';

export interface QuestEdge {
  id: string;
  chain_id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label: string;
}

export type ListKey =
  | 'item_category'
  | 'rarity'
  | 'station'
  | 'source_type'
  | 'quest_type'
  | 'zone'
  | 'objective_type'
  | 'reward_type'
  | 'quest_status'
  | 'task_priority'
  | 'task_status';

export interface ListMeta {
  key: ListKey;
  group: 'Items' | 'Quests' | 'Tasks';
  title: string;
  enumName: string;
  description: string;
  extras: { key: string; label: string; placeholder?: string }[];
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
  { key: 'quest_type', group: 'Quests', title: 'Quest types', enumName: 'E_QuestType',
    description: 'The kind of quest, shown on every quest node.', extras: [] },
  { key: 'zone', group: 'Quests', title: 'Zones', enumName: 'E_Zone',
    description: 'Where quests take place.', extras: [{ key: 'region', label: 'Region', placeholder: 'NewParis' }] },
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
