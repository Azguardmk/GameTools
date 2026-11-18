import { insert, newId, snapshot, loadAll } from './db';
import type { Definition, ListKey, QuestData, Table } from './types';

/*
 * Starter data: the lists from the design plus a few sample tasks, items and quests.
 * Everything here can be edited or deleted in the app.
 */

type Row = { id: string } & Record<string, any>;

export function buildSeed(): Record<Table, Row[]> {
  const defs: Definition[] = [];
  const d = (list: ListKey, name: string, color: string, extra: Record<string, string> = {}) => {
    const row: Definition = { id: newId(), list, name, color, sort: defs.filter((x) => x.list === list).length, extra };
    defs.push(row);
    return row.id;
  };

  // ---- definitions ----
  const cat = {
    resource: d('item_category', 'Resource', '#8a6f4e', { prefix: 'ITM_', default_stack: '99' }),
    crop: d('item_category', 'Crop', '#6f9a58', { prefix: 'ITM_', default_stack: '99' }),
    component: d('item_category', 'Component', '#5f8fa8', { prefix: 'ITM_', default_stack: '50' }),
    tool: d('item_category', 'Tool', '#a8835a', { prefix: 'ITM_', default_stack: '1' }),
    equipment: d('item_category', 'Equipment', '#8f6fa8', { prefix: 'ITM_', default_stack: '1' }),
    consumable: d('item_category', 'Consumable', '#b06a6a', { prefix: 'ITM_', default_stack: '20' }),
    blueprint: d('item_category', 'Blueprint', '#7a82c4', { prefix: 'BP_', default_stack: '1' }),
    questItem: d('item_category', 'Quest item', '#c49a4e', { prefix: 'QIT_', default_stack: '1' }),
    currency: d('item_category', 'Currency', '#c4b04e', { prefix: 'CUR_', default_stack: '999999' }),
  };
  const rar = {
    common: d('rarity', 'Common', '#c9c1b3', { tier: '1' }),
    uncommon: d('rarity', 'Uncommon', '#8fbf74', { tier: '2' }),
    rare: d('rarity', 'Rare', '#6fb3d6', { tier: '3' }),
    epic: d('rarity', 'Epic', '#c294d6', { tier: '4' }),
    legendary: d('rarity', 'Legendary', '#e6bd7d', { tier: '5' }),
  };
  const st = {
    workbench: d('station', 'Workbench', '#a8835a'),
    smelter: d('station', 'Smelter', '#c97a4a'),
    kitchen: d('station', 'Kitchen', '#6f9a58'),
  };
  const src = {
    crafted: d('source_type', 'Crafted', '#7a82c4'),
    drop: d('source_type', 'Drop', '#e0805d'),
    vendor: d('source_type', 'Vendor', '#c4b04e'),
    harvest: d('source_type', 'Harvest', '#6f9a58'),
    gather: d('source_type', 'Gather', '#8a6f4e'),
    questReward: d('source_type', 'Quest reward', '#d9a75e'),
    starting: d('source_type', 'Starting item', '#8f897d'),
  };
  ['Sky', 'Aero', 'Grelf', 'Pepper', 'Kaya', 'Sanchez', 'Banks', 'Fyn'].forEach((name, i) =>
    d('faction_leader', name, ['#6fb3d6', '#9fd3e6', '#8fbf74', '#e0705d', '#c294d6', '#e0a05d', '#d9c25e', '#6fd6c2'][i], { faction: '', hq: '', notes: '' }),
  );
  const qt = {
    main: d('quest_type', 'Main', '#d9a75e'),
    side: d('quest_type', 'Side', '#6fb3d6'),
    daily: d('quest_type', 'Daily', '#8fbf74'),
    guild: d('quest_type', 'Guild', '#c294d6'),
  };
  const region = {
    newParis: d('region', 'New Paris', '#ef7d3e'),
    floatingIslands: d('region', 'Floating Islands', '#6fb3d6'),
    europe: d('region', 'Europe', '#8fbf74'),
  };
  const district = (name: string, color: string, plots: string) => d('district', name, color, { region: region.newParis, plots });
  const zone = {
    tramyard: district('City Center', '#ef7d3e', '217'),
    clocktower: district('Sheng District', '#f5b301', '147'),
    guildhall: district('Wagner District', '#e8c95a', '180'),
    thorn: district('Thorn District', '#b39ea0', '149'),
    voss: district('Voss District', '#e3ad6a', '171'),
    navarro: district('Navarro District', '#9e9a6e', '124'),
    lacVert: district('Lac Vert', '#8bbd5a', '12'),
    ruins: district('The Ruins', '#c2a91a', '0'),
    undercity: district('The Underground', '#c9663a', '0'),
  };
  const obj = {
    kill: d('objective_type', 'Kill', '#e0805d'),
    collect: d('objective_type', 'Collect', '#6fb3d6'),
    deliver: d('objective_type', 'Deliver', '#d9a75e'),
    escort: d('objective_type', 'Escort', '#c294d6'),
    interact: d('objective_type', 'Interact', '#8fbf74'),
    reach: d('objective_type', 'Reach location', '#c4b04e'),
  };
  const rw = {
    xp: d('reward_type', 'XP', '#d9a75e'),
    currency: d('reward_type', 'Currency', '#c4b04e'),
    item: d('reward_type', 'Item', '#6fb3d6'),
    blueprint: d('reward_type', 'Crafting blueprint', '#7a82c4'),
    rep: d('reward_type', 'Reputation', '#c294d6'),
    title: d('reward_type', 'Title / cosmetic', '#e0805d'),
  };
  const qs = {
    draft: d('quest_status', 'Draft', '#8f897d'),
    review: d('quest_status', 'In review', '#6fb3d6'),
    built: d('quest_status', 'Built in UE', '#d9a75e'),
    tested: d('quest_status', 'Tested', '#8fbf74'),
  };
  const chr = {
    odile: d('character', 'Engineer Odile', '#e3ad6a', { district: zone.tramyard, role: 'Tram engineer' }),
    venn: d('character', 'Clockmaster Venn', '#d9a75e', { district: zone.clocktower, role: 'Clockmaker' }),
    marot: d('character', 'Inspector Marot', '#6fb3d6', { district: zone.guildhall, role: 'City Watch inspector' }),
  };
  const sv = {
    helpedGuild: d('variable', 'helped_guild', '#c294d6', { type: 'Boolean', default: 'false' }),
    watchRep: d('variable', 'city_watch_rep', '#6fb3d6', { type: 'Integer', default: '0' }),
  };
  const tp = {
    high: d('task_priority', 'High', '#e0805d'),
    medium: d('task_priority', 'Medium', '#d9a75e'),
    low: d('task_priority', 'Low', '#8f897d'),
  };
  const ts = {
    todo: d('task_status', 'To do', '#8f897d'),
    doing: d('task_status', 'In progress', '#d9a75e'),
    review: d('task_status', 'Review', '#6fb3d6'),
  };

  // ---- members ----
  const m = {
    filip: newId(),
    f1: newId(),
    f2: newId(),
  };
  const members = [
    { id: m.filip, name: 'Filip', initials: 'FI', color: '#d9a75e', email: null, sort: 0 },
    { id: m.f1, name: 'Friend 1', initials: 'F1', color: '#6fb3d6', email: null, sort: 1 },
    { id: m.f2, name: 'Friend 2', initials: 'F2', color: '#c294d6', email: null, sort: 2 },
  ];

  // ---- task board ----
  const g = { pcg: newId(), shd: newId(), np: newId(), net: newId() };
  const task_groups = [
    { id: g.pcg, name: 'PCG Systems', color: '#d9a75e', sort: 0, collapsed: false },
    { id: g.shd, name: 'Shaders & Materials', color: '#6fb3d6', sort: 1, collapsed: false },
    { id: g.np, name: 'NewParis Level', color: '#c294d6', sort: 2, collapsed: false },
    { id: g.net, name: 'Networking / MMO', color: '#8fbf74', sort: 3, collapsed: false },
  ];
  let tsort = 0;
  const task = (group_id: string, title: string, notes: string, assignees: string[], priority: string, status: string, done = false) => ({
    id: newId(), group_id, title, notes, assignees, priority, status, done, done_by: done ? m.filip : null,
    done_at: done ? new Date().toISOString() : null, sort: tsort++,
  });
  const tasks = [
    task(g.pcg, 'Weighted mesh selection in PCG graph', 'Per-mesh weights via custom HLSL', [m.filip], tp.high, ts.doing),
    task(g.pcg, 'Density masks for NewParis outskirts', '', [m.f1], tp.medium, ts.todo),
    task(g.pcg, 'Debug view for spawn points', '', [], tp.low, ts.todo),
    task(g.pcg, 'PCG partition grid setup', '', [m.filip], tp.medium, ts.todo, true),
    task(g.shd, 'Brass / copper master material with wear mask', 'Needs roughness pass', [m.filip], tp.high, ts.review),
    task(g.shd, 'Steam & smoke with custom HLSL noise', '', [m.f2], tp.medium, ts.todo),
    task(g.np, 'Blockout: central plaza and tram line', '', [m.f2], tp.high, ts.doing),
    task(g.np, 'Landmark: clocktower kit', '', [], tp.medium, ts.todo),
    task(g.net, 'Dedicated server build pipeline', '', [m.f1], tp.high, ts.todo),
  ];

  // ---- items ----
  const it = {
    regulator: newId(), bpRegulator: newId(), gear: newId(), pipe: newId(), gauge: newId(), cell: newId(),
    log: newId(), wheat: newId(), tomato: newId(), coffee: newId(), wrench: newId(), belt: newId(), cogs: newId(),
  };
  let itemSort = 0;
  const item = (id: string, code: string, name: string, category: string, rarity: string, stack: number, value: number, weight: number,
    description: string, sources: { type: string; text: string }[], recipe: any = null, teaches: string | null = null) =>
    ({ id, code, name, category, rarity, stack, value, weight, description, icon_url: null, sources, recipe, teaches, sort: itemSort++ });
  const items = [
    item(it.regulator, 'ITM_SteamValveRegulator', 'Steam Valve Regulator', cat.component, rar.uncommon, 20, 35, 1.2,
      'Keeps pressure steady in boilers and steam lines.', [{ type: src.crafted, text: 'Workbench recipe' }],
      { station: st.workbench, time: '8 s', learned_from: 'Blueprint: Steam Valve Regulator', ingredients: [{ item: it.gear, qty: 2 }, { item: it.pipe, qty: 3 }, { item: it.gauge, qty: 1 }] }),
    item(it.bpRegulator, 'BP_SteamValveRegulator', 'Blueprint: Steam Valve Regulator', cat.blueprint, rar.rare, 1, 120, 0.1,
      'A folded technical drawing. Study it to learn the regulator recipe.', [], null, it.regulator),
    item(it.gear, 'ITM_BrassGear', 'Brass Gear', cat.component, rar.common, 50, 6, 0.3,
      'A small toothed gear found in old machinery all over NewParis.',
      [{ type: src.drop, text: 'Rust Rats (25%)' }, { type: src.vendor, text: 'Tinker stalls · NewParis' }]),
    item(it.pipe, 'ITM_CopperPipe', 'Copper Pipe', cat.component, rar.common, 50, 4, 0.6, 'A short length of copper pipe.',
      [{ type: src.vendor, text: 'Tinker stalls · NewParis' }]),
    item(it.gauge, 'ITM_PressureGauge', 'Pressure Gauge', cat.component, rar.uncommon, 20, 18, 0.4, 'A brass dial that shows steam pressure.', []),
    item(it.cell, 'ITM_PowerCell', 'Power Cell', cat.component, rar.rare, 10, 90, 0.8, 'Lunar technology that stores a strong charge. Powers hoverboards.',
      [{ type: src.drop, text: 'Hoverboard race pickups' }]),
    item(it.log, 'ITM_WoodLog', 'Wood Log', cat.resource, rar.common, 99, 1, 2, 'Chopped from trees.', [{ type: src.gather, text: 'Choppable trees' }]),
    item(it.wheat, 'ITM_Wheat', 'Wheat', cat.crop, rar.common, 99, 1, 0.2, 'Harvested from ripe wheat.', [{ type: src.harvest, text: 'Wheat plant · Ripe stage' }]),
    item(it.tomato, 'ITM_Tomato', 'Tomato', cat.crop, rar.common, 99, 2, 0.2, 'Harvested from ripe tomato plants.', [{ type: src.harvest, text: 'Tomato plant · Ripe stage' }]),
    item(it.coffee, 'ITM_CoffeeBeans', 'Coffee Beans', cat.crop, rar.uncommon, 99, 4, 0.1, 'Harvested from ripe coffee plants.', [{ type: src.harvest, text: 'Coffee plant · Ripe stage' }]),
    item(it.wrench, 'ITM_TinkersWrench', "Tinker's Wrench", cat.tool, rar.common, 1, 15, 1, 'A sturdy wrench for repairing machines.', []),
    item(it.belt, 'ITM_OdilesToolbelt', "Odile's Toolbelt", cat.equipment, rar.uncommon, 1, 40, 0.7, 'A worn leather belt with tool loops.', []),
    item(it.cogs, 'CUR_Cogs', 'Cogs', cat.currency, rar.common, 999999, 1, 0, 'Everyday currency (placeholder name).', [{ type: src.drop, text: 'Most enemies' }]),
  ];

  // ---- quests ----
  const ch = { brass: newId(), undercity: newId(), watch: newId() };
  const quest_chains = [
    { id: ch.brass, name: 'The Brass Conspiracy', color: '#d9a75e', sort: 0, type: qt.main },
    { id: ch.undercity, name: 'Undercity Pipes', color: '#6fb3d6', sort: 1, type: qt.side },
    { id: ch.watch, name: 'City Watch Patrols', color: '#c294d6', sort: 2, type: qt.guild },
  ];
  const q = (chain_id: string, x: number, y: number, data: Partial<QuestData>) => ({
    id: newId(), chain_id, kind: 'quest', x, y,
    data: { code: '', name: '', description: '', level: '', giver: '', type: qt.main, region: region.newParis, district: null, status: qs.draft, assignee: null,
      objectives: [], required_items: [], rewards: [], ...data },
  });
  const n = (chain_id: string, kind: string, x: number, y: number, data: Record<string, any>) => ({ id: newId(), chain_id, kind, x, y, data });

  const sworn = q(ch.watch, 280, 120, { code: 'Q_CW_002', name: 'Sworn to the Watch', level: '6–8', giver: 'Captain Ferrand', district: zone.tramyard, assignee: m.f2,
    objectives: [{ type: obj.interact, text: 'Take the oath at the Watch house', count: 1 }], rewards: [{ type: rw.rep, text: 'City Watch', item: null, amount: 250 }] });
  const nightShift = q(ch.watch, 0, 120, { code: 'Q_CW_001', name: 'Night Shift', level: '5–6', giver: 'Captain Ferrand', district: zone.tramyard, assignee: m.f2,
    objectives: [{ type: obj.reach, text: 'Patrol the tram line', count: 1 }], rewards: [{ type: rw.xp, text: '', item: null, amount: 150 }] });

  const cond = n(ch.brass, 'condition', -230, 130, { text: 'Level ≥ 5', variable: null, op: '==', value: '' });
  const smoke = q(ch.brass, 0, 100, { code: 'Q_NP_001', name: 'Smoke over the Tramyard', level: '5–7', giver: 'Engineer Odile', giver_id: chr.odile, district: zone.tramyard,
    status: qs.review, assignee: m.filip, description: 'Steam valves are bursting across the tram depot. Odile suspects sabotage.',
    objectives: [{ type: obj.interact, text: 'Inspect burst steam valves', count: 3 }, { type: obj.kill, text: 'Rust Rats', count: 8 }, { type: obj.deliver, text: 'Report back to Odile', count: 1 }],
    rewards: [{ type: rw.xp, text: '', item: null, amount: 250 }, { type: rw.currency, text: 'Cogs', item: it.cogs, amount: 40 }, { type: rw.item, text: '', item: it.belt, amount: 1 }] });
  const gears = q(ch.brass, 300, 100, { code: 'Q_NP_002', name: 'Gears for the Clocktower', level: '6–8', giver: 'Clockmaster Venn', giver_id: chr.venn, district: zone.clocktower,
    assignee: m.f1, description: 'The great clock has stopped. Venn needs parts no honest merchant will sell.',
    objectives: [{ type: obj.collect, text: 'Brass Gear', count: 5 }, { type: obj.interact, text: 'Repair the clock mechanism', count: 1 }],
    required_items: [{ item: it.gear, qty: 5 }],
    rewards: [{ type: rw.xp, text: '', item: null, amount: 400 }, { type: rw.blueprint, text: '', item: it.bpRegulator, amount: 1 }, { type: rw.item, text: '', item: it.wrench, amount: 1 }] });
  const choice = n(ch.brass, 'choice', 600, 130, { text: 'Protect or expose the Guild?', options: [{ id: 'opt_protect', text: 'Protect the Guild' }, { id: 'opt_expose', text: 'Expose the Guild' }] });
  const favor = q(ch.brass, 860, 0, { code: 'Q_NP_003a', name: "The Guild's Favor", level: '8–10', giver: 'Clockmaster Venn', giver_id: chr.venn, district: zone.guildhall,
    objectives: [{ type: obj.deliver, text: 'Sealed ledger to the Guildhall', count: 1 }] });
  const whistle = q(ch.brass, 860, 220, { code: 'Q_NP_003b', name: 'Whistleblower', level: '8–10', giver: 'Inspector Marot', giver_id: chr.marot, district: zone.guildhall, assignee: m.f2,
    objectives: [{ type: obj.interact, text: 'Steal the ledger', count: 1 }, { type: obj.reach, text: 'Escape the Guildhall', count: 1 }],
    rewards: [{ type: rw.xp, text: '', item: null, amount: 600 }, { type: rw.rep, text: 'Clockmakers Guild', item: null, amount: -500 },
      { type: rw.rep, text: 'City Watch', item: null, amount: 750 }, { type: rw.title, text: 'The Whistleblower', item: null, amount: 1 }] });
  const extSworn = n(ch.brass, 'external', 600, 380, { ref: sworn.id });

  const drains = q(ch.undercity, 280, 100, { code: 'Q_UC_001', name: 'Into the Drains', level: '9–10', giver: 'Inspector Marot', giver_id: chr.marot, district: zone.undercity,
    objectives: [{ type: obj.reach, text: 'Enter the Undercity', count: 1 }], rewards: [{ type: rw.xp, text: '', item: null, amount: 500 }] });
  const extWhistle = n(ch.undercity, 'external', 0, 110, { ref: whistle.id });
  const ratKing = q(ch.undercity, 580, 100, { code: 'Q_UC_002', name: "Rat King's Toll", level: '10–11', giver: 'Rat King', district: zone.undercity,
    objectives: [{ type: obj.collect, text: 'Power Cell', count: 2 }], required_items: [{ item: it.cell, qty: 2 }], rewards: [{ type: rw.xp, text: '', item: null, amount: 650 }] });

  // A small branching flow around the choice, to show dialogue, variables and endings.
  const start = n(ch.brass, 'start', -460, 150, { text: 'The player arrives at the Tramyard.' });
  const vennTalk = n(ch.brass, 'dialogue', 560, 330, { speaker: chr.venn, text: 'The clock runs again, thanks to you. But you saw the Guild ledger, didn’t you? Keep it quiet and the Guild will remember you kindly.' });
  const setProtect = n(ch.brass, 'action', 900, 20, { variable: sv.helpedGuild, op: 'set', value: 'true' });
  const setExpose = n(ch.brass, 'action', 900, 300, { variable: sv.watchRep, op: 'add', value: '250' });
  const endGuild = n(ch.brass, 'end', 1500, 0, { outcome: 'success', text: 'The Guild owes the player a favour.' });
  const endWatch = n(ch.brass, 'end', 1500, 300, { outcome: 'success', text: 'The Guild’s sabotage is exposed.' });
  const note = n(ch.brass, 'note', -460, -60, { text: 'Sample flow: press Play above to walk through it.' });
  choice.x = 760; choice.y = 160;
  favor.x = 1160; favor.y = 0;
  whistle.x = 1160; whistle.y = 260;
  extSworn.x = 900; extSworn.y = 470;
  const quest_nodes = [start, note, cond, smoke, gears, vennTalk, choice, setProtect, setExpose, favor, whistle, endGuild, endWatch, extSworn, nightShift, sworn, extWhistle, drains, ratKing];
  const e = (chain_id: string, source: string, target: string, kind: string, label = '', source_handle: string | null = null) => ({ id: newId(), chain_id, source, target, kind, label, source_handle });
  const quest_edges = [
    e(ch.brass, start.id, cond.id, 'unlocks'),
    e(ch.brass, cond.id, smoke.id, 'condition', '', 'yes'),
    e(ch.brass, smoke.id, gears.id, 'unlocks'),
    e(ch.brass, gears.id, vennTalk.id, 'unlocks'),
    e(ch.brass, vennTalk.id, choice.id, 'response', 'I saw it. What happens now?'),
    e(ch.brass, choice.id, setProtect.id, 'choice', 'Protect the Guild', 'opt_protect'),
    e(ch.brass, choice.id, setExpose.id, 'choice', 'Expose the Guild', 'opt_expose'),
    e(ch.brass, setProtect.id, favor.id, 'unlocks'),
    e(ch.brass, setExpose.id, whistle.id, 'unlocks'),
    e(ch.brass, favor.id, endGuild.id, 'unlocks'),
    e(ch.brass, whistle.id, endWatch.id, 'unlocks'),
    e(ch.brass, extSworn.id, whistle.id, 'external'),
    e(ch.watch, nightShift.id, sworn.id, 'unlocks'),
    e(ch.undercity, extWhistle.id, drains.id, 'external'),
    e(ch.undercity, drains.id, ratKing.id, 'unlocks'),
  ];

  // ---- quest map ----
  const mn = (kind: string, x: number, y: number, chain_id: string | null = null, data: Record<string, any> = {}) => ({ id: newId(), kind, chain_id, x, y, data });
  const mStart = mn('start', 0, 120, null, { label: 'Act I begins' });
  const mWatch = mn('chain', 200, 0, ch.watch);
  const mAnd = mn('and', 520, 128);
  const mBrass = mn('chain', 640, 100, ch.brass);
  const mUnder = mn('chain', 980, 260, ch.undercity);
  const mEnd = mn('end', 1000, 120, null, { label: 'End of Act I' });
  const mNote = mn('note', 200, 260, null, { text: 'Undercity Pipes opens once the whistle is found in The Brass Conspiracy.' });
  const map_nodes = [mStart, mWatch, mAnd, mBrass, mUnder, mEnd, mNote];
  const me = (a: { id: string }, b: { id: string }, kind: string, label = '') => ({ id: newId(), source: a.id, target: b.id, kind, label });
  const map_edges = [me(mStart, mWatch, 'side'), me(mStart, mAnd, 'main'), me(mWatch, mAnd, 'unlock', 'Sworn to the Watch'), me(mAnd, mBrass, 'main'), me(mBrass, mEnd, 'main'), me(mBrass, mUnder, 'side')];

  return {
    map_nodes,
    map_edges,
    members,
    definitions: defs as unknown as Row[],
    task_groups,
    tasks,
    items,
    quest_chains,
    quest_nodes,
    quest_edges,
  };
}

const ORDER: Table[] = ['members', 'definitions', 'task_groups', 'tasks', 'items', 'quest_chains', 'quest_nodes', 'quest_edges', 'map_nodes', 'map_edges'];

export async function loadStarterData(): Promise<void> {
  const seed = buildSeed();
  for (const t of ORDER) {
    if (seed[t].length) await insert(t, seed[t]);
  }
}

/** Demo mode: fill an empty browser with the starter data once. */
export async function seedDemoIfEmpty(): Promise<void> {
  await loadAll();
  if (snapshot('definitions').length === 0 && !localStorage.getItem('earthlings-tools:seeded')) {
    localStorage.setItem('earthlings-tools:seeded', '1');
    await loadStarterData();
  }
}
