export interface PrintfulSyncProduct {
  id: number;
  external_id?: string;
  name: string;
  variants?: PrintfulSyncVariant[];
}

export interface PrintfulSyncVariant {
  id: number;
  external_id?: string;
  variant_id: number;
  retail_price: string;
  name: string;
  product?: { image?: string; name?: string };
  files?: Array<{ id: number; url?: string; type: string }>;
}

export interface PrintfulOrderInput {
  external_id: string;
  shipping?: string;
  recipient: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    state_code: string;
    country_code: string;
    zip: string;
    email?: string;
    phone?: string;
  };
  items: Array<{
    sync_variant_id: number;
    quantity: number;
    files?: Array<{ url: string; type?: string }>;
  }>;
  retail_costs?: {
    currency: string;
    subtotal: string;
    tax: string;
    shipping: string;
    discount?: string;
    total: string;
  };
  confirm?: boolean;
}

export interface PrintfulOrder {
  id: number;
  external_id: string;
  status: string;
  shipments?: Array<{
    carrier: string;
    service: string;
    tracking_number: string;
    tracking_url: string;
  }>;
}

export interface PrintfulWebhookEvent {
  type: string;
  data: {
    id?: number;
    external_id?: string;
    order?: PrintfulOrder;
    shipment?: {
      tracking_url?: string;
      tracking_number?: string;
    };
  };
}
