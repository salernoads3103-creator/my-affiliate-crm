import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Search,
  Download,
  Pencil,
  Trash2,
  Filter,
  Inbox,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import { LeadModal } from "@/components/leads/LeadModal";
import { DeleteModal } from "@/components/leads/DeleteModal";
import { LeadDetailsDrawer } from "@/components/leads/LeadDetailsDrawer";
import { StatusBadge } from "@/components/leads/StatusBadge";
import { useLeads, useRestoreLead, useSearchLeads, useUpdateLead } from "@/hooks/useLeadsApi";
import { useDebounce } from "@/hooks/useDebounce";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/leads/types";
import { leadCountLabel, leadStatusLabel, t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_BADGE_STYLES } from "@/components/leads/statusBadgeStyles";
import { Button } from "@/components/ui/button";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const Route = createFileRoute("/_authenticated/leads")({
  validateSearch: (s: Record<string, unknown>) => ({ new: s.new === true || s.new === "true" }),
  component: LeadsPage,
});

const PAGE_SIZE = 10;

function LeadsPage() {
  const { locale } = useLocale();
  const { workspace, isSuperAdmin, permissions } = useWorkspaceAccess();
  const isWorkspaceAdmin = workspace?.role === "admin" || isSuperAdmin;
  const canDeleteLeads = isSuperAdmin || permissions["leads.delete"] === true;
  const { new: openNew } = Route.useSearch();
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 250);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "All">("All");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [showHiddenLeads, setShowHiddenLeads] = useState(false);
  const includeDeleted = showHiddenLeads && isWorkspaceAdmin;

  useEffect(() => {
    if (openNew) setModalOpen(true);
  }, [openNew]);

  const allQuery = useLeads(includeDeleted);
  const searchQuery = useSearchLeads(debounced, includeDeleted);
  const source = debounced.trim() ? searchQuery : allQuery;
  const data = useMemo(() => source.data ?? [], [source.data]);

  const filtered = useMemo(
    () => (statusFilter === "All" ? data : data.filter((l) => l.lead_status === statusFilter)),
    [data, statusFilter],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );
  const restoreLead = useRestoreLead();
  useEffect(() => {
    setPage(1);
  }, [debounced, statusFilter]);

  const exportCsv = () => {
    const rows = [
      [t("Name"), t("Email"), t("Phone"), t("Company"), t("Status"), t("Notes"), t("Created")],
      ...filtered.map((l) => [
        l.name,
        l.email ?? "",
        l.phone ?? "",
        l.company_name ?? "",
        leadStatusLabel(l.lead_status, locale),
        (l.notes ?? "").replace(/\n/g, " "),
        l.created_at,
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openEdit = (l: Lead) => {
    setEditing(l);
    setModalOpen(true);
  };
  const close = () => {
    setModalOpen(false);
    setEditing(null);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t("Leads")}</h1>
          <p className="text-sm text-muted-foreground">{leadCountLabel(filtered.length, locale)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isWorkspaceAdmin && (
            <Button
              variant={includeDeleted ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setShowHiddenLeads(!includeDeleted);
                setPage(1);
                setSelectedLead(null);
              }}
            >
              {t(includeDeleted ? "Show active leads" : "Show hidden leads")}
            </Button>
          )}
          <button
            onClick={exportCsv}
            className="rounded-xl border border-border bg-input/30 hover:bg-input/60 px-3 py-2 text-sm flex items-center gap-2 transition"
          >
            <Download className="h-4 w-4" /> {t("Export")}
          </button>
          {!includeDeleted && (
            <button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              className="rounded-xl gradient-brand text-primary-foreground text-sm font-medium px-4 py-2 flex items-center gap-2 hover:opacity-95 active:scale-[0.99] transition shadow-lg shadow-primary/20"
            >
              <Plus className="h-4 w-4" /> {t("Add lead")}
            </button>
          )}
        </div>
      </header>

      <div className="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search by name, email, or company…")}
            className="w-full rounded-xl bg-input/40 border border-border pl-9 pr-3 py-2 text-sm outline-none focus:ring-4 focus:ring-ring transition"
          />
        </div>
        <div className="relative flex items-center">
          <Filter className="pointer-events-none absolute left-3 z-10 h-4 w-4 text-muted-foreground" />
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as LeadStatus | "All")}
          >
            <SelectTrigger
              aria-label={t("All statuses")}
              className="h-10 w-[11.5rem] rounded-xl border-border bg-input/40 pl-9 pr-3 text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="min-w-[11.5rem]">
              <SelectItem value="All">{t("All statuses")}</SelectItem>
              {LEAD_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {leadStatusLabel(status, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {source.isLoading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        includeDeleted ? (
          <div className="glass rounded-2xl px-6 py-12 text-center text-sm text-muted-foreground">
            {t("No hidden leads match these filters.")}
          </div>
        ) : (
          <EmptyState
            onAdd={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          />
        )
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden md:block glass rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">{t("Name")}</th>
                  <th className="text-left px-5 py-3 font-medium">{t("Company")}</th>
                  <th className="text-left px-5 py-3 font-medium">{t("Email")}</th>
                  <th className="text-left px-5 py-3 font-medium">{t("Phone")}</th>
                  <th className="text-left px-5 py-3 font-medium">{t("Status")}</th>
                  <th className="text-right px-5 py-3 font-medium">{t("Actions")}</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {current.map((l) => (
                    <motion.tr
                      key={l.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      onClick={() => setSelectedLead(l)}
                      className="border-t border-border hover:bg-muted/30 transition group cursor-pointer"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg gradient-brand text-white flex items-center justify-center text-xs font-semibold">
                            {l.name.charAt(0).toUpperCase()}
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedLead(l);
                            }}
                            className="text-left font-medium focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={t("View details for {name}", { name: l.name })}
                          >
                            {l.name}
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{l.company_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{l.email ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                      <td className="px-5 py-3" onClick={(event) => event.stopPropagation()}>
                        {l.deleted_at ? (
                          <StatusBadge status={l.lead_status} />
                        ) : (
                          <StatusSelector lead={l} />
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div
                          className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={t("More actions")}>
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {l.deleted_at ? (
                                <DropdownMenuItem
                                  disabled={restoreLead.isPending}
                                  onSelect={() => restoreLead.mutate(l.id)}
                                >
                                  <RotateCcw className="h-4 w-4" />
                                  {t("Restore lead")}
                                </DropdownMenuItem>
                              ) : (
                                <>
                                  <DropdownMenuItem onSelect={() => openEdit(l)}>
                                    <Pencil className="h-4 w-4" />
                                    {t("Edit")}
                                  </DropdownMenuItem>
                                  {canDeleteLeads && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        className="text-destructive focus:text-destructive"
                                        onSelect={() => setDeleting(l)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                        {t("Delete")}
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {current.map((l) => (
              <motion.div
                key={l.id}
                layout
                onClick={() => setSelectedLead(l)}
                className="glass rounded-2xl p-4 cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl gradient-brand text-white flex items-center justify-center font-semibold">
                    {l.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedLead(l);
                      }}
                      className="block max-w-full truncate text-left font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("View details for {name}", { name: l.name })}
                    >
                      {l.name}
                    </button>
                    <div className="text-xs text-muted-foreground truncate">{l.email ?? "—"}</div>
                  </div>
                  <StatusBadge status={l.lead_status} />
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {l.company_name ?? "—"} · {l.phone ?? "—"}
                </div>
                <div
                  className="mt-3 flex justify-end gap-2"
                  onClick={(event) => event.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" aria-label={t("More actions")}>
                        <MoreHorizontal className="h-4 w-4" />
                        {t("Actions")}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {l.deleted_at ? (
                        <DropdownMenuItem
                          disabled={restoreLead.isPending}
                          onSelect={() => restoreLead.mutate(l.id)}
                        >
                          <RotateCcw className="h-4 w-4" />
                          {t("Restore lead")}
                        </DropdownMenuItem>
                      ) : (
                        <>
                          <DropdownMenuItem onSelect={() => openEdit(l)}>
                            <Pencil className="h-4 w-4" />
                            {t("Edit")}
                          </DropdownMenuItem>
                          {canDeleteLeads && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeleting(l)}
                              >
                                <Trash2 className="h-4 w-4" />
                                {t("Delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </motion.div>
            ))}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {t("Page {page} / {totalPages}", { page, totalPages: pages })}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted/60"
                >
                  {t("Previous")}
                </button>
                <button
                  disabled={page === pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted/60"
                >
                  {t("Next")}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <LeadModal open={modalOpen} onClose={close} lead={editing} />
      <DeleteModal lead={deleting} onClose={() => setDeleting(null)} />
      <LeadDetailsDrawer
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        locale={locale}
      />
    </motion.div>
  );
}

function StatusSelector({ lead }: { lead: Lead }) {
  const update = useUpdateLead();
  return (
    <Select
      value={lead.lead_status}
      onValueChange={(value) =>
        update.mutate({ id: lead.id, input: { lead_status: value as LeadStatus } })
      }
    >
      <SelectTrigger
        aria-label={`${t("Status")}: ${leadStatusLabel(lead.lead_status)}`}
        className={`h-auto w-auto min-w-0 gap-1.5 rounded-full border-0 bg-transparent p-0 shadow-none ring-1 ring-inset focus:ring-2 focus:ring-ring [&>svg]:h-3 [&>svg]:w-3 [&>svg]:opacity-60 ${STATUS_BADGE_STYLES[lead.lead_status]}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[11rem]">
        {LEAD_STATUSES.map((status) => (
          <SelectItem key={status} value={status} className="py-2">
            <StatusBadge status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TableSkeleton() {
  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="h-8 w-8 rounded-lg bg-muted" />
          <div className="flex-1 h-4 rounded bg-muted" />
          <div className="w-20 h-4 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="glass rounded-3xl p-12 text-center">
      <div className="mx-auto h-14 w-14 rounded-2xl gradient-brand text-white flex items-center justify-center shadow-xl shadow-primary/20">
        <Inbox className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">{t("No leads yet")}</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-sm mx-auto">
        {t(
          "Start building your pipeline. Add your first lead to track conversations and conversions.",
        )}
      </p>
      <button
        onClick={onAdd}
        className="mt-5 rounded-xl gradient-brand text-primary-foreground text-sm font-medium px-5 py-2.5 inline-flex items-center gap-2 hover:opacity-95 transition"
      >
        <Plus className="h-4 w-4" /> {t("Add your first lead")}
      </button>
    </div>
  );
}
