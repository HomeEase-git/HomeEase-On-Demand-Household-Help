import React from "react";
import type { ServiceTaskOption } from "../../types/booking4step.types";
import SelectDropdown from "./SelectDropdown";

type Props = {
  tasks: ServiceTaskOption[];
  selectedId: string | null;
  onSelect: (task: ServiceTaskOption) => void;
};

function taskPriceLabel(task: ServiceTaskOption): string {
  if (task.pricingModel === "CUSTOM_QUOTE") return "Quote after inspection";
  const suffix = task.pricingModel === "PER_UNIT" || task.pricingModel === "TIERED" ? `/${task.unitLabel}` : "";
  if (task.minPrice == null || task.maxPrice == null) return "";
  return task.minPrice === task.maxPrice
    ? `₱${task.minPrice.toLocaleString("en-PH")}${suffix}`
    : `₱${task.minPrice} – ₱${task.maxPrice}${suffix}`;
}

/**
 * Dropdown task picker shown once a category is selected (Step 1) —
 * lets the client pick the specific job (e.g. "Toilet Repair" under
 * "Plumbing Repair"), each with its own admin-set price.
 */
export default function TaskSelector({ tasks, selectedId, onSelect }: Props) {
  return (
    <SelectDropdown
      placeholder="Choose the job"
      selectedId={selectedId}
      items={tasks.map((task) => ({
        id: task.id,
        label: task.name,
        description: task.description,
        price: taskPriceLabel(task),
      }))}
      onSelect={(id) => {
        const task = tasks.find((t) => t.id === id);
        if (task) onSelect(task);
      }}
    />
  );
}
