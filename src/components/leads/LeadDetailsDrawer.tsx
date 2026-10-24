import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingCart } from "lucide-react";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { Lead } from "@/lib/leads/types";
import { formatMinorUnits } from "@/lib/products/money";
import { t } from "@/lib/i18n";
import { offerService } from "@/services/offerService";
import { OrderFormDialog } from "@/components/orders/OrderFormDialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/leads/StatusBadge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type LeadDetailsDrawerProps = {
  lead: Lead | null;
  onClose: () => void;
  locale: "uk" | "en";
};

type DetailRow = {
  label: string;
  value: string | null | undefined;
};

export function LeadDetailsDrawer({ lead, onClose, locale }: LeadDetailsDrawerProps) {
  const { workspace, permissions } = useWorkspaceAccess();
  const [orderDialogOpen, setOrderDialogOpen] = useState(false);
  const canManageOrders = permissions["orders.manage"] === true;
  const canReadOfferDetails =
    permissions["offers.read"] === true && permissions["products.read"] === true;
  const offersQuery = useQuery({
    queryKey: ["workspace-offers-catalog", workspace?.id, ""],
    queryFn: () => offerService.list(workspace!.id, ""),
    enabled: Boolean(lead?.offer_id && workspace?.id && canReadOfferDetails),
  });

  const offer = lead?.offer_id
    ? offersQuery.data?.offers.find((item) => item.id === lead.offer_id)
    : undefined;

  const close = () => {
    setOrderDialogOpen(false);
    onClose();
  };

  return (
    <>
      <Sheet open={lead !== null} onOpenChange={(open) => !open && close()}>
        <SheetContent
          side="right"
          className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        >
          {lead && (
            <>
              <div className="border-b border-border px-6 pb-5 pt-8 pr-12">
                <SheetHeader className="space-y-3 text-left">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl gradient-brand text-sm font-semibold text-white">
                        {lead.name.charAt(0).toLocaleUpperCase(locale === "uk" ? "uk-UA" : "en-US")}
                      </div>
                      <div className="min-w-0">
                        <SheetTitle className="truncate text-lg">{lead.name}</SheetTitle>
                        <SheetDescription className="mt-1">
                          {t("Created")}: {formatCreatedAt(lead.created_at, locale)}
                        </SheetDescription>
                      </div>
                    </div>
                    <StatusBadge status={lead.lead_status} />
                  </div>
                </SheetHeader>
              </div>

              <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
                <DetailsSection
                  title={t("Contact details")}
                  rows={[
                    { label: t("Name"), value: lead.name },
                    { label: t("Phone"), value: lead.phone },
                    { label: t("Email"), value: lead.email },
                    { label: t("Company"), value: lead.company_name },
                  ]}
                />

                {offer && (
                  <DetailsSection
                    title={t("Offer")}
                    rows={[
                      { label: t("Offer"), value: offer.name },
                      { label: t("Product"), value: offer.product_name },
                      {
                        label: t("Offer price"),
                        value:
                          offer.offer_price_minor === null
                            ? null
                            : formatMinorUnits(offer.offer_price_minor, locale),
                      },
                    ]}
                  />
                )}

                <DetailsSection
                  title={t("Source and attribution")}
                  rows={[
                    { label: t("Added via"), value: createdViaLabel(lead.created_via) },
                    {
                      label: t("Traffic source"),
                      value:
                        lead.traffic_source?.trim().toLowerCase() === lead.created_via
                          ? null
                          : lead.traffic_source,
                    },
                    { label: "UTM source", value: lead.utm_source },
                    { label: "UTM medium", value: lead.utm_medium },
                    { label: "UTM campaign", value: lead.utm_campaign },
                    { label: "UTM content", value: lead.utm_content },
                    { label: "UTM term", value: lead.utm_term },
                    { label: "UTM ID", value: lead.utm_id },
                    { label: "ttclid", value: lead.ttclid },
                    { label: "sub_id", value: lead.sub_id },
                  ]}
                />

                <DetailsSection
                  title={t("Delivery")}
                  rows={[
                    { label: t("Carrier"), value: carrierLabel(lead.delivery_provider) },
                    { label: t("Delivery type"), value: deliveryTypeLabel(lead.delivery_type) },
                    { label: t("City"), value: lead.delivery_city_name },
                    { label: t("Nova Poshta branch"), value: lead.delivery_warehouse_name },
                  ]}
                />
              </div>
              {canManageOrders && (
                <div className="border-t border-border px-6 py-4">
                  <Button className="w-full" onClick={() => setOrderDialogOpen(true)}>
                    <ShoppingCart className="mr-2 h-4 w-4" />
                    {t("Create order")}
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
      <OrderFormDialog
        open={orderDialogOpen}
        onOpenChange={setOrderDialogOpen}
        workspaceId={workspace?.id ?? ""}
        leadId={lead?.id}
        onSaved={() => undefined}
      />
    </>
  );
}

function DetailsSection({ title, rows }: { title: string; rows: DetailRow[] }) {
  const visibleRows = rows.filter(
    (row): row is { label: string; value: string } =>
      typeof row.value === "string" && row.value.trim().length > 0,
  );

  if (visibleRows.length === 0) return null;

  return (
    <section aria-label={title}>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <dl className="space-y-3">
        {visibleRows.map(({ label, value }) => (
          <div key={label} className="grid grid-cols-[minmax(7rem,0.7fr)_minmax(0,1.3fr)] gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="break-words text-right text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatCreatedAt(value: string, locale: "uk" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function createdViaLabel(value: Lead["created_via"]): string {
  switch (value) {
    case "manual":
      return t("Manually added");
    case "landing":
      return t("Landing page");
    case "api":
      return t("API");
    case "import":
      return t("Import");
  }
}

function deliveryTypeLabel(value: Lead["delivery_type"]): string | null {
  switch (value) {
    case "warehouse":
      return t("Branch");
    case "postomat":
      return t("Parcel locker");
    case "address":
      return t("Courier delivery");
    default:
      return null;
  }
}

function carrierLabel(value: string | null): string | null {
  if (!value) return null;
  if (
    value
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "") === "novaposhta"
  ) {
    return t("Nova Poshta");
  }
  return value;
}
