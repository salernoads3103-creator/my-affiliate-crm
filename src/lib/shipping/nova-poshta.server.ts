import type {
  DirectoryOption,
  NovaPoshtaDirectoryKind,
  NovaPoshtaDirectoryPurpose,
  NovaPoshtaSettings,
  OrderDelivery,
} from "./types";

const NOVA_POSHTA_API_URL = "https://api.novaposhta.ua/v2.0/json/";
const API_TIMEOUT_MS = 20_000;
const UUID_REF = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

type JsonObject = Record<string, unknown>;
export type NovaPoshtaFetch = typeof fetch;

export class NovaPoshtaRejectedError extends Error {
  readonly code = "CARRIER_REJECTED";

  constructor() {
    super("Nova Poshta rejected the request");
    this.name = "NovaPoshtaRejectedError";
  }
}

export class NovaPoshtaUnsupportedOperationError extends Error {
  readonly code = "CARRIER_OPERATION_NOT_CONFIRMED";

  constructor(readonly operation: "novapay_postpayment" | "payment_control") {
    super("The selected Nova Poshta payment operation is not enabled");
    this.name = "NovaPoshtaUnsupportedOperationError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNovaPoshtaRef(value: unknown): value is string {
  return typeof value === "string" && UUID_REF.test(value);
}

async function fetchWithTimeout(fetcher: NovaPoshtaFetch, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetcher(NOVA_POSHTA_API_URL, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Nova Poshta response was not valid JSON");
  }
}

async function callNovaPoshta<T>(
  apiKey: string,
  modelName: string,
  calledMethod: string,
  methodProperties: JsonObject,
  fetcher: NovaPoshtaFetch,
  onRequestStart: () => void = () => {},
): Promise<T[]> {
  const isWaybillCreate = modelName === "InternetDocument" && calledMethod === "save";
  if (isWaybillCreate) onRequestStart();

  const response = await fetchWithTimeout(fetcher, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, modelName, calledMethod, methodProperties }),
  });
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500) throw new NovaPoshtaRejectedError();
    throw new Error("Nova Poshta request outcome could not be confirmed");
  }

  const body = await readJson(response);
  if (!isObject(body) || !Array.isArray(body.data)) {
    throw new Error("Nova Poshta response was incomplete");
  }
  if (body.success !== true) throw new NovaPoshtaRejectedError();
  return body.data as T[];
}

type RawCity = {
  Ref?: unknown;
  Description?: unknown;
  AreaDescription?: unknown;
  SettlementTypeDescription?: unknown;
};
type RawWarehouse = {
  Ref?: unknown;
  Description?: unknown;
  Number?: unknown;
  CityRef?: unknown;
  CityDescription?: unknown;
};
type RawCounterparty = {
  Ref?: unknown;
  Description?: unknown;
  FirstName?: unknown;
  LastName?: unknown;
};
type RawContact = {
  Ref?: unknown;
  Description?: unknown;
  Phones?: unknown;
  Phone?: unknown;
};
type RawCounterpartyAddress = {
  Ref?: unknown;
  Description?: unknown;
  CityRef?: unknown;
  CityDescription?: unknown;
};

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase("uk-UA");
}

function matchesSearch(values: unknown[], query: string): boolean {
  const needle = normalizeText(query);
  if (!needle) return true;
  return values.some((value) => typeof value === "string" && normalizeText(value).includes(needle));
}

function cityOption(row: RawCity): DirectoryOption | null {
  if (!isNovaPoshtaRef(row.Ref) || typeof row.Description !== "string") return null;
  const area = typeof row.AreaDescription === "string" ? row.AreaDescription : null;
  return {
    ref: row.Ref,
    description: area ? `${row.Description}, ${area}` : row.Description,
  };
}

function warehouseOption(row: RawWarehouse): DirectoryOption | null {
  if (!isNovaPoshtaRef(row.Ref) || typeof row.Description !== "string") return null;
  const number =
    typeof row.Number === "string" || typeof row.Number === "number" ? String(row.Number) : "";
  return {
    ref: row.Ref,
    description: row.Description,
    ...(number ? { detail: number } : {}),
    ...(isNovaPoshtaRef(row.CityRef) ? { cityRef: row.CityRef } : {}),
    ...(typeof row.CityDescription === "string" ? { cityName: row.CityDescription } : {}),
  };
}

function counterpartyOption(row: RawCounterparty): DirectoryOption | null {
  if (!isNovaPoshtaRef(row.Ref) || typeof row.Description !== "string") return null;
  return { ref: row.Ref, description: row.Description };
}

function contactOption(row: RawContact): DirectoryOption | null {
  if (!isNovaPoshtaRef(row.Ref) || typeof row.Description !== "string") return null;
  const phone =
    typeof row.Phones === "string" ? row.Phones : typeof row.Phone === "string" ? row.Phone : "";
  return { ref: row.Ref, description: row.Description, ...(phone ? { phone } : {}) };
}

