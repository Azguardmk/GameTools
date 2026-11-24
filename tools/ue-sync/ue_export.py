"""
Builds the Game data export for the web tool from the Earthlings Unreal project.

    python ue_export.py D:/Earthlings_Main/Earthlings  >  ue_export.json

Then in the web tool: Game data → Import from Unreal → pick ue_export.json.

It reads the .uasset files directly (the editor doesn't need to be open) with ue_parse.py:
items (every UItemDataAsset subclass: equipment, weapons, companions, pins, housing, racing),
the recipe table, drop tables, loot tables (chest loot assets and loot DataTables) and shops.
"""
import json, os, sys, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DEFAULT_STACK = 64  # UItemDataAsset::MaxStacks default; unsaved properties keep their C++ default
ITEM_FIELDS = {'ItemName', 'Icon', 'IconBig', 'Description', 'MaxStacks', 'IsNFT', 'ItemCategory', 'Rarity', 'Tier',
               'AcquisitionFlags', 'GASAbility', 'AbilitySettings', 'bSingleUse', 'bBoundToCharacter', 'StoredItemID'}
EQUIPMENT_CLASSES = {'EquipmentDataAsset', 'WeaponItemDataAsset', 'HoverboardLightsDataAsset', 'RaceSpellDataAsset'}
# Slot set in the C++ constructors of the equipment subclasses (used when the asset doesn't save its own).
CLASS_SLOT = {'WeaponItemDataAsset': 'Weapon', 'HoverboardLightsDataAsset': 'Hoverboard', 'RaceSpellDataAsset': 'RaceSpell1'}
RARITY = {'Common': 'Common', 'Uncommon': 'Uncommon', 'Rare': 'Rare', 'VeryRare': 'Very Rare', 'Epic': 'Epic', 'Mythic': 'Mythic'}


def read_raw(project):
    from ue_parse import Pkg
    data = os.path.join(project, 'Content', 'Data')
    files = sorted(set(glob.glob(os.path.join(data, '**', '*.uasset'), recursive=True)))
    out = {}
    for f in files:
        try:
            k = Pkg(f)
            if k.ser is None:
                continue
            rel = f.replace('\\', '/').split('/Content/')[-1]
            out[rel] = {'_class': k.cls, '_object': k.asset, '_path': rel, **k.read()}
        except Exception:
            pass  # not a data asset this exporter understands
    return out


def tool_category(key, v):
    """Maps an Unreal item to one of the web tool's item categories (by name)."""
    cls = v['_class']
    path = v['_path'].split('/')
    folder = path[2] if len(path) > 3 else ''
    cat = v.get('ItemCategory', 'GameItem')
    slot = v.get('Slot') or CLASS_SLOT.get(cls, '')
    if cls == 'HousingDataAsset' or cat in ('HousingItem', 'Building'):
        return 'Housing'
    if cls == 'CompanionItemDataAsset' or cat == 'Animal':
        return 'Companion'
    if cls == 'PinDataAsset' or cat == 'Pin':
        return 'Pin'
    if folder == 'Racing':
        return 'Racing'
    if cat == 'Money':
        return 'Currency'
    if cls in EQUIPMENT_CLASSES:
        if slot.startswith('Tool') or slot == 'Flashlight':
            return 'Tool'
        return 'Weapon' if cls == 'WeaponItemDataAsset' or slot.startswith('Weapon') else 'Equipment'
    if cat == 'Special':
        return 'Special'
    if folder == 'Garden':
        return 'Crops'
    if cat == 'Food':
        return 'Consumable'
    if folder in ('Ores', 'Wood', 'Fish', 'Fishing'):
        return 'Resource'
    return 'Component'


def short(v):
    """'/Game/Path/T_Icon.T_Icon' -> 'T_Icon' for display."""
    if isinstance(v, str) and v.startswith('/') and '.' in v:
        return v.rsplit('.', 1)[-1]
    if isinstance(v, list):
        return [short(x) for x in v]
    if isinstance(v, dict):
        return {k: short(x) for k, x in v.items()}
    return v


