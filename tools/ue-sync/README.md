# Unreal → Game data sync

Reads the Earthlings Unreal project's data assets straight from the `.uasset` files (the editor doesn't need to be open)
and makes `ue_export.json` for the web tool's **Game data → Import from Unreal** button.

```bash
python ue_export.py D:/Earthlings_Main/Earthlings > ue_export.json
```

Needs Python 3, nothing else. It reads everything under `Content/Data`:

| Unreal | In the tool |
|---|---|
| Every `UItemDataAsset` (items, equipment, weapons, companions, pins, housing, racing) | Items, with an **IN UNREAL** box |
| `UDARecipeDataTable` recipes | Game data → Recipes |
| `UDropTableDataAsset` | Game data → Drop tables |
| `UChestLootDataAsset` and `FChestLootTableRow` DataTables | Game data → Loot tables |
| `UShopDataAsset` (+ vendors from `DA_CityNPCs`) | Game data → Shops |
| Equipment / weapon / tool items | Game data → Equipment |

What an import does (`supabase/ue_import.sql`, function `import_ue`):

- Items are matched by asset name. The first time, an item already written in the tool with the same name (ignoring case,
  spaces and symbols) is linked instead of duplicated. New items get their name, category, rarity, stack and description
  from Unreal; after that only the Unreal copy (`items.ue`) is refreshed, so edits made in the tool are kept.
- Items that disappear from Unreal stay in the tool, marked "Removed from UE".
- Recipes, drop tables, loot tables and shops are replaced with what Unreal has. Notes typed in the tool are kept.

The orange **UE · not in quests** marker means the item came from Unreal but no written quest gives it as a reward or asks
for it. It goes away by itself once a quest uses the item.

`ue_parse.py` is a small reader for UE 5.4+ tagged-property packages (unversioned/cooked packages are not supported).
Values a data asset never saved keep their C++ defaults, so the exporter fills in the known ones (stack 64, or 1 for
equipment; the slot of weapons, board lights and race spells).
