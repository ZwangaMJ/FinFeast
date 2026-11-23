import { useState } from 'react';
import { View } from 'react-native';

import { AmountInput, Button, Field, Row, Sheet, Txt, useCurrency } from '@/components/ui';
import { foodActions } from '@/hooks/useFood';
import { DEFAULT_GROCERY_EMOJI, type FieldErrors, type GroceryInput } from '@/store/food';
import type { GroceryEntry } from '@/store/types';
import { space, useTheme } from '@/theme';

const numText = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const parseOrNull = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));

/**
 * Add or edit a grocery item in a sheet. Pass `item` to edit; `mealId` links a new item to a meal.
 * Mount it with a `key` per item so the fields reset between items.
 */
export function GroceryForm({ visible, onClose, item, mealId = null, mealName }: { visible: boolean; onClose: () => void; item?: GroceryEntry | null; mealId?: string | null; mealName?: string }) {
  const { c } = useTheme();
  const currency = useCurrency();
  const [name, setName] = useState(item?.name ?? '');
  const [quantity, setQuantity] = useState(numText(item?.quantity));
  const [unit, setUnit] = useState(item?.unit ?? '');
  const [cost, setCost] = useState(numText(item?.estCost));
  const [emoji, setEmoji] = useState(item?.emoji ?? DEFAULT_GROCERY_EMOJI);
  const [errors, setErrors] = useState<FieldErrors<GroceryInput>>({});

  const save = () => {
    const input: GroceryInput = {
      name,
      quantity: parseOrNull(quantity),
      unit: unit || null,
      estCost: parseOrNull(cost),
      costCurrency: item?.costCurrency ?? currency,
      mealId: item ? item.mealId : mealId,
      emoji,
    };
    const result = item ? foodActions.updateGroceryItem(item.id, input) : foodActions.createGroceryItem(input);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    onClose();
  };

  const error = errors.name ?? errors.quantity ?? errors.estCost;
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={item ? 'Edit item' : mealName ? `Add item for ${mealName}` : 'Add grocery item'}
      footer={
        <Row gap={10}>
          <Button label="Cancel" variant="secondary" style={{ flex: 1 }} onPress={onClose} />
          <Button label={item ? 'Save' : 'Add item'} style={{ flex: 1 }} onPress={save} accessibilityLabel={item ? 'Save item' : 'Add item'} />
        </Row>
      }>
      <View style={{ gap: space.sm }}>
        <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
          <View style={{ width: 80 }}>
            <Field label="Emoji" value={emoji} onChange={(v) => setEmoji(Array.from(v).slice(-2).join(''))} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Item" value={name} onChange={setName} placeholder="e.g. Coriander" autoFocus={!item} />
          </View>
        </Row>
        <Row gap={space.sm}>
          <View style={{ flex: 1 }}>
            <Field label="Quantity" value={quantity} onChange={(v) => setQuantity(v.replace(/[^\d.,]/g, ''))} placeholder="1" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Unit" value={unit} onChange={setUnit} placeholder="bunch" />
          </View>
        </Row>
        <AmountInput label="Estimated cost (optional)" value={cost} onChange={setCost} />
        {error ? (
          <Txt v="small" color={c.destructive}>
            {error}
          </Txt>
        ) : null}
      </View>
    </Sheet>
  );
}
