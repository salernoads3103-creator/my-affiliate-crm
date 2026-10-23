import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image as ImageIcon, Loader2, Pencil, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { ProductModal } from "@/components/products/ProductModal";
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
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { formatMinorUnits } from "@/lib/products/money";
import type { Product } from "@/lib/products/types";
import type { ProductWriteRequest } from "@/lib/products/types";
import { localizeError, t } from "@/lib/i18n";
import { productService } from "@/services/productService";

export const Route = createFileRoute("/_authenticated/products")({
  component: ProductsPage,
});

const PRODUCTS_QUERY_KEY = ["products"] as const;

function ProductsPage() {
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const { workspace, permissions, isLoading: accessLoading } = useWorkspaceAccess();
  const workspaceId = workspace?.id;
  const canReadProducts = permissions["products.read"] === true;
  const canManageProducts = permissions["products.manage"] === true;
  const canReadCost = permissions["products.cost.read"] === true;
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const productsQuery = useQuery({
    queryKey: [...PRODUCTS_QUERY_KEY, workspaceId, search.trim()],
    queryFn: () => productService.list(workspaceId!, search),
    enabled: Boolean(workspaceId && canReadProducts),
  });

  const saveMutation = useMutation({
    mutationFn: (input: ProductWriteRequest) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return editingProduct
        ? productService.update(workspaceId, editingProduct.id, input)
        : productService.create(workspaceId, input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: PRODUCTS_QUERY_KEY });
      toast.success(editingProduct ? t("Product updated") : t("Product created"));
      setModalOpen(false);
      setEditingProduct(null);
    },
    onError: (error) => toast.error(localizeError(error, t("Failed to save product"))),
  });

  const openCreate = () => {
    setEditingProduct(null);
    setModalOpen(true);
  };
  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setModalOpen(true);
  };

  if (accessLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!workspaceId || !canReadProducts) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Products")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view products.")}
        </p>
      </section>
    );
  }

  const products = productsQuery.data?.products ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t("Product catalog")}</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{t("Products")}</h1>
        </div>
        {canManageProducts && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            {t("Add product")}
          </Button>
        )}
      </header>

      <div className="glass rounded-2xl border border-border p-4 sm:p-5">
        <div className="relative max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("Search by product name or SKU…")}
            placeholder={t("Search by product name or SKU…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        {productsQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : productsQuery.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(productsQuery.error, t("Could not load products."))}
            </p>
            <Button variant="outline" className="mt-4" onClick={() => void productsQuery.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        ) : products.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-semibold">
              {search.trim() ? t("No products match your search.") : t("No products yet")}
            </h2>
            {!search.trim() && (
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {t("Add your first product to build the catalog.")}
              </p>
            )}
            {!search.trim() && canManageProducts && (
              <Button className="mt-4" onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" />
                {t("Add product")}
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Product")}</TableHead>
                  <TableHead>{t("Sale price")}</TableHead>
                  {canReadCost && <TableHead>{t("Cost price")}</TableHead>}
                  <TableHead>{t("Supplier")}</TableHead>
                  <TableHead>{t("Weight (g)")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  {canManageProducts && (
                    <TableHead className="text-right">{t("Actions")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <div className="flex min-w-48 items-center gap-3">
                        {product.photo_url ? (
                          <img
                            src={product.photo_url}
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
                          <div className="truncate font-medium text-foreground">{product.name}</div>
                          <div className="text-xs text-muted-foreground">{product.sku || "—"}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatMinorUnits(product.sale_price_minor, locale)}
                    </TableCell>
                    {canReadCost && (
                      <TableCell className="whitespace-nowrap">
                        {product.cost_price_minor == null
                          ? "—"
                          : formatMinorUnits(product.cost_price_minor, locale)}
                      </TableCell>
                    )}
                    <TableCell>{product.supplier_name || "—"}</TableCell>
                    <TableCell>
                      {product.weight_grams == null ? "—" : `${product.weight_grams} ${t("g")}`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={product.is_active ? "default" : "secondary"}>
                        {product.is_active ? t("Active") : t("Inactive")}
                      </Badge>
                    </TableCell>
                    {canManageProducts && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("Edit product")}
                          onClick={() => openEdit(product)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <ProductModal
        open={modalOpen}
        product={editingProduct}
        canReadCost={canReadCost}
        saving={saveMutation.isPending}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingProduct(null);
        }}
        onSave={(input) =>
          saveMutation
            .mutateAsync(input)
            .then(() => undefined)
            .catch(() => undefined)
        }
      />
    </div>
  );
}
