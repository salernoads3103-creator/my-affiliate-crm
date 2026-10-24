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
import { landingService } from "@/services/landingService";
import type { LandingPage } from "@/lib/landings/types";
import { LandingOriginSchema } from "@/lib/intake/validation";

const NO_TRACKING_OPTION = "__none__";

export type LandingDraftSubmitInput = {
  name: string;
  offerId: string;
  archive?: File;
  allowedOrigin?: string;
  tiktokProfileId?: string | null;
  googleAdsProfileId?: string | null;
};

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
  onSubmit: (input: LandingDraftSubmitInput) => void;
}) {
  const { locale } = useLocale();
  const [name, setName] = useState("");
  const [offerId, setOfferId] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [allowedOrigin, setAllowedOrigin] = useState("");
  const [originInvalid, setOriginInvalid] = useState(false);
  const [tiktokProfileId, setTikTokProfileId] = useState(NO_TRACKING_OPTION);
  const [googleAdsProfileId, setGoogleAdsProfileId] = useState(NO_TRACKING_OPTION);
  const offersQuery = useQuery({
    queryKey: ["offers", workspaceId, "landing-picker"],
    queryFn: () => offerService.list(workspaceId, ""),
    enabled: open && Boolean(workspaceId),
  });
  const isEditing = Boolean(landing);
  const offers = (offersQuery.data?.offers ?? []).filter(
    (offer) => offer.is_active || offer.id === landing?.offer_id,
  );
  const trackingProfilesQuery = useQuery({
    queryKey: ["tracking-profiles", workspaceId],
    queryFn: () => landingService.trackingProfiles(workspaceId),
    enabled: open && !isEditing && Boolean(workspaceId),
  });
  const trackingProfiles = (trackingProfilesQuery.data ?? []).filter(
    (profile) => profile.is_active,
  );
  const tiktokProfiles = trackingProfiles.filter((profile) => profile.platform === "tiktok");
  const googleAdsProfiles = trackingProfiles.filter((profile) => profile.platform === "google_ads");

  useEffect(() => {
    if (!open) return;
    setName(landing?.name ?? "");
    setOfferId(landing?.offer_id ?? "");
    setArchive(null);
    setAllowedOrigin("");
    setOriginInvalid(false);
    setTikTokProfileId(NO_TRACKING_OPTION);
    setGoogleAdsProfileId(NO_TRACKING_OPTION);
  }, [open, landing?.id, landing?.name, landing?.offer_id]);

  const selectOffer = (value: string) => {
    setOfferId(value);
    const selectedOffer = offers.find((offer) => offer.id === value);
    if (selectedOffer && !name.trim()) setName(selectedOffer.name);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !offerId || (!isEditing && !archive) || saving) return;
    const origin = allowedOrigin.trim();
    if (!isEditing && origin && !LandingOriginSchema.safeParse(origin).success) {
      setOriginInvalid(true);
      return;
    }
    onSubmit({
      name: name.trim(),
      offerId,
      ...(archive ? { archive } : {}),
      ...(!isEditing
        ? {
            ...(origin ? { allowedOrigin: origin } : {}),
            tiktokProfileId: tiktokProfileId === NO_TRACKING_OPTION ? null : tiktokProfileId,
            googleAdsProfileId:
              googleAdsProfileId === NO_TRACKING_OPTION ? null : googleAdsProfileId,
          }
        : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEditing ? t("Edit landing draft") : t("Prepare launch")}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? t("Update the draft details or replace its source ZIP.")
              : t("Choose an offer and ZIP. You can add a domain later without uploading again.")}
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
            <Select value={offerId} onValueChange={selectOffer}>
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

          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="landing-origin">{t("Published landing origin (optional)")}</Label>
              <Input
                id="landing-origin"
                type="url"
                inputMode="url"
                placeholder="https://shop.example.com"
                value={allowedOrigin}
                onChange={(event) => {
                  setAllowedOrigin(event.target.value);
                  setOriginInvalid(false);
                }}
                maxLength={255}
                aria-invalid={originInvalid}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  "Leave blank if you do not have a domain yet. Add its exact HTTPS origin later.",
                )}
              </p>
              {originInvalid && (
                <p className="text-xs text-destructive">{t("Enter one exact HTTPS origin")}</p>
              )}
            </div>
          )}

          {!isEditing && (
            <section className="space-y-3 rounded-xl border border-border p-4">
              <div>
                <h3 className="text-sm font-semibold">{t("Tracking profiles (optional)")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("Choose saved profiles. You can prepare the ZIP without pixels.")}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="new-landing-tiktok">{t("TikTok Ads")}</Label>
                  <Select value={tiktokProfileId} onValueChange={setTikTokProfileId}>
                    <SelectTrigger id="new-landing-tiktok">
                      <SelectValue placeholder={t("No tracking profile")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TRACKING_OPTION}>{t("No tracking profile")}</SelectItem>
                      {tiktokProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-landing-google">{t("Google Ads")}</Label>
                  <Select value={googleAdsProfileId} onValueChange={setGoogleAdsProfileId}>
                    <SelectTrigger id="new-landing-google">
                      <SelectValue placeholder={t("No tracking profile")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TRACKING_OPTION}>{t("No tracking profile")}</SelectItem>
                      {googleAdsProfiles.map((profile) => (
                        <SelectItem key={profile.id} value={profile.id}>
                          {profile.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {trackingProfilesQuery.isLoading && (
                <p className="text-xs text-muted-foreground">{t("Loading tracking profiles…")}</p>
              )}
              {trackingProfilesQuery.isError && (
                <p className="text-xs text-destructive">{t("Could not load tracking profiles.")}</p>
              )}
            </section>
          )}

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
              {isEditing ? t("Save changes") : t("Prepare launch")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