def build(raw):
    # Item key = asset name (IDA_Steak); when two assets share a name, the folder goes in front (Craft/IDA_Glass).
    item_paths = [k for k, v in raw.items() if 'ItemName' in v]
    base = lambda rel: rel.rsplit('/', 1)[-1][:-len('.uasset')]
    counts = {}
    for rel in item_paths:
        counts[base(rel)] = counts.get(base(rel), 0) + 1
    key_of = {rel: (base(rel) if counts[base(rel)] == 1 else rel.split('/')[-2] + '/' + base(rel)) for rel in item_paths}
    by_package = {'/Game/' + rel[:-len('.uasset')]: key_of[rel] for rel in item_paths}

    def ref(name):
        """Other assets point at an item as '/Game/Path/Package.Object'."""
        if not name:
            return None
        if '.' in name:
            return by_package.get(name.split('.')[0], name.rsplit('.', 1)[-1])
        return name

    items = []
    for rel in sorted(item_paths, key=lambda r: key_of[r]):
        v = raw[rel]
        props = short({x: y for x, y in v.items() if x not in ITEM_FIELDS and not x.startswith('_')})
        items.append({
            'asset': key_of[rel],
            'name': v['ItemName'],
            'class': v['_class'],
            'path': v['_path'],
            'category': tool_category(key_of[rel], v),
            'ue_category': v.get('ItemCategory', 'GameItem'),
            'rarity': RARITY.get(v.get('Rarity', 'Common'), v.get('Rarity')),
            'tier': v.get('Tier', 0),
            'stack': v.get('MaxStacks', 1 if v['_class'] in EQUIPMENT_CLASSES else DEFAULT_STACK),
            'description': v.get('Description', '') if isinstance(v.get('Description'), str) else '',
            'icon': short(v.get('Icon')),
            'nft': bool(v.get('IsNFT')),
            'single_use': bool(v.get('bSingleUse')),
            'bound': bool(v.get('bBoundToCharacter')),
            'ability': short(v.get('GASAbility')),
            'item_id': v.get('StoredItemID'),
            'slot': v.get('Slot', CLASS_SLOT.get(v['_class'])),
            'props': props,
        })

    recipes, drops, loot, shops = [], [], [], []
    for rel, v in sorted(raw.items()):
        k = base(rel) if rel.endswith('.uasset') else rel
        c = v['_class']
        if c == 'DARecipeDataTable':
            for r in v.get('Recipes', []):
                recipes.append({
                    'code': r.get('RecipeId') or f"{k}_{len(recipes)}",
                    'table': k,
                    'result': ref(r.get('Result')),
                    'qty': r.get('ResultQuantity', 1),
                    'station': r.get('Station', 'None'),
                    'seconds': r.get('CraftSeconds', 0),
                    'field': bool(r.get('bFieldCraftable')),
                    'ingredients': [{'item': ref(x.get('Requirement')), 'qty': x.get('Amount', 1)} for x in r.get('Requirements', [])],
                })
        elif c == 'DropTableDataAsset':
            drops.append({'code': k, 'path': v['_path'], 'entries': [{
                'item': ref(e.get('ItemDataAsset')),
                'chance': (e.get('DropChance', 0) / 100 if e.get('DropChance', 0) > 1 else e.get('DropChance', 0)),
                'min': e.get('MinQuantity', 1), 'max': e.get('MaxQuantity', 1),
                'legacy_quest': short(e.get('QuestAsset')),
            } for e in v.get('Entries', [])]})
        elif c == 'ChestLootDataAsset':
            loot.append({'code': k, 'path': v['_path'], 'type': 'Chest loot', 'pools': [{
                'name': p.get('Name', ''), 'chance': p.get('Chance', 1), 'min_rolls': p.get('MinRolls', 1), 'max_rolls': p.get('MaxRolls', 1),
                'unique': bool(p.get('bUniquePicks')),
                'entries': [{'item': ref(e.get('Item')), 'weight': e.get('Weight', 1), 'min': e.get('MinQuantity', 1), 'max': e.get('MaxQuantity', 1)} for e in p.get('Entries', [])],
            } for p in v.get('Pools', [])]})
        elif c == 'DataTable' and 'LootTableRow' in str(v.get('RowStruct', '')):
            loot.append({'code': k, 'path': v['_path'], 'type': 'Loot DataTable', 'pools': [{
                'name': 'Rows', 'chance': 1, 'min_rolls': 1, 'max_rolls': 1, 'unique': False,
                'entries': [{'row': rn, 'item': ref(e.get('ItemDA')), 'weight': e.get('Weight', 1), 'min': e.get('Quantity', 1), 'max': e.get('Quantity', 1),
                             'node_material': short(e.get('NodeMaterial'))} for rn, e in v.get('_rows', {}).items() if not rn.startswith('_')],
            }]})
        elif c == 'ShopDataAsset':
            shops.append({'code': k, 'path': v['_path'], 'name': v.get('DisplayName', k), 'vendors': [], 'entries': [{
                'item': ref(e.get('ItemDataAsset')), 'buy': e.get('WaterPriceBuy', 0), 'sell': e.get('WaterPriceSell', 0),
                'can_buy': e.get('bCanBuy', True), 'can_sell': e.get('bCanSell', True), 'currency': ref(e.get('CurrencyItem')),
            } for e in v.get('Items', [])]})

    # Which NPCs run each shop (from the generated city NPC roster).
    for v in raw.values():
        if v['_class'] == 'CityNPCRoster':
            for npc in v.get('NPCs', []):
                for s in shops:
                    if short(npc.get('Shop')) == s['code']:
                        s['vendors'].append(npc.get('Name'))

    return {'version': 1, 'items': items, 'recipes': recipes, 'drop_tables': drops, 'loot_tables': loot, 'shops': shops}


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else '.'
    raw = json.load(open(src, encoding='utf-8')) if src.endswith('.json') else read_raw(src)
    json.dump(build(raw), sys.stdout, indent=1, ensure_ascii=False)
