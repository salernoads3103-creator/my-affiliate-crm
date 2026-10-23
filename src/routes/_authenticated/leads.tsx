import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Search, Download, Pencil, Trash2, Filter, ChevronDown, Inbox } from "lucide-react";
import { LeadModal } from "@/components/leads/LeadModal";
import { DeleteModal } from "@/components/leads/DeleteModal";
import { StatusBadge } from "@/components/leads/StatusBadge";
import { useLeads, useSearchLeads, useUpdateLead } from "@/hooks/useLeadsApi";
import { useDebounce } from "@/hooks/useDebounce";
import { LEAD_STATUSES, type Lead, type LeadStatus } from "@/lib/leads/types";
import { leadCountLabel, t } from "@/lib/i18n";
import { useLocale } from "@/components/locale-provider";

export const Route = createFileRoute("/_authenticated/leads")({
  validateSearch: (s: Record<string, unknown>) => ({ new: s.new === true || s.new === "true" }),
  component: LeadsPage,
});

const PAGE_SIZE = 10;

function LeadsPage() {
  const { locale } = useLocale();
  const { new: openNew } = Route.useSearch();
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 250);
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "All">("All");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => { if (openNew) setModalOpen(true); }, [openNew]);

  const allQuery = useLeads();
  const searchQuery = useSearchLeads(debounced);
  const source = debounced.trim() ? searchQuery : allQuery;
  const data = source.data ?? [];

  const filtered = useMemo(
    () => (statusFilter === "All" ? data : data.filter((l) => l.lead_status === statusFilter)),
    [data, statusFilter],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);
  useEffect(() => { setPage(1); }, [debounced, statusFilter]);

  const exportCsv = () => {
    const rows = [
      [t("Name"), t("Email"), t("Phone"), t("Company"), t("Status"), t("Notes"), t("Created")],
      ...filtered.map((l) => [l.name, l.email, l.phone ?? "", l.company_name ?? "", l.lead_status, (l.notes ?? "").replace(/\n/g, " "), l.created_at]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const openEdit = (l: Lead) => { setEditing(l); setModalOpen(true); };
  const close = () => { setModalOpen(false); setEditing(null); };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{t("Leads")}</h1>
          <p className="text-sm text-muted-foreground">{leadCountLabel(filtered.length, locale)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="rounded-xl border border-border bg-input/30 hover:bg-input/60 px-3 py-2 text-sm flex items-center gap-2 transition">
            <Download className="h-4 w-4" /> {t("Export")}
          </button>
          <button onClick={() => { setEditing(null); setModalOpen(true); }} className="rounded-xl gradient-brand text-primary-foreground text-sm font-medium px-4 py-2 flex items-center gap-2 hover:opacity-95 active:scale-[0.99] transition shadow-lg shadow-primary/20">
            <Plus className="h-4 w-4" /> {t("Add lead")}
          </button>
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
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as LeadStatus | "All")}
            className="appearance-none rounded-xl bg-input/40 border border-border pl-9 pr-9 py-2 text-sm outline-none focus:ring-4 focus:ring-ring transition"
          >
            <option value="All">{t("All statuses")}</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {source.isLoading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState onAdd={() => { setEditing(null); setModalOpen(true); }} />
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
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="border-t border-border hover:bg-muted/30 transition group"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-lg gradient-brand text-white flex items-center justify-center text-xs font-semibold">
                            {l.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium">{l.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{l.company_name ?? "—"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{l.email}</td>
                      <td className="px-5 py-3 text-muted-foreground">{l.phone ?? "—"}</td>
                      <td className="px-5 py-3"><StatusSelector lead={l} /></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100 transition">
                          <button onClick={() => openEdit(l)} className="p-2 rounded-lg hover:bg-primary/10 hover:text-primary transition" aria-label={t("Edit")}><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => setDeleting(l)} className="p-2 rounded-lg hover:bg-destructive/10 hover:text-destructive transition" aria-label={t("Delete")}><Trash2 className="h-4 w-4" /></button>
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
              <motion.div key={l.id} layout className="glass rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl gradient-brand text-white flex items-center justify-center font-semibold">{l.name.charAt(0).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.email}</div>
                  </div>
                  <StatusBadge status={l.lead_status} />
                </div>
                <div className="mt-3 text-sm text-muted-foreground">{l.company_name ?? "—"} · {l.phone ?? "—"}</div>
                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => openEdit(l)} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-primary/10 hover:text-primary">{t("Edit")}</button>
                  <button onClick={() => setDeleting(l)} className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-destructive/10 hover:text-destructive">{t("Delete")}</button>
                </div>
              </motion.div>
            ))}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("Page {page} / {totalPages}", { page, totalPages: pages })}</span>
              <div className="flex gap-2">
                <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted/60">{t("Previous")}</button>
                <button disabled={page === pages} onClick={() => setPage((p) => p + 1)} className="px-3 py-1.5 rounded-lg border border-border disabled:opacity-40 hover:bg-muted/60">{t("Next")}</button>
              </div>
            </div>
          )}
        </>
      )}

      <LeadModal open={modalOpen} onClose={close} lead={editing} />
      <DeleteModal lead={deleting} onClose={() => setDeleting(null)} />
    </motion.div>
  );
}

function StatusSelector({ lead }: { lead: Lead }) {
  const update = useUpdateLead();
  return (
    <div className="relative inline-flex rounded-full focus-within:ring-2 focus-within:ring-ring">
      <StatusBadge status={lead.lead_status} />
      <select
        aria-label={`${t("Status")}: ${t(lead.lead_status)}`}
        value={lead.lead_status}
        onChange={(e) => update.mutate({ id: lead.id, input: { lead_status: e.target.value as LeadStatus } })}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      >
        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{t(s)}</option>)}
      </select>
    </div>
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
        {t("Start building your pipeline. Add your first lead to track conversations and conversions.")}
      </p>
      <button onClick={onAdd} className="mt-5 rounded-xl gradient-brand text-primary-foreground text-sm font-medium px-5 py-2.5 inline-flex items-center gap-2 hover:opacity-95 transition">
        <Plus className="h-4 w-4" /> {t("Add your first lead")}
      </button>
    </div>
  );
}
