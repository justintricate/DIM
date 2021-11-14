import { t } from 'app/i18next-t';
import { DimItem } from 'app/inventory/item-types';
import { showNotification } from 'app/notifications/notifications';
import { itemCanBeInLoadout } from 'app/utils/item-utils';
import { DestinyClass } from 'bungie-api-ts/destiny2';
import produce from 'immer';
import { Loadout, LoadoutItem } from './loadout-types';
import { newLoadout } from './loadout-utils';

export interface State {
  loadout?: Readonly<Loadout>;
  showClass: boolean;
  isNew: boolean;
  modPicker: {
    show: boolean;
    /** An initial query to be passed to the mod picker, this will filter the mods shown. */
    query?: string;
  };
}

export type Action =
  /** Reset the tool (for when the sheet is closed) */
  | { type: 'reset' }
  /** Start editing a new or existing loadout */
  | {
      type: 'editLoadout';
      loadout: Loadout;
      isNew: boolean;
      showClass: boolean;
    }
  /** Replace the current loadout with an updated one */
  | { type: 'update'; loadout: Loadout }
  /** Add an item to the loadout */
  | { type: 'addItem'; item: DimItem; shift: boolean; items: DimItem[]; equip?: boolean }
  /** Remove an item from the loadout */
  | { type: 'removeItem'; item: DimItem; shift: boolean; items: DimItem[] }
  /** Make an item that's already in the loadout equipped */
  | { type: 'equipItem'; item: DimItem; items: DimItem[] }
  | { type: 'openModPicker'; query?: string }
  | { type: 'closeModPicker' };

/**
 * All state for this component is managed through this reducer and the Actions above.
 */
export function stateReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset':
      return {
        showClass: true,
        isNew: false,
        loadout: undefined,
        modPicker: {
          show: false,
        },
      };

    case 'editLoadout': {
      const { loadout, isNew, showClass } = action;

      return {
        ...state,
        loadout,
        isNew,
        showClass,
      };
    }

    case 'update':
      return {
        ...state,
        loadout: action.loadout,
      };

    case 'addItem': {
      const { loadout } = state;
      const { item, shift, items, equip } = action;

      if (!itemCanBeInLoadout(item)) {
        showNotification({ type: 'warning', title: t('Loadouts.OnlyItems') });
        return state;
      }

      return {
        ...state,
        loadout: addItem(loadout || newLoadout('', []), item, shift, items, equip),
        isNew: !loadout,
      };
    }

    case 'removeItem': {
      const { loadout } = state;
      const { item, shift, items } = action;
      return loadout
        ? {
            ...state,
            loadout: removeItem(loadout, item, shift, items),
          }
        : state;
    }

    case 'equipItem': {
      const { loadout } = state;
      const { item, items } = action;
      return loadout
        ? {
            ...state,
            loadout: equipItem(loadout, item, items),
          }
        : state;
    }

    case 'openModPicker': {
      const { query } = action;
      return { ...state, modPicker: { show: true, query } };
    }

    case 'closeModPicker': {
      return { ...state, modPicker: { show: false } };
    }
  }
}

/**
 * Produce a new loadout that adds a new item to the given loadout.
 */
function addItem(
  loadout: Readonly<Loadout>,
  item: DimItem,
  shift: boolean,
  items: DimItem[],
  equip?: boolean
): Loadout {
  const loadoutItem: LoadoutItem = {
    id: item.id,
    hash: item.hash,
    amount: Math.min(item.amount, shift ? 5 : 1),
    equipped: false,
  };

  // Other items of the same type (as DimItem)
  const typeInventory = items.filter((i) => i.type === item.type);
  const dupe = loadout.items.find((i) => i.hash === item.hash && i.id === item.id);
  const maxSlots = item.bucket.capacity;

  return produce(loadout, (draftLoadout) => {
    const findItem = (item: DimItem) =>
      draftLoadout.items.find((i) => i.id === item.id && i.hash === item.hash)!;

    if (!dupe) {
      if (typeInventory.length < maxSlots) {
        loadoutItem.equipped =
          equip !== undefined ? equip : item.equipment && typeInventory.length === 0;
        if (loadoutItem.equipped) {
          for (const otherItem of typeInventory) {
            findItem(otherItem).equipped = false;
          }
        }

        // Only allow one subclass to be present per class (to allow for making a loadout that specifies a subclass for each class)
        if (item.type === 'Class') {
          const conflictingItem = items.find(
            (i) => i.type === item.type && i.classType === item.classType
          );
          if (conflictingItem) {
            draftLoadout.items = draftLoadout.items.filter((i) => i.id !== conflictingItem.id);
          }
          loadoutItem.equipped = true;
        }

        draftLoadout.items.push(loadoutItem);
      } else {
        showNotification({
          type: 'warning',
          title: t('Loadouts.MaxSlots', { slots: maxSlots }),
        });
      }
    } else if (item.maxStackSize > 1) {
      const increment = Math.min(dupe.amount + item.amount, item.maxStackSize) - dupe.amount;
      dupe.amount += increment;
      // TODO: handle stack splits
    }

    if (
      draftLoadout.classType === DestinyClass.Unknown &&
      item.classType !== DestinyClass.Unknown
    ) {
      draftLoadout.classType = item.classType;
    }
  });
}

/**
 * Produce a new Loadout with the given item removed from the original loadout.
 */
function removeItem(
  loadout: Readonly<Loadout>,
  item: DimItem,
  shift: boolean,
  items: DimItem[]
): Loadout {
  return produce(loadout, (draftLoadout) => {
    const loadoutItem = draftLoadout.items.find((i) => i.hash === item.hash && i.id === item.id);

    if (!loadoutItem) {
      return;
    }

    const decrement = shift ? 5 : 1;
    loadoutItem.amount ||= 1;
    loadoutItem.amount -= decrement;
    if (loadoutItem.amount <= 0) {
      draftLoadout.items = draftLoadout.items.filter(
        (i) => !(i.hash === item.hash && i.id === item.id)
      );
    }

    if (loadoutItem.equipped) {
      const typeInventory = items.filter((i) => i.type === item.type);
      const nextInLine =
        typeInventory.length > 0 &&
        draftLoadout.items.find(
          (i) => i.id === typeInventory[0].id && i.hash === typeInventory[0].hash
        );
      if (nextInLine) {
        nextInLine.equipped = true;
      }
    }
  });
}

/**
 * Produce a new loadout with the given item switched to being equipped (or unequipped if it's already equipped).
 */
function equipItem(loadout: Readonly<Loadout>, item: DimItem, items: DimItem[]) {
  return produce(loadout, (draftLoadout) => {
    const findItem = (item: DimItem) =>
      draftLoadout.items.find((i) => i.id === item.id && i.hash === item.hash)!;

    // Classes are always equipped
    if (item.type === 'Class') {
      return;
    }

    const loadoutItem = findItem(item);
    if (item.equipment) {
      if (loadoutItem.equipped) {
        // It's equipped, mark it unequipped
        loadoutItem.equipped = false;
      } else {
        // It's unequipped - mark all the other items and conflicting exotics unequipped, then mark this equipped
        items
          .filter(
            (i) =>
              // Others in this slot
              i.type === item.type ||
              // Other exotics
              (item.equippingLabel && i.equippingLabel === item.equippingLabel)
          )
          .map(findItem)
          .forEach((i) => {
            i.equipped = false;
          });

        loadoutItem.equipped = true;
      }
    }
  });
}