import { useEffect, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type {
  DirectoryOption,
  NovaPoshtaDirectoryKind,
  NovaPoshtaDirectoryPurpose,
} from "@/lib/shipping/types";
import { shippingService } from "@/services/shippingService";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function NovaPoshtaDirectoryPicker({
  workspaceId,
  kind,
  valueRef,
  valueName,
  placeholder,
  enabled,
  cityRef,
  counterpartyRef,
  purpose = "recipient",
  onSelect,
}: {
  workspaceId: string;
  kind: NovaPoshtaDirectoryKind;
  valueRef: string;
  valueName: string;
  placeholder: string;
  enabled: boolean;
  cityRef?: string;
  counterpartyRef?: string;
  purpose?: NovaPoshtaDirectoryPurpose;
  onSelect: (option: DirectoryOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const directoryQuery = useQuery({
    queryKey: ["nova-poshta-directory", workspaceId, kind, debouncedSearch, cityRef, purpose],
    queryFn: () =>
      shippingService.searchDirectory(workspaceId, kind, debouncedSearch, {
        cityRef,
        purpose,
        counterpartyRef,
      }),
    enabled:
      open &&
      enabled &&
      (["divisions", "senderAddresses", "senderContacts"].includes(kind) ||
        debouncedSearch.length >= 2) &&
      (kind !== "divisions" || Boolean(cityRef)) &&
      (!["senderAddresses", "senderContacts"].includes(kind) || Boolean(counterpartyRef)),
    staleTime: 60_000,
  });

  const options = directoryQuery.data ?? [];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={
            !enabled ||
            (kind === "divisions" && !cityRef) ||
            (["senderAddresses", "senderContacts"].includes(kind) && !counterpartyRef)
          }
          className="h-10 w-full min-w-0 justify-between bg-background font-normal"
        >
          <span className="truncate text-left">
            {valueRef && valueName ? valueName : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={search} onValueChange={setSearch} placeholder={placeholder} />
          <CommandList>
            {directoryQuery.isLoading ? (
              <div className="flex items-center justify-center py-5 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : directoryQuery.isError ? (
              <CommandEmpty>{t("Could not search the Nova Poshta directory.")}</CommandEmpty>
            ) : options.length === 0 ? (
              <CommandEmpty>
                {kind === "cities" && debouncedSearch.length < 2
                  ? t("Enter at least two characters.")
                  : t("No matching options.")}
              </CommandEmpty>
            ) : (
              options.map((option) => (
                <CommandItem
                  key={option.ref}
                  value={option.ref}
                  onSelect={() => {
                    onSelect(option);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <Check
                    className={`h-4 w-4 ${valueRef === option.ref ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="min-w-0 truncate">{option.description}</span>
                  {option.detail && (
                    <span className="ml-auto text-xs text-muted-foreground">{option.detail}</span>
                  )}
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
