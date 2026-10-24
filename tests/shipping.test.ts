import { describe, expect, it } from "bun:test";
import {
  encryptNovaPoshtaApiKey,
  decryptNovaPoshtaApiKey,
} from "../src/lib/shipping/credentials.server";
import {
  createNovaPoshtaWaybill,
  NovaPoshtaRejectedError,
  NovaPoshtaUnsupportedOperationError,
  searchNovaPoshtaDirectory,
  validateNovaPoshtaReferences,
} from "../src/lib/shipping/nova-poshta.server";
import type { NovaPoshtaSettings, OrderDelivery } from "../src/lib/shipping/types";
import { getWaybillMissingFields, OrderDeliverySchema } from "../src/lib/shipping/validation";
import {
  deliveryFormFromLead,
  deliveryFormFromOrderSnapshot,
  deliveryFormFromRow,
  toOrderDeliveryInput,
} from "../src/lib/shipping/delivery-form";
import {
  centimetersToMillimeters,
  millimetersToCentimetersInput,
} from "../src/lib/shipping/dimensions";

const refs = {
  senderCity: "8d5a980d-391c-11dd-90d9-001a92567626",
  sender: "f867c762-e66a-11e3-8c4a-0050568002cf",
  senderAddress: "1ec09d88-e1c2-11e3-8c4a-0050568002cf",
  senderContact: "e23f313c-e67a-11e3-8c4a-0050568002cf",
  recipientCity: "db5c88de-391c-11dd-90d9-001a92567626",
  recipientBranch: "daec7561-b457-11e4-a77a-005056887b8d",
};

const settings: NovaPoshtaSettings = {
  apiKeyConfigured: true,
  senderName: "Ірина Коваль",
  senderPhone: "380671234567",
  senderEmail: "sender@example.com",
  senderCompanyName: "",
  senderCompanyTin: "",
  senderCounterpartyRef: refs.sender,
  senderCounterpartyName: "Ірина Коваль",
  senderContactRef: refs.senderContact,
  senderContactName: "Ірина Коваль",
  senderCityRef: refs.senderCity,
  senderCityName: "Київ, Київська область",
  senderBranchRef: refs.senderAddress,
  senderBranchName: "1 · Відділення № 1",
};

const delivery: OrderDelivery = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  order_id: "33333333-3333-4333-8333-333333333333",
  provider: "nova_poshta",
  delivery_type: "warehouse",
  recipient_city_ref: refs.recipientCity,
  recipient_city_name: "Львів, Львівська область",
  recipient_branch_ref: refs.recipientBranch,
  recipient_branch_name: "2 · Відділення № 2",
  weight_grams: 850,
  length_mm: 250,
  width_mm: 150,
  height_mm: 100,
  declared_value_minor: 119000,
  delivery_payer: "Recipient",
  delivery_payment_method: "Cash",
  cod_amount_minor: null,
  cod_service: null,
  operation_status: "draft",
  operation_id: null,
  operation_started_at: null,
  shipment_ref: null,
  tracking_number: null,
  waybill_created_at: null,
  last_error_code: null,
  created_at: "2026-10-24T12:00:00.000Z",
  updated_at: "2026-10-24T12:00:00.000Z",
};

type MockCall = { url: URL; init: RequestInit; body: Record<string, unknown> };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object in the mocked Nova Poshta request");
  }
  return value as Record<string, unknown>;
}

function mockFetch(
  respond: (call: MockCall) => Response | Promise<Response>,
  calls: MockCall[] = [],
): NovaPoshtaFetch {
  return async (input, init) => {
    const requestInit = init ?? {};
    const body = asRecord(JSON.parse(String(requestInit.body)) as unknown);
    const call = { url: new URL(String(input)), init: requestInit, body };
    calls.push(call);
    return respond(call);
  };
}

const order = {
  id: delivery.order_id,
  buyer_name: "Олена Савчук",
  buyer_phone: "+380671234567",
  buyer_email: null,
  operator_comment: null,
  product_name_snapshot: "Бритва НХ-8503",
};

