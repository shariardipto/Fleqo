"use client";

import { ArrowLeft } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Catalog, CatalogField } from "@/lib/types";

const NONE = "__none__";

// Mirrors the API's compatibility rules; the server re-validates every mapping.
const compatible: Record<string, string[]> = {
  string: ["string", "email", "currency", "integer", "datetime"],
  email: ["email"],
  integer: ["integer"],
  currency: ["currency"],
  datetime: ["datetime"],
};

export function MappingEditor({
  fields,
  sources,
  mapping,
  onChange,
  disabled,
  idPrefix,
}: {
  fields: CatalogField[];
  sources: Catalog["sources"];
  mapping: Record<string, string>;
  onChange: (mapping: Record<string, string>) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-3">
      <div className="hidden grid-cols-[1fr_auto_1fr] gap-3 text-xs font-medium text-muted-foreground sm:grid">
        <span>Destination field</span>
        <span />
        <span>Event field</span>
      </div>
      {fields.map((field) => {
        const options = sources.filter((source) => compatible[field.type]?.includes(source.type));
        const value = mapping[field.name] || NONE;
        const id = `${idPrefix}-${field.name}`;
        return (
          <div key={field.name} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
            <Label htmlFor={id} className="flex flex-col items-start gap-0.5">
              <span>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </span>
              <span className="text-xs font-normal text-muted-foreground">{field.type}</span>
            </Label>
            <ArrowLeft className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
            <Select
              value={value}
              disabled={disabled}
              onValueChange={(next) => onChange({ ...mapping, [field.name]: next === NONE ? "" : next })}
            >
              <SelectTrigger id={id} className="w-full" aria-label={`Source for ${field.label}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!field.required && <SelectItem value={NONE}>— Not mapped —</SelectItem>}
                {options.map((source) => (
                  <SelectItem key={source.path} value={source.path}>
                    {source.label} <span className="font-mono text-xs text-muted-foreground">({source.path})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
