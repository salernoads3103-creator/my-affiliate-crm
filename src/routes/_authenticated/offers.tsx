import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { OfferModal } from "@/components/offers/OfferModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { OfferCatalogItem, OfferWriteRequest } from "@/lib/offers/types";
import { formatMinorUnits } from "@/lib/products/money";
import { localizeError, t } from "@/lib/i18n";
import { offerService } from "@/services/offerService";

export const Route = createFileRoute("/_authenticated/offers")({ component: OffersPage });

const OFFERS_QUERY_KEY = ["workspace-offers-catalog"] as const;

function OffersPage() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { workspace, permissions, isLoading: accessLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canReadOffers = permissions["offers.read"] === true;
  const canReadProducts = permissions["products.read"] === true;
  const canManageOffers = permissions["offers.manage"] === true && canReadProducts;
  const canLaunchOffer = canManageOffers && permissions["landing_pages.manage"] === true;
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<OfferCatalogItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OfferCatalogItem | null>(null);

  const offersQuery = useQuery({
    queryKey: [...OFFERS_QUERY_KEY, workspaceId, search.trim()],
    queryFn: () => offerService.list(workspaceId!, search),
    enabled: Boolean(workspaceId && canReadOffers && canReadProducts),
  });

  const saveMutation = useMutation({
    mutationFn: (input: OfferWriteRequest) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return editingOffer
        ? offerService.update(workspaceId, editingOffer.id, input)
        : offerService.create(workspaceId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: OFFERS_QUERY_KEY });
      toast.success(editingOffer ? t("Offer updated") : t("Offer created"));
      setModalOpen(false);
      setEditingOffer(null);
    },
    onError: (error) => toast.error(localizeError(error, t("Failed to save offer"), locale)),
  });

  const activeMutation = useMutation({
    mutationFn: ({ offerId, isActive }: { offerId: string; isActive: boolean }) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return offerService.setActive(workspaceId, offerId, isActive);
    },
    onSuccess: async (_, input) => {
      await queryClient.invalidateQueries({ queryKey: OFFERS_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["offer-launches"] });
      toast.success(t(input.isActive ? "Offer activated" : "Offer deactivated"));
    },
    onError: (error) => toast.error(localizeError(error, t("Failed to save offer"), locale)),
  });

  const deleteMutation = useMutation({
    mutationFn: (offerId: string) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return offerService.delete(workspaceId, offerId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: OFFERS_QUERY_KEY });
      toast.success(t("Offer deleted"));
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(localizeError(error, t("Could not delete offer."), locale)),
  });

  const openCreate = () => {
    setEditingOffer(null);
    setModalOpen(true);
  };
  const openEdit = (offer: OfferCatalogItem) => {
    setEditingOffer(offer);
    setModalOpen(true);
  };

  if (accessLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspaceId || !canReadOffers || !canReadProducts) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Offers")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view offers.")}
        </p>
      </section>
    );
  }

  const offers = offersQuery.data?.offers ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("Offers based on products")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{t("Offers")}</h1>
        </div>
        {canManageOffers && (
          <div className="flex flex-wrap gap-2">
            {canLaunchOffer && (
              <Button asChild>
                <Link to="/launches">{t("Create launch")}</Link>
              </Button>
            )}
            <Button variant="outline" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t("Create offer")}
            </Button>
          </div>
        )}
      </header>

      <div className="glass rounded-2xl border border-border p-4 sm:p-5">
        <div className="relative max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("Search offers…")}
            placeholder={t("Search offers…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        {offersQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : offersQuery.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(offersQuery.error, t("Could not load offers."), locale)}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void offersQuery.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        ) : offers.length === 0 ? (
          <div className="py-14 text-center">
            <h2 className="font-semibold">
              {search.trim() ? t("No offers match your search.") : t("No offers yet")}
            </h2>
            {!search.trim() && (
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {t("Create an offer from a product in your catalog.")}
              </p>
            )}
            {!search.trim() && canManageOffers && (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {canLaunchOffer && (
                  <Button asChild>
                    <Link to="/launches">{t("Create launch")}</Link>
                  </Button>
                )}
                <Button variant="outline" onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  {t("Create offer")}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Offer")}</TableHead>
                  <TableHead>{t("Product")}</TableHead>
                  <TableHead>{t("Sale price")}</TableHead>
                  <TableHead>{t("Offer price")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  {canManageOffers && <TableHead className="text-right">{t("Actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {offers.map((offer) => (
                  <TableRow key={offer.id}>
                    <TableCell>
                      <div className="font-medium">{offer.name}</div>
                      {offer.landing_url && (
                        <a
                          className="text-xs text-primary hover:underline"
                          href={offer.landing_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("Landing page")}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-48 items-center gap-3">
                        {offer.product_photo_url ? (
                          <img
                            src={offer.product_photo_url}
                            alt=""
                            className="h-10 w-10 rounded-lg border border-border object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                            <ImageIcon className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {offer.product_name ?? t("Product not linked")}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {offer.product_sku || "—"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {offer.product_sale_price_minor == null
                        ? "—"
                        : formatMinorUnits(offer.product_sale_price_minor, locale)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-semibold">
                      {offer.offer_price_minor == null
                        ? "—"
                        : formatMinorUnits(offer.offer_price_minor, locale)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={offer.is_active ? "default" : "secondary"}>
                        {offer.is_active ? t("Active") : t("Inactive")}
                      </Badge>
                    </TableCell>
                    {canManageOffers && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={t("More actions")}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => openEdit(offer)}>
                              <Pencil className="h-4 w-4" />
                              {t("Edit offer")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={activeMutation.isPending}
                              onSelect={() =>
                                activeMutation.mutate({
                                  offerId: offer.id,
                                  isActive: !offer.is_active,
                                })
                              }
                            >
                              {t(offer.is_active ? "Deactivate" : "Activate")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setDeleteTarget(offer)}
                            >
                              <Trash2 className="h-4 w-4" />
                              {t("Delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <OfferModal
        open={modalOpen}
        workspaceId={workspaceId}
        offer={editingOffer}
        saving={saveMutation.isPending}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingOffer(null);
        }}
        onSave={async (values) => {
          await saveMutation.mutateAsync(values);
        }}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete this offer?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t("{name} will be permanently removed. This action cannot be undone.", {
                    name: deleteTarget.name,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