describe("Nova Poshta API v2.0", () => {
  it("converts centimeters at the UI boundary and keeps integer millimeters canonical", () => {
    expect(millimetersToCentimetersInput(250)).toBe("25");
    expect(millimetersToCentimetersInput(255)).toBe("25.5");
    expect(millimetersToCentimetersInput(null)).toBe("");
    expect(centimetersToMillimeters("25")).toBe(250);
    expect(centimetersToMillimeters("25.5")).toBe(255);
    expect(centimetersToMillimeters("25,5")).toBe(255);
    expect(centimetersToMillimeters("")).toBeNull();
    expect(() => centimetersToMillimeters("25.55")).toThrow();
    expect(() => centimetersToMillimeters("0")).toThrow();
  });

  it("prefills delivery from lead references without inventing missing values", () => {
    const form = deliveryFormFromLead({
      delivery_type: "warehouse",
      city_ref: refs.recipientCity,
      city_name: "Львів",
      branch_ref: refs.recipientBranch,
      branch_name: "Відділення № 2",
      product_weight_grams: 850,
      product_length_mm: 250,
      product_width_mm: 150,
      product_height_mm: 100,
    });

    expect(form.cityRef).toBe(refs.recipientCity);
    expect(form.branchRef).toBe(refs.recipientBranch);
    expect(form.cityName).toBe("Львів");
    expect(form.branchName).toBe("Відділення № 2");
    expect(form).toMatchObject({ lengthCm: "25", widthCm: "15", heightCm: "10" });
    expect(toOrderDeliveryInput(form)).toMatchObject({
      deliveryType: "warehouse",
      cityRef: refs.recipientCity,
      cityName: "Львів",
      branchRef: refs.recipientBranch,
      branchName: "Відділення № 2",
      weightGrams: 850,
      lengthMm: 250,
      widthMm: 150,
      heightMm: 100,
      declaredValueMinor: null,
      codAmountMinor: null,
      codService: null,
      payer: null,
      paymentMethod: null,
    });
  });

  it("uses order snapshots only when no saved delivery exists and leaves missing values blank", () => {
    const snapshot = {
      product_weight_grams_snapshot: 850,
      product_length_mm_snapshot: 250,
      product_width_mm_snapshot: 150,
      product_height_mm_snapshot: 100,
    };
    expect(deliveryFormFromRow(null, snapshot)).toMatchObject({
      weightGrams: "850",
      lengthCm: "25",
      widthCm: "15",
      heightCm: "10",
      payer: "",
      paymentMethod: "",
    });
    expect(
      deliveryFormFromOrderSnapshot({
        product_weight_grams_snapshot: null,
        product_length_mm_snapshot: null,
        product_width_mm_snapshot: null,
        product_height_mm_snapshot: null,
      }),
    ).toMatchObject({ weightGrams: "", lengthCm: "", widthCm: "", heightCm: "" });
  });

  it("does not derive Nova Poshta references from unverified lead text", () => {
    const form = deliveryFormFromLead({
      delivery_type: "warehouse",
      city_ref: "Kyiv",
      city_name: "Київ",
      branch_ref: "Branch 1",
      branch_name: "Відділення 1",
      product_weight_grams: null,
      product_length_mm: null,
      product_width_mm: null,
      product_height_mm: null,
    });

    expect(form.cityRef).toBe("");
    expect(form.branchRef).toBe("");
    expect(form.cityName).toBe("");
    expect(form.branchName).toBe("");
  });

  it("preserves saved manual delivery corrections on every form reopen", () => {
    const snapshot = {
      product_weight_grams_snapshot: 850,
      product_length_mm_snapshot: 250,
      product_width_mm_snapshot: 150,
      product_height_mm_snapshot: 100,
    };
    const saved = {
      ...delivery,
      weight_grams: 920,
      length_mm: 280,
      width_mm: 170,
      height_mm: 110,
    };
    const firstOpen = deliveryFormFromRow(saved, snapshot);
    const reopened = deliveryFormFromRow(saved, snapshot);

    expect(firstOpen).toMatchObject({
      weightGrams: "920",
      lengthCm: "28",
      widthCm: "17",
      heightCm: "11",
    });
    expect(toOrderDeliveryInput(firstOpen)).toMatchObject({
      lengthMm: 280,
      widthMm: 170,
      heightMm: 110,
    });
    expect(reopened).toEqual(firstOpen);

    const clearedWeight = deliveryFormFromRow({ ...saved, weight_grams: null }, snapshot);
    expect(clearedWeight.weightGrams).toBe("");
  });

  it("validates v2 UUID references and requires parcel dimensions", () => {
    const parsed = OrderDeliverySchema.parse({
      deliveryType: "warehouse",
      cityRef: refs.recipientCity,
      cityName: "Львів",
      branchRef: refs.recipientBranch,
      branchName: "Відділення № 2",
      weightGrams: 850,
      lengthMm: 250,
      widthMm: 150,
      heightMm: 100,
      declaredValueMinor: 119000,
      payer: "Recipient",
      paymentMethod: "Cash",
      codAmountMinor: null,
      codService: null,
    });

    expect(parsed.cityRef).toBe(refs.recipientCity);
    expect(() => OrderDeliverySchema.parse({ ...parsed, branchRef: "9002" })).toThrow();
    expect(() => OrderDeliverySchema.parse({ ...parsed, widthMm: 0 })).toThrow();
    expect(
      getWaybillMissingFields(parsed, { name: "Олена Савчук", phone: "+380671234567" }, settings),
    ).toEqual([]);
  });

  it("uses the v2.0 JSON envelope and official city, warehouse, sender and contact directories", async () => {
    const calls: MockCall[] = [];
    const fetcher = mockFetch((call) => {
      const method = call.body.calledMethod;
      if (method === "getCities") {
        return jsonResponse({
          success: true,
          data: [
            { Ref: refs.recipientCity, Description: "Львів", AreaDescription: "Львівська область" },
          ],
        });
      }
      if (method === "getWarehouses") {
        return jsonResponse({
          success: true,
          data: [
            {
              Ref: refs.recipientBranch,
              Description: "Відділення № 2",
              Number: "2",
              CityRef: refs.recipientCity,
              CityDescription: "Львів",
            },
          ],
        });
      }
      if (method === "getCounterparties") {
        return jsonResponse({
          success: true,
          data: [{ Ref: refs.sender, Description: "Ірина Коваль" }],
        });
      }
      if (method === "getCounterpartyContactPersons") {
        return jsonResponse({
          success: true,
          data: [{ Ref: refs.senderContact, Description: "Ірина Коваль", Phones: "380671234567" }],
        });
      }
      return jsonResponse({
        success: true,
        data: [
          {
            Ref: refs.senderAddress,
            Description: "Відділення № 1",
            CityRef: refs.senderCity,
            CityDescription: "Київ",
          },
        ],
      });
    }, calls);

    const cities = await searchNovaPoshtaDirectory(
      "mock-v2-directory-key",
      "cities",
      "Львів",
      null,
      "recipient",
      null,
      fetcher,
    );
    const warehouses = await searchNovaPoshtaDirectory(
      "mock-v2-directory-key",
      "divisions",
      "2",
      refs.recipientCity,
      "recipient",
      null,
      fetcher,
    );
    const senders = await searchNovaPoshtaDirectory(
      "mock-v2-directory-key",
      "senderProfiles",
      "Ірина",
      null,
      "sender",
      null,
      fetcher,
    );
    const contacts = await searchNovaPoshtaDirectory(
      "mock-v2-directory-key",
      "senderContacts",
      "Ірина",
      null,
      "sender",
      refs.sender,
      fetcher,
    );
    const senderAddresses = await searchNovaPoshtaDirectory(
      "mock-v2-directory-key",
      "senderAddresses",
      "1",
      refs.senderCity,
      "sender",
      refs.sender,
      fetcher,
    );

    expect(cities).toEqual([{ ref: refs.recipientCity, description: "Львів, Львівська область" }]);
    expect(warehouses).toEqual([
      {
        ref: refs.recipientBranch,
        description: "Відділення № 2",
        detail: "2",
        cityRef: refs.recipientCity,
        cityName: "Львів",
      },
    ]);
    expect(senders[0]?.ref).toBe(refs.sender);
    expect(contacts[0]).toMatchObject({ ref: refs.senderContact, phone: "380671234567" });
    expect(senderAddresses[0]).toMatchObject({ ref: refs.senderAddress, cityRef: refs.senderCity });

    for (const call of calls) {
      expect(call.url.href).toBe("https://api.novaposhta.ua/v2.0/json/");
      expect(call.init.method).toBe("POST");
      expect(call.body.apiKey).toBe("mock-v2-directory-key");
      expect(call.body.modelName).toMatch(/^(Address|Counterparty)$/);
      expect(typeof call.body.calledMethod).toBe("string");
      expect(typeof call.body.methodProperties).toBe("object");
    }
    expect(calls.map((call) => call.body.calledMethod)).toEqual([
      "getCities",
      "getWarehouses",
      "getCounterparties",
      "getCounterpartyContactPersons",
      "getCounterpartyAddresses",
    ]);
  });

  it("validates selected city and sender/recipient references against v2 directories", async () => {
    const fetcher = mockFetch((call) => {
      const method = call.body.calledMethod;
      if (method === "getCounterpartyAddresses") {
        return jsonResponse({
          success: true,
          data: [{ Ref: refs.senderAddress, CityRef: refs.senderCity }],
        });
      }
      if (method === "getCounterpartyContactPersons") {
        return jsonResponse({ success: true, data: [{ Ref: refs.senderContact }] });
      }
      if (method === "getCities") {
        const properties = asRecord(call.body.methodProperties);
        const cityRef = properties.Ref;
        return jsonResponse({
          success: true,
          data: [{ Ref: cityRef }],
        });
      }
      return jsonResponse({
        success: true,
        data: [{ Ref: refs.recipientBranch, CityRef: refs.recipientCity }],
      });
    });

    expect(await validateNovaPoshtaReferences("mock-key", settings, delivery, fetcher)).toBe(true);
    expect(
      await validateNovaPoshtaReferences(
        "mock-key",
        settings,
        { ...delivery, recipient_branch_ref: "not-a-provider-ref" },
        fetcher,
      ),
    ).toBe(false);
  });

  it("creates a normal domestic waybill with InternetDocument.save and no COD fields", async () => {
    const calls: MockCall[] = [];
    const apiKey = "mock-create-key";
    const fetcher = mockFetch(
      () =>
        jsonResponse({
          success: true,
          data: [{ Ref: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", IntDocNumber: "NPAA1234567890" }],
        }),
      calls,
    );
    let requestStarted = false;

    const result = await createNovaPoshtaWaybill(apiKey, settings, delivery, order, fetcher, () => {
      requestStarted = true;
    });

    expect(result).toEqual({
      shipmentRef: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      trackingNumber: "NPAA1234567890",
    });
    expect(requestStarted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe("https://api.novaposhta.ua/v2.0/json/");
    expect(calls[0]?.body).toMatchObject({
      apiKey,
      modelName: "InternetDocument",
      calledMethod: "save",
      methodProperties: {
        NewAddress: "1",
        CargoType: "Cargo",
        ServiceType: "WarehouseWarehouse",
        PayerType: "Recipient",
        PaymentMethod: "Cash",
        DateTime: expect.stringMatching(/^\d{2}\.\d{2}\.\d{4}$/),
        CitySender: refs.senderCity,
        Sender: refs.sender,
        SenderAddress: refs.senderAddress,
        ContactSender: refs.senderContact,
        CityRecipient: refs.recipientCity,
        RecipientAddress: refs.recipientBranch,
        RecipientsPhone: "380671234567",
        Cost: "1190.00",
      },
    });
    const properties = asRecord(calls[0]?.body.methodProperties);
    expect(properties).not.toHaveProperty("AfterpaymentOnGoodsCost");
    expect(properties).not.toHaveProperty("BackwardDeliveryData");
    expect(properties).not.toHaveProperty("RecipientContactName");
    expect(properties.VolumeGeneral).toBe("0.00375");
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("blocks NovaPay and Payment Control COD until each exact v2.0 contract is verified", async () => {
    for (const codService of ["novapay", "payment_control"] as const) {
      let calls = 0;
      let requestStarted = false;
      const codDelivery = { ...delivery, cod_amount_minor: 119000, cod_service: codService };
      const missing = getWaybillMissingFields(
        {
          deliveryType: "warehouse",
          cityRef: refs.recipientCity,
          cityName: "Львів",
          branchRef: refs.recipientBranch,
          branchName: "Відділення № 2",
          weightGrams: 850,
          lengthMm: 250,
          widthMm: 150,
          heightMm: 100,
          declaredValueMinor: 119000,
          payer: "Recipient",
          paymentMethod: "Cash",
          codAmountMinor: 119000,
          codService,
        },
        { name: order.buyer_name, phone: order.buyer_phone },
        settings,
      );
      const fetcher: NovaPoshtaFetch = async () => {
        calls += 1;
        return jsonResponse({ success: true, data: [] });
      };

      expect(missing).toContain(
        codService === "novapay" ? "novaPayPostPaymentUnverified" : "paymentControlUnverified",
      );
      await expect(
        createNovaPoshtaWaybill("mock-cod-key", settings, codDelivery, order, fetcher, () => {
          requestStarted = true;
        }),
      ).rejects.toBeInstanceOf(NovaPoshtaUnsupportedOperationError);
      expect(calls).toBe(0);
      expect(requestStarted).toBe(false);
    }
  });

  it("uses the API v2 postomat service type for postomat delivery", async () => {
    const calls: MockCall[] = [];
    const fetcher = mockFetch(
      () =>
        jsonResponse({
          success: true,
          data: [{ Ref: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", IntDocNumber: "NPAA1234567890" }],
        }),
      calls,
    );
    await createNovaPoshtaWaybill(
      "mock-postomat-key",
      settings,
      { ...delivery, delivery_type: "postomat" },
      order,
      fetcher,
    );
    const properties = asRecord(calls[0]?.body.methodProperties);
    expect(properties.ServiceType).toBe("WarehousePostomat");
  });

  it("rejects invalid provider references before making a request", async () => {
    let calls = 0;
    const fetcher: NovaPoshtaFetch = async () => {
      calls += 1;
      return jsonResponse({ success: true, data: [] });
    };
    await expect(
      createNovaPoshtaWaybill(
        "mock-invalid-ref-key",
        settings,
        { ...delivery, recipient_city_ref: "202" },
        order,
        fetcher,
      ),
    ).rejects.toThrow("Nova Poshta references are invalid");
    expect(calls).toBe(0);
  });

  it("handles API rejection and does not retry an ambiguous waybill save", async () => {
    const httpRejectedFetcher = mockFetch(() => jsonResponse({ error: "invalid request" }, 400));
    await expect(
      createNovaPoshtaWaybill(
        "mock-http-rejected-key",
        settings,
        delivery,
        order,
        httpRejectedFetcher,
      ),
    ).rejects.toBeInstanceOf(NovaPoshtaRejectedError);

    const rejectedFetcher = mockFetch(() =>
      jsonResponse({
        success: false,
        data: [],
        errors: ["mock provider validation"],
      }),
    );
    await expect(
      createNovaPoshtaWaybill("mock-rejected-key", settings, delivery, order, rejectedFetcher),
    ).rejects.toBeInstanceOf(NovaPoshtaRejectedError);

    const calls: MockCall[] = [];
    const ambiguousFetcher = mockFetch(() => jsonResponse({ error: "unavailable" }, 503), calls);
    let requestStarts = 0;
    await expect(
      createNovaPoshtaWaybill(
        "mock-ambiguous-key",
        settings,
        delivery,
        order,
        ambiguousFetcher,
        () => {
          requestStarts += 1;
        },
      ),
    ).rejects.not.toBeInstanceOf(NovaPoshtaRejectedError);
    expect(calls).toHaveLength(1);
    expect(requestStarts).toBe(1);
  });

  it("keeps the encrypted workspace key server-side", async () => {
    const envKey = "NOVA_POSHTA_CREDENTIALS_ENCRYPTION_KEY";
    const previous = process.env[envKey];
    process.env[envKey] = btoa(
      String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 1)),
    );
    try {
      const encrypted = await encryptNovaPoshtaApiKey("private-api-key");
      expect(encrypted).not.toContain("private-api-key");
      expect(await decryptNovaPoshtaApiKey(encrypted)).toBe("private-api-key");
    } finally {
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
    }
  });
});
