import React from "react";
import { getCategoryIcon } from "../../utils/categoryIcons";
import type { ScopeField, ServiceTaskOption } from "../../types/booking4step.types";
import SelectDropdown from "./SelectDropdown";

export type ServiceCategoryOption = {
  id: string;
  name: string;
  basePrice: number;
  priceRangeMin: number;
  priceRangeMax: number;
  description?: string | null;
  scopeFields: ScopeField[];
  icon?: string | null;
  tasks: ServiceTaskOption[];
};

type Props = {
  categories: ServiceCategoryOption[];
  selectedId: string | null;
  onSelect: (category: ServiceCategoryOption) => void;
  loading?: boolean;
};

/** Dropdown service category picker (Step 1: SCOPE). */
export default function ServiceCategorySelector({ categories, selectedId, onSelect, loading }: Props) {
  return (
    <SelectDropdown
      loading={loading}
      placeholder="Choose a service"
      selectedId={selectedId}
      items={categories.map((cat) => ({
        id: cat.id,
        label: cat.name,
        icon: cat.icon || getCategoryIcon(cat.name),
        price:
          cat.priceRangeMin === cat.priceRangeMax
            ? `from ₱${cat.priceRangeMin}`
            : `₱${cat.priceRangeMin} – ₱${cat.priceRangeMax}`,
      }))}
      onSelect={(id) => {
        const cat = categories.find((c) => c.id === id);
        if (cat) onSelect(cat);
      }}
    />
  );
}
