"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

type Option = { value: string; label: string };
export function FormSelect({ value, onValueChange, placeholder, options, disabled = false, ariaLabel }: { value: string; onValueChange: (value: string) => void; placeholder: string; options: Option[]; disabled?: boolean; ariaLabel: string }) {
  return <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
    <Select.Trigger className="select-trigger" aria-label={ariaLabel}>
      <Select.Value placeholder={placeholder} />
      <Select.Icon className="select-chevron"><ChevronDown size={15} strokeWidth={1.7} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="select-content" position="popper" sideOffset={6} collisionPadding={12}>
        <Select.Viewport className="select-viewport">
          {options.map((option) => <Select.Item className="select-item" key={option.value} value={option.value}>
            <Select.ItemText>{option.label}</Select.ItemText>
            <Select.ItemIndicator className="select-item-indicator"><Check size={14} /></Select.ItemIndicator>
          </Select.Item>)}
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>;
}
