import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/locale-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { t, localizeError } from "@/lib/i18n";
import { offerService } from "@/services/offerService";
import type { LandingPage } from "@/lib/landings/types";

export function LandingDraftDialog({
  open,
  workspaceId,
  saving,
  landing,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  workspaceId: string;
  saving: boolean;
  landing?: LandingPage;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { name: string; offerId: string; archive?: File }) => void;
}) {
  const { locale } = useLocale();
  const [name, setName] = useState("");
  const [offerId, setOfferId] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const offersQuery = useQuery({
    queryKey: ["offers", workspaceId, "landing-picker"],
    queryFn: () => offerService.list(workspaceId, ""),
    enabled: open && Boolean(workspaceId),
  });
  const isEditing = Boolean(landing);
  const offers = (offersQuery.data?.offers ?? []).filter(
    (offer) => offer.is_active || offer.id === landing?.offer_id,
  );

  useEffect(() => {
    if (!open) return;
    setName(landing?.name ?? "");
    setOfferId(landing?.offer_id ?? "");
    setArchive(null);
  }, [open, landing?.id, landing?.name, landing?.offer_id]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !offerId || (!isEditing && !archive) || saving) return;
    onSubmit({ name: name.trim(), offerId, ...(archive ? { archive } : {}) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("Edit landing draft") : t("New landing page")}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("Update the draft details or replace its source ZIP.")
              : t("Create a draft from an existing static landing page ZIP.")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="landing-name">{t("Landing name")}</Label>
            <Input
              id="landing-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>{t("Choose an active offer")}</Label>
            <Select value={offerId} onValueChange={setOfferId}>
              <SelectTrigger aria-label={t("Choose an active offer")}>
                <SelectValue placeholder={t("Choose an active offer")} />
              </SelectTrigger>
              <SelectContent>
                {offers.map((offer) => (
                  <SelectItem key={offer.id} value={offer.id}>
                    {offer.name}
                    {!offer.is_active && offer.id === landing?.offer_id && ` · ${t("Inactive")}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {offersQuery.isLoading && (
              <p className="text-xs text-muted-foreground">{t("Loading offers…")}</p>
            )}
            {offersQuery.isError && (
              <p className="text-xs text-destructive">
                {localizeError(offersQuery.error, t("Could not load offers."), locale)}
              </p>
            )}
            {!offersQuery.isLoading && !offersQuery.isError && offers.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("No active offers available.")}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="landing-archive">
              {isEditing ? t("Replace source ZIP (optional)") : t("Upload source ZIP")}
            </Label>
            <Input
              id="landing-archive"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
              required={!isEditing}
            />
            <p className="text-xs text-muted-foreground">
              {t("ZIP archives up to 25 MB. Files are kept private.")}
            </p>
            {archive && (
              <p className="truncate text-xs text-foreground/80">
                {archive.name} · {(archive.size / (1024 * 1024)).toFixed(2)} MB
              </p>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancel")}
            </Button>
            <Button
              type="submit"
              disabled={
                saving ||
                !name.trim() ||
                !offerId ||
                (!isEditing && !archive) ||
                offers.length === 0
              }
            >
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {isEditing ? t("Save changes") : t("Create draft")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
