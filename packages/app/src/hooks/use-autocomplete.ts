import { useCallback, useEffect, useState } from "react";
import {
  getAutocompleteFallbackIndex,
  getAutocompleteNextIndex,
  type AutocompleteOptionsPosition,
} from "@/components/ui/autocomplete-utils";

interface AutocompleteKeyPressEvent {
  key: string;
  preventDefault: () => void;
}

interface UseAutocompleteInput<
  TOption extends { id: string },
  TKeyPressEvent extends AutocompleteKeyPressEvent = AutocompleteKeyPressEvent,
> {
  isVisible: boolean;
  options: readonly TOption[];
  query: string;
  onSelectOption: (option: TOption, event?: TKeyPressEvent) => void;
  onEscape?: () => void;
  optionsPosition?: AutocompleteOptionsPosition;
}

interface UseAutocompleteResult<TKeyPressEvent extends AutocompleteKeyPressEvent> {
  selectedIndex: number;
  onKeyPress: (event: TKeyPressEvent) => boolean;
}

export function useAutocomplete<
  TOption extends { id: string },
  TKeyPressEvent extends AutocompleteKeyPressEvent = AutocompleteKeyPressEvent,
>(input: UseAutocompleteInput<TOption, TKeyPressEvent>): UseAutocompleteResult<TKeyPressEvent> {
  // The user's choice, tied to the query and option ID it was made for. Async file results can
  // insert rows before team members, so preserving by ID keeps explicit choices stable while
  // otherwise following the highest-priority row. The shown index is resolved during render, so a
  // list never paints its first frame without a selection.
  const [selection, setSelection] = useState<{ query: string; id: string } | null>(null);
  const selectedIndex = resolveSelectedIndex({
    selection,
    query: input.query,
    options: input.isVisible ? input.options : [],
    optionsPosition: input.optionsPosition,
  });

  // A choice belongs to one search. Until this clears it, the query check above ignores it.
  useEffect(() => {
    setSelection(null);
  }, [input.isVisible, input.query]);

  const onKeyPress = useCallback(
    (event: TKeyPressEvent) => {
      if (!input.isVisible || input.options.length === 0) {
        return false;
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const index = getAutocompleteNextIndex({
          currentIndex: selectedIndex,
          itemCount: input.options.length,
          key: event.key,
        });
        const nextOption = input.options[index];
        if (nextOption) {
          setSelection({ query: input.query, id: nextOption.id });
        }
        return true;
      }

      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const selectedOption = input.options[selectedIndex];
        if (selectedOption) {
          input.onSelectOption(selectedOption, event);
        }
        return true;
      }

      if (event.key === "Escape" && input.onEscape) {
        event.preventDefault();
        input.onEscape();
        return true;
      }

      return false;
    },
    [input, selectedIndex],
  );

  return {
    selectedIndex,
    onKeyPress,
  };
}

function resolveSelectedIndex<TOption extends { id: string }>(input: {
  selection: { query: string; id: string } | null;
  query: string;
  options: readonly TOption[];
  optionsPosition?: AutocompleteOptionsPosition;
}): number {
  const { selection, options } = input;
  if (selection && selection.query === input.query) {
    const index = options.findIndex((option) => option.id === selection.id);
    if (index >= 0) {
      return index;
    }
  }
  return getAutocompleteFallbackIndex(options.length, input.optionsPosition);
}
