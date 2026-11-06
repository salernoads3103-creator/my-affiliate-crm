import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Rocket, Search } from "lucide-react";
import { OfferLaunchDialog } from "@/components/offers/OfferLaunchDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLocale } from "@/components/locale-provider";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { buildLaunchSummaries } from "@/lib/launches/summary";
import { formatMinorUnits } from "@/lib/products/money";
import { localizeError, t } from "@/lib/i18n";
import { landingService } from "@/services/landingService";
import { offerService } from "@/services/offerService";
import { offerLaunchService } from "@/services/offerLaunchService";

export const Route = createFileRoute("/_authenticated/launches")({ component: LaunchesPage });

function LaunchesPage() {
  const { locale } = useLocale();
  const { workspace, permissions, isLoading: accessLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canReadOffers =
    permissions["offers.read"] === true && permissions["products.read"] === true;
  const canReadLandings =
    permissions["landing_pages.read"] === true || permissions["landing_pages.manage"] === true;
  const canLaunch =
    permissions["offers.manage"] === true &&
    permissions["products.read"] === true &&
    permissions["landing_pages.manage"] === true;
  const [search, setSearch] = useState("");
  const [launchOpen, setLaunchOpen] = useState(false);
  const [resumeLaunchId, setResumeLaunchId] = useState<string | null>(null);

  const offersQuery = useQuery({
    queryKey: ["workspace-offers-catalog", workspaceId, "launches"],
    queryFn: () => offerService.list(workspaceId!, ""),
    enabled: Boolean(workspaceId && canReadOffers),
  });
  const landingsQuery = useQuery({
    queryKey: ["workspace-landings", workspaceId, "launches"],
    queryFn: () => landingService.list(workspaceId!, ""),
    enabled: Boolean(workspaceId && canReadLandings),
  });
  const launchesQuery = useQuery({
    queryKey: ["offer-launches", workspaceId],
    queryFn: () => offerLaunchService.list(workspaceId!),
    enabled: Boolean(workspaceId && canReadOffers && canReadLandings),
  });

  const rows = useMemo(() => {
    const summaries = buildLaunchSummaries(
      offersQuery.data?.offers ?? [],
      landingsQuery.data?.landings ?? [],
      launchesQuery.data ?? [],
    );
    const query = search.trim().toLocaleLowerCase();
    return query
      ? summaries.filter((row) =>
          `${row.offer.name} ${row.offer.product_name ?? ""} ${row.publishedUrl ?? ""}`
            .toLocaleLowerCase()
            .includes(query),
        )
      : summaries;
  }, [offersQuery.data?.offers, landingsQuery.data?.landings, launchesQuery.data, search]);

  if (accessLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspaceId || !canReadOffers || !canReadLandings) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Launches")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view launches.")}
        </p>
      </section>
    );
  }

  const loadError = offersQuery.error || landingsQuery.error || launchesQuery.error;
  const loading = offersQuery.isLoading || landingsQuery.isLoading || launchesQuery.isLoading;
  const queryError = offersQuery.isError || landingsQuery.isError || launchesQuery.isError;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("Product to published link")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{t("Launches")}</h1>
        </div>
        {canLaunch && (
          <Button
            onClick={() => {
              setResumeLaunchId(null);
              setLaunchOpen(true);
            }}
          >
            <Rocket className="mr-2 h-4 w-4" />
            {t("Create launch")}
          </Button>
        )}
      </header>

      <div className="glass rounded-2xl border border-border p-4 sm:p-5">
        <div className="relative max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("Search launches…")}
            placeholder={t("Search launches…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : queryError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(loadError, t("Could not load launches."), locale)}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  void Promise.all([
                    offersQuery.refetch(),
                    landingsQuery.refetch(),
                    launchesQuery.refetch(),
                  ])
                }
              >
                {t("Try again")}
              </Button>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-14 text-center">
            <h2 className="font-semibold">
              {search.trim() ? t("No launches match your search.") : t("No launches yet")}
            </h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {t("Start with a product, then prepare its offer and landing in one launch flow.")}
            </p>
            {canLaunch && (
              <Button
                className="mt-4"
                onClick={() => {
                  setResumeLaunchId(null);
                  setLaunchOpen(true);
                }}
              >
                <Rocket className="mr-2 h-4 w-4" />
                {t("Create launch")}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Launch / offer")}</TableHead>
                  <TableHead>{t("Product")}</TableHead>
                  <TableHead>{t("Offer price")}</TableHead>
                  <TableHead>{t("Landings")}</TableHead>
                  <TableHead>{t("Domain / published URL")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead className="text-right">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.offer.id}>
                    <TableCell className="min-w-44 font-medium">{row.offer.name}</TableCell>
                    <TableCell className="min-w-36">{row.offer.product_name ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {row.offer.offer_price_minor == null
                        ? "—"
                        : formatMinorUnits(row.offer.offer_price_minor, locale)}
                    </TableCell>
                    <TableCell>{row.landingCount}</TableCell>
                    <TableCell className="max-w-64">
                      {row.publishedUrl ? (
                        <a
                          className="inline-flex max-w-full items-center gap-1 break-all text-primary hover:underline"
                          href={row.publishedUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="line-clamp-2">{row.publishedUrl}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      ) : row.hostname ? (
                        <span className="break-all text-sm text-muted-foreground">
                          {row.hostname}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">{t("Not published")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "Error"
                            ? "destructive"
                            : row.status === "Published"
                              ? "default"
                              : "secondary"
                        }
                      >
                        {t(row.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {permissions["offers.read"] && permissions["products.read"] && (
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/offers">{t("Offers")}</Link>
                          </Button>
                        )}
                        {canReadLandings && (
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/landings">{t("Landing pages")}</Link>
                          </Button>
                        )}
                        {canLaunch && row.workflow && row.workflow.stage !== "published" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={row.workflow.isProcessing}
                            onClick={() => {
                              setResumeLaunchId(row.workflow!.launchId);
                              setLaunchOpen(true);
                            }}
                          >
                            {row.workflow.isProcessing
                              ? t("Launch in progress")
                              : t("Resume launch")}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {canLaunch && (
        <OfferLaunchDialog
          open={launchOpen}
          workspaceId={workspaceId}
          canCreateProduct={permissions["products.manage"] === true}
          canReadCost={permissions["products.cost.read"] === true}
          initialLaunchId={resumeLaunchId}
          onOpenChange={setLaunchOpen}
        />
      )}
    </div>
  );
}