function counterpartyAddressOption(row: RawCounterpartyAddress): DirectoryOption | null {
  if (!isNovaPoshtaRef(row.Ref) || typeof row.Description !== "string") return null;
  return {
    ref: row.Ref,
    description: row.Description,
    ...(isNovaPoshtaRef(row.CityRef) ? { cityRef: row.CityRef } : {}),
    ...(typeof row.CityDescription === "string" ? { cityName: row.CityDescription } : {}),
  };
}

export async function searchNovaPoshtaDirectory(
  apiKey: string,
  kind: NovaPoshtaDirectoryKind,
  search: string,
  cityRef: string | null,
  purpose: NovaPoshtaDirectoryPurpose,
  counterpartyRef: string | null = null,
  fetcher: NovaPoshtaFetch = fetch,
): Promise<DirectoryOption[]> {
  const query = search.trim().slice(0, 100);
  const page = "1";
  const limit = kind === "divisions" ? "100" : "50";

  if (kind === "cities") {
    const rows = await callNovaPoshta<RawCity>(
      apiKey,
      "Address",
      "getCities",
      { FindByString: query, Page: page, Limit: limit },
      fetcher,
    );
    return rows.map(cityOption).filter((option): option is DirectoryOption => option !== null);
  }

  if (kind === "divisions") {
    if (!cityRef || !isNovaPoshtaRef(cityRef)) return [];
    const rows = await callNovaPoshta<RawWarehouse>(
      apiKey,
      "Address",
      "getWarehouses",
      { CityRef: cityRef, FindByString: query, Page: page, Limit: limit },
      fetcher,
    );
    return rows
      .filter((row) => row.CityRef === cityRef)
      .map(warehouseOption)
      .filter((option): option is DirectoryOption => option !== null);
  }

  if (kind === "senderProfiles") {
    if (purpose !== "sender") return [];
    const rows = await callNovaPoshta<RawCounterparty>(
      apiKey,
      "Counterparty",
      "getCounterparties",
      { CounterpartyProperty: "Sender", FindByString: query, Page: page },
      fetcher,
    );
    return rows
      .map(counterpartyOption)
      .filter((option): option is DirectoryOption => option !== null);
  }

  if (!counterpartyRef || !isNovaPoshtaRef(counterpartyRef)) return [];
  if (purpose !== "sender") return [];
  if (kind === "senderContacts") {
    const rows = await callNovaPoshta<RawContact>(
      apiKey,
      "Counterparty",
      "getCounterpartyContactPersons",
      { Ref: counterpartyRef },
      fetcher,
    );
    return rows
      .filter((row) => matchesSearch([row.Description, row.Phones, row.Phone], query))
      .map(contactOption)
      .filter((option): option is DirectoryOption => option !== null);
  }

  const rows = await callNovaPoshta<RawCounterpartyAddress>(
    apiKey,
    "Counterparty",
    "getCounterpartyAddresses",
    { Ref: counterpartyRef },
    fetcher,
  );
  return rows
    .filter(
      (row) => (!cityRef || row.CityRef === cityRef) && matchesSearch([row.Description], query),
    )
    .map(counterpartyAddressOption)
    .filter((option): option is DirectoryOption => option !== null);
}

export async function validateNovaPoshtaReferences(
  apiKey: string,
  settings: NovaPoshtaSettings,
  delivery: OrderDelivery,
  fetcher: NovaPoshtaFetch = fetch,
): Promise<boolean> {
  const senderRefs = [
    settings.senderCounterpartyRef,
    settings.senderContactRef,
    settings.senderCityRef,
    settings.senderBranchRef,
  ];
  const recipientRefs = [delivery.recipient_city_ref, delivery.recipient_branch_ref];
  if (
    [...senderRefs, ...recipientRefs].some((ref) => !isNovaPoshtaRef(ref)) ||
    !settings.senderCounterpartyRef
  ) {
    return false;
  }

  const [senderAddresses, senderContacts, senderCities, recipientCities, recipientWarehouses] =
    await Promise.all([
      callNovaPoshta<RawCounterpartyAddress>(
        apiKey,
        "Counterparty",
        "getCounterpartyAddresses",
        { Ref: settings.senderCounterpartyRef },
        fetcher,
      ),
      callNovaPoshta<RawContact>(
        apiKey,
        "Counterparty",
        "getCounterpartyContactPersons",
        { Ref: settings.senderCounterpartyRef },
        fetcher,
      ),
      callNovaPoshta<RawCity>(
        apiKey,
        "Address",
        "getCities",
        { Ref: settings.senderCityRef, Page: "1", Limit: "20" },
        fetcher,
      ),
      callNovaPoshta<RawCity>(
        apiKey,
        "Address",
        "getCities",
        { Ref: delivery.recipient_city_ref, Page: "1", Limit: "20" },
        fetcher,
      ),
      callNovaPoshta<RawWarehouse>(
        apiKey,
        "Address",
        "getWarehouses",
        {
          CityRef: delivery.recipient_city_ref,
          FindByString: delivery.recipient_branch_name ?? "",
          Page: "1",
          Limit: "100",
        },
        fetcher,
      ),
    ]);

  return (
    senderAddresses.some(
      (row) => row.Ref === settings.senderBranchRef && row.CityRef === settings.senderCityRef,
    ) &&
    senderContacts.some((row) => row.Ref === settings.senderContactRef) &&
    senderCities.some((row) => row.Ref === settings.senderCityRef) &&
    recipientCities.some((row) => row.Ref === delivery.recipient_city_ref) &&
    recipientWarehouses.some(
      (row) =>
        row.Ref === delivery.recipient_branch_ref && row.CityRef === delivery.recipient_city_ref,
    )
  );
}

