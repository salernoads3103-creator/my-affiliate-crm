import { useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe2, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { BulkDomainResult, DomainAddress, DomainTechnicalStatus } from "@/lib/domains/types";
import {
  countBulkDomainResults,
  filterDomainAddresses,
  type DomainTechnicalFilter,
  type DomainUsageFilter,
} from "@/lib/domains/presentation";
import { localizeError, t, type TranslationKey } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { domainService } from "@/services/domainService";

export const Route = createFileRoute("/_authenticated/domains")({ component: DomainsPage });

const DOMAINS_QUERY_KEY = ["workspace-domains"] as const;
const EMPTY_ADDRESSES: DomainAddress[] = [];

const TECHNICAL_FILTERS: { value: DomainTechnicalFilter; label: TranslationKey }[] = [
  { value: "all", label: "All technical states" },
  { value: "not_configured", label: "Not checked yet" },
  { value: "checking", label: "Checking DNS and HTTPS…" },
  { value: "ready", label: "DNS and HTTPS confirmed" },
  { value: "error", label: "Could not confirm DNS or HTTPS" },
];

const USAGE_FILTERS: { value: DomainUsageFilter; label: TranslationKey }[] = [
  { value: "all", label: "All usage states" },
  { value: "free", label: "Free" },
  { value: "reserved", label: "Reserved" },
  { value: "published", label: "Published address" },
  { value: "disabled", label: "Disabled address" },
];

const TECHNICAL_LABEL: Record<DomainTechnicalStatus, TranslationKey> = {
  not_configured: "Not checked yet",
  checking: "Checking DNS and HTTPS…",
  ready: "DNS and HTTPS confirmed",
  error: "Could not confirm DNS or HTTPS",
};

const USAGE_LABEL: Record<DomainAddress["usageStatus"], TranslationKey> = {
  free: "Free",
  reserved: "Reserved",
  published: "Published address",
  disabled: "Disabled address",
};

function technicalBadgeClass(status: DomainTechnicalStatus): string {
  if (status === "ready") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "error") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (status === "checking") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

function usageBadgeClass(status: DomainAddress["usageStatus"]): string {
  if (status === "published") {
    return "border-primary/30 bg-primary/10 text-primary";
  }
  if (status === "reserved") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

function formatDate(value: string, locale: "uk" | "en"): string {
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Kyiv",
  }).format(new Date(value));
}

function bulkResultLabel(result: BulkDomainResult): TranslationKey {
  if (result.status === "added") return "Added";
  if (result.status === "already_exists") return "Already exists";
  if (result.status === "conflict") return "Conflict";
  return "Invalid hostname";
}

