import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/components/locale-provider";
import { OrderDetailsDrawer } from "@/components/orders/OrderDetailsDrawer";
import { OrderFormDialog } from "@/components/orders/OrderFormDialog";
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
import { useOrders, ORDER_KEYS } from "@/hooks/useOrdersApi";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import type { Order } from "@/lib/orders/types";
import { formatMinorUnits } from "@/lib/products/money";
import { localizeError, t } from "@/lib/i18n";
import { orderService } from "@/services/orderService";

export const Route = createFileRoute("/_authenticated/orders")({
  component: OrdersPage,
});

const EMPTY_ORDERS: Order[] = [];

function OrdersPage() {
  const { locale } = useLocale();
  const access = useWorkspaceAccess();
  const queryClient = useQueryClient();
  const workspaceId = access.workspace?.id;
  const canRead = access.permissions["orders.read"] === true;
  const canManage = access.permissions["orders.manage"] === true;
  const canViewOrders = canRead || canManage || access.isSuperAdmin;
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const ordersQuery = useOrders(workspaceId, search);

  const statusMutation = useMutation({
    mutationFn: ({ orderId, status }: { orderId: string; status: "confirmed" | "cancelled" }) => {
      if (!workspaceId) throw new Error("Workspace is unavailable");
      return orderService.transition(workspaceId, orderId, { status });
    },
    onSuccess: async (_result, variables) => {
      await queryClient.invalidateQueries({ queryKey: ORDER_KEYS.all });
      toast.success(variables.status === "confirmed" ? t("Order confirmed") : t("Order cancelled"));
    },
    onError: (error) =>
      toast.error(localizeError(error, t("Could not update the order status."), locale)),
  });

  const orders = ordersQuery.data ?? EMPTY_ORDERS;
  const selectedOrder = useMemo(
    () => orders.find((item) => item.id === selectedOrderId) ?? null,
    [orders, selectedOrderId],
  );

  if (access.isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!workspaceId || !canViewOrders) {
    return (
      <section className="glass rounded-2xl border border-border p-8 text-center">
        <h1 className="text-2xl font-semibold">{t("Orders")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("You don't have permission to view orders.")}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("Orders")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("Orders linked to your leads.")}</p>
        </div>
      </header>

      <section className="glass rounded-2xl border border-border p-4 sm:p-5">
        <div className="relative max-w-lg">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={t("Search orders…")}
            placeholder={t("Search orders…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>

        {ordersQuery.isLoading ? (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : ordersQuery.isError ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">
              {localizeError(ordersQuery.error, t("Could not load orders."), locale)}
            </p>
            <Button className="mt-4" variant="outline" onClick={() => void ordersQuery.refetch()}>
              {t("Try again")}
            </Button>
          </div>
        ) : orders.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ClipboardList className="h-5 w-5" />
            </div>
            <h2 className="mt-4 font-semibold">
              {search.trim() ? t("No orders match your search.") : t("No orders yet")}
            </h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {t("Create an order from a lead after the customer confirms it.")}
            </p>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Customer")}</TableHead>
                  <TableHead>{t("Product")}</TableHead>
                  <TableHead>{t("Total")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead>{t("Created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow
                    key={order.id}
                    tabIndex={0}
                    role="button"
                    aria-label={t("View order for {name}", { name: order.buyer_name })}
                    className="cursor-pointer"
                    onClick={() => setSelectedOrderId(order.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedOrderId(order.id);
                      }
                    }}
                  >
                    <TableCell>
                      <div className="font-medium">{order.buyer_name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {order.buyer_phone}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{order.product_name_snapshot}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {order.offer_name_snapshot}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium">
                      {formatMinorUnits(order.total_amount_minor, locale)}
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(order.created_at, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <OrderDetailsDrawer
        order={selectedOrder}
        canManage={canManage || access.isSuperAdmin}
        transitioning={statusMutation.isPending}
        onClose={() => setSelectedOrderId(null)}
        onEdit={(order) => setEditingOrder(order)}
        onTransition={(status) =>
          selectedOrder && statusMutation.mutate({ orderId: selectedOrder.id, status })
        }
      />
      <OrderFormDialog
        open={editingOrder !== null}
        onOpenChange={(open) => !open && setEditingOrder(null)}
        workspaceId={workspaceId}
        order={editingOrder}
        onSaved={() => setEditingOrder(null)}
      />
    </div>
  );
}

function OrderStatusBadge({ status }: { status: Order["status"] }) {
  const className =
    status === "confirmed"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "cancelled"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border bg-muted text-muted-foreground";
  return (
    <Badge variant="outline" className={className}>
      {t(status)}
    </Badge>
  );
}

function formatDate(value: string, locale: "uk" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "uk" ? "uk-UA" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