export type CreateWaybillResult = { shipmentRef: string; trackingNumber: string };

function formatMinorUnits(minorUnits: number): string {
  const major = Math.trunc(minorUnits / 100);
  const minor = String(minorUnits % 100).padStart(2, "0");
  return `${major}.${minor}`;
}

function formatGramsAsKilograms(grams: number): string {
  const whole = Math.trunc(grams / 1000);
  const fraction = String(grams % 1000).padStart(3, "0");
  return `${whole}.${fraction}`;
}

function formatNovaPoshtaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day}.${values.month}.${values.year}`;
}

function formatCubicMeters(lengthMm: number, widthMm: number, heightMm: number): string {
  const cubicMeters = lengthMm * widthMm * heightMm;
  return (cubicMeters / 1_000_000_000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "") || "0";
}

export async function createNovaPoshtaWaybill(
  apiKey: string,
  settings: NovaPoshtaSettings,
  delivery: OrderDelivery,
  order: {
    id: string;
    buyer_name: string;
    buyer_phone: string;
    buyer_email: string | null;
    operator_comment: string | null;
    product_name_snapshot: string;
  },
  fetcher: NovaPoshtaFetch = fetch,
  onWaybillRequestStart: () => void = () => {},
): Promise<CreateWaybillResult> {
  if (
    !isNovaPoshtaRef(settings.senderCounterpartyRef) ||
    !isNovaPoshtaRef(settings.senderContactRef) ||
    !isNovaPoshtaRef(settings.senderCityRef) ||
    !isNovaPoshtaRef(settings.senderBranchRef) ||
    !isNovaPoshtaRef(delivery.recipient_city_ref) ||
    !isNovaPoshtaRef(delivery.recipient_branch_ref)
  ) {
    throw new Error("Nova Poshta references are invalid");
  }
  if (delivery.cod_amount_minor !== null) {
    throw new NovaPoshtaUnsupportedOperationError(
      delivery.cod_service === "novapay" ? "novapay_postpayment" : "payment_control",
    );
  }
  if (delivery.delivery_payer === "ThirdPerson") {
    throw new Error("Third-party delivery payer is not supported by this integration");
  }

  const methodProperties: JsonObject = {
    NewAddress: "1",
    PayerType: delivery.delivery_payer,
    PaymentMethod: delivery.delivery_payment_method,
    DateTime: formatNovaPoshtaDate(new Date()),
    CargoType: "Cargo",
    Weight: formatGramsAsKilograms(delivery.weight_grams ?? 0),
    VolumeGeneral: formatCubicMeters(
      delivery.length_mm ?? 0,
      delivery.width_mm ?? 0,
      delivery.height_mm ?? 0,
    ),
    ServiceType: delivery.delivery_type === "postomat" ? "WarehousePostomat" : "WarehouseWarehouse",
    SeatsAmount: "1",
    Description: order.product_name_snapshot.slice(0, 100),
    Cost: formatMinorUnits(delivery.declared_value_minor ?? 0),
    CitySender: settings.senderCityRef,
    Sender: settings.senderCounterpartyRef,
    SenderAddress: settings.senderBranchRef,
    ContactSender: settings.senderContactRef,
    SendersPhone: settings.senderPhone.replace(/\D/g, ""),
    CityRecipient: delivery.recipient_city_ref,
    RecipientType: "PrivatePerson",
    RecipientName: order.buyer_name.slice(0, 100),
    RecipientAddress: delivery.recipient_branch_ref,
    RecipientsPhone: order.buyer_phone.replace(/\D/g, ""),
    InfoRegClientBarcodes: order.id,
  };
  const rows = await callNovaPoshta<JsonObject>(
    apiKey,
    "InternetDocument",
    "save",
    methodProperties,
    fetcher,
    onWaybillRequestStart,
  );
  const result = rows[0];
  if (
    !isObject(result) ||
    typeof result.Ref !== "string" ||
    typeof result.IntDocNumber !== "string"
  ) {
    throw new Error("Nova Poshta shipment response was incomplete");
  }
  return { shipmentRef: result.Ref, trackingNumber: result.IntDocNumber };
}