function bulkResultClass(result: BulkDomainResult): string {
  if (result.status === "added") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (result.status === "conflict" || result.status === "invalid") {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  return "border-border bg-muted/40 text-muted-foreground";
}

function DomainsPage() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const {
    workspace,
    permissions,
    isLoading: accessLoading,
    error: accessError,
    refetch,
  } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canRead =
    permissions["landing_pages.read"] === true || permissions["landing_pages.manage"] === true;
  const canManage = permissions["landing_pages.manage"] === true;

  const [domainName, setDomainName] = useState("");
  const [selectedDomainId, setSelectedDomainId] = useState("");
  const [hostnames, setHostnames] = useState("");
  const [bulkResults, setBulkResults] = useState<BulkDomainResult[] | null>(null);
  const [search, setSearch] = useState("");
  const [technicalFilter, setTechnicalFilter] = useState<DomainTechnicalFilter>("all");
  const [usageFilter, setUsageFilter] = useState<DomainUsageFilter>("all");
  const [verifyingHostId, setVerifyingHostId] = useState<string | null>(null);

  const domainsQuery = useQuery({
    queryKey: [...DOMAINS_QUERY_KEY, workspaceId],
    queryFn: () => domainService.list(workspaceId!),
    enabled: Boolean(workspaceId && canRead),
  });

  const addresses = domainsQuery.data ?? EMPTY_ADDRESSES;
  const rootDomains = addresses.filter((address) => address.addressType === "root");
  const selectedRoot =
    rootDomains.find((address) => address.domainId === selectedDomainId) ?? rootDomains[0] ?? null;
  const visibleAddresses = useMemo(
    () => filterDomainAddresses(addresses, search, technicalFilter, usageFilter),
    [addresses, search, technicalFilter, usageFilter],
  );

  const invalidateDomains = () =>
    queryClient.invalidateQueries({ queryKey: DOMAINS_QUERY_KEY, refetchType: "active" });

  const createDomainMutation = useMutation({
    mutationFn: (name: string) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return domainService.createRoot(workspaceId, name);
    },
    onSuccess: async ({ domainId }) => {
      setSelectedDomainId(domainId);
      setDomainName("");
      toast.success(t("Domain connected"));
      await invalidateDomains();
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not connect the domain."), locale)),
  });

  const addSubdomainsMutation = useMutation({
    mutationFn: ({ domainId, input }: { domainId: string; input: string }) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return domainService.addSubdomains(workspaceId, domainId, input);
    },
    onSuccess: async (results) => {
      setBulkResults(results);
      setHostnames("");
      await invalidateDomains();
    },
    onError: (error) => toast.error(localizeError(error, t("Could not add subdomains."), locale)),
  });

  const verifyMutation = useMutation({
    mutationFn: (hostId: string) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return domainService.verifyHost(workspaceId, hostId);
    },
    onSuccess: async (result) => {
      await invalidateDomains();
      if (result.technicalStatus === "ready") {
        toast.success(t("DNS and HTTPS confirmed"));
      } else {
        toast.error(
          result.errorCode === "TIMEOUT"
            ? t("Timeout during the DNS/HTTPS check")
            : t("DNS or HTTPS is not reachable"),
        );
      }
    },
    onError: (error) => toast.error(localizeError(error, t("Could not check DNS/HTTPS."), locale)),
    onSettled: () => setVerifyingHostId(null),
  });

  const submitDomain = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = domainName.trim();
    if (trimmedName) createDomainMutation.mutate(trimmedName);
  };

  const submitSubdomains = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRoot || selectedRoot.domainStatus !== "active" || !hostnames.trim()) return;
    setBulkResults(null);
    addSubdomainsMutation.mutate({ domainId: selectedRoot.domainId, input: hostnames });
  };

  const copyHostname = async (hostname: string) => {
    try {
      await navigator.clipboard.writeText(hostname);
      toast.success(t("Hostname copied"));
    } catch {
      toast.error(t("Could not copy hostname."));
    }
  };

  const verifyHost = (hostId: string) => {
    if (verifyMutation.isPending) return;
    setVerifyingHostId(hostId);
    verifyMutation.mutate(hostId);
  };

  if (accessLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2
          className="h-6 w-6 animate-spin text-muted-foreground"
          aria-label={t("Loading…")}
        />
      </div>
    );
  }

  if (accessError) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <p className="text-sm text-destructive">
          {localizeError(
            accessError,
            t("We couldn't load the access details. Please try again."),
            locale,
          )}
        </p>
        <Button variant="outline" className="mt-4" onClick={() => void refetch()}>
          {t("Try again")}
        </Button>
      </section>
    );
  }

  if (!workspaceId || !canRead) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Domains")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view domains.")}
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto min-w-0 max-w-6xl space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          {t("Addresses for landing pages")}
        </p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("Domains")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("Add a purchased domain to CRMONIA, then build a pool of subdomains.")}
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {canManage && (
          <section className="glass min-w-0 space-y-4 rounded-2xl border border-border p-4 sm:p-5">
            <div>
              <h2 className="font-semibold">{t("Connect main domain")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "Adding an address to CRMONIA does not change DNS or publish a site. Configure DNS with your provider, then run the check.",
                )}
              </p>
            </div>
            <form onSubmit={submitDomain} className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <Label htmlFor="domain-name" className="sr-only">
                  {t("Main domain")}
                </Label>
                <Input
                  id="domain-name"
                  value={domainName}
                  onChange={(event) => setDomainName(event.target.value)}
                  placeholder={t("Enter a domain, such as myshop.com")}
                  autoCapitalize="none"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  maxLength={253}
                  disabled={createDomainMutation.isPending}
                />
              </div>
              <Button type="submit" disabled={!domainName.trim() || createDomainMutation.isPending}>
                {createDomainMutation.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Plus aria-hidden="true" />
                )}
                {t("Connect domain")}
              </Button>
            </form>
          </section>
        )}

        {canManage && (
          <section className="glass min-w-0 space-y-4 rounded-2xl border border-border p-4 sm:p-5">
            <div>
              <h2 className="font-semibold">{t("Add subdomains")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Enter short names or full hostnames, one per line.")}
              </p>
            </div>
            {rootDomains.length > 0 ? (
              <form onSubmit={submitSubdomains} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="subdomain-root">{t("Main domain")}</Label>
                  <Select
                    value={selectedRoot?.domainId ?? ""}
                    onValueChange={(value) => setSelectedDomainId(value)}
                  >
                    <SelectTrigger id="subdomain-root" className="w-full">
                      <SelectValue placeholder={t("Choose a main domain")} />
                    </SelectTrigger>
                    <SelectContent>
                      {rootDomains.map((root) => (
                        <SelectItem key={root.domainId} value={root.domainId}>
                          {root.hostname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="subdomain-lines">{t("Subdomains, one per line")}</Label>
                  <Textarea
                    id="subdomain-lines"
                    value={hostnames}
                    onChange={(event) => setHostnames(event.target.value)}
                    rows={3}
                    maxLength={120_000}
                    placeholder={`britva\nshaver.${selectedRoot?.apexDomain ?? "myshop.com"}`}
                    disabled={addSubdomainsMutation.isPending}
                    className="resize-y text-sm"
                  />
                </div>
                {selectedRoot?.domainStatus !== "active" && (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    {t("Verify the main domain before adding subdomains.")}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={
                    !hostnames.trim() ||
                    selectedRoot?.domainStatus !== "active" ||
                    addSubdomainsMutation.isPending
                  }
                >
                  {addSubdomainsMutation.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  {t("Add subdomains to pool")}
                </Button>
              </form>
            ) : (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                {t("No main domains yet. Connect a domain first.")}
              </div>
            )}
          </section>
        )}
      </div>

      {bulkResults && (
        <section
          className="glass space-y-3 rounded-2xl border border-border p-4 sm:p-5"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("Bulk add results")}</h2>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(countBulkDomainResults(bulkResults)).map(([status, count]) => {
                const label: TranslationKey =
                  status === "added"
                    ? "Added"
                    : status === "already_exists"
                      ? "Already exists"
                      : status === "conflict"
                        ? "Conflict"
                        : "Invalid hostname";
                return (
                  <Badge key={status} variant="outline" className="border-border bg-muted/40">
                    {t(label)}: {count}
                  </Badge>
                );
              })}
            </div>
          </div>
          <ul className="max-h-60 space-y-2 overflow-y-auto">
            {bulkResults.map((result) => (
              <li
                key={`${result.lineNumber}-${result.input}`}
                className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
              >
                <span className="min-w-0 break-all font-mono text-xs">
                  {result.hostname ?? result.input}
                  {result.status === "invalid" && result.reason === "outside_domain" && (
                    <span className="ml-2 font-sans text-muted-foreground">
                      {t("Outside the selected domain")}
                    </span>
                  )}
                </span>
                <Badge variant="outline" className={bulkResultClass(result)}>
                  {t(bulkResultLabel(result))}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass min-w-0 overflow-hidden rounded-2xl border border-border">
        <div className="space-y-4 border-b border-border p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-primary" aria-hidden="true" />
            <h2 className="font-semibold">{t("Address pool")}</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("Address is not ready. Configure DNS with your provider and run the check.")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              "This check confirms HTTPS reachability, not that the address points to CRMONIA hosting.",
            )}
          </p>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px_220px]">
            <div className="relative min-w-0">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search addresses…")}
                aria-label={t("Search addresses…")}
                className="pl-9"
              />
            </div>
            <Select
              value={technicalFilter}
              onValueChange={(value) => setTechnicalFilter(value as DomainTechnicalFilter)}
            >
              <SelectTrigger aria-label={t("Technical state")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TECHNICAL_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {t(filter.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={usageFilter}
              onValueChange={(value) => setUsageFilter(value as DomainUsageFilter)}
            >
              <SelectTrigger aria-label={t("Usage")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {USAGE_FILTERS.map((filter) => (
                  <SelectItem key={filter.value} value={filter.value}>
                    {t(filter.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {domainsQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-label={t("Loading…")}
            />
          </div>
        ) : domainsQuery.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(domainsQuery.error, t("Could not load domains."), locale)}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void domainsQuery.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        ) : addresses.length === 0 ? (
          <div className="py-14 text-center">
            <Globe2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <h3 className="mt-4 font-semibold">{t("No domains yet")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Connect your first domain to start managing addresses.")}
            </p>
          </div>
        ) : visibleAddresses.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {t("No addresses match your search or filters.")}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visibleAddresses.map((address) => (
              <DomainAddressRow
                key={address.id}
                address={address}
                locale={locale}
                canManage={canManage}
                isVerifying={verifyMutation.isPending && verifyingHostId === address.id}
                verifyDisabled={verifyMutation.isPending}
                onCopy={() => void copyHostname(address.hostname)}
                onVerify={() => verifyHost(address.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function DomainAddressRow({
  address,
  locale,
  canManage,
  isVerifying,
  verifyDisabled,
  onCopy,
  onVerify,
}: {
  address: DomainAddress;
  locale: "uk" | "en";
  canManage: boolean;
  isVerifying: boolean;
  verifyDisabled: boolean;
  onCopy: () => void;
  onVerify: () => void;
}) {
  const technicalLabel = TECHNICAL_LABEL[address.technicalStatus];
  const usageLabel = USAGE_LABEL[address.usageStatus];
  return (
    <article className="grid min-w-0 gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_minmax(155px,190px)_minmax(125px,150px)_auto] md:items-center">
      <div className="min-w-0 space-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-medium">{address.hostname}</span>
          <Badge
            variant="outline"
            className="shrink-0 border-border bg-muted/40 text-muted-foreground"
          >
            {t(address.addressType === "root" ? "Main domain" : "Subdomain")}
          </Badge>
        </div>
        {address.addressType === "subdomain" && (
          <p className="break-all text-xs text-muted-foreground">{address.apexDomain}</p>
        )}
        {address.technicalStatus === "error" && address.technicalErrorCode && (
          <p className="text-xs text-destructive">
            {t(
              address.technicalErrorCode === "TIMEOUT"
                ? "Timeout during the DNS/HTTPS check"
                : "DNS or HTTPS is not reachable",
            )}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("Technical state")}
        </p>
        <Badge variant="outline" className={technicalBadgeClass(address.technicalStatus)}>
          {address.technicalStatus === "checking" && (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
          )}
          {address.technicalStatus === "ready" && (
            <Check className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          {t(technicalLabel)}
        </Badge>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("Usage")}
        </p>
        <Badge variant="outline" className={usageBadgeClass(address.usageStatus)}>
          {t(usageLabel)}
        </Badge>
      </div>

      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3 md:justify-end">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("Date")}
          </p>
          <p className="text-xs text-muted-foreground">{formatDate(address.createdAt, locale)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title={t("Copy hostname")}
            aria-label={t("Copy hostname")}
            onClick={onCopy}
          >
            <Copy aria-hidden="true" />
          </Button>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={verifyDisabled}
              onClick={onVerify}
            >
              {isVerifying ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              <span>
                {t(address.technicalStatus === "ready" ? "Recheck DNS/HTTPS" : "Check DNS/HTTPS")}
              </span>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
